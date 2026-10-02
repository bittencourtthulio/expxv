// T-18.07: sincronizador incremental (função assíncrona pura sobre portas; o worker/IPC é do coordenador). Upsert do item espelho e do fato por
// `versao_origem`; task que some do disco vira `orfao` sem apagar histórico; NUNCA escreve em docs/** (só lê pela PortaMetodo).
import type { ConfigAgil, FatoTask, ItemAgil } from "../../../compartilhado/agil";
import { indexarMembros } from "../sprint/membros";
import type { FonteTrabalho, PortaMetodo } from "../portas";
import { chaveTask, type BancoAgil } from "../repos";
import { isoDe, type GeradorId, type Relogio } from "../util";
import { extrairFatos } from "./extrair";

export interface DepsSincronizar { banco: BancoAgil; metodo: PortaMetodo; relogio: Relogio; id: GeradorId; config: ConfigAgil }
export interface ResultadoSincronizacao {
  trabalhos_lidos: number; trabalhos_pulados: number; itens_criados: number; fatos_atualizados: number; orfaos: number;
  /** tasks que saíram de `concluida` nesta sincronização (alimenta `task_reaberta`). */
  reabertas: { trabalho_id: string; task_ref: string }[];
  sem_rastro: number;
  avisos: string[];
}

