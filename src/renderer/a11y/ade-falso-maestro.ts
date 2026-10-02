// `window.ade.maestro/pipelines/rigidez` falsos e populados (só teste): reaproveitados pelas varreduras e pelos testes da Fase 16.
import type { ApiAde } from "../../compartilhado/ipc";
import type {
  CatalogoPipelines, ConfigMaestroDto, DetalhePipeline, EstadoHooksDto, EstadoRigidez, EtapaConfig, EtapaConfigEfetiva, EtapaDoPlano, MatrizRigidezDto, PerfilProntoDto, PipelineResumo, PlanoMaestro, ReciboMaestro,
} from "../../compartilhado/maestro";

const perfil = (cli = "claude", faixa: EtapaConfig["perfil"]["faixa"] = "alto"): EtapaConfig["perfil"] => ({ cli, modelo: null, esforco: "alto", faixa, origem_modelo: "cli", agente_id: null });
export const config = (etapa_id: string, extra: Partial<EtapaConfig> = {}): EtapaConfig => ({ etapa_id, perfil: perfil(), skills: [etapa_id.replace(".", "-")], modo_execucao: "novo_terminal", atualizado_por: "fabrica", ...extra });

export const CATALOGO: CatalogoPipelines = {
  etapas: [
    { id: "runx.e1", skill: "runx", nome: "Causa raiz", comando: "runx-causa", tipo: "investigador", interativa: false, humano: false, piso: false },
    { id: "runx.e3", skill: "runx", nome: "Correção", comando: "runx-fix", tipo: "implementador", interativa: false, humano: false, piso: false },
    { id: "runx.e4", skill: "runx", nome: "QA", comando: "runx-qa", tipo: "avaliador", interativa: false, humano: false, piso: false },
    { id: "prodx.p0", skill: "prodx", nome: "Triagem", comando: "prodx-triar", tipo: "utilitario", interativa: false, humano: false, piso: true },
    { id: "prodx.assinatura", skill: "prodx", nome: "Assinatura do veredito", comando: null, tipo: "humano", interativa: false, humano: true, piso: false },
    { id: "mergex.revisar", skill: "mergex", nome: "Revisar e mergear", comando: null, tipo: "humano", interativa: false, humano: true, piso: false },
  ],
  pipelines: [
    { id: "runx", nome: "Bug (runx)", passos: [{ etapa: "runx.e1", piso: false, laco: null }, { etapa: "runx.e3", piso: false, laco: null }, { etapa: "runx.e4", piso: false, laco: "runx.e3" }] },
    { id: "prodx", nome: "Pedido cru (prodx)", passos: [{ etapa: "prodx.p0", piso: true, laco: null }, { etapa: "prodx.assinatura", piso: false, laco: null }] },
  ],
  niveis: [
    { nivel: 1, nome: "Relâmpago", semantica: "Um terminal, sem fases.", ligado: "um terminal e piso", desligado: "fases do método", quando: "mudança pontual" },
    { nivel: 2, nome: "Leve", semantica: "Essenciais condensadas.", ligado: "QA enxuto", desligado: "atenção humana", quando: "baixo risco" },
    { nivel: 3, nome: "Padrão", semantica: "O método como desenhado.", ligado: "todas as etapas", desligado: "triagem do prodx", quando: "uso normal" },
    { nivel: 4, nome: "Rigoroso", semantica: "Mais revisão.", ligado: "hooks em bloqueio", desligado: "triagem", quando: "importante" },
    { nivel: 5, nome: "Total", semantica: "Tudo.", ligado: "dupla avaliação", desligado: "nada", quando: "crítico" },
  ],
};
export const CONFIGS: EtapaConfigEfetiva[] = CATALOGO.etapas.filter((e) => !e.humano).map((e) => ({ config: config(e.id, e.tipo === "avaliador" ? { perfil: perfil("auto", "topo") } : {}), origem: "fabrica" as const }));
export const PRONTOS: PerfilProntoDto[] = [
  { id: "economico", nome: "Econômico", descricao: "Uma faixa abaixo do padrão." },
  { id: "equilibrado", nome: "Equilibrado", descricao: "Padrões de fábrica." },
  { id: "maxima-qualidade", nome: "Máxima qualidade", descricao: "Uma faixa acima do padrão." },
];

