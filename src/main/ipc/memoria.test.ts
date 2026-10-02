import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { VALIDADORES_MEMORIA, registrarIpcMemoria } from "./memoria";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_01J8ZXAMPLE00000000000A1";
const MIS = "mis_01J8ZXAMPLE00000000000A1";
const PANE = "pane_01J8ZXAMPLE00000000000A1";

function montar() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
  const servico = {
    estado: vi.fn(async () => ({}) as never),
    gravarConfig: vi.fn(() => ({}) as never),
    listar: vi.fn(() => ({ itens: [], proximo: null })),
    atualizar: vi.fn(() => ({}) as never),
    esquecer: vi.fn(() => ({ ok: true })),
    esquecerPane: vi.fn(() => ({ removidas: 2 })),
    purgar: vi.fn(() => ({ removidas: 3 })),
    exportar: vi.fn(() => ({ versao: 1, entradas: [] })),
    briefPrevia: vi.fn(() => ({ markdown: "", caracteres: 0, truncado: false, modo: "off" as const })),
    preferencias: { listar: vi.fn(() => []), gravar: vi.fn(() => ({}) as never), remover: vi.fn(() => ({ ok: true })) },
  };
  const deps = {
    registro,
    servico,
    definirMissaoAtiva: vi.fn(),
    linhagemDe: vi.fn((id: string) => `raiz-${id}`),
    restaurar: vi.fn(async () => ({ pane_id: "p2", sessao_id: "s", modo: "brief" as const, brief_injetado: true, truncado: false, ja_existia: false })),
    salvarExportacao: vi.fn(async () => "/tmp/x.json" as string | null),
  };
  registrarIpcMemoria(deps);
  const chamar = (canal: string, payload: unknown) => (handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload);
  return { ...deps, servico, chamar, registro };
}

describe("contrato memoria:*", () => {
  it("todo canal do contrato tem validador e manipulador; nenhum órfão", () => {
    const doContrato = CANAIS_INVOKE.filter((c) => c.startsWith("memoria:")).sort();
    expect(Object.keys(VALIDADORES_MEMORIA).sort()).toEqual(doContrato);
    expect(montar().registro.registrados().sort()).toEqual(doContrato);
    expect(doContrato).toHaveLength(14);
  });
});

describe("manipuladores memoria:*", () => {
  it("estado, config e chave por Missão repassam ao serviço", async () => {
    const m = montar();
    await m.chamar("memoria:estado", { workspace_id: WS });
    expect(m.servico.estado).toHaveBeenCalledWith(WS);
    await m.chamar("memoria:config_gravar", { workspace_id: WS, squad: false, teto_mb: 64, retencao_dias: 0, embedding_modelo: null, global_ativa: false });
    expect(m.servico.gravarConfig).toHaveBeenCalledWith(WS, { squad: false, teto_mb: 64, retencao_dias: 0, embedding_modelo: null, global_ativa: false });
    expect(await m.chamar("memoria:missao_config", { mission_id: MIS, ativa: null })).toEqual({ mission_id: MIS, ativa: null });
    expect(m.definirMissaoAtiva).toHaveBeenCalledWith(MIS, null);
  });

  it("listar por Pane usa a raiz da linhagem; Pane inexistente devolve página vazia", async () => {
    const m = montar();
    const base = { workspace_id: WS, escopo: null, mission_id: null, tipos: null, busca: null, depois: null, limite: 50 };
    await m.chamar("memoria:listar", { ...base, pane_id: PANE });
    expect(m.servico.listar).toHaveBeenCalledWith(expect.objectContaining({ linhagem_id: `raiz-${PANE}`, limite: 50 }));
    m.linhagemDe.mockImplementationOnce(() => {
      throw new Error("sem pane");
    });
    expect(await m.chamar("memoria:listar", { ...base, pane_id: PANE })).toEqual({ itens: [], proximo: null });
  });

  it("atualizar (editar/fixar) valida campo a campo e repassa ao serviço", async () => {
    const m = montar();
    await m.chamar("memoria:atualizar", { entrada_id: "mem_abc123", importancia: 5 });
    expect(m.servico.atualizar).toHaveBeenCalledWith({ id: "mem_abc123", importancia: 5 });
    await m.chamar("memoria:atualizar", { entrada_id: "mem_abc123", conteudo: "novo texto" });
    expect(m.servico.atualizar).toHaveBeenLastCalledWith({ id: "mem_abc123", conteudo: "novo texto" });
    await expect(Promise.resolve(m.chamar("memoria:atualizar", { entrada_id: "mem_abc123", importancia: 9 }))).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(Promise.resolve(m.chamar("memoria:atualizar", { entrada_id: "mem_abc123", conteudo: "x", fonte: "agente" }))).rejects.toBeInstanceOf(CanalRecusadoErro);
  });

  it("esquecer, esquecer_pane e purgar", async () => {
    const m = montar();
    expect(await m.chamar("memoria:esquecer", { entrada_id: "mem_abc123" })).toEqual({ ok: true });
    expect(await m.chamar("memoria:esquecer_pane", { pane_id: PANE })).toEqual({ removidas: 2 });
    expect(await m.chamar("memoria:purgar", { workspace_id: WS, escopo: "tudo", confirmacao: "meu-projeto" })).toEqual({ removidas: 3 });
    expect(m.servico.purgar).toHaveBeenCalledWith({ workspace_id: WS, escopo: "tudo", confirmacao: "meu-projeto" });
  });

  it("exportar abre o salvar no main (o renderer nunca dá o caminho); cancelar = null", async () => {
    const m = montar();
    expect(await m.chamar("memoria:exportar", { workspace_id: WS, escopo: "workspace" })).toEqual({ caminho_salvo: "/tmp/x.json" });
    expect(m.salvarExportacao).toHaveBeenCalledWith({ versao: 1, entradas: [] }, "memoria-workspace.json");
    m.salvarExportacao.mockResolvedValueOnce(null);
    expect(await m.chamar("memoria:exportar", { workspace_id: WS, escopo: "usuario" })).toEqual({ caminho_salvo: null });
    await expect(Promise.resolve(m.chamar("memoria:exportar", { workspace_id: WS, escopo: "tudo", caminho: "/etc/x" }))).rejects.toBeInstanceOf(CanalRecusadoErro);
  });

  it("restaurar e prévia do brief", async () => {
    const m = montar();
    await m.chamar("memoria:restaurar", { pane_id: PANE, modo: "auto" });
    expect(m.restaurar).toHaveBeenCalledWith(PANE, "auto");
    await m.chamar("memoria:brief_previa", { pane_id: PANE });
    expect(m.servico.briefPrevia).toHaveBeenCalledWith(PANE);
  });

  it("preferências (anel 3)", async () => {
    const m = montar();
    await m.chamar("memoria:preferencias_listar", {});
    await m.chamar("memoria:preferencias_gravar", { id: null, conteudo: "responder em português", importancia: 4 });
    expect(m.servico.preferencias.gravar).toHaveBeenCalledWith({ id: null, conteudo: "responder em português", importancia: 4 });
    expect(await m.chamar("memoria:preferencias_remover", { id: "mem_pref1" })).toEqual({ ok: true });
  });
});

