// Chamadas entre a thread do main e a thread do servidor MCP. O servidor MCP (SDK + zod, ~200 ms só
// para carregar) roda numa worker thread para nunca parar o event loop do main (P-12); as portas de
// domínio continuam no main e chegam ao servidor como chamadas assíncronas por mensagem.
// Só dados clonáveis cruzam a fronteira; `ErroMcp` é reconstruído do outro lado com code/subcode.
import { CODIGOS_ERRO, ErroMcp, SUBCODIGOS_ERRO, type CodigoErro, type SubcodigoErro } from "../nucleo/mcp/erros";

/** O que MessagePort, Worker e parentPort têm em comum. */
export interface PortaDeMensagens {
  postMessage(mensagem: unknown): void;
  on(evento: "message", ouvinte: (mensagem: unknown) => void): unknown;
  off?(evento: "message", ouvinte: (mensagem: unknown) => void): unknown;
}

interface ErroSerializado {
  mcp: boolean;
  code?: string;
  subcode?: string;
  message: string;
}

interface Chamada { t: "rpc"; id: number; metodo: string; args: unknown[] }
interface Resposta { t: "resp"; id: number; ok: boolean; valor?: unknown; erro?: ErroSerializado }

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function serializarErro(erro: unknown): ErroSerializado {
  if (erro instanceof ErroMcp) return { mcp: true, code: erro.code, ...(erro.subcode === undefined ? {} : { subcode: erro.subcode }), message: erro.message };
  return { mcp: false, message: "falha interna" };
}

function reconstruirErro(e: ErroSerializado): Error {
  if (e.mcp && e.code !== undefined && (CODIGOS_ERRO as readonly string[]).includes(e.code)) {
    const sub = e.subcode !== undefined && (SUBCODIGOS_ERRO as readonly string[]).includes(e.subcode) ? (e.subcode as SubcodigoErro) : undefined;
    return new ErroMcp(e.code as CodigoErro, e.message, sub);
  }
  return new Error(e.message);
}

export type MetodosRpc = Record<string, (...args: never[]) => unknown>;

/** Lado que TEM as implementações (main): responde às chamadas do outro lado. Devolve quem desliga a escuta. */
export function atenderChamadas(porta: PortaDeMensagens, metodos: Readonly<Record<string, (...args: any[]) => unknown>>): () => void {
  const ouvinte = (m: unknown): void => {
    if (!ehObjeto(m) || m["t"] !== "rpc") return;
    const c = m as unknown as Chamada;
    const responder = (r: Omit<Resposta, "t" | "id">): void => {
      try { porta.postMessage({ t: "resp", id: c.id, ...r } satisfies Resposta); } catch { /* porta fechada */ }
    };
    const metodo = Object.hasOwn(metodos, c.metodo) ? metodos[c.metodo] : undefined;
    if (metodo === undefined || !Array.isArray(c.args)) {
      responder({ ok: false, erro: { mcp: false, message: "método desconhecido" } });
      return;
    }
    Promise.resolve()
      .then(() => metodo(...c.args))
      .then((valor) => responder({ ok: true, valor: valor === undefined ? null : valor }))
      .catch((erro: unknown) => responder({ ok: false, erro: serializarErro(erro) }));
  };
  porta.on("message", ouvinte);
  return () => porta.off?.("message", ouvinte);
}

export interface Chamador {
  chamar<T = unknown>(metodo: string, ...args: unknown[]): Promise<T>;
}

/** Lado que CHAMA (worker). */
export function criarChamador(porta: PortaDeMensagens): Chamador {
  let proximo = 0;
  const pendentes = new Map<number, { ok: (v: unknown) => void; falha: (e: Error) => void }>();
  porta.on("message", (m) => {
    if (!ehObjeto(m) || m["t"] !== "resp") return;
    const r = m as unknown as Resposta;
    const p = pendentes.get(r.id);
    if (p === undefined) return;
    pendentes.delete(r.id);
    if (r.ok) p.ok(r.valor);
    else p.falha(reconstruirErro(r.erro ?? { mcp: false, message: "falha interna" }));
  });
  return {
    chamar<T>(metodo: string, ...args: unknown[]): Promise<T> {
      const id = ++proximo;
      return new Promise<T>((ok, falha) => {
        pendentes.set(id, { ok: ok as (v: unknown) => void, falha });
        try {
          porta.postMessage({ t: "rpc", id, metodo, args } satisfies Chamada);
        } catch (e) {
          pendentes.delete(id);
          falha(e instanceof Error ? e : new Error("mensagem não clonável"));
        }
      });
    },
  };
}
