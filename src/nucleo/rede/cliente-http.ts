// Cliente HTTP ÚNICO do app (Fase 9, D-58/D-114): é o ÚNICO módulo de `src/` que abre conexão de rede (`http`/`https`; nada de `fetch`).
// Regras (todas checadas ANTES de abrir socket, exceto as de transporte):
//  1. consentimento: cada chamada exige `tokenDeConsentimento` válido para o host (ação do usuário) → senão `consent_required`;
//  2. host na allowlist de consentimentos gravados → senão `host_nao_permitido` (IP literal, localhost e rede privada nunca);
//  3. https obrigatório (loopback http SÓ com `permitirLoopbackHttp` injetado, para servidores falsos de teste);
//  4. não segue redirecionamento para outro host (nem rebaixa para http); no mesmo host segue até 3 saltos;
//  5. timeout total (`requisitar`) / até os cabeçalhos + ocioso (`stream`), teto de bytes, abortando a conexão;
//  6. nunca registra cabeçalhos, corpo nem query; erros têm texto fixo; sem cookies, sem Referer, sem telemetria;
//  7. proxy do sistema respeitado (`resolverProxy` injetado; padrão: HTTPS_PROXY/NO_PROXY do ambiente) via CONNECT.
import http, { type ClientRequest, type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type Socket } from "node:net";
import tls from "node:tls";
import { normalizarHost, type RegistroConsentimento } from "./consentimento";
import { RedeErro } from "./erros";

export type MetodoHttp = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
const METODOS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const MAX_SALTOS = 3;
const MAX_BYTES_PADRAO = 1024 * 1024;
const MAX_BYTES_STREAM_PADRAO = 16 * 1024 * 1024;
const TIMEOUT_PADRAO_MS = 10_000;
const OCIOSO_PADRAO_MS = 30_000;
const CABECALHOS_PROIBIDOS = new Set(["cookie", "referer", "host", "connection", "content-length", "transfer-encoding", "proxy-authorization", "accept-encoding"]);

export interface PedidoRede {
  /** nome do host (sem esquema/porta/caminho). */
  host: string;
  /** começa com `/`; pode ter query (nunca é logada). */
  caminho: string;
  metodo?: MetodoHttp;
  cabecalhos?: Record<string, string>;
  corpo?: string | Uint8Array;
  tokenDeConsentimento: string;
  /** padrão 10 s. */
  timeout_ms?: number;
  /** padrão 1 MiB (`requisitar`) / 16 MiB (`stream`). */
  max_bytes?: number;
  /** só loopback de teste ou host com porta própria; padrão 443. */
  porta?: number;
  /** `stream`: ocioso entre pedaços (padrão 30 s). */
  ocioso_ms?: number;
  /** aborta DE VERDADE a conexão (destrói o socket), inclusive antes dos cabeçalhos (long polling). Aditivo (Fase 20). */
  sinal?: AbortSignal;
  /**
   * Aditivo (Fase 11, voz local): hosts DE DESTINO que um redirecionamento pode alcançar além do host consentido (CDN de arquivos do mesmo provedor). Exato (`cdn.exemplo.com`) ou
   * curinga de sufixo (`*.exemplo.com`, nunca o domínio nu nem um TLD). Só https, porta padrão, sem credenciais, nunca IP literal. Vem do catálogo versionado, nunca do renderer.
   * Nenhum cabeçalho de credencial é reenviado pelo cliente (não há cookies nem Referer), então o salto só leva o que o pedido já levava.
   */
  redirecionar_para?: readonly string[];
}

export interface RespostaRede {
  status: number;
  cabecalhos: Record<string, string>;
  corpo: Buffer;
  texto(): string;
  json<T = unknown>(): T;
}
export interface RespostaStream {
  status: number;
  cabecalhos: Record<string, string>;
  corpo: AsyncIterable<Buffer>;
  cancelar(): void;
}

export type ResolverProxy = (url: string) => Promise<string | null> | string | null;

