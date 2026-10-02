// Partes compartilhadas do sistema de partes (D-674). Tudo no viewBox 64, desenhado só do lado ESQUERDO quando é par (`par` espelha em x = 32).
// Cor só por classe `bi-*` (bichinho.css): p = pelo, c = claro, e = escuro, s = secundária da paleta.
import type { ReactNode } from "react";
import type { CaudaId, ExtraId, FocinhoId, MarcaId, OrelhaId } from "./tipos";

/** elipse da cabeça: o desenho das partes assume rx 15, topo em y 14; `G` desloca. */
export interface G { rx: number; ry: number; cy: number }
export type Camada = "A" | "C" | "B" | "F";

export const par = (n: ReactNode): ReactNode => <><g>{n}</g><g transform="matrix(-1 0 0 1 64 0)">{n}</g></>;
export const bigodes = (y: number, x: number): ReactNode => <path className="bi-linha" d={`M${32 - x} ${y} l-9 -2 M${32 - x} ${y + 3} l-9 2 M${32 + x} ${y} l9 -2 M${32 + x} ${y + 3} l9 2`} />;

const ORELHA: Readonly<Record<Exclude<OrelhaId, "nenhuma">, (c: string) => ReactNode>> = {
  ponta: (c) => <><polygon className={c} points="17,26 18,6 31,17" /><polygon className="bi-c bi-fraco" points="20,20 20.5,11 26,16" /></>,
  tufo: (c) => <><polygon className={c} points="17,26 18,8 31,17" /><polygon className="bi-c bi-fraco" points="20,20 20.5,13 26,16.5" /><path className="bi-linha bi-escura" d="M18.4 8 l-1.4 -6" /></>,
  redonda: (c) => <><circle className={c} cx="21" cy="17" r="5.6" /><circle className="bi-c bi-fraco" cx="21" cy="17" r="3" /></>,
  pequena: (c) => <circle className={c} cx="20" cy="18" r="3.4" />,
  longa: (c) => <><ellipse className={c} cx="24" cy="7" rx="4" ry="10.5" transform="rotate(-8 24 7)" /><ellipse className="bi-c bi-fraco" cx="24" cy="7.5" rx="2" ry="7.5" transform="rotate(-8 24 7)" /></>,
  caida: (c) => <ellipse className={c} cx="15.5" cy="31" rx="5" ry="10" transform="rotate(10 15.5 31)" />,
  leque: (c) => <><circle className={c} cx="13" cy="28" r="11" /><circle className="bi-c bi-fraco" cx="13" cy="28" r="7" /></>,
  morcego: (c) => <><polygon className={c} points="16,27 9,1 31,16" /><polygon className="bi-c bi-fraco" points="18.5,21 14,7 26,16" /></>,
  lateral: (c) => <><circle className={c} cx="16" cy="29" r="5.2" /><circle className="bi-c bi-fraco" cx="16" cy="29" r="3" /></>,
  banana: (c) => <><path className={c} d="M21 20 Q11 10 19 2 Q24 9 28 17Z" /><path className="bi-c bi-fraco" d="M21 17 Q15 10 19 6 Q23 10 25 16Z" /></>,
  grande: (c) => <><circle className={c} cx="17" cy="20" r="8.5" /><circle className="bi-c bi-fraco" cx="17" cy="20" r="5" /></>,
};

export function orelha(id: OrelhaId, cls: string, g: G): ReactNode {
  if (id === "nenhuma") return null;
  return <g transform={`translate(${15 - g.rx} ${g.cy - g.ry - 14})`}>{par(ORELHA[id](cls))}</g>;
}

