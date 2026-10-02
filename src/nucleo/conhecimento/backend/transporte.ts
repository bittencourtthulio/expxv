// Transporte HTTP AUTENTICADO do backend online (Fase 15, DEC-8): único caminho dos adaptadores até a rede, sempre sobre o `ClienteRede`
// do app (`nucleo/rede`, o ÚNICO módulo que abre socket). Regras: consentimento VÁLIDO por host (senão `consent_required` sem abrir
// socket); nunca loga corpo, cabeçalho nem chave; erros sanitizados; backoff com jitter em 429/5xx; respeita `AbortSignal`.
import type { ClienteRede, MetodoHttp } from "../../rede/cliente-http";
import { normalizarHost, type RegistroConsentimento } from "../../rede/consentimento";
import { RedeErro } from "../../rede/erros";
import { sanitizarErro } from "./config";

export interface PedidoRag {
  url: string;
  metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  cabecalhos?: Record<string, string>;
  corpo?: string;
  sinal?: AbortSignal;
  timeoutMs?: number;
}
export interface RespostaRag {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  texto(): Promise<string>;
  /** cabeçalho da resposta (minúsculo), ex.: `content-range`. */
  cabecalho(nome: string): string | undefined;
}
/** Compatível com o `TransporteHttp` do Ollama (que não envia cabeçalhos). */
export type TransporteHttpRag = (pedido: PedidoRag) => Promise<RespostaRag>;

export type HostsConsentidos = (() => Iterable<string>) | Iterable<string>;

export interface OpcoesTransporteRag {
  rede: ClienteRede;
  consentimento: RegistroConsentimento;
  /** hosts com consentimento GRAVADO (migração/modo). Função: reflete revogações na hora. */
  hostsConsentidos: HostsConsentidos;
  /** total de tentativas por pedido (padrão 4: 1 + 3 repetições em 429/5xx/falha de rede). */
  tentativas?: number;
  esperaBaseMs?: number;
  esperaMaximaMs?: number;
  /** espera injetável (testes passam um no-op); recebe o sinal para abortar. */
  dormir?: (ms: number, sinal?: AbortSignal) => Promise<void>;
  /** 0..1 (injetável para teste). */
  aleatorio?: () => number;
  timeoutPadraoMs?: number;
  maxBytes?: number;
}

const STATUS_REPETIVEIS = new Set([429, 500, 502, 503, 504]);

export class AbortadoErro extends Error {
  override name = "AbortError";
  constructor() {
    super("operação abortada");
  }
}

function dormirPadrao(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((ok, falha) => {
    if (sinal?.aborted) return falha(new AbortadoErro());
    const t = setTimeout(() => {
      sinal?.removeEventListener("abort", ab);
      ok();
    }, ms);
    const ab = (): void => {
      clearTimeout(t);
      falha(new AbortadoErro());
    };
    sinal?.addEventListener("abort", ab, { once: true });
  });
}

function comAborto<T>(p: Promise<T>, sinal?: AbortSignal): Promise<T> {
  if (sinal === undefined) return p;
  if (sinal.aborted) return Promise.reject(new AbortadoErro());
  return new Promise<T>((ok, falha) => {
    const ab = (): void => falha(new AbortadoErro());
    sinal.addEventListener("abort", ab, { once: true });
    p.then(
      (v) => {
        sinal.removeEventListener("abort", ab);
        ok(v);
      },
      (e: unknown) => {
        sinal.removeEventListener("abort", ab);
        falha(e);
      },
    );
  });
}

function listaDeHosts(h: HostsConsentidos): Set<string> {
  const it = typeof h === "function" ? h() : h;
  return new Set([...it].map(normalizarHost));
}

export function criarTransporteRag(op: OpcoesTransporteRag): TransporteHttpRag {
  const tentativas = Math.max(1, op.tentativas ?? 4);
  const base = op.esperaBaseMs ?? 500;
  const teto = op.esperaMaximaMs ?? 8000;
  const dormir = op.dormir ?? dormirPadrao;
  const aleatorio = op.aleatorio ?? Math.random;
  const tokens = new Map<string, string>();

  /** token permanente por host, emitido SÓ quando o host consta nos consentimentos gravados. */
  function tokenDe(host: string): string {
    if (!listaDeHosts(op.hostsConsentidos).has(host)) {
      const velho = tokens.get(host);
      if (velho !== undefined) op.consentimento.revogar(velho);
      tokens.delete(host);
      throw new RedeErro("consent_required", host);
    }
    op.consentimento.permitirHost(host);
    let t = tokens.get(host);
    if (t === undefined || !op.consentimento.valido(t, host)) {
      t = op.consentimento.conceder(host, { permanente: true });
      tokens.set(host, t);
    }
    return t;
  }

  return async (pedido) => {
    if (pedido.sinal?.aborted === true) throw new AbortadoErro();
    let u: URL;
    try {
      u = new URL(pedido.url);
    } catch {
      throw new RedeErro("requisicao_invalida");
    }
    if (u.username !== "" || u.password !== "") throw new RedeErro("requisicao_invalida", normalizarHost(u.hostname));
    const host = normalizarHost(u.hostname.replace(/^\[|\]$/g, ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new RedeErro("requisicao_invalida", host);
    const ehLoop = host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
    if (u.protocol === "http:" && !ehLoop) throw new RedeErro("https_obrigatorio", host);
    const metodo = pedido.metodo as MetodoHttp;
    let ultima: RespostaRag | null = null;
    for (let n = 0; n < tentativas; n++) {
      const token = tokenDe(host); // a cada tentativa: revogou no meio → para
      let resp: RespostaRag;
      try {
        const r = await comAborto(
          op.rede.requisitar({
            host,
            caminho: `${u.pathname}${u.search}`,
            metodo,
            ...(pedido.cabecalhos === undefined ? {} : { cabecalhos: pedido.cabecalhos }),
            ...(pedido.corpo === undefined ? {} : { corpo: pedido.corpo }),
            tokenDeConsentimento: token,
            timeout_ms: pedido.timeoutMs ?? op.timeoutPadraoMs ?? 15_000,
            max_bytes: op.maxBytes ?? 32 * 1024 * 1024,
            ...(u.port === "" ? {} : { porta: Number(u.port) }),
          }),
          pedido.sinal,
        );
        const status = r.status;
        resp = {
          ok: status >= 200 && status < 300,
          status,
          json: async () => r.json(),
          texto: async () => r.texto(),
          cabecalho: (nome) => r.cabecalhos[nome.toLowerCase()],
        };
        if (!STATUS_REPETIVEIS.has(status) || n === tentativas - 1) return resp;
        ultima = resp;
        const ra = Number(r.cabecalhos["retry-after"]);
        const espera = Number.isFinite(ra) && ra >= 0 ? Math.min(ra * 1000, teto) : Math.min(teto, base * 2 ** n) * (0.5 + aleatorio() * 0.5);
        await dormir(espera, pedido.sinal);
      } catch (e) {
        if (e instanceof AbortadoErro) throw e;
        if (e instanceof RedeErro) {
          const repetivel = e.codigo === "falha_rede" || e.codigo === "timeout";
          if (!repetivel || n === tentativas - 1) throw e;
          await dormir(Math.min(teto, base * 2 ** n) * (0.5 + aleatorio() * 0.5), pedido.sinal);
          continue;
        }
        if (e instanceof Error && e.name === "AbortError") throw e;
        throw new Error(sanitizarErro(e instanceof Error ? e.message : "falha de rede", []));
      }
    }
    if (ultima !== null) return ultima;
    throw new RedeErro("falha_rede", host);
  };
}
