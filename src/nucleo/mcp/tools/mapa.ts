// Tools `map_*` (Fase 17, T-17.32): consulta SOMENTE LEITURA ao mapa lógico do código.
//
// CONTRATO DA PORTA (`PortaMapaMcp`, portas.ts; o adaptador real vive no main e chega por RPC `mapa.*`):
//   disponivel(ws): Promise<boolean>   mapa habilitado E opt-in `expor_agentes`; reconferido a CADA chamada
//   status(ws):     Promise<StatusMapaMcp>   `state: "empty"|"partial"|"ready"`; "empty" => demais tools dão `unavailable/map_not_ready`
//   query(ws, {kind, target|null, depth 1..5, limit 1..100, min_confidence "exact"|"heuristic"}): Promise<{items: ItemMapaMcp[]; truncated?}>
//   impact(ws, {files[1..50], symbols[0..50]}): Promise<ImpactoMapaMcp>   (raio provisório; faixa em LOW|MEDIUM|HIGH)
//   evidence(ws, {topic, scope|null, limit 1..50}): Promise<{facts: FatoMapaMcp[]}>
// `ws` vem SEMPRE do token. Caminhos/alvos chegam já validados (relativos, sem `..`, sem NUL, sem arquivo de ambiente). Nenhum método escreve nem
// dispara análise. Toda resposta é <= 4 KB (corte determinístico com `truncated: true`); `too_large` só se nem a versão mínima couber.
import { ErroMcp, argumentoInvalido, grande } from "../erros";
import type { FatoMapaMcp, ImpactoMapaMcp, ItemMapaMcp, PortaMapaMcp, StatusMapaMcp, TipoConsultaMapa, TopicoEvidenciaMapa } from "../portas";
import { TIPOS_CONSULTA_MAPA, TOPICOS_EVIDENCIA_MAPA } from "../portas";
import { comoObjeto, inteiroOpcional, textoOpcional, type DepsTools, type ImplTool } from "./comum";
import { LIMITE_RESPOSTA_BYTES } from "./harness";

export const LIMITE_ITENS_CONSULTA = 100;
const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");

// ------------------------------------------------------------------ porta e estado
function exigirMapa(deps: DepsTools): PortaMapaMcp {
  if (deps.mapa === undefined) throw new ErroMcp("unavailable", "O mapa do código não está disponível.", "map_not_ready");
  return deps.mapa;
}

function traduzirErro(e: unknown): ErroMcp {
  if (e instanceof ErroMcp) return e;
  return new ErroMcp("unavailable", "O mapa do código não respondeu.", "map_not_ready");
}

async function chamar<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw traduzirErro(e);
  }
}

async function exigirDisponivel(mapa: PortaMapaMcp, ws: string): Promise<void> {
  const ok = await chamar(mapa.disponivel(ws));
  if (!ok) throw new ErroMcp("unavailable", "O mapa do código está desligado ou não foi exposto a agentes neste workspace.", "map_not_ready");
}

async function exigirPronto(mapa: PortaMapaMcp, ws: string): Promise<void> {
  const s = await chamar(mapa.status(ws));
  if (s.state === "empty") throw new ErroMcp("unavailable", "O mapa ainda não foi analisado (peça ao usuário para analisar o projeto).", "map_not_ready");
}

// ------------------------------------------------------------------ validação
function recusarExtras(a: Record<string, unknown>, permitidos: readonly string[]): void {
  for (const k of Object.keys(a)) if (!permitidos.includes(k)) throw argumentoInvalido(`O campo "${k}" não existe nesta tool (o workspace vem do token).`);
}

const PADROES_SENSIVEIS: readonly RegExp[] = [/^\.env(\..*)?$/i, /\.env$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /\.jks$/i, /\.keystore$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i, /^\.netrc$/i];

function caminhoRelativoSeguro(c: string, campo: string): string {
  const base = c.split(/[\\/]/).pop() ?? c;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(c)) throw argumentoInvalido(`O campo "${campo}" tem caracteres inválidos.`);
  if (c.startsWith("/") || c.startsWith("\\") || /^[A-Za-z]:/.test(c) || c.startsWith("~") || c.split(/[\\/]/).includes("..")) {
    throw argumentoInvalido(`O campo "${campo}" aceita só caminhos relativos ao workspace.`);
  }
  if (PADROES_SENSIVEIS.some((p) => p.test(base))) throw argumentoInvalido(`O campo "${campo}" não pode citar arquivo de ambiente ou chave.`);
  return c;
}

