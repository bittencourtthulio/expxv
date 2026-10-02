// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Menu } from "./Menu";
import { CHAVE_MENU, PREFS_PADRAO, type PrefsMenu, type Selos } from "../estado/menu-grupos";
import { GRUPOS, telasDoGrupo, TELAS, type TelaId } from "./telas";

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* sem storage */ } });

interface Opc { ativa?: TelaId; prefs?: PrefsMenu; selos?: Selos; fixado?: boolean; sinal?: number }
function montar(o: Opc = {}) {
  const aoSelecionar = vi.fn();
  const salvar = vi.fn();
  const props = () => ({ ativa: o.ativa ?? "inicio", fixado: o.fixado ?? false, aoSelecionar, aoFixar: vi.fn(), selos: o.selos ?? {}, sinalRevelar: o.sinal ?? 0, prefsIniciais: o.prefs ?? PREFS_PADRAO, salvar });
  const r = render(<Menu {...props()} />);
  return { aoSelecionar, salvar, ...r, reRender: (p: Partial<Opc>) => { Object.assign(o, p); r.rerender(<Menu {...props()} />); } };
}
const cab = (nome: string): HTMLElement => {
  const g = GRUPOS.find((x) => x.rotulo === nome)!;
  return document.querySelector<HTMLElement>(`[data-nav="grupo:${g.id}"]`)!;
};
const tecla = async (el: Element, key: string) => { await act(async () => { fireEvent.keyDown(el, { key }); }); };
const selo = (el: Element) => el.querySelector(".menu-selo");
const salvo = (f: ReturnType<typeof vi.fn>): PrefsMenu => f.mock.calls.at(-1)![0] as PrefsMenu;

