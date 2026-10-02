// Dados e API falsa da Gestão ágil (só teste). Nenhum dado real; a API registra chamadas por `vi.fn` no teste.
import type {
  ApiAgil, CapacidadeSprintAgil, ConfigAgil, DailyAgil, EstadoAgilApp, ItemAgil, ItemDetalheAgil, ItemResumo, MembroAgil, PainelAgil, PaginaBacklogAgil, RetroAgil, SprintComResumoAgil,
} from "../../../compartilhado/agil";

export const WS = "w1";
export const DIAS = Array.from({ length: 10 }, (_, i) => `2026-03-${String(2 + i).padStart(2, "0")}`);

export function painelFalso(extra: Partial<PainelAgil> = {}): PainelAgil {
  const resumo = { ir: 0.2, ir_max: 0.3, first_time_right: 0.8, avaliaveis: 10, em_observacao: 2, indeterminado: 1, escopo_eventos: 1, pontos_retrabalhados: 5, horas_obs_retrabalho_min: 3 };
  return {
    filtros: { sprint_id: null, membro_id: null, agente: null, squad_id: null, de: null, ate: null },
    gerado_em: "2026-03-12T10:00:00.000Z",
    base: { tasks: 40, itens: 42, sprints: 3, sem_estimativa: 4, sem_rastro: 2 },
    burndown: { unidade: "pontos", sprint_id: "s1", compromisso_inicial: 20, sem_estimativa: 1, dias: DIAS.map((dia, i) => ({ dia, escopo: 20 + (i > 4 ? 3 : 0), concluido: i < 8 ? i * 2 : null, restante: i < 8 ? 20 - i * 2 : null, ideal: 20 - i * 2.2 })) },
    burnup: { unidade: "pontos", sprint_id: "s1", compromisso_inicial: 20, sem_estimativa: 1, dias: DIAS.map((dia, i) => ({ dia, escopo: 20 + (i > 4 ? 3 : 0), concluido: i < 8 ? i * 2 : null, restante: null, ideal: 0 })) },
    velocidade: [1, 2, 3].map((n) => ({ sprint_id: `s${n}`, nome: `Sprint ${n}`, compromisso: 20, concluido: 14 + n, de_primeira: 10 + n, media_movel_3: n === 3 ? 16 : null })),
    cfd: { dias: [], acumulado: DIAS.map((dia, i) => ({ dia, backlog: 20 - i, pronto: 5, em_andamento: 3, concluida: i, validada: i / 2 })) },
    cycle: { estado: "ok", n: 6, p50: 3_600_000 * 4, p85: 3_600_000 * 8, p95: 3_600_000 * 12, amostras: Array.from({ length: 6 }, (_, i) => ({ ref: `tr/T-0${i}`, ms: 3_600_000 * (2 + i * 2) })) },
    lead: { estado: "ok", n: 5, p50: 3_600_000 * 20, p85: 3_600_000 * 30, p95: 3_600_000 * 40, amostras: Array.from({ length: 5 }, (_, i) => ({ ref: `tr/L-0${i}`, ms: 3_600_000 * (10 + i * 8) })) },
    throughput: DIAS.map((dia, i) => ({ dia, valor: i % 4 })),
    wip: { dias: DIAS.map((dia, i) => ({ dia, valor: 2 + (i % 3) })), limite: 4, idade: [{ ref: "tr/T-01", idade_ms: 86_400_000 * 3 }, { ref: "tr/T-02", idade_ms: 86_400_000 }] },
    retrabalho: { ...resumo, por_sprint: [{ sprint_id: "s1", resumo }, { sprint_id: "s2", resumo: { ...resumo, ir: 0.1 } }], por_categoria: [{ categoria: "feature", resumo }, { categoria: "bug", resumo: { ...resumo, ir: 0.5 } }] },
    planejado_entregue: { compromisso_inicial: 20, entregue_do_compromisso: 14, adicionado_meio: 3, entregue_adicionado: 2, removido: 1, carregado: 5, sem_estimativa: 1 },
    defeitos_escapados: { total: 3, por_sprint: [{ sprint_id: "s1", n: 2 }, { sprint_id: "s2", n: 1 }], por_categoria: [{ categoria: "bug", n: 3 }] },
    distribuicao: { risco: { baixo: 10, medio: 5, alto: 2, critico: 1 }, categoria: { feature: 12, bug: 6 }, criticidade: { baixa: 4, media: 10, alta: 4 }, sem_classificacao: 3 },
    previsao: { estado: "ok", iteracoes: 10000, p50_dias: 5, p85_dias: 8, p95_dias: 11, p50_data: "2026-03-20", p85_data: "2026-03-25", p95_data: "2026-03-30", prob_fechar_na_sprint: 0.6, restante: 12, amostra_dias: 30 },
    saude: [
      { id: "progresso", cor: "verde", frase: "Progresso dentro do ideal", fato: "restante 8 vs ideal 9" },
      { id: "escopo", cor: "amarelo", frase: "Escopo cresceu 15 %", fato: "3 pontos adicionados" },
      { id: "wip", cor: "vermelho", frase: "WIP acima do limite", fato: "5 de 4" },
    ],
    erro_estimativa: { por_categoria: [{ categoria: "feature", n: 6, vies: 1.2, mdape: 0.3 }], pontos: Array.from({ length: 6 }, (_, i) => ({ item_id: `it${i}`, previsto: 1 + i, observado_ms: 3_600_000 * (1 + i * 1.5), razao: 1.1 })), vies: 1.2, mdape: 0.3 },
    valor_esforco: Array.from({ length: 8 }, (_, i) => ({ item_id: `it${i}`, valor: 1 + i, esforco: 8 - i, quadrante: (["ganho_rapido", "grande_aposta", "preencher", "evitar"] as const)[i % 4] as "ganho_rapido" })),
    ...extra,
  };
}

