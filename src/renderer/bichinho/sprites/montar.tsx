// Montagem (D-674): receita -> `Arte` (as mesmas âncoras da arte legada: olhos, raio, boca, atras, corpo, cabeca, rosto), com cache por espécie.
// O arquétipo define a geometria e as âncoras; as partes da receita entram em quatro camadas: A (atrás do corpo), C (sobre o corpo), B (atrás da cabeça), F (sobre o rosto).
import type { ReactNode } from "react";
import type { Arte } from "../arte";
import { bico, bigodes, cauda, EXTRA, focinho, MARCA, orelha, par, type Camada, type G } from "./partes";
import type { ArquetipoId, CaudaId, OrelhaId, Receita } from "./tipos";

type Ponto = readonly [number, number];
interface Cfg {
  g: G;
  ol: readonly [Ponto, Ponto];
  er: number;
  boca: Ponto | null;
  oD?: OrelhaId;
  cD?: CaudaId;
  /** corpo base (padrão: oval com barriga e pés) */
  corpo?: (r: Receita) => ReactNode;
  forma?: (r: Receita, hc: string) => ReactNode;
  muzzle?: ReactNode;
  /** atrás do corpo, junto da cauda (pernas, asas) */
  atras?: ReactNode;
  cabAtras?: ReactNode;
  rosto?: ReactNode;
  /** sem orelha nem cauda por padrão */
  semOrelha?: boolean;
}

const CAMADAS: readonly Camada[] = ["A", "C", "B", "F"];
const larg = (r: Receita, k = 1): number => k * (r.v === "fino" ? 0.7 : r.v === "gordo" ? 1.14 : 1);

function corpoBase(r: Receita, rx = 15, ry = 11, cy = 47, pes: ReactNode = par(<ellipse className="bi-p bi-pe" cx={32 - rx * 0.55} cy="58.4" rx="4.8" ry="2.6" />)): ReactNode {
  const w = rx * larg(r);
  return (
    <>
      <ellipse className="bi-p" cx="32" cy={cy} rx={w} ry={ry} />
      <ellipse className={r.bl === 1 ? "bi-papel-f" : "bi-c bi-fraco"} cx="32" cy={cy + 3} rx={w * 0.6} ry={ry * 0.64} />
      {pes}
    </>
  );
}

function compor(r: Receita, k: Cfg): Arte {
  const hc = r.hs === 1 ? "bi-s" : "bi-p";
  const marca = r.m === undefined || ((r.a === "inseto" || r.a === "caracol") && r.m === "listras") ? undefined : MARCA[r.m];
  const cam: Record<Camada, ReactNode[]> = { A: [], C: [], B: [], F: [] };
  for (const id of r.x ?? []) for (const c of CAMADAS) { const n = EXTRA[id][c]; if (n !== undefined) cam[c].push(<g key={`${id}${c}`}>{n}</g>); }
  const ordem = r.o ?? k.oD;
  const orelhas = k.semOrelha === true || ordem === undefined ? null : orelha(ordem, r.m === "olheiras" || r.hs === 1 ? "bi-s" : "bi-p", k.g);
  const rabo = cauda(r.c ?? k.cD ?? "nenhuma");
  const forma = k.forma !== undefined ? k.forma(r, hc) : <ellipse className={hc} cx="32" cy={k.g.cy} rx={k.g.rx} ry={k.g.ry} />;
  return {
    olhos: k.ol,
    r: k.er,
    boca: k.boca,
    pal: r.p,
    atras: <>{rabo}{k.atras}{cam.A}</>,
    corpo: <>{(k.corpo ?? ((q) => corpoBase(q)))(r)}{cam.C}{marca?.cor}</>,
    cabeca: <>{k.cabAtras}{cam.B}{orelhas}{forma}</>,
    rosto: <>{marca?.rosto}{r.f === undefined ? k.muzzle : bicoOuFocinho(r)}{cam.F}{k.rosto}</>,
  };
}

const AVES = new Set<ArquetipoId>(["ave", "aquatica"]);
function bicoOuFocinho(r: Receita): ReactNode {
  if (r.f === undefined) return null;
  return AVES.has(r.a) ? bico(r.f, r.bc === "e" ? "bi-e" : r.bc === "c" ? "bi-c bi-ct" : "bi-a bi-ct") : focinho(r.f);
}

