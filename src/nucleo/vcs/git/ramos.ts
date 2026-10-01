import { GitErro, NomeInvalidoErro } from "../../git/erros";
import type { Ramo } from "../vcs";
import { escrita, ramoAtual, resolverRev, rodarGit, validarNomeRef, type OpcoesBase } from "./comum";
import { criarStash, popStash } from "./stash";

// T-06.09 · Branches e tags (local). Nada aqui faz push, `--force` nem apaga branch remota.
// Trocar nunca perde mudanças: o git recusa sobrescrever; oferecemos `levar` (stash + switch + pop),
// `stash` (guarda e troca) ou `cancelar`. Apagar branch não mesclada exige `forcar: true` e mostra os commits órfãos antes.

export interface CommitResumo {
  hash: string;
  assunto: string;
  autor: string;
  data: string;
}

export interface RamoDetalhe extends Ramo {
  /** Nome completo da ref (`refs/heads/x` / `refs/remotes/o/x`). */
  ref: string;
  /** O upstream configurado não existe mais no remoto. */
  upstreamSumiu: boolean;
  ultimoCommit: CommitResumo;
}

const SEP = "\x1f";
const FORMATO = ["%(HEAD)", "%(refname)", "%(objectname)", "%(upstream:short)", "%(upstream:track,nobracket)", "%(symref)", "%(authorname)", "%(authordate:iso-strict)", "%(subject)"].join("%00") + "%0a";

/** Interpreta `ahead N, behind M` / `gone` do `%(upstream:track,nobracket)`. */
export function parseTrack(t: string): { ahead: number; behind: number; sumiu: boolean } {
  return { ahead: Number(/ahead (\d+)/.exec(t)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(t)?.[1] ?? 0), sumiu: /gone/.test(t) };
}

