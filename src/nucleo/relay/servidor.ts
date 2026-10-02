// Servidor do relay (T-22.08, D-365/D-366). ÚNICO módulo do relay que ESCUTA numa porta (como `src/nucleo/remoto/servidor.ts` é o único do app: D-322). Roda na VPS do dono, FORA do pacote
// do app (electron-builder o exclui). Superfície mínima: `GET /healthz` (só de interface interna) e o upgrade WebSocket em `/v1/canal/*`; todo o resto é o MESMO 404; `CONNECT` e métodos
// estranhos fecham; NENHUMA requisição de saída (nem fetch, nem DNS, nem proxy: o relay nunca é cliente). Só `node:http` + `node:crypto` (sem `ws`: D-365). A `Origin` nunca é lida (AX-31).
// Quem decide o que passa é o roteador PURO; aqui só há sockets, frames (ws-servidor) e timers.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { LIMITES_RELAY } from "./protocolo";
import { chaveDeIp, type ConfigLimites } from "./limites";
import { criarLog, type Log } from "./log";
import { criarRoteador, type Acao, type Metricas, type Roteador } from "./roteador";
import { aceitarChave, chaveValida, criarLeitor, quadro, quadroFechar } from "./ws-servidor";

export interface OpcoesRelay {
  /** interface de escuta (vem do ambiente; dentro do contêiner é a rede interna do compose). */
  bind: string;
  porta: number;
  /** atrás do Caddy: o IP do cliente é a ÚLTIMA entrada de X-Forwarded-For (a que o proxy acrescentou). Padrão: false. */
  confiarProxy?: boolean;
  limites?: Partial<ConfigLimites>;
  agora?: () => number;
  log?: Log;
  idleMs?: number;
  maxFilaBytes?: number;
}
export interface ServidorRelay {
  porta: number;
  metricas(): Metricas;
  conexoes(): number;
  fechar(): Promise<void>;
}

const CORPO_404 = JSON.stringify({ e: "nao_encontrado" });
const CAMINHO_WS = /^\/v1\/canal\/[A-Za-z0-9._~-]{0,64}$/;
const INTERNO = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|fc|fd|::ffff:(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.))/i;

function responder(res: ServerResponse, status: number, corpo: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Length", Buffer.byteLength(corpo));
  res.end(corpo);
}

/** `/healthz` só para GET, sem query, de interface interna e sem `X-Forwarded-For` (atrás do proxy, de fora, some: 404 como o resto). */
export function healthzPermitido(p: { metodo: string | undefined; url: string | undefined; remoto: string | undefined; xff: string | string[] | undefined }): boolean {
  return p.metodo === "GET" && p.url === "/healthz" && INTERNO.test(p.remoto ?? "") && p.xff === undefined;
}

