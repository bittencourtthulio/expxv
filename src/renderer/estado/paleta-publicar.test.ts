import { afterEach, describe, expect, it, vi } from "vitest";
import { montarComandos, type ContextoPaleta } from "./paleta";
import { storePublicar } from "./vcs-publicar";

const acoes = { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() };
const ctx = (mac = false): ContextoPaleta => ({ mac, workspaceAtual: { id: "ws_AAAAAAAAAAAA", nome: "Meu app" }, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes });
const botao = (habilitado: boolean, rotulo: string) => ({ visivel: true, habilitado, rotulo, tooltip: `tip ${rotulo}`, badge: null });

afterEach(() => storePublicar.definirBotoes(null));

describe("paleta ⌘K: Commit e push / Enviar PR (D-638)", () => {
  it("sem os botões visíveis (outra tela, sem GitHub): nenhum comando", () => {
    storePublicar.definirBotoes(null);
    expect(montarComandos(ctx()).some((c) => c.id.startsWith("publicar:"))).toBe(false);
  });
  it("com os botões habilitados: 'Commit e push…' e 'Enviar PR…' com atalho e chamam o store", () => {
    storePublicar.definirBotoes({ commit: botao(true, "Commit e push"), pr: botao(true, "Enviar PR"), atualizar: botao(false, "Atualizar") });
    const abrir = vi.spyOn(storePublicar, "abrir").mockResolvedValue();
    const por = Object.fromEntries(montarComandos(ctx(true)).filter((c) => c.id.startsWith("publicar:")).map((c) => [c.id, c]));
    expect(por["publicar:commit-push"]).toMatchObject({ titulo: "Commit e push…", grupo: "Versionamento", atalho: "⌘⇧U" });
    expect(por["publicar:pr"]).toMatchObject({ titulo: "Enviar PR…", grupo: "Versionamento", atalho: "⌘⇧Y" });
    expect(montarComandos(ctx(false)).find((c) => c.id === "publicar:pr")?.atalho).toBe("Ctrl+Shift+Y");
    por["publicar:commit-push"]!.executar();
    por["publicar:pr"]!.executar();
    expect(abrir.mock.calls).toEqual([["commit_push"], ["pr"]]);
    abrir.mockRestore();
  });
  it("botão desabilitado não vira comando; 'Enviar commits' usa o rótulo do botão", () => {
    storePublicar.definirBotoes({ commit: botao(true, "Enviar commits"), pr: botao(false, "Enviar PR"), atualizar: botao(false, "Atualizar") });
    const ids = montarComandos(ctx()).filter((c) => c.id.startsWith("publicar:"));
    expect(ids.map((c) => c.titulo)).toEqual(["Enviar commits…"]);
  });
});

describe("paleta ⌘K: Atualizar (pull) e pastas da suíte (D-692/D-693)", () => {
  it("'Atualizar (pull)' aparece com o botão habilitado, no grupo Versionamento, e abre o diálogo", () => {
    storePublicar.definirBotoes({ commit: botao(false, "Commit e push"), pr: botao(false, "Enviar PR"), atualizar: botao(true, "Atualizar") });
    const abrir = vi.spyOn(storePublicar, "abrirAtualizar").mockResolvedValue();
    const c = montarComandos(ctx()).find((x) => x.id === "publicar:atualizar");
    expect(c).toMatchObject({ titulo: "Atualizar (pull)", grupo: "Versionamento", detalhe: "tip Atualizar" });
    c!.executar();
    expect(abrir).toHaveBeenCalledOnce();
    abrir.mockRestore();
  });
  it("Atualizar desabilitado ('Já está atualizado') não vira comando", () => {
    storePublicar.definirBotoes({ commit: botao(false, "Commit e push"), pr: botao(false, "Enviar PR"), atualizar: botao(false, "Atualizar") });
    expect(montarComandos(ctx()).some((x) => x.id === "publicar:atualizar")).toBe(false);
  });
  it("só sobrou a suíte: comando 'Pastas da suíte: ignorar ou incluir…' abre o diálogo de commit", () => {
    storePublicar.definirBotoes({ commit: { ...botao(false, "Commit e push"), abreMesmoDesabilitado: true }, pr: botao(false, "Enviar PR"), atualizar: botao(false, "Atualizar") });
    const abrir = vi.spyOn(storePublicar, "abrir").mockResolvedValue();
    const c = montarComandos(ctx()).find((x) => x.id === "publicar:suite");
    expect(c?.titulo).toBe("Pastas da suíte: ignorar ou incluir…");
    c!.executar();
    expect(abrir).toHaveBeenCalledWith("commit_push");
    abrir.mockRestore();
  });
});
