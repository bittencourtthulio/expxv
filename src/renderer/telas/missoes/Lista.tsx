import type { Mission } from "../../../compartilhado/dominio";
import { Badge } from "../../componentes/Badge";
import { Virtualizada } from "../../componentes/Virtualizada";
import { ESTADOS, ROTULO_ESTADO, ROTULO_MODO, ROTULO_ORIGEM, tomDoEstado } from "./rotulos";

const ALTURA_LINHA = 60;
const ALTURA_CARD = 72;

export function LinhaMissao({ m, aoAbrir }: { m: Mission; aoAbrir: (id: string) => void }) {
  return (
    <button type="button" className="mis-linha" onClick={() => aoAbrir(m.id)}>
      <span className="mis-linha-titulo">{m.titulo}</span>
      <span className="mis-linha-meta">
        <Badge tom={tomDoEstado(m.estado)}>{ROTULO_ESTADO[m.estado]}</Badge>
        <Badge>{ROTULO_MODO[m.modo]}</Badge>
        <Badge>{ROTULO_ORIGEM[m.origem]}</Badge>
        {m.branch !== null ? <code>{m.branch}</code> : null}
      </span>
    </button>
  );
}

export function ListaMissoes({ itens, aoAbrir }: { itens: readonly Mission[]; aoAbrir: (id: string) => void }) {
  return (
    <div className="mis-lista">
      <Virtualizada itens={itens} alturaItem={ALTURA_LINHA} rotulo="Missões" chave={(m) => m.id} renderizar={(m) => <LinhaMissao m={m} aoAbrir={aoAbrir} />} />
    </div>
  );
}

export function QuadroMissoes({ itens, aoAbrir }: { itens: readonly Mission[]; aoAbrir: (id: string) => void }) {
  return (
    <div className="mis-quadro">
      {ESTADOS.map((estado) => {
        const col = itens.filter((m) => m.estado === estado);
        return (
          <section key={estado} className="mis-coluna" aria-label={ROTULO_ESTADO[estado]}>
            <h3>{ROTULO_ESTADO[estado]} <Badge>{col.length}</Badge></h3>
            <div className="mis-coluna-corpo">
              <Virtualizada itens={col} alturaItem={ALTURA_CARD} rotulo={`Missões ${ROTULO_ESTADO[estado]}`} chave={(m) => m.id} renderizar={(m) => <LinhaMissao m={m} aoAbrir={aoAbrir} />} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
