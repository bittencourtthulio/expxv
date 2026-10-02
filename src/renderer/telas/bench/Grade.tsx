import { Fragment } from "react";
import type { ResumoResultado } from "../../../compartilhado/bench";
import { Virtualizada } from "../../componentes/Virtualizada";
import { VISUAL_ESTADO, custoCurto, deveVirtualizar, duracaoTexto, notaTexto, rotuloCelula, type LinhaGrade } from "./logica";

const ALTURA_LINHA = 36;

function Celula({ tarefa, alvo, r, selecionado, aoAbrir, papel }: { tarefa: string; alvo: string; r: ResumoResultado | null; selecionado: boolean; aoAbrir: (id: string) => void; papel: boolean }) {
  if (r === null) return <div role={papel ? "gridcell" : undefined} className="bn-cel bn-cel-vazia" aria-label={rotuloCelula(tarefa, alvo, null)}>—</div>;
  const v = VISUAL_ESTADO[r.estado];
  return (
    <div role={papel ? "gridcell" : undefined} className="bn-cel">
      <button type="button" className="bn-cel-btn" data-tom={v.tom} aria-current={selecionado ? "true" : undefined} aria-label={rotuloCelula(tarefa, alvo, r)} title={rotuloCelula(tarefa, alvo, r)} onClick={() => aoAbrir(r.id)}>
        <span className="bn-glifo" aria-hidden="true">{v.glifo}</span>
        <span aria-hidden="true">{duracaoTexto(r.duracao_s)}</span>
        <span aria-hidden="true" className="bn-custo">{custoCurto(r.custo_usd)}</span>
        <span aria-hidden="true" className="bn-nota">{r.qualidade === null ? "·" : notaTexto(r.qualidade)}</span>
      </button>
    </div>
  );
}

/** Grade tarefa × alvo: célula de 22–26 px com estado por FORMA, duração, custo ("?" quando desconhecido) e nota; virtualizada acima de 100 linhas. */
export function Grade({ linhas, alvos, rotuloAlvo, selecionado, aoAbrir }: { linhas: readonly LinhaGrade[]; alvos: readonly string[]; rotuloAlvo: (slug: string) => string; selecionado: string | null; aoAbrir: (id: string) => void }) {
  const colunas = `minmax(140px, 220px) repeat(${alvos.length}, minmax(112px, 1fr))`;
  const virtual = deveVirtualizar(linhas.length);
  // virtualizada: a lista própria usa role list/listitem; para não aninhar papéis inválidos, as linhas viram texto simples e cada célula leva o rótulo completo
  const linha = (l: LinhaGrade) => (
    <div role={virtual ? undefined : "row"} className="bn-linha" style={{ gridTemplateColumns: colunas }}>
      <div role={virtual ? undefined : "rowheader"} className="bn-tarefa" title={l.tarefa}>{l.tarefa}</div>
      {l.celulas.map((c) => <Celula key={c.alvo} papel={!virtual} tarefa={l.tarefa} alvo={rotuloAlvo(c.alvo)} r={c.resultado} selecionado={c.resultado?.id === selecionado} aoAbrir={aoAbrir} />)}
    </div>
  );
  return (
    <div role={virtual ? "group" : "grid"} aria-label="Resultados por tarefa e alvo" aria-rowcount={virtual ? undefined : linhas.length + 1} className="bn-grade">
      <div role={virtual ? undefined : "row"} className="bn-linha bn-cabecalho" style={{ gridTemplateColumns: colunas }}>
        <div role={virtual ? undefined : "columnheader"} className="bn-tarefa">Tarefa</div>
        {alvos.map((a) => <div key={a} role={virtual ? undefined : "columnheader"} className="bn-alvo" title={rotuloAlvo(a)}>{rotuloAlvo(a)}</div>)}
      </div>
      {virtual
        ? <Virtualizada itens={linhas} alturaItem={ALTURA_LINHA} chave={(l) => l.tarefa} renderizar={linha} rotulo="Linhas da grade" />
        : linhas.map((l) => <Fragment key={l.tarefa}>{linha(l)}</Fragment>)}
    </div>
  );
}
