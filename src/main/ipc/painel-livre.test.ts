// Canais `painel_livre:*` (D-420): validadores estritos, manipuladores e erro saneado (sem caminho de máquina nem token).
import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { criarRegistroIpc, type IpcMainLike } from "./registro";
import { registrarIpcPainelLivre, VALIDADORES_PAINEL_LIVRE } from "./painel-livre";
import { ErroPainelLivre, type PainelLivre } from "../painel-livre";

const WS = "ws_01HZZZZZZZZZZZZZ";

describe("validadores de painel_livre:*", () => {
  const V = VALIDADORES_PAINEL_LIVRE;
  it("todos os canais da família estão no contrato", () => {
    for (const c of Object.keys(V)) expect(CANAIS_INVOKE).toContain(c);
    expect(CANAIS_INVOKE.filter((c) => c.startsWith("painel_livre:")).sort()).toEqual(Object.keys(V).sort());
  });
  it("preferencia: leitura (sem ativa) e gravação (booleano estrito); campo extra, texto e id fora do padrão são recusados", () => {
    expect(V["painel_livre:preferencia"]({ workspace_id: WS }).ok).toBe(true);
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, ativa: true }).ok).toBe(true);
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, ativa: "sim" }).ok).toBe(false);
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, ativa: true, cwd: "/etc" }).ok).toBe(false);
    expect(V["painel_livre:preferencia"]({ workspace_id: "../../x" }).ok).toBe(false);
  });
  it("preferencia: fechar_workers é booleano estrito (D-520)", () => {
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, fechar_workers: false }).ok).toBe(true);
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, fechar_workers: "nao" }).ok).toBe(false);
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, fechar_workers: 0 }).ok).toBe(false);
  });

  it("preferencia: orquestrador_edita é booleano estrito (opt-out do workspace, D-512)", () => {
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, orquestrador_edita: true }).ok).toBe(true);
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, ativa: true, orquestrador_edita: false }).ok).toBe(true);
    expect(V["painel_livre:preferencia"]({ workspace_id: WS, orquestrador_edita: "sim" }).ok).toBe(false);
  });
  it("aprovacao (D-640): workspace ou null (global); nível só do enum; confirmação curta; campo extra, cwd e nível inventado são recusados", () => {
    const a = V["painel_livre:aprovacao"];
    expect(a({ workspace_id: null }).ok).toBe(true);
    expect(a({ workspace_id: WS }).ok).toBe(true);
    for (const nivel of ["perguntar", "automatico_seguro", "total"]) expect(a({ workspace_id: WS, nivel }).ok).toBe(true);
    expect(a({ workspace_id: WS, nivel: "total", confirmacao: "liberar tudo" }).ok).toBe(true);
    expect(a({ workspace_id: WS, permitir_raiz: true, confiavel: false, herdar: true }).ok).toBe(true);
    expect(a({ workspace_id: WS, nivel: "bypass" }).ok).toBe(false);
    expect(a({ workspace_id: WS, nivel: "total", confirmacao: "x".repeat(41) }).ok).toBe(false);
    expect(a({ workspace_id: WS, permitir_raiz: "sim" }).ok).toBe(false);
    expect(a({ workspace_id: WS, cwd: "/" }).ok).toBe(false);
    expect(a({ workspace_id: "../x" }).ok).toBe(false);
    expect(a({}).ok).toBe(false);
    expect(V["painel_livre:aprovacao_pane"]({ pane_id: "pane_01HZZZZZZZZZZZZZ" }).ok).toBe(true);
    expect(V["painel_livre:aprovacao_pane"]({ pane_id: "/etc/passwd" }).ok).toBe(false);
  });
  it("ponte_grok: só as três ações; nunca caminho nem conteúdo vindos do renderer (D-514)", () => {
    for (const acao of ["estado", "aplicar", "remover"]) expect(V["painel_livre:ponte_grok"]({ workspace_id: WS, acao }).ok).toBe(true);
    expect(V["painel_livre:ponte_grok"]({ workspace_id: WS, acao: "editar" }).ok).toBe(false);
    expect(V["painel_livre:ponte_grok"]({ workspace_id: WS, acao: "aplicar", conteudo: "x" }).ok).toBe(false);
    expect(V["painel_livre:ponte_grok"]({ workspace_id: WS, acao: "aplicar", arquivo: "/etc/passwd" }).ok).toBe(false);
    expect(V["painel_livre:ponte_grok"]({ workspace_id: WS }).ok).toBe(false);
  });
  it("abrir: ferramenta é um id simples; nunca caminho, executável ou cwd vindos do renderer", () => {
    expect(V["painel_livre:abrir"]({ workspace_id: WS, ferramenta_id: "claude", orquestrar: true }).ok).toBe(true);
    expect(V["painel_livre:abrir"]({ workspace_id: WS, ferramenta_id: "/bin/sh", orquestrar: true }).ok).toBe(false);
    expect(V["painel_livre:abrir"]({ workspace_id: WS, ferramenta_id: "claude", orquestrar: true, cwd: "/" }).ok).toBe(false);
    expect(V["painel_livre:abrir"]({ workspace_id: WS, ferramenta_id: "claude" }).ok).toBe(false);
  });
  it("orquestrar: sessão no formato do app e `ligar` booleano", () => {
    expect(V["painel_livre:orquestrar"]({ workspace_id: WS, sessao_id: "sessao_abc-123", ligar: false }).ok).toBe(true);
    expect(V["painel_livre:orquestrar"]({ workspace_id: WS, sessao_id: "x", ligar: true }).ok).toBe(false);
    expect(V["painel_livre:orquestrar"]({ workspace_id: WS, sessao_id: "sessao_abc-123", ligar: 1 }).ok).toBe(false);
  });
});