const CAUDA: Readonly<Record<Exclude<CaudaId, "nenhuma">, ReactNode>> = {
  longa: <path className="bi-linha bi-grosso bi-pc" d="M44 54 Q60 56 58 42 Q56 36 52 40" />,
  tufo: <><path className="bi-p" d="M44 58 C64 56 62 28 50 24 C52 36 46 46 40 48 Z" /><path className="bi-c" d="M58 38 C62 44 60 52 52 55 C57 50 58 44 58 38Z" /></>,
  curta: <circle className="bi-p" cx="47.5" cy="55.5" r="3.6" />,
  fina: <path className="bi-linha bi-pc" style={{ strokeWidth: 2 }} d="M44 56 Q58 60 58 46" />,
  chata: <><ellipse className="bi-p bi-ct" cx="54" cy="57" rx="8" ry="3.4" transform="rotate(-12 54 57)" /><path className="bi-linha bi-escura" d="M48 56 l3 2 M52 55 l3 2 M56 54 l3 2" /></>,
  listrada: <><path className="bi-linha bi-grosso bi-pc" d="M44 54 Q60 56 58 42 Q56 36 52 40" /><path className="bi-linha bi-grosso bi-sc" style={{ strokeDasharray: "2.2 3.2" }} d="M44 54 Q60 56 58 42 Q56 36 52 40" /></>,
  leque: <>{[-70, -42, -14, 14, 42, 70].map((a) => <g key={a} transform={`rotate(${a} 32 44)`}><ellipse className="bi-p bi-ct" cx="32" cy="14" rx="4.6" ry="13" /><circle className="bi-d" cx="32" cy="8" r="2.2" /><circle className="bi-s" cx="32" cy="8" r="0.9" /></g>)}</>,
  enrolada: <path className="bi-linha bi-grosso bi-pc" d="M44 54 Q60 56 58 44 Q56 36 49 40 Q46 44 50 46" />,
  ponta: <path className="bi-p bi-ct" d="M44 57 Q58 59 62 51 Q55 55 46 49Z" />,
  pena: <>{par(<ellipse className="bi-s bi-ct" cx="14" cy="55" rx="8" ry="3" transform="rotate(-24 14 55)" />)}</>,
};
export const cauda = (id: CaudaId): ReactNode => (id === "nenhuma" ? null : CAUDA[id]);

const BICO: Readonly<Record<string, (c: string) => ReactNode>> = {
  reto: (c) => <path className={c} d="M28.5 31 L32 40 L35.5 31Z" />,
  curvo: (c) => <path className={c} d="M27.5 30 Q32 28.5 36.5 30 Q38 38 32 42 Q33 36 27.5 30Z" />,
  chato: (c) => <><ellipse className={c} cx="32" cy="35" rx="8" ry="3.8" /><path className="bi-linha bi-escura" d="M25 35.5 h14" /></>,
  pelicano: (c) => <><path className={c} d="M28 31 H36 L34 47 H30Z" /><path className="bi-c bi-ct" d="M26 36 Q32 56 38 36 Q32 41 26 36Z" /></>,
  fino: (c) => <path className={c} d="M31 32 L32 50 L33 32Z" />,
  grosso: (c) => <><path className={c} d="M24 30 Q32 27 40 30 Q40 44 32 47 Q24 44 24 30Z" /><path className="bi-linha bi-escura" d="M25 36 Q32 38 39 36" /></>,
  flamingo: (c) => <><path className="bi-c bi-ct" d="M26.5 31 Q32 29.5 37.5 31 Q39 41 32 46 Q31.5 40 26.5 31Z" /><path className="bi-e" d="M33 41 Q32 44 32 46 Q36.5 43.5 37.8 38Z" /></>,
};

