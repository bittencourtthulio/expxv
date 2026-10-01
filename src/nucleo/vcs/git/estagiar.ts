import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { GitErro, NomeInvalidoErro } from "../../git/erros";
import { parseDiff } from "./diff";
import { caminhoSeguro, campos, escrita, LITERAL, rodarGit, temCommits, type OpcoesBase } from "./comum";

// T-06.07 · Stage/unstage por arquivo, hunk e linha; ignorar; descartar com rede de segurança.
//
// Hunk/linha: o `git diff` do arquivo (texto cru, com CR preservado) é a fonte dos bytes; o modelo de hunks da 6A
// (`parseDiff`) define o que é "hunk N / linha M" (mesmos índices que a UI vê). O patch parcial é montado aqui
// e aplicado com `git apply --cached --recount` (2 processos: diff + apply, bem abaixo do orçamento P-20).
// Descartar (decisão): arquivo RASTREADO ganha uma cópia em `<pastaSeguranca>/<id>/arquivos/…` + manifest.json
// ANTES de restaurar (em vez de stash: não mexe na lista de stashes nem no índice do usuário) e dá para
// `desfazerDescarte`. Arquivo NÃO rastreado vai SOMENTE para a lixeira, pela função injetada (shell.trashItem no main).
// Nunca há `rm`, `git clean` nem `checkout .`.

// ---- arquivo ---------------------------------------------------------------------------------

/** `git add -A -- <caminhos>` (inclui remoções e renomeações se origem e destino forem passados). */
export async function estagiarArquivos(raiz: string, caminhos: readonly string[], op: OpcoesBase = {}): Promise<void> {
  const lista = caminhos.map(caminhoSeguro);
  if (lista.length === 0) return;
  await escrita(raiz, ["add", "-A", "--", ...lista], { ...op, env: LITERAL });
}

