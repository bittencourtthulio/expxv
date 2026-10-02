// Dados e APIs falsas de limites/harness/cofre (só teste): reaproveitados pelas varreduras e pelos testes das telas da Fase 9.
import type { ContaOpenRouterEstado, EstadoOpenRouter, ModeloOpenRouter, ConfigDecisor, ConfigHarness, Decisao, EstadoCofre, EstadoEquivalencia, EntradaCofre, Politica, TaskType, Troca } from "../../compartilhado/harness";
import type { AccountUsage, CotaGeral, RespostaLimites } from "../../compartilhado/limites";

export const uso = (id: string, provider: string, extra: Partial<AccountUsage> = {}): AccountUsage => ({
  account_id: id, provider, fetched_at: "2026-10-01T10:00:00Z", fonte: "claude_statusline", confianca: "medido", status: "ok",
  windows: [{ kind: "five_hour", used_pct: 62, resets_at: "2099-01-01T15:00:00Z" }, { kind: "weekly", used_pct: 31, resets_at: "2099-01-05T00:00:00Z" }],
  model_buckets: { opus: { used_pct: 100, resets_at: null, kind: "weekly" } }, bottleneck: "five_hour", slack_pct: 38, idade_s: 30, vencidas: [], ...extra,
});
export const CONTAS_FALSAS: AccountUsage[] = [
  uso("c1", "claude"),
  uso("c2", "claude", { windows: [{ kind: "five_hour", used_pct: 87, resets_at: "2099-01-01T12:00:00Z" }, { kind: "weekly", used_pct: 40, resets_at: "2099-01-06T00:00:00Z" }], model_buckets: {} }),
  uso("c3", "codex", { fonte: "nenhuma", confianca: "desconhecido", status: "unavailable", windows: [], model_buckets: {} }),
];
export const GERAL_FALSO: CotaGeral = { pior: { conta_id: "c2", rotulo: "trabalho", kind: "five_hour", used_pct: 87 }, folga_media_pct: 45, cobertura: { com_dado: 2, total: 3 }, em_alerta: 1, esgotadas: 0 };
export const RESPOSTA_LIMITES: RespostaLimites = { contas: CONTAS_FALSAS, geral: GERAL_FALSO };

