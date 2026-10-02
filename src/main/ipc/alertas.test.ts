import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { ErroAlertasIpc, type LigacaoAlertas } from "../alertas";
import { VALIDADORES_ALERTAS, registrarIpcAlertas } from "./alertas";
import { criarRegistroIpc, type IpcMainLike } from "./registro";
import { VALIDADORES_TELEGRAM, registrarIpcTelegram } from "./telegram";

const FAMILIAS = /^(alertas|canais|telegram):/;
const doContrato = CANAIS_INVOKE.filter((c) => FAMILIAS.test(c)).sort();
const TODOS = { ...VALIDADORES_ALERTAS, ...VALIDADORES_TELEGRAM } as Record<string, (v: unknown) => { ok: boolean; erro?: string; valor?: unknown }>;

const ID_A = "alt_AbCdEfGhIjKl";
const ID_R = "reg_AbCdEfGhIjKl";
const WS = "ws_01ABCDEFGHJKMNPQRSTV";
const HASH = "a".repeat(64);
const VALIDOS: Record<string, unknown> = {
  "alertas:catalogo": {},
  "alertas:listar": { estado: "nao_lidos", tipos: ["tarefa_concluida"], severidade_min: "aviso", workspace_id: WS, busca: "login", depois_id: null, limite: 50 },
  "alertas:contar": {},
  "alertas:marcar_lido": { ids: [ID_A] },
  "alertas:silenciar": { alvo: { tipo: "tarefa_concluida" }, ate: "2026-10-01T13:00:00.000Z" },
  "alertas:regras_listar": {},
  "alertas:regra_gravar": { nome: "Regra", ativa: true, tipos: ["*"], canal_id: "canal_so", filtros: {}, silencio: { inicio: "22:00", fim: "07:00", dias: [1, 2], excecao_critico: true }, agrupamento: { modo: "lote", janela_s: 5 }, nivel: "minimo" },
  "alertas:regra_apagar": { id: ID_R },
  "alertas:regra_preset": { preset: "tudo_no_app", canal_id: "canal_so" },
  "alertas:silencio_ler": {},
  "alertas:silencio_gravar": { janela: {}, temporario_ate: null, temporario_incluir_criticos: false },
  "alertas:modelos_listar": {},
  "alertas:modelo_gravar": { tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo", corpo: "{{task_id}}" },
  "alertas:modelo_restaurar": { tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo" },
  "alertas:modelo_prever": { tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo", corpo: "{{task_id}}" },
  "alertas:config_ler": {},
  "alertas:config_gravar": { patch: { ligado: true, retencao_dias: 30, atraso: { fator: 2 }, digest: { diario: { ligado: true, hora: "18:00" } } } },
  "alertas:abrir_entidade": { alerta_id: ID_A },
  "canais:listar": {},
  "canais:consentir": { canal_id: "canal_telegram", versao_texto: "tg-1", hash_texto: HASH },
  "canais:ligar_saida": { canal_id: "canal_telegram" },
  "canais:desligar_saida": { canal_id: "canal_telegram" },
  "canais:teste_envio": { canal_id: "canal_so" },
  "telegram:estado": {},
  "telegram:token_testar": { token: "123456789:AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s" },
  "telegram:token_salvar": { token: "123456789:AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s" },
  "telegram:token_remover": {},
  "telegram:webhook_limpar": {},
  "telegram:comandos_configurar": {},
  "telegram:parear_iniciar": {},
  "telegram:parear_cancelar": {},
  "telegram:parear_decidir": { pedido_id: "ped_abc123", permitir: true },
  "telegram:autorizado_config": { id: "aut_AbCdEfGhIj", patch: { modo_padrao: "aprovar", workspaces: [{ workspace_id: WS, modo: "direto", padrao: true }], pin: "1234" }, confirmacao: "DIRETO" },
  "telegram:autorizado_revogar": { id: "aut_AbCdEfGhIj" },
  "telegram:nao_autorizado_listar": {},
  "telegram:nao_autorizado_bloquear": { user_id: 123 },
  "telegram:entrada_ligar": { ligada: true },
  "telegram:retomar": {},
  "telegram:panico": { parar_execucoes: true },
  "telegram:plano_decidir_desktop": { plano_id: "mpl_abc", decisao: "aprovar", args_hash: HASH },
  "telegram:auditoria_listar": { depois: null, limite: 20 },
  "telegram:auditoria_exportar": {},
};

describe("contrato: todo canal de alertas/canais/telegram tem validador estrito", () => {
  it("o conjunto de validadores é exatamente o do contrato", () => {
    expect(Object.keys(TODOS).sort()).toEqual(doContrato);
    expect(Object.keys(VALIDOS).sort()).toEqual(doContrato);
  });
  it("payload válido passa; campo extra é recusado em TODOS os canais", () => {
    for (const canal of doContrato) {
      const v = TODOS[canal] as (x: unknown) => { ok: boolean };
      expect(v(VALIDOS[canal]).ok, canal).toBe(true);
      if (canal === "alertas:marcar_lido") expect(v({ ...(VALIDOS[canal] as object), intruso: 1 }).ok, canal).toBe(false);
      else expect(v({ ...(VALIDOS[canal] as object), intruso: 1 }).ok, canal).toBe(false);
    }
  });
  it("canais sem payload recusam payload com conteúdo", () => {
    for (const canal of doContrato.filter((c) => Object.keys(VALIDOS[c] as object).length === 0)) expect((TODOS[canal] as (x: unknown) => { ok: boolean })({ qualquer: 1 }).ok, canal).toBe(false);
  });
});

describe("campos que o renderer NUNCA define", () => {
  const v = TODOS["alertas:regra_gravar"] as (x: unknown) => { ok: boolean };
  const base = VALIDOS["alertas:regra_gravar"] as object;
  it("efemeridade, destino fixo e origem de pedido remoto são recusados", () => {
    expect(v({ ...base, efemera_ate: "2099-01-01T00:00:00.000Z" }).ok).toBe(false);
    expect(v({ ...base, chat_ref: "chat:1" }).ok).toBe(false);
    expect(v({ ...base, origem: "pedido_remoto" }).ok).toBe(false);
    expect(v({ ...base, origem: "padrao", efemera_ate: null, chat_ref: null }).ok).toBe(true);
  });
  it("tipo desconhecido, hora inválida, janela absurda e filtros fora da faixa", () => {
    expect(v({ ...base, tipos: ["inventado"] }).ok).toBe(false);
    expect(v({ ...base, silencio: { inicio: "25:00" } }).ok).toBe(false);
    expect(v({ ...base, agrupamento: { modo: "lote", janela_s: 99999 } }).ok).toBe(false);
    expect(v({ ...base, nome: "a\u0000b" }).ok).toBe(false);
    expect(v({ ...base, filtros: { workspace_ids: ["../etc"] } }).ok).toBe(false);
  });
  it("config: valores fora da faixa e chaves desconhecidas são recusados", () => {
    const c = TODOS["alertas:config_gravar"] as (x: unknown) => { ok: boolean };
    expect(c({ patch: { retencao_dias: 1 } }).ok).toBe(false);
    expect(c({ patch: { atraso: { fator: 50 } } }).ok).toBe(false);
    expect(c({ patch: { digest: { diario: { hora: "9:00" } } } }).ok).toBe(false);
    expect(c({ patch: { segredo: "x" } }).ok).toBe(false);
  });
  it("telegram: PIN curto, modo desconhecido e usuário inválido são recusados", () => {
    const a = TODOS["telegram:autorizado_config"] as (x: unknown) => { ok: boolean };
    expect(a({ id: "aut_AbCdEfGhIj", patch: { pin: "12" } }).ok).toBe(false);
    expect(a({ id: "aut_AbCdEfGhIj", patch: { modo_padrao: "tudo" } }).ok).toBe(false);
    expect(a({ id: "aut_AbCdEfGhIj", patch: { pin: null } }).ok).toBe(true);
    expect((TODOS["telegram:nao_autorizado_bloquear"] as (x: unknown) => { ok: boolean })({ user_id: -1 }).ok).toBe(false);
    expect((TODOS["telegram:nao_autorizado_bloquear"] as (x: unknown) => { ok: boolean })({ user_id: 1.5 }).ok).toBe(false);
  });
});

describe("registro: canais sensíveis nunca imprimem o token; erro não nominal não vaza", () => {
  const SENTINELA = "123456789:AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s";
  function montar() {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    const logs: string[] = [];
    const registro = criarRegistroIpc({ ipcMain, autorizar: () => true, log: (l) => logs.push(l), logarPayload: true });
    const tg = { tokenSalvar: vi.fn(async () => ({ ok: true })), tokenTestar: vi.fn(async () => { throw new Error(`SQLITE_ERROR em /Users/x/.db ${SENTINELA}`); }) };
    const l = { telegram: async () => tg, listar: vi.fn(() => ({ itens: [], proximo: null })), contar: () => ({ nao_lidos: 0, criticos: 0 }), regraGravar: vi.fn(() => { throw new ErroAlertasIpc("not_found", "canal inexistente"); }) } as unknown as LigacaoAlertas;
    registrarIpcAlertas({ registro, ligacao: () => l });
    registrarIpcTelegram({ registro, ligacao: () => l });
    return { handlers, logs, tg, l };
  }
  it("todos os canais do contrato ficam registrados", () => {
    const m = montar();
    expect([...m.handlers.keys()].sort()).toEqual(doContrato);
  });
  it("token_salvar/token_testar: o log do registro não contém o token, nem na recusa", async () => {
    const m = montar();
    await m.handlers.get("telegram:token_salvar")?.({}, { token: SENTINELA });
    await expect(m.handlers.get("telegram:token_testar")?.({}, { token: SENTINELA })).rejects.toThrow(/unavailable/);
    await expect(m.handlers.get("telegram:token_salvar")?.({}, { token: SENTINELA, extra: 1 })).rejects.toThrow();
    expect(m.logs.join("\n")).not.toContain(SENTINELA);
    expect(CANAIS_SENSIVEIS).toEqual(expect.arrayContaining(["telegram:token_testar", "telegram:token_salvar", "telegram:autorizado_config"]));
  });
  it("falha não nominal vira texto genérico (sem SQL, caminho nem token); erro nominal passa", async () => {
    const m = montar();
    let msg = "";
    try {
      await m.handlers.get("telegram:token_testar")?.({}, { token: SENTINELA });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe("unavailable: falha ao executar a operação de alertas");
    await expect(m.handlers.get("alertas:regra_gravar")?.({}, VALIDOS["alertas:regra_gravar"])).rejects.toThrow(/not_found: canal inexistente/);
  });
  it("sem a ligação montada: unavailable (nunca exceção crua)", async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const registro = criarRegistroIpc({ ipcMain: { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined }, autorizar: () => true });
    registrarIpcAlertas({ registro, ligacao: () => null });
    await expect(handlers.get("alertas:contar")?.({}, {})).rejects.toThrow(/unavailable/);
  });
});