describe("validadores estritos", () => {
  const recusa = async (canal: string, payload: unknown) => {
    const m = montar();
    await expect(Promise.resolve(m.chamar(canal, payload)), canal).rejects.toBeInstanceOf(CanalRecusadoErro);
    return m;
  };

  it("recusa campo desconhecido, id fora do padrão e valores fora da faixa", async () => {
    await recusa("memoria:estado", { workspace_id: "../etc" });
    await recusa("memoria:estado", { workspace_id: WS, extra: 1 });
    await recusa("memoria:config_gravar", { workspace_id: WS, retencao_dias: 3 });
    await recusa("memoria:config_gravar", { workspace_id: WS, orcamento_brief_chars: 100 });
    await recusa("memoria:config_gravar", { workspace_id: WS, teto_mb: 1 });
    await recusa("memoria:config_gravar", { workspace_id: WS, embedding_modelo: "../x" });
    await recusa("memoria:config_gravar", { global_ativa: false });
    await recusa("memoria:missao_config", { mission_id: MIS, ativa: "sim" });
    await recusa("memoria:listar", { workspace_id: WS, escopo: "tudo", mission_id: null, pane_id: null, tipos: null, busca: null, depois: null, limite: 10 });
    await recusa("memoria:listar", { workspace_id: WS, escopo: null, mission_id: null, pane_id: null, tipos: null, busca: null, depois: null, limite: 201 });
    await recusa("memoria:listar", { workspace_id: WS, escopo: null, mission_id: null, pane_id: null, tipos: ["segredo"], busca: null, depois: null, limite: 10 });
    await recusa("memoria:purgar", { workspace_id: WS, escopo: "tudo", confirmacao: "" });
    await recusa("memoria:purgar", { workspace_id: WS, escopo: "xyz", confirmacao: "a" });
    await recusa("memoria:restaurar", { pane_id: PANE, modo: "forcar" });
    await recusa("memoria:preferencias_gravar", { id: null, conteudo: "x".repeat(301), importancia: 3 });
    await recusa("memoria:preferencias_gravar", { id: null, conteudo: "ok", importancia: 9 });
    await recusa("memoria:preferencias_listar", undefined);
  });

  it("aceita retenção 0 (sem limite) e o escopo squad", async () => {
    const m = montar();
    await m.chamar("memoria:config_gravar", { workspace_id: WS, retencao_dias: 0 });
    await m.chamar("memoria:listar", { workspace_id: WS, escopo: "squad", mission_id: null, pane_id: null, tipos: ["decisao"], busca: "x", depois: null, limite: 1 });
    expect(m.servico.listar).toHaveBeenCalled();
  });
});
