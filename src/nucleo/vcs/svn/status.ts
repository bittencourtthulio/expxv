import { GitCanceladoErro } from "../../git/erros";
import { recontar } from "../git/status";
import type { DetalheSvn, LetraMudanca, Mudanca, OpcoesStatus, StatusRepo } from "../vcs";
import { caminhoWc, rodarSvn, rodarSvnRede, type OpcoesBaseSvn } from "./comum";
import { infoSvn, localAtual, type InfoSvn } from "./info";
import { documento, filho, filhosDe, type NoXml } from "./xml";

// T-06.24: `svn status --xml` (com `-u` opcional) -> o mesmo `StatusRepo` do git. SVN não tem índice:
// `indice` fica sempre ' ' e tudo é "não staged".

export const LIMITE_DEGRADAR_SVN_MS = 2000;
const SAIDA_STATUS_MAX = 128 * 1024 * 1024;
export const MAX_CAMINHOS_PARCIAL_SVN = 50;

const norm = (p: string): string => p.replace(/\\/g, "/");

function mudancaDe(e: NoXml, changelist?: string): Mudanca | null {
  const ws = filho(e, "wc-status");
  const caminho = norm(e.attrs.path ?? "");
  if (ws === undefined || caminho === "") return null;
  const item = ws.attrs.item ?? "normal";
  const props = ws.attrs.props;
  const rs = filho(ws, "repos-status") ?? filho(e, "repos-status");
  const det: DetalheSvn = {};
  if (props === "modified" || props === "conflicted") det.propriedades = props;
  if (filho(ws, "lock") !== undefined || rs?.attrs.lock !== undefined) det.bloqueado = true;
  if (changelist !== undefined) det.changelist = changelist;
  if (rs?.attrs.item !== undefined && rs.attrs.item !== "none") det.remoto = rs.attrs.item;
  if (ws.attrs.copied === "true") det.copiado = true;
  if (ws.attrs.switched === "true") det.trocado = true;
  const arvore = ws.attrs["tree-conflicted"] === "true";
  if (arvore) det.arvoreConflito = true;
  if (/^\d+$/.test(ws.attrs.revision ?? "")) det.revisao = Number(ws.attrs.revision);
  const base = (tipo: Mudanca["tipo"], letra: LetraMudanca): Mudanca => ({ caminho, tipo, indice: " ", arvore: letra, ...(Object.keys(det).length > 0 ? { svn: det } : {}) });
  if (item === "unversioned") return base("naorastreado", " ");
  if (item === "ignored") return base("ignorado", " ");
  if (item === "external") return null;
  if (item === "conflicted" || arvore || props === "conflicted") {
    const m = base("conflito", "U");
    m.indice = "U";
    if (!arvore) m.conflito = "ambos-modificaram";
    return m;
  }
  switch (item) {
    case "modified":
      return base("ordinario", "M");
    case "added":
      return base(ws.attrs.copied === "true" ? "copiado" : "ordinario", "A");
    case "deleted":
      return base("ordinario", "D");
    case "replaced":
      return base("ordinario", "R");
    case "missing":
      det.faltando = true;
      return base("ordinario", "D");
    case "obstructed":
    case "incomplete":
      return base("ordinario", "T");
    default:
      // normal com propriedade modificada, ou normal desatualizado no servidor (`-u`)
      if (det.propriedades !== undefined) return base("ordinario", "M");
      if (det.remoto !== undefined) return base("ordinario", " ");
      return null;
  }
}

