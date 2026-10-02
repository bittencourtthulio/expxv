// Visão unificada por item para as métricas: item + fato do método + estimativa/classificação ATIVAS + retrabalho + participações em sprints.
// Montada UMA vez por cálculo (O(n) com Maps); as funções de métrica recebem `ItemMetrica[]` e são puras.
import type { EstadoFluxo, FatoTask, ItemAgil, SituacaoRetrabalho, SprintItemAgil } from "../../../compartilhado/agil";
import { chaveTask, type BancoAgil } from "../repos";

export interface ItemMetrica {
  item_id: string;
  ref: string;
  origem: ItemAgil["origem"];
  titulo: string;
  trabalho_id: string | null;
  task_ref: string | null;
  pontos: number | null;
  estimativa_origem: "ia" | "humano" | null;
  categoria: string | null;
  risco: string | null;
  criticidade: string | null;
  tipo_task: string | null;
  valor: number | null;
  urgencia: number | null;
  reducao_risco: number | null;
  criado_em: string;
  iniciada_em: string | null;
  concluida_em: string | null;
  concluida_precisa: boolean;
  validada_em: string | null;
  pronto_em: string | null;
  primeiro_evento_em: string | null;
  duracao_obs_ms: number | null;
  retrabalho_ms: number | null;
  membro_id: string | null;
  agente: string | null;
  squad_id: string | null;
  situacao: SituacaoRetrabalho | null;
  eventos_pendentes: number;
  estado_fluxo: EstadoFluxo;
  tem_rastro: boolean;
  orfao: boolean;
  descartado: boolean;
  depende_de: string[];
  intervalos: [string, string | null][];
  bloqueada_ms: number | null;
  qa_reprovacoes: number;
  participacoes: SprintItemAgil[];
}

export function estadoFluxoDe(status: string | null, validada: boolean, pronto: boolean, orfao: boolean): EstadoFluxo {
  if (orfao) return "orfao";
  if (status === "concluida") return validada ? "validada" : "concluida";
  if (status === "em_andamento" || status === "bloqueada") return "em_andamento";
  return pronto ? "pronto" : "backlog";
}

export function montarItensMetrica(banco: BancoAgil, ws: string): ItemMetrica[] {
  const fatos = new Map<string, FatoTask>();
  const fatosTrab = new Map<string, Map<string, FatoTask>>();
  for (const f of banco.fatos.valores()) {
    if (f.workspace_id !== ws) continue;
    fatos.set(chaveTask(ws, f.trabalho_id, f.task_ref), f);
    (fatosTrab.get(f.trabalho_id) ?? fatosTrab.set(f.trabalho_id, new Map()).get(f.trabalho_id))?.set(f.task_ref, f);
  }
  const est = new Map<string, { pontos: number | null; origem: "ia" | "humano" }>();
  for (const e of banco.estimativas.valores()) if (e.ativa) est.set(e.item_id, { pontos: e.pontos, origem: e.origem });
  const cls = new Map<string, { categoria: string; risco: string; criticidade: string; tipo_task: string | null }>();
  for (const c of banco.classificacoes.valores()) if (c.ativa) cls.set(c.item_id, c);
  const part = new Map<string, SprintItemAgil[]>();
  for (const p of banco.sprintItens.valores()) (part.get(p.item_id) ?? part.set(p.item_id, []).get(p.item_id))?.push(p);
  const membros = new Map(banco.membros.valores().map((m) => [m.id, m]));
  const out: ItemMetrica[] = [];
  for (const it of banco.itens.valores()) {
    if (it.workspace_id !== ws) continue;
    const f = it.trabalho_id && it.task_ref ? fatos.get(chaveTask(ws, it.trabalho_id, it.task_ref)) : undefined;
    const rt = f ? banco.retrabalhoTasks.get(chaveTask(ws, f.trabalho_id, f.task_ref)) : undefined;
    const e = est.get(it.id);
    const c = cls.get(it.id);
    let pronto: string | null = null;
    if (f && f.status_visto !== "concluida" && f.status_visto !== "em_andamento") {
      const irmaos = fatosTrab.get(f.trabalho_id);
      let ok = true;
      let maior: string | null = null;
      for (const d of f.depende_de) {
        const df = irmaos?.get(d);
        if (!df || df.status_visto !== "concluida") { ok = false; break; }
        if (df.concluida_em && (maior === null || df.concluida_em > maior)) maior = df.concluida_em;
      }
      if (ok) pronto = maior ?? f.primeiro_evento_em ?? it.criado_em;
    } else if (f) pronto = f.primeiro_evento_em ?? it.criado_em;
    else if (it.estado_ade === "pronto") pronto = it.atualizado_em;
    const membroId = f?.membro_id ?? it.dono_membro_id;
    out.push({
      item_id: it.id, ref: f ? `${f.trabalho_id}/${f.task_ref}` : it.id, origem: it.origem, titulo: it.titulo, trabalho_id: it.trabalho_id, task_ref: it.task_ref,
      pontos: e?.pontos ?? null, estimativa_origem: e?.origem ?? null, categoria: c?.categoria ?? null, risco: c?.risco ?? null, criticidade: c?.criticidade ?? null,
      tipo_task: c?.tipo_task ?? f?.tipo_task ?? null, valor: it.valor, urgencia: it.urgencia, reducao_risco: it.reducao_risco, criado_em: it.criado_em,
      iniciada_em: f?.iniciada_em ?? null, concluida_em: f?.concluida_em ?? null, concluida_precisa: f?.concluida_ts_precisa ?? false, validada_em: f?.validada_em ?? null,
      pronto_em: pronto, primeiro_evento_em: f?.primeiro_evento_em ?? null, duracao_obs_ms: f?.duracao_obs_ms ?? null, retrabalho_ms: f?.retrabalho_ms ?? null,
      membro_id: membroId, agente: f?.agente ?? null, squad_id: membroId ? membros.get(membroId)?.squad_id ?? null : null, situacao: rt?.situacao ?? null,
      eventos_pendentes: rt?.eventos_pendentes ?? 0, estado_fluxo: estadoFluxoDe(f?.status_visto ?? null, !!f?.validada_em, pronto !== null, it.orfao),
      tem_rastro: f?.tem_rastro ?? false, orfao: it.orfao, descartado: it.estado_ade === "descartado", depende_de: f?.depende_de ?? [],
      intervalos: f?.intervalos ?? [], bloqueada_ms: f?.bloqueada_ms ?? null, qa_reprovacoes: f?.qa_reprovacoes ?? 0, participacoes: part.get(it.id) ?? [],
    });
  }
  return out;
}