export function painelVazio(): PainelAgil {
  const p = painelFalso();
  return {
    ...p, base: { tasks: 0, itens: 0, sprints: 0, sem_estimativa: 0, sem_rastro: 0 }, burndown: null, burnup: null, velocidade: [], cfd: { dias: [], acumulado: [] },
    cycle: { estado: "poucos_dados", n: 0, p50: null, p85: null, p95: null, amostras: [] }, lead: { estado: "poucos_dados", n: 0, p50: null, p85: null, p95: null, amostras: [] },
    throughput: [], wip: { dias: [], limite: null, idade: [] }, planejado_entregue: null, defeitos_escapados: { total: 0, por_sprint: [], por_categoria: [] },
    distribuicao: { risco: {}, categoria: {}, criticidade: {}, sem_classificacao: 0 }, previsao: { estado: "dados_insuficientes" }, saude: [],
    erro_estimativa: { por_categoria: [], pontos: [], vies: null, mdape: null }, valor_esforco: [],
    retrabalho: { ir: null, ir_max: null, first_time_right: null, avaliaveis: 0, em_observacao: 0, indeterminado: 0, escopo_eventos: 0, pontos_retrabalhados: null, horas_obs_retrabalho_min: null, por_sprint: [], por_categoria: [] },
  };
}

export const ESTADO_PADRAO: EstadoAgilApp = {
  workspace_id: WS, sincronizando: false, ultima_sincronizacao: "2026-03-12T09:00:00.000Z", erro_sincronizacao: null,
  base: { tasks: 40, itens: 42, sprints: 3, membros: 2 }, ia: { consentimento: false, modo: "ia_sugere", chamadas_hoje: 0, teto_dia: 40, perfil: "rapido", disponivel: true },
  sprint_ativa: { id: "s1", nome: "Sprint 1", inicio: "2026-03-02", fim: "2026-03-13" },
};

export function itemResumo(i: number, extra: Partial<ItemResumo> = {}): ItemResumo {
  return {
    id: `it${i}`, origem: i % 3 === 0 ? "metodo" : "ade", trabalho_id: i % 3 === 0 ? "tr1" : null, task_ref: i % 3 === 0 ? `T-01.${i}` : null, titulo: `Item ${i}`, epico_id: null, estado_ade: "backlog",
    estado_fluxo: "backlog", pontos: i % 2 === 0 ? 3 : null, categoria: i % 2 === 0 ? "feature" : null, risco: i % 2 === 0 ? "baixo" : null, criticidade: i % 2 === 0 ? "media" : null, ordem: i, wsjf: null,
    situacao_retrabalho: null, duracao_obs_ms: null, sprint_id: null, dono: null, estimativa_origem: i % 2 === 0 ? "ia" : null, estimativa_confianca: i % 2 === 0 ? 0.6 : null, ...extra,
  };
}