export const tipos: TaskType[] = [
  { slug: "bug-fix", categoria: "codigo", rotulo: "Correção de bug", descricao: null, embutido: true },
  { slug: "auditar", categoria: "revisao", rotulo: "Auditar", descricao: null, embutido: true },
];
const ex = (provider: string, extra: Record<string, unknown> = {}) => ({ provider, cli: provider, model: null, effort: null, faixa: "medio" as const, ...extra });
export const politicas: Politica[] = [
  { id: "p1", workspace_id: null, task_type: "bug-fix", executor: ex("claude", { model: "sonnet" }), alternativas: [], fallback: [ex("codex")], skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: false, habilitada: true, atualizado_por: "semente", atualizado_em: "x" },
  { id: "p2", workspace_id: null, task_type: "auditar", executor: ex("aider", { faixa: "topo" }), alternativas: [], fallback: [ex("codex")], skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: false, habilitada: true, atualizado_por: "semente", atualizado_em: "x" },
];
export const equivalencia: EstadoEquivalencia = {
  padrao: { faixas: ["topo", "alto", "medio", "rapido"], ordem_de_descida: ["topo", "alto", "medio", "rapido"], provedores: { claude: { topo: [{ modelo: "opus", esforco: null }] }, codex: { topo: [{ modelo: "gpt-5", esforco: "high" }] } } },
  efetiva: { faixas: ["topo", "alto", "medio", "rapido"], ordem_de_descida: ["topo", "alto", "medio", "rapido"], provedores: { claude: { topo: [{ modelo: "opus", esforco: null }] }, codex: { topo: [{ modelo: "gpt-5", esforco: "high" }] } } },
  diferencas: {},
};
export const configHarness: ConfigHarness = { workspace_id: "w1", nivel: 4, modo_troca: null, limiar_troca_pct: 85, limiar_esgotamento_pct: 100, margem_troca_pontos: 10, troca_entre_provedores: true, faixa_minima_troca: "mesma", max_saltos: 3, espera_ponto_seguro_s: 600, piloto_edita_politica: false, injetar_cofre_no_env: false, atualizado_em: "x" };
export const decisor: ConfigDecisor = { habilitado: false, modo: "jev_direto", formato: "probs_json", endpoint: null, cabecalho_chave: "Authorization", prefixo_chave: "Bearer ", modelo: null, conta_openrouter_id: null, chave_ref: null, usar_para: { task_type: true, modelo_esforco: true, intencao: false }, confianca_minima: 0.6, timeout_ms: 2000, custo_por_decisao_usd: null, alerta_diario: 100, consentimento: null };
export const decisoes: Decisao[] = [
  { id: "d1", criado_em: "2026-10-01T10:00:00Z", proposito: "selecao_conta", workspace_id: "w1", mission_id: null, pane_id: "pane-1", tipo: "choice", opcoes: [], probs: null, escolhida: "c1", confianca: null, fonte: "regra", escolha_regra: null, divergiu: false, latencia_ms: 1, custo_usd: null, custo_origem: null, decisor: null, resumo_enviado: null, resumo_hash: null, skills_aplicadas: false, recibo: "conta cl·1 reseta antes" },
];
export const trocas: Troca[] = [
  { id: "t1", criado_em: "2026-10-01T10:00:00Z", status: "sugerida", motivo: "consumo_alto", modo: "so_sugerir", tipo_troca: "outra_conta", de: { conta_id: "c2", provedor: "claude", modelo: null }, para: { conta_id: "c1", provedor: "claude", modelo: null }, consumo_origem_pct: 87, consumo_destino_pct: 62, adiada_por: null, recibo: "c2 87% -> c1 62%" },
  { id: "t2", criado_em: "2026-10-01T09:00:00Z", status: "feita", motivo: "limite_atingido", modo: "automatico", tipo_troca: "outro_provedor", de: { conta_id: "c1", provedor: "claude", modelo: "opus" }, para: { conta_id: "c3", provedor: "codex", modelo: "gpt-5" }, consumo_origem_pct: 100, consumo_destino_pct: null, adiada_por: null, recibo: "limite atingido" },
];
export const entradasCofre: EntradaCofre[] = [{ id: "e1", nome: "OPENROUTER_CHAVE", escopo: "global", workspace_id: null, sensivel: true, ultimo_uso_em: null }];

export function limitesFalso() {
  return {
    snapshot: async () => RESPOSTA_LIMITES, atualizar: async () => RESPOSTA_LIMITES,
    definirManual: async () => CONTAS_FALSAS[0]!, limparManual: async () => CONTAS_FALSAS[0]!,
    historico: async () => [{ conta_id: "c1", janela: "five_hour" as const, balde: "", ts: "2026-10-01T08:00:00Z", usado_pct: 20, reinicia_em: null }, { conta_id: "c1", janela: "five_hour" as const, balde: "", ts: "2026-10-01T10:00:00Z", usado_pct: 62, reinicia_em: null }],
    previsao: async () => [{ janela: "five_hour" as const, atual_pct: 62, ritmo_pct_por_hora: 10, zera_em: "2026-10-01T14:00:00Z", antes_do_reset: true, confianca: "media" as const }],
    eficiencia: async () => [{ semana_inicio: "2026-09-21T00:00:00Z", conta_id: "c1", pico_pct: 95, estourou: true, estouro_precoce: true, meta_atingida: false }],
    alertas: async () => [{ tipo: "consumo_alto" as const, conta_id: "c2", texto: "87% da janela de 5 h", desde: "2026-10-01T10:00:00Z" }],
    assinar: () => () => undefined,
  };
}
export function harnessFalso() {
  return {
    lerConfig: async () => configHarness, gravarConfig: async (c: unknown) => ({ ...(c as object), atualizado_em: "y" }) as ConfigHarness,
    listarTaskTypes: async () => tipos, gravarTaskType: async (t: TaskType) => ({ ...t, embutido: false }), apagarTaskType: async () => true,
    listarPoliticas: async () => politicas, gravarPolitica: async () => politicas[0]!, restaurarSemente: async () => politicas,
    lerEquivalencia: async () => equivalencia, gravarEquivalencia: async () => equivalencia, restaurarEquivalencia: async () => equivalencia,
    listarDecisoes: async () => ({ itens: decisoes, proximo: null, totais: { consultas: 1, custo_usd: null, custo_desconhecido: 1 } }),
    listarContasConfig: async () => [], gravarContaConfig: async () => ({}),
    listarTrocas: async () => ({ itens: trocas, proximo: null }), decidirTroca: async () => trocas[0]!, moverPane: async () => ({ novo_pane_id: "n", de: trocas[0]!.de, para: trocas[0]!.para }),
    lerDecisor: async () => decisor, gravarDecisor: async () => decisor, testarDecisor: async () => ({ ok: true, latencia_ms: 12 }),
    assinar: () => () => undefined,
  };
}
export function cofreFalso(estado: Partial<EstadoCofre> = {}) {
  return {
    disponivel: async (): Promise<EstadoCofre> => ({ ok: true, backend: "safe_storage", bloqueado: false, ...estado }),
    listar: async () => entradasCofre, gravar: async () => entradasCofre[0]!, apagar: async () => true,
    definirSenhaMestra: async () => ({ ok: true, backend: "senha_mestra" as const, bloqueado: false }), desbloquear: async () => ({ ok: true, backend: "senha_mestra" as const, bloqueado: false }), bloquear: async () => ({ ok: true, backend: "senha_mestra" as const, bloqueado: true }),
  };
}

