// Ollama no LOOPBACK (`/api/embed`): usa os modelos que o usuário já tem; nunca baixa nada; recusa host que não seja loopback.
import { PESO_VETORIAL_REAL } from "../constantes";
import { normalizarL2, type ProvedorEmbedding } from "./provedor";

/** Transporte HTTP injetado (o main o monta sobre `src/nucleo/rede/cliente-http.ts`; este módulo NÃO abre socket). */
export type TransporteHttp = (pedido: { url: string; metodo: "GET" | "POST"; corpo?: string; sinal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class OllamaForaDoLoopbackErro extends Error {
  override name = "OllamaForaDoLoopbackErro";
  constructor() {
    super("O Ollama do conhecimento só aceita 127.0.0.1, localhost ou ::1: nada sai da máquina.");
  }
}

export function validarUrlLoopback(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new OllamaForaDoLoopbackErro();
  }
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (!(u.protocol === "http:" || u.protocol === "https:") || !(h === "127.0.0.1" || h === "localhost" || h === "::1") || u.username !== "" || u.password !== "") throw new OllamaForaDoLoopbackErro();
  return u;
}

export interface OpcoesOllama {
  url?: string;
  modelo: string;
  dimensao: number;
  transporte: TransporteHttp;
  timeoutMs?: number;
}

export function criarProvedorOllama(o: OpcoesOllama): ProvedorEmbedding & { listarModelos(): Promise<string[]> } {
  const base = validarUrlLoopback(o.url ?? "http://127.0.0.1:11434").origin;
  const limite = o.timeoutMs ?? 5000;
  const sinalCom = (s?: AbortSignal): AbortSignal => (s ? AbortSignal.any([s, AbortSignal.timeout(limite)]) : AbortSignal.timeout(limite));
  const listarModelos = async (): Promise<string[]> => {
    const r = await o.transporte({ url: `${base}/api/tags`, metodo: "GET", sinal: AbortSignal.timeout(Math.min(limite, 1500)) });
    if (!r.ok) return [];
    const j = (await r.json()) as { models?: Array<{ name?: string }> };
    return (j.models ?? []).map((m) => m.name ?? "").filter((n) => n !== "");
  };
  return {
    id: `ollama:${o.modelo}:${o.dimensao}`,
    dimensao: o.dimensao,
    qualidade: PESO_VETORIAL_REAL,
    local: true,
    listarModelos,
    async disponivel() {
      try {
        const nomes = await listarModelos();
        return nomes.some((n) => n === o.modelo || n.startsWith(`${o.modelo}:`));
      } catch {
        return false;
      }
    },
    async embutir(textos, sinal) {
      const saida: Float32Array[] = [];
      for (let i = 0; i < textos.length; i += 32) {
        const lote = textos.slice(i, i + 32);
        const r = await o.transporte({ url: `${base}/api/embed`, metodo: "POST", corpo: JSON.stringify({ model: o.modelo, input: lote }), sinal: sinalCom(sinal) });
        if (!r.ok) throw new Error(`ollama respondeu ${r.status}`);
        const j = (await r.json()) as { embeddings?: number[][] };
        const e = j.embeddings;
        if (!Array.isArray(e) || e.length !== lote.length) throw new Error("ollama devolveu quantidade de vetores diferente da pedida");
        for (const v of e) {
          if (v.length !== o.dimensao) throw new Error(`ollama devolveu dimensão ${v.length}, esperada ${o.dimensao}`);
          saida.push(normalizarL2(v));
        }
      }
      return saida;
    },
  };
}