function listaDeCaminhos(a: Record<string, unknown>, campo: string, min: number, max: number): string[] {
  const v = a[campo];
  if (v === undefined || v === null) {
    if (min > 0) throw argumentoInvalido(`O campo "${campo}" é obrigatório.`);
    return [];
  }
  if (!Array.isArray(v) || v.length < min || v.length > max || v.some((x) => typeof x !== "string" || x.trim() === "" || [...x].length > 300)) {
    throw argumentoInvalido(`O campo "${campo}" deve ser uma lista de ${min} a ${max} textos de até 300 caracteres.`);
  }
  return (v as string[]).map((c) => caminhoRelativoSeguro(c, campo));
}

function enumObrigatorio<T extends string>(a: Record<string, unknown>, campo: string, valores: readonly T[]): T {
  const v = a[campo];
  if (typeof v !== "string" || !(valores as readonly string[]).includes(v)) throw argumentoInvalido(`O campo "${campo}" é obrigatório e deve ser um de: ${valores.join(", ")}.`);
  return v as T;
}

/** `target` pode ser caminho, id de nó (`arq:`, `sim:`…) ou texto de busca: só barra o que escapa da raiz ou é sensível. */
function alvoSeguro(a: Record<string, unknown>): string | null {
  const t = textoOpcional(a, "target", 300);
  if (t === null) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) throw argumentoInvalido('O campo "target" tem caracteres inválidos.');
  const semPrefixo = t.replace(/^(arq|mod|sim|ent|tab|ext):/, "");
  const caminho = semPrefixo.split("#")[0] ?? semPrefixo;
  if (caminho.startsWith("/") || caminho.startsWith("\\") || /^[A-Za-z]:/.test(caminho) || caminho.startsWith("~") || caminho.split(/[\\/]/).includes("..")) {
    throw argumentoInvalido('O campo "target" aceita só caminhos relativos ao workspace.');
  }
  const base = caminho.split(/[\\/]/).pop() ?? caminho;
  if (PADROES_SENSIVEIS.some((p) => p.test(base))) throw argumentoInvalido('O campo "target" não pode citar arquivo de ambiente ou chave.');
  return t;
}

// ------------------------------------------------------------------ saneamento e corte
function linha(s: unknown, max: number): string {
  const t = typeof s === "string" ? s : String(s ?? "");
  // eslint-disable-next-line no-control-regex
  const limpo = t.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  const pontos = Array.from(limpo);
  return pontos.length <= max ? limpo : `${pontos.slice(0, max - 1).join("")}…`;
}

/** Nunca devolve caminho absoluto ou com `..`, mesmo se a porta errar. */
function caminhoDeSaida(p: string | null): string | null {
  if (p === null) return null;
  const s = linha(p, 200);
  if (s === "" || s.startsWith("/") || /^[A-Za-z]:/.test(s) || s.split(/[\\/]/).includes("..")) return null;
  return s;
}

function item(i: ItemMapaMcp): ItemMapaMcp {
  const metrics = i.metrics === undefined ? undefined : Object.fromEntries(Object.entries(i.metrics).slice(0, 6).map(([k, v]) => [linha(k, 30), typeof v === "string" ? linha(v, 60) : v]));
  return {
    id: linha(i.id, 160),
    kind: linha(i.kind, 24),
    label: linha(i.label, 100),
    path: caminhoDeSaida(i.path),
    line: typeof i.line === "number" && Number.isFinite(i.line) ? i.line : null,
    confidence: i.confidence,
    ...(metrics === undefined ? {} : { metrics }),
  };
}

