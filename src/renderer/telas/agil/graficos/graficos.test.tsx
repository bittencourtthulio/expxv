// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { contarNos, paraString } from "../../../../compartilhado/svg";
import { formatar, varrer } from "../../../a11y/varredura";
import { painelFalso, painelVazio } from "../fabrica-teste";
import { CartaoGrafico } from "./CartaoGrafico";
import { graficosDoMetodo, montarGraficos } from "./definicoes";
import { NoReact, nomeReact } from "./React";

describe("os 16 gráficos", () => {
  const todos = montarGraficos(painelFalso());
  it("existem 16, numerados, cada um com unidade, n, tabela equivalente e SVG acessível", () => {
    expect(todos.map((g) => g.numero)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    for (const g of todos) {
      expect(g.vazio, g.id).toBeNull();
      expect(g.svgs.length, g.id).toBeGreaterThan(0);
      expect(g.tabela.linhas.length, g.id).toBeGreaterThan(0);
      expect(g.unidade, g.id).not.toBe("");
      for (const s of g.svgs) {
        const html = paraString(s.no);
        expect(html, g.id).toContain("<title");
        expect(html, g.id).toContain("<desc");
        expect(html, g.id).toContain("aria-labelledby");
        expect(contarNos(s.no), g.id).toBeLessThanOrEqual(1500);
      }
    }
  });
  it("sem dados, cada gráfico explica o que falta (sem inventar zero)", () => {
    const v = montarGraficos(painelVazio());
    expect(v).toHaveLength(16);
    for (const g of v) { expect(g.vazio, g.id).toMatch(/.{20,}/); expect(g.svgs).toHaveLength(0); }
    expect(v.find((g) => g.id === "previsao")?.vazio).toMatch(/Dados insuficientes/);
  });
  it("previsão 'calculando' tem mensagem própria", () => {
    const g = montarGraficos(painelFalso({ previsao: { estado: "calculando" } })).find((x) => x.id === "previsao");
    expect(g?.vazio).toMatch(/Calculando/);
  });
  it("filtro por método separa Scrum, XP e Lean", () => {
    const ids = (m: "scrum" | "xp" | "lean") => graficosDoMetodo(todos, m).map((g) => g.id);
    expect(ids("scrum")).toEqual(expect.arrayContaining(["burndown", "velocidade", "saude"]));
    expect(ids("scrum")).not.toContain("cfd");
    expect(ids("lean")).toEqual(expect.arrayContaining(["cfd", "cycle", "wip", "valor-esforco"]));
    expect(ids("xp")).toEqual(expect.arrayContaining(["retrabalho", "defeitos"]));
    expect(graficosDoMetodo(todos, "todos")).toHaveLength(16);
  });
  it("dados grandes (5 000 dias) continuam dentro de 1 500 nós por gráfico", () => {
    const dias = Array.from({ length: 5000 }, (_, i) => ({ dia: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), valor: i % 9 }));
    const g = montarGraficos(painelFalso({ throughput: dias, wip: { dias, limite: 4, idade: [] } })).filter((x) => ["throughput", "wip"].includes(x.id));
    for (const x of g) for (const s of x.svgs) expect(contarNos(s.no), x.id).toBeLessThanOrEqual(1500);
  });
});

describe("mesma árvore, React e string idênticos", () => {
  it("todos os gráficos: renderToStaticMarkup(NoReact) === paraString", () => {
    for (const g of montarGraficos(painelFalso())) for (const s of g.svgs) expect(renderToStaticMarkup(<NoReact no={s.no} />), g.id).toBe(paraString(s.no));
  });
  it("nomes de atributo hifenizados viram camelCase do React (e o resto passa)", () => {
    expect(nomeReact("stroke-width")).toBe("strokeWidth");
    expect(nomeReact("text-anchor")).toBe("textAnchor");
    expect(nomeReact("aria-labelledby")).toBe("aria-labelledby");
    expect(nomeReact("data-tip")).toBe("data-tip");
    expect(nomeReact("class")).toBe("className");
    expect(nomeReact("viewBox")).toBe("viewBox");
  });
  it("snapshot estável de um gráfico pequeno", () => {
    const g = montarGraficos(painelFalso()).find((x) => x.id === "saude");
    expect(paraString(g!.svgs[0]!.no)).toMatchSnapshot();
  });
});

describe("cartão do gráfico", () => {
  const g = montarGraficos(painelFalso()).find((x) => x.id === "velocidade")!;
  it("mostra título, unidade, n, tabela em <details> e passa na varredura de acessibilidade", () => {
    render(<CartaoGrafico g={g} expandido={false} aoExpandir={() => undefined} />);
    expect(screen.getByRole("heading", { name: /^Velocidade$/ })).toBeTruthy();
    expect(screen.getByText(/n = 3 sprints/)).toBeTruthy();
    expect(screen.getByText("Tabela de dados")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Velocidade/ })).toBeTruthy();
    const a = varrer(document.body);
    expect(a.length === 0 ? "" : formatar(a)).toBe("");
  });
  it("a tabela só entra no DOM quando aberta", async () => {
    const { container } = render(<CartaoGrafico g={g} expandido={false} aoExpandir={() => undefined} />);
    expect(container.querySelector("table")).toBeNull();
    const det = container.querySelector("details") as HTMLDetailsElement;
    await act(async () => { det.open = true; fireEvent(det, new Event("toggle")); });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
  });
  it("tooltip por delegação: mostrar/esconder só mexe no balão, o SVG não é recriado", async () => {
    const { container } = render(<CartaoGrafico g={g} expandido={false} aoExpandir={() => undefined} />);
    const svg = container.querySelector("svg");
    const alvo = container.querySelector("[data-tip]") as Element;
    const balao = container.querySelector(".ag-balao") as HTMLElement;
    expect(balao.hidden).toBe(true);
    await act(async () => { fireEvent.mouseOver(alvo, { clientX: 20, clientY: 40 }); });
    expect(balao.hidden).toBe(false);
    expect(balao.textContent).toBe(alvo.getAttribute("data-tip"));
    expect(container.querySelector("svg")).toBe(svg);
    await act(async () => { fireEvent.mouseLeave(container.querySelector(".ag-corpo-grafico") as Element); });
    expect(balao.hidden).toBe(true);
  });
  it("gráfico vazio mostra o motivo no lugar do SVG e não oferece CSV", () => {
    const v = montarGraficos(painelVazio()).find((x) => x.id === "burndown")!;
    render(<CartaoGrafico g={v} expandido={false} aoExpandir={() => undefined} />);
    expect(screen.getByRole("status").textContent).toMatch(/sprint/);
    expect((screen.getByRole("button", { name: /Exportar CSV/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("expandir é um botão alternável", async () => {
    let aberto = false;
    const { rerender } = render(<CartaoGrafico g={g} expandido={aberto} aoExpandir={() => { aberto = true; }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Expandir Velocidade/ })); });
    expect(aberto).toBe(true);
    rerender(<CartaoGrafico g={g} expandido aoExpandir={() => undefined} />);
    expect(screen.getByRole("button", { name: /Recolher Velocidade/ }).getAttribute("aria-pressed")).toBe("true");
  });
});
