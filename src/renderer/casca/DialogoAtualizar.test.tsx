// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiVcsPublicar, PedidoPedirMerge, PreparoAtualizar, ResultadoAtualizar, ResultadoBuscaRemoto, ResultadoEnviarInstrucao, ResultadoIgnorarSuite } from "../../compartilhado/vcs-publicar";
import { criarStorePublicar } from "../estado/vcs-publicar";
import DialogoAtualizar from "./DialogoAtualizar";

afterEach(() => cleanup());

const WS = "ws_AAAAAAAAAAAA";
const preparo = (p: Partial<PreparoAtualizar> = {}): PreparoAtualizar => ({ workspace_id: WS, branch: "main", upstream: "origin/main", remoto: "origin", repo: "dono/repo", commits: 3, a_frente: 0, arquivos_tocados: 2, arquivos: ["src/a.ts", "src/b.ts"], mais: 0, assuntos: ["feat: b", "feat: a"], conflita: [], divergiu: false, operacao_em_curso: false, clis: [{ id: "claude", nome: "Claude Code" }, { id: "codex", nome: "Codex" }], cli_padrao: "claude", cli_foco: null, ...p });
const entregue: ResultadoEnviarInstrucao = { estado: "entregue", motivo: null, pane_id: "pane_1", sessao_id: "sessao_1", entrega: "escrita", instrucao_rel: "x.md" };

async function abrir(p: PreparoAtualizar) {
  const api = {
    estado: vi.fn(async () => ({}) as never),
    prepararCommitPush: vi.fn(async () => ({}) as never),
    prepararPr: vi.fn(async () => ({}) as never),
    enviarInstrucao: vi.fn(async () => entregue),
    abrirUrl: vi.fn(async () => true),
    buscarRemoto: vi.fn(async (_w: string, _f: boolean): Promise<ResultadoBuscaRemoto> => ({ buscou: true, atras: p.commits, erro: null })),
    prepararAtualizar: vi.fn(async () => p),
    atualizar: vi.fn(async (): Promise<ResultadoAtualizar> => ({ estado: "ok", motivo: null, trouxe: p.commits, sugerir_commitar: false })),
    pedirMerge: vi.fn(async (_p: PedidoPedirMerge) => entregue),
    ignorarSuite: vi.fn(async (): Promise<ResultadoIgnorarSuite> => ({ estado: "nada", linhas: 0 })),
  } satisfies ApiVcsPublicar;
  const avisos: string[] = [];
  const store = criarStorePublicar({ api: () => api, avisar: (t) => avisos.push(t), focar: () => undefined, sessaoEmFoco: () => null, agendar: () => () => undefined, atualizarResumo: () => undefined });
  store.definirWorkspace(WS);
  await store.abrirAtualizar();
  render(<DialogoAtualizar store={store} />);
  await act(async () => { await Promise.resolve(); });
  return { api, store, avisos };
}

