// Cliente tipado da API do OpenRouter sobre a REDE INJETADA (`nucleo/rede`, único ponto de saída; D-114). Este módulo nunca abre socket
// por conta própria: cada chamada recebe o token de consentimento emitido pelo clique (ou o permanente do consentimento gravado).
// A chave do dono entra só no cabeçalho `Authorization` da chamada; nunca em log, erro, retorno ou URL.
import type { TipoContaOpenRouter } from "../../compartilhado/harness";
import { RedeErro, type ClienteRede } from "../rede";
import { OpenRouterErro } from "./erros";

export const HOST_OPENROUTER = "openrouter.ai";
const PREFIXO_API = "/api/v1";
const MAX_BYTES_MODELOS = 16 * 1024 * 1024;
const MAX_BYTES_PEQUENO = 256 * 1024;

export interface DestinoOpenRouter {
  host: string;
  /** só servidores falsos de teste (loopback). Produção: 443. */
  porta?: number;
  /** padrão `/api/v1`. */
  prefixo?: string;
}

/** O que `GET /key` diz da chave. `null` = a API não informou (nunca 0). */
export interface InfoChave {
  tipo: TipoContaOpenRouter;
  limite_usd: number | null;
  usado_usd: number | null;
  /** `limit_remaining` da API, ou limite − usado quando há limite. */
  restante_usd: number | null;
  latencia_ms: number;
}
export interface InfoCreditos {
  total_usd: number;
  usado_usd: number;
  restante_usd: number;
}
/** Modelo como `repos.openrouterModelo.sincronizar` espera (preço em USD por MILHÃO de tokens). */
export interface ModeloDaApiOr {
  id: string;
  nome: string;
  contexto: number | null;
  suporta_tools: boolean | null;
  modalidades: string[] | null;
  preco_entrada_por_mtok: number | null;
  preco_saida_por_mtok: number | null;
}

export interface ClienteOpenRouter {
  /** `GET /key`: valida a chave e devolve tipo/limite/uso. */
  chave(chave: string, token: string, op?: { timeout_ms?: number }): Promise<InfoChave>;
  /** `GET /credits`: saldo pré-pago da conta. `null` quando a chave não tem permissão (403) ou a resposta não traz os campos. */
  creditos(chave: string, token: string, op?: { timeout_ms?: number }): Promise<InfoCreditos | null>;
  /** `GET /models`. */
  modelos(chave: string, token: string): Promise<ModeloDaApiOr[]>;
}