/** Interpreta `svn status --xml`. Tolerante a XML truncado. `info` preenche ramo e revisão. */
export function parseStatusXml(xml: string, info?: Pick<InfoSvn, "urlRelativa" | "revisao"> | null): StatusRepo {
  const raiz = documento(xml, "status");
  const arquivos: Mudanca[] = [];
  let behind = 0;
  let contexto = 0;
  const alvos = filhosDe(raiz, "target");
  const processar = (e: NoXml, cl?: string): void => {
    const m = mudancaDe(e, cl);
    if (m === null) return;
    arquivos.push(m);
    if (m.svn?.remoto !== undefined && m.svn.remoto !== "none") behind++;
  };
  // `changelist` vem como irmão de `target` (svn 1.14) — aceita também aninhado
  for (const cl of filhosDe(raiz, "changelist")) for (const e of filhosDe(cl, "entry")) processar(e, cl.attrs.name);
  for (const t of alvos) {
    for (const f of t.filhos) {
      if (f.nome === "entry") processar(f);
      else if (f.nome === "changelist") for (const e of filhosDe(f, "entry")) processar(e, f.attrs.name);
    }
    const ag = filho(t, "against");
    if (ag) contexto = Number(ag.attrs.revision ?? 0);
  }
  void contexto;
  // "." (a própria raiz) só entra quando tem algo a dizer; o resto é ordenado como no git: rastreados, não rastreados, ignorados
  const ordem = (m: Mudanca): number => (m.tipo === "ignorado" ? 2 : m.tipo === "naorastreado" ? 1 : 0);
  arquivos.sort((a, b) => ordem(a) - ordem(b) || (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  const local = info ? localAtual(info.urlRelativa) : null;
  return {
    estado: "pronto",
    branch: local === null || local.tipo === "outro" ? null : local.tipo === "trunk" ? "trunk" : `${local.tipo === "tag" ? "tags" : "branches"}/${local.nome}`,
    oid: info ? String(info.revisao) : null,
    upstream: null,
    ahead: 0,
    behind,
    semCommits: false,
    arquivos,
    contagens: recontar(arquivos),
    degradado: false,
    duracaoMs: 0,
  };
}

export interface OpcoesStatusSvn extends OpcoesStatus, OpcoesBaseSvn {
  /** `-u`: compara com o servidor (rede). */
  servidor?: boolean;
  /** Passou disto: aborta e refaz com `-q` (não versionados omitidos). Padrão 2000; 0 desliga. */
  limiteDegradarMs?: number;
  semNaoRastreados?: boolean;
  /** Info já conhecida (evita um `svn info`). */
  info?: InfoSvn;
}

export async function statusSvn(raiz: string, op: OpcoesStatusSvn = {}): Promise<StatusRepo> {
  const inicio = performance.now();
  const limite = op.limiteDegradarMs ?? LIMITE_DEGRADAR_SVN_MS;
  const rodar = (q: boolean, signal: AbortSignal | undefined) => {
    const flags = ["--xml", ...(op.ignorados === true ? ["--no-ignore"] : []), ...(op.servidor === true ? ["-u"] : []), ...(q ? ["-q"] : [])];
    const o = { ...op, timeoutMs: 120_000, maxBytes: SAIDA_STATUS_MAX, ...(signal ? { signal } : {}) };
    return op.servidor === true ? rodarSvnRede(raiz, "status", flags, [], { ...o, tipo: "rede" }) : rodarSvn(raiz, "status", flags, [], o);
  };
  const infoP = op.info ? Promise.resolve(op.info) : infoSvn(raiz, op).catch(() => null);
  const concluir = async (stdout: string, truncado: boolean, degradado: boolean): Promise<StatusRepo> => {
    void truncado;
    const s = parseStatusXml(stdout, await infoP);
    s.degradado = degradado;
    s.duracaoMs = performance.now() - inicio;
    return s;
  };
  if (op.semNaoRastreados === true) return concluir((await rodar(true, op.signal)).stdout, false, true);
  if (limite <= 0 || op.servidor === true) return concluir((await rodar(false, op.signal)).stdout, false, false);
  const ac = new AbortController();
  const fora = (): void => ac.abort();
  op.signal?.addEventListener("abort", fora, { once: true });
  let estourou = false;
  const relogio = setTimeout(() => {
    estourou = true;
    ac.abort();
  }, limite);
  try {
    return await concluir((await rodar(false, ac.signal)).stdout, false, false);
  } catch (e) {
    if (!(estourou && e instanceof GitCanceladoErro) || op.signal?.aborted) throw e;
  } finally {
    clearTimeout(relogio);
    op.signal?.removeEventListener("abort", fora);
  }
  return concluir((await rodar(true, op.signal)).stdout, false, true);
}

const ordemM = (m: Mudanca): number => (m.tipo === "ignorado" ? 2 : m.tipo === "naorastreado" ? 1 : 0);
const antes = (a: Mudanca, b: Mudanca): boolean => (ordemM(a) !== ordemM(b) ? ordemM(a) < ordemM(b) : a.caminho < b.caminho);

/**
 * Status INCREMENTAL: `svn status` só dos `caminhos` que o observador reportou, mesclado ao status anterior.
 * Devolve null quando o atalho não é seguro (base não pronta, caminhos demais/inválidos, alvo dentro de pasta
 * não versionada, aviso do svn): o chamador faz o status completo.
 */
export async function statusSvnParcial(raiz: string, base: StatusRepo, caminhos: readonly string[], op: OpcoesStatusSvn = {}): Promise<StatusRepo | null> {
  if (base.estado !== "pronto" || caminhos.length === 0 || caminhos.length > MAX_CAMINHOS_PARCIAL_SVN) return null;
  let alvo: string[];
  try {
    alvo = [...new Set(caminhos.map((c) => caminhoWc(c).replace(/@$/, "")))];
  } catch {
    return null;
  }
  const naoVersionados = base.arquivos.filter((m) => m.tipo === "naorastreado" || m.tipo === "ignorado").map((m) => m.caminho.replace(/\/$/, ""));
  for (const a of alvo) if (naoVersionados.some((d) => a.startsWith(`${d}/`))) return null;
  const inicio = performance.now();
  const r = await rodar(raiz, alvo, op);
  if (/\bW1\d{5}\b/.test(r.stderr)) return null;
  const novas = parseStatusXml(r.stdout).arquivos;
  const sob = (c: string): boolean => alvo.some((a) => c === a || c.startsWith(`${a}/`));
  const arquivos = base.arquivos.filter((m) => !sob(m.caminho));
  for (const m of novas) {
    let lo = 0;
    let hi = arquivos.length;
    while (lo < hi) {
      const meio = (lo + hi) >>> 1;
      if (antes(arquivos[meio] as Mudanca, m)) lo = meio + 1;
      else hi = meio;
    }
    arquivos.splice(lo, 0, m);
  }
  return { ...base, arquivos, contagens: recontar(arquivos), parcial: true, duracaoMs: performance.now() - inicio };
}

function rodar(raiz: string, alvo: string[], op: OpcoesStatusSvn) {
  return rodarSvn(raiz, "status", ["--xml", ...(op.ignorados === true ? ["--no-ignore"] : [])], alvo.map(caminhoWc), { ...op, maxBytes: SAIDA_STATUS_MAX, timeoutMs: 60_000 });
}

