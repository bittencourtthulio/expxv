import { caminhoSpark, type Delta, type GrupoAtencao, type Kpi } from "./painel-logica";

const SPARK_W = 64;
const SPARK_H = 26;

/** Micrográfico decorativo (o valor e a nota já dizem tudo em texto): linha fina e um ponto no último valor. */
function Spark({ valores }: { valores: number[] }) {
  const { d, ultimo } = caminhoSpark(valores, SPARK_W, SPARK_H, 3);
  if (d === "") return null;
  return (
    <svg className="ag-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width={SPARK_W} height={SPARK_H} aria-hidden="true" focusable="false">
      <path d={d} className="ag-spark-linha" />
      {ultimo !== null && <circle cx={ultimo.x} cy={ultimo.y} r="2.6" className="ag-spark-ponto" />}
    </svg>
  );
}

/** Seta com forma (não só cor): triângulo para cima/baixo ou traço para estável. */
function Seta({ direcao }: { direcao: Delta["direcao"] }) {
  return (
    <svg className="ag-seta" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
      {direcao === "sobe" ? <path d="M5 1.5 9 8H1Z" /> : direcao === "desce" ? <path d="M5 8.5 1 2h8Z" /> : <rect x="1" y="4.2" width="8" height="1.8" rx="0.9" />}
    </svg>
  );
}

const PALAVRA_TOM = { bom: "melhorou", ruim: "piorou", neutro: "" } as const;

/** Faixa de indicadores-chave: uma linha contínua dividida por filetes (não são cartões): rótulo, valor, variação e micrográfico. */
export function FaixaIndicadores({ kpis }: { kpis: Kpi[] }) {
  return (
    <ul className="ag-kpis" aria-label="Indicadores-chave">
      {kpis.map((k) => (
        <li key={k.id} className="ag-kpi" data-kpi={k.id} data-tom={k.tom} data-vazio={k.vazio || undefined} title={k.descricao}>
          <span className="ag-kpi-rotulo">{k.rotulo}</span>
          <span className="ag-kpi-linha">
            <span className="ag-kpi-valor">{k.valor}</span>
            {k.sufixo !== null && <span className="ag-kpi-sufixo">{k.sufixo}</span>}
            {k.delta !== null && (
              <span className="ag-delta" data-tom={k.delta.tom}>
                <Seta direcao={k.delta.direcao} />
                <span>{k.delta.texto}</span>
                {PALAVRA_TOM[k.delta.tom] !== "" && <span className="so-leitor"> ({PALAVRA_TOM[k.delta.tom]})</span>}
              </span>
            )}
          </span>
          <span className="ag-kpi-pe">
            <span className="ag-kpi-nota">{k.nota ?? ""}</span>
            {k.medidor !== null ? <span className="ag-medidor" aria-hidden="true"><span style={{ width: `${Math.round(k.medidor * 100)}%` }} /></span> : <Spark valores={k.spark} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

const MARCA_TOM = { normal: "", aviso: "Atenção: ", alerta: "Alerta: " } as const;

/** Bloco "pede atenção": o que está parado, onde há retrabalho e o que falta de dado, com atalho para o Backlog. */
export function BlocoAtencao({ grupos, aoIrBacklog, estilo }: { grupos: GrupoAtencao[]; aoIrBacklog: () => void; estilo?: React.CSSProperties }) {
  return (
    <section className="ag-bloco ag-atencao" data-papel="lateral" data-bloco="atencao" style={estilo} aria-label="O que pede atenção">
      {grupos.map((g) => (
        <div key={g.id} className="ag-atencao-grupo">
          <h3>{g.titulo}</h3>
          {g.itens.length === 0 ? <p className="ag-meta">{g.vazio}</p> : (
            <ul>
              {g.itens.map((i) => (
                <li key={i.id} data-tom={i.tom}>
                  <span className="ag-atencao-nome">{i.titulo}</span>
                  <span className="ag-atencao-valor">
                    <span className="so-leitor">{MARCA_TOM[i.tom]}</span>
                    {i.tom !== "normal" && <span className="ag-marca" aria-hidden="true" />}
                    {i.valor}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {g.id === "dados" && g.itens.length > 0 && <button type="button" className="ag-btn ag-btn-leve" onClick={aoIrBacklog}>Abrir o Backlog</button>}
        </div>
      ))}
    </section>
  );
}
