import { describe, expect, it, vi } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE } from "../../compartilhado/ipc";
import { ErroCatalogo, type ServicoCatalogo } from "../../nucleo/catalogo/servico";
import { VALIDADORES_CATALOGO, criarManipuladoresCatalogo, registrarIpcCatalogo, sanearErroCatalogo } from "./catalogo";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const ITEM = "cat_01J8ZXAMPLE0000000000000A1";
type Canal = keyof typeof VALIDADORES_CATALOGO;
const v = (c: Canal, x: unknown) => (VALIDADORES_CATALOGO[c] as (x: unknown) => { ok: boolean }).call(null, x);

const VALIDOS: Record<Canal, unknown> = {
  "catalogo:varrer": { workspace_id: WS, tipos: ["skill"], clis: null },
  "catalogo:listar": { tipo: "skill", workspace_id: null },
  "catalogo:detalhe": { item_id: ITEM },
  "catalogo:instalar": { item_id: ITEM, de_cli: "claude", para_cli: "codex", modo: "symlink" },
  "catalogo:desinstalar": { item_id: ITEM, cli: "codex", escopo: "global", workspace_id: null, modo: "remover_criado" },
  "catalogo:limpar_ausentes": { tipo: "agent" },
  "catalogo:remover_do_catalogo": { item_id: ITEM },
  "catalogo:revelar": { item_id: ITEM, cli: "claude", escopo: "projeto", workspace_id: WS },
  "catalogo:verificar_mcp": { item_id: ITEM, confirmado: true },
  "catalogo:politica_ler": { workspace_id: WS },
  "catalogo:politica_gravar": { workspace_id: WS, alvo_tipo: "papel", alvo_valor: "executor", skills: ["a", "grupo:metodo"], mcp_do_usuario: "nenhum", servidores_mcp: [] },
  "catalogo:politica_previa": { workspace_id: WS, modo: "squad", papel: "executor", agente_id: null, mission_id: null, cli: "claude" },
  "catalogo:saude": { workspace_id: null },
  "catalogo:embarcadas_estado": {},
  "catalogo:embarcadas_instalar": { nome: null, cli: "claude" },
  "catalogo:embarcadas_opt_out": { nome: "ev-guide", cli: "claude", valor: true },
};

describe("contrato catalogo:*", () => {
  it("validadores cobrem EXATAMENTE os canais; todos aceitam o payload válido; evento declarado", () => {
    const contrato = CANAIS_INVOKE.filter((c) => c.startsWith("catalogo:")).sort();
    expect(Object.keys(VALIDADORES_CATALOGO).sort()).toEqual(contrato);
    for (const c of contrato) expect(v(c as Canal, VALIDOS[c as Canal]), c).toEqual(expect.objectContaining({ ok: true }));
    expect(CANAIS_EVENTO).toContain("catalogo:evento");
  });
  it("todo canal recusa campo extra, texto e null", () => {
    for (const c of Object.keys(VALIDOS) as Canal[]) {
      expect(v(c, { ...(VALIDOS[c] as object), extra: 1 }).ok, c).toBe(false);
      expect(v(c, "x").ok, c).toBe(false);
      expect(v(c, null).ok, c).toBe(false);
    }
  });
  it("o renderer não consegue enviar caminho: ids, nomes e enums fechados", () => {
    for (const item_id of ["../etc", "/etc/passwd", "cat_", "x", "cat_../../x"]) expect(v("catalogo:detalhe", { item_id }).ok, item_id).toBe(false);
    expect(v("catalogo:instalar", { ...(VALIDOS["catalogo:instalar"] as object), para_cli: "bash" }).ok).toBe(false);
    expect(v("catalogo:instalar", { ...(VALIDOS["catalogo:instalar"] as object), modo: "hardlink" }).ok).toBe(false);
    expect(v("catalogo:politica_gravar", { ...(VALIDOS["catalogo:politica_gravar"] as object), skills: ["../x"] }).ok).toBe(false);
    expect(v("catalogo:politica_gravar", { ...(VALIDOS["catalogo:politica_gravar"] as object), alvo_valor: "/etc" }).ok).toBe(false);
    expect(v("catalogo:politica_gravar", { ...(VALIDOS["catalogo:politica_gravar"] as object), skills: Array.from({ length: 201 }, (_, i) => `s${i}`) }).ok).toBe(false);
    expect(v("catalogo:varrer", { workspace_id: "../x", tipos: null, clis: null }).ok).toBe(false);
    expect(v("catalogo:varrer", { workspace_id: null, tipos: ["x"], clis: null }).ok).toBe(false);
    expect(v("catalogo:embarcadas_opt_out", { nome: "../x", cli: "claude", valor: true }).ok).toBe(false);
  });
  it("verificar_mcp só com confirmado literalmente true", () => {
    for (const confirmado of [false, "true", 1, null, undefined]) expect(v("catalogo:verificar_mcp", { item_id: ITEM, confirmado }).ok).toBe(false);
  });
});

describe("manipuladores e registro", () => {
  const ipcFalso = () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    return { ipc, handlers };
  };
  it("registra os 16 canais, recusa payload inválido e remetente não autorizado ANTES do serviço", async () => {
    const { ipc, handlers } = ipcFalso();
    let autorizado = true;
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => autorizado });
    const servico = { listar: vi.fn(() => ({ itens: [], truncado: false, ultima_varredura_em: null })) } as unknown as ServicoCatalogo;
    const provedor = vi.fn(() => servico);
    registrarIpcCatalogo({ registro, servico: provedor });
    expect(registro.registrados().filter((c) => c.startsWith("catalogo:"))).toHaveLength(16);
    expect(provedor).not.toHaveBeenCalled(); // nada no registro: serviço sob demanda
    await handlers.get("catalogo:listar")!({}, { tipo: "skill", workspace_id: null });
    expect(servico.listar).toHaveBeenCalledOnce();
    await expect(handlers.get("catalogo:listar")!({}, { tipo: "skill", workspace_id: null, caminho: "/etc" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    autorizado = false;
    await expect(handlers.get("catalogo:listar")!({}, { tipo: "skill", workspace_id: null })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(servico.listar).toHaveBeenCalledOnce();
  });
  it("erros: só os nominais públicos passam; o resto vira texto genérico sem caminho", async () => {
    expect(sanearErroCatalogo(new ErroCatalogo("confirmacao_exigida", "x")).message).toBe("x");
    const e = sanearErroCatalogo(new Error("ENOENT /Users/fulano/.claude"));
    expect(e.message).not.toContain("/Users");
    const m = criarManipuladoresCatalogo(() => ({ saude: () => { throw new Error("EACCES /Users/x/segredo"); } }) as unknown as ServicoCatalogo);
    await expect(m["catalogo:saude"]({ workspace_id: null })).rejects.toThrow("falha ao executar a operação do catálogo");
  });
  it("varrer devolve só o id (a varredura corre em segundo plano) com gatilho 'tela'", async () => {
    const varrer = vi.fn(() => ({ varredura_id: "cat_1", pronta: Promise.resolve() }));
    const m = criarManipuladoresCatalogo(() => ({ varrer }) as unknown as ServicoCatalogo);
    expect(await m["catalogo:varrer"]({ workspace_id: null, tipos: null, clis: null })).toEqual({ varredura_id: "cat_1" });
    expect(varrer).toHaveBeenCalledWith({ workspace_id: null, tipos: null, clis: null }, "tela");
  });
});
