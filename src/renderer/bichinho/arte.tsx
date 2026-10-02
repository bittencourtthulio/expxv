// Arte do Bichinho (D-467): SVG próprio, 14 espécies como DADOS (traços de cabeça, cauda, patas) sobre um molde comum de "cabeça grande, corpo curto".
// Nenhuma cor aqui: tudo por classe `bi-*` (bichinho.css), que lê `--bichinho-<espécie>` de tokens.css. Coordenadas no viewBox 0 0 64 64; chão em y = 60.
import type { ReactNode } from "react";
import type { EspecieId } from "../../compartilhado/bichinho";
import { montarArte } from "./sprites/montar";
import { RECEITAS } from "./sprites/receitas";

type Par = readonly [readonly [number, number], readonly [number, number]];

export interface Arte {
  /** centro dos olhos (esquerdo, direito) e raio. */
  olhos: Par;
  r: number;
  /** boca desenhada pelo humor (padrão) ou omitida quando a espécie tem bico, tromba ou língua própria. */
  boca: readonly [number, number] | null;
  /** atrás do corpo: cauda, orelhas grandes, pinças. */
  atras?: ReactNode;
  /** corpo: padrão é o oval com barriga clara. */
  corpo?: ReactNode;
  /** a cabeça e o que a compõe (orelhas, bochechas, crista). */
  cabeca: ReactNode;
  /** por cima do rosto, antes dos olhos: focinho, bico, tromba. */
  rosto?: ReactNode;
  /** paleta do sistema de partes (`data-pal`); as 14 legadas usam `--bichinho-<espécie>` e não têm. */
  pal?: number;
}

export type EspecieLegada = Exclude<EspecieId, keyof typeof RECEITAS>;

const CORPO_PADRAO = (
  <>
    <ellipse className="bi-p" cx="32" cy="47" rx="15" ry="11" />
    <ellipse className="bi-c bi-fraco" cx="32" cy="50" rx="9" ry="7" />
  </>
);

const bigodes = (y: number, x: number): ReactNode => <path className="bi-linha" d={`M${32 - x} ${y} l-9 -2 M${32 - x} ${y + 3} l-9 2 M${32 + x} ${y} l9 -2 M${32 + x} ${y + 3} l9 2`} />;

