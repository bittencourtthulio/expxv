import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// Servidor REST FALSO em 127.0.0.1 (porta efêmera) para os testes dos provedores só-REST. Nunca sai para a rede.

export interface RotaFake {
  status?: number;
  json?: unknown;
  texto?: string;
  cabecalhos?: Record<string, string>;
  /** Escreve `bytes` de log em streaming. */
  bytes?: number;
  atrasoMs?: number;
}
export interface PedidoFake {
  metodo: string;
  caminho: string;
  query: string;
  cabecalhos: IncomingMessage["headers"];
  corpo: string;
}
export interface ServidorFake {
  url: string;
  pedidos: PedidoFake[];
  rotas: Map<string, RotaFake>;
  rota(metodoCaminho: string, r: RotaFake): void;
  fechar(): Promise<void>;
}

/** Rotas por `"GET /caminho"` (sem query). Sem rota: 404. */
export async function criarServidorFake(rotas: Record<string, RotaFake> = {}): Promise<ServidorFake> {
  const mapa = new Map<string, RotaFake>(Object.entries(rotas));
  const pedidos: PedidoFake[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const partes: Buffer[] = [];
    req.on("data", (b: Buffer) => partes.push(b));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://x");
      pedidos.push({ metodo: req.method ?? "", caminho: u.pathname, query: u.search, cabecalhos: req.headers, corpo: Buffer.concat(partes).toString("utf8") });
      const r = mapa.get(`${req.method} ${u.pathname}`) ?? { status: 404, json: { error: "not found" } };
      const responder = (): void => {
        res.statusCode = r.status ?? 200;
        for (const [k, v] of Object.entries(r.cabecalhos ?? {})) res.setHeader(k, v);
        if (r.bytes !== undefined) {
          const bloco = Buffer.alloc(1024 * 1024, "linha de log 0123456789 abcdefghij\n");
          let falta = r.bytes;
          const escrever = (): void => {
            while (falta > 0) {
              const n = Math.min(falta, bloco.length);
              falta -= n;
              if (!res.write(bloco.subarray(0, n))) return void res.once("drain", escrever);
            }
            res.end();
          };
          escrever();
          return;
        }
        if (r.json !== undefined) {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(r.json));
        } else res.end(r.texto ?? "");
      };
      if (r.atrasoMs) setTimeout(responder, r.atrasoMs);
      else responder();
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const porta = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${porta}`,
    pedidos,
    rotas: mapa,
    rota: (k, r) => void mapa.set(k, r),
    fechar: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