/** Remove itens do FIM até caber em 4 KB; cada passo corta ~20%. Devolve `too_large` só se nem sem itens couber. */
function caberLista<T>(itens: readonly T[], campo: string, montar: (lista: T[], extra: Record<string, unknown>) => Record<string, unknown>, jaTruncado = false): Record<string, unknown> {
  let n = itens.length;
  let saida = montar([...itens], jaTruncado ? { truncated: true } : {});
  while (n > 0 && bytes(saida) > LIMITE_RESPOSTA_BYTES) {
    n = Math.max(0, n - Math.max(1, Math.floor(n * 0.2)));
    saida = montar(itens.slice(0, n), { truncated: true, total: itens.length });
  }
  if (bytes(saida) > LIMITE_RESPOSTA_BYTES) throw grande(`A resposta de ${campo} não cabe em ${LIMITE_RESPOSTA_BYTES} bytes.`);
  return saida;
}

// ------------------------------------------------------------------ tools
export const mapStatus: ImplTool = async (args, { claims, deps }) => {
  recusarExtras(comoObjeto(args), []);
  const mapa = exigirMapa(deps);
  await exigirDisponivel(mapa, claims.workspace_id);
  const s: StatusMapaMcp = await chamar(mapa.status(claims.workspace_id));
  const montar = (langs: StatusMapaMcp["languages"], extra: Record<string, unknown>): Record<string, unknown> => ({
    state: s.state,
    generated_at: s.generated_at,
    files: s.files,
    languages: langs.map((l) => ({ language: linha(l.language, 24), files: l.files, loc: l.loc })),
    edges: { exact: s.edges.exact, heuristic: s.edges.heuristic },
    stale: s.stale,
    history: s.history,
    ...extra,
  });
  return caberLista(s.languages.slice(0, 40), "map_status", montar);
};

export const mapQuery: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  recusarExtras(a, ["kind", "target", "depth", "limit", "min_confidence"]);
  const kind: TipoConsultaMapa = enumObrigatorio(a, "kind", TIPOS_CONSULTA_MAPA);
  const target = alvoSeguro(a);
  const depth = inteiroOpcional(a, "depth", 1, 5) ?? 1;
  // limite acima do teto é REDUZIDO (não recusado): a resposta já é cortada de qualquer forma
  const brutoLimit = a["limit"];
  if (brutoLimit !== undefined && brutoLimit !== null && (typeof brutoLimit !== "number" || !Number.isInteger(brutoLimit) || brutoLimit < 1)) throw argumentoInvalido('O campo "limit" deve ser um inteiro positivo.');
  const limit = Math.min((brutoLimit as number | undefined | null) ?? 20, LIMITE_ITENS_CONSULTA);
  const mc = a["min_confidence"];
  if (mc !== undefined && mc !== null && mc !== "exact" && mc !== "heuristic") throw argumentoInvalido('O campo "min_confidence" deve ser "exact" ou "heuristic".');
  if ((kind === "search" || kind === "neighbors" || kind === "callers" || kind === "callees" || kind === "dependents") && target === null) {
    throw argumentoInvalido(`O campo "target" é obrigatório para kind "${kind}".`);
  }
  const mapa = exigirMapa(deps);
  await exigirDisponivel(mapa, claims.workspace_id);
  await exigirPronto(mapa, claims.workspace_id);
  const r = await chamar(mapa.query(claims.workspace_id, { kind, target, depth, limit, min_confidence: (mc as "exact" | "heuristic" | undefined | null) ?? "heuristic" }));
  const itens = r.items.slice(0, limit).map(item);
  return caberLista(itens, "map_query", (lista, extra) => ({ items: lista, truncated: false, ...extra }), r.truncated === true || r.items.length > limit);
};

const FAIXA: Readonly<Record<string, string>> = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" };

