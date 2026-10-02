// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Mission } from "../../../compartilhado/dominio";
import { DecoracaoVcs } from "../../componentes/DecoracaoVcs";
import { montarComandos, type ContextoPaleta } from "../../estado/paleta";
import { criarStoreMissoes } from "../../estado/missoes";
import { criarStoreVcs } from "../../estado/vcs";
import { aoPedirVcs, pedirVcs } from "../../estado/vcs-acoes";
import { criarStoreWorkspaces } from "../../estado/workspaces";
import { SecaoVcsMissao } from "../missoes/SecaoVcs";
import { TelaVersionamento } from "./index";
import { apiFalsa, diffSimples, estadoDe, mud, WS } from "./teste-fixtures";

const alvo = { workspace_id: WS.id, mission_id: null };

describe("DecoracaoVcs (T-06.33)", () => {
  it("mostra branch, sujo e ahead/behind e atualiza com vcs:mudou; solta o observador ao desmontar", async () => {
    const e = estadoDe([mud("a", " ", "M")], {}, { ahead: 2, behind: 1 });
    const f = apiFalsa(e);
    const store = criarStoreVcs({ api: () => f.api });
    const { unmount } = render(<DecoracaoVcs alvo={alvo} store={store} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("feature/x ● ↑2 ↓1"));
    act(() => f.emitir({ ...alvo, resumo: { ...e.resumo, branch: "main", sujo: false, ahead: 0, behind: 0 } }));
    expect(screen.getByRole("status").textContent).toBe("main");
    expect(screen.getByRole("status").getAttribute("aria-label")).toContain("limpo");
    unmount();
    expect(f.mocks.observar).toHaveBeenLastCalledWith(alvo, false);
  });
  it("sem repositório não mostra nada", async () => {
    const e = estadoDe([]);
    const f = apiFalsa(e, { observar: vi.fn().mockResolvedValue({ ...e.resumo, tipo: "nenhum" }) });
    const store = criarStoreVcs({ api: () => f.api });
    const { container } = render(<DecoracaoVcs alvo={alvo} store={store} />);
    await act(async () => undefined);
    expect(container.innerHTML).toBe("");
  });
});

describe("Paleta (T-06.36)", () => {
  const base = (vcs: NonNullable<ContextoPaleta["vcs"]> | null): ContextoPaleta => ({ mac: true, workspaceAtual: { id: "w", nome: "p" }, recentes: [], trabalhos: [], temaEfetivo: "escuro", vcs, acoes: { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() } });
  const ids = (c: ContextoPaleta): string[] => montarComandos(c).filter((x) => x.grupo === "Versionamento").map((x) => x.id);
  it("só oferece o que faz sentido: push só com commits à frente, stash só com mudanças", () => {
    expect(ids(base({ tipo: "git", sujo: false, staged: 0, ahead: 0, behind: 0, operacao: false }))).toEqual(["vcs:commit", "vcs:branches", "vcs:fetch", "vcs:pull", "vcs:prs"]);
    expect(ids(base({ tipo: "git", sujo: true, staged: 1, ahead: 2, behind: 0, operacao: false }))).toEqual(expect.arrayContaining(["vcs:push", "vcs:stash"]));
  });
  it("SVN só tem comitar; sem repositório ou sem workspace nada aparece", () => {
    expect(ids(base({ tipo: "svn", sujo: true, staged: 0, ahead: 0, behind: 0, operacao: false }))).toEqual(["vcs:commit"]);
    expect(ids(base(null))).toEqual([]);
    expect(ids({ ...base({ tipo: "git", sujo: true, staged: 0, ahead: 0, behind: 0, operacao: false }), workspaceAtual: null })).toEqual([]);
  });
  it("pedido sem ouvinte espera o primeiro ouvinte interessado (tela lazy)", () => {
    const cb = vi.fn();
    pedirVcs("fetch");
    const outro = aoPedirVcs(vi.fn(), ["commit"]);
    const des = aoPedirVcs(cb, ["fetch"]);
    expect(cb).toHaveBeenCalledWith("fetch");
    outro(); des();
  });
});