/** Tira do índice. Repositório sem commits usa `rm --cached`. Renomeação: passe origem e destino. */
export async function desestagiarArquivos(raiz: string, caminhos: readonly string[], op: OpcoesBase = {}): Promise<void> {
  const lista = caminhos.map(caminhoSeguro);
  if (lista.length === 0) return;
  if (await temCommits(raiz, op)) await escrita(raiz, ["restore", "--staged", "--", ...lista], { ...op, env: LITERAL });
  else await escrita(raiz, ["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ...lista], { ...op, env: LITERAL });
}

// ---- patch parcial (puro) --------------------------------------------------------------------

interface LinhaRaw {
  t: "ctx" | "add" | "del";
  txt: string;
  semFim: boolean;
}
interface HunkRaw {
  antigaInicio: number;
  novaInicio: number;
  secao: string;
  linhas: LinhaRaw[];
}

const RE_HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** Separa o diff cru de UM arquivo em cabeçalho e hunks, preservando `\r`. */
export function dividirDiff(raw: string): { cabecalho: string[]; hunks: HunkRaw[] } {
  const linhas = raw.split("\n");
  if (linhas[linhas.length - 1] === "") linhas.pop();
  const cabecalho: string[] = [];
  const hunks: HunkRaw[] = [];
  let h: HunkRaw | null = null;
  for (const l of linhas) {
    const m = RE_HUNK.exec(l);
    if (m !== null) {
      h = { antigaInicio: Number(m[1]), novaInicio: Number(m[2]), secao: m[3] ?? "", linhas: [] };
      hunks.push(h);
    } else if (h === null) {
      cabecalho.push(l);
    } else if (l.startsWith("\\")) {
      const ult = h.linhas[h.linhas.length - 1];
      if (ult) ult.semFim = true;
    } else {
      const c = l[0];
      h.linhas.push({ t: c === "+" ? "add" : c === "-" ? "del" : "ctx", txt: l.slice(1), semFim: false });
    }
  }
  return { cabecalho, hunks };
}

export type Sentido = "estagiar" | "desestagiar";

/**
 * Monta o patch de um hunk (inteiro, ou só as linhas `selecao` = índices em `Hunk.linhas`).
 * estagiar: `-` não escolhida vira contexto e `+` não escolhida some. desestagiar (aplicado com `--reverse`
 * ao diff do índice): `+` não escolhida vira contexto e `-` não escolhida some.
 */
export function montarPatch(cabecalho: readonly string[], h: HunkRaw, selecao: ReadonlySet<number> | null, sentido: Sentido): string {
  const corpo: string[] = [];
  let antiga = 0;
  let nova = 0;
  let mudou = 0;
  h.linhas.forEach((l, i) => {
    const escolhida = selecao === null ? l.t !== "ctx" : selecao.has(i) && l.t !== "ctx";
    let marca: " " | "+" | "-" | null;
    if (l.t === "ctx") marca = " ";
    else if (escolhida) {
      marca = l.t === "add" ? "+" : "-";
      mudou++;
    } else if (l.t === "add") marca = sentido === "estagiar" ? null : " ";
    else marca = sentido === "estagiar" ? " " : null;
    if (marca === null) return;
    if (marca !== "+") antiga++;
    if (marca !== "-") nova++;
    corpo.push(marca + l.txt);
    if (l.semFim) corpo.push("\\ No newline at end of file");
  });
  if (mudou === 0) throw new GitErro("Nenhuma linha de mudança selecionada.");
  const ini = antiga === 0 ? 0 : h.antigaInicio;
  const novaIni = nova === 0 ? 0 : h.novaInicio;
  const cab = `@@ -${ini},${antiga} +${novaIni},${nova} @@${h.secao}`;
  return [...cabecalho, cab, ...corpo].join("\n") + "\n";
}

// ---- hunk / linha ----------------------------------------------------------------------------

const DIFF_ARGS = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "-U3"];

async function diffCru(raiz: string, caminho: string, staged: boolean, op: OpcoesBase): Promise<string> {
  const r = await rodarGit(raiz, [...DIFF_ARGS, ...(staged ? ["--cached"] : []), "--", caminho], { ...op, env: LITERAL, maxBytes: 8 * 1024 * 1024 });
  if (r.truncado) throw new GitErro("Diff grande demais para estagiar por hunk/linha; estagie o arquivo inteiro.");
  if (r.stdout !== "" || staged) return r.stdout;
  // arquivo novo ainda não rastreado: diff contra /dev/null (assim `apply --cached` cria a entrada)
  const lf = await rodarGit(raiz, ["ls-files", "--", caminho], { ...op, env: LITERAL });
  if (lf.stdout.trim() !== "") return r.stdout;
  const n = await rodarGit(raiz, [...DIFF_ARGS.filter((a) => a !== "--no-renames"), "--no-index", "--", "/dev/null", caminho], { ...op, tolerar: [1], maxBytes: 8 * 1024 * 1024 });
  return n.stdout;
}

async function aplicarSelecao(raiz: string, caminhoBruto: string, hunk: number, linhas: readonly number[] | null, sentido: Sentido, op: OpcoesBase): Promise<void> {
  const caminho = caminhoSeguro(caminhoBruto);
  if (!Number.isInteger(hunk) || hunk < 0) throw new GitErro(`Hunk inválido: ${hunk}`);
  const raw = await diffCru(raiz, caminho, sentido === "desestagiar", op);
  const modelo = parseDiff(raw);
  const arq = modelo.arquivos[0];
  if (arq === undefined || arq.hunks.length === 0) throw new GitErro(`Sem mudanças para ${sentido === "estagiar" ? "estagiar" : "desestagiar"} em ${caminho}.`);
  if (arq.binario) throw new GitErro(`Arquivo binário: ${caminho} só pode ser estagiado inteiro.`);
  const { cabecalho, hunks } = dividirDiff(raw);
  const h = hunks[hunk];
  const m = arq.hunks[hunk];
  if (h === undefined || m === undefined || m.linhas.length !== h.linhas.length) throw new GitErro(`Hunk ${hunk} não existe em ${caminho} (o arquivo mudou; recarregue o diff).`);
  let sel: Set<number> | null = null;
  if (linhas !== null) {
    sel = new Set();
    for (const i of linhas) {
      if (!Number.isInteger(i) || i < 0 || i >= h.linhas.length) throw new GitErro(`Linha inválida: ${i}`);
      sel.add(i);
    }
  }
  const patch = montarPatch(cabecalho, h, sel, sentido);
  await escrita(raiz, ["apply", "--cached", "--recount", "--whitespace=nowarn", ...(sentido === "desestagiar" ? ["--reverse"] : []), "-"], { ...op, stdin: patch });
}

export const estagiarHunk = (raiz: string, caminho: string, hunk: number, op: OpcoesBase = {}): Promise<void> => aplicarSelecao(raiz, caminho, hunk, null, "estagiar", op);
export const desestagiarHunk = (raiz: string, caminho: string, hunk: number, op: OpcoesBase = {}): Promise<void> => aplicarSelecao(raiz, caminho, hunk, null, "desestagiar", op);
/** `linhas`: índices em `Hunk.linhas` do hunk (o mesmo modelo que `diffGit` devolve). */
export const estagiarLinhas = (raiz: string, caminho: string, hunk: number, linhas: readonly number[], op: OpcoesBase = {}): Promise<void> => aplicarSelecao(raiz, caminho, hunk, linhas, "estagiar", op);
export const desestagiarLinhas = (raiz: string, caminho: string, hunk: number, linhas: readonly number[], op: OpcoesBase = {}): Promise<void> => aplicarSelecao(raiz, caminho, hunk, linhas, "desestagiar", op);

// ---- ignorar ---------------------------------------------------------------------------------

export interface ResultadoIgnorar {
  adicionados: string[];
  jaExistiam: string[];
}

/**
 * Acrescenta padrões ao `.gitignore` da raiz sem tocar no resto (mantém o estilo de fim de linha, não duplica,
 * grava via arquivo temporário + rename). Recusa padrão vazio, com quebra de linha, `#` ou `!` iniciais.
 */
export async function ignorar(raiz: string, padroes: readonly string[]): Promise<ResultadoIgnorar> {
  const limpos: string[] = [];
  for (const p of padroes) {
    const t = typeof p === "string" ? p.trim() : "";
    if (t === "" || /[\r\n\0]/.test(t) || t.startsWith("#") || t.startsWith("!")) throw new NomeInvalidoErro(String(p));
    limpos.push(t);
  }
  const alvo = join(raiz, ".gitignore");
  const atual = await readFile(alvo, "utf8").catch(() => "");
  const eol = atual.includes("\r\n") ? "\r\n" : "\n";
  const existentes = new Set(atual.split(/\r?\n/).map((l) => l.trim()));
  const adicionados: string[] = [];
  const jaExistiam: string[] = [];
  for (const p of limpos) {
    if (existentes.has(p) || adicionados.includes(p)) jaExistiam.push(p);
    else adicionados.push(p);
  }
  if (adicionados.length > 0) {
    const sep0 = atual === "" || atual.endsWith("\n") ? "" : eol;
    const tmp = `${alvo}.${process.pid}.tmp`;
    await writeFile(tmp, atual + sep0 + adicionados.join(eol) + eol);
    await rename(tmp, alvo);
  }
  return { adicionados, jaExistiam };
}

// ---- descartar -------------------------------------------------------------------------------

export interface OpcoesDescartar extends OpcoesBase {
  /** Pasta onde ficam as cópias de segurança (o main passa uma pasta dentro do userData). */
  pastaSeguranca: string;
  /** Move para a lixeira do sistema (o main passa `shell.trashItem`). Recebe caminho ABSOLUTO. */
  moverParaLixeira: (caminhoAbsoluto: string) => Promise<void>;
  /** Também descarta o que está no índice (padrão: só a árvore de trabalho). */
  incluirStaged?: boolean;
  /** Não faz nada; devolve o que seria perdido. */
  simular?: boolean;
}

export interface ItemDescarte {
  caminho: string;
  acao: "restaurar" | "lixeira" | "ignorado";
  motivo?: string;
  /** Linhas que se perdem (rastreado). */
  insercoes?: number;
  delecoes?: number;
}

export interface ResultadoDescartar {
  simulado: boolean;
  itens: ItemDescarte[];
  /** Entregue a `desfazerDescarte`; null quando nada rastreado foi restaurado. */
  idDesfazer: string | null;
  naLixeira: string[];
}

interface EntradaStatus {
  x: string;
  y: string;
  caminho: string;
}

async function statusDe(raiz: string, caminhos: readonly string[], op: OpcoesBase): Promise<EntradaStatus[]> {
  const r = await rodarGit(raiz, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...caminhos], { ...op, env: LITERAL });
  const toks = r.stdout.split("\0");
  const lista: EntradaStatus[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] as string;
    if (t.length < 4) continue;
    const x = t[0] as string;
    lista.push({ x, y: t[1] as string, caminho: t.slice(3) });
    if (x === "R" || x === "C") i++; // pula a origem
  }
  return lista;
}