const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Preço da API vem em USD POR TOKEN (texto). Negativo/ausente/ilegível = `null` (a API usa "-1" para roteadores dinâmicos). */
export function precoPorMtok(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

/** Um item de `GET /models` → modelo; item sem `id` válido é descartado (`null`). */
export function traduzirModeloDaApi(bruto: unknown): ModeloDaApiOr | null {
  const o = objeto(bruto);
  if (o === null || typeof o.id !== "string" || o.id.trim() === "" || o.id.length > 120) return null;
  const preco = objeto(o.pricing);
  const arq = objeto(o.architecture);
  const params = Array.isArray(o.supported_parameters) ? o.supported_parameters.filter((x): x is string => typeof x === "string") : null;
  const entradas = arq !== null && Array.isArray(arq.input_modalities) ? arq.input_modalities.filter((x): x is string => typeof x === "string") : null;
  const contexto = numero(o.context_length);
  return {
    id: o.id,
    nome: typeof o.name === "string" && o.name.trim() !== "" ? o.name.slice(0, 200) : o.id,
    contexto: contexto !== null && contexto > 0 ? Math.floor(contexto) : null,
    suporta_tools: params === null ? null : params.includes("tools"),
    modalidades: entradas,
    preco_entrada_por_mtok: preco === null ? null : precoPorMtok(preco.prompt),
    preco_saida_por_mtok: preco === null ? null : precoPorMtok(preco.completion),
  };
}

export function criarClienteOpenRouter(rede: ClienteRede, destino: DestinoOpenRouter = { host: HOST_OPENROUTER }): ClienteOpenRouter {
  const prefixo = destino.prefixo ?? PREFIXO_API;

  async function obter(caminho: string, chave: string, token: string, max_bytes: number, timeout_ms: number): Promise<{ status: number; json: unknown }> {
    try {
      const r = await rede.requisitar({
        host: destino.host,
        caminho: `${prefixo}${caminho}`,
        metodo: "GET",
        cabecalhos: { authorization: `Bearer ${chave}`, accept: "application/json" },
        tokenDeConsentimento: token,
        timeout_ms,
        max_bytes,
        ...(destino.porta === undefined ? {} : { porta: destino.porta }),
      });
      let json: unknown = null;
      if (r.status >= 200 && r.status < 300) {
        try {
          json = JSON.parse(r.texto());
        } catch {
          throw new OpenRouterErro("resposta_invalida");
        }
      }
      return { status: r.status, json };
    } catch (e) {
      if (e instanceof OpenRouterErro) throw e;
      if (e instanceof RedeErro) throw new OpenRouterErro(e.codigo === "consent_required" || e.codigo === "host_nao_permitido" ? "sem_consentimento" : "indisponivel");
      throw new OpenRouterErro("indisponivel");
    }
  }

  const falhaDeStatus = (status: number): OpenRouterErro =>
    status === 401 || status === 403 ? new OpenRouterErro("chave_invalida") : status === 429 ? new OpenRouterErro("limite_de_requisicoes") : status >= 500 ? new OpenRouterErro("indisponivel", String(status)) : new OpenRouterErro("resposta_invalida", String(status));

  return {
    async chave(chave, token, op = {}) {
      const inicio = performance.now();
      const { status, json } = await obter("/key", chave, token, MAX_BYTES_PEQUENO, op.timeout_ms ?? 10_000);
      if (status < 200 || status >= 300) throw falhaDeStatus(status);
      const data = objeto(objeto(json)?.data);
      if (data === null) throw new OpenRouterErro("resposta_invalida");
      const limite = numero(data.limit);
      const usado = numero(data.usage);
      const restanteApi = numero(data.limit_remaining);
      const restante = restanteApi ?? (limite !== null && usado !== null ? Math.max(0, limite - usado) : null);
      const tipo: TipoContaOpenRouter = data.is_free_tier === true ? "gratuito" : data.is_free_tier === false ? "pago" : "desconhecido";
      return { tipo, limite_usd: limite, usado_usd: usado, restante_usd: restante, latencia_ms: Math.max(0, Math.round(performance.now() - inicio)) };
    },
    async creditos(chave, token, op = {}) {
      const { status, json } = await obter("/credits", chave, token, MAX_BYTES_PEQUENO, op.timeout_ms ?? 10_000);
      if (status === 401 || status === 403 || status === 404) return null; // a chave comum não lê o saldo da conta: não é erro
      if (status < 200 || status >= 300) throw falhaDeStatus(status);
      const data = objeto(objeto(json)?.data);
      const total = numero(data?.total_credits);
      const usado = numero(data?.total_usage);
      if (total === null || usado === null) return null;
      return { total_usd: total, usado_usd: usado, restante_usd: Math.max(0, total - usado) };
    },
    async modelos(chave, token) {
      const { status, json } = await obter("/models", chave, token, MAX_BYTES_MODELOS, 20_000);
      if (status < 200 || status >= 300) throw falhaDeStatus(status);
      const lista = objeto(json)?.data;
      if (!Array.isArray(lista)) throw new OpenRouterErro("resposta_invalida");
      const vistos = new Set<string>();
      const saida: ModeloDaApiOr[] = [];
      for (const item of lista) {
        const m = traduzirModeloDaApi(item);
        if (m === null || vistos.has(m.id)) continue;
        vistos.add(m.id);
        saida.push(m);
      }
      return saida;
    },
  };
}
