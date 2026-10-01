// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Mission } from "../../../compartilhado/dominio";
import { criarStoreProvedores } from "../../estado/provedores";
import { CriarMissao } from "./Criar";

const rec = { prompt_inicial: true, retomar: true, mcp: true, hook: true };
const f = (id: string, nome: string, instalado = true) => ({ ferramenta: { id, nome, descricao: "", instalado, executavel_id: instalado ? "e" : null, modo_lancamento: null, erro_codigo: null, versao: "1", recursos: rec }, contas: [] }) as never;

async function montar() {
  const api = { listar: vi.fn().mockResolvedValue([f("claude", "Claude Code"), f("codex", "Codex"), f("aider", "Aider", false), f("terminal", "Terminal")]), criarConta: vi.fn(), habilitarConta: vi.fn(), diagnostico: vi.fn() };
  const provedores = criarStoreProvedores({ api: () => api });
  await provedores.carregar();
  const criar = vi.fn().mockResolvedValue({ id: "m1" } as Mission);
  const aoCriada = vi.fn();
  render(<CriarMissao workspaceId="w1" criar={criar} aoFechar={() => undefined} aoCriada={aoCriada} provedores={provedores} />);
  return { criar, aoCriada };
}
const enviar = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar missão" })); }); };

describe("Wizard de missão", () => {
  it("enviar vazio mostra validações e não chama criar", async () => {
    const { criar } = await montar();
    await enviar();
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
    expect(criar).not.toHaveBeenCalled();
  });
  it("só oferece CLIs instaladas (sem ausentes nem terminal puro)", async () => {
    await montar();
    const opcoes = [...screen.getByLabelText(/^CLI/).querySelectorAll("option")].map((o) => o.textContent);
    expect(opcoes).toContain("Claude Code");
    expect(opcoes).toContain("Codex");
    expect(opcoes).not.toContain("Aider");
    expect(opcoes).not.toContain("Terminal");
  });
  it("squad sem piloto é recusado; com cadeado uma escolha preenche todos os papéis", async () => {
    const { criar, aoCriada } = await montar();
    fireEvent.click(screen.getByLabelText(/Squad/));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Minha missão" } });
    fireEvent.change(screen.getByLabelText("Pedido"), { target: { value: "Faça X" } });
    await enviar();
    expect(screen.getByText(/exigem um piloto/)).toBeTruthy();
    expect(criar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Cadeado/ }));
    fireEvent.change(screen.getByLabelText(/Revisor/), { target: { value: "codex" } });
    for (const papel of [/Piloto/, /Executor/, /Explorador/, /Revisor/]) expect((screen.getByLabelText(papel) as HTMLSelectElement).value).toBe("codex");
    await enviar();
    expect(criar).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "w1", modo: "squad", titulo: "Minha missão", clis: { piloto: "codex", executor: "codex", explorador: "codex", revisor: "codex" } }));
    expect(aoCriada).toHaveBeenCalled();
  });
  it("falha do main aparece no diálogo sem fechar", async () => {
    const { criar } = await montar();
    criar.mockRejectedValue(new Error("já existe missão nesta árvore"));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/^CLI/), { target: { value: "claude" } });
    await enviar();
    expect(screen.getByText(/já existe missão nesta árvore/)).toBeTruthy();
  });
});