describe("registro e erro saneado", () => {
  function montar(painel: PainelLivre, autorizado = true) {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: (c) => void handlers.delete(c), removeAllListeners: () => undefined };
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => autorizado });
    registrarIpcPainelLivre({ registro, painel });
    return handlers;
  }
  const painelFalso = (sobre: Partial<PainelLivre> = {}): PainelLivre => ({
    preferencia: ({ workspace_id, ativa, orquestrador_edita, fechar_workers }) => ({ workspace_id, ativa: ativa ?? false, orquestrador_edita: orquestrador_edita ?? false, fechar_workers: fechar_workers ?? true }),
    ponteGrok: () => ({ estado: "ausente", arquivo: ".grok/config.toml", conteudo: "x", detalhe: "" }),
    aprovacao: (p) => ({ workspace_id: p.workspace_id, nivel: p.nivel ?? "automatico_seguro", proprio: p.nivel !== undefined, permitir_raiz: false, confiavel: true, padrao_global: "automatico_seguro" }),
    aprovacaoDoPane: () => null,
    abrir: async () => ({ sessao_id: "sessao_1", pane_id: "pane_1", missao_id: "mis_1", orquestrando: true, aviso: null }),
    orquestrar: async () => ({ sessao_id: "sessao_2", pane_id: "pane_2", missao_id: "mis_2", orquestrando: true, retomado: true, aviso: null }),
    ...sobre,
  });

  it("registra os 6 canais e repassa entrada validada", async () => {
    const h = montar(painelFalso());
    expect([...h.keys()].sort()).toEqual(["painel_livre:abrir", "painel_livre:aprovacao", "painel_livre:aprovacao_pane", "painel_livre:orquestrar", "painel_livre:ponte_grok", "painel_livre:preferencia"]);
    const evento = { senderFrame: undefined } as never;
    await expect(h.get("painel_livre:preferencia")?.(evento, { workspace_id: WS, ativa: true })).resolves.toEqual({ workspace_id: WS, ativa: true, orquestrador_edita: false, fechar_workers: true });
  });

  it("erro nominal passa com a mensagem; erro de infraestrutura vira texto genérico sem caminho", async () => {
    const nominal = montar(painelFalso({ orquestrar: async () => { throw new ErroPainelLivre("preferencia_desligada", "Permita primeiro."); } }));
    await expect(nominal.get("painel_livre:orquestrar")?.({} as never, { workspace_id: WS, sessao_id: "sessao_a1", ligar: true })).rejects.toThrow("Permita primeiro.");
    const infra = montar(painelFalso({ abrir: async () => { throw new Error("ENOENT: /Users/fulano/segredo/token"); } }));
    const erro = await (infra.get("painel_livre:abrir")?.({} as never, { workspace_id: WS, ferramenta_id: "claude", orquestrar: true }) as Promise<unknown>).catch((e: Error) => e);
    expect(String((erro as Error).message)).not.toContain("/Users");
    expect(String((erro as Error).message)).not.toContain("token");
  });
});
