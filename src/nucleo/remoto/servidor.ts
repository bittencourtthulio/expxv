// Servidor local do controle remoto (T-13.15). ÚNICO módulo do núcleo que ESCUTA numa porta (o resto do app só faz conexões de saída por `nucleo/rede`). Decisão registrada em D-NN:
// a varredura de empacotamento libera `node:https` AQUI e prova, por teste próprio, que este arquivo só usa `createServer` (nenhum `request`/`get`/`fetch`: nunca é cliente).
// Camadas, nesta ordem, TODAS antes de qualquer rota: IP de origem permitido -> bloqueio/limite de taxa por IP -> `Host` exato -> `Origin` mesmo-origem -> método/caminho/Content-Type
// -> corpo <= 16 KiB. Tudo o que falha vira o MESMO 404 (sem versão, sem nome do produto, sem lista de dispositivos). Sem CORS (página de terceiro não lê nada). Bind SÓ no IP escolhido.
import { createServer as criarHttp, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as criarHttps } from "node:https";
import type { Socket } from "node:net";
import { LIMITES, criarBloqueioIp, criarLimiteJanela, hostPermitido, ipDeBindPermitido, normalizarIp, origemDoNavegadorPermitida, origemPermitida, type RelogioRede } from "./politica-rede";

export type TransporteServidor = "lan" | "loopback";
export interface RespostaRota {
  status: number;
  corpo: unknown;
}
export interface ContextoRota {
  ip: string;
}
export interface RotasRemoto {
  pareamentoInicio(corpo: unknown, c: ContextoRota): RespostaRota;
  pareamentoFim(corpo: unknown, c: ContextoRota): RespostaRota;
  pareamentoStatus(corpo: unknown, c: ContextoRota): RespostaRota;
  sessaoInicio(corpo: unknown, c: ContextoRota): RespostaRota;
  canal(corpo: unknown, c: ContextoRota): Promise<RespostaRota>;
}
export type MotivoRecusa = "ip_nao_permitido" | "ip_bloqueado" | "limite_de_taxa" | "host" | "origin" | "rota" | "metodo" | "tipo" | "corpo_grande" | "json";

export interface DepsManipulador {
  relogio: RelogioRede;
  transporte: TransporteServidor;
  endereco: () => string;
  porta: () => number;
  hostsExtras: () => readonly string[];
  cgnat: () => boolean;
  rotas: RotasRemoto;
  aoRecusar?: (motivo: MotivoRecusa, ip: string) => void;
}

const ROTAS_POST = ["/v1/pareamento/inicio", "/v1/pareamento/fim", "/v1/pareamento/status", "/v1/sessao/inicio", "/v1/canal"] as const;
const CORPO_404 = JSON.stringify({ e: "nao_encontrado" });

function responder(res: ServerResponse, status: number, corpo: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Length", Buffer.byteLength(corpo));
  res.removeHeader("X-Powered-By");
  res.end(corpo);
}
const uniforme404 = (res: ServerResponse): void => responder(res, 404, CORPO_404);

