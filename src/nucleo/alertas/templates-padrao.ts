// Padrões PT-BR embutidos por (tipo, nível). SEM emojis: a severidade é um prefixo textual `[Atrasada]`, `[Concluída]`, `[Crítico]`.
// Escritos em HTML do Telegram (`<b>`, `<i>`, `<code>` apenas); canais de texto puro (SO, toast, webhook) recebem a mesma
// mensagem sem as marcas. Gerado a partir da tabela do plano (fase-20, "Templates"); editável pelo usuário na aba Modelos.
import type { NivelTemplate, TipoAlerta, TipoCanal } from "../../compartilhado/alertas";

export const PADROES: Readonly<Record<TipoAlerta, Readonly<Record<NivelTemplate, string>>>> = {
  tarefa_iniciada: {
    minimo: '<b>[Iniciada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}',
    padrao: '<b>[Iniciada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nQuem: {{cli}} · Pontos: {{story_points}} · Estimativa: {{estimativa|duracao}}\nMissão: {{missao|truncar:40}}',
    completo: '<b>[Iniciada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nQuem: {{cli}} ({{modelo}}) · Pontos: {{story_points}} · Estimativa: {{estimativa|duracao}}\nMissão: {{missao|truncar:40}}',
  },
  tarefa_concluida: {
    minimo: '<b>[Concluída]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}} · Pontos: {{story_points}}\nMissão: {{missao|truncar:40}}',
    padrao: '<b>[Concluída]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTempo de trabalho: {{tempo_trabalho|duracao}} (decorrido {{decorrido|duracao}}) · Tokens: {{tokens|milhar}} · Pontos: {{story_points}}\nEstimativa: {{estimativa|duracao}} · Diferença: {{atraso|delta|ou:"sem base"}} · Status: {{status}}\nMissão: {{missao|truncar:40}}',
    completo: '<b>[Concluída]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTempo de trabalho: {{tempo_trabalho|duracao}} (decorrido {{decorrido|duracao}}) · Pontos: {{story_points}}\nTokens: {{tokens|milhar}} (entrada {{tokens_entrada|milhar}} / saída {{tokens_saida|milhar}}) · Custo conhecido: {{usd}}\nEstimativa: {{estimativa|duracao}} · Diferença: {{atraso|delta|ou:"sem base"}} · Status: {{status}}\nQuem: {{cli}} ({{modelo}}) · Missão: {{missao|truncar:40}}',
  },
  tarefa_bloqueada: {
    minimo: '<b>[Bloqueada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}',
    padrao: '<b>[Bloqueada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nMotivo: {{motivo|truncar:120}} · Missão: {{missao|truncar:40}}',
    completo: '<b>[Bloqueada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nMotivo: {{motivo|truncar:120}} · Missão: {{missao|truncar:40}}',
  },
  tarefa_atrasada: {
    minimo: '<b>[Atrasada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTrabalhando há {{tempo_trabalho|duracao}} — limite {{limite|duracao}}',
    padrao: '<b>[Atrasada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTrabalhando há {{tempo_trabalho|duracao}} — limite {{limite|duracao}} (estimativa {{estimativa|duracao}}, {{story_points}} pts)\nTokens até agora: {{tokens|milhar}} · Quem: {{cli}} · Missão: {{missao|truncar:40}}',
    completo: '<b>[Atrasada]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTrabalhando há {{tempo_trabalho|duracao}} — limite {{limite|duracao}} (estimativa {{estimativa|duracao}}, {{story_points}} pts)\nTokens até agora: {{tokens|milhar}} · Quem: {{cli}} · Missão: {{missao|truncar:40}}',
  },
  tarefa_tempo: {
    minimo: '<b>[Tempo]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTempo de trabalho: {{tempo_trabalho|duracao}} (limite {{limite|duracao}})',
    padrao: '<b>[Tempo]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTempo de trabalho: {{tempo_trabalho|duracao}} (limite {{limite|duracao}})',
    completo: '<b>[Tempo]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTempo de trabalho: {{tempo_trabalho|duracao}} (limite {{limite|duracao}})',
  },
  tarefa_tokens: {
    minimo: '<b>[Tokens]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTokens: {{tokens|milhar}}',
    padrao: '<b>[Tokens]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTokens: {{tokens|milhar}}',
    completo: '<b>[Tokens]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nTokens: {{tokens|milhar}}',
  },
  tarefa_story_points: {
    minimo: '<b>[Pontos]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nPontos: {{story_points}}',
    padrao: '<b>[Pontos]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nPontos: {{story_points}}',
    completo: '<b>[Pontos]</b> <code>{{task_id}}</code> {{titulo|truncar:60}}\nPontos: {{story_points}}',
  },
  pane_aguardando: {
    minimo: '<b>[Aguardando você]</b> {{cli}} na Missão {{missao|truncar:40}} há {{espera|duracao}}.',
    padrao: '<b>[Aguardando você]</b> {{cli}} na Missão {{missao|truncar:40}} há {{espera|duracao}}.\nAbra o app para responder.',
    completo: '<b>[Aguardando você]</b> {{cli}} na Missão {{missao|truncar:40}} há {{espera|duracao}}.\nPergunta: <i>{{pergunta|truncar:120}}</i>',
  },
  pane_terminou: {
    minimo: '<b>[Terminou]</b> {{cli}} terminou.',
    padrao: '<b>[Terminou]</b> {{cli}} terminou.\nAbra o app para ver o resultado.',
    completo: '<b>[Terminou]</b> {{cli}} terminou. Missão: {{missao|truncar:40}}',
  },
  qa_aprovado: {
    minimo: '<b>[QA aprovado]</b> <code>{{task_id}}</code> Missão {{missao|truncar:40}}',
    padrao: '<b>[QA aprovado]</b> <code>{{task_id}}</code> Missão {{missao|truncar:40}}\nAchados: {{achados}} · Rodada: {{rodada}}',
    completo: '<b>[QA aprovado]</b> <code>{{task_id}}</code> Missão {{missao|truncar:40}}\nAchados: {{achados}} · Rodada: {{rodada}}',
  },
  qa_reprovado: {
    minimo: '<b>[QA reprovado]</b> <code>{{task_id}}</code> Missão {{missao|truncar:40}}',
    padrao: '<b>[QA reprovado]</b> <code>{{task_id}}</code> Missão {{missao|truncar:40}}\nAchados: {{achados}} · Rodada: {{rodada}}',
    completo: '<b>[QA reprovado]</b> <code>{{task_id}}</code> Missão {{missao|truncar:40}}\nAchados: {{achados}} · Rodada: {{rodada}}',
  },
  pr_aberto: {
    minimo: '<b>[PR aberto]</b> #{{pr_numero}} {{titulo|truncar:80}}',
    padrao: '<b>[PR aberto]</b> #{{pr_numero}} <i>"{{titulo|truncar:80}}"</i>\nBranch: {{branch}} · Checks: {{checks}}\n{{link}}',
    completo: '<b>[PR aberto]</b> #{{pr_numero}} <i>"{{titulo|truncar:80}}"</i>\nBranch: {{branch}} · Checks: {{checks}}\n{{link}}',
  },
  pr_mesclado: {
    minimo: '<b>[PR mesclado]</b> #{{pr_numero}} {{titulo|truncar:80}}',
    padrao: '<b>[PR mesclado]</b> #{{pr_numero}} <i>"{{titulo|truncar:80}}"</i>\nBranch: {{branch}}\n{{link}}',
    completo: '<b>[PR mesclado]</b> #{{pr_numero}} <i>"{{titulo|truncar:80}}"</i>\nBranch: {{branch}}\n{{link}}',
  },
  checks_falhando: {
    minimo: '<b>[Checks falhando]</b> #{{pr_numero}} {{titulo|truncar:80}}',
    padrao: '<b>[Checks falhando]</b> #{{pr_numero}} <i>"{{titulo|truncar:80}}"</i>\nBranch: {{branch}} · Checks: {{checks}}\n{{link}}',
    completo: '<b>[Checks falhando]</b> #{{pr_numero}} <i>"{{titulo|truncar:80}}"</i>\nBranch: {{branch}} · Checks: {{checks}}\n{{link}}',
  },
  cota_atingida: {
    minimo: '<b>[Cota atingida]</b> {{conta}} ({{provedor}}): {{pct|pct}}',
    padrao: '<b>[Cota atingida]</b> {{conta}} ({{provedor}}): {{pct|pct}}\nZera em: {{zera_em}}',
    completo: '<b>[Cota atingida]</b> {{conta}} ({{provedor}}): {{pct|pct}}\nZera em: {{zera_em}}',
  },
  limite_consumo: {
    minimo: '<b>[Consumo alto]</b> {{conta}} ({{provedor}}): {{pct|pct}}',
    padrao: '<b>[Consumo alto]</b> {{conta}} ({{provedor}}): {{pct|pct}}\nZera em: {{zera_em}}',
    completo: '<b>[Consumo alto]</b> {{conta}} ({{provedor}}): {{pct|pct}}\nZera em: {{zera_em}}',
  },
  conta_trocada: {
    minimo: '<b>[Conta trocada]</b> {{conta}} para {{para}} ({{provedor}})',
    padrao: '<b>[Conta trocada]</b> {{conta}} para {{para}} ({{provedor}})',
    completo: '<b>[Conta trocada]</b> {{conta}} para {{para}} ({{provedor}})',
  },
  sprint_iniciada: {
    minimo: '<b>[Sprint iniciada]</b> {{sprint_nome|truncar:40}}',
    padrao: '<b>[Sprint iniciada]</b> {{sprint_nome|truncar:40}}\nCompromisso: {{comprometido_pts}} pts · Capacidade: {{capacidade_pts}} pts',
    completo: '<b>[Sprint iniciada]</b> {{sprint_nome|truncar:40}}\nCompromisso: {{comprometido_pts}} pts · Capacidade: {{capacidade_pts}} pts',
  },
  sprint_fechada: {
    minimo: '<b>[Sprint fechada]</b> {{sprint_nome|truncar:40}}',
    padrao: '<b>[Sprint fechada]</b> {{sprint_nome|truncar:40}}\nEntregues: {{entregues_pts}} de {{comprometido_pts}} pts · Velocidade: {{velocidade}} · Retrabalho: {{retrabalho}}',
    completo: '<b>[Sprint fechada]</b> {{sprint_nome|truncar:40}}\nEntregues: {{entregues_pts}} de {{comprometido_pts}} pts · Velocidade: {{velocidade}} · Retrabalho: {{retrabalho}}',
  },
  sprint_em_risco: {
    minimo: '<b>[Sprint em risco]</b> {{sprint_nome|truncar:40}}',
    padrao: '<b>[Sprint em risco]</b> {{sprint_nome|truncar:40}}\nRestante estimado: {{restante|duracao}} · Capacidade restante: {{capacidade|duracao}}',
    completo: '<b>[Sprint em risco]</b> {{sprint_nome|truncar:40}}\nRestante estimado: {{restante|duracao}} · Capacidade restante: {{capacidade|duracao}}',
  },
  relatorio_pronto: {
    minimo: '<b>[Relatório pronto]</b> {{tipo_relatorio}} ({{formato}})',
    padrao: '<b>[Relatório pronto]</b> {{tipo_relatorio}} ({{formato}})\nAbrir no app: {{caminho}}',
    completo: '<b>[Relatório pronto]</b> {{tipo_relatorio}} ({{formato}})\nAbrir no app: {{caminho}}',
  },
  missao_concluida: {
    minimo: '<b>[Missão concluída]</b> {{missao|truncar:50}}\nTarefas: {{tarefas_feitas}}/{{tarefas_total}} · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}} · Pontos: {{story_points}}',
    padrao: '<b>[Missão concluída]</b> {{missao|truncar:50}}\nTarefas: {{tarefas_feitas}}/{{tarefas_total}} · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}} · Pontos entregues: {{story_points}}\nQuem: {{cli}}',
    completo: '<b>[Missão concluída]</b> {{missao|truncar:50}}\nTarefas: {{tarefas_feitas}}/{{tarefas_total}} · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}} · Pontos entregues: {{story_points}}\nQuem: {{cli}}',
  },
  missao_falhou: {
    minimo: '<b>[Missão falhou]</b> {{missao|truncar:50}}\nTarefas: {{tarefas_feitas}}/{{tarefas_total}} · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}}',
    padrao: '<b>[Missão falhou]</b> {{missao|truncar:50}}\nTarefas: {{tarefas_feitas}}/{{tarefas_total}} · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}}\nMotivo: {{motivo|truncar:120}}',
    completo: '<b>[Missão falhou]</b> {{missao|truncar:50}}\nTarefas: {{tarefas_feitas}}/{{tarefas_total}} · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}}\nMotivo: {{motivo|truncar:120}}',
  },
  missao_aguardando_aprovacao: {
    minimo: '<b>[Aguardando aprovação]</b> Missão {{missao|truncar:50}} há {{espera|duracao}}.',
    padrao: '<b>[Aguardando aprovação]</b> Missão {{missao|truncar:50}} há {{espera|duracao}}.',
    completo: '<b>[Aguardando aprovação]</b> Missão {{missao|truncar:50}} há {{espera|duracao}}.',
  },
  erro_sistema: {
    minimo: '<b>[Erro do sistema]</b> {{componente}} · código {{codigo}}',
    padrao: '<b>[Erro do sistema]</b> {{componente}} · código {{codigo}}',
    completo: '<b>[Erro do sistema]</b> {{componente}} · código {{codigo}}',
  },
  resumo_diario: {
    minimo: '<b>Resumo do dia</b> — {{data}}\nConcluídas: {{concluidas_n}} ({{pontos_concluidos}} pts) · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}}\nAtrasadas: {{atrasadas_n}}',
    padrao: '<b>Resumo do dia</b> — {{data}}\nConcluídas: {{concluidas_n}} ({{pontos_concluidos}} pts) · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}}\nEm andamento: {{em_andamento_n}} · Atrasadas: {{atrasadas_n}} · Bloqueadas: {{bloqueadas_n}} · PRs abertos: {{prs_n}}\n{{lista_atrasadas}}',
    completo: '<b>Resumo do dia</b> — {{data}}\nConcluídas: {{concluidas_n}} ({{pontos_concluidos}} pts) · Tempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}}\nEm andamento: {{em_andamento_n}} · Atrasadas: {{atrasadas_n}} · Bloqueadas: {{bloqueadas_n}} · PRs abertos: {{prs_n}}\n{{lista_atrasadas}}',
  },
  resumo_sprint: {
    minimo: '<b>Resumo da sprint</b> {{sprint_nome|truncar:40}}\nEntregues: {{entregues_pts}} de {{comprometido_pts}} pts',
    padrao: '<b>Resumo da sprint</b> {{sprint_nome|truncar:40}}\nEntregues: {{entregues_pts}} de {{comprometido_pts}} pts · Velocidade: {{velocidade}} · Retrabalho: {{retrabalho}}\nTempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}} · Atrasadas: {{atrasadas_n}}',
    completo: '<b>Resumo da sprint</b> {{sprint_nome|truncar:40}}\nEntregues: {{entregues_pts}} de {{comprometido_pts}} pts · Velocidade: {{velocidade}} · Retrabalho: {{retrabalho}}\nTempo de trabalho: {{tempo_trabalho|duracao}} · Tokens: {{tokens|milhar}} · Atrasadas: {{atrasadas_n}}',
  },
  agente_mensagem: {
    minimo: '<b>[Agente]</b> {{titulo|truncar:80}}',
    padrao: '<b>[Agente]</b> {{titulo|truncar:80}}\n{{detalhe|truncar:280}}',
    completo: '<b>[Agente]</b> {{titulo|truncar:80}}\n{{detalhe|truncar:280}}',
  },
  pedido_remoto: {
    minimo: '<b>[Pedido remoto]</b> de {{quem}}',
    padrao: '<b>[Pedido remoto]</b> de {{quem}}\n<i>"{{resumo|truncar:160}}"</i>',
    completo: '<b>[Pedido remoto]</b> de {{quem}}\n<i>"{{resumo|truncar:160}}"</i>',
  },
  plano_aguardando_aprovacao: {
    minimo: '<b>[Plano aguardando]</b> aprove no app (Centro de Alertas).',
    padrao: '<b>[Plano aguardando]</b> de {{quem}}: aprove no app (Centro de Alertas).\n<i>"{{resumo|truncar:160}}"</i>\nExpira em {{expira_em}}',
    completo: '<b>[Plano aguardando]</b> de {{quem}}: aprove no app (Centro de Alertas).\n<i>"{{resumo|truncar:160}}"</i>\nExpira em {{expira_em}}',
  },
  canal_erro: {
    minimo: '<b>[Erro de canal]</b> {{canal}}: {{causa}}',
    padrao: '<b>[Erro de canal]</b> {{canal}}: {{causa}}\n{{acao}}',
    completo: '<b>[Erro de canal]</b> {{canal}}: {{causa}}\n{{acao}}',
  },
};

const TAGS = /<\/?(?:b|i|code)>/g;
/** corpo padrão; canais de texto puro recebem sem as marcas HTML. */
export function corpoPadrao(tipo: TipoAlerta, canal_tipo: TipoCanal, nivel: NivelTemplate): string {
  const html = PADROES[tipo][nivel];
  return canal_tipo === "telegram" ? html : html.replace(TAGS, "");
}