export const contaOpenRouter: ContaOpenRouterEstado = { conta_id: "or1", rotulo: "pessoal", ultimos4: "ab12", tipo: "pago", limite_usd: 20, usado_usd: 12.9, saldo_usd: 7.1, saldo_em: "2026-10-01T10:00:00Z" };
export const modelosOpenRouter: ModeloOpenRouter[] = [
  { id: "anthropic/claude-x", nome: "Claude X", contexto: 200000, suporta_tools: true, preco_entrada_por_mtok: 3, preco_saida_por_mtok: 15, habilitado: false, faixa: null, ordem: 0, tipos_permitidos: [] },
  { id: "meta/llama-y", nome: "Llama Y", contexto: 128000, suporta_tools: null, preco_entrada_por_mtok: null, preco_saida_por_mtok: null, habilitado: true, faixa: "rapido", ordem: 1, tipos_permitidos: ["bug-fix"] },
];
export const estadoOpenRouter = (extra: Partial<EstadoOpenRouter> = {}): EstadoOpenRouter => ({
  habilitado: true, consentimento_em: "2026-10-01T09:00:00Z", contas: [contaOpenRouter], modelos: { total: 2, habilitados: 1, atualizados_em: "2026-10-01T09:30:00Z" },
  clis: [{ cli: "opencode", instalada: true, status: "verificado" }, { cli: "codex", instalada: true, status: "a_verificar" }, { cli: "goose", instalada: false, status: "desligado" }], proxy: { ativo: false }, ...extra,
});
/** API falsa do OpenRouter (só teste): estado ativo com uma conta e dois modelos. */
export function openrouterFalso(estado: EstadoOpenRouter = estadoOpenRouter()) {
  return {
    estado: async () => estado, consentir: async () => ({ ...estado, habilitado: true }), revogar: async () => ({ ...estado, habilitado: false }),
    gravarChave: async () => contaOpenRouter, apagarChave: async () => true,
    testar: async () => ({ ok: true, tipo: "pago" as const, limite_usd: 20, saldo_usd: 7.1, latencia_ms: 120 }),
    atualizarModelos: async () => ({ total: 2, novos: 1, removidos: 0 }),
    listarModelos: async () => ({ itens: modelosOpenRouter, proximo: null, total: modelosOpenRouter.length }),
    gravarModelo: async (p: { id: string; habilitado: boolean; faixa: ModeloOpenRouter["faixa"]; tipos_permitidos: string[]; ordem: number }) => ({ ...modelosOpenRouter.find((m) => m.id === p.id)!, ...p }),
    atualizarSaldo: async () => estado,
  };
}