/** As 14 espécies originais, com o desenho de sempre (preservado). */
export const ARTE: Readonly<Record<EspecieLegada, Arte>> = {
  caranguejo: {
    olhos: [[26, 17], [38, 17]], r: 3, boca: [32, 36],
    atras: (
      <>
        <path className="bi-linha bi-grosso bi-pc" d="M18 46 L8 40 M46 46 L56 40" />
        <ellipse className="bi-p" cx="7" cy="32" rx="3" ry="6.5" transform="rotate(-22 7 32)" />
        <ellipse className="bi-p" cx="13" cy="33" rx="3" ry="6.5" transform="rotate(22 13 33)" />
        <ellipse className="bi-p" cx="57" cy="32" rx="3" ry="6.5" transform="rotate(22 57 32)" />
        <ellipse className="bi-p" cx="51" cy="33" rx="3" ry="6.5" transform="rotate(-22 51 33)" />
        <path className="bi-linha bi-pc" d="M16 54 L11 60 M23 57 L20 62 M41 57 L44 62 M48 54 L53 60" />
      </>
    ),
    corpo: (
      <>
        <ellipse className="bi-p" cx="32" cy="48" rx="20" ry="11" />
        <path className="bi-linha bi-escura" d="M20 46 Q32 40 44 46 M23 52 Q32 47 41 52" />
      </>
    ),
    cabeca: (
      <>
        <path className="bi-linha bi-grosso bi-pc" d="M26 31 L26 19 M38 31 L38 19" />
        <ellipse className="bi-p" cx="32" cy="32" rx="14" ry="9" />
      </>
    ),
  },
  piton: {
    olhos: [[26, 25], [38, 25]], r: 2.4, boca: null,
    atras: <path className="bi-p" d="M10 52 Q4 44 12 42 Q20 42 18 48 Z" />,
    corpo: (
      <>
        <ellipse className="bi-p" cx="32" cy="52" rx="21" ry="8.5" />
        <ellipse className="bi-p" cx="32" cy="45" rx="14" ry="7" />
        <path className="bi-d" d="M22 52 l3 -3 l3 3 l-3 3z M32 54 l3 -3 l3 3 l-3 3z M42 52 l3 -3 l3 3 l-3 3z M26 45 l2.5 -3 l2.5 3 l-2.5 3z M36 45 l2.5 -3 l2.5 3 l-2.5 3z" />
      </>
    ),
    cabeca: <path className="bi-p" d="M18 30 Q18 14 32 14 Q46 14 46 30 Q40 40 32 40 Q24 40 18 30Z" />,
    rosto: (
      <>
        <path className="bi-linha bi-r" d="M32 38 l0 7 l-2.4 3 M32 45 l2.4 3" />
        <path className="bi-linha bi-escura" d="M27 36 Q32 39 37 36" />
      </>
    ),
  },
  esquilo: {
    olhos: [[26, 27], [38, 27]], r: 2.5, boca: null,
    atras: (
      <>
        <path className="bi-p" d="M42 58 C62 54 62 20 46 18 C54 28 48 42 40 46 Z" />
        <path className="bi-c bi-fraco" d="M52 24 C58 30 58 40 52 46 C56 38 54 30 50 26Z" />
      </>
    ),
    cabeca: (
      <>
        <ellipse className="bi-p" cx="22" cy="14" rx="3.6" ry="5.5" />
        <ellipse className="bi-p" cx="42" cy="14" rx="3.6" ry="5.5" />
        <circle className="bi-p" cx="32" cy="28" r="14" />
        <ellipse className="bi-c bi-fraco" cx="25" cy="34" rx="5.5" ry="4.5" />
        <ellipse className="bi-c bi-fraco" cx="39" cy="34" rx="5.5" ry="4.5" />
      </>
    ),
    rosto: (
      <>
        <circle className="bi-e" cx="32" cy="32" r="1.8" />
        <rect className="bi-c" x="30.3" y="34" width="3.4" height="4" rx="1" />
        <path className="bi-linha bi-escura" d="M32 33 L32 35" />
      </>
    ),
  },
  raposa: {
    olhos: [[25.5, 27], [38.5, 27]], r: 2.3, boca: null,
    atras: (
      <>
        <path className="bi-p" d="M44 58 C64 56 62 28 50 24 C52 36 46 46 40 48 Z" />
        <path className="bi-c" d="M58 38 C62 44 60 52 52 55 C57 50 58 44 58 38Z" />
      </>
    ),
    cabeca: (
      <>
        <polygon className="bi-p" points="17,26 18,6 31,17" />
        <polygon className="bi-p" points="47,26 46,6 33,17" />
        <polygon className="bi-e" points="20,20 20.5,11 26,16" />
        <polygon className="bi-e" points="44,20 43.5,11 38,16" />
        <path className="bi-p" d="M16 28 Q16 14 32 14 Q48 14 48 28 Q44 36 32 42 Q20 36 16 28Z" />
        <path className="bi-c" d="M17 30 Q24 30 32 36 Q40 30 47 30 Q44 38 32 43 Q20 38 17 30Z" />
      </>
    ),
    rosto: <circle className="bi-e" cx="32" cy="41" r="2" />,
  },
  camaleao: {
    olhos: [[24, 27], [40, 27]], r: 3.6, boca: [32, 37],
    atras: <path className="bi-linha bi-grosso bi-pc" d="M44 54 Q60 56 58 44 Q56 36 49 40 Q46 44 50 46" />,
    cabeca: (
      <>
        <path className="bi-d" d="M23 20 L32 6 L41 20Z" />
        <ellipse className="bi-p" cx="32" cy="29" rx="15" ry="12" />
        <circle className="bi-c" cx="24" cy="27" r="6.2" />
        <circle className="bi-c" cx="40" cy="27" r="6.2" />
      </>
    ),
    rosto: <path className="bi-linha bi-escura" d="M20 36 Q32 41 44 36" />,
  },
  lontra: {
    olhos: [[26, 26], [38, 26]], r: 2.3, boca: null,
    atras: <path className="bi-p" d="M44 56 C58 58 64 50 58 44 C56 52 50 52 44 50Z" />,
    corpo: (
      <>
        <ellipse className="bi-p" cx="32" cy="48" rx="17" ry="11" />
        <ellipse className="bi-c bi-fraco" cx="32" cy="51" rx="11" ry="7" />
      </>
    ),
    cabeca: (
      <>
        <circle className="bi-p" cx="22" cy="17" r="3.5" />
        <circle className="bi-p" cx="42" cy="17" r="3.5" />
        <ellipse className="bi-p" cx="32" cy="28" rx="14.5" ry="12.5" />
        <ellipse className="bi-c" cx="32" cy="34" rx="8" ry="6" />
      </>
    ),
    rosto: (
      <>
        <ellipse className="bi-e" cx="32" cy="31.5" rx="2.6" ry="1.8" />
        <path className="bi-linha bi-escura" d="M32 33 L32 35 M29 36 Q32 38 35 36" />
        {bigodes(33, 8)}
      </>
    ),
  },
  tucano: {
    olhos: [[26, 25], [38, 25]], r: 2.4, boca: null,
    cabeca: (
      <>
        <ellipse className="bi-p" cx="32" cy="27" rx="14" ry="13" />
        <ellipse className="bi-c" cx="32" cy="29" rx="11" ry="9.5" />
      </>
    ),
    rosto: (
      <>
        <path className="bi-a" d="M22 31 Q32 28 42 31 Q39 47 32 49 Q25 47 22 31Z" />
        <path className="bi-d" d="M22 31 Q32 28 42 31 Q41 34 40 36 Q32 33 24 36 Q23 34 22 31Z" />
        <path className="bi-linha bi-escura" d="M32 32 L32 46" />
      </>
    ),
  },
  elefante: {
    olhos: [[26, 25], [38, 25]], r: 2, boca: null,
    atras: (
      <>
        <circle className="bi-p" cx="13" cy="28" r="11" />
        <circle className="bi-p" cx="51" cy="28" r="11" />
        <circle className="bi-c bi-fraco" cx="13" cy="28" r="7" />
        <circle className="bi-c bi-fraco" cx="51" cy="28" r="7" />
      </>
    ),
    cabeca: <ellipse className="bi-p" cx="32" cy="27" rx="14" ry="13.5" />,
    rosto: (
      <>
        <path className="bi-p" d="M27 32 Q25 46 31 52 Q35 54 36 49 Q33 45 37 32Z" />
        <path className="bi-linha bi-escura" d="M29 38 q3 2 6 0 M28 43 q3 2 6 0" />
        <path className="bi-c" d="M24 38 l-2 8 l6 -5z M40 38 l2 8 l-6 -5z" />
      </>
    ),
  },
  ourico: {
    olhos: [[27, 29], [37, 29]], r: 2.2, boca: null,
    atras: <polygon className="bi-escura-f" points="12,50 6,40 14,42 10,30 19,38 20,24 26,36 32,22 38,36 44,24 45,38 54,30 50,42 58,40 52,50" />,
    cabeca: (
      <>
        <polygon className="bi-escura-f" points="17,26 14,14 22,19 22,8 29,16 33,5 38,15 44,8 45,19 52,14 47,27" />
        <path className="bi-p" d="M18 30 Q18 17 32 17 Q46 17 46 30 Q42 38 32 42 Q22 38 18 30Z" />
        <ellipse className="bi-c" cx="32" cy="33" rx="9" ry="8" />
      </>
    ),
    rosto: (
      <>
        <circle className="bi-e" cx="32" cy="39" r="2" />
        <path className="bi-linha bi-escura" d="M29 36.5 Q32 38 35 36.5" />
      </>
    ),
  },
  coruja: {
    olhos: [[25.5, 28], [38.5, 28]], r: 3.6, boca: null,
    atras: <path className="bi-escura-f" d="M17 52 Q10 44 14 34 Q18 44 22 46Z M47 52 Q54 44 50 34 Q46 44 42 46Z" />,
    cabeca: (
      <>
        <polygon className="bi-p" points="17,26 15,8 29,17" />
        <polygon className="bi-p" points="47,26 49,8 35,17" />
        <circle className="bi-p" cx="32" cy="28" r="15" />
        <circle className="bi-c" cx="25.5" cy="28" r="8.5" />
        <circle className="bi-c" cx="38.5" cy="28" r="8.5" />
      </>
    ),
    rosto: <polygon className="bi-a" points="32,31 29,37 35,37" />,
  },
  polvo: {
    olhos: [[25.5, 28], [38.5, 28]], r: 3, boca: [32, 38],
    corpo: (
      <>
        <path className="bi-linha bi-grosso bi-pc" d="M20 40 Q10 50 18 58 Q22 62 26 57 M26 42 Q22 54 27 60 M38 42 Q42 54 37 60 M44 40 Q54 50 46 58 Q42 62 38 57" />
        <path className="bi-c" d="M15 52 h2 M20 59 h2 M43 59 h2 M47 52 h2" style={{ stroke: "var(--bi-claro)", strokeWidth: 2, strokeLinecap: "round" }} />
      </>
    ),
    cabeca: (
      <>
        <path className="bi-p" d="M16 36 Q14 12 32 12 Q50 12 48 36 Q40 42 32 42 Q24 42 16 36Z" />
        <circle className="bi-escura-f bi-fraco" cx="22" cy="19" r="2" />
        <circle className="bi-escura-f bi-fraco" cx="42" cy="17" r="2.4" />
        <circle className="bi-escura-f bi-fraco" cx="32" cy="15" r="1.6" />
      </>
    ),
  },
  gato: {
    olhos: [[26, 28], [38, 28]], r: 2.4, boca: null,
    atras: <path className="bi-linha bi-grosso bi-pc" d="M44 54 Q60 56 58 42 Q56 36 52 40" />,
    cabeca: (
      <>
        <polygon className="bi-p" points="17,25 18,7 30,16" />
        <polygon className="bi-p" points="47,25 46,7 34,16" />
        <polygon className="bi-c bi-fraco" points="20,20 20.5,12 26,16.5" />
        <polygon className="bi-c bi-fraco" points="44,20 43.5,12 38,16.5" />
        <ellipse className="bi-p" cx="32" cy="29" rx="15" ry="13" />
      </>
    ),
    rosto: (
      <>
        <polygon className="bi-r" points="32,33.5 29.8,31.5 34.2,31.5" />
        <path className="bi-linha bi-escura" d="M32 33.5 L32 35 M28 36 Q30 37.5 32 35 Q34 37.5 36 36" />
        {bigodes(33, 10)}
      </>
    ),
  },
  sapo: {
    olhos: [[24, 18], [40, 18]], r: 2.8, boca: null,
    atras: <path className="bi-p" d="M10 56 Q6 50 14 48 Q20 52 18 58Z M54 56 Q58 50 50 48 Q44 52 46 58Z" />,
    cabeca: (
      <>
        <circle className="bi-p" cx="24" cy="19" r="6" />
        <circle className="bi-p" cx="40" cy="19" r="6" />
        <ellipse className="bi-p" cx="32" cy="30" rx="18" ry="11" />
        <ellipse className="bi-c bi-fraco" cx="32" cy="37" rx="11" ry="4" />
      </>
    ),
    rosto: <path className="bi-linha bi-escura" d="M18 34 Q32 44 46 34" />,
  },
  urso: {
    olhos: [[26, 26], [38, 26]], r: 2.3, boca: null,
    atras: <path className="bi-p" d="M44 56 a4 4 0 1 0 6 0Z" />,
    corpo: (
      <>
        <ellipse className="bi-p" cx="32" cy="47" rx="17" ry="12" />
        <ellipse className="bi-c bi-fraco" cx="32" cy="50" rx="10" ry="8" />
      </>
    ),
    cabeca: (
      <>
        <circle className="bi-p" cx="21" cy="15" r="5.8" />
        <circle className="bi-p" cx="43" cy="15" r="5.8" />
        <circle className="bi-c bi-fraco" cx="21" cy="15" r="3" />
        <circle className="bi-c bi-fraco" cx="43" cy="15" r="3" />
        <circle className="bi-p" cx="32" cy="28" r="14.5" />
        <ellipse className="bi-c" cx="32" cy="34" rx="7.5" ry="5.8" />
      </>
    ),
    rosto: (
      <>
        <ellipse className="bi-e" cx="32" cy="31.5" rx="2.6" ry="1.8" />
        <path className="bi-linha bi-escura" d="M32 33 L32 35 M29 36.5 Q32 38.5 35 36.5" />
      </>
    ),
  },
};

export const CORPO = CORPO_PADRAO;

const montadas = new Map<EspecieId, Arte>();
/** Arte de qualquer das 100 espécies: a legada (desenho próprio) ou a montada da receita (uma vez por espécie). */
export function arteDe(especie: EspecieId): Arte {
  const legada = (ARTE as Readonly<Partial<Record<EspecieId, Arte>>>)[especie];
  if (legada !== undefined) return legada;
  let a = montadas.get(especie);
  if (a === undefined) {
    const r = (RECEITAS as Readonly<Partial<Record<EspecieId, (typeof RECEITAS)[keyof typeof RECEITAS]>>>)[especie];
    if (r === undefined) throw new Error(`Espécie sem receita: ${especie}`);
    a = montarArte(r);
    montadas.set(especie, a);
  }
  return a;
}
