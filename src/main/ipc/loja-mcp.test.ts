import { describe, expect, it, vi } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import type { ServicoLojaMcp } from "../loja-mcp";
import { ErroLoja, VALIDADORES_LOJA_MCP, criarManipuladoresLojaMcp, registrarIpcLojaMcp, sanearErroDaLoja } from "./loja-mcp";
import { criarRegistroIpc, CanalRecusadoErro, type IpcMainLike } from "./registro";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const H = "a".repeat(64);
type Canal = keyof typeof VALIDADORES_LOJA_MCP;
const v = (canal: Canal, x: unknown) => (VALIDADORES_LOJA_MCP[canal] as (x: unknown) => { ok: boolean; erro?: string })(x);

const VALIDOS: Record<Canal, unknown> = {
  "loja_mcp:listar": {},
  "loja_mcp:detalhe": { id: "context7", workspace_id: WS },
  "loja_mcp:plano_instalacao": { ids: ["context7", "deepwiki"], workspace_id: null },
  "loja_mcp:instalar": { ids: ["context7"], consentimento: { aceito: true, comando_hashes: { context7: H } }, workspace_id: null },
  "loja_mcp:cancelar": { instalacao_id: "inst_0123456789abcdef" },
  "loja_mcp:desinstalar": { id: "context7", apagar_segredos: false },
  "loja_mcp:plano_atualizacao": { id: "context7", workspace_id: null },
  "loja_mcp:atualizar": { id: "context7", consentimento: { aceito: true, comando_hash: H }, workspace_id: null },
  "loja_mcp:variaveis_estado": { id: "context7" },
  "loja_mcp:variavel_gravar": { id: "context7", nome: "CONTEXT7_API_KEY", valor: "segredo" },
  "loja_mcp:variavel_apagar": { id: "context7", nome: "CONTEXT7_API_KEY" },
  "loja_mcp:testar": { id: "context7", workspace_id: null },
  "loja_mcp:habilitar": { id: "context7", alvo_tipo: "workspace", alvo_valor: WS, habilitado: true },
  "loja_mcp:habilitacoes": { workspace_id: WS },
  "loja_mcp:previa_cli_usuario": { id: "context7", cli: "claude", workspace_id: null },
  "loja_mcp:instalar_na_cli": { id: "context7", cli: "codex", confirmacao: "ev_context7", workspace_id: null },
  "loja_mcp:remover_da_cli": { id: "context7", cli: "gemini" },
  "loja_mcp:logs": { id: "context7", limite: 50 },
  "loja_mcp:kit_estado": {},
  "loja_mcp:kit_plano": { workspace_id: null },
  "loja_mcp:kit_instalar": { consentimento: { aceito: true, comando_hash: H }, workspace_id: null },
  "loja_mcp:kit_opt_out": { valor: true },
  "loja_mcp:diagnostico": {},
  "loja_mcp:descobrir": { consulta: "context7" },
};

function ipcFalso() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  return { ipc, handlers };
}

