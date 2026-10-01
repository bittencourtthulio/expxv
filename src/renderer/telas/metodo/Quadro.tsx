import { useMemo } from "react";
import type { StatusTask, Trabalho } from "../../../nucleo/metodo/tipos";
import { VirtualLista } from "../../componentes/VirtualLista";
import { COLUNAS_QUADRO, ROTULO_STATUS_TASK, formatarDuracao, montarQuadro, type CardQuadro } from "./util";

const GLIFO: Record<StatusTask, string> = { pendente: "○", em_andamento: "◐", concluida: "✓", bloqueada: "!" };

function Card({ c }: { c: CardQuadro }) {
  const { task } = c;
  return (
    <article className="met-card" data-status={task.status} data-pronta={c.pronta ? "true" : undefined} aria-label={`${task.id}, ${ROTULO_STATUS_TASK[task.status]}${c.pronta ? ", pronta" : ""}`}>
      <header>
        <i aria-hidden="true">{GLIFO[task.status]}</i>
        <b>{task.id}</b>
        {c.pronta ? <span className="met-selo">pronta</span> : null}
      </header>
      <p className="met-card-titulo">{task.titulo}</p>
      <footer>
        {c.bloqueio ? <span className="met-card-bloq">Bloqueio: {c.bloqueio}</span> : task.depende_de.length > 0 ? <span>depende de {task.depende_de.join(", ")}</span> : <span>sem dependências</span>}
        {task.duracao_observada_ms !== null ? <span>duração observada: {formatarDuracao(task.duracao_observada_ms)}</span> : null}
      </footer>
    </article>
  );
}

export function Quadro({ trabalho }: { trabalho: Trabalho }) {
  const colunas = useMemo(() => montarQuadro(trabalho), [trabalho]);
  return (
    <div className="met-quadro">
      {COLUNAS_QUADRO.map((status) => (
        <section key={status} className="met-coluna" data-status={status} aria-label={`Coluna ${ROTULO_STATUS_TASK[status]}`}>
          <h3>{ROTULO_STATUS_TASK[status]} <span className="met-contagem">{colunas[status].length}</span></h3>
          {colunas[status].length === 0 ? <p className="met-suave">Nenhuma task.</p> : (
            <VirtualLista itens={colunas[status]} alturaItem={92} alturaPadrao={460} rotulo={`Cards ${ROTULO_STATUS_TASK[status]}`} chave={(c) => c.task.id} renderItem={(c) => <Card c={c} />} />
          )}
        </section>
      ))}
    </div>
  );
}
