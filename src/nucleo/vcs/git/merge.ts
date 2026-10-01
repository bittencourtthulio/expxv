import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArvoreSujaErro, GitErro } from "../../git/erros";
import { escrita, resolverRev, rodarGit, type OpcoesBase } from "./comum";
import { guardaAutomacao, OperacaoRecusadaErro, type OrigemOperacao } from "./guardas";
import { FORMATO_LOG, parseLog, type CommitLog } from "./log";

// T-06.13 · Merge, rebase, cherry-pick, revert: executar, ESTADO da operação em curso, continuar/abortar/pular e
// rebase interativo SEM editor (todo gerado pelo app). Nada de `reset --hard`: abortar usa o `--abort` do próprio git,
// que restaura HEAD, índice e árvore ao estado anterior. A automação nunca opera na branch padrão.

export type Operacao = "merge" | "rebase" | "cherry-pick" | "revert";

export interface EstadoOperacao {
  operacao: Operacao | null;
  /** Rebase/cherry-pick/revert em sequência: passo atual e total. */
  passo?: number;
  total?: number;
  /** Rebase: branch sendo reaplicada. */
  ramo?: string | null;
  interativo?: boolean;
  /** Commit sendo aplicado (MERGE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD ou o do passo parado). */
  cabeca?: string;
  /** `conflito`: há arquivos não mesclados; `parado`: parou sem conflito (edit, commit vazio…). */
  parado?: "conflito" | "parado" | null;
  /** Caminhos com conflito (únicos). */
  conflitos: string[];
}

export type AcaoRebase = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";
export interface PassoRebase {
  acao: AcaoRebase;
  /** Hash (completo ou prefixo de 7+) de um commit de `base..HEAD`. */
  hash: string;
  /** Obrigatória em `reword`. */
  mensagem?: string;
}

export interface AvisoConflito {
  tipo: string;
  caminho: string;
  texto: string;
}

export interface ResultadoOperacao {
  resultado: "ok" | "ja-atualizado" | "conflito" | "parado" | "simulado";
  hash: string | null;
  conflitos: string[];
  estado: EstadoOperacao;
  avisos: AvisoConflito[];
  /** `simular`: commits que seriam aplicados / (merge) conflitos previstos / (rebase interativo) descartados. */
  commits?: CommitLog[];
  conflitosPrevistos?: string[];
  descartados?: CommitLog[];
  avisosTexto?: string[];
  saida: string;
}