describe("contrato loja_mcp:*", () => {
  it("os validadores cobrem EXATAMENTE os canais do contrato; todos aceitam o payload válido", () => {
    const contrato = CANAIS_INVOKE.filter((c) => c.startsWith("loja_mcp:")).sort();
    expect(Object.keys(VALIDADORES_LOJA_MCP).sort()).toEqual(contrato);
    expect(Object.keys(VALIDOS).sort()).toEqual(contrato);
    for (const c of contrato) expect(v(c as Canal, VALIDOS[c as Canal]), c).toEqual(expect.objectContaining({ ok: true }));
    expect(CANAIS_EVENTO).toContain("loja_mcp:evento");
  });

  it("todo canal recusa campo extra e payload não-objeto (validador estrito)", () => {
    for (const c of Object.keys(VALIDOS) as Canal[]) {
      expect(v(c, { ...(VALIDOS[c] as object), extra: 1 }).ok, c).toBe(false);
      expect(v(c, "texto").ok, c).toBe(false);
      expect(v(c, null).ok, c).toBe(false);
    }
  });

  it("só variavel_gravar é sensível (o valor atravessa uma vez) e o log do registro não imprime o payload dele", async () => {
    expect(CANAIS_SENSIVEIS.filter((c) => c.startsWith("loja_mcp:"))).toEqual(["loja_mcp:variavel_gravar"]);
    const { ipc, handlers } = ipcFalso();
    const linhas: string[] = [];
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true, log: (l) => linhas.push(l), logarPayload: true });
    const servico = { gravarVariavel: vi.fn(async () => ({ ok: true, codigo: null })) } as unknown as ServicoLojaMcp;
    registrarIpcLojaMcp({ registro, servico: () => servico });
    await handlers.get("loja_mcp:variavel_gravar")!({}, { id: "context7", nome: "CONTEXT7_API_KEY", valor: "SENTINELA-no-log" });
    await expect(handlers.get("loja_mcp:variavel_gravar")!({}, { id: "context7", nome: "CONTEXT7_API_KEY", valor: "SENTINELA-no-log", extra: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(linhas.join("\n")).not.toContain("SENTINELA-no-log");
    expect(servico.gravarVariavel).toHaveBeenCalledWith("context7", "CONTEXT7_API_KEY", "SENTINELA-no-log");
  });
});

describe("validação campo a campo", () => {
  it("ids de servidor: só slug do catálogo (nunca caminho)", () => {
    for (const id of ["../etc", "A", "a b", "", "a".repeat(49), "-a", "a/b", "a;b"]) expect(v("loja_mcp:variaveis_estado", { id }).ok, id).toBe(false);
    expect(v("loja_mcp:variaveis_estado", { id: "sequential-thinking" }).ok).toBe(true);
  });

  it("consentimento: aceito precisa ser true; hash = 64 hex; no máximo 20 ids e 20 hashes", () => {
    const base = VALIDOS["loja_mcp:instalar"] as { ids: string[]; workspace_id: null };
    expect(v("loja_mcp:instalar", { ...base, consentimento: { aceito: false, comando_hashes: {} } }).ok).toBe(false);
    expect(v("loja_mcp:instalar", { ...base, consentimento: { aceito: "true", comando_hashes: {} } }).ok).toBe(false);
    expect(v("loja_mcp:instalar", { ...base, consentimento: { aceito: true, comando_hashes: { context7: "zz" } } }).ok).toBe(false);
    expect(v("loja_mcp:instalar", { ...base, consentimento: { aceito: true, comando_hashes: { "../x": H } } }).ok).toBe(false);
    expect(v("loja_mcp:instalar", { ...base, ids: Array.from({ length: 21 }, (_, i) => `s${i}`), consentimento: { aceito: true, comando_hashes: {} } }).ok).toBe(false);
    expect(v("loja_mcp:atualizar", { id: "a", consentimento: { aceito: true, comando_hash: "curto" }, workspace_id: null }).ok).toBe(false);
  });

  it("variável: nome UPPER_SNAKE, valor 1..8192 sem exigir nada do conteúdo (o serviço decide)", () => {
    const base = { id: "context7", nome: "CONTEXT7_API_KEY", valor: "x" };
    for (const nome of ["minha", "1X", "A", "X-Y", "../X"]) expect(v("loja_mcp:variavel_gravar", { ...base, nome }).ok, nome).toBe(false);
    expect(v("loja_mcp:variavel_gravar", { ...base, valor: "" }).ok).toBe(false);
    expect(v("loja_mcp:variavel_gravar", { ...base, valor: "x".repeat(8193) }).ok).toBe(false);
    expect(v("loja_mcp:variavel_gravar", { ...base, valor: 5 }).ok).toBe(false);
  });

  it("habilitar/CLI/logs/workspace: enums fechados e alvo sem caminho", () => {
    const hab = VALIDOS["loja_mcp:habilitar"] as object;
    expect(v("loja_mcp:habilitar", { ...hab, alvo_tipo: "global" }).ok).toBe(false);
    expect(v("loja_mcp:habilitar", { ...hab, alvo_valor: "/etc/passwd" }).ok).toBe(false);
    expect(v("loja_mcp:habilitar", { ...hab, alvo_valor: "meusquad.explorador" }).ok).toBe(true);
    expect(v("loja_mcp:previa_cli_usuario", { id: "a", cli: "bash", workspace_id: null }).ok).toBe(false);
    expect(v("loja_mcp:logs", { id: "a", limite: 0 }).ok).toBe(false);
    expect(v("loja_mcp:logs", { id: "a", limite: 201 }).ok).toBe(false);
    expect(v("loja_mcp:habilitacoes", { workspace_id: "../x" }).ok).toBe(false);
    expect(v("loja_mcp:detalhe", { id: "a", workspace_id: "ws_" }).ok).toBe(false);
    expect(v("loja_mcp:cancelar", { instalacao_id: "../x" }).ok).toBe(false);
  });
});

describe("descobrir (T-07B.32)", () => {
  it("consulta de 2 a 100 caracteres; nada além da consulta atravessa (nem URL nem caminho)", () => {
    expect(v("loja_mcp:descobrir", { consulta: "a" }).ok).toBe(false);
    expect(v("loja_mcp:descobrir", { consulta: "x".repeat(101) }).ok).toBe(false);
    expect(v("loja_mcp:descobrir", { consulta: 5 }).ok).toBe(false);
    expect(v("loja_mcp:descobrir", { consulta: "ok", url: "https://x" }).ok).toBe(false);
    expect(v("loja_mcp:descobrir", { consulta: "banco de dados" }).ok).toBe(true);
  });
  it("erro nominal da descoberta passa com texto próprio; qualquer outro vira genérico", async () => {
    class ErroDescoberta extends Error { override name = "ErroDescoberta"; constructor(readonly codigo: string, m: string) { super(m); } }
    const m = criarManipuladoresLojaMcp(() => ({ descobrir: async () => { throw new ErroDescoberta("rede_indisponivel", "Sem rede para consultar o Registro Oficial."); } }) as unknown as ServicoLojaMcp);
    await expect(m["loja_mcp:descobrir"]({ consulta: "docs" })).rejects.toThrow("Sem rede para consultar o Registro Oficial.");
    const g = criarManipuladoresLojaMcp(() => ({ descobrir: async () => { throw new Error("ECONNREFUSED 10.0.0.1"); } }) as unknown as ServicoLojaMcp);
    await expect(g["loja_mcp:descobrir"]({ consulta: "docs" })).rejects.toThrow("falha ao executar a operação da Loja de MCPs");
  });
});

describe("manipuladores", () => {
  it("registrar não carrega o serviço; o provedor só é chamado no primeiro uso", async () => {
    const { ipc, handlers } = ipcFalso();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    const provedor = vi.fn(() => ({ kitEstado: async () => ({ opt_out: false, itens: [], pendentes: [] }) }) as unknown as ServicoLojaMcp);
    registrarIpcLojaMcp({ registro, servico: provedor });
    expect(provedor).not.toHaveBeenCalled();
    expect(registro.registrados().sort()).toEqual(CANAIS_INVOKE.filter((c) => c.startsWith("loja_mcp:")).sort());
    await handlers.get("loja_mcp:kit_estado")!({}, {});
    expect(provedor).toHaveBeenCalledTimes(1);
  });

  it("remetente não autorizado é recusado em TODOS os canais antes de chegar ao serviço", async () => {
    const { ipc, handlers } = ipcFalso();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => false });
    const provedor = vi.fn();
    registrarIpcLojaMcp({ registro, servico: provedor as never });
    for (const c of Object.keys(VALIDOS)) await expect(handlers.get(c)!({}, VALIDOS[c as Canal]), c).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(provedor).not.toHaveBeenCalled();
  });

  it("erro inesperado vira texto genérico (sem caminho); erro nominal passa", async () => {
    const m = criarManipuladoresLojaMcp(() => ({ listar: async () => { throw new Error("ENOENT /Users/fulano/segredo"); }, kitEstado: async () => { throw new ErroLoja("catalogo_adulterado", "catálogo adulterado"); } }) as unknown as ServicoLojaMcp);
    await expect(m["loja_mcp:listar"]()).rejects.toThrow("falha ao executar a operação da Loja de MCPs");
    await expect(m["loja_mcp:kit_estado"]()).rejects.toThrow("catálogo adulterado");
    expect(sanearErroDaLoja(new Error("/x")).message).not.toContain("/x");
  });

  it("cada manipulador repassa os campos certos ao serviço", async () => {
    const chamadas: Array<[string, unknown[]]> = [];
    const proxy = new Proxy({}, { get: (_t, nome: string) => nome === "then" ? undefined : async (...args: unknown[]) => { chamadas.push([nome, args]); return null; } }) as unknown as ServicoLojaMcp;
    const m = criarManipuladoresLojaMcp(() => proxy);
    await m["loja_mcp:habilitar"]({ id: "a", alvo_tipo: "agente", alvo_valor: "s.m", habilitado: false });
    await m["loja_mcp:desinstalar"]({ id: "a", apagar_segredos: true });
    await m["loja_mcp:instalar_na_cli"]({ id: "a", cli: "claude", confirmacao: "ev_a", workspace_id: WS });
    await m["loja_mcp:logs"]({ id: "a", limite: 7 });
    expect(chamadas).toEqual([
      ["habilitar", ["a", "agente", "s.m", false]],
      ["desinstalar", ["a", true]],
      ["instalarNaCli", ["a", "claude", "ev_a", WS]],
      ["logs", ["a", 7]],
    ]);
  });
});
