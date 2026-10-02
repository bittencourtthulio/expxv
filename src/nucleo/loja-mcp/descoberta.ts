// Descoberta no Registro Oficial do MCP (Fase 7B, T-07B.32, D-130): só de DESCOBERTA. Toda chamada é por clique (nunca no boot nem em
// segundo plano), tem timeout duro e limite de resposta; o resultado é DADO de terceiro (descrição saneada, nunca instrução) e nunca
// vira instalável nem habilita nada: `curado:false`, `instalavel:false`, sem comando. PURO + um `fetch` injetável (sem rede nos testes).

export const URL_REGISTRO_OFICIAL = "https://registry.modelcontextprotocol.io/v0.1/servers";
export const TIMEOUT_DESCOBERTA_MS = 8000;
export const LIMITE_RESPOSTA_DESCOBERTA = 1_000_000;
export const MAX_CANDIDATOS = 20;
export const MAX_CONSULTA = 100;

export interface CandidatoMcp {
  /** nome no registro (`io.github.<org>/<servidor>`); só texto. */
  nome: string;
  descricao: string;
  versao: string | null;
  /** `https:` sem credenciais, ou `null`. */
  repositorio: string | null;
  /** namespace de GitHub verificado pelo registro (`io.github.<org>/…`): destacado na UI. */
  namespace_verificado: boolean;
  /** tipos de transporte anunciados (só informativo; NENHUM comando é exibido como instalável). */
  transportes: string[];
  curado: false;
  instalavel: false;
}

export interface ResultadoDescoberta {
  candidatos: CandidatoMcp[];
  /** quantos foram descartados como spam/malformados. */
  descartados: number;
  aviso: string | null;
}

export class ErroDescoberta extends Error {
  constructor(readonly codigo: "consulta_invalida" | "rede_indisponivel" | "timeout" | "resposta_invalida" | "resposta_grande", mensagem: string) {
    super(mensagem);
    this.name = "ErroDescoberta";
  }
}

