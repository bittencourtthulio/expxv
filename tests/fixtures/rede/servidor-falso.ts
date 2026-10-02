// Servidor HTTP FALSO local (loopback, porta efêmera) para testar a camada de rede e o decisor. NUNCA rede real.
// Registra conexões e requisições (para provar "zero conexões sem consentimento" e inspecionar cabeçalhos recebidos).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export interface RequisicaoVista {
  metodo: string;
  caminho: string;
  cabecalhos: Record<string, string | string[] | undefined>;
  corpo: string;
}
export interface ServidorFalso {
  host: "127.0.0.1";
  porta: number;
  /** conexões TCP abertas desde o início. */
  conexoes(): number;
  requisicoes: RequisicaoVista[];
  fechar(): Promise<void>;
}
export type ManipuladorFalso = (req: IncomingMessage, res: ServerResponse, corpo: string, n: number) => void | Promise<void>;

export async function subirServidorFalso(manipulador: ManipuladorFalso): Promise<ServidorFalso> {
  const sockets = new Set<Socket>();
  let conexoes = 0;
  const requisicoes: RequisicaoVista[] = [];
  const servidor: Server = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (d: Buffer) => partes.push(d));
    req.on("end", () => {
      const corpo = Buffer.concat(partes).toString("utf8");
      requisicoes.push({ metodo: req.method ?? "", caminho: req.url ?? "", cabecalhos: { ...req.headers }, corpo });
      void Promise.resolve(manipulador(req, res, corpo, requisicoes.length)).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
  });
  servidor.on("connection", (s) => {
    conexoes++;
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const porta = (servidor.address() as { port: number }).port;
  return {
    host: "127.0.0.1",
    porta,
    conexoes: () => conexoes,
    requisicoes,
    fechar: () =>
      new Promise<void>((ok) => {
        for (const s of sockets) s.destroy();
        servidor.close(() => ok());
      }),
  };
}