export function itemAgilFalso(i: number, extra: Partial<ItemAgil> = {}): ItemAgil {
  return {
    id: `it${i}`, workspace_id: WS, origem: "ade", trabalho_id: null, task_ref: null, epico_id: null, titulo: `Item ${i}`, descricao: null, criterios: ["Funciona"], estado_ade: "backlog", valor: null, urgencia: null, reducao_risco: null,
    moscow: null, ordem: i, dono_membro_id: null, par_membro_id: null, visibilidade_cliente: "auto", resumo_cliente: null, resumo_cliente_origem: null, changelog_tipo: null, origem_ref: null, descartado_motivo: null, orfao: false,
    criado_em: "2026-03-01T00:00:00.000Z", atualizado_em: "2026-03-01T00:00:00.000Z", ...extra,
  };
}

export function detalheFalso(i: number, extra: Partial<ItemDetalheAgil> = {}): ItemDetalheAgil {
  const item = itemAgilFalso(i, i % 3 === 0 ? { origem: "metodo", trabalho_id: "tr1", task_ref: `T-01.${i}` } : {});
  return {
    item, resumo: itemResumo(i),
    estimativas: [{ id: "e1", item_id: item.id, versao: 1, pontos: 5, rotulo: null, escala_id: "fibonacci", min_h: null, max_h: null, origem: "ia", motor: "heuristica", confianca: 0.5, fatores: [{ fator: "tipo_task", direcao: "sobe", evidencia: "integração externa" }], estado: "sugerida", ativa: true, nota: null, criado_em: "2026-03-01T00:00:00.000Z" }],
    classificacoes: [{ id: "c1", item_id: item.id, versao: 1, categoria: "feature", risco: "medio", criticidade: "media", tipo_task: null, risco_fatores: [{ fator: "sem_cobertura", peso: 2, direcao: "sobe", evidencia: "sem testes" }], origem: "ia", motor: "heuristica", confianca: 0.5, estado: "sugerida", ativa: true, criado_em: "2026-03-01T00:00:00.000Z" }],
    dod: [{ criterio: "QA aprovado", estado: "falha", fonte: "auto", motivo: "sem veredito" }],
    fato: null, retrabalho: { situacao: null, eventos: [] }, erro_estimativa: null, vinculos_sugeridos: [], sprint_id: null, ...extra,
  };
}

export const SPRINT_ATIVA: SprintComResumoAgil = {
  id: "s1", workspace_id: WS, nome: "Sprint 1", meta: null, inicio: "2026-03-02", fim: "2026-03-13", estado: "ativa", capacidade_pontos: null, compromisso_pontos: 20, iniciada_em: "2026-03-02T09:00:00.000Z", fechada_em: null,
  versao_lancamento: null, resumo_fechamento: null, criado_em: "x", atualizado_em: "x", itens: [{ sprint_id: "s1", item_id: "it1", adicionado_em: "x", removido_em: null, pontos_compromisso: 3, no_compromisso_inicial: true, motivo: null, resultado: null }],
};
export const MEMBROS: MembroAgil[] = [
  { id: "m1", workspace_id: WS, tipo: "humano", rotulo: "Ana", squad_id: "sq1", horas_dia: 6, fator_foco: 0.6, pontos_sprint_fixo: null, ativo: true, aliases: [] },
  { id: "m2", workspace_id: WS, tipo: "agente", rotulo: "Agente 1", squad_id: "sq1", horas_dia: null, fator_foco: 0.6, pontos_sprint_fixo: null, ativo: true, aliases: [{ tipo: "agente", valor: "impl-1" }] },
];
export const CONFIG_FALSA = { escala_id: "fibonacci", escalas: [{ id: "fibonacci", nome: "Fibonacci", valores: [{ rotulo: "1", valor: 1 }, { rotulo: "2", valor: 2 }, { rotulo: "3", valor: 3 }] }], categorias: ["feature", "bug"], pontos_base_tipo: {}, risco_pesos: { raio_alto: 3 },
  risco_faixas: { medio: 3, alto: 6, critico: 9 }, termos_sensiveis: [], categorias_criticas: [], dod: [{ codigo: "qa", descricao: "QA aprovado", auto: true }], dor: [], wip: {}, estimativa_modo: "ia_sugere", estimativa_max_chamadas_dia: 40, estimativa_lote: 20,
  perfil_estimador: "rapido", confianca_aceite_lote: 0.7, janela_retrabalho_dias: 14, dias_uteis: [1, 2, 3, 4, 5], feriados: [], limiares_saude: { progresso_amarelo: 0.2, progresso_vermelho: 0.35, escopo_adicionado: 0.2, ftr_queda_pontos: 10, compromisso_vs_capacidade: 1, risco_critico_max: 2 },
  padroes_teste: [], natureza: { prefixos_defeito: [], prefixos_escopo: [], prefixos_ruido: [], palavras_defeito: [], palavras_escopo: [], palavras_ruido: [] }, buffer_planejamento: 0.2, horas_dia_padrao: 6, fator_foco_padrao: 0.6, commit_grande_linhas: 400, fechar_automatico: false, amostra_minima: 5 } as ConfigAgil;

