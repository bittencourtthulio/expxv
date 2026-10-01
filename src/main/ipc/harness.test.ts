import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { VALIDADORES_HARNESS } from "./harness";

const WS = "ws_01HZZZZZZZZZ";
const C = "conta_01HZZZZZZZZZ";
const v = <K extends keyof typeof VALIDADORES_HARNESS>(canal: K, x: unknown) => VALIDADORES_HARNESS[canal](x);

const exec = { provider: "claude", cli: null, model: null, effort: null, faixa: "alto" };
const politica = {
  workspace_id: null, task_type: "bug-fix", executor: exec, alternativas: [], fallback: [exec], skills: [], agente: null,
  conta_fixa_id: null, evitar_reservadas: true, habilitada: true,
};
const config = {
  workspace_id: WS, nivel: 4, modo_troca: null, limiar_troca_pct: 85, limiar_esgotamento_pct: 100, margem_troca_pontos: 10,
  troca_entre_provedores: true, faixa_minima_troca: "mesma", max_saltos: 3, espera_ponto_seguro_s: 600, piloto_edita_politica: false, injetar_cofre_no_env: false,
};
const decisor = {
  habilitado: false, modo: "jev_direto", formato: "probs_json", endpoint: "https://jev.exemplo.com/decide", cabecalho_chave: "Authorization",
  prefixo_chave: "Bearer ", modelo: null, conta_openrouter_id: null, chave_ref: "JEV_KEY",
  usar_para: { task_type: true, modelo_esforco: false, intencao: false }, confianca_minima: 0.5, timeout_ms: 2000,
  custo_por_decisao_usd: null, alerta_diario: 1000, consentimento: null,
};