export async function sincronizar(deps: DepsSincronizar, workspaceId: string, opcoes: { forcar?: boolean; fontes?: readonly FonteTrabalho[]; /** lote de uma sincronização maior: não varre órfãos (quem chama varre no fim com `varrerOrfaos`). */ parcial?: boolean } = {}): Promise<ResultadoSincronizacao> {
  const { banco, relogio } = deps;
  const agora = relogio();
  const fontes = opcoes.fontes ?? (await deps.metodo.fontes(workspaceId));
  const r: ResultadoSincronizacao = { trabalhos_lidos: fontes.length, trabalhos_pulados: 0, itens_criados: 0, fatos_atualizados: 0, orfaos: 0, reabertas: [], sem_rastro: 0, avisos: [] };
  const indice = indexarMembros(banco.membros.valores().filter((m) => m.workspace_id === workspaceId));

  const itensPorTask = new Map<string, ItemAgil>();
  for (const it of banco.itens.valores()) if (it.workspace_id === workspaceId && it.task_ref && it.trabalho_id) itensPorTask.set(chaveTask(workspaceId, it.trabalho_id, it.task_ref), it);
  const fatosPorTrabalho = new Map<string, Map<string, FatoTask>>();
  for (const f of banco.fatos.valores()) {
    if (f.workspace_id !== workspaceId) continue;
    (fatosPorTrabalho.get(f.trabalho_id) ?? fatosPorTrabalho.set(f.trabalho_id, new Map()).get(f.trabalho_id))?.set(f.task_ref, f);
  }
  let ordemMax = banco.itens.valores().reduce((m, i) => Math.max(m, i.ordem), 0);

  banco.transacao(() => {
    const trabalhosVistos = new Set<string>();
    for (const fonte of fontes) {
      const tid = fonte.trabalho.id;
      trabalhosVistos.add(tid);
      const kv = `${workspaceId}|${tid}`;
      if (!opcoes.forcar && banco.versoes.get(kv) === fonte.versao_origem) { r.trabalhos_pulados++; continue; }
      const anteriores = fatosPorTrabalho.get(tid);
      const fatos = extrairFatos(fonte, { agora, padroesTeste: deps.config.padroes_teste, anteriores });
      const refsAtuais = new Set<string>();
      for (const f of fatos) {
        refsAtuais.add(f.task_ref);
        const m = indice.resolver({ agente: f.agente });
        if (m.aviso) r.avisos.push(`${tid}/${f.task_ref}: ${m.aviso}`);
        const completo: FatoTask = { ...f, membro_id: m.membro_id };
        const ant = anteriores?.get(f.task_ref);
        if (ant && ant.status_visto === "concluida" && f.status_visto !== "concluida") r.reabertas.push({ trabalho_id: tid, task_ref: f.task_ref });
        banco.fatos.set(chaveTask(workspaceId, tid, f.task_ref), completo);
        r.fatos_atualizados++;
        if (!f.tem_rastro) r.sem_rastro++;
        const k = chaveTask(workspaceId, tid, f.task_ref);
        const existente = itensPorTask.get(k);
        if (!existente) {
          const novo: ItemAgil = {
            id: deps.id("it"), workspace_id: workspaceId, origem: "metodo", trabalho_id: tid, task_ref: f.task_ref, epico_id: null, titulo: f.titulo, descricao: null,
            criterios: f.criterio_aceite ? [f.criterio_aceite] : [], estado_ade: "backlog", valor: null, urgencia: null, reducao_risco: null, moscow: null,
            ordem: ++ordemMax, dono_membro_id: m.membro_id, par_membro_id: null, visibilidade_cliente: "auto", resumo_cliente: null, resumo_cliente_origem: null,
            changelog_tipo: null, origem_ref: null, descartado_motivo: null, orfao: false, criado_em: isoDe(agora), atualizado_em: isoDe(agora),
          };
          banco.itens.set(novo.id, novo);
          itensPorTask.set(k, novo);
          r.itens_criados++;
        } else if (existente.origem === "metodo") {
          // espelho: título/critérios vêm do disco; estado de execução NUNCA é copiado para `estado_ade`
          const criterios = f.criterio_aceite ? [f.criterio_aceite] : [];
          if (existente.titulo !== f.titulo || existente.orfao || existente.criterios.join("\n") !== criterios.join("\n")) {
            const atualizado = { ...existente, titulo: f.titulo, criterios, orfao: false, atualizado_em: isoDe(agora) };
            banco.itens.set(existente.id, atualizado);
            itensPorTask.set(k, atualizado);
          }
        }
      }
      // tasks do trabalho que não existem mais no disco => órfãs (histórico preservado)
      for (const it of itensPorTask.values()) {
        if (it.trabalho_id === tid && it.origem === "metodo" && it.task_ref && !refsAtuais.has(it.task_ref) && !it.orfao) {
          const o = { ...it, orfao: true, atualizado_em: isoDe(agora) };
          banco.itens.set(it.id, o);
          itensPorTask.set(chaveTask(workspaceId, tid, it.task_ref), o);
          r.orfaos++;
        }
      }
      banco.versoes.set(kv, fonte.versao_origem);
    }
    // trabalho inteiro removido do disco => todos os itens espelho viram órfãos (só em sincronização completa)
    if (fontes.length > 0 && opcoes.parcial !== true) {
      for (const it of itensPorTask.values()) {
        if (it.origem === "metodo" && it.trabalho_id && !trabalhosVistos.has(it.trabalho_id) && !it.orfao) {
          const o = { ...it, orfao: true, atualizado_em: isoDe(agora) };
          banco.itens.set(it.id, o);
          itensPorTask.set(chaveTask(workspaceId, it.trabalho_id, it.task_ref as string), o);
          r.orfaos++;
        }
      }
    }
  });
  return r;
}

/** Fim de uma sincronização em lotes: todo item espelho cujo trabalho não apareceu em NENHUM lote vira órfão (histórico preservado). Lista vazia não varre nada. */
export function varrerOrfaos(deps: Pick<DepsSincronizar, "banco" | "relogio">, workspaceId: string, trabalhosVistos: ReadonlySet<string>): number {
  if (trabalhosVistos.size === 0) return 0;
  const agora = isoDe(deps.relogio());
  let n = 0;
  deps.banco.transacao(() => {
    for (const it of deps.banco.itens.valores()) {
      if (it.workspace_id === workspaceId && it.origem === "metodo" && it.trabalho_id && !trabalhosVistos.has(it.trabalho_id) && !it.orfao) {
        deps.banco.itens.set(it.id, { ...it, orfao: true, atualizado_em: agora });
        n++;
      }
    }
  });
  return n;
}
