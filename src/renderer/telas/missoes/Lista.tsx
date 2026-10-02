import type { Mission } from "../../../compartilhado/dominio";
import { Badge } from "../../componentes/Badge";
import { DecoracaoVcs } from "../../componentes/DecoracaoVcs";
import { ItemLista } from "../../componentes/ItemLista";
import { Virtualizada } from "../../componentes/Virtualizada";
import { ESTADOS, ROTULO_ESTADO, ROTULO_MODO, ROTULO_ORIGEM, tomDoEstado } from "./rotulos";

const ALTURA_LINHA = 60;
const ALTURA_CARD = 72;

/** Linha de Missão no padrão único de listas (D-694): título ≫ selos de estado/modo/origem, branch na meta mono. */
export function LinhaMissao({ m, aoAbrir }: { m: Mission; aoAbrir: (id: string) => void }) {
  return (
    <ItemLista
      titulo={m.titulo}
      selos={[
        { texto: ROTULO_ESTADO[m.estado], tom: tomDoEstado(m.estado) },
        { texto: ROTULO_MODO[m.modo] },
        { texto: ROTULO_ORIGEM[m.origem] },
      ]}
      meta={m.branch !== null ? <code title={m.branch}>{m.branch}</code> : undefined}
      aoAbrir={() => aoAbrir(m.id)}
    >
      {m.worktree !== null ? <DecoracaoVcs alvo={{ workspace_id: m.workspace_id, mission_id: m.id }} className="vc-deco-card" /> : null}
    </ItemLista>
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
