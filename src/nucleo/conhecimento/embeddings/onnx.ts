// ONNX local (ex.: multilingual-e5-small int8, 384 d): adaptador pronto e testado com runtime FALSO. A dependência real
// (`@huggingface/transformers`, WASM) e o download do modelo (botão na UI, P-50) são ligados pelo coordenador no main.
import { PESO_VETORIAL_REAL } from "../constantes";
import { normalizarL2, type ProvedorEmbedding } from "./provedor";

/** Porta do runtime: quem a implementa carrega o modelo de `<userData>/modelos/` (nunca baixa sozinho). */
export interface RuntimeEmbedding {
  /** modelo presente e carregável? (não baixa) */
  pronto(): Promise<boolean>;
  embutir(textos: string[], sinal?: AbortSignal): Promise<Array<Float32Array | number[]>>;
}

export function criarProvedorOnnx(o: { nome: string; dimensao: number; runtime: RuntimeEmbedding }): ProvedorEmbedding {
  return {
    id: `onnx:${o.nome}:${o.dimensao}`,
    dimensao: o.dimensao,
    qualidade: PESO_VETORIAL_REAL,
    local: true,
    disponivel: async () => {
      try {
        return await o.runtime.pronto();
      } catch {
        return false;
      }
    },
    async embutir(textos, sinal) {
      const saida: Float32Array[] = [];
      for (let i = 0; i < textos.length; i += 16) {
        const lote = textos.slice(i, i + 16);
        const r = await o.runtime.embutir(lote, sinal);
        if (r.length !== lote.length) throw new Error("runtime devolveu quantidade de vetores diferente da pedida");
        for (const v of r) {
          if (v.length !== o.dimensao) throw new Error(`runtime devolveu dimensão ${v.length}, esperada ${o.dimensao}`);
          saida.push(normalizarL2(v));
        }
      }
      return saida;
    },
  };
}
