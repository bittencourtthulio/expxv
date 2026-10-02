// Sprite do Bichinho (D-467): composição pura (sem estado, sem efeito) de espécie × estágio × humor. Os estados são legíveis SEM texto:
// balão "!" (aguardando), Z (dormindo), "?" (curioso), reticências (pensando), notebook e suor (trabalhando), confete (comemorando),
// sobrancelha e gota (preocupado), termômetro (cota alta). Animação só por CSS e só em reação (bichinho.css).
import { memo, useId, type ReactNode } from "react";
import type { EspecieId, EstagioId, HumorId, NivelEsforco } from "../../compartilhado/bichinho";
import { CATALOGO } from "../../nucleo/bichinho/catalogo";
import { arteDe, CORPO } from "./arte";
import { perfilMovimento } from "./util";

/** Tamanho do corpo e proporção da cabeça por estágio: o filhote é pequeno de cabeça grande; o lendário ocupa o quadro inteiro. */
export const ESCALA_ESTAGIO: Readonly<Record<EstagioId, { k: number; cabeca: number }>> = {
  ovo: { k: 1, cabeca: 1 },
  filhote: { k: 0.64, cabeca: 1.2 },
  jovem: { k: 0.78, cabeca: 1.1 },
  adulto: { k: 0.9, cabeca: 1.02 },
  veterano: { k: 0.97, cabeca: 1 },
  lendario: { k: 1, cabeca: 1 },
};

/** Gotas de suor e faíscas: quanto mais esforço, mais partículas (as primeiras valem para os níveis baixos). */
const SUOR: ReadonlyArray<readonly [number, number]> = [[14, 24], [50, 22], [10, 34], [54, 32]];
const FAISCAS: readonly string[] = ["M16 44 l-5 -3", "M48 44 l5 -3", "M32 38 l0 -5", "M18 36 l-5 -5", "M46 36 l5 -5"];

/** Baforadas de quem está ofegante (nível ≥ 3), úteis também nas espécies sem boca desenhada. */
const FOLEGO: ReadonlyArray<readonly [number, number, number]> = [[47, 30, 1.6], [52, 26, 2.1], [57, 21, 2.6]];

const CONFETES: ReadonlyArray<readonly [number, number]> = [[-18, -12], [-8, -22], [4, -26], [14, -20], [22, -8], [-22, 2], [18, 4], [0, -14]];

export interface PropsSprite {
  especie: EspecieId;
  estagio: EstagioId;
  humor?: HumorId;
  doente?: boolean;
  /** só a cabeça (menu recolhido): recorte do desenho, o tamanho do estágio continua visível. */
  cabeca?: boolean;
  /** 0–100: o ovo rachado a partir de 1. */
  maturidade?: number;
  rotulo?: string;
  /** o estágio subiu agora: comemoração única (CSS). */
  subiu?: boolean;
  /** esforço 0–4 (D-500…): escala velocidade, amplitude, partículas e expressão; os indicadores estáticos (anel, barras, chama) mantêm a informação sem movimento. */
  nivel?: NivelEsforco;
  /** variante visual (D-675), 0 = original: paleta rotacionada por CSS e uma marca extra; só passa de 0 quando as 100 espécies já estão em uso. */
  variante?: number;
  /** progresso de choque do ovo, 0–100 (D-671): define os 4 níveis visuais (`data-ovo-nivel`). Sem ele, o ovo rachado vale a partir de `maturidade` 1. */
  progressoOvo?: number;
  /** o bichinho acabou de nascer (o estágio já não é ovo): a casca se abre e cai UMA vez (CSS, iteração única). */
  nasceu?: boolean;
}

/** 0 liso, 1 rachadura pequena, 2 rachaduras e um olho espiando, 3 quase abrindo. */
export const nivelDoOvo = (progresso: number | undefined, maturidade = 0): 0 | 1 | 2 | 3 => {
  if (progresso === undefined) return maturidade > 0 ? 1 : 0;
  return progresso >= 75 ? 3 : progresso >= 50 ? 2 : progresso >= 25 ? 1 : 0;
};