describe("validadores harness:*", () => {
  it("cobrem exatamente os canais harness: do contrato", () => {
    expect(Object.keys(VALIDADORES_HARNESS).sort()).toEqual(CANAIS_INVOKE.filter((c) => c.startsWith("harness:")).sort());
  });

  it("config_gravar: limiar_troca ≥ limiar_esgotamento é recusado; faixas, modos e saltos validados", () => {
    expect(v("harness:config_gravar", config).ok).toBe(true);
    expect(v("harness:config_gravar", { ...config, modo_troca: "automatico", faixa_minima_troca: "descer_1", max_saltos: 6 }).ok).toBe(true);
    expect(v("harness:config_gravar", { ...config, limiar_troca_pct: 95, limiar_esgotamento_pct: 95 }).ok).toBe(false);
    expect(v("harness:config_gravar", { ...config, limiar_troca_pct: 99, limiar_esgotamento_pct: 98 }).ok).toBe(false);
    expect(v("harness:config_gravar", { ...config, limiar_troca_pct: 49 }).ok).toBe(false);
    expect(v("harness:config_gravar", { ...config, nivel: 5 }).ok).toBe(false);
    expect(v("harness:config_gravar", { ...config, modo_troca: "sempre" }).ok).toBe(false);
    expect(v("harness:config_gravar", { ...config, faixa_minima_troca: "uma_abaixo" }).ok).toBe(false);
    expect(v("harness:config_gravar", { ...config, max_saltos: 0 }).ok).toBe(false);
    expect(v("harness:config_gravar", { ...config, espera_ponto_seguro_s: 10 }).ok).toBe(false);
    expect(v("harness:config_gravar", { ...config, extra: true }).ok).toBe(false);
    expect(v("harness:config_ler", { workspace_id: "/home/x" }).ok).toBe(false);
  });

  it("politica_gravar: fallback nunca vazio, faixa conhecida, campo extra, caminho/URL em modelo", () => {
    expect(v("harness:politica_gravar", politica).ok).toBe(true);
    expect(v("harness:politica_gravar", { ...politica, fallback: [] }).ok).toBe(false);
    expect(v("harness:politica_gravar", { ...politica, executor: { ...exec, faixa: "ultra" } }).ok).toBe(false);
    expect(v("harness:politica_gravar", { ...politica, executor: { ...exec, faixa: null, model: "vendor/modelo:free" } }).ok).toBe(true);
    for (const model of ["/etc/passwd", "https://x.com/m", "a/../b", "a//b", "../x"]) {
      expect(v("harness:politica_gravar", { ...politica, executor: { ...exec, model } }).ok, model).toBe(false);
    }
    expect(v("harness:politica_gravar", { ...politica, executor: { ...exec, extra: 1 } }).ok).toBe(false);
    expect(v("harness:politica_gravar", { ...politica, task_type: "Bug Fix" }).ok).toBe(false);
    expect(v("harness:politica_gravar", { ...politica, workspace_id: "/x" }).ok).toBe(false);
    expect(v("harness:politica_gravar", { ...politica, atualizado_por: "mcp" }).ok).toBe(false);
    expect(v("harness:politica_gravar", { ...politica, conta_fixa_id: C }).ok).toBe(true);
  });

  it("task types, política listar/restaurar", () => {
    expect(v("harness:task_types_gravar", { slug: "meu-tipo", categoria: "docs", rotulo: "Meu tipo", descricao: null }).ok).toBe(true);
    expect(v("harness:task_types_gravar", { slug: "meu-tipo", categoria: "docs", rotulo: "http://x", descricao: null }).ok).toBe(false);
    expect(v("harness:task_types_gravar", { slug: "Meu_Tipo", categoria: "docs", rotulo: "x", descricao: null }).ok).toBe(false);
    expect(v("harness:task_types_apagar", { slug: "../x" }).ok).toBe(false);
    expect(v("harness:politica_listar", { workspace_id: null }).ok).toBe(true);
    expect(v("harness:politica_restaurar_semente", { workspace_id: WS, task_type: "auditar" }).ok).toBe(true);
    expect(v("harness:politica_restaurar_semente", { workspace_id: WS }).ok).toBe(true);
  });

  it("equivalencia_gravar: só faixas conhecidas e provedores bem formados", () => {
    const ok = { provedores: { claude: { topo: [{ modelo: "opus", esforco: null }], rapido: [] } } };
    expect(v("harness:equivalencia_gravar", ok).ok).toBe(true);
    expect(v("harness:equivalencia_gravar", { provedores: { claude: { ultra: [] } } }).ok).toBe(false);
    expect(v("harness:equivalencia_gravar", { provedores: { "Claude!": {} } }).ok).toBe(false);
    expect(v("harness:equivalencia_gravar", { provedores: { claude: { topo: [{ modelo: "/x", esforco: null }] } } }).ok).toBe(false);
    expect(v("harness:equivalencia_gravar", { provedores: {}, extra: 1 }).ok).toBe(false);
  });

  it("decisor_gravar: endpoint https, consentimento casa com host/modo e é obrigatório ao ligar", () => {
    expect(v("harness:decisor_gravar", decisor).ok).toBe(true);
    expect(v("harness:decisor_gravar", { ...decisor, endpoint: "http://jev.exemplo.com/decide" }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...decisor, endpoint: null }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...decisor, habilitado: true }).ok).toBe(false);
    const consent = { host: "jev.exemplo.com", modo: "jev_direto" };
    expect(v("harness:decisor_gravar", { ...decisor, habilitado: true, consentimento: consent }).ok).toBe(true);
    expect(v("harness:decisor_gravar", { ...decisor, habilitado: true, consentimento: { ...consent, host: "outro.com" } }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...decisor, habilitado: true, consentimento: { ...consent, modo: "openai_compat" } }).ok).toBe(false);
    const viaOr = { ...decisor, modo: "jev_openrouter", formato: "openai_chat", endpoint: null, modelo: "vendor/jev", conta_openrouter_id: C, chave_ref: null };
    expect(v("harness:decisor_gravar", { ...viaOr, habilitado: true, consentimento: { host: "openrouter.ai", modo: "jev_openrouter" } }).ok).toBe(true);
    expect(v("harness:decisor_gravar", { ...viaOr, habilitado: true, consentimento: { host: "jev.exemplo.com", modo: "jev_openrouter" } }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...viaOr, endpoint: "https://x.com" }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...viaOr, conta_openrouter_id: null }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...decisor, confianca_minima: 1.5 }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...decisor, timeout_ms: 50 }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...decisor, chave: "sk-x" }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...decisor, chave_ref: "minuscula" }).ok).toBe(false);
    expect(v("harness:decisor_gravar", { ...decisor, custo_por_decisao_usd: -1 }).ok).toBe(false);
  });

  it("decisor_testar: chave opcional e opaca", () => {
    expect(v("harness:decisor_testar", {}).ok).toBe(true);
    expect(v("harness:decisor_testar", { chave: "abcdefgh12345" }).ok).toBe(true);
    expect(v("harness:decisor_testar", { chave: "com espaco aqui" }).ok).toBe(false);
    expect(v("harness:decisor_testar", { chave: "abcdefgh12345", endpoint: "https://x.com" }).ok).toBe(false);
  });

  it("listagens: limite ≤ 200, proposito conhecido, instante ISO", () => {
    expect(v("harness:decisoes_listar", {}).ok).toBe(true);
    expect(v("harness:decisoes_listar", { limite: 200, proposito: "troca", desde: "2026-01-01T00:00:00.000Z", cursor: "dec_01HZZ" }).ok).toBe(true);
    expect(v("harness:decisoes_listar", { limite: 201 }).ok).toBe(false);
    expect(v("harness:decisoes_listar", { proposito: "outro" }).ok).toBe(false);
    expect(v("harness:decisoes_listar", { desde: "ontem" }).ok).toBe(false);
    expect(v("harness:trocas_listar", { limite: 0 }).ok).toBe(false);
    expect(v("harness:troca_decidir", { troca_id: "trc_01HZZZZZZZZZ", acao: "adiar_30min" }).ok).toBe(true);
    expect(v("harness:troca_decidir", { troca_id: "trc_01HZZZZZZZZZ", acao: "forcar" }).ok).toBe(false);
    expect(v("harness:mover_pane", { pane_id: "pane_01HZZZZZZZZZ" }).ok).toBe(true);
    expect(v("harness:mover_pane", { pane_id: "pane_01HZZZZZZZZZ", conta_alvo_id: C }).ok).toBe(true);
    expect(v("harness:mover_pane", { pane_id: "pane_01HZZZZZZZZZ", cwd: "/tmp" }).ok).toBe(false);
  });

  it("contas_config_gravar: papéis do domínio, tetos inteiros", () => {
    const base = { conta_id: C, reservada_modelos: ["opus"], reservada_papeis: ["revisor"], workspaces_fixados: [WS] };
    expect(v("harness:contas_config_gravar", base).ok).toBe(true);
    expect(v("harness:contas_config_gravar", { ...base, teto_tokens_5h: 1000, teto_tokens_semana: null }).ok).toBe(true);
    expect(v("harness:contas_config_gravar", { ...base, reservada_papeis: ["rei"] }).ok).toBe(false);
    expect(v("harness:contas_config_gravar", { ...base, teto_tokens_5h: 1.5 }).ok).toBe(false);
    expect(v("harness:contas_config_gravar", { ...base, workspaces_fixados: ["/x"] }).ok).toBe(false);
  });

  it("recomendar/intenção/perfil: texto limitado, contexto estrito, perfil XOR skill+etapa", () => {
    expect(v("harness:recomendar", { workspace_id: WS, descricao: "arrumar o botão da home" }).ok).toBe(true);
    expect(v("harness:recomendar", { workspace_id: WS, descricao: "x".repeat(2001) }).ok).toBe(false);
    expect(v("harness:recomendar", { workspace_id: WS, descricao: "" }).ok).toBe(false);
    expect(v("harness:classificar_intencao", { texto: "quero uma feature", contexto: { workspace_id: WS } }).ok).toBe(true);
    expect(v("harness:classificar_intencao", { texto: "oi", contexto: { workspace_id: WS, opcoes: [{ id: "a", descricao: "A" }] } }).ok).toBe(false); // < 2 opções
    expect(v("harness:classificar_intencao", { texto: "oi", contexto: { workspace_id: WS, opcoes: [{ id: "a", descricao: "A" }, { id: "b", descricao: "B", palavras: ["x"] }], trabalho_ativo: { tipo: "feature", estagio: "f2" } } }).ok).toBe(true);
    expect(v("harness:classificar_intencao", { texto: "oi", contexto: { workspace_id: WS, extra: 1 } }).ok).toBe(false);
    const ctx = { workspace_id: WS, papel: "revisor", mission_id: null };
    expect(v("harness:resolver_perfil", { skill: "sprintx-auditoria", etapa: "F5", ctx }).ok).toBe(true);
    expect(v("harness:resolver_perfil", { perfil: { agente_id: null, provider: "claude", cli: null, modelo: null, esforco: null, faixa: "topo" }, ctx }).ok).toBe(true);
    expect(v("harness:resolver_perfil", { perfil: { agente_id: null, provider: "claude", cli: null, modelo: null, esforco: null, faixa: "mega" }, ctx }).ok).toBe(false);
    expect(v("harness:resolver_perfil", { skill: "a", etapa: "b", perfil: {}, ctx }).ok).toBe(false);
    expect(v("harness:resolver_perfil", { skill: "a", etapa: "b", ctx: { ...ctx, cwd: "/x" } }).ok).toBe(false);
  });
});
