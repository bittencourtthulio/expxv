// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComandoSugerido, ResultadoDisparo } from "../../../compartilhado/dominio";
import { AcoesMetodo } from "./AcoesMetodo";
import { tk, trabalho } from "./fabrica";

function instalar(sug: ComandoSugerido, res: ResultadoDisparo = { ok: true, pane_id: "p1", comando: sug.comando, motivo: null }) {
  const comandoSugerido = vi.fn(async () => sug);
  const disparar = vi.fn(async () => res);
  (globalThis as unknown as { ade: unknown }).ade = { metodo: { comandoSugerido, disparar } };
  return { comandoSugerido, disparar };
}
afterEach(() => { delete (globalThis as { ade?: unknown }).ade; });

const t = trabalho([tk("T-1")]);

describe("AcoesMetodo", () => {
  it("mostra o comando exato e só dispara ao confirmar", async () => {
    const f = instalar({ comando: "/expx:sprintx minha-feature", pane_separado: false, somente_humano: false, motivo_bloqueio: null });
    render(<AcoesMetodo workspaceId="w1" trabalho={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(await screen.findByText("/expx:sprintx minha-feature")).toBeTruthy();
    expect(f.disparar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disparar no Pane" }));
    await waitFor(() => expect(f.disparar).toHaveBeenCalledWith({ workspace_id: "w1", trabalho_id: "minha-feature", gesto: "retomar", argumento: null, pane_id: null }));
    expect(await screen.findByText(/Enviado ao Pane p1/)).toBeTruthy();
  });

  it("avisa quando abre em Pane separado", async () => {
    instalar({ comando: "/expx:sprintx-auditoria minha-feature", pane_separado: true, somente_humano: false, motivo_bloqueio: null });
    render(<AcoesMetodo workspaceId="w1" trabalho={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Auditar" }));
    expect(await screen.findByText(/Abre em Pane separado/)).toBeTruthy();
  });

  it("ação somente humana nunca dispara: mostra motivo e caminho do arquivo", async () => {
    const f = instalar({ comando: "", pane_separado: false, somente_humano: true, motivo_bloqueio: "Revisão é humana." });
    render(<AcoesMetodo workspaceId="w1" trabalho={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir PR" }));
    expect(await screen.findByText(/Ação somente humana/)).toBeTruthy();
    expect(screen.getByText(/Revisão é humana/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disparar no Pane" })).toBeNull();
    expect(f.disparar).not.toHaveBeenCalled();
  });

  it("botões humanos do trabalho (assinatura do prodx, raio ALTO, revisão) levam ao arquivo sem chamar a API", () => {
    const f = instalar({ comando: "x", pane_separado: false, somente_humano: false, motivo_bloqueio: null });
    const h = trabalho([], {
      ferramenta: "prodx", pasta: "docs/prodx/pedidos/pd-1",
      prodx: { veredito: "fazer", assinado: false, briefing: false }, raio: { faixa: "ALTO", aprovado: false },
      entrega: { estado: null, branch: "b", portao: null, pr_url: null, pr_estado: null, commits: 1, arquivo: "docs/mergex/ENTREGA.md" },
    });
    render(<AcoesMetodo workspaceId="w1" trabalho={h} />);
    fireEvent.click(screen.getByRole("button", { name: "Assinatura do prodx" }));
    expect(screen.getByText("docs/prodx/pedidos/pd-1/VEREDITO.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aprovação de raio ALTO" }));
    expect(screen.getByText(/raio ALTO só avança/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /mergex-revisar/ }));
    expect(screen.getByText("docs/mergex/ENTREGA.md")).toBeTruthy();
    expect(f.comandoSugerido).not.toHaveBeenCalled();
    expect(f.disparar).not.toHaveBeenCalled();
  });

  it("Pane aguardando não recebe reenvio: mensagem clara", async () => {
    instalar({ comando: "/expx:sprintx x", pane_separado: false, somente_humano: false, motivo_bloqueio: null }, { ok: false, pane_id: "p1", comando: null, motivo: "Pane aguardando resposta" });
    render(<AcoesMetodo workspaceId="w1" trabalho={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disparar no Pane" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/aguardando você.*não é reenviado/);
  });

  it("disparo bem-sucedido leva ao terminal (D-610); falha não navega", async () => {
    const { criarStoreExecucaoMetodo } = await import("../../estado/execucao-metodo");
    const ir = vi.fn();
    const ex = criarStoreExecucaoMetodo({ irParaSessao: ir, irParaTerminais: ir, config: () => undefined, armazem: () => undefined });
    instalar({ comando: "/expx:sprintx x", pane_separado: false, somente_humano: false, motivo_bloqueio: null }, { ok: true, pane_id: "p1", comando: "/expx:sprintx x", motivo: null, sessao_id: "s9" });
    render(<AcoesMetodo workspaceId="w1" trabalho={t} execucao={ex} />);
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disparar no Pane" }));
    await waitFor(() => expect(ir).toHaveBeenCalledWith("s9"));
  });
});
