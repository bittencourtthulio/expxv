// Embeddings por PORTA (T-15.07/12): local/offline por padrão. `hash-256-v1` é o piso obrigatório; Ollama (loopback) e ONNX local
// (runtime injetado) são modelos reais plugáveis por coleção. Nada aqui faz rede fora do loopback.
export interface ProvedorEmbedding {
  /** ex.: `hash-256-v1`, `ollama:nomic-embed-text:768`, `onnx:e5-small:384`. */
  id: string;
  dimensao: number;
  /** 0..1: peso do braço vetorial na fusão (hash = 0,5; modelo real = 1,0). */
  qualidade: number;
  /** true = nada sai da máquina. */
  local: boolean;
  disponivel(): Promise<boolean>;
  /** vetores L2-normalizados, na ordem dos textos. */
  embutir(textos: string[], sinal?: AbortSignal): Promise<Float32Array[]>;
}

export function normalizarL2(v: Float32Array | number[]): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += (v[i] as number) * (v[i] as number);
  const out = new Float32Array(v.length);
  if (n === 0) return out;
  const inv = 1 / Math.sqrt(n);
  for (let i = 0; i < v.length; i++) out[i] = Math.fround((v[i] as number) * inv);
  return out;
}
