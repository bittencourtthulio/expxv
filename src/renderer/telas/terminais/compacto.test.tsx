// @vitest-environment jsdom
// D-32 (área de trabalho máxima) e T-03.07 (UI da Missão): medidas lidas do CSS (jsdom não tem layout) e estrutura do DOM.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoTerminal, FerramentaDetectada, LayoutTerminais, MetadadosSessao } from "../../../compartilhado/terminais";
import { criarArmazem, type Armazem } from "../../componentes/Terminal/armazem";
import { criarStoreTerminais } from "../../estado/terminais";
import Tela from "./index";
import type { PropsTerminalGrade } from "./Grade";
import type { InfoPane, MapaMissao } from "./missao";

const RAIZ = join(__dirname, "..", "..");
const tokens = readFileSync(join(RAIZ, "tokens.css"), "utf8");
const css = readFileSync(join(__dirname, "terminais.css"), "utf8");
const casca = readFileSync(join(RAIZ, "casca", "casca.css"), "utf8");

const px = (css_: string, nome: string): number => {
  const m = new RegExp(`${nome}\\s*:\\s*([\\d.]+)px`).exec(css_);
  expect(m, `${nome} em px`).not.toBeNull();
  return Number(m![1]);
};
const regra = (seletor: string): string => {
  const i = css.indexOf(`${seletor} {`);
  expect(i, `regra ${seletor}`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
};

afterEach(() => cleanup());

describe("D-32: medidas (tokens.css e terminais.css)", () => {
  it("casca fina: topo ≤ 40 px, rodapé ≤ 26 px, base ≤ 13 px, menu recolhido ≤ 76 px", () => {
    expect(px(tokens, "--altura-topo")).toBeLessThanOrEqual(40);
    expect(px(tokens, "--altura-rodape")).toBeLessThanOrEqual(26);
    expect(px(tokens, "--texto-base")).toBeLessThanOrEqual(13);
    expect(px(tokens, "--menu-recolhido")).toBeLessThanOrEqual(76);
    expect(casca).toMatch(/grid-template-rows:\s*var\(--altura-topo\)[^;]*var\(--altura-rodape\)/);
  });

  it("tela Terminais: linha ≤ 28 px, aba 24–26 px, ícone ≤ 24 px, rótulo de aba ≤ 11 px, cabeçalho de painel ≤ 18 px, divisor 2 px", () => {
    expect(px(tokens, "--altura-barra")).toBeLessThanOrEqual(28);
    expect(px(tokens, "--altura-aba")).toBeGreaterThanOrEqual(24);
    expect(px(tokens, "--altura-aba")).toBeLessThanOrEqual(26);
    expect(px(tokens, "--botao-icone")).toBeLessThanOrEqual(24);
    expect(px(tokens, "--botao-icone")).toBeGreaterThanOrEqual(20);
    expect(px(tokens, "--fonte-aba")).toBeLessThanOrEqual(11);
    expect(px(tokens, "--altura-cabecalho-painel")).toBeLessThanOrEqual(18);
    expect(px(tokens, "--divisor-painel")).toBe(2);
    expect(regra(".terminais-barra")).toMatch(/height:\s*var\(--altura-barra\)/);
    expect(regra(".terminais-aba")).toMatch(/height:\s*var\(--altura-aba\)/);
    expect(regra(".terminais-icone")).toMatch(/width:\s*var\(--botao-icone\)/);
    expect(regra(".terminais-icone")).toMatch(/height:\s*var\(--botao-icone\)/);
    expect(regra(".terminais-aba-titulo")).toMatch(/font-size:\s*var\(--fonte-aba\)/);
    expect(regra(".terminais-painel-cabecalho")).toMatch(/height:\s*var\(--altura-cabecalho-painel\)/);
  });

  it("a linha nunca quebra: nowrap na barra, rolagem horizontal sem barra nas abas", () => {
    expect(regra(".terminais-barra")).not.toMatch(/flex-wrap:\s*wrap/);
    expect(regra(".terminais-barra")).toMatch(/flex-wrap:\s*nowrap/);
    const abas = regra(".terminais-abas");
    expect(abas).toMatch(/overflow-x:\s*auto/);
    expect(abas).toMatch(/scrollbar-width:\s*none/);
    expect(abas).toMatch(/min-width:\s*0/);
    expect(regra(".terminais-aba")).toMatch(/flex:\s*none/);
    expect(css).not.toMatch(/\.terminais-abas[^{]*\{[^}]*flex-wrap:\s*wrap/);
  });

  it("padding do xterm 2–4 px", () => {
    const t = readFileSync(join(RAIZ, "componentes", "Terminal", "terminal.css"), "utf8");
    const m = /\.terminal-xterm \{[^}]*padding:\s*([^;]+);/.exec(t);
    expect(m).not.toBeNull();
    const valores = m![1]!.trim().split(/\s+/).map((v) => parseFloat(v));
    expect(valores.length).toBeGreaterThan(0);
    for (const v of valores) expect(v).toBeLessThanOrEqual(4);
    expect(Math.max(...valores)).toBeGreaterThanOrEqual(2);
  });
});

// ---------- DOM ----------
const meta = (sessao_id: string): MetadadosSessao => ({ sessao_id, ferramenta_id: "claude", estado: "executando", workspace_id: null, criada_em: "x", persistente: true });
const claude: FerramentaDetectada = { id: "claude", nome: "Claude Code", descricao: "CLI", instalado: true, executavel_id: "e1", modo_lancamento: "direto", erro_codigo: null, versao: "2.0", recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true } };
const ev = (tipo: EventoTerminal["tipo"], sessao_id: string, sequencia: number, extra: object = {}) => ({ versao: 1, tipo, sessao_id, sequencia, ...extra }) as EventoTerminal;
const T = (sessao_id: string) => ({ tipo: "terminal" as const, sessao_id });
const D = (primeiro: ReturnType<typeof T> | object, segundo: ReturnType<typeof T> | object) => ({ tipo: "divisao" as const, orientacao: "vertical" as const, primeiro, segundo }) as LayoutTerminais["abas"][0]["arvore"];

function falso(armazem: Armazem) {
  return function TerminalFalso({ sessaoId }: PropsTerminalGrade) {
    const ref = useRef<HTMLPreElement>(null);
    useEffect(() => { const c = armazem.assinar(sessaoId, (x) => { ref.current!.textContent += x; }); return c; }, [sessaoId]);
    return <pre ref={ref} data-testid={`term-${sessaoId}`} />;
  };
}

function montar(opcoes: { recuperadas: MetadadosSessao[]; layout?: LayoutTerminais; infoMissao?: MapaMissao; copiar?: (t: string) => void }) {
  let ouvir: (e: EventoTerminal) => void = () => undefined;
  const api = {
    assinarEventos: vi.fn((cb) => { ouvir = cb; return () => undefined; }), assinarFalhas: vi.fn(() => () => undefined),
    recuperar: vi.fn().mockResolvedValue({ sessoes: opcoes.recuperadas }), listarFerramentas: vi.fn().mockResolvedValue([claude]),
    abrir: vi.fn(async () => ({ versao: 1, sessao_id: "novo1", estado: "iniciando" })),
    confirmarConsumo: vi.fn().mockResolvedValue(true), descartar: vi.fn().mockResolvedValue(true), interromper: vi.fn(), escrever: vi.fn(), redimensionar: vi.fn(),
    lerLayout: vi.fn().mockResolvedValue(opcoes.layout ?? null), gravarLayout: vi.fn().mockResolvedValue(true),
  };
  const armazem = criarArmazem();
  const store = criarStoreTerminais({ api: () => api as never, armazem });
  const props = { store, api: api as never, Terminal: falso(armazem), tema: "escuro" as const, atrasoGravacao: 5, infoMissao: opcoes.infoMissao, copiarTexto: opcoes.copiar };
  const ui = render(<Tela {...props} />);
  return { api, store, ui, emitir: (e: EventoTerminal) => act(() => ouvir(e)), reRender: (infoMissao: MapaMissao, layout?: LayoutTerminais) => ui.rerender(<Tela {...props} infoMissao={infoMissao} />) };
}

describe("D-32: uma única linha de controles", () => {
  it("com 30 abas há UM container de linha com abas + controles; nada em segunda linha", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `s${i}`);
    montar({ recuperadas: ids.map(meta), layout: { versao: 2, ativa: "s0", fixadas: [], abas: ids.map((i) => ({ arvore: T(i) })) } });
    await screen.findByTestId("term-s0");
    const barras = document.querySelectorAll(".terminais-barra");
    expect(barras).toHaveLength(1);
    const barra = barras[0] as HTMLElement;
    expect(within(barra).getAllByRole("tab")).toHaveLength(30);
    expect(barra.querySelectorAll(".terminais-abas")).toHaveLength(1);
    expect(document.querySelectorAll(".terminais-abas")).toHaveLength(1);
    // nova sessão, dividir, buscar, ajuda: tudo dentro da mesma linha
    for (const nome of [/Nova sessão/, /Dividir lado a lado/, /Dividir em cima e embaixo/, /Buscar no terminal/, /Atalhos de teclado/]) expect(within(barra).getByRole("button", { name: nome })).toBeTruthy();
    // a tela tem só a barra antes do corpo (sem linha de abas separada)
    const tela = document.querySelector(".terminais-tela") as HTMLElement;
    const irmaosAntesDoCorpo = Array.from(tela.children).filter((c) => !c.classList.contains("terminais-corpo") && !c.classList.contains("terminais-borda"));
    expect(irmaosAntesDoCorpo).toEqual([barra]);
  });

  it("todo botão da linha (fora as abas) é só ícone de 20–24 px com title e aria-label", async () => {
    montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    const barra = document.querySelector(".terminais-barra") as HTMLElement;
    const botoes = Array.from(barra.querySelectorAll("button")).filter((b) => b.getAttribute("role") !== "tab" && !b.classList.contains("terminais-aba-fechar"));
    expect(botoes.length).toBeGreaterThanOrEqual(5);
    for (const b of botoes) {
      expect(b.classList.contains("terminais-icone") || b.classList.contains("terminais-aguardando"), b.outerHTML).toBe(true);
      expect(b.getAttribute("aria-label"), b.outerHTML).toBeTruthy();
      expect(b.getAttribute("title"), b.outerHTML).toBeTruthy();
    }
  });

  it("aba compacta: ícone da CLI + rótulo curto; nenhum título de página nem cartão na tela", async () => {
    montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    const aba = screen.getByRole("tab");
    expect(aba.querySelector(".terminais-cli")).not.toBeNull();
    expect(document.querySelector(".terminais-tela h1, .terminais-tela h2, .terminais-tela .pagina-cabecalho")).toBeNull();
  });

  it("o botão buscar pede a busca do painel em foco", async () => {
    montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    const ouvinte = vi.fn();
    window.addEventListener("ade:buscar-terminal", ouvinte as EventListener);
    fireEvent.click(screen.getByRole("button", { name: /Buscar no terminal/ }));
    window.removeEventListener("ade:buscar-terminal", ouvinte as EventListener);
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect((ouvinte.mock.calls[0]![0] as CustomEvent).detail).toBe("a");
  });
});

