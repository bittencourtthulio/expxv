import type { LinhaGrafo } from "../../../compartilhado/vcs-tipos";

export const ALTURA_LINHA_LOG = 28;
const LARGURA_PISTA = 12;

/** Uma linha do grafo de commits em SVG leve (a lista é virtualizada: só linhas visíveis existem). Pistas por cor E posição. */
export function GrafoLinha({ g, larguraMax }: { g: LinhaGrafo; larguraMax: number }) {
  const h = ALTURA_LINHA_LOG;
  const x = (c: number): number => c * LARGURA_PISTA + LARGURA_PISTA / 2;
  const cy = h / 2;
  const w = Math.max(larguraMax, g.largura, g.coluna + 1) * LARGURA_PISTA;
  return (
    <svg className="vc-grafo" width={w} height={h} aria-hidden="true" focusable="false">
      {g.passa.map((c) => <line key={`p${c}`} className={`vc-pista vc-pista-${c % 6}`} x1={x(c)} y1={0} x2={x(c)} y2={h} />)}
      {g.entra.map((c) => <line key={`e${c}`} className={`vc-pista vc-pista-${c % 6}`} x1={x(c)} y1={0} x2={x(g.coluna)} y2={cy} />)}
      {g.saidas.map((c, i) => <line key={`s${i}`} className={`vc-pista vc-pista-${c % 6}`} x1={x(g.coluna)} y1={cy} x2={x(c)} y2={h} />)}
      <circle className={`vc-no vc-pista-${g.coluna % 6}`} cx={x(g.coluna)} cy={cy} r={3.5} />
    </svg>
  );
}