const FOCINHO: Readonly<Record<string, ReactNode>> = {
  longo: <><path className="bi-p bi-ct" d="M26 32 Q25 44 32 47 Q39 44 38 32Z" /><circle className="bi-e" cx="32" cy="45.5" r="1.8" /></>,
  largo: <><ellipse className="bi-c bi-ct" cx="32" cy="36.5" rx="11" ry="7" /><circle className="bi-e" cx="27.5" cy="35" r="1.3" /><circle className="bi-e" cx="36.5" cy="35" r="1.3" /></>,
  tromba: <><path className="bi-p bi-ct" d="M26.5 31 Q25 42 29 47 Q33 49 35 45 Q33 42 37.5 31Z" /><path className="bi-linha bi-escura" d="M28.5 37 q3.5 2 7 0" /></>,
  chato: <><ellipse className="bi-e" cx="32" cy="36" rx="10" ry="4.6" /><circle className="bi-e" cx="28" cy="35" r="0.9" /><circle className="bi-e" cx="36" cy="35" r="0.9" /></>,
  porco: <><ellipse className="bi-c bi-ct" cx="32" cy="36" rx="7" ry="5.2" /><circle className="bi-e" cx="29.6" cy="36" r="1.2" /><circle className="bi-e" cx="34.4" cy="36" r="1.2" /></>,
  nariz: <><ellipse className="bi-c bi-fraco" cx="32" cy="35" rx="8" ry="6" /><ellipse className="bi-e" cx="32" cy="32.5" rx="4" ry="3.2" /></>,
  croc: <><ellipse className="bi-p bi-ct" cx="32" cy="37.4" rx="12.5" ry="6.4" /><circle className="bi-e" cx="27" cy="34.6" r="1" /><circle className="bi-e" cx="37" cy="34.6" r="1" /></>,
  tubo: <rect className="bi-p bi-ct" x="29" y="33" width="6" height="13" rx="3" />,
  bicoD: <><ellipse className="bi-c bi-ct" cx="32" cy="38.4" rx="7.5" ry="4.8" /><path className="bi-linha bi-escura" d="M25 39 q7 3 14 0" /></>,
};

export const bico = (id: FocinhoId, cls: string): ReactNode => BICO[id]?.(cls) ?? null;
export const focinho = (id: FocinhoId): ReactNode => FOCINHO[id] ?? null;

type Par2 = Partial<Record<Camada, ReactNode>>;
const COROA_JUBA = Array.from({ length: 11 }, (_, i) => [32 + 17 * Math.cos((i / 11) * 6.2832), 28 + 17 * Math.sin((i / 11) * 6.2832)] as const);
const RAIOS = Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * 6.2832; return `M${(32 + 16.5 * Math.cos(a)).toFixed(1)} ${(32 + 14.5 * Math.sin(a)).toFixed(1)} l${(4 * Math.cos(a)).toFixed(1)} ${(4 * Math.sin(a)).toFixed(1)}`; }).join(" ");

