// T-18.29: fechar a sprint. AÇÃO HUMANA (D-21; o ADE só SUGERE). Atômico (tudo ou nada), idempotente (fechar 2x não duplica evento), nada em docs/**.
// Resultado por item: concluido | carregado (vai à próxima sprint) | devolvido (ao backlog) | descartado. Snapshot final de métricas e `sprint.fechada` no barramento.
import type { ConfigAgil, ResumoFechamento, SprintAgil } from "../../../compartilhado/agil";
import { apenasHumano, invalido, naoEncontrado, regraViolada } from "../erros";
import { jaPublicado, novoEvento, publicadorNulo, type Publicador } from "../eventos";
import { montarItensMetrica, type ItemMetrica } from "../metricas/dados";
import { resumirRetrabalho, type LinhaRetrabalho } from "../retrabalho/agregar";
import { gravarSnapshots, snapshotsDeFechamento } from "../metricas/snapshots";
import { chaveSprintItem, type BancoAgil } from "../repos";
import { diaDe, isoDe, type Relogio } from "../util";
import { itensDaSprint } from "./ciclo";

export interface DepsFechar { banco: BancoAgil; relogio: Relogio; config: ConfigAgil; pub?: Publicador }
export type DestinoPendentes = "backlog" | "proxima" | "descartar";

const concluido = (i: ItemMetrica | undefined): boolean => !!i && !!i.concluida_em;

/** sugere fechar quando TODOS os itens (não removidos) estão concluídos. Só sugestão. */
export function sugerirFechar(banco: BancoAgil, sprintId: string): boolean {
  const s = banco.sprints.get(sprintId);
  if (!s || s.estado !== "ativa") return false;
  const itens = montarItensMetrica(banco, s.workspace_id);
  const porId = new Map(itens.map((i) => [i.item_id, i]));
  const ativos = itensDaSprint(banco, sprintId).filter((x) => !x.removido_em);
  return ativos.length > 0 && ativos.every((x) => concluido(porId.get(x.item_id)));
}

/** fechamento automático (opt-in `fechar_automatico`): tudo concluído E validado (QA aprovado). Desligado por padrão. */
export function deveFecharAutomaticamente(banco: BancoAgil, config: Pick<ConfigAgil, "fechar_automatico">, sprintId: string): boolean {
  if (!config.fechar_automatico || !sugerirFechar(banco, sprintId)) return false;
  const s = banco.sprints.get(sprintId) as SprintAgil;
  const porId = new Map(montarItensMetrica(banco, s.workspace_id).map((i) => [i.item_id, i]));
  return itensDaSprint(banco, sprintId).filter((x) => !x.removido_em).every((x) => porId.get(x.item_id)?.estado_fluxo === "validada");
}

export function fecharSprint(d: DepsFechar, p: { sprint_id: string; destino_pendentes: DestinoPendentes; versao_lancamento?: string | null; ator: "humano" | "agente" }): { resumo: ResumoFechamento; ja_fechada: boolean } {
  if (p.ator !== "humano") throw apenasHumano("sprint.fechar");
  const { banco } = d;
  const s = banco.sprints.get(p.sprint_id);
  if (!s) throw naoEncontrado(`sprint ${p.sprint_id}`);
  if (s.estado === "fechada" && s.resumo_fechamento) return { resumo: s.resumo_fechamento, ja_fechada: true };
  if (s.estado !== "ativa") throw regraViolada(`sprint ${s.estado} não pode ser fechada`);
  if (!["backlog", "proxima", "descartar"].includes(p.destino_pendentes)) throw invalido("destino_pendentes inválido");
  let proxima: SprintAgil | null = null;
  if (p.destino_pendentes === "proxima") {
    proxima = banco.sprints.valores().filter((x) => x.workspace_id === s.workspace_id && x.estado === "planejada" && x.inicio >= s.inicio).sort((a, b) => a.inicio.localeCompare(b.inicio))[0] ?? null;
    if (!proxima) throw invalido("não há próxima sprint planejada para carregar os pendentes");
  }
  const agora = isoDe(d.relogio());
  const itens = montarItensMetrica(banco, s.workspace_id);
  const porId = new Map(itens.map((i) => [i.item_id, i]));
  const resultado = { concluidos: 0, carregados: 0, devolvidos: 0, descartados: 0 };
  let pontos: number | null = null;
  let semEst = 0;
  const linhas: LinhaRetrabalho[] = [];
  const resumo = banco.transacao((): ResumoFechamento => {
    for (const x of itensDaSprint(banco, s.id)) {
      if (x.removido_em) continue;
      const it = porId.get(x.item_id);
      let r: "concluido" | "carregado" | "devolvido" | "descartado";
      if (concluido(it)) r = "concluido";
      else r = p.destino_pendentes === "backlog" ? "devolvido" : p.destino_pendentes === "proxima" ? "carregado" : "descartado";
      banco.sprintItens.set(chaveSprintItem(s.id, x.item_id), { ...x, resultado: r });
      if (it && it.pontos === null) semEst++;
      if (r === "concluido") { resultado.concluidos++; if (it?.pontos != null) pontos = (pontos ?? 0) + it.pontos; }
      else if (r === "devolvido") resultado.devolvidos++;
      else if (r === "descartado") {
        resultado.descartados++;
        const base = banco.itens.get(x.item_id);
        if (base) banco.itens.set(base.id, { ...base, estado_ade: "descartado", descartado_motivo: `descartado no fechamento de ${s.nome}`, atualizado_em: agora });
      } else {
        resultado.carregados++;
        if (proxima) banco.sprintItens.set(chaveSprintItem(proxima.id, x.item_id), { sprint_id: proxima.id, item_id: x.item_id, adicionado_em: agora, removido_em: null, pontos_compromisso: it?.pontos ?? null, no_compromisso_inicial: true, motivo: `carregado de ${s.nome}`, resultado: null });
      }
      if (it) linhas.push({ chave: it.ref, situacao: it.situacao, eventos_pendentes: it.eventos_pendentes, pontos: it.pontos, categoria: it.categoria, sprint_id: s.id, membro_id: it.membro_id, agente: it.agente, squad_id: it.squad_id, retrabalho_ms: it.retrabalho_ms });
    }
    const r: ResumoFechamento = {
      compromisso_inicial: s.compromisso_pontos, concluido_pontos: pontos, concluidos: resultado.concluidos, carregados: resultado.carregados, devolvidos: resultado.devolvidos,
      descartados: resultado.descartados, sem_estimativa: semEst, first_time_right: resumirRetrabalho(linhas).first_time_right, destino_pendentes: p.destino_pendentes,
    };
    banco.sprints.set(s.id, { ...s, estado: "fechada", fechada_em: agora, versao_lancamento: p.versao_lancamento ?? null, resumo_fechamento: r, atualizado_em: agora });
    gravarSnapshots(banco, snapshotsDeFechamento(s.workspace_id, s, r, diaDe(agora)));
    return r;
  });
  if (!jaPublicado(banco, "sprint.fechada", s.id)) {
    (d.pub ?? publicadorNulo).publicar(novoEvento("sprint.fechada", s.workspace_id, d.relogio, { sprint_id: s.id, pontos: resumo.concluido_pontos, dados: { resumo_fechamento: resumo, versao_lancamento: p.versao_lancamento ?? null } }));
  }
  return { resumo, ja_fechada: false };
}
