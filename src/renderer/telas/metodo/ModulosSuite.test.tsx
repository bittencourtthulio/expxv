// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PADRAO_DE_FABRICA } from "../../../nucleo/suite/modulos";
import { WS, criarStoreFalso, estadoSuite } from "../../estado/suite-fixtures";
import { SecaoModulosPadrao } from "../config/SecaoModulosPadrao";
import { Pedido } from "./Pedido";
import { ModulosSuite, selosDoModulo } from "./ModulosSuite";

afterEach(() => cleanup());

async function montar() {
  const m = criarStoreFalso(estadoSuite("completa"));
  render(<ModulosSuite workspaceId={WS} store={m.store} />);
  await screen.findByRole("list", { name: "Módulos" });
  return m;
}
const chave = (nome: string): HTMLElement => screen.getByRole("switch", { name: nome });

describe("seção 'Módulos da suíte' (Método)", () => {
  it("lista os nove módulos com nome, descrição de uma linha e interruptor (role=switch) rotulado; legadox desligado com selo 'padrão: desligado'", async () => {
    await montar();
    const itens = screen.getByRole("list", { name: "Módulos" }).querySelectorAll("li");
    expect(itens).toHaveLength(9);
    const nomes = screen.getAllByRole("switch").map((s) => s.getAttribute("aria-labelledby"));
    expect(nomes.every((n) => n !== null && document.getElementById(n) !== null)).toBe(true);
    for (const s of screen.getAllByRole("switch")) {
      expect(s.getAttribute("aria-describedby")).not.toBeNull();
      expect(["true", "false"]).toContain(s.getAttribute("aria-checked"));
    }
    expect(chave("legadox").getAttribute("aria-checked")).toBe("false");
    expect(chave("sprintx").getAttribute("aria-checked")).toBe("true");
    const leg = itens[2]!;
    expect(leg.textContent).toMatch(/padrão: desligado/);
    expect(screen.getByText(/8 de 9 ligados|ligados/).textContent).toMatch(/8 de 9 ligados/);
  });

  it("selos de dependência: exige / recomenda / usado por", async () => {
    const m = criarStoreFalso(estadoSuite("completa"));
    const e = await m.api.modulosEstado();
    const buildx = e.modulos.find((x) => x.id === "buildx")!;
    expect(selosDoModulo(buildx)).toEqual(["exige sprintx e prodx e mergex", "recomenda stackx"]);
    expect(selosDoModulo(e.modulos.find((x) => x.id === "sprintx")!)).toEqual(["usado por legadox, stackx, memox, prodx, buildx, designx"]);
    expect(selosDoModulo(e.modulos.find((x) => x.id === "legadox")!)).toEqual(["padrão: desligado", "exige sprintx ou runx"]);
  });

  it("ligar o legadox (sem dependências) muda na hora; é a única chamada ao main, sem confirmação", async () => {
    const m = await montar();
    fireEvent.click(chave("legadox"));
    await waitFor(() => expect(chave("legadox").getAttribute("aria-checked")).toBe("true"));
    expect(m.api.modulosDefinir).toHaveBeenCalledWith(WS, "legadox", true, false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("desligar o sprintx NÃO desliga o buildx sozinho: pede confirmação com a lista; cancelar não muda nada", async () => {
    const m = await montar();
    fireEvent.click(chave("sprintx"));
    const conf = await screen.findByRole("alertdialog", { name: "Desligar também os dependentes?" });
    expect(conf.textContent).toMatch(/Desligar sprintx também desliga buildx/);
    expect(conf.textContent).toMatch(/não desliga nada em cascata sem a sua confirmação/);
    expect(chave("sprintx").getAttribute("aria-checked")).toBe("true");
    expect(chave("buildx").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(conf).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(chave("sprintx").getAttribute("aria-checked")).toBe("true");
    expect(m.api.modulosDefinir).toHaveBeenCalledTimes(1);
  });

  it("confirmar desliga o módulo e os dependentes (segunda chamada com confirmar_cascata)", async () => {
    const m = await montar();
    fireEvent.click(chave("sprintx"));
    fireEvent.click(await screen.findByRole("button", { name: "Desligar também os dependentes" }));
    await waitFor(() => expect(chave("sprintx").getAttribute("aria-checked")).toBe("false"));
    expect(chave("buildx").getAttribute("aria-checked")).toBe("false");
    expect(m.api.modulosDefinir).toHaveBeenLastCalledWith(WS, "sprintx", false, true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("ligar um módulo que exige outro desligado oferece ligar o requisito", async () => {
    const m = await montar();
    m.definirModulos({ ...PADRAO_DE_FABRICA, buildx: false, prodx: false });
    await act(async () => { await m.store.garantirModulos(WS, true); });
    fireEvent.click(chave("buildx"));
    const conf = await screen.findByRole("alertdialog", { name: "Ligar também os requisitos?" });
    expect(conf.textContent).toMatch(/Para ligar buildx, o app liga também prodx/);
    fireEvent.click(within(conf).getByRole("button", { name: "Ligar também os requisitos" }));
    await waitFor(() => expect(chave("prodx").getAttribute("aria-checked")).toBe("true"));
    expect(chave("buildx").getAttribute("aria-checked")).toBe("true");
  });

  it("Restaurar padrões volta ao padrão global", async () => {
    const m = await montar();
    fireEvent.click(chave("legadox"));
    await waitFor(() => expect(chave("legadox").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrões" }));
    await waitFor(() => expect(chave("legadox").getAttribute("aria-checked")).toBe("false"));
    expect(m.api.modulosRestaurar).toHaveBeenCalledWith(WS);
  });

  it("mostra onde está guardado e o isolamento por CLI (Claude negado, demais 'parcial')", async () => {
    await montar();
    expect(screen.getByText(/Ainda não gravado: vale o padrão/)).toBeTruthy();
    const det = screen.getByText(/Como o “desligado” vale em cada CLI/).closest("details") as HTMLDetailsElement;
    expect(det.textContent).toMatch(/Claude Code.*negado ao modelo/);
    expect(det.textContent).toMatch(/Codex.*parcial.*esta CLI ainda enxerga a skill/);
    expect(det.textContent).toMatch(/OpenCode.*parcial/);
    expect(det.textContent).toMatch(/Gemini, Grok e outras.*parcial/);
  });

  it("teclado: o interruptor é um botão focável e Enter/Espaço o aciona", async () => {
    const m = await montar();
    const s = chave("legadox");
    s.focus();
    expect(document.activeElement).toBe(s);
    fireEvent.click(s); // Enter/Espaço em <button> disparam click
    await waitFor(() => expect(m.api.modulosDefinir).toHaveBeenCalled());
    expect(s.tagName).toBe("BUTTON");
    expect(s.getAttribute("role")).toBe("switch");
  });

  it("evento suite:modulos_mudou relê o estado (outra janela ou o arquivo foi editado)", async () => {
    const m = await montar();
    m.definirModulos({ ...PADRAO_DE_FABRICA, designx: false });
    m.api.modulosEstado.mockClear();
    act(() => m.emitirModulos({ workspace_id: WS }));
    await waitFor(() => expect(chave("designx").getAttribute("aria-checked")).toBe("false"));
    expect(m.api.modulosEstado).toHaveBeenCalled();
  });

  it("sem a suíte instalada, avisa que o ajuste vale para quando ela estiver", async () => {
    const m = criarStoreFalso(estadoSuite("ausente"));
    m.api.modulosEstado.mockResolvedValue({ ...(await m.api.modulosEstado()), suite_instalada: false });
    render(<ModulosSuite workspaceId={WS} store={m.store} />);
    expect((await screen.findByRole("note")).textContent).toMatch(/não está instalada.*vale para quando ela estiver/);
  });
});

describe("Configurações › Módulos padrão para projetos novos", () => {
  it("lista os nove, legadox desligado de fábrica; mudar grava o padrão global; restaurar volta à fábrica", async () => {
    const m = criarStoreFalso(estadoSuite("completa"));
    render(<SecaoModulosPadrao store={m.store} />);
    const lista = await screen.findByRole("list", { name: "Módulos padrão" });
    expect(lista.querySelectorAll("li")).toHaveLength(9);
    expect(screen.getByRole("switch", { name: "legadox" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("switch", { name: "legadox" }));
    await waitFor(() => expect(m.api.modulosPadraoDefinir).toHaveBeenCalled());
    expect(m.api.modulosPadraoDefinir.mock.calls[0]![0]).toMatchObject({ legadox: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: "legadox" }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar o padrão de fábrica" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "legadox" }).getAttribute("aria-checked")).toBe("false"));
  });

  it("desligar o sprintx no padrão arrasta os dependentes e avisa quais (nenhum projeto é tocado)", async () => {
    const m = criarStoreFalso(estadoSuite("completa"));
    render(<SecaoModulosPadrao store={m.store} />);
    fireEvent.click(await screen.findByRole("switch", { name: "sprintx" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Também ajustado: buildx/));
    expect(m.api.modulosPadraoDefinir.mock.calls[0]![0]).toMatchObject({ sprintx: false, buildx: false });
  });
});

describe("gestos do Método com o módulo desligado", () => {
  it("sem runx: 'Corrigir um bug' avisa 'módulo desligado' e oferece ligar; 'Nova feature' segue disponível", async () => {
    const m = criarStoreFalso(estadoSuite("completa"));
    m.definirModulos({ ...PADRAO_DE_FABRICA, runx: false, legadox: false });
    m.store.ligar();
    await m.store.garantirModulos(WS, true);
    const { storeSuite } = await import("../../estado/suite");
    // o componente lê o store global: injeta o mesmo estado nele
    (globalThis as unknown as { ade: unknown }).ade = { suite: { ...m.api }, metodo: { comandoSugerido: vi.fn(async () => ({ comando: "", pane_separado: false, somente_humano: false, motivo_bloqueio: null })) } };
    storeSuite.ligar();
    await storeSuite.garantirModulos(WS, true);
    render(<Pedido workspaceId={WS} indice={null} />);
    expect(screen.getByRole("radio", { name: /Nova feature/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("radio", { name: /Corrigir um bug/ }).closest("label")?.textContent).toMatch(/módulo desligado/));
    fireEvent.click(screen.getByRole("radio", { name: /Corrigir um bug/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/runx está desligado/);
    expect(screen.getByRole("button", { name: "Ligar módulo runx" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Corrigir bug" }) as HTMLButtonElement).disabled).toBe(true);
    delete (globalThis as unknown as { ade?: unknown }).ade;
  });
});