const ehConflito = (e: EntradaStatus): boolean => e.x === "U" || e.y === "U" || (e.x === "A" && e.y === "A") || (e.x === "D" && e.y === "D");

async function contarLinhas(raiz: string, caminhos: readonly string[], base: string[], op: OpcoesBase): Promise<Map<string, { i: number; d: number }>> {
  const mapa = new Map<string, { i: number; d: number }>();
  if (caminhos.length === 0) return mapa;
  const r = await rodarGit(raiz, ["diff", "--numstat", "--no-renames", "-z", ...base, "--", ...caminhos], { ...op, env: LITERAL });
  for (const t of campos(r.stdout)) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(t);
    if (m) mapa.set(m[3] as string, { i: m[1] === "-" ? 0 : Number(m[1]), d: m[2] === "-" ? 0 : Number(m[2]) });
  }
  return mapa;
}

function novoId(): string {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dentroDe(raiz: string, rel: string): string {
  const abs = resolve(raiz, caminhoSeguro(rel));
  if (!abs.startsWith(resolve(raiz) + sep)) throw new NomeInvalidoErro(rel);
  return abs;
}

/**
 * Descarta mudanças. Rastreado: copia o arquivo atual para a pasta de segurança e restaura do índice (ou do HEAD com
 * `incluirStaged`). Não rastreado: lixeira. Conflitos e entradas sem mudança são ignorados (com motivo).
 * `simular: true` só devolve `itens` (com linhas que se perdem).
 */
export async function descartar(raiz: string, caminhos: readonly string[], opcoes: OpcoesDescartar): Promise<ResultadoDescartar> {
  const { pastaSeguranca, moverParaLixeira, incluirStaged = false, simular = false, ...op } = opcoes;
  const lista = [...new Set(caminhos.map(caminhoSeguro))];
  const status = lista.length === 0 ? [] : await statusDe(raiz, lista, op);
  const itens: ItemDescarte[] = [];
  const restaurar: EntradaStatus[] = [];
  const novosNoIndice: EntradaStatus[] = [];
  const lixeira: EntradaStatus[] = [];
  for (const e of status) {
    if (ehConflito(e)) itens.push({ caminho: e.caminho, acao: "ignorado", motivo: "conflito: resolva antes de descartar" });
    else if (e.x === "?" && e.y === "?") {
      lixeira.push(e);
      itens.push({ caminho: e.caminho, acao: "lixeira" });
    } else if (e.x === "!" ) continue;
    else if (incluirStaged && (e.x === "R" || e.x === "C")) itens.push({ caminho: e.caminho, acao: "ignorado", motivo: "renomeação no índice: desfaça o stage antes" });
    else if (incluirStaged && e.x === "A") {
      novosNoIndice.push(e);
      itens.push({ caminho: e.caminho, acao: "lixeira", motivo: "arquivo novo no índice: sai do índice e vai para a lixeira" });
    } else if (e.y !== " " || (incluirStaged && e.x !== " ")) {
      restaurar.push(e);
      itens.push({ caminho: e.caminho, acao: "restaurar" });
    }
  }
  for (const c of lista) if (!status.some((e) => e.caminho === c || e.caminho.startsWith(c.replace(/\/$/, "") + "/"))) itens.push({ caminho: c, acao: "ignorado", motivo: "sem mudanças" });

  const base = incluirStaged && (await temCommits(raiz, op)) ? ["HEAD"] : [];
  const nums = await contarLinhas(raiz, restaurar.map((e) => e.caminho), base, op);
  for (const it of itens) {
    const n = nums.get(it.caminho);
    if (it.acao === "restaurar" && n) {
      it.insercoes = n.i;
      it.delecoes = n.d;
    }
  }
  const naLixeira = [...lixeira, ...novosNoIndice].map((e) => e.caminho);
  if (simular) return { simulado: true, itens, idDesfazer: null, naLixeira };

  if (naLixeira.length > 0 && typeof moverParaLixeira !== "function") throw new GitErro("Sem lixeira disponível: arquivo não rastreado não será apagado.");
  let id: string | null = null;
  const tocados = [...restaurar, ...novosNoIndice];
  if (tocados.length > 0) {
    id = novoId();
    const pasta = join(pastaSeguranca, id);
    const guardados: Array<{ caminho: string; tinhaArquivo: boolean }> = [];
    for (const e of tocados) {
      const origem = dentroDe(raiz, e.caminho);
      const existe = await stat(origem).then((s) => s.isFile(), () => false);
      if (existe) {
        const destino = join(pasta, "arquivos", e.caminho);
        await mkdir(dirname(destino), { recursive: true });
        await copyFile(origem, destino);
      }
      guardados.push({ caminho: e.caminho, tinhaArquivo: existe });
    }
    await writeFile(join(pasta, "manifest.json"), JSON.stringify({ id, raiz: resolve(raiz), criadoEm: new Date().toISOString(), arquivos: guardados, desfeito: false }, null, 2));
  }
  if (restaurar.length > 0) {
    const alvos = restaurar.map((e) => e.caminho);
    await escrita(raiz, incluirStaged ? ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...alvos] : ["restore", "--worktree", "--", ...alvos], { ...op, env: LITERAL });
  }
  if (novosNoIndice.length > 0) await escrita(raiz, ["rm", "--cached", "-q", "--", ...novosNoIndice.map((e) => e.caminho)], { ...op, env: LITERAL });
  for (const e of [...lixeira, ...novosNoIndice]) {
    const abs = dentroDe(raiz, e.caminho);
    if (await stat(abs).then(() => true, () => false)) await moverParaLixeira(abs);
  }
  return { simulado: false, itens, idDesfazer: id, naLixeira };
}