export const EXTRA: Readonly<Record<ExtraId, Par2>> = {
  chifre: { F: <path className="bi-c bi-ct" d="M28 38 Q32 16 36 38Z" /> },
  chifres: { B: par(<path className="bi-c bi-ct" d="M20 20 Q10 17 12 6 Q19 9 24 17Z" />) },
  galhada: { B: par(<path className="bi-linha bi-escura bi-med" d="M23 16 L17 5 M20 10.5 L12.5 10 M18 7.5 L18.5 1.5" />) },
  galhadaL: { B: par(<path className="bi-e bi-ct" d="M24 15 L8 12 L4 6 L10 7 L8.5 1.5 L15 6 L17.5 1 L20.5 6.5 L26 11Z" />) },
  juba: { B: <>{COROA_JUBA.map(([x, y], i) => <circle key={i} className="bi-e" cx={x} cy={y} r="6.2" />)}<circle className="bi-e" cx="32" cy="28" r="17" /></> },
  la: { B: <>{COROA_JUBA.map(([x, y], i) => <circle key={i} className="bi-c bi-ct" cx={x} cy={y} r="6.2" />)}<circle className="bi-c" cx="32" cy="28" r="17" /></>, C: <path className="bi-c bi-ct" d="M14 50 Q14 34 32 34 Q50 34 50 50 Q50 58 32 58 Q14 58 14 50Z" /> },
  crista: { B: <path className="bi-s bi-ct" d="M26 18 Q24 6 29 1 Q30 8 32 12 Q34 4 40 3 Q38 10 38 18Z" /> },
  topete: { B: <ellipse className="bi-p bi-ct" cx="32" cy="15.5" rx="9.5" ry="6.5" /> },
  espinhos: { A: <polygon className="bi-e" points="12,50 6,40 14,42 10,30 19,38 20,24 26,36 32,22 38,36 44,24 45,38 54,30 50,42 58,40 52,50" />, B: <polygon className="bi-e" points="17,26 14,14 22,19 22,8 29,16 33,5 38,15 44,8 45,19 52,14 47,27" /> },
  casco: { C: <><path className="bi-s bi-ct" d="M13 54 Q13 33 32 33 Q51 33 51 54Z" /><path className="bi-linha bi-escura" d="M21 46 H43 M26 36 L23 54 M38 36 L41 54 M32 34 V54" /></> },
  domo: { C: <><path className="bi-p bi-ct" d="M15 55 Q15 35 32 35 Q49 35 49 55Z" /><path className="bi-linha bi-escura" d="M32 36 V55" /></> },
  bandas: { C: <><path className="bi-e bi-ct" d="M14 54 Q15 35 32 35 Q49 35 50 54Z" /><path className="bi-linha bi-papel" style={{ opacity: 0.5 }} d="M16 45 Q32 38 48 45 M15 50 Q32 43 49 50" /></> },
  asas: { C: par(<ellipse className="bi-s bi-ct" cx="15.5" cy="48" rx="4.8" ry="9.5" transform="rotate(14 15.5 48)" />) },
  aletas: { C: par(<path className="bi-s bi-ct" d="M17 40 Q7 49 10 57 Q16 52 20 46Z" />) },
  asasI: { A: par(<ellipse className="bi-asa" cx="15" cy="40" rx="7" ry="13" transform="rotate(-28 15 40)" />) },
  asasB: { A: par(<><path className="bi-p bi-ct" d="M24 40 Q2 20 5 38 Q7 50 25 48Z" /><path className="bi-s bi-ct" d="M25 47 Q8 52 12 59 Q21 59 27 51Z" /><circle className="bi-a" cx="11" cy="38" r="2.6" /></>) },
  asasL: { A: par(<><ellipse className="bi-asa" cx="12" cy="38" rx="12" ry="3.4" transform="rotate(-14 12 38)" /><ellipse className="bi-asa" cx="13" cy="45" rx="11" ry="3.2" transform="rotate(6 13 45)" /></>) },
  asasM: { A: par(<path className="bi-e bi-ct" d="M20 42 L2 33 L7 43 L2 50 L11 49 L8 57 L19 53Z" />) },
  antenas: { B: par(<><path className="bi-linha bi-escura" d="M28 17 Q25 9 19 6" /><circle className="bi-s" cx="19" cy="6" r="1.8" /></>) },
  antenasL: { B: par(<path className="bi-linha bi-escura" d="M28 17 Q22 3 6 5" />) },
  corcova: { A: par(<ellipse className="bi-p bi-ct" cx="16.5" cy="38" rx="8.5" ry="11" />) },
  pescoco: { C: <rect className="bi-p" x="25" y="34" width="14" height="16" /> },
  ossicones: { B: par(<><path className="bi-linha bi-escura" d="M26 16 L25 7" /><circle className="bi-e" cx="25" cy="6" r="2.3" /></>) },
  presas: { F: par(<path className="bi-papel-f bi-ct" d="M26.5 38 Q23 47 26.5 51 Q29 46 29.5 39Z" />) },
  presasJ: { F: par(<path className="bi-papel-f bi-ct" d="M25 39 Q20 39 20 32 Q26 34 28.5 38Z" />) },
  bigodes: { F: bigodes(34, 9) },
  bolsa: { C: <path className="bi-c bi-ct" d="M23 46 Q32 60 41 46Z" /> },
  dorsal: { B: <path className="bi-s bi-ct" d="M24 18 L32 1 L40 18Z" /> },
  jato: { F: <path className="bi-linha bi-d" d="M32 14 V5 M32 7 Q26 2 24 6 M32 7 Q38 2 40 6" /> },
  raios: { B: <path className="bi-linha bi-escura" d={RAIOS} /> },
  raia: { A: <><path className="bi-p bi-ct" d="M32 22 Q58 24 63 38 Q50 38 32 52 Q14 38 1 38 Q6 24 32 22Z" /><path className="bi-linha bi-pc" d="M32 52 Q35 58 31 63" /></> },
  mola: { B: <path className="bi-s bi-ct" d="M32 11 Q43 13 45 25 Q38 21 32 22Z M32 52 Q43 51 45 41 Q38 45 32 44Z" /> },
  dentes: { F: <path className="bi-papel-f bi-ct" d="M21 39.5 l3 3.4 l3 -3.4 l3 3.4 l3 -3.4 l3 3.4 l3 -3.4 l3 3.4 l3 -3.4Z" /> },
  aneis: { C: <path className="bi-linha bi-escura" d="M24 44 Q32 47 40 44 M23 49 Q32 52 41 49 M24 54 Q32 57 40 54" /> },
  papada: { F: <path className="bi-a bi-ct" d="M25 41 Q32 54 39 41Z" /> },
  lingua: { F: <path className="bi-linha bi-r" d="M32 39 V47 M32 47 l-2.6 3 M32 47 l2.6 3" /> },
  ventosas: { C: par(<><circle className="bi-c bi-ct" cx="14" cy="56" r="3.2" /><circle className="bi-c bi-ct" cx="19" cy="58.6" r="2.6" /></>) },
  gills: { B: par(<><path className="bi-linha bi-sc bi-med" d="M19 25 L10 19 M18 29 L8 28.5 M19 33 L10 38" /><circle className="bi-s" cx="9.5" cy="18.6" r="2.4" /><circle className="bi-s" cx="7.5" cy="28.5" r="2.4" /><circle className="bi-s" cx="9.5" cy="38.4" r="2.4" /></>) },
  foices: { C: par(<path className="bi-linha bi-med bi-pc" d="M23 44 L12 34 L18 28" />) },
  luz: { C: <><circle className="bi-a" opacity="0.3" cx="32" cy="52" r="12" /><ellipse className="bi-a" cx="32" cy="52" rx="8" ry="6" /></> },
  pincas: { A: par(<path className="bi-p bi-ct" d="M22 40 L9 36 Q3 30 7 23 Q12 27 13 31 Q13 24 18 21 Q20 30 22 35Z" />) },
  caudaE: { A: <><path className="bi-linha bi-grosso bi-pc" d="M42 55 Q62 55 59 37 Q57 28 47 28" /><path className="bi-e" d="M46 24 l7 4 l-7 4Z" /></> },
  pernaSalto: { A: par(<path className="bi-linha bi-med bi-pc" d="M20 50 L8 38 L13 58" />) },
  faixa: { F: <path className="bi-c" opacity="0.9" d="M29 15 L35 15 L37 38 L27 38Z" /> },
};

