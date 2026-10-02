import { describe, expect, it, vi } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { ErroDeMaestroIpc, type LigacaoMaestro } from "../maestro";
import { MaestroErro } from "../../nucleo/maestro";
import { criarManipuladoresMaestro, registrarIpcMaestro, VALIDADORES_MAESTRO, type CanalMaestro } from "./maestro";
import { criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_01M3V15S79Z6E12TBR7VHE8N0S";
const PL = "mpl_abc123def456";
const val = (canal: CanalMaestro, v: unknown) => (VALIDADORES_MAESTRO[canal] as (x: unknown) => { ok: boolean; erro?: string })(v);
const erro = (canal: CanalMaestro, v: unknown): string => {
  const r = val(canal, v);
  expect(r.ok, `${canal}: ${JSON.stringify(v)}`).toBe(false);
  return r.erro ?? "";
};

const CANAIS_DA_FASE = CANAIS_INVOKE.filter((c) => /^(maestro|pipelines|rigidez):/.test(c));
const PEDIR = { workspace_id: WS, texto: "corrige o login", contexto: null, via: "paleta", nivel_pedido: null, executar_direto: null };
const CONFIG = { etapa_id: "runx.e3", perfil: { cli: "claude", modelo: null, esforco: "medio", faixa: "medio", origem_modelo: "cli", agente_id: null }, skills: ["runx-fix"], modo_execucao: "novo_terminal", atualizado_por: "usuario" };
const RIGIDEZ = { workspace_id: WS, escopo: "workspace", mission_id: null, plano_id: null, nivel: 3, justificativa: null, confirmacao_digitada: null, aplicar_hooks_ja: false, voltar_ao_padrao: false };

describe("contrato: todo canal tem validador estrito e nenhum é órfão", () => {
  it("os 25 canais maestro:*, pipelines:* e rigidez:* têm validador (e só eles)", () => {
    expect(Object.keys(VALIDADORES_MAESTRO).sort()).toEqual([...CANAIS_DA_FASE].sort());
    expect(CANAIS_DA_FASE).toHaveLength(25);
    for (const c of CANAIS_DA_FASE) expect(typeof (VALIDADORES_MAESTRO as Record<string, unknown>)[c], c).toBe("function");
  });
  it("os eventos existem no contrato; nenhum canal desta fase é sensível (segredo não existe aqui)", () => {
    expect(CANAIS_EVENTO).toEqual(expect.arrayContaining(["maestro:evento", "rigidez:evento"]));
    expect(CANAIS_SENSIVEIS.filter((c) => /^(maestro|pipelines|rigidez):/.test(c))).toEqual([]);
  });
});

describe("maestro:pedir", () => {
  it("aceita o pedido normal e recusa campo extra, texto vazio/grande, via que não é do renderer e nível fora de 1..5", () => {
    expect(val("maestro:pedir", PEDIR).ok).toBe(true);
    expect(erro("maestro:pedir", { ...PEDIR, extra: 1 })).toMatch(/campo desconhecido/);
    expect(erro("maestro:pedir", { ...PEDIR, texto: "   " })).toMatch(/vazio/);
    expect(erro("maestro:pedir", { ...PEDIR, texto: "a".repeat(4001) })).toMatch(/longo/);
    expect(val("maestro:pedir", { ...PEDIR, texto: "a".repeat(4000) }).ok).toBe(true);
    for (const via of ["mcp", "hook", "telegram", "issue", "squad", "api", "x"]) expect(val("maestro:pedir", { ...PEDIR, via }).ok, via).toBe(false);
    for (const n of [0, 6, 2.5, "3", -1]) expect(val("maestro:pedir", { ...PEDIR, nivel_pedido: n }).ok, String(n)).toBe(false);
    expect(val("maestro:pedir", { ...PEDIR, nivel_pedido: 5 }).ok).toBe(true);
    expect(val("maestro:pedir", { ...PEDIR, workspace_id: "../etc" }).ok).toBe(false);
    expect(val("maestro:pedir", { ...PEDIR, texto: "a\0b" }).ok).toBe(false);
  });
  it("o contexto não carrega cwd, caminho absoluto, `..`, URL nem chave", () => {
    const ctx = (o: Record<string, unknown>) => ({ ...PEDIR, contexto: { pane_id: null, mission_id: null, trabalho_id: null, arquivos: [], trecho: null, ...o } });
    expect(val("maestro:pedir", ctx({ arquivos: ["src/a.ts"] })).ok).toBe(true);
    for (const a of ["/etc/passwd", "../x", "a\\b", "C:/x", "a\0b"]) expect(val("maestro:pedir", ctx({ arquivos: [a] })).ok, a).toBe(false);
    expect(val("maestro:pedir", ctx({ arquivos: Array.from({ length: 21 }, (_, i) => `a${i}.ts`) })).ok).toBe(false);
    expect(val("maestro:pedir", ctx({ cwd: "/tmp" })).ok).toBe(false);
    expect(val("maestro:pedir", ctx({ chave: "sk-123" })).ok).toBe(false);
    expect(val("maestro:pedir", ctx({ trecho: "x".repeat(2001) })).ok).toBe(false);
    expect(val("maestro:pedir", ctx({ pane_id: "../x" })).ok).toBe(false);
  });
});

describe("maestro:confirmar e rigidez:definir: justificativa e confirmação", () => {
  const CONF = { plano_id: PL, nivel: null, etapas_desligadas: [], intencao: null, justificativa: null, confirmacao_digitada: null };
  it("justificativa < 20 caracteres é recusada; 20 passam; etapa fora do catálogo e repetida caem", () => {
    expect(val("maestro:confirmar", CONF).ok).toBe(true);
    expect(erro("maestro:confirmar", { ...CONF, justificativa: "curta demais" })).toMatch(/20 caracteres/);
    expect(val("maestro:confirmar", { ...CONF, justificativa: "x".repeat(20) }).ok).toBe(true);
    expect(val("maestro:confirmar", { ...CONF, etapas_desligadas: ["runx.inventada"] }).ok).toBe(false);
    expect(val("maestro:confirmar", { ...CONF, etapas_desligadas: ["mergex.qa", "mergex.qa"] }).ok).toBe(false);
    expect(val("maestro:confirmar", { ...CONF, plano_id: "../../x" }).ok).toBe(false);
    expect(val("maestro:confirmar", { ...CONF, nivel: 7 }).ok).toBe(false);
    expect(val("maestro:confirmar", { ...CONF, intencao: "hackear" }).ok).toBe(false);
  });
  it("rigidez:definir exige mission_id no escopo missão e plano_id no escopo pedido", () => {
    expect(val("rigidez:definir", RIGIDEZ).ok).toBe(true);
    expect(erro("rigidez:definir", { ...RIGIDEZ, escopo: "missao" })).toMatch(/mission_id/);
    expect(erro("rigidez:definir", { ...RIGIDEZ, escopo: "pedido" })).toMatch(/plano_id/);
    expect(val("rigidez:definir", { ...RIGIDEZ, escopo: "pedido", plano_id: PL }).ok).toBe(true);
    expect(val("rigidez:definir", { ...RIGIDEZ, nivel: 0 }).ok).toBe(false);
    expect(val("rigidez:definir", { ...RIGIDEZ, confirmacao_digitada: "a".repeat(41) }).ok).toBe(false);
  });
});

describe("configuração: confirmar_plano=0 sem `confirmado`, etapa e arquivo hostil", () => {
  const CFG = { confirmar_plano: true, hook_modo: "encaminhar", hook_confianca_min: 0.75, producao: false, branches_protegidas: ["main"], escrever_hooks: true, hooks_aplicar_ja: false, max_terminais: 4, fechar_concluidos: true, timeout_sem_progresso_min: 30, proposta_expira_min: 30 };
  it("`confirmar_plano=0` só com `confirmado:true`", () => {
    expect(val("maestro:config_gravar", { workspace_id: WS, config: CFG, confirmado: false }).ok).toBe(true);
    expect(erro("maestro:config_gravar", { workspace_id: WS, config: { ...CFG, confirmar_plano: false }, confirmado: false })).toMatch(/confirmado:true/);
    expect(val("maestro:config_gravar", { workspace_id: WS, config: { ...CFG, confirmar_plano: false }, confirmado: true }).ok).toBe(true);
    expect(val("maestro:config_gravar", { workspace_id: WS, config: { ...CFG, max_terminais: 99 }, confirmado: false }).ok).toBe(false);
    expect(val("maestro:config_gravar", { workspace_id: WS, config: { ...CFG, token: "x" }, confirmado: false }).ok).toBe(false);
  });
  it("EtapaConfig: modelo com flag/caminho, esforço inválido, skill fora do padrão e campo extra são recusados", () => {
    const g = (o: Record<string, unknown>, perfil: Record<string, unknown> = {}) => ({ workspace_id: null, config: { ...CONFIG, ...o, perfil: { ...CONFIG.perfil, ...perfil } } });
    expect(val("pipelines:config_gravar", g({})).ok).toBe(true);
    for (const modelo of ["--rm", "../x", "a b", "a//b", "-x"]) expect(val("pipelines:config_gravar", g({}, { modelo })).ok, modelo).toBe(false);
    expect(val("pipelines:config_gravar", g({}, { cli: "Claude Code" })).ok).toBe(false);
    expect(val("pipelines:config_gravar", g({}, { esforco: "ALTO!" })).ok).toBe(false);
    expect(val("pipelines:config_gravar", g({ skills: ["Runx Fix"] })).ok).toBe(false);
    expect(val("pipelines:config_gravar", g({ skills: ["a", "a"] })).ok).toBe(false);
    expect(val("pipelines:config_gravar", g({ etapa_id: "inventada.e9" })).ok).toBe(false);
    expect(val("pipelines:config_gravar", g({ cwd: "/tmp" })).ok).toBe(false);
    expect(val("pipelines:config_gravar", g({}, { chave: "sk-1" })).ok).toBe(false);
  });
  it("exportar/importar do repositório exigem workspace; arquivo usa só o seletor nativo do main (sem caminho no payload)", () => {
    expect(erro("pipelines:exportar", { workspace_id: null, destino: "repo" })).toMatch(/workspace_id/);
    expect(val("pipelines:exportar", { workspace_id: null, destino: "arquivo" }).ok).toBe(true);
    expect(val("pipelines:exportar", { workspace_id: WS, destino: "arquivo", caminho: "/tmp/x" }).ok).toBe(false);
    expect(erro("pipelines:importar_previa", { workspace_id: null, origem: "repo" })).toMatch(/workspace_id/);
    expect(val("pipelines:importar_confirmar", { previa_id: "previa_abc123", workspace_id: null }).ok).toBe(true);
    expect(val("pipelines:importar_confirmar", { previa_id: "../x", workspace_id: null }).ok).toBe(false);
  });
  it("ação do pipeline: não existe assinar/aprovar/merge", () => {
    const a = (acao: string) => val("maestro:pipeline_acao", { id: PL, acao, etapa_id: null });
    for (const ok of ["pausar", "retomar", "pular_etapa", "reabrir_etapa", "confirmar_etapa", "abrir_arquivo"]) expect(a(ok).ok, ok).toBe(true);
    for (const ruim of ["assinar", "aprovar", "aprovar_raio", "merge", "mergear", "revisar", "cancelar"]) expect(a(ruim).ok, ruim).toBe(false);
  });
  it("listagens têm teto; previa_plano só aceita pipeline do catálogo", () => {
    expect(val("maestro:pipelines_listar", { workspace_id: WS, so_ativos: true, limite: 100 }).ok).toBe(true);
    expect(val("maestro:pipelines_listar", { workspace_id: WS, so_ativos: true, limite: 101 }).ok).toBe(false);
    expect(val("maestro:recibos_listar", { workspace_id: WS, limite: 201 }).ok).toBe(false);
    expect(val("rigidez:previa_plano", { workspace_id: WS, pipeline_id: "runx", nivel: 3 }).ok).toBe(true);
    expect(val("rigidez:previa_plano", { workspace_id: WS, pipeline_id: "rm-rf", nivel: 3 }).ok).toBe(false);
  });
});

function ligacaoFalsa(sobrescritas: Partial<Record<keyof LigacaoMaestro, unknown>> = {}): LigacaoMaestro {
  const base = new Proxy({} as Record<string, unknown>, { get: (_t, nome: string) => (sobrescritas as Record<string, unknown>)[nome] ?? vi.fn(async () => ({ ok: true })) });
  return base as unknown as LigacaoMaestro;
}

describe("manipuladores e registro", () => {
  it("registra os 25 canais com ipcMain falso e delega à ligação (um canal por manipulador)", async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipc: IpcMainLike = { handle: (c, f) => void handlers.set(c, f), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    const pedir = vi.fn(async (_p: unknown) => ({ plano: {}, recibo: {} }));
    registrarIpcMaestro({ registro, ligacao: ligacaoFalsa({ pedir }) });
    expect(registro.registrados()).toEqual([...CANAIS_DA_FASE].sort());
    await handlers.get("maestro:pedir")?.({}, PEDIR);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir.mock.calls[0]?.[0]).toMatchObject({ workspace_id: WS, via: "paleta" });
    await expect(handlers.get("maestro:pedir")?.({}, { ...PEDIR, texto: "" })).rejects.toThrow(/recusado/);
    expect(pedir).toHaveBeenCalledTimes(1);
  });
  it("remetente não autorizado é recusado antes do manipulador", async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipc: IpcMainLike = { handle: (c, f) => void handlers.set(c, f), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => false });
    const cancelar = vi.fn();
    registrarIpcMaestro({ registro, ligacao: ligacaoFalsa({ cancelar }) });
    await expect(handlers.get("maestro:cancelar")?.({}, { id: PL })).rejects.toThrow(/remetente/);
    expect(cancelar).not.toHaveBeenCalled();
  });
  it("erro do núcleo sai como `<codigo>: <mensagem>`; erro desconhecido (ENOENT com caminho) vira texto genérico", async () => {
    const m = criarManipuladoresMaestro(
      ligacaoFalsa({
        confirmar: async () => {
          throw new MaestroErro("confirmacao_necessaria", 'digite "baixar"');
        },
        cancelar: async () => {
          throw new Error("ENOENT: no such file or directory, open '/Users/fulano/.ssh/id_rsa'");
        },
        pedir: async () => {
          throw new ErroDeMaestroIpc("invalid_argument", "painel fora do workspace");
        },
      }),
    );
    await expect(m["maestro:confirmar"]({ plano_id: PL, nivel: null, etapas_desligadas: [], intencao: null, justificativa: null, confirmacao_digitada: null })).rejects.toThrow(/^confirmacao_necessaria: digite "baixar"$/);
    const e = await m["maestro:cancelar"]({ id: PL }).catch((x: Error) => x);
    expect((e as Error).message).not.toMatch(/fulano|id_rsa|ENOENT/);
    await expect(m["maestro:pedir"](PEDIR as never)).rejects.toThrow(/^invalid_argument: /);
  });
});