describe("diálogo Atualizar (D-693)", () => {
  it("'Trazer N commits de origin/main para main' com resumo (arquivos tocados e assuntos, só nomes) e uma ação primária", async () => {
    await abrir(preparo());
    const d = screen.getByRole("dialog", { name: "Atualizar" });
    expect(d.textContent).toContain("Trazer 3 commits de origin/main para main");
    expect(d.textContent).toContain("2 arquivos tocados");
    expect(within(d).getByRole("list", { name: "Commits que entram" }).textContent).toContain("feat: b");
    expect(within(d).getByRole("list", { name: "Primeiros arquivos tocados" }).textContent).toContain("src/a.ts");
    expect(d.querySelectorAll(".botao-primario")).toHaveLength(1);
    expect(within(d).getByText(/git pull --ff-only/)).toBeTruthy();
  });
  it("confirmar roda o pull, mostra o toast e fecha", async () => {
    const { api, store, avisos } = await abrir(preparo());
    fireEvent.click(screen.getByRole("button", { name: "Trazer 3 commits" }));
    await waitFor(() => expect(api.atualizar).toHaveBeenCalledWith(WS));
    await waitFor(() => expect(store.obter().atualizar).toBeNull());
    expect(avisos).toEqual(["Trouxe 3 commits"]);
  });
  it("árvore suja que conflita: lista os arquivos, sugere commitar e bloqueia o botão", async () => {
    await abrir(preparo({ conflita: ["README.md"] }));
    const alerta = screen.getByRole("alert");
    expect(alerta.textContent).toContain("Alterações locais no caminho");
    expect(alerta.textContent).toContain("README.md");
    expect(alerta.textContent).toMatch(/commit|stash/);
    expect((screen.getByRole("button", { name: /Trazer/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("recusado pelo main: mostra o motivo e a dica", async () => {
    const { api } = await abrir(preparo());
    api.atualizar.mockResolvedValueOnce({ estado: "recusado", motivo: "Você alterou localmente arquivos que o remoto também mudou (a.ts)", trouxe: 0, sugerir_commitar: true });
    fireEvent.click(screen.getByRole("button", { name: "Trazer 3 commits" }));
    const alerta = await screen.findByText(/Você alterou localmente/);
    expect(alerta.textContent).toContain("Dica: use “Commit e push”");
  });
  it("divergiu: explica ('o branch divergiu: peça ao agente para fazer o merge') e oferece enviar a instrução à CLI; nunca merge sozinho", async () => {
    const { api, store } = await abrir(preparo({ divergiu: true, a_frente: 2 }));
    const d = screen.getByRole("dialog", { name: "Atualizar" });
    expect(d.textContent).toContain("O branch divergiu do remoto");
    expect(d.textContent).toContain("peça ao agente para fazer o merge");
    expect(within(d).queryByRole("button", { name: /^Trazer/ })).toBeNull();
    fireEvent.change(within(d).getByLabelText("Agente que vai fazer o merge"), { target: { value: "codex" } });
    fireEvent.click(within(d).getByRole("button", { name: "Pedir ao agente para fazer o merge" }));
    await waitFor(() => expect(api.pedirMerge).toHaveBeenCalledWith({ workspace_id: WS, sessao_foco: null, cli: "codex", modo_painel: "auto" }));
    await waitFor(() => expect(store.obter().atualizar).toBeNull());
    expect(api.atualizar).not.toHaveBeenCalled();
  });
  it("divergência descoberta só ao executar: a tela vira a de merge", async () => {
    const { api } = await abrir(preparo());
    api.atualizar.mockResolvedValueOnce({ estado: "divergiu", motivo: "O branch divergiu do remoto: peça ao agente para fazer o merge.", trouxe: 0, sugerir_commitar: false });
    fireEvent.click(screen.getByRole("button", { name: "Trazer 3 commits" }));
    expect(await screen.findByRole("button", { name: "Pedir ao agente para fazer o merge" })).toBeTruthy();
  });
  it("já atualizado: mensagem e botão primário desabilitado", async () => {
    await abrir(preparo({ commits: 0, arquivos_tocados: 0, arquivos: [], assuntos: [] }));
    expect(screen.getByRole("dialog").textContent).toContain("Já está atualizado");
    expect((screen.getByRole("button", { name: /^Trazer/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("merge em andamento bloqueia", async () => {
    await abrir(preparo({ operacao_em_curso: true }));
    expect(screen.getByRole("alert").textContent).toContain("merge/rebase em andamento");
    expect((screen.getByRole("button", { name: /^Trazer/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("agente ocupado no pedido de merge: pergunta antes de abrir painel novo", async () => {
    const { api } = await abrir(preparo({ divergiu: true, a_frente: 1 }));
    api.pedirMerge.mockResolvedValueOnce({ estado: "ocupado", motivo: "x", pane_id: "p", sessao_id: null, entrega: null, instrucao_rel: null });
    fireEvent.click(screen.getByRole("button", { name: "Pedir ao agente para fazer o merge" }));
    expect(await screen.findByText("O agente está trabalhando. Abrir um painel novo para isto?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir painel novo" }));
    await waitFor(() => expect(api.pedirMerge).toHaveBeenLastCalledWith({ workspace_id: WS, sessao_foco: null, cli: "claude", modo_painel: "novo" }));
  });
});