export function iniciarRelay(o: OpcoesRelay): Promise<ServidorRelay> {
  const agora = o.agora ?? Date.now;
  const log = o.log ?? criarLog({ agora, saida: (l) => process.stdout.write(`${l}\n`) });
  const router: Roteador = criarRoteador({ relogio: { agora }, aleatorio: randomBytes, ...(o.limites === undefined ? {} : { limites: o.limites }), log: (e) => log.registrar(e === "host_registrado" ? "host_registrado" : "cliente_conectado") });
  const idleMs = o.idleMs ?? 90_000;
  const maxFila = o.maxFilaBytes ?? 1024 * 1024;
  interface Ligacao {
    socket: Duplex;
    ip: string;
    fechando: boolean;
  }
  const ligacoes = new Map<string, Ligacao>();
  let seq = 0;

  const ipDe = (req: IncomingMessage): string => {
    if (o.confiarProxy === true) {
      const x = req.headers["x-forwarded-for"];
      const ultimo = (Array.isArray(x) ? x.join(",") : (x ?? "")).split(",").map((s) => s.trim()).filter(Boolean).pop();
      if (ultimo !== undefined && /^[0-9a-fA-F:.]{3,45}$/.test(ultimo)) return chaveDeIp(ultimo);
    }
    return chaveDeIp(req.socket.remoteAddress ?? "desconhecido");
  };
  const escrever = (l: Ligacao, buf: Buffer): void => {
    if (l.socket.destroyed) return;
    if (l.socket.writableLength > maxFila) return void l.socket.destroy(); // consumidor lento: derruba (backpressure)
    l.socket.write(buf);
  };
  const encerrar = (id: string, codigo: number, atrasoMs: number): void => {
    const l = ligacoes.get(id);
    if (l === undefined || l.fechando) return;
    l.fechando = true;
    const fim = (): void => {
      if (l.socket.destroyed) return;
      l.socket.write(quadroFechar(codigo));
      l.socket.end();
      setTimeout(() => l.socket.destroy(), 1000).unref();
    };
    if (atrasoMs > 0) setTimeout(fim, atrasoMs).unref();
    else fim();
  };
  const executar = (acoes: Acao[]): void => {
    for (const a of acoes) {
      if (a.k === "fechar") {
        encerrar(a.con, a.codigo, a.atrasoMs ?? 0);
        continue;
      }
      const l = ligacoes.get(a.para);
      if (l === undefined || l.fechando) continue;
      escrever(l, a.k === "texto" ? quadro("texto", a.texto) : quadro("binario", a.dados));
    }
  };

  const http: Server = createServer({ maxHeaderSize: 8 * 1024 }, (req, res) => {
    const caminho = (req.url ?? "").split("?")[0];
    if (healthzPermitido({ metodo: req.method, url: req.url, remoto: req.socket.remoteAddress, xff: req.headers["x-forwarded-for"] })) {
      log.registrar("healthz");
      return responder(res, 200, JSON.stringify({ ok: true }));
    }
    responder(res, 404, CORPO_404); // tudo o mais, inclusive /healthz de fora, é o mesmo 404
  });
  http.headersTimeout = LIMITES_RELAY.handshake_ms;
  http.requestTimeout = LIMITES_RELAY.handshake_ms;
  http.keepAliveTimeout = 2_000;
  http.on("connect", (_req, socket) => socket.destroy()); // nunca é proxy (AX-32)
  http.on("clientError", (_e, socket) => socket.destroy());
  http.on("error", () => undefined);
  http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const chave = req.headers["sec-websocket-key"];
    const ok =
      req.method === "GET" &&
      CAMINHO_WS.test(req.url ?? "") &&
      /(^|,)\s*websocket\s*(,|$)/i.test(String(req.headers["upgrade"] ?? "")) &&
      /upgrade/i.test(String(req.headers["connection"] ?? "")) &&
      req.headers["sec-websocket-version"] === "13" &&
      chaveValida(chave);
    if (!ok) {
      socket.end(`HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: ${CORPO_404.length}\r\nConnection: close\r\n\r\n${CORPO_404}`);
      return;
    }
    const ip = ipDe(req);
    const id = `c${++seq}`;
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${aceitarChave(chave)}\r\n\r\n`);
    const l: Ligacao = { socket, ip, fechando: false };
    ligacoes.set(id, l);
    if (typeof (socket as unknown as { setTimeout?: (ms: number, f: () => void) => void }).setTimeout === "function") (socket as unknown as { setTimeout(ms: number, f: () => void): void }).setTimeout(idleMs, () => socket.destroy());
    (socket as unknown as { setNoDelay?: (b: boolean) => void }).setNoDelay?.(true);
    log.registrar("conexao", ip);
    const antes = router.conectar(id, ip);
    executar(antes);
    const leitor = criarLeitor(() => (router.ativa(id) ? LIMITES_RELAY.quadro_max : LIMITES_RELAY.quadro_pre_auth));
    const tratar = (chunk: Buffer): void => {
      if (l.fechando) return;
      for (const ev of leitor.alimentar(chunk)) {
        if ("erro" in ev) return void encerrar(id, ev.erro, 0);
        switch (ev.op) {
          case "texto":
            executar(router.controle(id, ev.dados.toString("utf8")));
            break;
          case "binario":
            executar(router.binario(id, ev.dados));
            break;
          case "ping":
            escrever(l, quadro("pong", ev.dados));
            break;
          case "fechar":
            encerrar(id, 1000, 0);
            break;
          default:
            break; // pong ignorado
        }
        if (l.fechando) return;
      }
    };
    socket.on("data", tratar);
    socket.on("error", () => undefined);
    socket.on("close", () => {
      ligacoes.delete(id);
      log.registrar("desconexao", ip);
      executar(router.desconectar(id));
    });
    if (head.length > 0) tratar(head);
  });

  const varredura = setInterval(() => executar(router.varrer()), 1000);
  varredura.unref();
  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen({ host: o.bind, port: o.porta, exclusive: true }, () => {
      http.off("error", reject);
      http.on("error", () => log.registrar("erro_servidor"));
      const a = http.address();
      log.registrar("iniciado");
      resolve({
        porta: typeof a === "object" && a !== null ? a.port : o.porta,
        metricas: () => router.metricas(),
        conexoes: () => ligacoes.size,
        fechar: () =>
          new Promise<void>((ok) => {
            clearInterval(varredura);
            for (const l of ligacoes.values()) l.socket.destroy();
            ligacoes.clear();
            const fallback = setTimeout(() => ok(), 1500);
            fallback.unref();
            http.close(() => {
              clearTimeout(fallback);
              log.registrar("encerrado");
              ok();
            });
            http.closeAllConnections?.();
          }),
      });
    });
  });
}
