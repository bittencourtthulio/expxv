import { useEffect, useState } from "react";
import type { DetalheMissao as Dados, EstadoPortoes } from "../../../compartilhado/dominio";
import { Badge } from "../../componentes/Badge";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { missaoTerminal, type StoreMissoes } from "../../estado/missoes";
import { Custo } from "./Custo";
import { PainelPortoes } from "./Portoes";
import { ROTULO_ESTADO, ROTULO_MODO, ROTULO_ORIGEM, rotuloPane, tomDoEstado } from "./rotulos";

export interface PropsDetalhe {
  id: string;
  store: StoreMissoes;
  detalhe: Dados | null | undefined;
  /** portões de intake (`undefined`/`null` = sem painel) */
  portoes?: EstadoPortoes | null | undefined;
  aoVoltar: () => void;
}

export function DetalheMissao({ id, store, detalhe, portoes, aoVoltar }: PropsDetalhe) {
  const [acao, setAcao] = useState<"encerrar" | "abortar" | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void store.observarDetalhe(id);
    return () => store.pararDetalhe(id);
  }, [id, store]);

  if (detalhe === undefined) return <div aria-busy="true">Carregando missão…</div>;
  if (detalhe === null) return <div><p>Esta missão não existe mais.</p><button type="button" className="botao" onClick={aoVoltar}>Voltar</button></div>;
  const { mission: m, panes, tasks, handoffs } = detalhe;
  const ativa = !missaoTerminal(m.estado);

  const confirmar = async () => {
    const qual = acao;
    setOcupado(true);
    try { if (qual === "encerrar") await store.encerrar(id); else if (qual === "abortar") await store.abortar(id); }
    finally { setOcupado(false); setAcao(null); }
  };

  return (
    <div className="mis-detalhe">
      <div className="barra-acoes">
        <button type="button" className="botao" onClick={aoVoltar}>← Voltar</button>
        {ativa ? <button type="button" className="botao" onClick={() => setAcao("encerrar")}>Encerrar</button> : null}
        {ativa ? <button type="button" className="botao botao-perigo" onClick={() => setAcao("abortar")}>Abortar</button> : null}
      </div>
      <h2>{m.titulo}</h2>
      <p className="mis-linha-meta">
        <Badge tom={tomDoEstado(m.estado)}>{ROTULO_ESTADO[m.estado]}</Badge>
        <Badge>{ROTULO_MODO[m.modo]}</Badge>
        <Badge>{ROTULO_ORIGEM[m.origem]}</Badge>
        {m.branch !== null ? <code>{m.branch}</code> : null}
        <span>Custo: <Custo valor={null} /></span>
      </p>

      {portoes != null && m.modo !== "livre" ? (
        <PainelPortoes estado={portoes} ativa={ativa} temPiloto={m.piloto_pane_id !== null} liberar={(p) => store.liberarPortao(id, p)} />
      ) : null}

      <h3>Panes</h3>
      {panes.length === 0 ? <p className="mis-vazio">Nenhum Pane ainda.</p> : (
        <ul className="mis-itens" aria-label="Panes">
          {panes.map((p) => <li key={p.id}><span>{rotuloPane(p, m.titulo)}</span><Badge tom={p.estado === "aguardando" ? "aviso" : "neutro"}>{p.estado}</Badge>{p.eh_piloto ? <Badge tom="destaque">piloto</Badge> : null}</li>)}
        </ul>
      )}
      <h3>Tasks</h3>
      {tasks.length === 0 ? <p className="mis-vazio">Sem tasks: o piloto ainda não delegou nada.</p> : (
        <ul className="mis-itens" aria-label="Tasks">
          {tasks.map((t) => <li key={t.id}><code>{t.task_ref}</code><span>{t.titulo}</span><Badge>{t.papel}</Badge><Badge tom={t.estado === "validada" ? "sucesso" : "neutro"}>{t.estado}</Badge></li>)}
        </ul>
      )}
      <h3>Handoffs</h3>
      {handoffs.length === 0 ? <p className="mis-vazio">Nenhum handoff registrado.</p> : (
        <ul className="mis-itens" aria-label="Handoffs">
          {handoffs.map((h) => <li key={h.id}><span>{h.resumo}</span><Badge tom={h.status === "ok" ? "sucesso" : h.status === "parcial" ? "aviso" : "alerta"}>{h.status}</Badge></li>)}
        </ul>
      )}

      {acao === "encerrar" ? (
        <DialogoConfirmacao titulo="Encerrar a missão?" rotuloConfirmar="Encerrar" ocupado={ocupado} aoCancelar={() => setAcao(null)} aoConfirmar={() => void confirmar()}
          texto={<p>A missão passa para concluída. O worktree e a branch continuam no disco: nada é apagado.</p>} />
      ) : null}
      {acao === "abortar" ? (
        <DialogoConfirmacao titulo="Abortar a missão?" rotuloConfirmar="Abortar" perigoso ocupado={ocupado} aoCancelar={() => setAcao(null)} aoConfirmar={() => void confirmar()}
          texto={<><p>O trabalho em andamento é interrompido e a missão fica como abortada.</p><p>O worktree é mantido com o que já foi feito.</p></>} />
      ) : null}
    </div>
  );
}
