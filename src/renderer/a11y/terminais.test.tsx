// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EventoTerminal, LayoutTerminais, MetadadosSessao } from "../../compartilhado/terminais";
import { criarArmazem } from "../componentes/Terminal/armazem";
import { criarStoreTerminais } from "../estado/terminais";
import Tela from "../telas/terminais";
import type { PropsTerminalGrade } from "../telas/terminais/Grade";
import { claude, codex } from "./ade-falso";
import { formatar, varrer } from "./varredura";

const meta = (sessao_id: string): MetadadosSessao => ({ sessao_id, ferramenta_id: "claude", estado: "executando", workspace_id: null, criada_em: "x", persistente: true });
const T = (sessao_id: string) => ({ tipo: "terminal" as const, sessao_id });
const layout: LayoutTerminais = {
  versao: 2, ativa: "a", fixadas: [],
  abas: [{ arvore: { tipo: "divisao", orientacao: "vertical", primeiro: T("a"), segundo: T("b") } }, { arvore: T("c") }],
};
const ev = (tipo: EventoTerminal["tipo"], sessao_id: string, sequencia: number, extra: object = {}) => ({ versao: 1, tipo, sessao_id, sequencia, ...extra }) as EventoTerminal;

function montar() {
  let ouvir: (e: EventoTerminal) => void = () => undefined;
  const api = {
    assinarEventos: vi.fn((cb) => { ouvir = cb; return () => undefined; }), assinarFalhas: vi.fn(() => () => undefined),
    recuperar: vi.fn().mockResolvedValue({ sessoes: [meta("a"), meta("b"), meta("c")] }),
    listarFerramentas: vi.fn().mockResolvedValue([claude, codex]),
    abrir: vi.fn(), confirmarConsumo: vi.fn().mockResolvedValue(true), descartar: vi.fn().mockResolvedValue(true), interromper: vi.fn(), escrever: vi.fn(), redimensionar: vi.fn(),
    lerLayout: vi.fn().mockResolvedValue(layout), gravarLayout: vi.fn().mockResolvedValue(true),
  };
  const armazem = criarArmazem();
  const store = criarStoreTerminais({ api: () => api as never, armazem });
  const Terminal = ({ sessaoId, rotulo }: PropsTerminalGrade) => {
    const ref = useRef<HTMLTextAreaElement>(null);
    useEffect(() => undefined, []);
    return <textarea ref={ref} aria-label={`Terminal ${rotulo}`} data-testid={`term-${sessaoId}`} readOnly />;
  };
  render(<Tela store={store} api={api as never} Terminal={Terminal} tema="escuro" atrasoGravacao={5} />);
  return { emitir: (e: EventoTerminal) => act(() => ouvir(e)) };
}
const confere = (onde: string): void => {
  const achados = varrer(document.body);
  expect(achados.length === 0 ? "" : `${onde}\n${formatar(achados)}`).toBe("");
};

describe("varredura de acessibilidade: Terminais", () => {
  it("abas, painéis divididos, sinaleira, menu de nova sessão e ajuda", async () => {
    const { emitir } = montar();
    await screen.findByTestId("term-a");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    confere("Terminais: abas e painéis");
    emitir(ev("atividade", "b", 1, { atividade: "aguardando" }));
    await screen.findByRole("button", { name: /aguardando você/ });
    confere("Terminais: aguardando");
    fireEvent.click(screen.getByRole("button", { name: /Nova sessão/ }));
    await screen.findByRole("menu", { name: "Escolher CLI ou ferramenta" });
    confere("Terminais: menu de nova sessão");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Nova sessão/ })); // Esc devolve o foco ao botão
    fireEvent.click(screen.getByRole("button", { name: "Atalhos de teclado" }));
    await screen.findByRole("dialog", { name: "Atalhos de teclado" });
    confere("Terminais: ajuda de atalhos");
  });

  it("setas movem só o foco entre as abas (ativação manual: Enter seleciona); o painel é nomeado pela aba ativa", async () => {
    montar();
    await screen.findByTestId("term-a");
    const [um, dois] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
    um.focus();
    expect([um.tabIndex, dois.tabIndex]).toEqual([0, -1]);
    await act(async () => { fireEvent.keyDown(um, { key: "ArrowRight" }); });
    await waitFor(() => expect(document.activeElement).toBe(dois));
    expect(dois.getAttribute("aria-selected")).toBe("false"); // só o foco andou
    await act(async () => { fireEvent.click(dois); }); // Enter/Espaço num <button> é um clique
    expect(dois.getAttribute("aria-selected")).toBe("true");
    const painel = screen.getByRole("tabpanel");
    expect(painel.getAttribute("aria-labelledby")).toBe(dois.id);
    expect(dois.getAttribute("aria-controls")).toBe(painel.id);
  });

  it("todo botão de ícone dos painéis tem nome acessível com o rótulo do painel", async () => {
    montar();
    await screen.findByTestId("term-a");
    for (const nome of [/^Fechar #1/, /^Expandir #1/, /^Fechar aba/]) expect(screen.getAllByRole("button", { name: nome }).length).toBeGreaterThan(0);
    for (const b of document.querySelectorAll(".terminais-barra button, .terminais-painel-acoes button")) {
      expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim(), b.outerHTML).not.toBe("");
    }
  });

  it("o divisor entre painéis é focável e operável por teclado", async () => {
    montar();
    await screen.findByTestId("term-a");
    const sep = screen.getByRole("separator");
    expect(sep.tabIndex).toBe(0);
    expect(sep.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep.getAttribute("aria-valuenow")).toBe("55");
  });
});
