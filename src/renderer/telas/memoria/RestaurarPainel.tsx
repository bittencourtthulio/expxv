import { useEffect, useState } from "react";
import type { DetalheMissao, Pane } from "../../../compartilhado/dominio";
import { ade } from "../../ade";
import { Dialogo } from "../../componentes/Dialogo";
import { ItemLista } from "../../componentes/ItemLista";
import { useMissoes, storeMissoes } from "../../estado/missoes";
import { ControlesRestaurar, DialogoPreviaBrief } from "./ControlesRestaurar";

interface Encerrado { pane: Pane; missao: string }
export const MAX_MISSOES_NA_BUSCA = 20;

/** Paleta "Memória: restaurar painel": lista os Panes encerrados das Missões recentes do projeto, cada um com os controles de restauração. */
export function RestaurarPainel({ aoFechar }: { aoFechar: () => void }) {
  const { itens } = useMissoes(storeMissoes);
  const [lista, setLista] = useState<Encerrado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [previaPane, setPreviaPane] = useState<string | null>(null);

  useEffect(() => {
    const api = ade()?.missoes;
    if (api === undefined || typeof api.detalhe !== "function") { setLista([]); return; }
    let vivo = true;
    Promise.all(itens.slice(0, MAX_MISSOES_NA_BUSCA).map((m) => api.detalhe(m.id).catch(() => null)))
      .then((ds) => {
        if (!vivo) return;
        const achados = (ds.filter((d): d is DetalheMissao => d !== null)).flatMap((d) => d.panes.filter((p) => p.estado === "encerrado" && p.tipo === "cli").map((p) => ({ pane: p, missao: d.mission.titulo })));
        setLista(achados);
      })
      .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : String(e)); setLista([]); } });
    return () => { vivo = false; };
  }, [itens]);

  return (
    <Dialogo titulo="Restaurar painel" aoFechar={aoFechar} largura={640}>
      <div className="dialogo-corpo">
        <p className="mem-nota">Painéis encerrados das Missões recentes. Restaurar reabre o painel com um brief curto do que ele já decidiu e entregou.</p>
        {erro !== null ? <p role="alert" className="mem-erro">{erro}</p> : null}
        {lista === null ? <p role="status" aria-busy="true">Procurando painéis…</p> : lista.length === 0 ? (
          <p className="mem-vazio" role="status">Nenhum painel encerrado nas Missões recentes. Quando um painel fechar ou cair, ele aparece aqui.</p>
        ) : (
          <ul className="mem-lista-restaurar" aria-label="Painéis encerrados">
            {lista.map(({ pane, missao }) => {
              const rotulo = `#${pane.display_id} · ${pane.cli ?? "CLI"} · ${pane.papel} · ${missao}`;
              return (
                <li key={pane.id}>
                  <ItemLista
                    densa
                    id={pane.id}
                    titulo={`#${pane.display_id} · ${pane.cli ?? "CLI"} · ${pane.papel}`}
                    descricao={missao}
                    aoAbrir={() => setPreviaPane(pane.id)}
                    acao={<ControlesRestaurar paneId={pane.id} rotulo={rotulo} aoRestaurado={aoFechar} />}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Fechar</button></div>
      {previaPane !== null ? <DialogoPreviaBrief paneId={previaPane} aoFechar={() => setPreviaPane(null)} /> : null}
    </Dialogo>
  );
}
