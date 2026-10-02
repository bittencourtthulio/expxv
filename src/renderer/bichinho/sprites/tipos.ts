// Sistema de partes do Bichinho (D-674): uma espécie nova é uma RECEITA declarativa (arquétipo de corpo + partes + paleta + traços), nunca um SVG solto.
export const ARQUETIPOS = ["felino", "canino", "roedor", "ursino", "ungulado", "primata", "ave", "aquatica", "peixe", "reptil", "anfibio", "salamandra", "inseto", "aracnideo", "medusa", "estrela", "crustaceo", "caracol"] as const;
export type ArquetipoId = (typeof ARQUETIPOS)[number];

export const ORELHAS = ["ponta", "tufo", "redonda", "pequena", "longa", "caida", "leque", "morcego", "lateral", "grande", "banana", "nenhuma"] as const;
export type OrelhaId = (typeof ORELHAS)[number];

export const CAUDAS = ["longa", "tufo", "curta", "fina", "chata", "listrada", "leque", "enrolada", "ponta", "pena", "nenhuma"] as const;
export type CaudaId = (typeof CAUDAS)[number];

/** focinho (mamíferos, répteis, peixes) ou bico (aves). */
export const FOCINHOS = ["longo", "largo", "croc", "tromba", "chato", "porco", "nariz", "tubo", "bicoD", "reto", "curvo", "pelicano", "fino", "grosso", "flamingo"] as const;
export type FocinhoId = (typeof FOCINHOS)[number];

export const EXTRAS = [
  "chifre", "chifres", "galhada", "galhadaL", "juba", "la", "crista", "topete", "espinhos", "casco", "domo", "bandas", "asas", "aletas", "asasI", "asasB", "asasL", "asasM", "antenas", "antenasL",
  "corcova", "pescoco", "ossicones", "presas", "presasJ", "bigodes", "bolsa", "dorsal", "jato", "raios", "raia", "mola", "dentes", "aneis", "papada", "lingua", "ventosas", "gills", "foices",
  "luz", "pincas", "caudaE", "pernaSalto", "faixa",
] as const;
export type ExtraId = (typeof EXTRAS)[number];

export const MARCAS = ["listras", "pintas", "pintasG", "mascara", "olheiras"] as const;
export type MarcaId = (typeof MARCAS)[number];

export const PALETAS = 19;

export interface Receita {
  /** arquétipo de corpo */
  a: ArquetipoId;
  /** paleta 0..17 (`.bi[data-pal]` em bichinho.css) */
  p: number;
  o?: OrelhaId;
  c?: CaudaId;
  f?: FocinhoId;
  x?: readonly ExtraId[];
  m?: MarcaId;
  /** corpo: fino, gordo, ant (formiga), agua/lula (medusa), nautilo (caracol) */
  v?: "fino" | "gordo" | "ant" | "agua" | "lula" | "nautilo";
  /** cabeça na cor secundária */
  hs?: 1;
  /** barriga branca (papel) */
  bl?: 1;
  /** cor do bico: a (aviso), e (escura), c (clara) */
  bc?: "e" | "c";
  /** traços de personalidade */
  t: readonly string[];
}