// ---------------------------------------------------------------- saneamento (dado de terceiro é dado)
/** Controles, bidi e formatação invisível viram espaço; `<`/`>` saem (nunca HTML/markup do terceiro). */
const INVISIVEIS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿<>]/g;
export function sanearTexto(t: unknown, max: number): string {
  if (typeof t !== "string") return "";
  return t.replace(INVISIVEIS, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const NOME_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const NAMESPACE_GITHUB = /^io\.github\.[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SPAM = /\b(casino|airdrop|giveaway|porn|escort|viagra|forex signals?|seo (?:service|backlinks?)|buy followers|click here|limited offer|telegram (?:signals?|group)|whatsapp group|earn \$|make money fast)\b/i;
const MAX_LINKS_NA_DESCRICAO = 3;

/** `https:` sem usuário/senha, sem porta exótica; qualquer outra coisa vira `null`. */
export function urlHttpsSegura(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 300) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" || x.username !== "" || x.password !== "" || (x.port !== "" && x.port !== "443")) return null;
    return x.toString();
  } catch {
    return null;
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function candidatoDe(bruto: unknown): CandidatoMcp | null {
  const topo = obj(bruto);
  if (topo === null) return null;
  const s = obj(topo["server"]) ?? topo; // o registro v0.1 embrulha em `server`; tolera o formato plano
  const nome = typeof s["name"] === "string" ? s["name"].trim() : "";
  if (!NOME_VALIDO.test(nome)) return null;
  const descricao = sanearTexto(s["description"], 300);
  const links = (typeof s["description"] === "string" ? s["description"] : "").match(/https?:\/\//gi)?.length ?? 0;
  if (descricao.length < 10 || links > MAX_LINKS_NA_DESCRICAO || SPAM.test(`${nome} ${descricao}`)) return null;
  const repo = obj(s["repository"]);
  const transportes = new Set<string>();
  for (const r of Array.isArray(s["remotes"]) ? s["remotes"] : []) { const t = obj(r)?.["type"]; if (typeof t === "string") transportes.add(sanearTexto(t, 24)); }
  for (const p of Array.isArray(s["packages"]) ? s["packages"] : []) { const t = obj(obj(p)?.["transport"])?.["type"]; if (typeof t === "string") transportes.add(sanearTexto(t, 24)); }
  const versao = sanearTexto(s["version"], 40);
  return {
    nome, descricao, versao: versao === "" ? null : versao, repositorio: urlHttpsSegura(repo?.["url"]),
    namespace_verificado: NAMESPACE_GITHUB.test(nome), transportes: [...transportes].filter((t) => t !== "").sort(), curado: false, instalavel: false,
  };
}

/**
 * Normaliza a resposta (tolerante: formato desconhecido ⇒ `resposta_invalida`, nunca exceção solta). Descarta spam e malformados,
 * deduplica por nome (fica a primeira ocorrência), destaca namespaces verificados primeiro e limita a 20.
 */
export function normalizarRespostaRegistro(json: unknown): ResultadoDescoberta {
  const raiz = obj(json);
  const lista = Array.isArray(raiz?.["servers"]) ? (raiz["servers"] as unknown[]) : Array.isArray(json) ? (json as unknown[]) : null;
  if (lista === null) throw new ErroDescoberta("resposta_invalida", "O Registro Oficial respondeu em um formato inesperado.");
  const vistos = new Set<string>();
  const candidatos: CandidatoMcp[] = [];
  let descartados = 0;
  for (const item of lista.slice(0, 200)) {
    const c = candidatoDe(item);
    if (c === null || vistos.has(c.nome)) { descartados++; continue; }
    vistos.add(c.nome);
    candidatos.push(c);
  }
  candidatos.sort((a, b) => Number(b.namespace_verificado) - Number(a.namespace_verificado));
  return {
    candidatos: candidatos.slice(0, MAX_CANDIDATOS), descartados: descartados + Math.max(0, candidatos.length - MAX_CANDIDATOS),
    aviso: "Resultados do Registro Oficial: não curados e não instaláveis. Para entrar na Loja, o servidor precisa passar pela curadoria.",
  };
}

export interface OpcoesDescoberta {
  fetch?: typeof fetch;
  url?: string;
  timeoutMs?: number;
}

/** Valida a consulta (texto livre curto, sem controle). */
export function consultaValida(c: unknown): string {
  const t = typeof c === "string" ? c.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (t.length < 2 || t.length > MAX_CONSULTA) throw new ErroDescoberta("consulta_invalida", `Informe de 2 a ${MAX_CONSULTA} caracteres para buscar.`);
  return t;
}

/** UMA chamada GET, só por clique. Timeout duro, resposta limitada a 1 MB, sem credenciais, sem seguir para outro host. */
export async function descobrirNoRegistro(consulta: string, o: OpcoesDescoberta = {}): Promise<ResultadoDescoberta> {
  const q = consultaValida(consulta);
  const base = new URL(o.url ?? URL_REGISTRO_OFICIAL);
  base.searchParams.set("search", q);
  base.searchParams.set("version", "latest");
  base.searchParams.set("limit", "20");
  const f = o.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? TIMEOUT_DESCOBERTA_MS);
  try {
    let resposta: Response;
    try {
      resposta = await f(base.toString(), { method: "GET", headers: { accept: "application/json" }, signal: controller.signal, redirect: "error", credentials: "omit" });
    } catch (e) {
      if (controller.signal.aborted) throw new ErroDescoberta("timeout", "O Registro Oficial não respondeu a tempo.");
      throw new ErroDescoberta("rede_indisponivel", "Sem rede para consultar o Registro Oficial. A Loja continua navegável.");
    }
    if (!resposta.ok) throw new ErroDescoberta("rede_indisponivel", `O Registro Oficial respondeu com erro (${resposta.status}).`);
    const declarado = Number(resposta.headers.get("content-length") ?? 0);
    if (declarado > LIMITE_RESPOSTA_DESCOBERTA) throw new ErroDescoberta("resposta_grande", "Resposta grande demais do Registro Oficial.");
    const texto = await resposta.text();
    if (texto.length > LIMITE_RESPOSTA_DESCOBERTA) throw new ErroDescoberta("resposta_grande", "Resposta grande demais do Registro Oficial.");
    let json: unknown;
    try { json = JSON.parse(texto); } catch { throw new ErroDescoberta("resposta_invalida", "O Registro Oficial respondeu algo que não é JSON."); }
    return normalizarRespostaRegistro(json);
  } finally {
    clearTimeout(timer);
  }
}