describe("D-32: cabeçalho de painel e modo foco", () => {
  it("cabeçalho de painel é uma única linha curta (#n · CLI) com ações só de ícone", async () => {
    montar({ recuperadas: [meta("a"), meta("b")], layout: { versao: 2, ativa: "a", fixadas: [], abas: [{ arvore: D(T("a"), T("b")) }] } });
    await screen.findByTestId("term-b");
    const cab = document.querySelectorAll(".terminais-painel-cabecalho");
    expect(cab).toHaveLength(2);
    expect(cab[0]!.textContent).toContain("#1 · Claude Code");
    for (const b of Array.from(cab[0]!.querySelectorAll("button"))) expect(b.getAttribute("aria-label")).toBeTruthy();
    expect(document.querySelectorAll(".terminais-painel[data-unico]")).toHaveLength(0);
  });

  it("com um painel só o cabeçalho é de hover/foco (data-unico)", async () => {
    montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    expect(document.querySelector(".terminais-painel[data-unico]")).not.toBeNull();
    expect(regra(".terminais-painel[data-unico] .terminais-painel-cabecalho")).toMatch(/position:\s*absolute/);
  });

  it("modo foco (Ctrl+Shift+Enter): a linha some; reaparece na borda superior e some de novo ao sair", async () => {
    montar({ recuperadas: [meta("a"), meta("b")], layout: { versao: 2, ativa: "a", fixadas: [], abas: [{ arvore: D(T("a"), T("b")) }] } });
    await screen.findByTestId("term-b");
    const barra = document.querySelector(".terminais-barra") as HTMLElement;
    expect(barra.hasAttribute("data-oculta")).toBe(false);
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(screen.queryByTestId("term-b")).toBeNull(); // painel expandido na área toda
    expect((document.querySelector(".terminais-barra") as HTMLElement).hasAttribute("data-oculta")).toBe(true);
    const borda = document.querySelector(".terminais-borda") as HTMLElement;
    expect(borda).not.toBeNull();
    fireEvent.pointerEnter(borda);
    expect((document.querySelector(".terminais-barra") as HTMLElement).hasAttribute("data-oculta")).toBe(false);
    fireEvent.pointerLeave(document.querySelector(".terminais-barra") as HTMLElement);
    expect((document.querySelector(".terminais-barra") as HTMLElement).hasAttribute("data-oculta")).toBe(true);
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(await screen.findByTestId("term-b")).toBeTruthy();
    expect((document.querySelector(".terminais-barra") as HTMLElement).hasAttribute("data-oculta")).toBe(false);
    expect(document.querySelector(".terminais-borda")).toBeNull();
  });

  it("modo foco também esconde a linha com um painel só", async () => {
    montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect((document.querySelector(".terminais-barra") as HTMLElement).hasAttribute("data-oculta")).toBe(true);
  });

  it("a linha oculta só usa transform/opacity/visibility (nada de reflow) e a borda é fina", () => {
    const r = regra(".terminais-tela[data-foco] .terminais-barra");
    expect(r).toMatch(/position:\s*absolute/);
    expect(r).toMatch(/transform:/);
    expect(r).not.toMatch(/\b(height|top|margin)[^-]*:\s*-/);
    expect(px(regra(".terminais-borda"), "height")).toBeLessThanOrEqual(6);
  });
});