export interface OpcoesDesfazer extends OpcoesBase {
  pastaSeguranca: string;
  /** Sobrescreve arquivos que mudaram depois do descarte (padrão false: devolve `conflitos`). */
  sobrescrever?: boolean;
}

export interface ResultadoDesfazer {
  restaurados: string[];
  /** Arquivos que mudaram depois do descarte; nada foi tocado. */
  conflitos: string[];
  /** Descarte de arquivo que só foi apagado na árvore: o conteúdo continua no git, nada a devolver. */
  semConteudo: string[];
}

interface Manifesto {
  id: string;
  raiz: string;
  criadoEm: string;
  arquivos: Array<{ caminho: string; tinhaArquivo: boolean }>;
  desfeito: boolean;
}

async function lerManifesto(pastaSeguranca: string, id: string): Promise<Manifesto> {
  if (!/^[0-9a-z-]+$/.test(id)) throw new NomeInvalidoErro(id);
  try {
    return JSON.parse(await readFile(join(pastaSeguranca, id, "manifest.json"), "utf8")) as Manifesto;
  } catch {
    throw new GitErro(`Cópia de segurança não encontrada: ${id}`);
  }
}

/** Devolve à árvore de trabalho o que `descartar` guardou. Tudo ou nada: com conflito, não toca em nada. */
export async function desfazerDescarte(raiz: string, id: string, opcoes: OpcoesDesfazer): Promise<ResultadoDesfazer> {
  const { pastaSeguranca, sobrescrever = false, ...op } = opcoes;
  const man = await lerManifesto(pastaSeguranca, id);
  if (man.raiz !== resolve(raiz)) throw new GitErro("Esta cópia de segurança é de outro repositório.");
  if (man.desfeito) throw new GitErro("Este descarte já foi desfeito.");
  const comConteudo = man.arquivos.filter((a) => a.tinhaArquivo);
  const semConteudo = man.arquivos.filter((a) => !a.tinhaArquivo).map((a) => a.caminho);
  const conflitos: string[] = [];
  if (!sobrescrever && comConteudo.length > 0) {
    const st = await statusDe(raiz, comConteudo.map((a) => a.caminho), op);
    for (const e of st) if (e.y !== " " || e.x === "?") conflitos.push(e.caminho);
  }
  if (conflitos.length > 0) return { restaurados: [], conflitos, semConteudo };
  const restaurados: string[] = [];
  for (const a of comConteudo) {
    const destino = dentroDe(raiz, a.caminho);
    await mkdir(dirname(destino), { recursive: true });
    await copyFile(join(pastaSeguranca, id, "arquivos", a.caminho), destino);
    restaurados.push(a.caminho);
  }
  await writeFile(join(pastaSeguranca, id, "manifest.json"), JSON.stringify({ ...man, desfeito: true }, null, 2));
  return { restaurados, conflitos: [], semConteudo };
}

/** Cópias de segurança deste repositório (mais recente primeiro). */
export async function listarDescartes(raiz: string, pastaSeguranca: string): Promise<Array<{ id: string; criadoEm: string; arquivos: string[]; desfeito: boolean }>> {
  const nomes = await readdir(pastaSeguranca).catch(() => [] as string[]);
  const saida: Array<{ id: string; criadoEm: string; arquivos: string[]; desfeito: boolean }> = [];
  for (const n of nomes) {
    const m = await lerManifesto(pastaSeguranca, n).catch(() => null);
    if (m !== null && m.raiz === resolve(raiz)) saida.push({ id: m.id, criadoEm: m.criadoEm, arquivos: m.arquivos.map((a) => a.caminho), desfeito: m.desfeito });
  }
  return saida.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}
