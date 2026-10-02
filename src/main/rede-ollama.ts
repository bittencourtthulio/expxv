// Ponte HTTP do Ollama no LOOPBACK (Fase 15, P-50): o worker do conhecimento pede por RPC e o main fala com `127.0.0.1` pelo cliente de rede
// ÚNICO do app. Este cliente é DEDICADO: o registro de consentimento só conhece o loopback (nada de internet passa por aqui) e o
// `permitirLoopbackHttp` só vale para ele. Recusa qualquer host que não seja loopback, credencial na URL e caminho fora de `/api/`.
import { criarClienteRede, type ClienteRede } from "../nucleo/rede/cliente-http";
import { criarRegistroConsentimento } from "../nucleo/rede/consentimento";

export interface PedidoOllama {
  url: string;
  metodo: "GET" | "POST";
  corpo?: string;
}
export interface RespostaOllama {
  ok: boolean;
  status: number;
  texto: string;
}

const LOOPBACKS = new Set(["127.0.0.1", "localhost", "::1"]);

export function criarRedeOllama(op: { cliente?: ClienteRede } = {}): (p: PedidoOllama, sinal?: AbortSignal) => Promise<RespostaOllama> {
  const consentimento = criarRegistroConsentimento();
  consentimento.permitirHost("127.0.0.1");
  const token = consentimento.conceder("127.0.0.1", { permanente: true });
  const cliente = op.cliente ?? criarClienteRede({ consentimento, permitirLoopbackHttp: true });
  return async (p, sinal) => {
    let u: URL;
    try {
      u = new URL(p.url);
    } catch {
      throw new Error("URL do Ollama inválida");
    }
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!LOOPBACKS.has(host) || u.protocol !== "http:" || u.username !== "" || u.password !== "") throw new Error("O Ollama só é acessado no loopback");
    if (!u.pathname.startsWith("/api/")) throw new Error("caminho do Ollama não permitido");
    if (p.metodo !== "GET" && p.metodo !== "POST") throw new Error("método não permitido");
    if (sinal?.aborted) throw new Error("cancelado");
    const porta = u.port === "" ? 80 : Number(u.port);
    const r = await cliente.requisitar({ host: "127.0.0.1", porta, caminho: `${u.pathname}${u.search}`, metodo: p.metodo, ...(p.corpo === undefined ? {} : { corpo: p.corpo, cabecalhos: { "content-type": "application/json" } }), tokenDeConsentimento: token, timeout_ms: 8_000, max_bytes: 2 * 1024 * 1024 });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, texto: r.texto() };
  };
}