const EDITOR_NULO = { GIT_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no", GIT_SEQUENCER_EDITOR: "true" } as const;

// ---- estado -----------------------------------------------------------------------------------

async function lerTexto(caminho: string): Promise<string | null> {
  return readFile(caminho, "utf8").then((t) => t.trim(), () => null);
}

/** `ls-files -u -z`: entradas não mescladas (`modo oid estagio\tcaminho`). */
export async function entradasNaoMescladas(raiz: string, op: OpcoesBase = {}): Promise<Array<{ modo: string; oid: string; estagio: 1 | 2 | 3; caminho: string }>> {
  const r = await rodarGit(raiz, ["ls-files", "-u", "-z"], op);
  const out: Array<{ modo: string; oid: string; estagio: 1 | 2 | 3; caminho: string }> = [];
  for (const reg of r.stdout.split("\0")) {
    const m = /^(\d+) ([0-9a-f]+) ([123])\t([\s\S]+)$/.exec(reg);
    if (m) out.push({ modo: m[1] as string, oid: m[2] as string, estagio: Number(m[3]) as 1 | 2 | 3, caminho: m[4] as string });
  }
  return out;
}

export async function dirGit(raiz: string, op: OpcoesBase = {}): Promise<string> {
  const r = await rodarGit(raiz, ["rev-parse", "--absolute-git-dir"], op);
  return r.stdout.trim();
}

const existe = async (p: string): Promise<boolean> => (await lerTexto(p)) !== null;

export async function estadoOperacao(raiz: string, op: OpcoesBase = {}): Promise<EstadoOperacao> {
  const gd = await dirGit(raiz, op);
  const conflitos = [...new Set((await entradasNaoMescladas(raiz, op)).map((e) => e.caminho))];
  const parado: EstadoOperacao["parado"] = conflitos.length > 0 ? "conflito" : "parado";
  const rm = join(gd, "rebase-merge");
  const ra = join(gd, "rebase-apply");
  const [msgnum, fim, headName, interativo] = await Promise.all([lerTexto(join(rm, "msgnum")), lerTexto(join(rm, "end")), lerTexto(join(rm, "head-name")), lerTexto(join(rm, "interactive"))]);
  if (msgnum !== null || fim !== null || headName !== null || interativo !== null) {
    const parada = await lerTexto(join(rm, "stopped-sha"));
    return {
      operacao: "rebase", passo: Number(msgnum ?? 0) || 0, total: Number(fim ?? 0) || 0, ramo: headName?.replace(/^refs\/heads\//, "") ?? null,
      interativo: interativo !== null, ...(parada ? { cabeca: parada } : {}), parado, conflitos,
    };
  }
  const [prox, ultimo, headApply] = await Promise.all([lerTexto(join(ra, "next")), lerTexto(join(ra, "last")), lerTexto(join(ra, "head-name"))]);
  if (prox !== null || ultimo !== null) {
    return { operacao: "rebase", passo: Number(prox ?? 0) || 0, total: Number(ultimo ?? 0) || 0, ramo: headApply?.replace(/^refs\/heads\//, "") ?? null, interativo: false, parado, conflitos };
  }
  const [mh, cp, rv, todo] = await Promise.all([lerTexto(join(gd, "MERGE_HEAD")), lerTexto(join(gd, "CHERRY_PICK_HEAD")), lerTexto(join(gd, "REVERT_HEAD")), lerTexto(join(gd, "sequencer", "todo"))]);
  const restantes = todo === null ? 0 : todo.split("\n").filter((l) => /^(pick|revert|p|r) /.test(l)).length;
  const seq = todo === null ? null : /^(revert|r) /m.test(todo) ? "revert" : "cherry-pick";
  if (mh !== null) return { operacao: "merge", cabeca: mh.split("\n")[0] as string, parado, conflitos };
  if (cp !== null) return { operacao: "cherry-pick", cabeca: cp, parado, conflitos, ...(restantes > 0 ? { total: restantes + 1, passo: 1 } : {}) };
  if (rv !== null) return { operacao: "revert", cabeca: rv, parado, conflitos, ...(restantes > 0 ? { total: restantes + 1, passo: 1 } : {}) };
  if (seq !== null && restantes > 0) return { operacao: seq, parado: conflitos.length > 0 ? "conflito" : "parado", conflitos, total: restantes, passo: 0 };
  return { operacao: null, conflitos };
}

// ---- execução -----------------------------------------------------------------------------------

/** Linhas `CONFLICT (tipo): ... ` da saída do git, para explicar renomeação/exclusão/binário com opções. */
export function avisosDaSaida(saida: string): AvisoConflito[] {
  const out: AvisoConflito[] = [];
  for (const l of saida.split("\n")) {
    const m = /^CONFLICT \(([^)]+)\): (.*)$/.exec(l.trim());
    if (!m) continue;
    const texto = m[2] as string;
    const c = /(?:in|for|of|file) ([^\s]+?)(?:\.|,| deleted| left| renamed|$)/.exec(texto) ?? /Merge conflict in (.+)$/.exec(texto);
    out.push({ tipo: m[1] as string, caminho: c?.[1] ?? "", texto });
  }
  return out;
}

async function concluir(raiz: string, args: readonly string[], op: OpcoesBase & { env?: Record<string, string>; timeoutMs?: number }, antes: string | null): Promise<ResultadoOperacao> {
  const r = await escrita(raiz, args, { ...op, env: { ...EDITOR_NULO, ...(op.env ?? {}) }, timeoutMs: op.timeoutMs ?? 300_000, tolerar: Array.from({ length: 255 }, (_, i) => i + 1) });
  const estado = await estadoOperacao(raiz, op);
  const saida = `${r.stdout}${r.stderr}`;
  const head = await rodarGit(raiz, ["rev-parse", "--verify", "--quiet", "HEAD"], { ...op, tolerar: [1, 128] });
  const hash = head.codigo === 0 ? head.stdout.trim() : null;
  const avisos = avisosDaSaida(saida);
  if (r.codigo === 0 && estado.operacao === null) return { resultado: antes === hash || /Already up to date|up to date/i.test(r.stdout) ? "ja-atualizado" : "ok", hash, conflitos: [], estado, avisos, saida };
  if (r.codigo === 0 && estado.operacao !== null) return { resultado: "parado", hash, conflitos: estado.conflitos, estado, avisos, saida };
  if (estado.operacao !== null) return { resultado: estado.conflitos.length > 0 ? "conflito" : "parado", hash, conflitos: estado.conflitos, estado, avisos, saida };
  if (/would be overwritten|Please commit your changes or stash|local changes/i.test(saida)) throw new ArvoreSujaErro(raiz);
  throw new GitErro(`git ${args[0] ?? ""} falhou (${r.codigo}): ${r.stderr.trim().split("\n")[0] ?? ""}`, args, r.codigo, r.stderr);
}

async function headAtual(raiz: string, op: OpcoesBase): Promise<string | null> {
  const r = await rodarGit(raiz, ["rev-parse", "--verify", "--quiet", "HEAD"], { ...op, tolerar: [1, 128] });
  return r.codigo === 0 ? r.stdout.trim() : null;
}

async function exigirLivre(raiz: string, op: OpcoesBase): Promise<void> {
  const e = await estadoOperacao(raiz, op);
  if (e.operacao !== null) throw new OperacaoRecusadaErro(`Já existe um ${e.operacao} em andamento; conclua ou aborte antes.`, "operacao-em-curso", [e.operacao]);
}

async function listarCommits(raiz: string, faixa: string[], op: OpcoesBase): Promise<CommitLog[]> {
  const r = await rodarGit(raiz, ["log", FORMATO_LOG, ...faixa, "--"], { ...op, tolerar: [128] });
  return r.codigo === 0 ? parseLog(r.stdout) : [];
}

export interface OpcoesOperacao extends OpcoesBase {
  origem: OrigemOperacao;
  /** Não altera nada: devolve o que entraria (e, no merge, os conflitos previstos). */
  simular?: boolean;
  timeoutMs?: number;
}

/** Merge de `rev` na branch atual. */
export async function mesclar(raiz: string, opcoes: OpcoesOperacao & { rev: string; semFastForward?: boolean; squash?: boolean; mensagem?: string }): Promise<ResultadoOperacao> {
  const { rev, semFastForward, squash, mensagem, origem, simular, timeoutMs, ...op } = opcoes;
  await guardaAutomacao(raiz, origem, "merge", op);
  await exigirLivre(raiz, op);
  const alvo = await resolverRev(raiz, rev, op);
  const antes = await headAtual(raiz, op);
  if (mensagem !== undefined && (mensagem.includes("\0") || mensagem.trim() === "")) throw new GitErro("Mensagem de merge inválida.");
  if (simular === true) {
    const commits = await listarCommits(raiz, [`HEAD..${alvo}`], op);
    const mt = await rodarGit(raiz, ["merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", alvo], { ...op, tolerar: [1, 128] });
    const prev = mt.codigo === 1 ? mt.stdout.split("\n").slice(1).filter((l) => l.trim() !== "" ) : [];
    return { resultado: "simulado", hash: antes, conflitos: [], estado: { operacao: null, conflitos: [] }, avisos: [], commits, conflitosPrevistos: [...new Set(prev)], saida: "" };
  }
  const args = ["merge", "--no-edit", ...(semFastForward === true ? ["--no-ff"] : []), ...(squash === true ? ["--squash"] : []), ...(mensagem === undefined ? [] : ["-m", mensagem]), rev];
  return concluir(raiz, args, { ...op, ...(timeoutMs ? { timeoutMs } : {}) }, antes);
}

/** Cherry-pick de um ou mais commits (na ordem dada). `mainline` para commits de merge. */
export async function cherryPick(raiz: string, opcoes: OpcoesOperacao & { revs: readonly string[]; mainline?: number }): Promise<ResultadoOperacao> {
  const { revs, mainline, origem, simular, timeoutMs, ...op } = opcoes;
  await guardaAutomacao(raiz, origem, "cherry-pick", op);
  await exigirLivre(raiz, op);
  if (revs.length === 0) throw new GitErro("Informe ao menos um commit.");
  const hashes: string[] = [];
  for (const r of revs) hashes.push(await resolverRev(raiz, r, op));
  const antes = await headAtual(raiz, op);
  if (simular === true) {
    const commits: CommitLog[] = [];
    for (const h of hashes) commits.push(...(await listarCommits(raiz, ["-n1", h], op)));
    return { resultado: "simulado", hash: antes, conflitos: [], estado: { operacao: null, conflitos: [] }, avisos: [], commits, saida: "" };
  }
  const m = mainline === undefined ? [] : ["-m", String(Math.max(1, Math.floor(mainline)))];
  return concluir(raiz, ["cherry-pick", ...m, ...hashes], { ...op, ...(timeoutMs ? { timeoutMs } : {}) }, antes);
}

/** Revert de um ou mais commits (cria commits novos; não reescreve histórico). */
export async function reverter(raiz: string, opcoes: OpcoesOperacao & { revs: readonly string[]; mainline?: number }): Promise<ResultadoOperacao> {
  const { revs, mainline, origem, simular, timeoutMs, ...op } = opcoes;
  await guardaAutomacao(raiz, origem, "revert", op);
  await exigirLivre(raiz, op);
  if (revs.length === 0) throw new GitErro("Informe ao menos um commit.");
  const hashes: string[] = [];
  for (const r of revs) hashes.push(await resolverRev(raiz, r, op));
  const antes = await headAtual(raiz, op);
  if (simular === true) {
    const commits: CommitLog[] = [];
    for (const h of hashes) commits.push(...(await listarCommits(raiz, ["-n1", h], op)));
    return { resultado: "simulado", hash: antes, conflitos: [], estado: { operacao: null, conflitos: [] }, avisos: [], commits, saida: "" };
  }
  const m = mainline === undefined ? [] : ["-m", String(Math.max(1, Math.floor(mainline)))];
  return concluir(raiz, ["revert", "--no-edit", ...m, ...hashes], { ...op, ...(timeoutMs ? { timeoutMs } : {}) }, antes);
}

/** Rebase (não interativo) da branch atual sobre `base`. */
export async function rebase(raiz: string, opcoes: OpcoesOperacao & { base: string }): Promise<ResultadoOperacao> {
  const { base, origem, simular, timeoutMs, ...op } = opcoes;
  await guardaAutomacao(raiz, origem, "rebase", op);
  await exigirLivre(raiz, op);
  const alvo = await resolverRev(raiz, base, op);
  const antes = await headAtual(raiz, op);
  if (simular === true) {
    const commits = await listarCommits(raiz, [`${alvo}..HEAD`], op);
    return { resultado: "simulado", hash: antes, conflitos: [], estado: { operacao: null, conflitos: [] }, avisos: [], commits, saida: "" };
  }
  return concluir(raiz, ["rebase", alvo], { ...op, ...(timeoutMs ? { timeoutMs } : {}) }, antes);
}

// ---- continuar / abortar / pular -------------------------------------------------------------------

async function seguir(raiz: string, verbo: "--continue" | "--abort" | "--skip", op: OpcoesBase & { timeoutMs?: number }): Promise<ResultadoOperacao> {
  const e = await estadoOperacao(raiz, op);
  if (e.operacao === null) throw new OperacaoRecusadaErro("Nenhuma operação em andamento.", "sem-operacao");
  if (verbo === "--skip" && e.operacao === "merge") throw new OperacaoRecusadaErro("Merge não tem 'pular': aborte ou resolva.", "sem-operacao");
  if (verbo === "--continue" && e.conflitos.length > 0) throw new OperacaoRecusadaErro(`Ainda há ${e.conflitos.length} arquivo(s) em conflito.`, "conflitos-pendentes", e.conflitos);
  const antes = await headAtual(raiz, op);
  const r = await concluir(raiz, [e.operacao, verbo], op, antes);
  if (r.estado.operacao === null) await limparTemporarios(raiz, op);
  return r;
}

export const continuar = (raiz: string, op: OpcoesBase & { timeoutMs?: number } = {}): Promise<ResultadoOperacao> => seguir(raiz, "--continue", op);
/** Restaura HEAD, índice e árvore ao estado de antes da operação (o `--abort` do git; nenhum `reset --hard` nosso). */
export const abortar = (raiz: string, op: OpcoesBase & { timeoutMs?: number } = {}): Promise<ResultadoOperacao> => seguir(raiz, "--abort", op);
export const pular = (raiz: string, op: OpcoesBase & { timeoutMs?: number } = {}): Promise<ResultadoOperacao> => seguir(raiz, "--skip", op);

// ---- rebase interativo sem editor ------------------------------------------------------------------

const aspas = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const ACOES = new Set<AcaoRebase>(["pick", "reword", "edit", "squash", "fixup", "drop"]);

/** Commits de `base..HEAD` que já estão em alguma remota/`@{upstream}`. */
export async function commitsPublicados(raiz: string, base: string, op: OpcoesBase = {}): Promise<string[]> {
  const todos = (await rodarGit(raiz, ["rev-list", `${base}..HEAD`], op)).stdout.split("\n").filter((x) => x !== "");
  if (todos.length === 0) return [];
  const up = await rodarGit(raiz, ["rev-parse", "--verify", "--quiet", "@{upstream}"], { ...op, tolerar: [1, 128] });
  const nao = await rodarGit(raiz, ["rev-list", "HEAD", "--not", base, "--remotes", ...(up.codigo === 0 ? ["@{upstream}"] : [])], op);
  const naoPub = new Set(nao.stdout.split("\n").filter((x) => x !== ""));
  return todos.filter((h) => !naoPub.has(h));
}

const ARQ_TMP = "ade-rebase-tmp";

/** Apaga a pasta temporária do rebase interativo quando não há mais operação em curso. */
export async function limparTemporarios(raiz: string, op: OpcoesBase = {}): Promise<void> {
  const gd = await dirGit(raiz, op);
  const marca = join(gd, ARQ_TMP);
  const pasta = await lerTexto(marca);
  if (pasta === null) return;
  if ((await estadoOperacao(raiz, op)).operacao !== null) return;
  if (pasta.startsWith(tmpdir()) && /ade-rebase-/.test(pasta)) await rm(pasta, { recursive: true, force: true });
  await rm(marca, { force: true });
}

/**
 * Rebase interativo a partir de uma lista estruturada: o `todo` é gerado pelo app (nenhum editor abre). `reword` vira
 * `pick` + `exec git commit --amend -F <arquivo>`; `squash` mantém a mensagem combinada. Só para commits NÃO publicados
 * (recusa se algum está em remota/upstream, salvo `forcar: true`, que devolve aviso). Aceita reordenar.
 */
export async function rebaseInterativo(raiz: string, opcoes: OpcoesOperacao & { base: string; passos: readonly PassoRebase[]; forcar?: boolean }): Promise<ResultadoOperacao> {
  const { base, passos, forcar, origem, simular, timeoutMs, ...op } = opcoes;
  await guardaAutomacao(raiz, origem, "rebase", op);
  await exigirLivre(raiz, op);
  const alvo = await resolverRev(raiz, base, op);
  const commits = (await rodarGit(raiz, ["rev-list", "--reverse", "--topo-order", `${alvo}..HEAD`], op)).stdout.split("\n").filter((x) => x !== "");
  if ((await rodarGit(raiz, ["rev-list", "--merges", "-n1", `${alvo}..HEAD`], op)).stdout.trim() !== "") throw new OperacaoRecusadaErro("Há commits de merge no intervalo; rebase interativo só aceita histórico linear.", "passos-invalidos");
  if (commits.length === 0) throw new OperacaoRecusadaErro("Não há commits entre a base e HEAD.", "passos-invalidos");
  const norm: Array<PassoRebase & { completo: string }> = [];
  for (const p of passos) {
    if (!ACOES.has(p.acao) || typeof p.hash !== "string" || !/^[0-9a-f]{7,64}$/i.test(p.hash)) throw new OperacaoRecusadaErro("Passo de rebase inválido.", "passos-invalidos", [String(p.hash)]);
    const achados = commits.filter((c) => c.startsWith(p.hash.toLowerCase()));
    if (achados.length !== 1) throw new OperacaoRecusadaErro(`Commit fora do intervalo ou ambíguo: ${p.hash}`, "passos-invalidos", [p.hash]);
    if (p.acao === "reword" && (typeof p.mensagem !== "string" || p.mensagem.trim() === "" || p.mensagem.includes("\0"))) throw new OperacaoRecusadaErro("`reword` exige a nova mensagem.", "passos-invalidos", [p.hash]);
    norm.push({ ...p, completo: achados[0] as string });
  }
  if (new Set(norm.map((p) => p.completo)).size !== commits.length || norm.length !== commits.length) throw new OperacaoRecusadaErro("A lista de passos deve conter cada commit de base..HEAD exatamente uma vez (use `drop` para descartar).", "passos-invalidos");
  const primeiro = norm.find((p) => p.acao !== "drop");
  if (primeiro === undefined) throw new OperacaoRecusadaErro("Todos os commits foram descartados.", "passos-invalidos");
  if (primeiro.acao === "squash" || primeiro.acao === "fixup") throw new OperacaoRecusadaErro("O primeiro commit mantido não pode ser squash/fixup.", "passos-invalidos");

  const pub = await commitsPublicados(raiz, alvo, op);
  const avisosTexto: string[] = [];
  if (pub.length > 0) {
    if (forcar !== true) throw new OperacaoRecusadaErro(`${pub.length} commit(s) já estão publicados (remota/upstream); reescrevê-los exige push forçado depois. Use forcar para prosseguir.`, "publicado", pub);
    avisosTexto.push(`Reescrevendo ${pub.length} commit(s) já publicados: o próximo envio exigirá sobrescrever o remoto (ação manual com confirmação).`);
  }
  const antes = await headAtual(raiz, op);
  if (simular === true) {
    const descartados: CommitLog[] = [];
    for (const p of norm.filter((x) => x.acao === "drop")) descartados.push(...(await listarCommits(raiz, ["-n1", p.completo], op)));
    return { resultado: "simulado", hash: antes, conflitos: [], estado: { operacao: null, conflitos: [] }, avisos: [], commits: await listarCommits(raiz, [`${alvo}..HEAD`], op), descartados, avisosTexto, saida: "" };
  }

  const pasta = await mkdtemp(join(tmpdir(), "ade-rebase-"));
  let mantida = false;
  try {
    const linhas: string[] = [];
    for (const [i, p] of norm.entries()) {
      if (p.acao === "reword") {
        const arq = join(pasta, `msg-${i}`);
        await writeFile(arq, (p.mensagem as string).replace(/\s+$/, "") + "\n");
        linhas.push(`pick ${p.completo}`, `exec git commit --amend -q -F ${aspas(arq)}`);
      } else linhas.push(`${p.acao} ${p.completo}`);
    }
    const todo = join(pasta, "todo");
    await writeFile(todo, linhas.join("\n") + "\n");
    const editor = join(pasta, "editor.sh");
    await writeFile(editor, `#!/bin/sh\ncp ${aspas(todo)} "$1"\n`, { mode: 0o755 });
    const gd = await dirGit(raiz, op);
    await writeFile(join(gd, ARQ_TMP), pasta);
    const r = await concluir(raiz, ["rebase", "-i", "--no-autosquash", alvo], { ...op, ...(timeoutMs ? { timeoutMs } : {}), env: { GIT_SEQUENCE_EDITOR: aspas(editor) } }, antes);
    mantida = r.estado.operacao !== null;
    return { ...r, ...(avisosTexto.length ? { avisosTexto } : {}) };
  } finally {
    if (!mantida) {
      await limparTemporarios(raiz, op).catch(() => undefined);
      await rm(pasta, { recursive: true, force: true });
    }
  }
}