const OVO = "M32 20 C44 20 50 36 50 46 C50 56 42 60 32 60 C22 60 14 56 14 46 C14 36 20 20 32 20Z";
const TAMPA = "M32 20 C44 20 49 32 49.4 38 L45 35 L41 41 L36 35 L31 42 L26 36 L21 41 L16.5 35 L14.6 38 C15 32 20 20 32 20Z";

/** Marca extra da variante (1 a 3): testa, bochechas ou faixa no peito. */
function MarcaVariante({ v, parte }: { v: number; parte: "cabeca" | "corpo" }): ReactNode {
  if (parte === "cabeca") {
    if (v === 1) return <path className="bi-marca bi-d" d="M32 15.5 l1.7 3.2 l3.3 0.4 l-2.5 2.2 l0.7 3.3 l-3.2 -1.7 l-3.2 1.7 l0.7 -3.3 l-2.5 -2.2 l3.3 -0.4z" />;
    if (v === 2) return <g className="bi-marca"><circle className="bi-a" cx="21" cy="35" r="2" /><circle className="bi-a" cx="43" cy="35" r="2" /></g>;
    return null;
  }
  return v === 3 ? <path className="bi-linha bi-marca bi-d" style={{ strokeWidth: 2.2 }} d="M19 47 Q32 52 45 47" /> : null;
}

function Olhos({ humor, olhos, r, nivel }: { humor: HumorId; olhos: ReadonlyArray<readonly [number, number]>; r: number; nivel: NivelEsforco }): ReactNode {
  if (humor === "dormindo") {
    return <g className="bi-olhos-fechados">{olhos.map(([x, y], i) => <path key={i} className="bi-linha bi-tinta" d={`M${x - r} ${y} q${r} ${r * 0.9} ${r * 2} 0`} />)}</g>;
  }
  if (humor === "comemorando") {
    return <g className="bi-olhos-felizes">{olhos.map(([x, y], i) => <path key={i} className="bi-linha bi-tinta" d={`M${x - r} ${y + 0.8} q${r} ${-r * 1.7} ${r * 2} 0`} />)}</g>;
  }
  // concentrado (nível 2, olhos semicerrados) → arregalado e ofegante (3 e 4); atento (nível 1 parado) = olhos um pouco maiores
  const rr = humor === "curioso" ? r * 1.25 : humor === "ocioso" && nivel === 1 ? r * 1.12 : r;
  const ry = humor === "trabalhando" ? rr * (nivel >= 4 ? 1.12 : nivel === 3 ? 0.9 : 0.62) : rr;
  const dx = humor === "pensando" ? -0.9 : 0;
  const dy = humor === "pensando" ? -1.1 : humor === "trabalhando" ? 0.9 : 0;
  return (
    <g className="bi-olhos">
      {olhos.map(([x, y], i) => (
        <g key={i} className="bi-olho">
          <ellipse className="bi-tinta-f" cx={x + dx} cy={y + dy} rx={rr} ry={ry} />
          <circle className="bi-papel-f" cx={x + dx - rr * 0.32} cy={y + dy - ry * 0.36} r={Math.max(0.6, rr * 0.3)} />
        </g>
      ))}
      {humor === "preocupado" && <path className="bi-linha bi-tinta" d={`M${olhos[0]![0] - r} ${olhos[0]![1] - r - 1.4} l${r * 1.9} -1.6 M${olhos[1]![0] + r} ${olhos[1]![1] - r - 1.4} l${-r * 1.9} -1.6`} />}
    </g>
  );
}

function Boca({ humor, ponto, nivel }: { humor: HumorId; ponto: readonly [number, number]; nivel: NivelEsforco }): ReactNode {
  const [x, y] = ponto;
  if (humor === "trabalhando" && nivel >= 3) return <ellipse className="bi-tinta-f bi-ofegar" cx={x} cy={y + 1} rx={nivel >= 4 ? 2.8 : 1.9} ry={nivel >= 4 ? 3 : 1.8} />;
  switch (humor) {
    case "comemorando": return <path className="bi-tinta-f" d={`M${x - 4} ${y} q4 6.5 8 0z`} />;
    case "preocupado": return <path className="bi-linha bi-tinta" d={`M${x - 3.6} ${y + 1.6} q3.6 -3.2 7.2 0`} />;
    case "aguardando": return <ellipse className="bi-tinta-f" cx={x} cy={y + 0.6} rx="1.5" ry="2" />;
    case "dormindo": return <path className="bi-linha bi-tinta" d={`M${x - 1.8} ${y} h3.6`} />;
    case "trabalhando": return <path className="bi-linha bi-tinta" d={`M${x - 2.6} ${y + 0.4} h5.2`} />;
    default: return <path className="bi-linha bi-tinta" d={`M${x - 3} ${y} q3 3 6 0`} />;
  }
}

