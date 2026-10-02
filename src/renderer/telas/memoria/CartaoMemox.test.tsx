// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instalar, remover } from "../../a11y/ade-falso";
import type { EstadoTerminais, SessaoUI, StoreTerminais } from "../../estado/terminais";
import { CartaoMemox, COMANDO_REINDEXAR, comandoBuscar } from "./CartaoMemox";

const sessao = (n: number, ferramenta: string, estado: SessaoUI["estado"] = "executando"): SessaoUI => ({ sessao_id: `s${n}`, ferramenta_id: ferramenta as never, numero: n, estado, mensagem: null, codigo_saida: null });
const loja = (sessoes: SessaoUI[]): StoreTerminais => {
  const estado = { sessoes } as unknown as EstadoTerminais;
  return { obter: () => estado, assinar: () => () => undefined } as unknown as StoreTerminais;
};
const escrever = vi.fn();
beforeEach(() => { instalar(); (globalThis as unknown as { ade: { terminais: unknown } }).ade.terminais = { escrever }; escrever.mockReset(); });
afterEach(() => { cleanup(); remover(); });

describe("cartão Memória do método (memox)", () => {
  it("Reindexar DIGITA o comando do método no painel escolhido (nunca roda memox.py)", async () => {
    render(<CartaoMemox memox={{ instalado: true, texto: "12 arquivos" }} terminais={loja([sessao(1, "codex"), sessao(2, "claude"), sessao(3, "opencode", "encerrada")])} />);
    expect(screen.getByRole("option", { name: "#2 · claude" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /#1|#3/ })).toBeNull(); // só CLI do método e em execução
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reindexar" })); });
    expect(escrever).toHaveBeenCalledTimes(1);
    expect(escrever).toHaveBeenCalledWith("s2", `${COMANDO_REINDEXAR}\r`);
    expect(COMANDO_REINDEXAR).toBe("/expx:memox-indexar");
  });

  it("buscar digita /expx:memox-buscar <termo> numa linha só", async () => {
    render(<CartaoMemox memox={{ instalado: true, texto: null }} terminais={loja([sessao(2, "claude")])} />);
    fireEvent.change(screen.getByLabelText("Buscar no memox"), { target: { value: "login do usuário" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Buscar" })); });
    expect(escrever).toHaveBeenCalledWith("s2", "/expx:memox-buscar login do usuário\r");
    expect(comandoBuscar(" a\r\nb ")).toBe("/expx:memox-buscar a b");
  });

  it("sem painel com a CLI do método, os botões ficam desabilitados e o cartão explica", () => {
    render(<CartaoMemox memox={{ instalado: true, texto: "ok" }} terminais={loja([sessao(1, "codex")])} />);
    expect((screen.getByRole("button", { name: "Reindexar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Abra um terminal com Claude Code ou OpenCode/)).toBeTruthy();
  });

  it("sem memox explica como instalar e não oferece botões", () => {
    render(<CartaoMemox memox={{ instalado: false, texto: null }} terminais={loja([sessao(2, "claude")])} />);
    expect(screen.getByText(/expxdev add memox/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reindexar" })).toBeNull();
    expect(escrever).not.toHaveBeenCalled();
  });
});
