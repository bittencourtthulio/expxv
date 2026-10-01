import { StringDecoder } from "node:string_decoder";
import { classificarErroForge, parseJson, semSegredos, validarHost } from "./comum";
import { ForgeAutenticacaoErro, ForgeEntradaInvalidaErro, ForgeNaoSuportadoErro, ForgeRedeErro, INSTALACAO } from "./erros";
import type { EstadoForge, OpcoesLeitura, ProvedorForge, RepoRef, ResultadoLog } from "./forge";

// Cliente REST mínimo para provedores sem CLI (Bitbucket, Azure DevOps). A credencial é SEMPRE injetada (cofre do SO,
// resolvido pelo main): nunca vem de env/arquivo daqui e nunca aparece em erro, log, evento ou URL.

export interface CredencialRest {
  esquema: "Bearer" | "Basic";
  /** Bearer: o token. Basic: `usuario:senha` (o cliente codifica) ou o valor já em base64. */
  valor: string;
}
export interface ConfigRest {
  repo: RepoRef;
  credencial: () => Promise<CredencialRest | undefined>;
  baseUrl?: string;
  /** Permite `http://` só para 127.0.0.1/localhost (testes com servidor falso). */
  permitirLoopback?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
export interface OpcoesReq {
  acao: string;
  query?: Record<string, string | number | boolean | undefined>;
  corpo?: unknown;
  signal?: AbortSignal;
  maxBytes?: number;
  /** Códigos 4xx tolerados (devolvidos em vez de lançar). */
  tolerar?: number[];
}
export interface RespostaRest {
  status: number;
  json: unknown;
  texto: string;
  truncado: boolean;
  cabecalhos: Headers;
}
export interface ClienteRest {
  readonly base: string;
  temCredencial(): Promise<boolean>;
  requisitar(metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", caminho: string, o: OpcoesReq): Promise<RespostaRest>;
  /** GET em streaming (logs): nada é acumulado. */
  stream(caminho: string, o: OpcoesReq & { aoPedaco: (t: string) => void }): Promise<ResultadoLog>;
}

const TETO_PADRAO = 4 * 1024 * 1024;
export const TETO_LOG_REST = 128 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function validarBase(bruta: string, loopback: boolean): string {
  let u: URL;
  try {
    u = new URL(bruta);
  } catch {
    throw new ForgeEntradaInvalidaErro("baseUrl", "URL inválida");
  }
  if (u.username || u.password) throw new ForgeEntradaInvalidaErro("baseUrl", "sem credencial na URL");
  const ok = u.protocol === "https:" || (u.protocol === "http:" && loopback && LOOPBACK.has(u.hostname));
  if (!ok) throw new ForgeEntradaInvalidaErro("baseUrl", "só https é permitido");
  if (!LOOPBACK.has(u.hostname)) validarHost(u.host);
  return u.origin + u.pathname.replace(/\/+$/, "");
}

export function criarClienteRest(provedor: ProvedorForge, cfg: ConfigRest, baseUrlPadrao: string): ClienteRest {
  const base = validarBase(cfg.baseUrl ?? baseUrlPadrao, cfg.permitirLoopback === true);
  const origem = new URL(base).origin;
  const f = cfg.fetch ?? fetch;
  const timeoutPadrao = cfg.timeoutMs ?? 30_000;

  async function abrir(metodo: string, caminho: string, o: OpcoesReq, timeoutMs: number, aceitar: string): Promise<{ res: Response; limpar: () => void; redigir: (t: string) => string }> {
    const cred = await cfg.credencial();
    if (!cred || typeof cred.valor !== "string" || cred.valor === "") throw new ForgeAutenticacaoErro(provedor);
    const codificado = cred.esquema === "Basic" && cred.valor.includes(":") ? Buffer.from(cred.valor).toString("base64") : cred.valor;
    const redigir = (t: string): string => {
      let r = semSegredos(t);
      for (const s of [cred.valor, codificado, ...cred.valor.split(":")]) if (s.length >= 4) r = r.split(s).join("[oculto]");
      return r;
    };
    const url = new URL(`${base}/${caminho.replace(/^\/+/, "")}`);
    if (url.origin !== origem) throw new ForgeEntradaInvalidaErro("caminho", "fora do servidor configurado");
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.append(k, String(v));
    const headers: Record<string, string> = { Authorization: `${cred.esquema} ${codificado}`, Accept: aceitar, "User-Agent": "forge-rest" };
    let body: string | undefined;
    if (o.corpo !== undefined) {
      body = JSON.stringify(o.corpo);
      headers["Content-Type"] = "application/json";
    }
    const ctl = new AbortController();
    let estourou = false;
    const relogio = setTimeout(() => ((estourou = true), ctl.abort()), timeoutMs);
    const aoAbortar = (): void => ctl.abort();
    if (o.signal?.aborted) ctl.abort();
    o.signal?.addEventListener("abort", aoAbortar, { once: true });
    const limpar = (): void => {
      clearTimeout(relogio);
      o.signal?.removeEventListener("abort", aoAbortar);
    };
    try {
      const res = await f(url, { method: metodo, headers, ...(body !== undefined ? { body } : {}), redirect: "error", signal: ctl.signal });
      return { res, limpar, redigir };
    } catch (e) {
      limpar();
      if (o.signal?.aborted) throw e;
      if (estourou) throw new ForgeRedeErro(`tempo limite de ${timeoutMs} ms`);
      const causa = (e as { cause?: { message?: string } }).cause?.message ?? (e instanceof Error ? e.message : String(e));
      throw new ForgeRedeErro(redigir(causa));
    }
  }

  async function lerLimitado(res: Response, max: number, aoPedaco?: (t: string) => void): Promise<{ texto: string; bytes: number; truncado: boolean }> {
    const dec = new StringDecoder("utf8");
    const partes: string[] = [];
    let bytes = 0;
    let truncado = false;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        let b = Buffer.from(value);
        if (bytes + b.length > max) {
          b = b.subarray(0, Math.max(0, max - bytes));
          truncado = true;
        }
        bytes += b.length;
        const t = dec.write(b);
        if (t) (aoPedaco ? aoPedaco(t) : partes.push(t));
        if (truncado) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
    const resto = dec.end();
    if (resto) (aoPedaco ? aoPedaco(resto) : partes.push(resto));
    return { texto: partes.join(""), bytes, truncado };
  }

  async function falha(res: Response, o: OpcoesReq, redigir: (t: string) => string): Promise<never> {
    const corpo = await lerLimitado(res, 4096).catch(() => ({ texto: "" }));
    throw classificarErroForge(provedor, redigir(`HTTP ${res.status} ${res.statusText} ${corpo.texto.replace(/\s+/g, " ").slice(0, 300)}`), o.acao, res.status);
  }

  return {
    base,
    async temCredencial() {
      const c = await cfg.credencial();
      return !!c && typeof c.valor === "string" && c.valor !== "";
    },
    async requisitar(metodo, caminho, o) {
      const { res, limpar, redigir } = await abrir(metodo, caminho, o, timeoutPadrao, "application/json");
      try {
        if (res.status >= 400 && !o.tolerar?.includes(res.status)) return await falha(res, o, redigir);
        const l = await lerLimitado(res, o.maxBytes ?? TETO_PADRAO);
        return { status: res.status, json: l.truncado ? undefined : parseJson(l.texto), texto: l.texto, truncado: l.truncado, cabecalhos: res.headers };
      } catch (e) {
        if (o.signal?.aborted) throw e;
        if (e instanceof Error && e.name === "AbortError") throw new ForgeRedeErro(`tempo limite de ${timeoutPadrao} ms`);
        throw e;
      } finally {
        limpar();
      }
    },
    async stream(caminho, o) {
      const { res, limpar, redigir } = await abrir("GET", caminho, o, Math.max(timeoutPadrao, 600_000), "text/plain, */*");
      try {
        if (res.status >= 400) return await falha(res, o, redigir);
        const l = await lerLimitado(res, o.maxBytes ?? TETO_LOG_REST, o.aoPedaco);
        return { bytes: l.bytes, truncado: l.truncado };
      } finally {
        limpar();
      }
    },
  };
}

// ---- utilitários comuns aos adaptadores REST ----------------------------------------------------

export function naoSuportado(provedor: ProvedorForge, recurso: string): never {
  throw new ForgeNaoSuportadoErro(provedor, recurso);
}
export async function estadoRest(provedor: "bitbucket" | "azure", repo: RepoRef, cli: ClienteRest): Promise<EstadoForge> {
  const autenticado = await cli.temCredencial();
  return { provedor, cli: { nome: "rest", instalada: true, versao: null }, autenticado, contas: [], repo, degradado: !autenticado, instrucao: autenticado ? null : INSTALACAO[provedor] };
}
export const sigDe = (op: OpcoesLeitura | { signal?: AbortSignal } | undefined): { signal?: AbortSignal } => (op?.signal ? { signal: op.signal } : {});
export const limiteRest = (n: number | undefined, padrao = 30): number => Math.min(Math.max(Math.trunc(n ?? padrao), 1), 100);
export const enc = encodeURIComponent;
