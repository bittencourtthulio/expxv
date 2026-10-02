// T-18.34: snapshots de métricas (diário e ao fechar a sprint). Chave (workspace, escopo, chave, dia, métrica): regravar o mesmo dia sobrescreve (idempotente). Valor desconhecido = null.
import type { PainelAgil, ResumoFechamento, SprintAgil } from "../../../compartilhado/agil";
import type { BancoAgil, SnapshotMetrica } from "../repos";

const k = (s: SnapshotMetrica): string => `${s.workspace_id}|${s.escopo}|${s.chave}|${s.dia}|${s.metrica}`;

export function gravarSnapshots(banco: BancoAgil, linhas: readonly SnapshotMetrica[]): void {
  banco.transacao(() => { for (const l of linhas) banco.snapshots.set(k(l), l); });
}

export function snapshotsDoPainel(ws: string, dia: string, p: PainelAgil): SnapshotMetrica[] {
  const mk = (metrica: string, valor: number | null): SnapshotMetrica => ({ workspace_id: ws, escopo: "workspace", chave: "geral", dia, metrica, valor });
  const wipHoje = p.wip.dias[p.wip.dias.length - 1]?.valor ?? null;
  return [
    mk("ftr", p.retrabalho.first_time_right), mk("ir", p.retrabalho.ir), mk("ir_max", p.retrabalho.ir_max), mk("wip", wipHoje),
    mk("cycle_p50_ms", p.cycle.p50), mk("cycle_p85_ms", p.cycle.p85), mk("lead_p85_ms", p.lead.p85), mk("sem_estimativa", p.base.sem_estimativa), mk("tasks", p.base.tasks),
  ];
}

export function snapshotsDeFechamento(ws: string, s: Pick<SprintAgil, "id">, r: ResumoFechamento, dia: string): SnapshotMetrica[] {
  const mk = (metrica: string, valor: number | null): SnapshotMetrica => ({ workspace_id: ws, escopo: "sprint", chave: s.id, dia, metrica, valor });
  return [mk("compromisso", r.compromisso_inicial), mk("concluido", r.concluido_pontos), mk("concluidos_itens", r.concluidos), mk("carregados", r.carregados), mk("devolvidos", r.devolvidos), mk("ftr", r.first_time_right)];
}

export function serieSnapshots(banco: BancoAgil, ws: string, escopo: SnapshotMetrica["escopo"], chave: string, metrica: string): { dia: string; valor: number | null }[] {
  return banco.snapshots.valores().filter((s) => s.workspace_id === ws && s.escopo === escopo && s.chave === chave && s.metrica === metrica).sort((a, b) => a.dia.localeCompare(b.dia)).map((s) => ({ dia: s.dia, valor: s.valor }));
}