export interface OpcoesClienteRede {
  consentimento: RegistroConsentimento;
  /** SÓ para servidores falsos de teste: libera `http://` em loopback. Nunca ligado em produção. */
  permitirLoopbackHttp?: boolean;
  /** "DIRECT"/`null` = sem proxy; `PROXY h:p`, `http://h:p`, `HTTPS h:p`. Padrão: variáveis de ambiente. */
  resolverProxy?: ResolverProxy;
  /** uma linha por chamada: método, host, caminho SEM query, status, ms. Passa pelo `scrub`. */
  log?: (linha: string) => void;
  /** ex.: `cofre.scrubSincrono`. Aplicado a log e a mensagens de erro nativas. */
  scrub?: (texto: string) => string;
}

export interface ClienteRede {
  requisitar(p: PedidoRede): Promise<RespostaRede>;
  stream(p: PedidoRede): Promise<RespostaStream>;
}

const PADRAO_REDIRECT = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** `*.exemplo.com` casa `a.exemplo.com` (não `exemplo.com`); o padrão precisa de ao menos dois rótulos depois do curinga. */
export function casaRedirect(host: string, padroes: readonly string[]): boolean {
  return padroes.some((p) => {
    if (!p.startsWith("*.")) return host === p;
    const sufixo = p.slice(1); // ".exemplo.com"
    return host.endsWith(sufixo) && host.length > sufixo.length;
  });
}

const ehLoopback = (h: string): boolean => h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);

function proxyDoAmbiente(urlAlvo: string): string | null {
  const env = process.env;
  const alvo = new URL(urlAlvo);
  const semProxy = (env.NO_PROXY ?? env.no_proxy ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const h = alvo.hostname.toLowerCase();
  if (semProxy.some((e) => e === "*" || h === e.replace(/^\./, "") || h.endsWith(`.${e.replace(/^\./, "")}`))) return null;
  return (alvo.protocol === "https:" ? (env.HTTPS_PROXY ?? env.https_proxy) : (env.HTTP_PROXY ?? env.http_proxy)) ?? env.ALL_PROXY ?? env.all_proxy ?? null;
}

function lerProxy(bruto: string | null): URL | null {
  if (bruto === null) return null;
  const t = bruto.trim();
  if (t === "" || /^DIRECT$/i.test(t)) return null;
  const m = /^(PROXY|HTTPS?)\s+(\S+)$/i.exec(t.split(";")[0] as string);
  const texto = m ? `http://${m[2]}` : /^[a-z]+:\/\//i.test(t) ? t : `http://${t}`;
  try {
    const u = new URL(texto);
    return u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

function tunel(proxy: URL, host: string, porta: number, aoCriar: (r: ClientRequest) => void): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const cab: Record<string, string> = { host: `${host}:${porta}` };
    if (proxy.username !== "") cab["proxy-authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
    const req = http.request({ host: proxy.hostname, port: Number(proxy.port || 80), method: "CONNECT", path: `${host}:${porta}`, headers: cab });
    aoCriar(req);
    req.once("connect", (res, socket) => {
      if (res.statusCode === 200) resolve(socket);
      else {
        socket.destroy();
        reject(new RedeErro("proxy_falhou", host, `status ${res.statusCode ?? 0}`));
      }
    });
    req.once("error", (e) => reject(e instanceof RedeErro ? e : new RedeErro("proxy_falhou", host, (e as NodeJS.ErrnoException).code)));
    req.end();
  });
}

function minusculas(h: IncomingMessage["headers"]): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined) saida[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  return saida;
}