export const etapaDoPlano = (etapa_id: EtapaDoPlano["etapa_id"], extra: Partial<EtapaDoPlano> = {}): EtapaDoPlano => ({
  etapa_id, ordem: 1, estado_inicial: "pendente", tipo: "implementador", comando: `/expx:${etapa_id.replace(".", "-")} x`, perfil: null, resumo_perfil: "claude·padrão·alto", reduz: false, piso: false, reforco: null, agrupa_com_anterior: false, motivo: null, ...extra,
});
export const PLANO: PlanoMaestro = {
  id: "mpl_1", intencao: "bug", pipeline_id: "runx", confianca: 0.86, fonte: "regra", nivel: 3, nivel_origem: "padrao",
  etapas: [
    etapaDoPlano("runx.e1", { ordem: 1, tipo: "investigador" }),
    etapaDoPlano("runx.e3", { ordem: 2 }),
    etapaDoPlano("runx.e4", { ordem: 3, tipo: "avaliador", resumo_perfil: "opencode·padrão·alto" }),
    etapaDoPlano("prodx.p0", { ordem: 4, tipo: "utilitario", piso: true }),
    etapaDoPlano("mergex.revisar", { ordem: 5, tipo: "humano", estado_inicial: "humano", comando: null, resumo_perfil: null }),
  ],
  alvo: { trabalho_id: null, retomada: false, estagio_atual: null }, avisos: ["Rigidez abaixo de Padrão em branch protegida pede confirmação."], trava: null, hooks_a_aplicar: [], executar_direto: false, expira_em: "2026-10-01T12:30:00.000Z",
};
export const RECIBO: ReciboMaestro = { id: "mrc_1", pipeline_id: "mpl_1", intencao: "bug", confianca: 0.86, fonte: "regra", decididor: { tipo: "regra", modelo: null, endpoint_host: null, latencia_ms: null, custo_usd: null }, escolha_regra: "bug", escolha_decisor: null, divergiu: false, nivel: 3, texto: "Maestro: bug (confiança 0,86) por regra [corrig, problema em]; decisor desligado. Nível Padrão." };
export const RESUMO: PipelineResumo = { id: "mpl_1", pipeline_id: "runx", estado: "executando", etapa_atual: "runx.e3", etapas: [{ etapa_id: "runx.e1", estado: "concluida", pane_id: "pane_aaaaaa" }, { etapa_id: "runx.e3", estado: "executando", pane_id: "pane_bbbbbb" }], nivel_atual: 3, mission_id: "m1", trabalho_id: "OC-2026-0001" };

export const execEtapa = (etapa_id: string, extra: Record<string, unknown> = {}) => ({
  etapa_id, ordem: 1, tentativa: 1, rodada: 1, estado: "pendente", pane_id: null, perfil: null, nivel: 3, comando: null, reutilizou_pane: false, detectada_por: null, inicio_em: null, fim_em: null, detalhe: null,
  tipo: "implementador", piso: false, reduz: false, reforco: null, agrupa_com_anterior: false, avaliacoes: 1, confirmada: false, ...extra,
}) as DetalhePipeline["execs"][number];
export const DETALHE: DetalhePipeline = {
  id: "mpl_1", workspace_id: "w1", mission_id: "m1", trabalho_id: "OC-2026-0001", pipeline_id: "runx", intencao: "bug", estado: "executando", via: "paleta", texto_resumo: "corrige o erro ao salvar o pedido", nivel_atual: 3, nivel_base: 3, override_trava: false,
  plano: PLANO, execs: [execEtapa("runx.e1", { estado: "concluida", pane_id: "pane_aaaaaa", ordem: 1 }), execEtapa("runx.e3", { estado: "executando", pane_id: "pane_bbbbbb", ordem: 2 }), execEtapa("runx.e4", { ordem: 3, tipo: "avaliador" })],
  recibo: RECIBO, piso: [{ id: "I1", titulo: "comportamento alterado tem teste", estado: "ok", detalhe: "" }, { id: "I2", titulo: "suíte verde", estado: "nao_comprovado", detalhe: "sem execução ainda" }, { id: "I3", titulo: "sem segredo no diff", estado: "violado", detalhe: "um arquivo" }],
  motivo_fim: null, criado_em: "2026-10-01T12:00:00.000Z", atualizado_em: "2026-10-01T12:05:00.000Z", concluido_em: null, arquivo_humano: null,
};
export const DETALHE_HUMANO: DetalhePipeline = { ...DETALHE, id: "mpl_2", pipeline_id: "prodx", estado: "aguardando_humano", execs: [execEtapa("prodx.assinatura", { estado: "aguardando_humano", tipo: "humano", ordem: 1 })], arquivo_humano: "docs/pedidos/PD-2026-0001/VEREDITO.md" };

