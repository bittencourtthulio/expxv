// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PrResumo } from "../../../nucleo/forge/forge";
import { CartaoPrsInicio } from "./CartaoPrsInicio";

const pr = (o: Partial<PrResumo> = {}): PrResumo => ({ numero: 7, titulo: "Login novo", estado: "aberto", rascunho: false, autor: "ana", ramoOrigem: "feature/login", ramoDestino: "main", url: "https://github.com/a/b/pull/7", criadoEm: "", atualizadoEm: "", labels: [], revisao: "nenhuma", checks: { total: 3, sucesso: 1, falha: 2, pendente: 0 }, ...o });

function montar(o: { ligado?: boolean; prs?: PrResumo[]; erro?: string; ws?: string | null } = {}) {
  const forge = vi.fn(async (_a: unknown, op: string) => {
    if (o.erro !== undefined) throw new Error(o.erro);
    if (op === "estado") return { forge: { provedor: "github", autenticado: true, degradado: false, repo: { host: "github.com", caminho: "a/b" }, cli: { nome: "gh", instalada: true, versao: "2" }, contas: [], instrucao: null }, provedor: "github" };
    return { itens: o.prs ?? [pr()], truncado: false };
  });
  const config = { ler: vi.fn(async () => (o.ligado ? true : undefined)), gravar: vi.fn(async () => ({ ok: true as const })) };
  render(<CartaoPrsInicio api={{ forge } as never} config={config as never} workspaceId={o.ws === undefined ? "ws1" : o.ws} />);
  return { forge, config };
}

describe("Início: card de PRs e checks (opt-in, sem rede automática)", () => {
  it("desligado por padrão: explica, não chama o forge nem ao montar", async () => {
    const { forge } = montar();
    expect(await screen.findByText(/só consulta o provedor quando você pedir/i)).toBeTruthy();
    expect(forge).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Atualizar PRs" })).toBeNull();
  });
  it("ligar grava a preferência mas ainda não consulta; só o clique em Atualizar vai à rede", async () => {
    const { forge, config } = montar();
    await act(async () => { fireEvent.click(await screen.findByRole("checkbox", { name: /Mostrar PRs/ })); });
    expect(config.gravar).toHaveBeenCalledWith("vcs_pr_inicio", true);
    expect(forge).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Atualizar PRs" })); });
    await waitFor(() => expect(forge).toHaveBeenCalledWith({ workspace_id: "ws1", mission_id: null }, "prs_listar", { estado: "aberto", limite: 30 }));
  });
  it("ligado: montar também NÃO consulta; checks falhando deixam o PR amarelo com o motivo em texto", async () => {
    const { forge } = montar({ ligado: true });
    await screen.findByRole("button", { name: "Atualizar PRs" });
    expect(forge).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Atualizar PRs" })); });
    expect(await screen.findByText("Login novo")).toBeTruthy();
    expect(screen.getByText("2 checks falhando no PR #7")).toBeTruthy();
    expect(screen.getByText("#7").closest("li")?.getAttribute("data-sinaleira")).toBe("amarela");
  });
  it("PR sem falha: verde; sem PR: mensagem; erro do forge aparece sem derrubar o Início", async () => {
    montar({ ligado: true, prs: [pr({ checks: { total: 2, sucesso: 2, falha: 0, pendente: 0 } })] });
    const botao = await screen.findByRole("button", { name: "Atualizar PRs" });
    await act(async () => { fireEvent.click(botao); });
    await waitFor(() => expect(screen.getByText("#7").closest("li")?.getAttribute("data-sinaleira")).toBe("verde"));
  });
  it("sem PR aberto e com erro", async () => {
    montar({ ligado: true, prs: [] });
    const botao = await screen.findByRole("button", { name: "Atualizar PRs" });
    await act(async () => { fireEvent.click(botao); });
    expect(await screen.findByText("Nenhum PR aberto.")).toBeTruthy();
  });
  it("erro do provedor é mostrado", async () => {
    montar({ ligado: true, erro: "Sem autenticação em github." });
    const botao = await screen.findByRole("button", { name: "Atualizar PRs" });
    await act(async () => { fireEvent.click(botao); });
    expect((await screen.findByRole("alert")).textContent).toContain("Sem autenticação");
  });
  it("sem workspace: não renderiza", () => {
    montar({ ws: null });
    expect(screen.queryByLabelText("Pull requests")).toBeNull();
  });
});
