// Interface do motor de fala para texto (Fase 11, T-11.06): porta com adaptadores trocáveis (comando local do usuário, HTTP compatível opt-in) e falsos de teste.
// O app NUNCA baixa nem instala runtime de STT (D-60). Erros são nominais e NUNCA carregam áudio, texto de fala, chave nem saída do processo.
import type { CodigoErroVoz, IdiomaVoz } from "../../../compartilhado/captura";

export class ErroMotor extends Error {
  constructor(readonly codigo: CodigoErroVoz, mensagem: string) {
    super(mensagem);
    this.name = "ErroMotor";
  }
}

export interface OpcoesTranscricao {
  /** SEMPRE explícito (a detecção automática erra: bug da spec 07). */
  idioma: IdiomaVoz;
  modelo: string | null;
  /** dica de grafia (termos do dicionário). */
  prompt: string;
  sinal?: AbortSignal;
}

export interface MotorStt {
  transcrever(wav: Uint8Array, op: OpcoesTranscricao): Promise<string>;
}

/** Leitor tolerante: JSON com `text`/`transcript`/`transcription` (string ou lista de segmentos) ou texto puro. */
export function lerTranscricao(saida: string): string {
  const t = saida.trim();
  if (t === "") return "";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t) as unknown;
      const achar = (v: unknown): string | null => {
        if (typeof v === "string") return v;
        if (Array.isArray(v)) { const partes = v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x !== null ? achar((x as Record<string, unknown>)["text"]) : null)).filter((x): x is string => x !== null); return partes.length > 0 ? partes.join(" ") : null; }
        if (typeof v === "object" && v !== null) {
          const o = v as Record<string, unknown>;
          for (const k of ["text", "transcript", "transcription"]) { const r = achar(o[k]); if (r !== null) return r; }
        }
        return null;
      };
      const r = achar(j);
      if (r !== null) return r.trim();
    } catch { /* texto que começa com { mas não é JSON: vale como texto puro */ }
  }
  return t;
}
