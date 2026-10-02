import { useEffect } from "react";
import { Badge } from "../../componentes/Badge";
import { pedirAlertas } from "../../estado/alertas-acoes";
import { SEVERIDADE_VISUAL } from "../../estado/alertas-formato";
import { storeAlertas, useAlertas, type StoreAlertas } from "../../estado/alertas";
import type { AlertaVisao } from "../../../compartilhado/alertas";

/** Os até 3 alertas não lidos mais graves (crítico e aviso), do mais novo para o mais velho. */
export function maisGraves(recentes: readonly AlertaVisao[], n = 3): AlertaVisao[] {
  return recentes.filter((a) => a.lido_em === null && (a.severidade === "critico" || a.severidade === "aviso")).slice(0, n);
}

/** Início · Alertas: só aparece se o canal de alertas existe nesta janela. */
export function CartaoAlertasInicio({ store = storeAlertas }: { store?: StoreAlertas }) {
  const { recentes, contagem, disponivel } = useAlertas(store);
  useEffect(() => { const parar = store.iniciar(); void store.carregarRecentes(20); return parar; }, [store]);
  if (!disponivel) return null;
  const itens = maisGraves(recentes);
  return (
    <section className="ini-cartao" aria-label="Alertas">
      <h2>Alertas{contagem.nao_lidos > 0 ? <Badge tom={contagem.criticos > 0 ? "alerta" : "destaque"}>{contagem.nao_lidos}</Badge> : null}</h2>
      {itens.length === 0 ? <p className="ini-nada">Nenhum alerta crítico ou de aviso pendente.</p> : (
        <ul className="ini-lista">
          {itens.map((a) => {
            const v = SEVERIDADE_VISUAL[a.severidade];
            return (
              <li key={a.id}>
                <button type="button" className="ini-item" onClick={() => pedirAlertas("alertas")}>
                  <span>{a.titulo}</span>
                  <span className="ini-detalhe"><span aria-hidden="true">{v.glifo}</span> {v.texto}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="botao" onClick={() => pedirAlertas("alertas")}>Abrir o Centro de Alertas</button>
    </section>
  );
}
