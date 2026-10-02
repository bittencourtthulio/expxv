// @vitest-environment jsdom
// D-570/D-571: painel de workspaces, seletor do cabeçalho e tela Terminais juntos (stores reais): clicar no cartão troca o conjunto de terminais; contagens e "Sem projeto (N)".
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../compartilhado/dominio";
import type { ItemWorkspaceResumo } from "../../compartilhado/workspaces-resumo";
import type { MetadadosSessao } from "../../compartilhado/terminais";
import { criarArmazem } from "../componentes/Terminal/armazem";
import { SeletorWorkspace } from "../componentes/SeletorWorkspace";
import { criarStorePainelWorkspaces } from "../estado/painel-workspaces";
import { criarStoreTerminais } from "../estado/terminais";
import { storeVisaoTerminais } from "../estado/terminais-visao";
import { criarStoreWorkspaces, type StoreWorkspaces } from "../estado/workspaces";
import Tela from "../telas/terminais";
import type { PropsTerminalGrade } from "../telas/terminais/Grade";
import { PainelWorkspaces } from "./PainelWorkspaces";

const ws = (id: string, nome: string): Workspace => ({ id, nome, raiz: `/p/${nome}`, e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" });
const item = (id: string, nome: string): ItemWorkspaceResumo => ({ id, nome, pasta_mascarada: `~/p/${nome}`, branch: "main", sujo: false, atual: false, missao: null, missoes_ativas: 0, agentes: [], execucao: null, contagens: { agentes: 0, trabalhando: 0, aguardando: 0, erro: 0, subagentes: 0, terminais: 0 } });
const sessao = (sessao_id: string, workspace_id: string | null): Pick<MetadadosSessao, "sessao_id" | "ferramenta_id" | "estado"> & { workspace_id: string | null } => ({ sessao_id, ferramenta_id: "claude", estado: "executando", workspace_id });

function TerminalFalso({ sessaoId }: PropsTerminalGrade) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { ref.current!.textContent = sessaoId; }, [sessaoId]);
  return <pre ref={ref} data-testid={`term-${sessaoId}`} />;
}

const A = ws("A", "alfa"), B = ws("B", "beta"), C = ws("C", "gama");

// API falsa de workspaces ÚNICA (o store global de workspaces assina uma vez só): cada teste redefine o estado e empurra pelo canal de assinatura
let estadoWs = { atual: A as Workspace | null, recentes: [A, B, C] };
let aoMudarWs: (e: typeof estadoWs) => void = () => undefined;
const wsApi = {
  estado: vi.fn(async () => estadoWs), assinar: vi.fn((cb) => { aoMudarWs = cb; return () => undefined; }), abrir: vi.fn(),
  definirAtual: vi.fn(async (id: string) => { estadoWs = { ...estadoWs, atual: estadoWs.recentes.find((w) => w.id === id) ?? null }; aoMudarWs(estadoWs); return null; }),
  remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn(),
};

async function montar(sessoes: ReturnType<typeof sessao>[]) {
  const { storeWorkspaces } = await import("../estado/workspaces");
  // `voz` mínima: o botão de ditado da barra lê `ade().voz` quando a ponte existe (outro módulo; aqui só precisa não quebrar)
  (globalThis as { ade?: unknown }).ade = { workspaces: wsApi, voz: { estado: vi.fn().mockResolvedValue({ atalho: "" }), assinar: vi.fn(() => () => undefined) } };
  wsApi.definirAtual.mockClear();
  estadoWs = { atual: A, recentes: [A, B, C] };
  await storeWorkspaces.iniciar();
  act(() => aoMudarWs(estadoWs));
  const api = {
    assinarEventos: vi.fn(() => () => undefined), assinarFalhas: vi.fn(() => () => undefined), recuperar: vi.fn().mockResolvedValue({ sessoes: sessoes.map((s) => ({ ...s, criada_em: "x", persistente: true })) }),
    listarFerramentas: vi.fn().mockResolvedValue([]), listarSessoes: vi.fn().mockResolvedValue([]), abrir: vi.fn(), confirmarConsumo: vi.fn(), descartar: vi.fn(), interromper: vi.fn(), escrever: vi.fn(), redimensionar: vi.fn(),
    lerLayout: vi.fn().mockResolvedValue(null), gravarLayout: vi.fn().mockResolvedValue(true),
  };
  const terminais = criarStoreTerminais({ api: () => api as never, armazem: criarArmazem() });
  const painelApi = { resumo: vi.fn(async () => ({ versao: 1 as const, gerado_em: 1, itens: [item("A", "alfa"), item("B", "beta"), item("C", "gama")] })), ativarResumo: vi.fn(async (a: boolean) => a), assinarResumo: vi.fn(() => () => undefined), encerrarAgente: vi.fn(), revelar: vi.fn(), copiarCaminho: vi.fn() };
  const guardado = new Map<string, string>();
  const painel = criarStorePainelWorkspaces({ api: () => painelApi as never, armazem: { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => void guardado.set(k, v) } });
  render(
    <>
      <SeletorWorkspace store={storeWorkspaces as StoreWorkspaces} terminais={terminais} />
      <PainelWorkspaces store={painel} workspaces={storeWorkspaces} terminais={terminais} irParaSessao={vi.fn()} irParaTela={vi.fn()} />
      <Tela store={terminais} api={api as never} Terminal={TerminalFalso} tema="escuro" atrasoGravacao={5} infoMissao={{}} />
    </>,
  );
  return { wsApi, terminais };
}