const E = (x: number, y: number, rx: number, ry: number, r = 0): ReactNode => <ellipse className="bi-s" cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${r} ${x} ${y})`} />;

export const MARCA: Readonly<Record<MarcaId, { cab?: ReactNode; cor?: ReactNode; rosto?: ReactNode }>> = {
  listras: {
    rosto: <>{par(<path className="bi-linha bi-sc bi-med" d="M19 23 l6 2 M17.5 28.5 l7 1 M19.5 34 l6 -1.5" />)}<path className="bi-linha bi-sc bi-med" d="M32 15 V21 M27.5 16.5 L29 21 M36.5 16.5 L35 21" /></>,
    cor: par(<path className="bi-linha bi-sc bi-med" d="M20 42 q4 3 3 10 M16.5 48 q4 2 3 8" />),
  },
  pintas: {
    rosto: par(<><circle className="bi-s" cx="24" cy="21" r="1.4" /><circle className="bi-s" cx="22" cy="29" r="1.3" /><circle className="bi-s" cx="26.5" cy="34" r="1.2" /><circle className="bi-s" cx="29" cy="17.5" r="1.1" /></>),
    cor: par(<><circle className="bi-s" cx="21" cy="45" r="1.7" /><circle className="bi-s" cx="26" cy="52" r="1.6" /><circle className="bi-s" cx="18" cy="52" r="1.5" /></>),
  },
  pintasG: {
    rosto: par(<>{E(22, 21, 4, 3, -20)}{E(18.5, 32, 3, 4.5, 10)}</>),
    cor: par(<>{E(22, 46, 5, 4, 10)}{E(27, 55, 4.5, 3, -10)}</>),
  },
  mascara: { rosto: <path className="bi-s" d="M16.5 25 Q32 19 47.5 25 L46 31.5 Q32 27 18 31.5Z" /> },
  olheiras: { rosto: par(E(25.5, 27, 4.8, 5.8, 18)), cor: par(<>{E(17.5, 48, 4.4, 7.5, 18)}</>) },
};