/** O que o estágio veste, sempre cumulativo e discreto: lenço, óculos, cicatriz e medalha, coroa. */
function Acessorios({ estagio, olhos, r }: { estagio: EstagioId; olhos: ReadonlyArray<readonly [number, number]>; r: number }): ReactNode {
  const n = ["ovo", "filhote", "jovem", "adulto", "veterano", "lendario"].indexOf(estagio);
  const [[ex, ey], [fx]] = [olhos[0]!, olhos[1]!];
  return (
    <>
      {n >= 4 && <g className="bi-cicatriz"><path className="bi-linha bi-r" d={`M${ex - 1.5} ${ey + r + 2} l4.2 6.4 M${ex - 3.4} ${ey + r + 5} l3 -1.4 M${ex + 0.6} ${ey + r + 8.4} l3 -1.4`} /></g>}
      {n >= 3 && <g className="bi-oculos"><circle className="bi-aro" cx={ex} cy={ey} r={r + 2.2} /><circle className="bi-aro" cx={fx} cy={ey} r={r + 2.2} /><path className="bi-aro" d={`M${ex + r + 2.2} ${ey} h${fx - ex - 2 * r - 4.4}`} /></g>}
    </>
  );
}

function BichinhoSpriteBase({ especie, estagio, humor = "ocioso", doente = false, cabeca = false, maturidade = 0, rotulo, subiu = false, nivel = 0, variante = 0, progressoOvo, nasceu = false }: PropsSprite): ReactNode {
  const idBase = `bi${useId().replace(/[^\w]/g, "")}`;
  const arte = arteDe(especie);
  const { k, cabeca: hp } = ESCALA_ESTAGIO[estagio];
  const n = ["ovo", "filhote", "jovem", "adulto", "veterano", "lendario"].indexOf(estagio);
  const ovo = estagio === "ovo";
  const nOvo = nivelDoOvo(progressoOvo, maturidade);
  const v = Math.max(0, Math.min(3, Math.trunc(variante)));
  const cy = 60 - 32 * k;
  const viewBox = cabeca && !ovo ? `8 ${Math.round(cy - 25)} 48 48` : "0 0 64 64";
  const nome = CATALOGO[especie].rotulo;
  const esforco: NivelEsforco = humor === "dormindo" ? 0 : humor === "trabalhando" ? (Math.max(2, nivel) as NivelEsforco) : nivel;
  const mov = perfilMovimento(esforco);
  const gotas = esforco >= 4 ? 4 : esforco >= 3 ? 3 : 2;
  return (
    <svg
      className="bi"
      viewBox={viewBox}
      role="img"
      aria-label={rotulo ?? `${nome}, ${estagio}, ${humor}`}
      focusable="false"
      data-especie={especie}
      data-pal={arte.pal}
      data-var={v > 0 ? v : undefined}
      data-ovo-nivel={ovo ? nOvo : undefined}
      data-nasceu={nasceu || undefined}
      data-estagio={estagio}
      data-humor={humor}
      data-doente={doente || undefined}
      data-subiu={subiu || undefined}
      data-cabeca={cabeca || undefined}
      data-nivel={esforco}
      style={{ ["--bi-ciclo" as string]: `${mov.ciclo}s`, ["--bi-amp" as string]: mov.amp }}
    >
      <defs>
        <radialGradient id={`${idBase}-aura`}><stop offset="0%" className="bi-aura-1" stopOpacity="0.55" /><stop offset="100%" className="bi-aura-1" stopOpacity="0" /></radialGradient>
      </defs>
      {n === 5 && <circle className="bi-aura" cx="32" cy="34" r="31" fill={`url(#${idBase}-aura)`} />}
 {esforco >= 2 && <circle className="bi-anel" cx="32" cy="34" r="30" />}
      <ellipse className="bi-sombra" cx="32" cy="60.5" rx={ovo ? 14 : 18 * k + 3} ry="2.2" />
      {ovo ? (
        <g className="bi-ovo">
          <path className="bi-c" d={OVO} />
          <path className="bi-p bi-fraco" d={OVO} />
          <circle className="bi-p" cx="24" cy="38" r="2.6" /><circle className="bi-p" cx="38" cy="32" r="2" /><circle className="bi-p" cx="35" cy="48" r="3" /><circle className="bi-p" cx="23" cy="51" r="1.8" />
          <path className="bi-linha bi-tinta bi-rachadura" d="M20 40 l5 -4 l4 5 l5 -6 l4 5 l5 -4" style={{ opacity: nOvo >= 1 ? 1 : 0 }} />
          {nOvo >= 2 && (
            <g className="bi-rachaduras">
              <path className="bi-linha bi-tinta" d="M32 21 l-3 7 l4 4 l-3 6 M34 33 l7 2 l-2 5 M27 50 l4 -5 l-1 -5 M43 44 l3 3" />
              <g className="bi-espia"><path className="bi-tinta-f" d="M27.5 43 Q32 38 37.5 43 Q35.5 48 32.5 48 Q29 48 27.5 43Z" /><circle className="bi-papel-f" cx="32.6" cy="43.6" r="2.3" /><circle className="bi-tinta-f" cx="33.2" cy="43.8" r="1.1" /></g>
            </g>
          )}
          {nOvo >= 3 && (
            <g className="bi-quase">
              <path className="bi-tinta-f" d={TAMPA} />
              <g className="bi-tampa"><path className="bi-c" d={TAMPA} /><path className="bi-p bi-fraco" d={TAMPA} /><circle className="bi-p" cx="38" cy="32" r="2" /><path className="bi-linha bi-tinta" d="M20 36 l4 -3 l3 4" /></g>
            </g>
          )}
          <ellipse className="bi-papel-f bi-fraco" cx="26" cy="32" rx="3" ry="6" transform="rotate(-18 26 32)" />
        </g>
      ) : (
        <g className="bi-estagio" transform={`translate(32 60) scale(${k}) translate(-32 -60)`}>
          <g className="bi-aparece">
          <g className="bi-corpo">
            {arte.atras}
            {arte.corpo ?? CORPO}
            {n >= 2 && <g className="bi-lenco"><path className="bi-d" d="M23 41 Q32 47 41 41 L38 47 Q32 52 26 47Z" /><path className="bi-a" d="M32 47 l-2.4 5 l4.8 0z" /></g>}
            {v > 0 && <MarcaVariante v={v} parte="corpo" />}
            {n >= 4 && <g className="bi-medalha"><circle className="bi-a" cx="40" cy="52" r="2.6" /><path className="bi-linha bi-d" d="M38.4 49.4 L37 46" /></g>}
            {humor === "trabalhando" && (
              <g className="bi-notebook">
                <path className="bi-teclado" d="M18 54 H46 L49 58.5 H15Z" />
                <rect className="bi-tela" x="22" y="42" width="20" height="12" rx="1.6" />
                <path className="bi-linha bi-tela-linhas" d="M25 46 h9 M25 49.5 h13" />
                <circle className="bi-pata bi-pata-a" cx="26" cy="55.4" r="2.6" />
                <circle className="bi-pata bi-pata-b" cx="38" cy="55.4" r="2.6" />
              </g>
            )}
            {humor === "aguardando" && (
              <g className="bi-braco"><path className="bi-linha bi-grosso bi-pc" d="M44 46 L52 30" /><circle className="bi-p" cx="52.5" cy="28.5" r="3.4" /></g>
            )}
          </g>
          <g className="bi-cabeca" transform={`translate(32 42) scale(${hp}) translate(-32 -42)`}>
            <g className="bi-giro">
              {arte.cabeca}
              {arte.rosto}
              <Olhos humor={humor} olhos={arte.olhos} r={arte.r} nivel={esforco} />
              {arte.boca !== null && <Boca humor={humor} ponto={arte.boca} nivel={esforco} />}
              {v > 0 && <MarcaVariante v={v} parte="cabeca" />}
              <Acessorios estagio={estagio} olhos={arte.olhos} r={arte.r} />
              {doente && <g className="bi-termometro"><path className="bi-linha bi-papel" d="M31 39 l14 4" /><circle className="bi-r" cx="46" cy="43.2" r="2.5" /></g>}
              {n === 5 && <path className="bi-coroa" d="M22 12 L24 2 L29 8 L32 0 L35 8 L40 2 L42 12Z" />}
            </g>
          </g>
          </g>
        </g>
      )}
      {humor === "aguardando" && <g className="bi-balao"><path className="bi-papel-f bi-contorno" d="M44 2 h16 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-7 l-4 5 l0 -5 h-5 a3 3 0 0 1 -3 -3 v-10 a3 3 0 0 1 3 -3z" /><path className="bi-linha bi-r bi-grosso" d="M52 6.5 v6.5" /><circle className="bi-r" cx="52" cy="16.2" r="1.4" /></g>}
      {humor === "pensando" && <g className="bi-pensando"><circle cx="48" cy="12" r="2" /><circle cx="54" cy="8" r="2.4" /><circle cx="60" cy="4" r="2.8" /></g>}
      {humor === "curioso" && <path className="bi-interrogacao" d="M48 10 q0 -6 6 -6 q6 0 6 5 q0 3 -3 5 q-3 2 -3 5 M54 22.5 v0.5" />}
      {humor === "dormindo" && <g className="bi-zzz"><path d="M46 20 h5 l-5 6 h5" /><path d="M53 11 h6 l-6 7 h6" /></g>}
      {humor === "preocupado" && <path className="bi-gota" d="M50 16 q-3 5 0 7 q3 -2 0 -7z" />}
      {humor === "trabalhando" && <g className="bi-suor">{SUOR.slice(0, gotas).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.5" />)}</g>}
      {humor === "trabalhando" && esforco >= 3 && <g className="bi-faiscas">{FAISCAS.slice(0, esforco >= 4 ? 5 : 3).map((d, i) => <path key={i} className="bi-linha bi-faisca" d={d} />)}</g>}
      {humor === "trabalhando" && esforco >= 3 && <g className="bi-folego">{FOLEGO.slice(0, esforco >= 4 ? 3 : 2).map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}</g>}
      {esforco >= 3 && <path className="bi-chama" d={esforco >= 4 ? "M8 18 C3 13 8 9 7 3 C12 6 16 11 13 16 C12 14 11 13 10 13 C10 15 11 16 8 18Z" : "M9 17 C6 14 9 11 8 7 C11 9 13 12 12 15 C11 14 10 14 10 14 C10 16 10 16 9 17Z"} />}
      {esforco >= 1 && <g className="bi-medidor" aria-hidden="true">{[0, 1, 2, 3].map((i) => <rect key={i} className={i < esforco ? "bi-acesa" : "bi-apagada"} x={2 + i * 4.2} y={61 - (2.6 + i * 1.5)} width="3.2" height={2.6 + i * 1.5} rx="0.8" />)}</g>}
      {nasceu && !ovo && <g className="bi-casca" aria-hidden="true"><path className="bi-c bi-ct bi-casca-e" d="M14 46 C14 40 15 36 17 33 L22 37 L26 32 L31 38 L33 60 C22 60 14 56 14 46Z" /><path className="bi-c bi-ct bi-casca-d" d="M33 60 L31 38 L36 33 L41 38 L46 33 C49 37 50 42 50 46 C50 56 42 60 33 60Z" /></g>}
      {!ovo && (humor === "comemorando" || subiu) && (
        <g className="bi-confete">
          {CONFETES.map(([dx, dy], i) => (i % 2 === 0
            ? <circle key={i} className={i % 4 === 0 ? "bi-d" : "bi-a"} cx="32" cy="22" r="1.8" style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px` }} />
            : <rect key={i} className={i % 3 === 0 ? "bi-r" : "bi-d"} x="30.5" y="20.5" width="3" height="3" rx="0.6" style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px` }} />))}
        </g>
      )}
    </svg>
  );
}

export const BichinhoSprite = memo(BichinhoSpriteBase);