// ---------- Missão ----------
const info = (p: Partial<InfoPane> & { sessaoId: string }): InfoPane => ({ displayId: 1, papel: "executor", ehPiloto: false, missaoId: "m1", missaoTitulo: "Missão X", cli: "claude", ...p });
const mapaBase = (): Record<string, InfoPane> => ({
  p: info({ sessaoId: "p", displayId: 325, papel: "piloto", ehPiloto: true }),
  w1: info({ sessaoId: "w1", displayId: 326 }),
  w2: info({ sessaoId: "w2", displayId: 327, tokens: 12_300, custo: 0.5 }),
});

describe("T-03.07: UI da Missão", () => {
  it("piloto fixo à esquerda (mesmo vindo depois na árvore) e workers numa grade à direita, com rótulo #id · CLI · papel · missão", async () => {
    montar({ recuperadas: [meta("w1"), meta("p"), meta("w2")], layout: { versao: 2, ativa: "p", fixadas: [], abas: [{ arvore: D(T("w1"), D(T("p"), T("w2"))) }] }, infoMissao: mapaBase() });
    await screen.findByTestId("term-p");
    const missao = document.querySelector(".terminais-missao") as HTMLElement;
    expect(missao).not.toBeNull();
    const [esq, , dir] = Array.from(missao.children) as HTMLElement[];
    expect(esq!.getAttribute("data-sessao")).toBe("p");
    expect(esq!.hasAttribute("data-piloto")).toBe(true);
    expect(dir!.classList.contains("terminais-missao-workers")).toBe(true);
    expect(dir!.querySelectorAll("section")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Painel #325 · Claude Code · piloto · Missão X" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Painel #326 · Claude Code · executor · Missão X" })).toBeTruthy();
  });

  it("custo desconhecido aparece como texto e nunca como 0; conhecido mostra o valor", async () => {
    montar({ recuperadas: [meta("p"), meta("w1"), meta("w2")], layout: { versao: 2, ativa: "p", fixadas: [], abas: [{ arvore: D(T("p"), D(T("w1"), T("w2"))) }] }, infoMissao: mapaBase() });
    await screen.findByTestId("term-w2");
    const w1 = screen.getByRole("region", { name: /#326/ });
    expect(within(w1).getByText("custo desconhecido")).toBeTruthy();
    expect(w1.textContent).not.toMatch(/\b0\b/);
    const w2 = screen.getByRole("region", { name: /#327/ });
    expect(w2.textContent).toContain("0,50");
    expect(within(w2).queryByText("custo desconhecido")).toBeNull();
  });

  it("aviso amarelo discreto quando o piloto foi reiniciado sem conteúdo persistido", async () => {
    const mapa = mapaBase();
    mapa["p"] = { ...mapa["p"]!, reiniciadoSemConteudo: true };
    montar({ recuperadas: [meta("p"), meta("w1")], layout: { versao: 2, ativa: "p", fixadas: [], abas: [{ arvore: D(T("p"), T("w1")) }] }, infoMissao: mapa });
    await screen.findByTestId("term-p");
    const piloto = screen.getByRole("region", { name: /#325/ });
    const aviso = within(piloto).getByRole("note");
    expect(aviso.textContent).toMatch(/reiniciado/i);
    expect(within(screen.getByRole("region", { name: /#326/ })).queryByRole("note")).toBeNull();
  });

  it("copiar prompt: botão de ícone que copia o prompt do pane (desabilitado quando não há)", async () => {
    const copiar = vi.fn();
    const mapa = mapaBase();
    mapa["p"] = { ...mapa["p"]!, prompt: "Você é o piloto." };
    montar({ recuperadas: [meta("p"), meta("w1")], layout: { versao: 2, ativa: "p", fixadas: [], abas: [{ arvore: D(T("p"), T("w1")) }] }, infoMissao: mapa, copiar });
    await screen.findByTestId("term-p");
    fireEvent.click(within(screen.getByRole("region", { name: /#325/ })).getByRole("button", { name: /Copiar prompt/ }));
    expect(copiar).toHaveBeenCalledWith("Você é o piloto.");
    expect((within(screen.getByRole("region", { name: /#326/ })).getByRole("button", { name: /Copiar prompt/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("aguardando: realce discreto com anel + ícone (não só cor)", async () => {
    const { emitir } = montar({ recuperadas: [meta("p"), meta("w1")], layout: { versao: 2, ativa: "p", fixadas: [], abas: [{ arvore: D(T("p"), T("w1")) }] }, infoMissao: mapaBase() });
    await screen.findByTestId("term-w1");
    emitir(ev("atividade", "w1", 1, { atividade: "aguardando" }));
    const w1 = screen.getByRole("region", { name: /#326/ });
    expect(w1.getAttribute("data-atividade")).toBe("aguardando");
    expect(within(w1).getByRole("img", { name: "aguardando você" }).textContent).toBe("!");
  });

  it("piloto sozinho reserva o espaço dos workers; criar um worker não remonta o piloto nem muda a grade", async () => {
    const layout: LayoutTerminais = { versao: 2, ativa: "p", fixadas: [], abas: [{ arvore: T("p") }] };
    const { reRender, ui } = montar({ recuperadas: [meta("p")], layout, infoMissao: { p: mapaBase()["p"]! } });
    await screen.findByTestId("term-p");
    const missao = document.querySelector(".terminais-missao") as HTMLElement;
    const workers = missao.querySelector(".terminais-missao-workers") as HTMLElement;
    expect(workers.hasAttribute("data-vazio")).toBe(true);
    const pilotoAntes = screen.getByTestId("term-p");
    // um worker nasce: dividir pelo atalho abre `novo1` e a árvore passa a ter 2 folhas
    fireEvent.keyDown(window, { key: "D", ctrlKey: true, shiftKey: true });
    await screen.findByTestId("term-novo1");
    reRender({ p: mapaBase()["p"]!, novo1: info({ sessaoId: "novo1", displayId: 330 }) });
    expect(document.querySelector(".terminais-missao")).toBe(missao);
    expect(missao.querySelector(".terminais-missao-workers")).toBe(workers);
    expect(workers.hasAttribute("data-vazio")).toBe(false);
    expect(screen.getByTestId("term-p")).toBe(pilotoAntes);
    expect(css).toMatch(/@keyframes terminais-entra\s*\{\s*from\s*\{\s*opacity:/); // só opacity/transform ao nascer
    void ui;
  });
});
