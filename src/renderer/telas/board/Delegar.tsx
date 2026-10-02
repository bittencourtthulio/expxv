import { useEffect, useState } from "react";
import type { CardBoard, EstimativaCusto } from "../../../compartilhado/custo";
import { ade } from "../../ade";
import { Dialogo } from "../../componentes/Dialogo";
import { formatarValorUsd, LEGENDA_CUSTO } from "../../estado/custo-formato";
import { RotaPrevista } from "../missoes/RotaPrevista";

/** Diálogo de delegar o card a um worker: rota prevista, estimativa histórica ("sem histórico" com < 3 amostras) e Confirmar. Sem confirmar não há efeito. */
export function DelegarCard({ card, aoFechar, aoDelegado }: { card: CardBoard; aoFechar: () => void; aoDelegado: (r: { pane_id: string; recibo: string }) => void }) {
  const [est, setEst] = useState<EstimativaCusto | null | "indisponivel">(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const api = ade()?.custo;
    if (api?.estimativa === undefined) { setEst("indisponivel"); return undefined; }
    void api.estimativa({ workspace_id: card.workspace_id, trabalho_id: card.trabalho_id }).then((e) => { if (vivo) setEst(e); }).catch(() => { if (vivo) setEst("indisponivel"); });
    return () => { vivo = false; };
  }, [card.workspace_id, card.trabalho_id]);

  const semMissao = card.mission_id === null;
  const confirmar = async (): Promise<void> => {
    if (card.mission_id === null) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await ade()!.board.delegarCard({ workspace_id: card.workspace_id, mission_id: card.mission_id, trabalho_id: card.trabalho_id, task_id: card.task_id, confirmar: true });
      setRecibo(r.recibo);
      if (r.estimativa !== undefined) setEst(r.estimativa); // a estimativa do recibo é a mesma regra do diálogo; nunca é o custo do card
      aoDelegado({ pane_id: r.pane_id, recibo: r.recibo });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErro(/already_delegated|conflict/.test(m) ? "Este card já foi delegado." : /not_in_mission/.test(m) ? "O card não pertence a uma Missão squad/agêntico com worktree deste trabalho." : /ceiling_reached/.test(m) ? "O teto de custo da Missão foi atingido e este workspace bloqueia novos cards. Nada em andamento foi interrompido." : /wip_exceeded|limit_reached/.test(m) ? "O limite de trabalho em andamento foi atingido." : /no_router/.test(m) ? "A delegação ainda não está disponível neste build." : "Não foi possível delegar o card.");
    } finally { setEnviando(false); }
  };

  return (
    <Dialogo titulo={`Delegar ${card.task_id} a um worker`} aoFechar={aoFechar} largura={460}>
      <div className="dialogo-corpo">
        <p><strong>{card.titulo}</strong></p>
        {semMissao ? <p role="alert" className="erro-caixa">Este card não tem Missão squad/agêntico. Delegar só vale dentro de uma Missão com worktree do trabalho (o ADE nunca cria Missão aqui).</p> : null}
        <RotaPrevista papel="executor" workspaceId={card.workspace_id} api={ade()?.harness} />
        <p className="bd-nota" role="note">
          {est === null ? "Estimativa de custo: calculando…"
            : est === "indisponivel" ? "Estimativa de custo indisponível."
            : est.confianca === "sem_historico" || est.mediana_usd === null ? `Estimativa de custo: sem histórico (${est.amostras} ${est.amostras === 1 ? "amostra" : "amostras"}; são precisas pelo menos 3 cards concluídos e completos).`
            : `Estimativa de custo: mediana ${formatarValorUsd(est.mediana_usd, true)} (faixa ${formatarValorUsd(est.p25_usd, true)} a ${formatarValorUsd(est.p75_usd, true)}; ${est.amostras} cards; confiança ${est.confianca}). ${LEGENDA_CUSTO}; não é o custo do card.`}
        </p>
        <p className="bd-nota">O ADE gera o briefing a partir da task do método, cria a task no banco local e abre o Pane. Nada é escrito em <code>docs/</code>.</p>
        {recibo !== null ? <p role="status">Delegado. Recibo: {recibo}</p> : null}
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>{recibo !== null ? "Fechar" : "Cancelar"}</button>
        {recibo === null ? <button type="button" className="botao botao-primario" data-foco-inicial disabled={enviando || semMissao} onClick={() => void confirmar()}>{enviando ? "Delegando…" : "Confirmar"}</button> : null}
      </div>
    </Dialogo>
  );
}