export const mapImpact: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  recusarExtras(a, ["files", "symbols"]);
  const files = listaDeCaminhos(a, "files", 1, 50);
  const simbolosBrutos = a["symbols"];
  let symbols: string[] = [];
  if (simbolosBrutos !== undefined && simbolosBrutos !== null) {
    if (!Array.isArray(simbolosBrutos) || simbolosBrutos.length > 50 || simbolosBrutos.some((x) => typeof x !== "string" || x.trim() === "" || [...x].length > 300)) {
      throw argumentoInvalido('O campo "symbols" deve ser uma lista de até 50 textos de até 300 caracteres.');
    }
    symbols = (simbolosBrutos as string[]).map((s) => {
      const caminho = s.replace(/^sim:/, "").split("#")[0] ?? s;
      caminhoRelativoSeguro(caminho, "symbols");
      return s;
    });
  }
  const mapa = exigirMapa(deps);
  await exigirDisponivel(mapa, claims.workspace_id);
  await exigirPronto(mapa, claims.workspace_id);
  const r: ImpactoMapaMcp = await chamar(mapa.impact(claims.workspace_id, { files, symbols }));
  const sinais = r.signals.slice(0, 8).map((s) => ({ id: s.id, name: linha(s.name, 40), min: s.min, max: s.max, value: linha(s.value, 140), method: linha(s.method, 100), worst_case: s.worst_case }));
  const montar = (n: { callers: number; seam: number; worst: number; arquivos: number }): Record<string, unknown> => ({
    files: r.files.slice(0, n.arquivos).map((f) => caminhoDeSaida(f) ?? "?"),
    signals: sinais,
    band: FAIXA[r.band] ?? r.band,
    band_worst_case: FAIXA[r.band_worst_case] ?? r.band_worst_case,
    worst_case: r.worst_case.slice(0, n.worst).map((w) => ({ signal: w.signal, reason: linha(w.reason, 140) })),
    seam_candidates: r.seam_candidates.slice(0, n.seam).map((s) => linha(s, 160)),
    callers: r.callers.slice(0, n.callers).map((c) => caminhoDeSaida(c) ?? "?"),
    note: linha(r.note, 200),
    ...(n.callers < r.callers.length || n.seam < r.seam_candidates.length || n.worst < r.worst_case.length || n.arquivos < r.files.length ? { truncated: true, total_callers: r.callers.length } : {}),
  });
  const n = { callers: Math.min(r.callers.length, 60), seam: Math.min(r.seam_candidates.length, 20), worst: Math.min(r.worst_case.length, 20), arquivos: Math.min(r.files.length, 50) };
  let saida = montar(n);
  // encolhe na ordem: chamadores, costura, pior caso, arquivos
  while (bytes(saida) > LIMITE_RESPOSTA_BYTES && (n.callers > 0 || n.seam > 0 || n.worst > 0 || n.arquivos > 1)) {
    if (n.callers > 0) n.callers = Math.floor(n.callers * 0.7);
    else if (n.seam > 0) n.seam = Math.floor(n.seam * 0.7);
    else if (n.worst > 0) n.worst = Math.floor(n.worst * 0.7);
    else n.arquivos = Math.max(1, Math.floor(n.arquivos * 0.7));
    saida = montar(n);
  }
  if (bytes(saida) > LIMITE_RESPOSTA_BYTES) throw grande(`A resposta de map_impact não cabe em ${LIMITE_RESPOSTA_BYTES} bytes.`);
  return saida;
};

function fato(f: FatoMapaMcp): FatoMapaMcp {
  return {
    fact: linha(f.fact, 200),
    evidence: f.evidence.slice(0, 5).map((e) => linha(e, 160)),
    strength: linha(f.strength, 40),
    counts: Object.fromEntries(Object.entries(f.counts).slice(0, 8).map(([k, v]) => [linha(k, 30), v])),
  };
}

export const mapEvidence: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  recusarExtras(a, ["topic", "scope", "limit"]);
  const topic: TopicoEvidenciaMapa = enumObrigatorio(a, "topic", TOPICOS_EVIDENCIA_MAPA);
  const scopeBruto = textoOpcional(a, "scope", 300);
  const scope = scopeBruto === null ? null : caminhoRelativoSeguro(scopeBruto, "scope");
  const brutoLimit = a["limit"];
  if (brutoLimit !== undefined && brutoLimit !== null && (typeof brutoLimit !== "number" || !Number.isInteger(brutoLimit) || brutoLimit < 1)) throw argumentoInvalido('O campo "limit" deve ser um inteiro positivo.');
  const limit = Math.min((brutoLimit as number | undefined | null) ?? 10, 50);
  const mapa = exigirMapa(deps);
  await exigirDisponivel(mapa, claims.workspace_id);
  await exigirPronto(mapa, claims.workspace_id);
  const r = await chamar(mapa.evidence(claims.workspace_id, { topic, scope, limit }));
  const fatos = r.facts.slice(0, limit).map(fato);
  return caberLista(fatos, "map_evidence", (lista, extra) => ({ facts: lista, ...(lista.length < r.facts.length ? { truncated: true } : {}), ...extra }), r.facts.length > limit);
};