export const ESTADO_RIGIDEZ: EstadoRigidez = { efetivo: 3, origem: "padrao", workspace: null, missao: null, minimo_travado: 1, motivo_trava: null, lembrete: null };
const cela = (modo: "roda" | "omitida" | "humano" | "reduzida" | "reforco") => ({ modo, agrupa: false, avaliacoes: null, confirma: false, nota: null });
export const MATRIZ: MatrizRigidezDto = {
  niveis: CATALOGO.niveis,
  parametros: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [String(n), { pipeline_bug_feature: ["rapido", "condensado", "metodo", "reforcado", "total"][n - 1], max_terminais: [1, 2, 4, 4, 6][n - 1], agrupa_etapas: n === 2, subagentes_de_veredito: [] }])),
  celulas: [
    { etapa_id: "runx.e1", por_nivel: { 1: cela("omitida"), 2: cela("reduzida"), 3: cela("roda"), 4: cela("reforco"), 5: cela("reforco") } },
    { etapa_id: "mergex.revisar", por_nivel: { 1: cela("humano"), 2: cela("humano"), 3: cela("humano"), 4: cela("humano"), 5: cela("humano") } },
  ],
  hooks_por_nivel: { 1: { "task-so-fecha-verde": "aviso" }, 2: { "task-so-fecha-verde": "aviso" }, 3: {}, 4: { "task-so-fecha-verde": "bloqueio" }, 5: { "task-so-fecha-verde": "bloqueio" } },
};
export const HOOKS: EstadoHooksDto = { arquivo: ".expx/hooks.json", presente: true, invalido: false, gerenciadas: ["task-so-fecha-verde"], nivel_aplicado: 4, metodo_instalado: true };
export const CONFIG_MAESTRO: ConfigMaestroDto = { confirmar_plano: true, hook_modo: "encaminhar", hook_confianca_min: 0.75, producao: false, branches_protegidas: ["main"], escrever_hooks: true, hooks_aplicar_ja: false, max_terminais: 4, fechar_concluidos: true, timeout_sem_progresso_min: 30, proposta_expira_min: 30 };

type Sobrescrita = { maestro?: Partial<ApiAde["maestro"]>; pipelines?: Partial<ApiAde["pipelines"]>; rigidez?: Partial<ApiAde["rigidez"]> };
export function maestroFalso(o: Sobrescrita = {}): { maestro: ApiAde["maestro"]; pipelines: ApiAde["pipelines"]; rigidez: ApiAde["rigidez"] } {
  return {
    maestro: {
      pedir: async () => ({ plano: PLANO, recibo: RECIBO }),
      confirmar: async () => RESUMO,
      cancelar: async () => ({ ok: true }),
      listarPipelines: async () => [RESUMO],
      detalhe: async () => DETALHE,
      acao: async () => RESUMO,
      listarRecibos: async () => [RECIBO],
      lerConfig: async () => CONFIG_MAESTRO,
      gravarConfig: async (p) => p.config,
      assinar: () => () => undefined,
      ...o.maestro,
    },
    pipelines: {
      catalogo: async () => CATALOGO,
      listarConfig: async () => CONFIGS,
      gravarConfig: async (p) => ({ config: { config: p.config, origem: "global" as const }, achados: [] }),
      restaurarConfig: async () => CONFIGS,
      validar: async () => [],
      perfisProntos: async () => PRONTOS,
      aplicarPronto: async () => CONFIGS,
      exportar: async () => ({ cancelado: false, caminho_relativo: "pasta-do-produto/pipelines/pipelines.json" }),
      importarPrevia: async () => ({ previa_id: "previa_123", configs: CONFIGS.map((c) => c.config), achados: [], erros: [], cancelado: false }),
      importarConfirmar: async () => CONFIGS,
      ...o.pipelines,
    },
    rigidez: {
      ler: async () => ESTADO_RIGIDEZ,
      definir: async (p) => ({ efetivo: p.nivel, hooks: { escrito: false, agendado: false, arquivo: null, aviso: null }, estado: { ...ESTADO_RIGIDEZ, efetivo: p.nivel } }),
      matriz: async () => MATRIZ,
      previaPlano: async () => PLANO.etapas,
      hooksEstado: async () => HOOKS,
      hooksReverter: async () => ({ revertidas: ["task-so-fecha-verde"] }),
      assinar: () => () => undefined,
      ...o.rigidez,
    },
  };
}
