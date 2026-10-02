// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarStoreFalso, estadoSuite, progresso } from "../estado/suite-fixtures";
import { BotaoInstalarSuite } from "./BotaoInstalarSuite";
import { LinhaSuite } from "./LinhaSuite";

afterEach(() => cleanup());

async function montar(inicial = estadoSuite("ausente")) {
  const m = criarStoreFalso(inicial);
  render(<BotaoInstalarSuite store={m.store} />);
  await act(async () => { await Promise.resolve(); });
  return m;
}

describe("botão 'Instalar suíte ExpxDev' no cabeçalho", () => {
  it("suíte ausente: botão em destaque com ícone e texto, nome acessível e tooltip", async () => {
    await montar();
    const b = await screen.findByRole("button", { name: "Instalar suíte ExpxDev" });
    expect(b.className).toContain("topo-suite");
    expect(b.getAttribute("data-tom")).toBe("primario");
    expect(b.getAttribute("title")).toMatch(/não tem a suíte ExpxDev/);
    expect(b.textContent).toContain("Instalar suíte ExpxDev");
    expect(b.querySelector("svg")).not.toBeNull();
    expect(b.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("não rouba foco ao aparecer", async () => {
    const antes = document.createElement("input");
    document.body.appendChild(antes);
    antes.focus();
    await montar();
    await screen.findByRole("button", { name: "Instalar suíte ExpxDev" });
    expect(document.activeElement).toBe(antes);
    antes.remove();
  });

  it("suíte completa ou sem workspace: nenhum botão", async () => {
    await montar(estadoSuite("completa"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /suíte ExpxDev/ })).toBeNull());
  });

  it("some assim que a suíte fica completa (evento de estado do main)", async () => {
    const m = await montar();
    await screen.findByRole("button", { name: "Instalar suíte ExpxDev" });
    act(() => m.emitir({ tipo: "estado", estado: estadoSuite("completa") }));
    expect(screen.queryByRole("button", { name: /suíte ExpxDev/ })).toBeNull();
  });

  it("incompleta vira 'Reparar suíte ExpxDev'; desatualizada vira 'Atualizar' discreto", async () => {
    const m = await montar(estadoSuite("incompleta"));
    expect(await screen.findByRole("button", { name: "Reparar suíte ExpxDev" })).toBeTruthy();
    act(() => m.emitir({ tipo: "estado", estado: estadoSuite("desatualizada") }));
    const b = screen.getByRole("button", { name: "Atualizar suíte ExpxDev" });
    expect(b.getAttribute("data-tom")).toBe("discreto");
  });

  it("dispensar ('Agora não') esconde o botão deste workspace", async () => {
    const m = await montar();
    fireEvent.click(await screen.findByRole("button", { name: "Instalar suíte ExpxDev" }));
    fireEvent.click(await screen.findByRole("button", { name: "Agora não" }));
    await waitFor(() => expect(m.api.dispensar).toHaveBeenCalledWith("ws_AAAAAAAAAAAA", true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Instalar suíte ExpxDev" })).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("instalando: botão com percentual, que reabre o progresso", async () => {
    const m = await montar(estadoSuite("ausente", { instalando: true, instalacao_id: "suite_1" }));
    act(() => m.emitir(progresso("rodando", { percentual: 42 })));
    const b = await screen.findByRole("button", { name: "Instalando… 42%" });
    expect(b.getAttribute("data-instalando")).toBe("true");
    fireEvent.click(b);
    expect(await screen.findByRole("progressbar")).toBeTruthy();
  });

  it("janela estreita: só o ícone (regra de container no CSS esconde o rótulo; o nome acessível fica)", () => {
    const css = readFileSync(join(__dirname, "suite.css"), "utf8");
    expect(css).toMatch(/@container \(max-width: \d+px\) \{[^}]*\.topo-suite-rotulo \{ display: none; \}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it("clicar abre o modal com os requisitos e NÃO instala sozinho", async () => {
    const m = await montar();
    fireEvent.click(await screen.findByRole("button", { name: "Instalar suíte ExpxDev" }));
    expect(await screen.findByRole("dialog", { name: "Instalar a suíte ExpxDev" })).toBeTruthy();
    expect(m.api.instalar).not.toHaveBeenCalled();
  });
});

describe("linha de ação no card do workspace", () => {
  it("aparece quando a suíte falta e abre o modal pelo cabeçalho; some quando completa", async () => {
    const m = criarStoreFalso(estadoSuite("ausente"));
    render(<><LinhaSuite workspaceId="ws_AAAAAAAAAAAA" atual store={m.store} /><BotaoInstalarSuite store={m.store} /></>);
    const linha = await screen.findAllByRole("button", { name: /Instalar suíte ExpxDev/ });
    expect(linha.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(linha.find((b) => b.className.includes("linha-suite-botao"))!);
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
    act(() => m.emitir({ tipo: "estado", estado: estadoSuite("completa") }));
    expect(screen.queryByRole("button", { name: /Instalar suíte ExpxDev/ })).toBeNull();
  });

  it("card de outro workspace: pede a troca e só abre o modal quando a troca chegar", async () => {
    const m = criarStoreFalso(estadoSuite("ausente", { workspace_id: "ws_BBBBBBBBBBBB" }));
    let trocou = 0;
    render(<LinhaSuite workspaceId="ws_BBBBBBBBBBBB" atual={false} aoAtivar={() => { trocou += 1; }} store={m.store} />);
    m.emitir({ tipo: "estado", estado: estadoSuite("ausente", { workspace_id: "ws_BBBBBBBBBBBB" }) });
    fireEvent.click(await screen.findByRole("button", { name: /Instalar suíte ExpxDev/ }));
    expect(trocou).toBe(1);
    expect(m.store.obter().modal).toBe(false);
  });
});
