// Seletor da estratégia vetorial (DEC-1): `N × dim ≤ 25 M` → exato f32; senão sqlite-vec (se carregado) → exato int8 → pré-filtro
// lexical. O resultado nunca falha; só perde recall e marca `degradado`. Sem o binário do sqlite-vec o seletor devolve o exato.
import { LIMITE_EXATO_F32 } from "../constantes";
import { IndiceExato } from "./exato";
import { IndiceExatoInt8, type ResolverFloat } from "./exato-int8";
import type { IndiceVetorial } from "./indice";

export type Estrategia = "exato" | "sqlite_vec" | "exato_int8" | "prefiltro_lexical";

export interface EntradaSeletor {
  n: number;
  dim: number;
  /** o spike (T-15.01) provou que carrega E ganhou no benchmark? Sem isso nunca é escolhido. */
  sqlite_vec_ok?: boolean;
  /** teto de bytes do índice em RAM (padrão 120 MB, P-78). */
  memoria_max_bytes?: number;
}

export function escolherEstrategia(e: EntradaSeletor): Estrategia {
  const teto = e.memoria_max_bytes ?? 120 * 1024 * 1024;
  if (e.n * e.dim <= LIMITE_EXATO_F32 && e.n * e.dim * 4 <= teto) return "exato";
  if (e.sqlite_vec_ok === true) return "sqlite_vec";
  if (e.n * e.dim <= teto) return "exato_int8"; // 1 byte por componente
  return "prefiltro_lexical";
}

/** Cria o índice em RAM da estratégia; `sqlite_vec` e `prefiltro_lexical` caem no int8 (o pré-filtro é aplicado no Buscador). */
export function criarIndice(estrategia: Estrategia, dim: number, resolverFloat: ResolverFloat | null = null): IndiceVetorial {
  return estrategia === "exato" ? new IndiceExato(dim) : new IndiceExatoInt8(dim, 1024, resolverFloat);
}