const painelsNaTela = (): string[] => [...document.querySelectorAll<HTMLElement>("[data-sessao]")].map((e) => e.dataset["sessao"]!);

afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; storeVisaoTerminais.sairDeSemProjeto(); });

describe("painel de workspaces + seletor + tela Terminais", () => {
  it("clicar no cartão troca o conjunto de terminais (e volta); o cartão mostra a contagem; as sessões dos outros seguem no store", async () => {
    const m = await montar([sessao("a1", "A"), sessao("a2", "A"), sessao("b1", "B"), sessao("c1", "C"), sessao("c2", "C"), sessao("c3", "C")]);
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1"]));
    const botao = (id: string) => document.querySelector<HTMLElement>(`[data-nav="cartao"][data-ws="${id}"]`)!;
    await waitFor(() => expect(document.querySelector('[data-ws-cartao="C"] .pws-chip-terminais')?.textContent).toBe("3 terminais"));
    expect(document.querySelector('[data-ws-cartao="B"] .pws-chip-terminais')?.textContent).toBe("1 terminal");
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    fireEvent.click(botao("C"));
    await waitFor(() => expect(m.wsApi.definirAtual).toHaveBeenCalledWith("C"));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    expect(painelsNaTela()).toEqual(["c1"]);
    fireEvent.click(botao("B"));
    await waitFor(() => expect(painelsNaTela()).toEqual(["b1"]));
    fireEvent.click(botao("A"));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(m.terminais.obter().sessoes).toHaveLength(6); // nada foi encerrado
  });

  it("o seletor do cabeçalho mostra a contagem discreta por workspace e troca o conjunto", async () => {
    const m = await montar([sessao("a1", "A"), sessao("b1", "B"), sessao("b2", "B")]);
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1"]));
    fireEvent.click(document.querySelector<HTMLElement>(".topo-workspace")!);
    const menu = screen.getByRole("menu", { name: "Workspaces" });
    expect(within(menu).getByRole("menuitemradio", { name: /beta/ }).querySelector(".seletor-ws-n")?.textContent).toBe("2");
    expect(within(menu).getByRole("menuitemradio", { name: /gama/ }).querySelector(".seletor-ws-n")).toBeNull(); // sem terminais: sem número
    expect(within(menu).queryByRole("menuitem", { name: /Sem projeto/ })).toBeNull(); // só quando existir
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /beta/ }));
    await waitFor(() => expect(m.wsApi.definirAtual).toHaveBeenCalledWith("B"));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(painelsNaTela()).toEqual(["b1"]);
  });

  it("'Sem projeto (N)' só aparece com sessões sem workspace; abre o grupo rotulado; escolher qualquer workspace (até o atual) sai dele", async () => {
    await montar([sessao("a1", "A"), sessao("n1", null), sessao("n2", null)]);
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1"]));
    const linha = await screen.findByRole("button", { name: "Sem projeto (2)" });
    expect(document.querySelector('[data-ws-cartao="A"] .pws-chip-terminais')?.textContent).toBe("1 terminal"); // as null não contam em nenhum cartão
    fireEvent.click(linha);
    await screen.findByTestId("grupo-sem-projeto");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(painelsNaTela()).toEqual(["n1"]);
    expect(screen.getByRole("button", { name: "Sem projeto (2)" }).getAttribute("aria-current")).toBe("true");
    // o cartão do workspace atual (A) também volta ao conjunto dele
    fireEvent.click(document.querySelector<HTMLElement>('[data-nav="cartao"][data-ws="A"]')!);
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1"]));
    expect(screen.queryByTestId("grupo-sem-projeto")).toBeNull();
    // pelo seletor
    fireEvent.click(document.querySelector<HTMLElement>(".topo-workspace")!);
    fireEvent.click(within(screen.getByRole("menu", { name: "Workspaces" })).getByRole("menuitem", { name: /Sem projeto \(2\)/ }));
    await screen.findByTestId("grupo-sem-projeto");
    fireEvent.click(document.querySelector<HTMLElement>(".topo-workspace")!);
    fireEvent.click(within(screen.getByRole("menu", { name: "Workspaces" })).getByRole("menuitemradio", { name: /alfa/ }));
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1"]));
  });
});