export interface OpcoesApi { total?: number; estado?: Partial<EstadoAgilApp>; painel?: PainelAgil; sprints?: SprintComResumoAgil[] }

/** API falsa completa: cada método é um `vi.fn` aplicado pelo teste (`espiar`). */
export function apiFalsa(o: OpcoesApi = {}): ApiAgil {
  const total = o.total ?? 3;
  const itens = Array.from({ length: total }, (_, i) => itemResumo(i + 1));
  const pagina = (cursor: string | null, limite: number): PaginaBacklogAgil => {
    const ini = cursor === null ? 0 : Number(cursor);
    const fim = Math.min(total, ini + limite);
    return { itens: itens.slice(ini, fim), proximo: fim < total ? String(fim) : null, total, contagens: { backlog: total } };
  };
  const cap: CapacidadeSprintAgil = { sprint_id: "s1", linhas: [{ membro_id: "m1", rotulo: "Ana", tipo: "humano", dias_uteis: 8, ausencias_dias: 0, pontos: 10, base: "horas", aviso: null }], total: 10, sem_base: [] };
  const daily: DailyAgil = { cerimonia_id: "c1", data: "2026-03-12", desde: "2026-03-11", gerada_em: "2026-03-12T10:00:00.000Z", sem_atividade: false, texto_curto: "Ana: ontem T-01; hoje T-02", markdown: "# Daily",
    membros: [{ membro_id: "m1", rotulo: "Ana", ontem: [{ ref: "T-01", texto: "Concluiu T-01", observacao: null }], hoje: [{ ref: "T-02", texto: "Segue T-02", observacao: null }], bloqueios: [], atrasos: [], riscos: [] }] };
  const retro: RetroAgil = { cerimonia: { id: "r1", sprint_id: "s1", formato: "comecar_parar_continuar", data: "2026-03-13", insights: null }, itens: [{ id: "ri1", coluna: "parar", texto: "Reuniões longas", votos: 1, dado: null, autor_membro_id: null }], acoes: [], colunas: ["comecar", "parar", "continuar"] };
  const r = async <T,>(v: T): Promise<T> => v;
  return {
    estado: () => r({ ...ESTADO_PADRAO, ...(o.estado ?? {}) }), configLer: () => r(CONFIG_FALSA), configGravar: (_w, c) => r({ ...CONFIG_FALSA, ...c } as ConfigAgil), consentimentoIa: (_w, c) => r({ consentimento: c }),
    sincronizar: () => r({ iniciado: true }), membroListar: () => r(MEMBROS), membroGravar: (_w, m) => r({ ...MEMBROS[0] as MembroAgil, ...m, id: "m9", aliases: m.aliases ?? [], ativo: true, fator_foco: 0.6, squad_id: null, horas_dia: m.horas_dia ?? null, pontos_sprint_fixo: null }),
    backlogListar: (p) => r(pagina(p.cursor ?? null, p.limite ?? 100)), itemLer: (_w, id) => r(detalheFalso(Number(id.slice(2)))), itemCriar: (_w, i) => r(itemAgilFalso(99, { titulo: i.titulo })),
    itemAtualizar: (_w, id, c) => r(itemAgilFalso(Number(id.slice(2)), c as Partial<ItemAgil>)), itemDescartar: (_w, id) => r(itemAgilFalso(Number(id.slice(2)), { estado_ade: "descartado" })), itemReordenar: () => r({ ordem: 1.5 }),
    itemPromover: (_w, _i, d) => r({ comando: `/expx:${d} exemplo` }), itemVincular: (_w, id) => r(itemAgilFalso(Number(id.slice(2)))), epicoListar: () => r([]), epicoGravar: () => r({ id: "ep1", workspace_id: WS, titulo: "E", descricao: null, estado: "aberto", ordem: 1, criado_em: "x", atualizado_em: "x" }),
    epicoApagar: () => r({ ok: true as const }), estimar: () => r({ heuristicas_aplicadas: 2, preservados_humano: 0, job_id: null, ia: { consentimento: false, motivo_sem_ia: "sem_consentimento" } }),
    estimativaGravar: (_w, p) => r({ estimativa: { ...(detalheFalso(1).estimativas[0] as never as { id: string }), ...p } as never, ajustado_a_escala: false }), classificacaoGravar: () => r(detalheFalso(1).classificacoes[0] as never),
    estimativaAceitarLote: () => r({ aceitas: 1, restantes: 0, restantes_ids: [] }), sprintListar: () => r(o.sprints ?? [SPRINT_ATIVA]), sprintCriar: () => r({ ...SPRINT_ATIVA, id: "s2", estado: "planejada" }), sprintAtualizar: () => r(SPRINT_ATIVA),
    sprintIniciar: () => r(SPRINT_ATIVA), sprintCancelar: () => r(SPRINT_ATIVA), sprintItemMover: () => r(SPRINT_ATIVA.itens[0] as never),
    sprintFechar: () => r({ ja_fechada: false, resumo: { compromisso_inicial: 20, concluido_pontos: 14, concluidos: 4, carregados: 1, devolvidos: 0, descartados: 0, sem_estimativa: 0, first_time_right: 0.8, destino_pendentes: "backlog" } }),
    capacidadeLer: () => r(cap), capacidadeGravar: () => r(cap), planejamentoSugerir: () => r({ itens: ["it1"], pontos: 3, capacidade: 10, limite: 8, avisos: [{ tipo: "sem_estimativa", itens: ["it3"] }], itens_detalhe: [{ item_id: "it1", titulo: "Item 1", pontos: 3 }] }),
    dailyGerar: () => r(daily), dailySalvar: () => r({ ok: true as const }), reviewLer: () => r([{ item_id: "it1", titulo: "Item 1", pontos: 3, criterios: [], commits: 2, dod: [{ criterio: "QA", estado: "ok", fonte: "auto", motivo: "aprovado" }], demo: null }]),
    reviewGravar: () => r({ devolvido_item_id: null }), retroLer: () => r(retro), retroItemGravar: () => r(retro), retroAcaoGravar: () => r(retro), retroAcaoParaItem: () => r(itemAgilFalso(98)),
    retrabalhoListar: () => r({ eventos: [], situacoes: [] }), retrabalhoMarcar: () => r({ id: "ev1" } as never), painel: () => r(o.painel ?? painelFalso()), previsao: () => r({ job_id: null, previsao: { estado: "dados_insuficientes" as const } }),
    praticas: () => r({ sprint_id: "s1", xp: [{ codigo: "tdd_primeiro", valor: 0.8, estado: "ok", amostra: 10, detalhe: "8 de 10 tasks" }], lean: { espera_ms: 3_600_000, retrabalho_ir: 0.2, trabalho_parcial: 2, troca_de_contexto: { media: 1.5, por_membro: [] }, descartes_apos_inicio: 0, defeitos_escapados: 1 },
      checklists: [{ codigo: "pareamento", grupo: "xp", descricao: "Pareamento nas tasks críticas", estado: "indeterminado", fonte: "manual", valor: null, nota: null }] }),
    checklistGravar: () => r({ ok: true as const }), exportar: () => r({ caminho_ref: "backlog-2026.csv" }), assinar: () => () => undefined,
  };
}