const bochechas = <><ellipse className="bi-c bi-fraco" cx="24.5" cy="35" rx="5" ry="4" /><ellipse className="bi-c bi-fraco" cx="39.5" cy="35" rx="5" ry="4" /></>;
const ESTRELA = Array.from({ length: 10 }, (_, i) => { const a = -1.5708 + (i * Math.PI) / 5; const q = i % 2 === 0 ? 25 : 10.5; return `${(32 + q * Math.cos(a)).toFixed(1)},${(39 + q * Math.sin(a)).toFixed(1)}`; }).join(" ");
const PONTAS = Array.from({ length: 5 }, (_, i) => { const a = -1.5708 + (i * 2 * Math.PI) / 5; return `M32 39 L${(32 + 20 * Math.cos(a)).toFixed(1)} ${(39 + 20 * Math.sin(a)).toFixed(1)}`; }).join(" ");

export const ARQUETIPO: Readonly<Record<ArquetipoId, (r: Receita) => Arte>> = {
  felino: (r) => compor(r, {
    g: { rx: 15, ry: 13, cy: 28 }, ol: [[26, 27], [38, 27]], er: 2.4, boca: [32, 37.4], oD: "ponta", cD: "longa",
    muzzle: <><ellipse className="bi-c" cx="32" cy="34.5" rx="6.5" ry="4.5" /><polygon className="bi-e" points="32,33.6 29.8,31.6 34.2,31.6" />{bigodes(34, 9)}</>,
  }),
  canino: (r) => compor(r, {
    g: { rx: 14.5, ry: 12.5, cy: 28 }, ol: [[26, 26], [38, 26]], er: 2.3, boca: [32, 38.4], oD: "ponta", cD: "tufo",
    muzzle: <><ellipse className="bi-c" cx="32" cy="35" rx="7.2" ry="6" /><ellipse className="bi-e" cx="32" cy="32" rx="2.6" ry="1.9" /></>,
  }),
  roedor: (r) => compor(r, {
    g: { rx: 14, ry: 13.5, cy: 29 }, ol: [[25.5, 26], [38.5, 26]], er: 2.4, boca: [32, 36.4], oD: "redonda", cD: "fina",
    muzzle: <>{bochechas}<ellipse className="bi-e" cx="32" cy="32.6" rx="2.2" ry="1.6" /><rect className="bi-papel-f bi-ct" x="30.2" y="37.6" width="3.6" height="3.8" rx="1" /></>,
  }),
  ursino: (r) => compor(r, {
    g: { rx: 14.5, ry: 14.5, cy: 28 }, ol: [[26, 26], [38, 26]], er: 2.3, boca: [32, 37.2], oD: "redonda", cD: "curta",
    muzzle: <><ellipse className="bi-c" cx="32" cy="34" rx="7.5" ry="5.8" /><ellipse className="bi-e" cx="32" cy="31.5" rx="2.6" ry="1.8" /></>,
  }),
  ungulado: (r) => compor(r, {
    g: { rx: 12.5, ry: 14, cy: 28.5 }, ol: [[24.5, 25], [39.5, 25]], er: 2.2, boca: [32, 40.4], oD: "ponta", cD: "fina",
    muzzle: <><ellipse className="bi-c" cx="32" cy="36.5" rx="8.5" ry="6.4" /><circle className="bi-e" cx="29" cy="36" r="1.1" /><circle className="bi-e" cx="35" cy="36" r="1.1" /></>,
  }),
  primata: (r) => compor(r, {
    g: { rx: 14, ry: 14, cy: 28 }, ol: [[26.5, 27.5], [37.5, 27.5]], er: 2.3, boca: [32, 38.6], oD: "lateral", cD: "longa",
    muzzle: <><path className="bi-c" d="M32 24 Q40 20 44 26 Q47 36 38 42 Q32 45 26 42 Q17 36 20 26 Q24 20 32 24Z" /><circle className="bi-e" cx="30" cy="34" r="0.9" /><circle className="bi-e" cx="34" cy="34" r="0.9" /></>,
  }),
  ave: (r) => compor(r, {
    g: { rx: 14, ry: 14, cy: 28 }, ol: [[26, 26], [38, 26]], er: 2.6, boca: null, semOrelha: true, cD: "pena",
    corpo: (q) => corpoBase(q, 14, 11, 47, par(<ellipse className="bi-a bi-pe" cx="25" cy="59.4" rx="4" ry="1.8" />)),
    muzzle: bico("reto", r.bc === "e" ? "bi-e" : r.bc === "c" ? "bi-c bi-ct" : "bi-a bi-ct"),
  }),
  aquatica: (r) => compor(r, {
    g: { rx: 13.5, ry: 13.5, cy: 28.5 }, ol: [[26.5, 26.5], [37.5, 26.5]], er: 2.5, boca: null, semOrelha: true, cD: "pena",
    corpo: (q) => corpoBase(q, 16, 10, 48, par(<ellipse className="bi-a bi-pe" cx="24" cy="59.2" rx="5.4" ry="1.9" />)),
    muzzle: bico("chato", r.bc === "e" ? "bi-e" : r.bc === "c" ? "bi-c bi-ct" : "bi-a bi-ct"),
  }),
  peixe: (r) => compor(r, {
    g: { rx: 17, ry: 15, cy: 32 }, ol: [[24, 27], [40, 27]], er: 2.8, boca: [32, 37], semOrelha: true,
    forma: (_q, hc) => <><ellipse className={hc} cx="32" cy="32" rx="17" ry="15" /><ellipse className={r.bl === 1 ? "bi-papel-f" : "bi-c bi-fraco"} cx="32" cy="39.5" rx="11" ry="6.5" /></>,
    corpo: (q) => <path className="bi-p" d={`M${22 * larg(q) + 10 * (1 - larg(q))} 40 Q32 50 ${42 - 10 * (1 - larg(q))} 40 L38 56 Q32 60 26 56Z`} />,
    cabAtras: par(<path className="bi-s bi-ct" d="M16 38 Q5 40 7 49 Q14 47 18 43Z" />),
    atras: <path className="bi-s bi-ct" d="M24 54 L32 62 L40 54 Q32 58 24 54Z" />,
  }),
  reptil: (r) => compor(r, {
    g: { rx: 15, ry: 11.5, cy: 30 }, ol: [[25, 24.5], [39, 24.5]], er: 2.4, boca: [32, 37.8], semOrelha: true, cD: "ponta",
    forma: (_q, hc) => <><ellipse className={hc} cx="32" cy="30" rx="15" ry="11.5" /><circle className={hc} cx="25" cy="24.5" r="5" /><circle className={hc} cx="39" cy="24.5" r="5" /></>,
    corpo: (q) => corpoBase(q, 15, 11, 47, par(<ellipse className="bi-p bi-pe" cx="15.5" cy="55.5" rx="4.6" ry="3" transform="rotate(-24 15.5 55.5)" />)),
    muzzle: <><ellipse className="bi-c bi-fraco" cx="32" cy="35.5" rx="9" ry="4.4" /><circle className="bi-e" cx="29.5" cy="33.4" r="0.9" /><circle className="bi-e" cx="34.5" cy="33.4" r="0.9" /></>,
  }),
  anfibio: (r) => compor(r, {
    g: { rx: 17, ry: 10.5, cy: 31 }, ol: [[24, 20], [40, 20]], er: 2.8, boca: [32, 38], semOrelha: true,
    forma: (_q, hc) => <><ellipse className={hc} cx="32" cy="31" rx="17" ry="10.5" /><circle className={hc} cx="24" cy="20" r="6" /><circle className={hc} cx="40" cy="20" r="6" /><ellipse className="bi-c bi-fraco" cx="32" cy="37" rx="11" ry="4" /></>,
    atras: <path className="bi-p" d="M10 56 Q6 50 14 48 Q20 52 18 58Z M54 56 Q58 50 50 48 Q44 52 46 58Z" />,
    rosto: <path className="bi-linha bi-escura" d="M18 34 Q32 43 46 34" />,
  }),
  salamandra: (r) => compor(r, {
    g: { rx: 14, ry: 11, cy: 30 }, ol: [[25, 27], [39, 27]], er: 2.2, boca: [32, 36.5], semOrelha: true, cD: "ponta",
    corpo: (q) => corpoBase(q, 16, 10, 48, par(<ellipse className="bi-p bi-pe" cx="15.5" cy="56" rx="4.4" ry="2.8" transform="rotate(-20 15.5 56)" />)),
    muzzle: bochechas,
  }),
  inseto: (r) => compor(r, {
    g: { rx: 12, ry: 12, cy: 27 }, ol: [[26.5, 26.5], [37.5, 26.5]], er: 3.2, boca: [32, 33.6], semOrelha: true,
    forma: (_q, hc) => <circle className={hc} cx="32" cy="27" r="12" />,
    corpo: (q) => (q.v === "ant"
      ? <><ellipse className="bi-p" cx="32" cy="52" rx="12.5" ry="8.5" /><circle className="bi-p" cx="32" cy="42.5" r="6.5" /><path className="bi-linha bi-escura" d="M24 52 Q32 57 40 52" /></>
      : <><ellipse className="bi-p" cx="32" cy="47" rx={q.v === "fino" ? 7.5 : 12} ry={q.v === "fino" ? 12 : 11} /><path className="bi-linha bi-escura" d={q.v === "fino" ? "M25 44 Q32 47 39 44 M25.5 50 Q32 53 38.5 50 M26.5 56 Q32 58.5 37.5 56" : "M21 44 Q32 48 43 44 M22 50 Q32 54 42 50"} />{q.m === "listras" && <path className="bi-linha bi-sc bi-med" d="M20.5 44.5 Q32 49 43.5 44.5 M21.5 51 Q32 55.5 42.5 51" />}</>),
    atras: par(<path className="bi-linha bi-pc" d="M22 44 L10 38 M22 49 L8 50 M24 54 L12 61" />),
  }),
  aracnideo: (r) => compor(r, {
    g: { rx: 11, ry: 11, cy: 29 }, ol: [[27.5, 29], [36.5, 29]], er: 2.4, boca: null, semOrelha: true,
    forma: (_q, hc) => <circle className={hc} cx="32" cy="29" r="11" />,
    corpo: () => <><ellipse className="bi-p" cx="32" cy="50" rx="14" ry="10" /><path className={r.x?.includes("caudaE") ? "bi-d" : "bi-r"} d="M30 47 h4 l-2 3.4 l2 3.4 h-4 l2 -3.4Z" /></>,
    atras: par(<path className="bi-linha bi-med bi-pc" d="M23 45 L8 36 L3 46 M22 49 L5 50 L3 59 M22 53 L8 60 L7 63 M24 41 L11 28 L5 33" />),
    rosto: <><circle className="bi-tinta-f" cx="30" cy="24.5" r="1" /><circle className="bi-tinta-f" cx="34" cy="24.5" r="1" /><path className="bi-papel-f" d="M30 37 l1 4 l1 -4 M33 37 l1 4 l1 -4" /></>,
  }),
  medusa: (r) => compor(r, {
    g: { rx: 16, ry: 14, cy: 26 }, ol: [[25.5, 27], [38.5, 27]], er: 2.8, boca: [32, 34.4], semOrelha: true,
    forma: (_q, hc) => (r.v === "lula"
      ? <><path className={hc} d="M32 3 Q47 12 46 34 Q38 40 32 40 Q26 40 18 34 Q17 12 32 3Z" />{par(<path className="bi-s bi-ct" d="M20 13 L7 19 L20 28Z" />)}</>
      : <><path className={hc} d="M14 36 Q14 9 32 9 Q50 9 50 36 Q40 41 32 41 Q24 41 14 36Z" /><ellipse className="bi-papel-f" opacity="0.35" cx="25" cy="18" rx="5" ry="3" transform="rotate(-24 25 18)" /></>),
    corpo: () => (r.v === "lula"
      ? <path className="bi-linha bi-grosso bi-pc" d="M22 38 Q19 48 23 56 M27 39 Q25 49 28 58 M37 39 Q39 49 36 58 M42 38 Q45 48 41 56 M32 40 V60" />
      : <><path className="bi-linha bi-grosso bi-pc" d="M20 39 Q16 46 21 50 Q25 54 20 58 M27 40 Q24 47 28 51 Q31 55 27 60 M37 40 Q40 47 36 51 Q33 55 37 60 M44 39 Q48 46 43 50 Q39 54 44 58" /><path className="bi-linha bi-sc" style={{ strokeWidth: 1.4 }} d="M24 40 Q22 48 25 56 M40 40 Q42 48 39 56" /></>),
  }),
  estrela: (r) => compor(r, {
    g: { rx: 10, ry: 10, cy: 39 }, ol: [[27.5, 38.5], [36.5, 38.5]], er: 2.2, boca: [32, 43.6], semOrelha: true,
    corpo: () => <><polygon className="bi-p bi-ct" points={ESTRELA} /><path className="bi-linha bi-escura" style={{ opacity: 0.5 }} d={PONTAS} /></>,
    forma: () => <circle className="bi-c bi-fraco" cx="32" cy="40" r="9.5" />,
    rosto: r.m === undefined ? <>{[[32, 20], [20, 32], [44, 32], [24, 54], [40, 54]].map(([x, y]) => <circle key={`${x}${y}`} className="bi-c" cx={x} cy={y} r="1.5" />)}</> : null,
  }),
  crustaceo: (r) => compor(r, {
    g: { rx: 12, ry: 9.5, cy: 31 }, ol: [[27, 21], [37, 21]], er: 2.4, boca: [32, 35.6], semOrelha: true,
    cabAtras: <><path className="bi-linha bi-grosso bi-pc" d="M27 29 V21 M37 29 V21" /><path className="bi-linha bi-escura" d="M28 20 Q22 6 9 4 M36 20 Q42 6 55 4" /></>,
    corpo: () => <><ellipse className="bi-p" cx="32" cy="48" rx="9.5" ry="11" /><path className="bi-linha bi-escura" d="M23 44 Q32 48 41 44 M23.5 50 Q32 54 40.5 50" /><path className="bi-s bi-ct" d="M24 57 L32 63 L40 57Z" /></>,
    atras: par(<><path className="bi-p bi-ct" d="M22 37 L12 35 Q4 31 6 21 Q11 23 13 28 Q13 21 18 18 Q20 27 22 31Z" /><path className="bi-linha bi-pc" d="M21 49 L10 53 M22 53 L12 59" /></>),
  }),
  caracol: (r) => compor(r, {
    g: { rx: 9.5, ry: 8.5, cy: 37 }, ol: [[17, 22.5], [27, 22.5]], er: 2.3, boca: [22, 41.4], semOrelha: true,
    forma: (_q, hc) => <><path className={hc} d="M17 33 L16.5 22 M27 33 L27.5 22" style={{ stroke: "var(--bi-pelo)", strokeWidth: 3.4, strokeLinecap: "round" }} /><ellipse className={hc} cx="22" cy="37" rx="9.5" ry="8.5" /></>,
    corpo: () => (r.v === "nautilo"
      ? <><circle className="bi-p bi-ct" cx="36" cy="40" r="19" /><path className="bi-linha bi-sc" style={{ strokeWidth: 1.5 }} d="M36 40 L22 28 M36 40 L30 22 M36 40 L42 21 M36 40 L52 29 M36 40 L55 42" /><path className="bi-linha bi-pc" d="M18 50 Q16 56 12 58 M24 52 Q23 58 20 61 M30 52 Q31 58 28 61" /></>
      : <><path className="bi-p" d="M10 56 Q10 38 22 37 L34 46 L44 56Z" /><ellipse className="bi-p" cx="28" cy="56" rx="21" ry="4.6" /><circle className="bi-s bi-ct" cx="42" cy="42" r="14.5" /><path className="bi-linha bi-escura" d="M42 42 a2.5 2.5 0 0 1 2.5 -2.5 a5 5 0 0 1 5 5 a8 8 0 0 1 -8 8 a11 11 0 0 1 -11 -11 a14 14 0 0 1 14 -14" /></>),
  }),
};

/** Monta a arte de uma receita (sem cache; `arteDe` em `arte.tsx` guarda por espécie). */
export const montarArte = (r: Receita): Arte => ARQUETIPO[r.a](r);