export function criarClienteRede(op: OpcoesClienteRede): ClienteRede {
  const { consentimento } = op;
  const scrub = op.scrub ?? ((t: string): string => t);
  const resolverProxy: ResolverProxy = op.resolverProxy ?? proxyDoAmbiente;

  const linhaLog = (metodo: string, host: string, caminho: string, status: number | string, ms: number): void => {
    if (op.log === undefined) return;
    const semQuery = caminho.split("?")[0] as string;
    op.log(scrub(`rede ${metodo} ${host}${semQuery} -> ${status} ${Math.round(ms)}ms`));
  };

  /** valida TUDO antes de qualquer socket. */
  function validar(p: PedidoRede, max_bytes: number, timeout_ms: number): { url: URL; metodo: MetodoHttp; host: string; loopback: boolean } {
    if (typeof p !== "object" || p === null || typeof p.host !== "string" || typeof p.caminho !== "string") throw new RedeErro("requisicao_invalida");
    const host = normalizarHost(p.host);
    if (!consentimento.valido(p.tokenDeConsentimento, host)) throw new RedeErro("consent_required", host);
    if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) && !ehLoopback(host)) throw new RedeErro("host_nao_permitido", host);
    const loopback = ehLoopback(host);
    if (!consentimento.hostPermitido(host)) throw new RedeErro("host_nao_permitido", host);
    if (loopback && op.permitirLoopbackHttp !== true) throw new RedeErro("host_nao_permitido", host);
    if (!loopback && (isIP(host) !== 0 || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal"))) throw new RedeErro("host_nao_permitido", host);
    const metodo = (p.metodo ?? "GET") as MetodoHttp;
    if (!METODOS.includes(metodo)) throw new RedeErro("requisicao_invalida", host);
    if (!p.caminho.startsWith("/") || /[\s\u0000-\u001f]/.test(p.caminho) || p.caminho.startsWith("//")) throw new RedeErro("requisicao_invalida", host);
    const porta = p.porta ?? (loopback ? 80 : 443);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new RedeErro("requisicao_invalida", host);
    if (!Number.isFinite(max_bytes) || max_bytes < 1 || !Number.isFinite(timeout_ms) || timeout_ms < 1) throw new RedeErro("requisicao_invalida", host);
    for (const [k, v] of Object.entries(p.cabecalhos ?? {})) {
      if (!/^[A-Za-z0-9-]+$/.test(k) || CABECALHOS_PROIBIDOS.has(k.toLowerCase()) || typeof v !== "string" || /[\r\n\0]/.test(v)) throw new RedeErro("requisicao_invalida", host);
    }
    if (p.redirecionar_para !== undefined) {
      const lista = p.redirecionar_para;
      if (!Array.isArray(lista) || lista.length > 8 || lista.some((x) => typeof x !== "string" || !PADRAO_REDIRECT.test(x) || (x.startsWith("*.") && x.split(".").length < 3))) throw new RedeErro("requisicao_invalida", host);
      if (loopback && lista.length > 0 && op.permitirLoopbackHttp !== true) throw new RedeErro("requisicao_invalida", host);
    }
    let url: URL;
    try {
      url = new URL(`${loopback ? "http" : "https"}://${host.includes(":") ? `[${host}]` : host}:${porta}${p.caminho}`);
    } catch {
      throw new RedeErro("requisicao_invalida", host);
    }
    if (!loopback && url.protocol !== "https:") throw new RedeErro("https_obrigatorio", host);
    return { url, metodo, host, loopback };
  }

  interface Estado {
    req: ClientRequest | null;
    res: IncomingMessage | null;
    erro: RedeErro | null;
    timer: NodeJS.Timeout | null;
    soltarSinal?: () => void;
  }
  const abortar = (e: Estado, erro: RedeErro): void => {
    e.erro ??= erro;
    e.req?.destroy();
    e.res?.destroy();
  };
  const limparTimer = (e: Estado): void => {
    if (e.timer !== null) clearTimeout(e.timer);
    e.timer = null;
  };
  /** liga o `AbortSignal` do pedido ao aborto real do socket; `soltarSinal` remove o ouvinte (fim da resposta ou do stream). */
  const ligarSinal = (e: Estado, sinal: AbortSignal | undefined, host: string): void => {
    if (sinal === undefined) return;
    const aoAbortar = (): void => abortar(e, new RedeErro("falha_rede", host, "cancelado"));
    if (sinal.aborted) aoAbortar();
    else sinal.addEventListener("abort", aoAbortar, { once: true });
    e.soltarSinal = () => {
      sinal.removeEventListener("abort", aoAbortar);
      delete e.soltarSinal;
    };
  };

  async function viagem(e: Estado, url: URL, metodo: MetodoHttp, host: string, p: PedidoRede, loopback: boolean): Promise<IncomingMessage> {
    const corpo = p.corpo === undefined ? undefined : typeof p.corpo === "string" ? Buffer.from(p.corpo, "utf8") : Buffer.from(p.corpo);
    const cab: Record<string, string> = { ...(p.cabecalhos ?? {}), "accept-encoding": "identity", connection: "close" };
    if (corpo !== undefined) cab["content-length"] = String(corpo.length);
    const porta = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    const proxy = loopback ? null : lerProxy(await Promise.resolve(resolverProxy(url.toString())));
    const base = { host: url.hostname, port: porta, path: `${url.pathname}${url.search}`, method: metodo, headers: cab };
    let opcoesReq: https.RequestOptions | http.RequestOptions = base;
    if (proxy !== null) {
      const socket = await tunel(proxy, host, porta, (r) => (e.req = r));
      if (e.erro) {
        socket.destroy();
        throw e.erro;
      }
      opcoesReq = { ...base, createConnection: () => tls.connect({ socket, servername: host }) };
    }
    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = (loopback ? http : https).request(opcoesReq as https.RequestOptions, (res) => {
        e.res = res;
        resolve(res);
      });
      e.req = req;
      req.once("error", (err) => {
        reject(e.erro ?? new RedeErro("falha_rede", host, scrub((err as NodeJS.ErrnoException).code ?? "erro")));
      });
      if (corpo !== undefined) req.write(corpo);
      req.end();
    });
  }

  async function abrir(p: PedidoRede, max_bytes: number, timeout_ms: number, estado: Estado): Promise<{ res: IncomingMessage; host: string }> {
    const v = validar(p, max_bytes, timeout_ms);
    if (!consentimento.consumir(p.tokenDeConsentimento, v.host)) throw new RedeErro("consent_required", v.host);
    ligarSinal(estado, p.sinal, v.host);
    if (estado.erro) throw estado.erro;
    estado.timer = setTimeout(() => abortar(estado, new RedeErro("timeout", v.host)), timeout_ms);
    estado.timer.unref?.();
    let url = v.url;
    let metodo = v.metodo;
    let corpoEnvio = p;
    for (let salto = 0; ; salto++) {
      const res = await viagem(estado, url, metodo, salto === 0 ? v.host : normalizarHost(url.hostname), corpoEnvio, v.loopback);
      const status = res.statusCode ?? 0;
      const local = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && typeof local === "string") {
        res.resume();
        res.destroy();
        let destino: URL;
        try {
          destino = new URL(local, url);
        } catch {
          throw new RedeErro("redirect_outro_host", v.host);
        }
        const hostDestino = normalizarHost(destino.hostname);
        const mesmoHost = hostDestino === v.host && destino.port === url.port && destino.protocol === url.protocol;
        const lista = p.redirecionar_para;
        const producao = !v.loopback && lista !== undefined && destino.protocol === "https:" && destino.port === "" && destino.username === "" && destino.password === "" && isIP(hostDestino) === 0 && casaRedirect(hostDestino, lista);
        // SÓ servidores falsos de teste (a mesma opção que libera `http://` em loopback): salto entre portas de loopback listadas
        const teste = v.loopback && op.permitirLoopbackHttp === true && lista !== undefined && ehLoopback(hostDestino) && destino.username === "" && lista.includes(hostDestino);
        const hostPermitidoNoPedido = producao || teste;
        if (!mesmoHost && !hostPermitidoNoPedido) throw new RedeErro("redirect_outro_host", v.host);
        if (salto >= MAX_SALTOS) throw new RedeErro("redirect_demais", v.host);
        if (status === 301 || status === 302 || status === 303) {
          if (metodo !== "GET" && metodo !== "HEAD") metodo = "GET";
          const { corpo: _c, ...resto } = corpoEnvio;
          corpoEnvio = resto;
        }
        url = destino;
        estado.res = null;
        continue;
      }
      return { res, host: v.host };
    }
  }

  const traduzir = (e: Estado, host: string, err: unknown): RedeErro => e.erro ?? (err instanceof RedeErro ? err : new RedeErro("falha_rede", host, scrub((err as NodeJS.ErrnoException)?.code ?? "erro")));

  return {
    async requisitar(p) {
      const inicio = performance.now();
      const max = p.max_bytes ?? MAX_BYTES_PADRAO;
      const timeout = p.timeout_ms ?? TIMEOUT_PADRAO_MS;
      const estado: Estado = { req: null, res: null, erro: null, timer: null };
      const hostLog = typeof p?.host === "string" ? normalizarHost(p.host) : "?";
      try {
        const { res, host } = await abrir(p, max, timeout, estado);
        const declarado = Number(res.headers["content-length"] ?? 0);
        if (Number.isFinite(declarado) && declarado > max) {
          abortar(estado, new RedeErro("resposta_grande_demais", host));
          throw estado.erro;
        }
        const partes: Buffer[] = [];
        let total = 0;
        try {
          for await (const parte of res) {
            total += (parte as Buffer).length;
            if (total > max) {
              abortar(estado, new RedeErro("resposta_grande_demais", host));
              throw estado.erro;
            }
            partes.push(parte as Buffer);
          }
        } catch (e) {
          throw traduzir(estado, host, e);
        }
        if (estado.erro) throw estado.erro;
        const corpo = Buffer.concat(partes);
        linhaLog(p.metodo ?? "GET", host, p.caminho, res.statusCode ?? 0, performance.now() - inicio);
        return {
          status: res.statusCode ?? 0,
          cabecalhos: minusculas(res.headers),
          corpo,
          texto: () => corpo.toString("utf8"),
          json: <T>() => JSON.parse(corpo.toString("utf8")) as T,
        };
      } catch (e) {
        const erro = traduzir(estado, hostLog, e);
        if (typeof p?.caminho === "string") linhaLog(p.metodo ?? "GET", hostLog, p.caminho, erro.codigo, performance.now() - inicio);
        throw erro;
      } finally {
        limparTimer(estado);
        estado.soltarSinal?.();
      }
    },

    async stream(p) {
      const inicio = performance.now();
      const max = p.max_bytes ?? MAX_BYTES_STREAM_PADRAO;
      const timeout = p.timeout_ms ?? TIMEOUT_PADRAO_MS;
      const ocioso = p.ocioso_ms ?? OCIOSO_PADRAO_MS;
      const estado: Estado = { req: null, res: null, erro: null, timer: null };
      const hostLog = typeof p?.host === "string" ? normalizarHost(p.host) : "?";
      let res: IncomingMessage;
      let host: string;
      try {
        ({ res, host } = await abrir(p, max, timeout, estado));
      } catch (e) {
        limparTimer(estado);
        estado.soltarSinal?.();
        const erro = traduzir(estado, hostLog, e);
        if (typeof p?.caminho === "string") linhaLog(p.metodo ?? "GET", hostLog, p.caminho, erro.codigo, performance.now() - inicio);
        throw erro;
      }
      limparTimer(estado);
      linhaLog(p.metodo ?? "GET", host, p.caminho, res.statusCode ?? 0, performance.now() - inicio);
      const armarOcioso = (): void => {
        limparTimer(estado);
        estado.timer = setTimeout(() => abortar(estado, new RedeErro("timeout", host)), ocioso);
        estado.timer.unref?.();
      };
      async function* corpo(): AsyncGenerator<Buffer> {
        let total = 0;
        try {
          armarOcioso();
          for await (const parte of res) {
            total += (parte as Buffer).length;
            if (total > max) {
              abortar(estado, new RedeErro("resposta_grande_demais", host));
              throw estado.erro;
            }
            armarOcioso();
            yield parte as Buffer;
          }
          if (estado.erro) throw estado.erro;
        } catch (e) {
          throw traduzir(estado, host, e);
        } finally {
          limparTimer(estado);
          estado.soltarSinal?.();
        }
      }
      return { status: res.statusCode ?? 0, cabecalhos: minusculas(res.headers), corpo: corpo(), cancelar: () => abortar(estado, new RedeErro("falha_rede", host, "cancelado")) };
    },
  };
}