export async function listarRamos(raiz: string, opcoes: OpcoesBase & { remotos?: boolean } = {}): Promise<RamoDetalhe[]> {
  const { remotos = true, ...op } = opcoes;
  const r = await rodarGit(raiz, ["for-each-ref", `--format=${FORMATO}`, "refs/heads", ...(remotos ? ["refs/remotes"] : [])], op);
  const lista: RamoDetalhe[] = [];
  for (const linha of r.stdout.split("\n")) {
    if (linha === "") continue;
    const [head, ref, hash, up, track, symref, autor, data, assunto] = linha.split("\0");
    if (ref === undefined || hash === undefined || symref) continue; // origin/HEAD é símbolo
    const remoto = ref.startsWith("refs/remotes/");
    const t = parseTrack(track ?? "");
    lista.push({
      nome: ref.replace(/^refs\/(heads|remotes)\//, ""),
      ref,
      atual: head === "*",
      remoto,
      upstream: up ? up : null,
      ahead: t.ahead,
      behind: t.behind,
      upstreamSumiu: t.sumiu,
      hash,
      ultimoCommit: { hash, assunto: assunto ?? "", autor: autor ?? "", data: data ?? "" },
    });
  }
  return lista;
}

// ---- branch padrão ---------------------------------------------------------------------------

/** Candidatos a "branch padrão" (origin/HEAD, `init.defaultBranch`, main, master). */
export async function candidatosRamoPadrao(raiz: string, op: OpcoesBase = {}): Promise<string[]> {
  const out = new Set<string>();
  const oh = await rodarGit(raiz, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"], { ...op, tolerar: [1, 128] });
  const alvo = oh.stdout.trim();
  if (oh.codigo === 0 && alvo.startsWith("origin/")) out.add(alvo.slice(7));
  const cfg = await rodarGit(raiz, ["config", "--get", "init.defaultBranch"], { ...op, tolerar: [1] });
  if (cfg.codigo === 0 && cfg.stdout.trim() !== "") out.add(cfg.stdout.trim());
  out.add("main");
  out.add("master");
  return [...out];
}

/** A branch é uma das candidatas a padrão? (usado pela guarda de commit da automação). */
export async function ehRamoPadrao(raiz: string, nome: string, op: OpcoesBase = {}): Promise<boolean> {
  return (await candidatosRamoPadrao(raiz, op)).includes(nome);
}

/** Branch padrão mais provável que EXISTE: `origin/HEAD`, depois `init.defaultBranch`, `main`, `master`. null se nenhuma. */
export async function ramoPadrao(raiz: string, op: OpcoesBase = {}): Promise<string | null> {
  const oh = await rodarGit(raiz, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"], { ...op, tolerar: [1, 128] });
  const alvo = oh.stdout.trim();
  if (oh.codigo === 0 && alvo.startsWith("origin/")) return alvo.slice(7);
  for (const c of await candidatosRamoPadrao(raiz, op)) {
    const e = await rodarGit(raiz, ["show-ref", "--verify", "--quiet", `refs/heads/${c}`], { ...op, tolerar: [1] });
    if (e.codigo === 0) return c;
  }
  return null;
}

// ---- criar / renomear / apagar / upstream ----------------------------------------------------

export async function criarRamo(raiz: string, nome: string, opcoes: OpcoesBase & { de?: string; trocar?: boolean } = {}): Promise<{ nome: string; hash: string }> {
  const { de, trocar, ...op } = opcoes;
  await validarNomeRef(raiz, nome, "heads", op);
  const hash = de === undefined ? await resolverRev(raiz, "HEAD", op) : await resolverRev(raiz, de, op);
  await escrita(raiz, ["branch", nome, de ?? hash], op);
  if (trocar) await escrita(raiz, ["switch", nome], op);
  return { nome, hash };
}

export async function renomearRamo(raiz: string, de: string, para: string, op: OpcoesBase = {}): Promise<void> {
  await validarNomeRef(raiz, de, "heads", op);
  await validarNomeRef(raiz, para, "heads", op);
  await escrita(raiz, ["branch", "-m", de, para], op); // `-m` (nunca `-M`): não sobrescreve outra branch
}

export interface ResultadoApagarRamo {
  apagado: boolean;
  simulado: boolean;
  /** Commits que ficariam sem nenhuma outra ref (órfãos). */
  orfaos: CommitResumo[];
  /** Há órfãos e `forcar` não foi passado: nada foi feito. */
  requerForcar: boolean;
  /** Ponta da branch antes de apagar (para `criarRamo(nome, { de: hash })`). */
  hashAnterior: string;
}

/** Commits alcançáveis só por `nome` (nenhuma outra branch, tag, remota ou HEAD os alcança). */
export async function commitsOrfaos(raiz: string, nome: string, op: OpcoesBase = {}): Promise<CommitResumo[]> {
  const r = await rodarGit(raiz, ["log", "--max-count=500", "--format=%H%x1f%s%x1f%an%x1f%aI%x1e", `refs/heads/${nome}`, "--not", `--exclude=refs/heads/${nome}`, "--all"], op);
  return r.stdout
    .split("\x1e")
    .map((x) => x.replace(/^\n/, ""))
    .filter((x) => x !== "")
    .map((x) => {
      const [hash, assunto, autor, data] = x.split(SEP);
      return { hash: hash ?? "", assunto: assunto ?? "", autor: autor ?? "", data: data ?? "" };
    });
}

/**
 * Apaga branch LOCAL. `-d` seguro; se há commits órfãos exige `forcar: true` e devolve a lista ANTES de agir
 * (use `simular: true` para só ver). Nunca apaga a branch atual nem remota.
 */
export async function apagarRamo(raiz: string, nome: string, opcoes: OpcoesBase & { forcar?: boolean; simular?: boolean } = {}): Promise<ResultadoApagarRamo> {
  const { forcar = false, simular = false, ...op } = opcoes;
  await validarNomeRef(raiz, nome, "heads", op);
  const hashAnterior = (await rodarGit(raiz, ["rev-parse", "--verify", "--quiet", `refs/heads/${nome}`], { ...op, tolerar: [1] })).stdout.trim();
  if (hashAnterior === "") throw new GitErro(`Branch inexistente: ${nome}`);
  if ((await ramoAtual(raiz, op)) === nome) throw new GitErro(`Não é possível apagar a branch atual (${nome}); troque de branch antes.`);
  const orfaos = await commitsOrfaos(raiz, nome, op);
  const requerForcar = orfaos.length > 0 && !forcar;
  if (simular || requerForcar) return { apagado: false, simulado: simular, orfaos, requerForcar, hashAnterior };
  const d = await escrita(raiz, ["branch", "-d", nome], { ...op, tolerar: [1] });
  if (d.codigo !== 0) {
    // `-d` recusa "não mesclada no HEAD/upstream" mesmo sem órfãos (tudo alcançável por outra ref) ou quando `forcar` foi pedido.
    if (orfaos.length === 0 || forcar) await escrita(raiz, ["branch", "-D", nome], op);
    else throw new GitErro(`git branch -d falhou: ${d.stderr.trim().split("\n")[0] ?? ""}`);
  }
  return { apagado: true, simulado: false, orfaos, requerForcar: false, hashAnterior };
}

export async function definirUpstream(raiz: string, ramo: string, upstream: string, op: OpcoesBase = {}): Promise<void> {
  await validarNomeRef(raiz, ramo, "heads", op);
  if (typeof upstream !== "string" || upstream.startsWith("-") || /[\s\0"'`\\]|\.\./.test(upstream)) throw new NomeInvalidoErro(String(upstream));
  const e = await rodarGit(raiz, ["show-ref", "--verify", "--quiet", `refs/remotes/${upstream}`], { ...op, tolerar: [1] });
  const l = e.codigo === 0 ? e : await rodarGit(raiz, ["show-ref", "--verify", "--quiet", `refs/heads/${upstream}`], { ...op, tolerar: [1] });
  if (l.codigo !== 0) throw new GitErro(`Upstream inexistente: ${upstream}`);
  await escrita(raiz, ["branch", `--set-upstream-to=${upstream}`, ramo], op);
}

export async function removerUpstream(raiz: string, ramo: string, op: OpcoesBase = {}): Promise<void> {
  await validarNomeRef(raiz, ramo, "heads", op);
  await escrita(raiz, ["branch", "--unset-upstream", ramo], op);
}

// ---- trocar ----------------------------------------------------------------------------------

export type EstrategiaTroca = "cancelar" | "levar" | "stash";

export type ResultadoTrocar =
  | { trocou: true; de: string | null; para: string; levouMudancas: boolean; stashCriado: string | null; conflitoAoReaplicar: boolean; arquivos: string[] }
  | { trocou: false; conflito: true; arquivos: string[]; opcoes: readonly EstrategiaTroca[] };

/** Arquivos citados na recusa do git (`would be overwritten by checkout`). */
export function arquivosDaRecusa(stderr: string): string[] {
  const out: string[] = [];
  let dentro = false;
  for (const l of stderr.split("\n")) {
    if (/would be overwritten by (checkout|switch)|would be lost|untracked working tree files/.test(l)) dentro = true;
    else if (dentro && l.startsWith("\t")) out.push(l.trim());
    else if (dentro && /^(Please|Aborting|error:)/.test(l)) dentro = false;
  }
  return out;
}

/**
 * Troca de branch sem perder nada. Árvore suja sem conflito com o destino: o git leva as mudanças (levouMudancas).
 * Com conflito: `cancelar` (padrão) devolve `{ conflito: true, arquivos }`; `levar` = stash (com não rastreados),
 * troca e pop (se o pop conflitar o stash fica guardado); `stash` = guarda e troca, deixando o stash na lista.
 */
export async function trocarRamo(raiz: string, destino: string, opcoes: OpcoesBase & { estrategia?: EstrategiaTroca } = {}): Promise<ResultadoTrocar> {
  const { estrategia = "cancelar", ...op } = opcoes;
  if (typeof destino !== "string" || destino === "" || destino.startsWith("-") || /[\s\0"'`\\]|\.\./.test(destino)) throw new NomeInvalidoErro(String(destino));
  const local = (await rodarGit(raiz, ["show-ref", "--verify", "--quiet", `refs/heads/${destino}`], { ...op, tolerar: [1] })).codigo === 0;
  const remota = !local && (await rodarGit(raiz, ["show-ref", "--verify", "--quiet", `refs/remotes/${destino}`], { ...op, tolerar: [1] })).codigo === 0;
  if (!local && !remota) throw new GitErro(`Branch inexistente: ${destino}`);
  const de = await ramoAtual(raiz, op);
  const para = remota ? destino.slice(destino.indexOf("/") + 1) : destino;
  const args = remota ? ["switch", "--track", destino] : ["switch", destino];

  const tentar = await escrita(raiz, args, { ...op, tolerar: [1, 128] });
  if (tentar.codigo === 0) return { trocou: true, de, para, levouMudancas: false, stashCriado: null, conflitoAoReaplicar: false, arquivos: [] };
  const arquivos = arquivosDaRecusa(tentar.stderr);
  if (arquivos.length === 0) throw new GitErro(`git switch falhou: ${tentar.stderr.trim().split("\n")[0] ?? ""}`, args, tentar.codigo, tentar.stderr);
  if (estrategia === "cancelar") return { trocou: false, conflito: true, arquivos, opcoes: ["levar", "stash", "cancelar"] };

  const guardado = await criarStash(raiz, { naoRastreados: true, mensagem: `troca ${de ?? "(destacado)"} -> ${para}`, ...op });
  const r2 = await escrita(raiz, args, { ...op, tolerar: [1, 128] });
  if (r2.codigo !== 0) {
    // não trocou: devolve o trabalho para onde estava
    if (guardado.criado) await popStash(raiz, 0, op);
    throw new GitErro(`git switch falhou depois do stash; suas mudanças foram devolvidas: ${r2.stderr.trim().split("\n")[0] ?? ""}`, args, r2.codigo, r2.stderr);
  }
  if (estrategia === "stash" || !guardado.criado) return { trocou: true, de, para, levouMudancas: false, stashCriado: guardado.criado ? "stash@{0}" : null, conflitoAoReaplicar: false, arquivos: [] };
  const p = await popStash(raiz, 0, op);
  return { trocou: true, de, para, levouMudancas: p.aplicado, stashCriado: p.stashMantido ? "stash@{0}" : null, conflitoAoReaplicar: p.conflito, arquivos: p.arquivos };
}

// ---- tags ------------------------------------------------------------------------------------

export interface TagInfo {
  nome: string;
  /** `anotada` tem objeto de tag (mensagem, autor); `leve` aponta direto para o commit. */
  tipo: "leve" | "anotada";
  /** Commit apontado. */
  hash: string;
  mensagem: string | null;
  autor: string | null;
  data: string | null;
}

export async function listarTags(raiz: string, op: OpcoesBase = {}): Promise<TagInfo[]> {
  const fmt = ["%(refname:strip=2)", "%(objecttype)", "%(objectname)", "%(*objectname)", "%(contents:subject)", "%(taggername)", "%(creatordate:iso-strict)"].join("%00") + "%0a";
  const r = await rodarGit(raiz, ["for-each-ref", `--format=${fmt}`, "--sort=-creatordate", "refs/tags"], op);
  const lista: TagInfo[] = [];
  for (const l of r.stdout.split("\n")) {
    if (l === "") continue;
    const [nome, tipo, obj, alvo, assunto, autor, data] = l.split("\0");
    if (nome === undefined || obj === undefined) continue;
    const anotada = tipo === "tag";
    lista.push({ nome, tipo: anotada ? "anotada" : "leve", hash: anotada && alvo ? alvo : obj, mensagem: anotada ? assunto ?? "" : null, autor: anotada ? autor || null : null, data: data || null });
  }
  return lista;
}

/** Cria tag local. Com `mensagem` é anotada (mensagem por stdin); sem, leve. Assinatura herdada do `tag.gpgSign`. */
export async function criarTag(raiz: string, nome: string, opcoes: OpcoesBase & { de?: string; mensagem?: string } = {}): Promise<{ nome: string; hash: string; tipo: "leve" | "anotada" }> {
  const { de, mensagem, ...op } = opcoes;
  await validarNomeRef(raiz, nome, "tags", op);
  const hash = await resolverRev(raiz, de ?? "HEAD", op);
  if (mensagem !== undefined && mensagem.trim() !== "") {
    await escrita(raiz, ["tag", "-a", "-F", "-", nome, hash], { ...op, stdin: mensagem });
    return { nome, hash, tipo: "anotada" };
  }
  await escrita(raiz, ["tag", nome, hash], op);
  return { nome, hash, tipo: "leve" };
}

/** Apaga tag LOCAL (nunca a remota). Devolve o objeto anterior para recriar com `git tag nome <objeto>`. */
export async function apagarTag(raiz: string, nome: string, op: OpcoesBase = {}): Promise<{ objetoAnterior: string }> {
  await validarNomeRef(raiz, nome, "tags", op);
  const o = (await rodarGit(raiz, ["rev-parse", "--verify", "--quiet", `refs/tags/${nome}`], { ...op, tolerar: [1] })).stdout.trim();
  if (o === "") throw new GitErro(`Tag inexistente: ${nome}`);
  await escrita(raiz, ["tag", "-d", nome], op);
  return { objetoAnterior: o };
}
