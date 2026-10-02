// Catálogo fechado dos tipos de alerta: severidade padrão, fonte, se agrupa e se pode sair da máquina por padrão.
// `fonte_indisponivel`: a fase dona ainda não expõe o evento; o tipo aparece cinza em Regras e nunca inventa dado (T-20.10).
import type { FonteAlerta, Severidade, TipoAlerta } from "../../compartilhado/alertas";
import { TIPOS_ALERTA } from "../../compartilhado/alertas";

export interface MetaTipo {
  severidade: Severidade;
  fonte: FonteAlerta;
  agrupavel: boolean;
  /** `false` = nunca vai a canal EXTERNO sem regra explícita (agente_mensagem, AB-12). */
  externo_por_padrao: boolean;
  fonte_indisponivel: boolean;
  rotulo: string;
}

const m = (severidade: Severidade, fonte: FonteAlerta, rotulo: string, extra: Partial<MetaTipo> = {}): MetaTipo => ({
  severidade,
  fonte,
  agrupavel: true,
  externo_por_padrao: true,
  fonte_indisponivel: false,
  rotulo,
  ...extra,
});

export const CATALOGO: Readonly<Record<TipoAlerta, MetaTipo>> = {
  tarefa_iniciada: m("info", "metodo", "Tarefa iniciada"),
  tarefa_concluida: m("sucesso", "metodo", "Tarefa concluída"),
  tarefa_bloqueada: m("aviso", "metodo", "Tarefa bloqueada"),
  tarefa_atrasada: m("aviso", "metodo", "Tarefa atrasada", { agrupavel: false }),
  tarefa_tempo: m("aviso", "metodo", "Tempo de trabalho acima do esperado"),
  tarefa_tokens: m("aviso", "consumo", "Tokens acima do esperado"),
  tarefa_story_points: m("info", "agil", "Story points alterados"),
  pane_aguardando: m("aviso", "pane", "Aguardando você"),
  // terminal livre terminou (sinaleira): só no app e no SO; nunca a canal externo por curinga (a sinaleira não tem task nem custo)
  pane_terminou: m("info", "pane", "Terminal terminou", { externo_por_padrao: false }),
  qa_aprovado: m("sucesso", "metodo", "QA aprovado"),
  qa_reprovado: m("aviso", "metodo", "QA reprovado"),
  pr_aberto: m("info", "vcs", "PR aberto", { fonte_indisponivel: true }),
  pr_mesclado: m("sucesso", "vcs", "PR mesclado", { fonte_indisponivel: true }),
  checks_falhando: m("aviso", "vcs", "Checks falhando", { fonte_indisponivel: true }),
  cota_atingida: m("aviso", "consumo", "Cota atingida", { agrupavel: false }),
  limite_consumo: m("aviso", "consumo", "Consumo perto do limite", { agrupavel: false }),
  conta_trocada: m("info", "consumo", "Conta trocada"),
  sprint_iniciada: m("info", "agil", "Sprint iniciada"),
  sprint_fechada: m("sucesso", "agil", "Sprint fechada"),
  sprint_em_risco: m("aviso", "agil", "Sprint em risco", { agrupavel: false }),
  relatorio_pronto: m("info", "relatorio", "Relatório pronto"),
  missao_concluida: m("sucesso", "missao", "Missão concluída"),
  missao_falhou: m("critico", "missao", "Missão falhou", { agrupavel: false }),
  missao_aguardando_aprovacao: m("aviso", "missao", "Missão aguardando aprovação", { agrupavel: false }),
  erro_sistema: m("critico", "sistema", "Erro do sistema", { agrupavel: false }),
  resumo_diario: m("info", "sistema", "Resumo do dia", { agrupavel: false }),
  resumo_sprint: m("info", "agil", "Resumo da sprint", { agrupavel: false }),
  agente_mensagem: m("info", "agente", "Mensagem de agente", { externo_por_padrao: false }),
  pedido_remoto: m("info", "remoto", "Pedido remoto", { agrupavel: false }),
  plano_aguardando_aprovacao: m("aviso", "remoto", "Plano aguardando aprovação", { agrupavel: false }),
  canal_erro: m("critico", "sistema", "Erro de canal", { agrupavel: false }),
};

export const ordemSeveridade: Readonly<Record<Severidade, number>> = { info: 0, sucesso: 1, aviso: 2, critico: 3 };

export const ehTipoAlerta = (v: unknown): v is TipoAlerta => typeof v === "string" && (TIPOS_ALERTA as readonly string[]).includes(v);
export const severidadeMin = (a: Severidade, minima: Severidade): boolean => ordemSeveridade[a] >= ordemSeveridade[minima];