export function criarManipulador(d: DepsManipulador): (req: IncomingMessage, res: ServerResponse) => void {
  const limiteIp = criarLimiteJanela(d.relogio, LIMITES.req_por_min_ip);
  const limiteIpCanal = criarLimiteJanela(d.relogio, LIMITES.req_canal_por_min_ip);
  const bloqueio = criarBloqueioIp(d.relogio);
  const rec = (motivo: MotivoRecusa, ip: string): void => d.aoRecusar?.(motivo, ip);

  return (req, res) => {
    const ip = normalizarIp(req.socket.remoteAddress ?? "");
    const opHost = { endereco: d.endereco(), porta: d.porta(), extras: d.hostsExtras(), transporte: d.transporte };
    // 1. origem de rede: só rede privada (ou loopback no modo túnel/teste). Fora disso: fecha sem responder nada.
    if (!origemPermitida(ip, d.transporte, { cgnat: d.cgnat() })) {
      rec("ip_nao_permitido", ip);
      req.socket.destroy();
      return;
    }
    // 2. bloqueio por pareamentos falhos e limite de taxa por IP (antes de qualquer autenticação)
    if (bloqueio.bloqueado(ip)) {
      rec("ip_bloqueado", ip);
      return responder(res, 429, JSON.stringify({ e: "limite_de_taxa" }));
    }
    if (!(((req.url ?? "") === "/v1/canal" ? limiteIpCanal : limiteIp).tentar(ip))) {
      rec("limite_de_taxa", ip);
      return responder(res, 429, JSON.stringify({ e: "limite_de_taxa" }));
    }
    // 3. Host exato (DNS rebinding) e 4. Origin mesma-origem (CSRF): tudo igual a "rota desconhecida"
    if (!hostPermitido(req.headers.host, opHost)) {
      rec("host", ip);
      return uniforme404(res);
    }
    const origin = req.headers.origin;
    if (!origemDoNavegadorPermitida(Array.isArray(origin) ? origin[0] : origin, opHost)) {
      rec("origin", ip);
      return uniforme404(res);
    }
    const caminho = (req.url ?? "").split("?")[0] ?? "";
    if (!(ROTAS_POST as readonly string[]).includes(caminho) || (req.url ?? "").includes("?")) {
      rec("rota", ip);
      return uniforme404(res);
    }
    if (req.method !== "POST") {
      rec("metodo", ip);
      return uniforme404(res);
    }
    if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"] ?? "")) {
      rec("tipo", ip);
      return uniforme404(res);
    }
    const declarado = Number(req.headers["content-length"] ?? "0");
    if (declarado > LIMITES.corpo_max) {
      rec("corpo_grande", ip);
      responder(res, 413, JSON.stringify({ e: "quadro_invalido" }));
      req.destroy();
      return;
    }
    const partes: Buffer[] = [];
    let total = 0;
    let estourou = false;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > LIMITES.corpo_max) {
        if (!estourou) {
          estourou = true;
          rec("corpo_grande", ip);
          responder(res, 413, JSON.stringify({ e: "quadro_invalido" }));
          req.destroy();
        }
        return;
      }
      partes.push(c);
    });
    req.on("error", () => undefined);
    req.on("end", () => {
      if (estourou) return;
      let corpo: unknown;
      try {
        corpo = JSON.parse(Buffer.concat(partes).toString("utf8"));
      } catch {
        rec("json", ip);
        return responder(res, 400, JSON.stringify({ e: "quadro_invalido" }));
      }
      const ctx = { ip };
      const enviar = (r: RespostaRota): void => {
        // pareamento recusado conta contra o IP (5 falhas -> bloqueio de 10 min)
        if (caminho.startsWith("/v1/pareamento/") && r.status >= 400 && r.status !== 429) bloqueio.registrarFalha(ip);
        responder(res, r.status, JSON.stringify(r.corpo));
      };
      try {
        switch (caminho) {
          case "/v1/pareamento/inicio": return enviar(d.rotas.pareamentoInicio(corpo, ctx));
          case "/v1/pareamento/fim": return enviar(d.rotas.pareamentoFim(corpo, ctx));
          case "/v1/pareamento/status": return enviar(d.rotas.pareamentoStatus(corpo, ctx));
          case "/v1/sessao/inicio": return enviar(d.rotas.sessaoInicio(corpo, ctx));
          default:
            void d.rotas.canal(corpo, ctx).then(enviar, () => responder(res, 500, JSON.stringify({ e: "falhou" })));
        }
      } catch {
        responder(res, 500, JSON.stringify({ e: "falhou" }));
      }
    });
  };
}

export interface ServidorRemoto {
  porta: number;
  endereco: string;
  conexoes(): number;
  fechar(): Promise<void>;
}
export interface OpcoesServidor {
  transporte: TransporteServidor;
  ip: string;
  porta: number;
  cgnat?: boolean;
  tls?: { key: string; cert: string };
  manipulador: (req: IncomingMessage, res: ServerResponse) => void;
}
export type ErroServidor = "porta_ocupada" | "bind_recusado" | "falhou";

/** `listen` SÓ no IP escolhido (nunca 0.0.0.0/::): IP fora da regra é recusado antes de abrir o socket. */
export function iniciarServidor(o: OpcoesServidor): Promise<ServidorRemoto> {
  return new Promise((resolve, reject) => {
    if (!ipDeBindPermitido(o.ip, o.transporte, { cgnat: o.cgnat === true })) return reject(Object.assign(new Error("bind_recusado"), { codigo: "bind_recusado" as ErroServidor }));
    if (o.transporte === "lan" && o.tls === undefined) return reject(Object.assign(new Error("bind_recusado"), { codigo: "bind_recusado" as ErroServidor }));
    const servidor: Server = o.tls === undefined ? criarHttp(o.manipulador) : (criarHttps({ key: o.tls.key, cert: o.tls.cert, minVersion: "TLSv1.2" }, o.manipulador) as unknown as Server);
    const sockets = new Set<Socket>();
    servidor.maxConnections = LIMITES.conexoes_max;
    servidor.headersTimeout = 8_000;
    servidor.requestTimeout = 10_000;
    servidor.keepAliveTimeout = 3_000;
    servidor.on("connection", (s: Socket) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    servidor.on("secureConnection", (s: Socket) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    servidor.on("tlsClientError", (_e: Error, s: Socket) => s.destroy());
    servidor.on("clientError", (_e: Error, s: Socket) => s.destroy());
    servidor.on("error", (e: NodeJS.ErrnoException) => reject(Object.assign(new Error(e.code ?? "falhou"), { codigo: (e.code === "EADDRINUSE" ? "porta_ocupada" : "falhou") as ErroServidor })));
    servidor.listen({ host: o.ip, port: o.porta, exclusive: true }, () => {
      const a = servidor.address();
      const porta = typeof a === "object" && a !== null ? a.port : o.porta;
      resolve({
        porta,
        endereco: o.ip,
        conexoes: () => sockets.size,
        fechar: () =>
          new Promise<void>((ok) => {
            for (const s of sockets) s.destroy();
            servidor.close(() => ok());
            servidor.closeAllConnections?.();
          }),
      });
    });
  });
}
