import { useEffect } from "react";
import type { DetalheMissao } from "../../../compartilhado/dominio";
import type { EntradaMemoria } from "../../../compartilhado/memoria";
import { ade } from "../../ade";
import { useCarga } from "../../estado/carga";
import { storeMemoria, useMemoria, type StoreMemoria } from "../../estado/memoria";
import { useBriefDoPane, eventosMemoria } from "../../estado/memoria-eventos";
import { missaoTerminal } from "../../estado/missoes";
import { pedirTela } from "../../estado/navegacao";
import { modoDaMissao, semAprendizadoDoPiloto, valorDoModoMissao, type ModoMissao } from "../memoria/logica";
import "../memoria/memoria.css";

const ROTULO_MODO_MISSAO: Record<ModoMissao, string> = { herdar: "Herdar do projeto", ligada: "Ligada", desligada: "Desligada" };

function LinhaBrief({ paneId, rotulo }: { paneId: string; rotulo: string }) {
  const b = useBriefDoPane(paneId, eventosMemoria);
  if (b === undefined) return null;
  return <li>{rotulo}: brief de {b.caracteres} caracteres{b.truncado ? " (resumido para caber)" : ""}</li>;
}

/** Seção discreta da Missão: chave de memória por Missão, brief/pacote usado e o aviso `no_learning_recorded` ao fim da Missão. */
export function MemoriaMissao({ detalhe, store = storeMemoria }: { detalhe: DetalheMissao; store?: StoreMemoria }) {
  const { mission: m, panes } = detalhe;
  const mem = useMemoria(store);
  useEffect(() => { store.iniciar(); void store.definirWorkspace(m.workspace_id); }, [store, m.workspace_id]);
  const terminal = missaoTerminal(m.estado);
  const api = ade()?.memoria;
  const aprendizados = useCarga<readonly EntradaMemoria[]>(
    api === undefined || typeof api.listar !== "function" || !terminal || m.modo === "livre" ? undefined
      : () => api.listar({ workspace_id: m.workspace_id, escopo: null, mission_id: m.id, pane_id: null, tipos: ["aprendizado"], busca: null, depois: null, limite: 50 }).then((p) => p.itens),
    `aprend|${m.id}|${terminal}`,
  );

  if (m.modo === "livre" || api === undefined) return null;
  const valor = mem.estado?.missoes?.[m.id];
  const efetivo = mem.estado === null ? null : valor ?? mem.estado.config.ativa;
  const global = mem.estado?.config.global_ativa;
  const semAprendizado = aprendizados.estado === "ok" && semAprendizadoDoPiloto(terminal, aprendizados.dados);
  const sistema = aprendizados.estado === "ok" && aprendizados.dados.some((e) => e.fonte === "sistema");
  const comBrief = panes.filter((p) => p.respawn_de !== null);

  return (
    <section className="mem-missao" aria-label="Memória da missão">
      <h3>Memória</h3>
      <div className="mem-linha-controles">
        <label htmlFor={`mem-missao-${m.id}`}>Memória nesta missão</label>
        <select id={`mem-missao-${m.id}`} value={modoDaMissao(valor)} disabled={mem.estado === null || terminal} onChange={(e) => void store.definirMissao(m.id, valorDoModoMissao(e.target.value as ModoMissao))}>
          {(Object.keys(ROTULO_MODO_MISSAO) as ModoMissao[]).map((k) => <option key={k} value={k}>{ROTULO_MODO_MISSAO[k]}</option>)}
        </select>
        <span className="mem-nota">{mem.estado === null ? "Carregando…" : global === false ? "Desligada neste computador (Configurações)." : efetivo ? "Coletando decisões, riscos e entregas." : "Não coleta; o que já existe fica guardado."}</span>
      </div>
      {efetivo === true && m.modo === "agentico" && !terminal ? <p className="mem-nota">O piloto recebeu o pacote da memória do projeto ao abrir (aprendizados e preferências, no máximo 2 500 caracteres).</p> : null}
      {comBrief.length > 0 ? (
        <ul className="mem-nota" aria-label="Briefs usados" style={{ margin: "2px 0", paddingLeft: 16 }}>
          {comBrief.map((p) => <LinhaBrief key={p.id} paneId={p.respawn_de as string} rotulo={`Painel #${p.display_id}`} />)}
        </ul>
      ) : null}
      {semAprendizado ? (
        <p className="mem-faixa" role="status">
          Sem aprendizado registrado pelo piloto (<code>no_learning_recorded</code>). {sistema ? "O sistema gravou um resumo automático dos handoffs, sem usar modelo." : "Nada foi gravado para o projeto aprender com esta missão."}
          <button type="button" onClick={() => pedirTela("memoria")}>Ver memória</button>
        </p>
      ) : null}
    </section>
  );
}