const mis = (extra: Partial<Mission> = {}): Mission => ({ id: "mis_01J8ZXAMPLE0000000000000A1", workspace_id: WS.id, modo: "livre", origem: "feature", trabalho_id: "cobranca", titulo: "Cobrança", estado: "executando", worktree: "../p--cobranca", branch: "feature/cobranca", piloto_pane_id: null, concluida_em: null, criado_em: "x", atualizado_em: "x", ...extra }) as Mission;

describe("Missão ↔ VCS (T-06.34)", () => {
  it("lista os commits registrados na entrega e clicar abre o diff do commit; commit ausente fica desabilitado", async () => {
    const f = apiFalsa(estadoDe([]), {
      missao: vi.fn().mockImplementation(async (_id, op) => (op === "commits" ? [{ task: "T-01.01", commit: "a".repeat(40), assunto: "feat: pix", existe: true }, { task: "T-01.02", commit: "b".repeat(40), assunto: null, existe: false }] : { mission_id: "m", tipo: "git", branch: "feature/cobranca", worktree: "../p--cobranca", base: "main", existe: true, resumo: null, pr: { numero: 7, url: "https://x/7", estado: "aberto", checks_falhando: 2 } })),
      historico: vi.fn().mockResolvedValue({ hash: "a".repeat(40), assunto: "feat: pix", diff: diffSimples() }),
    });
    await act(async () => { render(<SecaoVcsMissao missao={mis()} api={f.api} />); });
    expect(await screen.findByText(/PR #7 · aberto · 2 check/)).toBeTruthy();
    const botoes = screen.getAllByRole("button", { name: /^[0-9a-f]{7}$/ });
    expect((botoes[1] as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(botoes[0]!); });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(f.mocks.historico).toHaveBeenCalledWith({ workspace_id: WS.id, mission_id: mis().id }, "detalhe", { rev: "a".repeat(40) });
  });
  it("diff contra a base; Missão sem árvore própria não mostra a seção", async () => {
    const f = apiFalsa(estadoDe([]), { missao: vi.fn().mockImplementation(async (_i, op) => (op === "diff_base" ? diffSimples() : op === "commits" ? [] : { mission_id: "m", tipo: "git", branch: null, worktree: "x", base: "main", existe: true, resumo: null, pr: null })) });
    await act(async () => { render(<SecaoVcsMissao missao={mis()} api={f.api} />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Diff contra a base" })); });
    expect(f.mocks.missao).toHaveBeenCalledWith(mis().id, "diff_base", { caminho: null });
    const { container } = render(<SecaoVcsMissao missao={mis({ worktree: null })} api={f.api} />);
    expect(container.innerHTML).toBe("");
  });
});

async function montarTela(estado = estadoDe([mud("c.ts", "U", "U", "conflito")]), sobre: Parameters<typeof apiFalsa>[1] = {}) {
  const f = apiFalsa(estado, sobre);
  const ws = criarStoreWorkspaces({ api: () => ({ estado: vi.fn().mockResolvedValue({ atual: WS, recentes: [WS] }), assinar: vi.fn(() => () => undefined) }) as never });
  const mi = criarStoreMissoes({ api: () => ({ listar: vi.fn().mockResolvedValue({ itens: [], proximo: null }), assinar: vi.fn(() => () => undefined) }) as never });
  await ws.iniciar();
  await act(async () => { render(<TelaVersionamento api={f.api} workspaces={ws} missoes={mi} store={criarStoreVcs({ api: () => f.api })} />); });
  return f;
}

describe("Conflitos e histórico", () => {
  it("3 vias: escolher nossa/deles por trecho e aplicar chama resolver_hunks com marcar", async () => {
    const hunk = { id: 0, linha: 3, rotuloNossa: "HEAD", rotuloDeles: "outro", rotuloBase: "base", nossa: "a\n", deles: "b\n", base: "o\n" };
    const conflitos = vi.fn().mockImplementation(async (_a, op) => {
      if (op === "listar") return [{ caminho: "c.ts", tipo: "texto", opcoes: ["nossa", "deles"], hunks: 1 }];
      if (op === "ler") return { partes: [{ tipo: "conflito", hunk }], hunks: [hunk], estilo: "diff3", info: { caminho: "c.ts", tipo: "texto", opcoes: ["nossa", "deles"], hunks: 1 }, eol: "lf" };
      return { restantes: 0, marcado: true };
    });
    const f = await montarTela(undefined, { conflitos });
    fireEvent.click(screen.getByRole("tab", { name: /Conflitos/ }));
    fireEvent.click(await screen.findByRole("button", { name: /c\.ts/ }));
    expect(await screen.findByRole("region", { name: "Base" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Nossa" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Deles" })).toBeTruthy();
    expect(screen.getByText("⟨pendente⟩")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deles" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aplicar e marcar resolvido" })); });
    expect(conflitos).toHaveBeenCalledWith(expect.anything(), "resolver_hunks", { caminho: "c.ts", resolucoes: { "0": "deles" }, marcar: true });
    expect(f.mocks.estado.mock.calls.length).toBeGreaterThan(1);
  });
  it("histórico: grafo por commit, abrir detalhe com diff e carregar mais pelo cursor", async () => {
    const c = (i: number) => ({ hash: String(i).padStart(40, "0"), hashCurto: String(i).padStart(7, "0"), pais: [], autor: "a", email: "e", data: "2026-01-01T00:00:00Z", assunto: `commit ${i}`, refs: i === 1 ? ["HEAD -> main"] : [] });
    const g = (h: string) => ({ hash: h, coluna: 0, entra: [], passa: [], saidas: [0], largura: 1 });
    const historico = vi.fn().mockImplementation(async (_a, op, args) => {
      if (op === "log") return args.cursor === null ? { commits: [c(1), c(2)], grafo: [g(c(1).hash), g(c(2).hash)], proximo: { hash: c(2).hash, indice: 1, pistas: [null] }, duracaoMs: 1 } : { commits: [c(3)], grafo: [g(c(3).hash)], proximo: null, duracaoMs: 1 };
      return { ...c(1), commiter: "a", corpo: "corpo longo", diff: diffSimples(), insercoes: 1, delecoes: 1 };
    });
    const f = await montarTela(estadoDe([]), { historico });
    fireEvent.click(screen.getByRole("tab", { name: /Histórico/ }));
    expect(await screen.findByText("commit 1")).toBeTruthy();
    expect(document.querySelectorAll("svg.vc-grafo").length).toBe(2);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Carregar mais" })); });
    expect(await screen.findByText("commit 3")).toBeTruthy();
    expect(historico).toHaveBeenCalledWith(expect.anything(), "log", expect.objectContaining({ cursor: { hash: c(2).hash, indice: 1, pistas: [null] } }));
    await act(async () => { fireEvent.click(screen.getByText("commit 2")); });
    expect(await screen.findByRole("region", { name: "Diff do commit" })).toBeTruthy();
    expect(f.mocks.historico).toHaveBeenCalledWith(expect.anything(), "detalhe", { rev: c(2).hash });
  });
  it("PRs: sem remoto reconhecido o app segue só com git (mensagem clara); com forge lista PRs e não oferece merge", async () => {
    const f1 = await montarTela(estadoDe([]));
    fireEvent.click(screen.getByRole("tab", { name: /PRs/ }));
    expect(await screen.findByText(/Sem remoto reconhecível/)).toBeTruthy();
    expect(f1.mocks.forge).toHaveBeenCalled();
  });
  it("PRs com forge autenticado: lista e não há botão de merge", async () => {
    const forge = vi.fn().mockImplementation(async (_a, op) => {
      if (op === "estado") return { provedor: "github", forge: { provedor: "github", cli: { nome: "gh", instalada: true, versao: "2" }, autenticado: true, contas: [], repo: { host: "github.com", caminho: "o/r" }, degradado: false, instrucao: null } };
      if (op === "prs_listar") return { itens: [{ numero: 5, titulo: "Meu PR", estado: "aberto", rascunho: false, autor: "x", ramoOrigem: "a", ramoDestino: "main", url: "https://x", criadoEm: "", atualizadoEm: "", labels: [], revisao: "nenhuma", checks: { total: 2, sucesso: 1, falha: 1, pendente: 0 } }], truncado: false };
      return [];
    });
    await montarTela(estadoDe([]), { forge });
    fireEvent.click(screen.getByRole("tab", { name: /PRs/ }));
    const linha = await screen.findByText("Meu PR");
    expect(within(linha.closest("button")!).getByText(/1 check\(s\) falhando/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mesclar|merge/i })).toBeNull();
  });
});
