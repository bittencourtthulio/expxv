// `hash-256-v1`: feature hashing assinado (tokens + bigramas + trigramas de caracteres, TF sublinear, L2). Sem estado e sem IDF
// por máquina: idêntico bit a bit em qualquer máquina, logo COMPARTILHÁVEL numa coleção online. Implementação única da Fase 8.
import { embutirHash } from "../../memoria/vetorial/embedding";
import { DIMENSAO_HASH, MODELO_HASH_ID, PESO_VETORIAL_HASH } from "../constantes";
import type { ProvedorEmbedding } from "./provedor";

export { embutirHash };

export function criarProvedorHash(): ProvedorEmbedding {
  return {
    id: MODELO_HASH_ID,
    dimensao: DIMENSAO_HASH,
    qualidade: PESO_VETORIAL_HASH,
    local: true,
    disponivel: () => Promise.resolve(true),
    embutir: (textos) => Promise.resolve(textos.map((t) => embutirHash(t, DIMENSAO_HASH))),
  };
}
