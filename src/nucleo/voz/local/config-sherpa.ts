// Configuração do `OfflineRecognizer` do sherpa-onnx-node por família de modelo (Fase 11, D-544). Puro: recebe a PASTA já verificada e devolve caminhos absolutos dentro dela.
import { join } from "node:path";
import type { IdiomaVoz } from "../../../compartilhado/captura";
import type { ModeloCatalogo } from "./catalogo";
import type { ConfigCarga } from "./protocolo";

const arquivo = (m: ModeloCatalogo, pasta: string, papel: string): string => {
  const a = m.arquivos.find((x) => x.papel === papel);
  if (a === undefined) throw new Error(`modelo ${m.id} sem arquivo ${papel}`);
  return join(pasta, a.nome);
};

/** `threads`: núcleos físicos aproximados (os de eficiência pesam pouco); máximo 4: mais que isso não acelera decodificação offline e disputa CPU com o app. */
export function threadsPadrao(cpus: number): number {
  return Math.max(1, Math.min(4, Math.floor(cpus / 2)));
}

export function montarConfigCarga(m: ModeloCatalogo, pastaModelos: string, idioma: IdiomaVoz, threads: number): ConfigCarga {
  const pasta = join(pastaModelos, m.id);
  const base = { featConfig: { sampleRate: 16_000, featureDim: 80 } };
  const comum = { tokens: arquivo(m, pasta, "vocabulario"), numThreads: threads, provider: "cpu", debug: 0 };
  let modelConfig: Record<string, unknown>;
  switch (m.familia) {
    case "nemo_transducer":
      modelConfig = { transducer: { encoder: arquivo(m, pasta, "encoder"), decoder: arquivo(m, pasta, "decoder"), joiner: arquivo(m, pasta, "joiner") }, modelType: "nemo_transducer", ...comum };
      break;
    case "whisper":
      modelConfig = { whisper: { encoder: arquivo(m, pasta, "encoder"), decoder: arquivo(m, pasta, "decoder"), language: idioma, task: "transcribe", tailPaddings: -1 }, ...comum };
      break;
    case "moonshine":
      modelConfig = {
        moonshine: { preprocessor: arquivo(m, pasta, "preprocessador"), encoder: arquivo(m, pasta, "encoder"), uncachedDecoder: arquivo(m, pasta, "decoder_sem_cache"), cachedDecoder: arquivo(m, pasta, "decoder_com_cache") },
        ...comum,
      };
      break;
  }
  return { chave: `${m.id}|${m.familia === "whisper" ? idioma : "-"}`, sherpa: { ...base, modelConfig }, trecho_max_s: m.trecho_max_s };
}
