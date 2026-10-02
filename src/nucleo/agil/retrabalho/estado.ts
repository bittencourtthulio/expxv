// T-18.21: situação de retrabalho por task (D-183/D-184): primeira | retrabalho | em_observacao | indeterminado.
// Marcação manual MAIS RECENTE do humano vence a detecção automática. Evento descartado (ativo=false) não conta. Escopo/ruído não derrubam.
import type { EventoRetrabalho, FatoTask, SituacaoRetrabalho, TaskRetrabalho } from "../../../compartilhado/agil";
import { janelaRetrabalho } from "./janela";
import { ms } from "../util";

export interface ContextoSituacao { agora: number; janela_dias: number; sprint_fechada_em: string | null; qa_emitido_em: string | null; tem_qa: boolean }

export function marcaManualVigente(eventos: readonly EventoRetrabalho[]): "primeira" | "retrabalho" | null {
  const m = eventos.filter((e) => e.fonte === "manual" && e.ativo).sort((a, b) => (ms(b.detectado_em) ?? 0) - (ms(a.detectado_em) ?? 0) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0))[0];
  if (!m) return null;
  return m.evidencia["situacao"] === "primeira" ? "primeira" : "retrabalho";
}

export function situacaoDaTask(fato: FatoTask, eventos: readonly EventoRetrabalho[], ctx: ContextoSituacao): TaskRetrabalho {
  const ativos = eventos.filter((e) => e.ativo && e.task_ref === fato.task_ref && e.trabalho_id === fato.trabalho_id);
  const autoDefeito = ativos.filter((e) => e.fonte !== "manual" && e.forca === "forte" && e.natureza === "defeito").length;
  const pendentes = ativos.filter((e) => e.fonte !== "manual" && e.forca === "forte" && e.natureza === "pendente").length;
  const manual = marcaManualVigente(ativos);
  const janela = fato.concluida_em ? janelaRetrabalho(fato.concluida_em, { sprint_fechada_em: ctx.sprint_fechada_em, qa_emitido_em: ctx.qa_emitido_em }, ctx.janela_dias) : null;
  let situacao: SituacaoRetrabalho | null;
  if (manual) situacao = manual;
  else if (autoDefeito > 0) situacao = "retrabalho";
  else if (fato.status_visto !== "concluida") situacao = null;
  else if (!fato.tem_rastro && !ctx.tem_qa && fato.commits.length === 0) situacao = "indeterminado";
  else if (janela && ctx.agora < (ms(janela.fim) as number)) situacao = "em_observacao";
  else situacao = "primeira";
  return {
    workspace_id: fato.workspace_id, trabalho_id: fato.trabalho_id, task_ref: fato.task_ref, situacao,
    eventos_defeito: autoDefeito + (manual === "retrabalho" ? 1 : 0), eventos_pendentes: pendentes, janela_ate: janela?.fim ?? null, calculado_em: new Date(ctx.agora).toISOString(),
  };
}
