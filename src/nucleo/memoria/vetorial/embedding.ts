// Embeddings da memória: interface injetada, local/offline por padrão. `hash-256-v1` é o piso determinístico (idêntico em toda
// máquina, 0 dependência, ≤ 1 ms/entrada). Provedor remoto só roda com consentimento explícito (nada sai da máquina por padrão).
import { MemoriaErro } from "../tipos";

export const MODELO_HASH = "hash-256-v1";

export interface ProvedorEmbedding {
  /** ex.: `hash-256-v1`, `ollama:nomic-embed-text:768`. */
  id: string;
  dimensao: number;
  /** true = nada sai da máquina (hash, Ollama em loopback, ONNX local). */
  local: boolean;
  /** vetores L2-normalizados, na mesma ordem dos textos. */
  embutir(textos: string[], sinal?: AbortSignal): Promise<Float32Array[]>;
}

function fnv1a(s: string, semente: number): number {
  let h = (0x811c9dc5 ^ semente) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const SEM_ACENTO = /[̀-ͯ]/g;

/** Feature hashing assinado de unigramas, bigramas e trigramas de caracteres, TF sublinear, L2. Determinístico bit a bit. */
export function embutirHash(texto: string, dimensao = 256): Float32Array {
  const v = new Float64Array(dimensao);
  const tokens = texto.normalize("NFKD").replace(SEM_ACENTO, "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0).slice(0, 2000);
  const contagem = new Map<string, number>();
  const somar = (f: string): void => void contagem.set(f, (contagem.get(f) ?? 0) + 1);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    if (t.length >= 2) somar(`u:${t}`);
    if (i + 1 < tokens.length) somar(`b:${t}_${tokens[i + 1] as string}`);
    if (t.length >= 4) for (let j = 0; j + 3 <= t.length; j++) somar(`c:${t.slice(j, j + 3)}`);
  }
  for (const [f, n] of contagem) {
    const h = fnv1a(f, 0);
    const peso = (1 + Math.log(n)) * (f.charCodeAt(0) === 99 /* c */ ? 0.5 : f.charCodeAt(0) === 98 /* b */ ? 0.8 : 1);
    v[h % dimensao] = (v[h % dimensao] as number) + (fnv1a(f, 0x9e3779b1) & 1 ? peso : -peso);
  }
  let norma = 0;
  for (let i = 0; i < dimensao; i++) norma += (v[i] as number) * (v[i] as number);
  const out = new Float32Array(dimensao);
  if (norma === 0) return out;
  const inv = 1 / Math.sqrt(norma);
  for (let i = 0; i < dimensao; i++) out[i] = Math.fround((v[i] as number) * inv);
  return out;
}

export function criarProvedorHash(dimensao = 256): ProvedorEmbedding {
  return { id: dimensao === 256 ? MODELO_HASH : `hash-${dimensao}-v1`, dimensao, local: true, embutir: (textos) => Promise.resolve(textos.map((t) => embutirHash(t, dimensao))) };
}

/** Provedor que NÃO é local só roda com consentimento vigente; sem ele lança antes de qualquer saída de dado. */
export function exigirConsentimento(p: ProvedorEmbedding, consentido: () => boolean): ProvedorEmbedding {
  if (p.local) return p;
  return {
    ...p,
    embutir(textos, sinal) {
      if (!consentido()) return Promise.reject(new MemoriaErro("unauthorized", "o provedor de embeddings online exige consentimento do usuário."));
      return p.embutir(textos, sinal);
    },
  };
}