describe("Menu agrupado", () => {
  it("mostra os grupos com contagem; só o grupo ativo/padrão aberto", () => {
    montar();
    for (const g of GRUPOS) expect(cab(g.rotulo), g.id).toBeTruthy();
    expect(cab("Trabalho").getAttribute("aria-expanded")).toBe("true");
    expect(cab("Código").getAttribute("aria-expanded")).toBe("false");
    expect(cab("Trabalho").querySelector(".menu-contagem")?.textContent).toBe(String(telasDoGrupo("trabalho").length));
    expect(screen.queryByRole("button", { name: "Método" })).toBeNull();
    expect(screen.getByRole("button", { name: "Missões" })).toBeTruthy();
  });

  it("clicar no cabeçalho abre e fecha o grupo e persiste o estado", async () => {
    const m = montar();
    await act(async () => { fireEvent.click(cab("Código")); });
    expect(cab("Código").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Método" })).toBeTruthy();
    expect(salvo(m.salvar).abertos).toContain("codigo");
    await act(async () => { fireEvent.click(cab("Código")); });
    expect(screen.queryByRole("button", { name: "Método" })).toBeNull();
    expect(salvo(m.salvar).abertos).not.toContain("codigo");
  });

  it("restaura o estado persistido (grupos abertos e fixados)", () => {
    montar({ prefs: { abertos: ["sistema"], fixados: ["config"], compacto: false }, ativa: "config" });
    expect(cab("Sistema").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Fixados" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Fixados" })).getByRole("button", { name: "Configurações" })).toBeTruthy();
  });

  it("o grupo que contém a tela ativa abre sozinho, também por pedido repetido (atalho)", async () => {
    const m = montar({ ativa: "inicio" });
    m.reRender({ ativa: "mapa" });
    expect(cab("Código").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Mapa" }).getAttribute("aria-current")).toBe("page");
    // o usuário recolhe o grupo da tela ativa; um novo pedido da mesma tela (atalho) reabre
    await act(async () => { fireEvent.click(cab("Código")); });
    expect(cab("Código").getAttribute("aria-expanded")).toBe("false");
    m.reRender({ sinal: 1 });
    expect(cab("Código").getAttribute("aria-expanded")).toBe("true");
  });

  it("grupo fechado que contém a tela ativa fica marcado", async () => {
    montar({ ativa: "mapa" });
    await act(async () => { fireEvent.click(cab("Código")); });
    expect(cab("Código").hasAttribute("data-contem-ativa")).toBe(true);
  });

  it("acordeão: abrir um grupo fecha o que estava aberto", async () => {
    const m = montar();
    expect(cab("Trabalho").getAttribute("aria-expanded")).toBe("true");
    await act(async () => { fireEvent.click(cab("Código")); });
    expect(cab("Código").getAttribute("aria-expanded")).toBe("true");
    expect(cab("Trabalho").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Missões" })).toBeNull();
    expect(salvo(m.salvar).abertos).toEqual(["codigo"]);
    await act(async () => { fireEvent.click(cab("Gestão")); });
    expect(GRUPOS.filter((g) => cab(g.rotulo).getAttribute("aria-expanded") === "true").map((g) => g.id)).toEqual(["gestao"]);
  });

  it("todas as telas ficam alcançáveis, grupo a grupo", async () => {
    montar();
    for (const g of GRUPOS) {
      if (cab(g.rotulo).getAttribute("aria-expanded") !== "true") await act(async () => { fireEvent.click(cab(g.rotulo)); });
      const nav = screen.getByRole("navigation", { name: "Principal" });
      for (const t of telasDoGrupo(g.id)) expect(within(nav).getByRole("button", { name: t.rotulo }), t.id).toBeTruthy();
    }
    expect(TELAS.length).toBeGreaterThan(0);
  });

  it("selo agregado aparece no cabeçalho do grupo fechado e vai para o item quando aberto", async () => {
    montar({ selos: { alertas: { valor: 3, critico: true } } });
    expect(selo(cab("Gestão"))?.getAttribute("data-critico")).not.toBeNull();
    expect(selo(cab("Gestão"))?.textContent).toBe("3");
    expect(within(cab("Gestão")).getByText(/3 pendentes/)).toBeTruthy();
    expect(within(cab("Trabalho")).queryByText(/pendentes/)).toBeNull();
    await act(async () => { fireEvent.click(cab("Gestão")); });
    expect(within(cab("Gestão")).queryByText(/pendentes/)).toBeNull();
    expect(selo(screen.getByRole("button", { name: /^Alertas/ }))?.textContent).toBe("3");
  });

  it("fixar pelo botão da linha, e pela tecla P; limite de 3", async () => {
    const m = montar();
    const linha = screen.getByRole("button", { name: "Missões" }).closest(".menu-linha") as HTMLElement;
    await act(async () => { fireEvent.click(within(linha).getByRole("button", { name: "Fixar no topo" })); });
    expect(salvo(m.salvar).fixados).toEqual(["missoes"]);
    expect(screen.getByRole("group", { name: "Fixados" })).toBeTruthy();
    const term = screen.getByRole("button", { name: "Terminais" });
    term.focus();
    await tecla(term, "p");
    expect(salvo(m.salvar).fixados).toEqual(["missoes", "terminais"]);
  });

  describe("teclado", () => {
    it("↑/↓ percorrem cabeçalhos e itens visíveis; Home/End vão às pontas", async () => {
      montar();
      const t = cab("Trabalho");
      t.focus();
      await tecla(t, "ArrowDown");
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Início" }));
      await tecla(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(t);
      await tecla(t, "End");
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sistema" }));
      await tecla(document.activeElement!, "Home");
      expect(document.activeElement).toBe(t);
    });

    it("→ expande o grupo fechado e depois entra; ← recolhe, ou volta do item ao cabeçalho", async () => {
      montar();
      const c = cab("Código");
      c.focus();
      await tecla(c, "ArrowRight");
      expect(c.getAttribute("aria-expanded")).toBe("true");
      await tecla(c, "ArrowRight");
      const metodo = screen.getByRole("button", { name: "Método" });
      expect(document.activeElement).toBe(metodo);
      await tecla(metodo, "ArrowLeft");
      expect(document.activeElement).toBe(c);
      await tecla(c, "ArrowLeft");
      expect(c.getAttribute("aria-expanded")).toBe("false");
    });

    it("Enter ativa o item (clique nativo do botão) e chama aoSelecionar", async () => {
      const m = montar();
      const b = screen.getByRole("button", { name: "Terminais" });
      await act(async () => { fireEvent.click(b); });
      expect(m.aoSelecionar).toHaveBeenCalledWith("terminais");
    });
  });

  describe("modo só ícones", () => {
    const icones: PrefsMenu = { abertos: ["trabalho"], fixados: [], compacto: true };

    it("não mostra sub-itens; o ícone do grupo abre um flyout com os sub-itens", async () => {
      const m = montar({ prefs: icones });
      expect(screen.queryByRole("button", { name: "Missões" })).toBeNull();
      await act(async () => { fireEvent.click(cab("Código")); });
      const fly = screen.getByRole("group", { name: "Código" });
      for (const t of telasDoGrupo("codigo")) expect(within(fly).getByRole("button", { name: t.rotulo })).toBeTruthy();
      await act(async () => { fireEvent.click(within(fly).getByRole("button", { name: "Mapa" })); });
      expect(m.aoSelecionar).toHaveBeenCalledWith("mapa");
      expect(screen.queryByRole("group", { name: "Código" })).toBeNull();
    });

    it("→ abre o flyout com foco no primeiro item; Esc fecha e devolve o foco ao ícone", async () => {
      montar({ prefs: icones });
      const c = cab("Código");
      c.focus();
      await tecla(c, "ArrowRight");
      const fly = screen.getByRole("group", { name: "Código" });
      expect(document.activeElement).toBe(within(fly).getByRole("button", { name: "Método" }));
      await tecla(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(within(fly).getByRole("button", { name: "Trabalhos" }));
      await tecla(document.activeElement!, "Escape");
      expect(screen.queryByRole("group", { name: "Código" })).toBeNull();
      expect(document.activeElement).toBe(c);
    });

    it("o selo agregado aparece no ícone do grupo", () => {
      montar({ prefs: icones, selos: { alertas: { valor: 7 } } });
      expect(selo(cab("Gestão"))?.textContent).toBe("7");
    });

    it("alternar 'Só ícones' grava o modo", async () => {
      const m = montar();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Só ícones/ })); });
      expect(salvo(m.salvar).compacto).toBe(true);
      expect(screen.queryByRole("button", { name: "Missões" })).toBeNull();
    });
  });

  it("sem salvar injetado, grava no armazenamento local", async () => {
    render(<Menu ativa="inicio" fixado={false} aoSelecionar={vi.fn()} aoFixar={vi.fn()} />);
    await act(async () => { fireEvent.click(cab("Código")); });
    expect(JSON.parse(localStorage.getItem(CHAVE_MENU)!).abertos).toContain("codigo");
  });
});
