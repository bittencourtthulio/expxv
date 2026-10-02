// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoClone, LoteProjetos } from "../../compartilhado/workspaces-adicionar";
import { criarStoreAdicionar } from "../estado/adicionar-workspace";
import { criarStoreWorkspaces } from "../estado/workspaces";
import ModalAdicionarWorkspace from "../telas/adicionar-workspace/ModalAdicionarWorkspace";
import { adicionarFalso } from "./ade-falso-adicionar";
import { ws } from "./ade-falso";
import { formatar, varrer } from "./varredura";

// Varredura de acessibilidade do modal "Adicionar workspace" nas três seções e nos estados de consentimento, progresso, erro e pronto.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const confere = (onde: string): void => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };
const assentar = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const ev = (e: Partial<EventoClone>): EventoClone => ({ clone_id: "cl_falso123456", fase: "recebendo", percentual: 45, bytes: 1_048_576, velocidade_bps: 524_288, mensagem: "", workspace: null, erro: null, destino_exibicao: "~/Developer/repo", nao_confiavel: true, ...e });

async function montar() {
  let aoProgresso: (e: EventoClone) => void = () => undefined;
  let aoLote: (l: LoteProjetos) => void = () => undefined;
  const api = {
    ...adicionarFalso(), abrir: vi.fn().mockResolvedValue(null), definirAtual: vi.fn().mockResolvedValue(null),
    adicionarGhEstado: vi.fn().mockResolvedValue({ instalado: true, autenticado: true, usuario: "fulana" }),
    adicionarListarRepos: vi.fn().mockResolvedValue({ ok: true, repos: [{ nome: "r", nome_com_dono: "fulana/r", descricao: "d", privado: true, atualizado_em: "2026-01-01T00:00:00Z", url: "https://github.com/fulana/r" }], truncado: false }),
    assinarAdicionarProgresso: (cb: (e: EventoClone) => void) => { aoProgresso = cb; return () => undefined; },
    assinarAdicionarProjetos: (cb: (l: LoteProjetos) => void) => { aoLote = cb; return () => undefined; },
  };
  const store = criarStoreAdicionar({ api: () => api as never, suite: { garantirEstado: async () => undefined, estadoDe: () => ({ estado: "ausente" }), abrirModalPara: () => undefined }, esperar: async () => undefined });
  const apiWs = { estado: async () => ({ atual: ws("w1"), recentes: [ws("w1"), ws("w2")] }), assinar: () => () => undefined, abrir: async () => null, definirAtual: async () => null, remover: async () => true, definirPermissao: async () => null, worktrees: async () => [] };
  const workspaces = criarStoreWorkspaces({ api: () => apiWs as never });
  await act(async () => { await workspaces.iniciar(); });
  store.abrir("pasta");
  render(<ModalAdicionarWorkspace store={store} workspaces={workspaces} />);
  await assentar();
  return { store, emitir: (e: EventoClone) => act(() => aoProgresso(e)), lote: (l: LoteProjetos) => act(() => aoLote(l)) };
}

describe("varredura de acessibilidade: Adicionar workspace", () => {
  it("Abrir pasta: recentes e busca de projetos", async () => {
    const m = await montar();
    confere("Abrir pasta");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Procurar projetos/ })); });
    await m.lote({ busca_id: "bu_falso123456", itens: [{ id: "ach_falso123456", nome: "app", exibicao: "~/Developer/app", branch: "main", e_git: true, manifesto: null, ja_workspace: false }], visitados: 10, fim: true, cancelada: false, limite_atingido: false });
    confere("Abrir pasta: achados");
  });
  it("Clonar: formulário, repositórios, consentimento, progresso, erro e pronto", async () => {
    const m = await montar();
    fireEvent.click(screen.getByRole("tab", { name: "Clonar repositório" }));
    await assentar();
    confere("Clonar: vazio");
    fireEvent.change(screen.getByLabelText(/URL ou identificador/), { target: { value: "dono/repo" } });
    await assentar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Carregar meus repositórios" })); });
    confere("Clonar: meus repositórios");
    fireEvent.click(screen.getByRole("button", { name: "Revisar e clonar…" }));
    confere("Clonar: consentimento");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clonar" })); });
    await m.emitir(ev({}));
    confere("Clonar: progresso");
    await m.emitir(ev({ fase: "falhou", erro: { codigo: "sem_acesso", mensagem: "Sem acesso. Rode `gh auth login`.", acao: "login_gh", sugestao: null } }));
    confere("Clonar: erro");
    await m.emitir(ev({ fase: "concluido", percentual: 100, workspace: ws("w3") }));
  });
  it("Novo projeto: formulário e pronto", async () => {
    await montar();
    fireEvent.click(screen.getByRole("tab", { name: "Novo projeto" }));
    await assentar();
    confere("Novo projeto");
    fireEvent.change(screen.getByLabelText(/Nome do projeto/), { target: { value: "../x" } });
    confere("Novo projeto: nome inválido");
  });
});
