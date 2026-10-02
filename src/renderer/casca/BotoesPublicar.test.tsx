// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiVcsPublicar, EstadoPublicacao, PreparoPublicacao, ResultadoEnviarInstrucao } from "../../compartilhado/vcs-publicar";
import type { ResumoVcs } from "../../compartilhado/vcs";
import { criarStoreVcs } from "../estado/vcs";
import { criarStorePublicar, type StorePublicar } from "../estado/vcs-publicar";
import { criarStoreWorkspaces } from "../estado/workspaces";
import { BotoesPublicar, tipoDoAtalho } from "./BotoesPublicar";
import type { TelaId } from "./telas";

afterEach(() => { cleanup(); });

const WS = "ws_AAAAAAAAAAAA";
const fatos = (p: Partial<EstadoPublicacao> = {}): EstadoPublicacao => ({ git: true, remoto_github: true, repo: "dono/repo", gh: "ok", branch: "feat/x", ramo_padrao: "main", no_padrao: false, alteradas: 3, novas: 0, suite: { itens: 0, caminhos: [] }, atras: 0, upstream: null, a_frente: 2, a_frente_base: 2, tem_upstream: false, operacao_em_curso: false, oid: "aaa1111", pr: null, ...p });
const preparo = (p: Partial<PreparoPublicacao> = {}): PreparoPublicacao => ({ tipo: "commit_push", workspace_id: WS, branch: "feat/x", remoto: "origin", repo: "dono/repo", ramo_padrao: "main", no_padrao: false, total_arquivos: 3, novos: 0, suite: { itens: 0, caminhos: [], incluiveis: 0 }, adicionadas: 5, removidas: 1, arquivos: [{ caminho: "src/a.ts", situacao: "modificado", sensivel: false }], mais: 0, sensiveis: [], a_frente: 2, tem_upstream: false, sugestao_ramo: "feat/x-1001", clis: [{ id: "claude", nome: "Claude Code" }], cli_padrao: "claude", cli_foco: null, ...p });
const resumo = (p: Partial<ResumoVcs> = {}): ResumoVcs => ({ tipo: "git", branch: "feat/x", oid: "aaa1111", sujo: true, ahead: 2, behind: 0, staged: 0, nao_staged: 3, nao_rastreados: 0, conflitos: 0, operacao: null, calculando: false, degradado: false, ...p });

async function montar(o: { tela?: TelaId; fatos?: EstadoPublicacao | Error; ws?: boolean; resultado?: ResultadoEnviarInstrucao } = {}) {
  const api = {
    estado: vi.fn(async () => { if (o.fatos instanceof Error) throw o.fatos; return o.fatos ?? fatos(); }),
    prepararCommitPush: vi.fn(async () => preparo()),
    prepararPr: vi.fn(async () => preparo({ tipo: "pr" })),
    enviarInstrucao: vi.fn(async (): Promise<ResultadoEnviarInstrucao> => o.resultado ?? { estado: "entregue", motivo: null, pane_id: "pane_1", sessao_id: "sessao_1", entrega: "escrita", instrucao_rel: "x.md" }),
    abrirUrl: vi.fn(async () => true),
    buscarRemoto: vi.fn(async () => ({ buscou: false, atras: 0, erro: null })),
    prepararAtualizar: vi.fn(async () => ({}) as never),
    atualizar: vi.fn(async () => ({ estado: "ok", motivo: null, trouxe: 1, sugerir_commitar: false }) as never),
    pedirMerge: vi.fn(async () => ({}) as never),
    ignorarSuite: vi.fn(async () => ({ estado: "ok", linhas: 1 }) as never),
  } satisfies ApiVcsPublicar;
  const focadas: string[] = [];
  const store: StorePublicar = criarStorePublicar({ api: () => api, avisar: () => 1, focar: (id) => void focadas.push(id), sessaoEmFoco: () => null, agendar: () => () => undefined });
  const vcs = criarStoreVcs({ api: () => ({ observar: vi.fn(async () => resumo()), assinar: () => () => undefined }) as never });
  const workspaces = criarStoreWorkspaces({ api: () => ({ estado: async () => ({ atual: o.ws === false ? null : { id: WS }, recentes: [] }), assinar: () => () => undefined }) as never });
  await workspaces.iniciar();
  const r = render(<BotoesPublicar tela={o.tela ?? "terminais"} store={store} vcs={vcs} workspaces={workspaces} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { api, store, focadas, ...r };
}

describe("visibilidade no cabeçalho (D-630)", () => {
  it("na tela Terminais, repo git com origin no GitHub: os dois botões, com nome, estado e badge", async () => {
    await montar();
    const grupo = await screen.findByRole("group", { name: "Publicar no GitHub" });
    const commit = within(grupo).getByRole("button", { name: /Commit e push \(3 · ↑2\)/ });
    const pr = within(grupo).getByRole("button", { name: /Enviar PR/ });
    expect(commit.getAttribute("aria-disabled")).toBe("false");
    expect(pr.getAttribute("aria-disabled")).toBe("false");
    expect(commit.getAttribute("title")).toMatch(/3 arquivos alterados e 2 commits para enviar/);
    expect(commit.querySelector(".topo-pub-badge")?.textContent).toBe("3 · ↑2");
  });
  it.each(["inicio", "missoes", "metodo", "versionamento", "config"] as TelaId[])("tela %s: nada de botões e nenhuma consulta ao main", async (tela) => {
    const m = await montar({ tela });
    expect(screen.queryByRole("group", { name: "Publicar no GitHub" })).toBeNull();
    expect(m.api.estado).not.toHaveBeenCalled();
  });
  it("sem workspace, sem git, sem GitHub ou erro: nada aparece", async () => {
    await montar({ ws: false });
    expect(screen.queryByRole("group", { name: "Publicar no GitHub" })).toBeNull();
    cleanup();
    await montar({ fatos: fatos({ git: false }) });
    expect(screen.queryByRole("group", { name: "Publicar no GitHub" })).toBeNull();
    cleanup();
    await montar({ fatos: fatos({ remoto_github: false }) });
    expect(screen.queryByRole("group", { name: "Publicar no GitHub" })).toBeNull();
    cleanup();
    await montar({ fatos: new Error("falhou") });
    expect(screen.queryByRole("group", { name: "Publicar no GitHub" })).toBeNull();
  });
  it("gh ausente: Enviar PR desabilitado com o tooltip, e Commit e push continua habilitado", async () => {
    await montar({ fatos: fatos({ gh: "ausente" }) });
    const pr = await screen.findByRole("button", { name: /Enviar PR/ });
    expect(pr.getAttribute("aria-disabled")).toBe("true");
    expect(pr.getAttribute("title")).toBe("Instale/autentique o gh (gh auth login)");
    expect(screen.getByRole("button", { name: /Commit e push/ }).getAttribute("aria-disabled")).toBe("false");
  });
  it("sem alterações: 'Nada para commitar'; com commits locais: 'Enviar commits'; branch padrão: PR 'Crie um branch primeiro'", async () => {
    await montar({ fatos: fatos({ alteradas: 0, novas: 0, suite: { itens: 0, caminhos: [] }, atras: 0, upstream: null, a_frente: 0, branch: "main", no_padrao: true }) });
    const b = await screen.findByRole("button", { name: /Commit e push/ });
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("title")).toBe("Nada para commitar");
    expect(screen.getByRole("button", { name: /Enviar PR/ }).getAttribute("title")).toBe("Crie um branch primeiro");
    cleanup();
    await montar({ fatos: fatos({ alteradas: 0, novas: 0, suite: { itens: 0, caminhos: [] }, atras: 0, upstream: null, a_frente: 2 }) });
    expect(await screen.findByRole("button", { name: /Enviar commits/ })).toBeTruthy();
  });
  it("desabilitado não abre o diálogo; os botões ficam logo no grupo (ícone e rótulo curto, 16 px de ícone via CSS)", async () => {
    const m = await montar({ fatos: fatos({ alteradas: 0, novas: 0, suite: { itens: 0, caminhos: [] }, atras: 0, upstream: null, a_frente: 0 }) });
    const b = await screen.findByRole("button", { name: /Commit e push/ });
    fireEvent.click(b);
    expect(m.api.prepararCommitPush).not.toHaveBeenCalled();
    expect(b.querySelector("svg.icone")).not.toBeNull();
    expect(b.querySelector(".topo-pub-rotulo")?.textContent).toBe("Commit e push");
  });
});

describe("clique e atalhos", () => {
  it("clicar em Commit e push abre o diálogo (preparo com a sessão em foco) e NÃO envia nada ainda", async () => {
    const m = await montar();
    fireEvent.click(await screen.findByRole("button", { name: /Commit e push/ }));
    expect(await screen.findByRole("dialog", { name: "Commit e push" })).toBeTruthy();
    expect(m.api.prepararCommitPush).toHaveBeenCalledWith(WS, null);
    expect(m.api.enviarInstrucao).not.toHaveBeenCalled();
  });
  it("Enviar PR abre o diálogo do PR", async () => {
    const m = await montar();
    fireEvent.click(await screen.findByRole("button", { name: /Enviar PR/ }));
    expect(await screen.findByRole("dialog", { name: "Enviar PR" })).toBeTruthy();
    expect(m.api.prepararPr).toHaveBeenCalled();
  });
  it("atalhos ⌘⇧U / ⌘⇧Y (mac) e Ctrl+Shift+U/Y; sem conflito com ⌘K, ⌘⇧K (Chat), ⌘⇧G (Conhecimento) nem ⌘⇧D/L/M/E", () => {
    const ev = (key: string, p: Partial<Parameters<typeof tipoDoAtalho>[0]> = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, ...p });
    expect(tipoDoAtalho(ev("U", { metaKey: true }), true)).toBe("commit_push");
    expect(tipoDoAtalho(ev("Y", { metaKey: true }), true)).toBe("pr");
    expect(tipoDoAtalho(ev("U", { ctrlKey: true }), false)).toBe("commit_push");
    expect(tipoDoAtalho(ev("Y", { ctrlKey: true }), false)).toBe("pr");
    for (const k of ["d", "l", "m", "e", "n", "w", "j", "p", "k", "g", "o", "a", "b", "f"]) {
      expect(tipoDoAtalho(ev(k, { metaKey: true }), true)).toBeNull();
      expect(tipoDoAtalho(ev(k, { ctrlKey: true }), false)).toBeNull();
    }
    expect(tipoDoAtalho(ev("u", { metaKey: true, shiftKey: false }), true)).toBeNull(); // sem Shift não é nosso
    expect(tipoDoAtalho(ev("u", { ctrlKey: true }), true)).toBeNull(); // ctrl no mac é do processo
    expect(tipoDoAtalho(ev("u", { ctrlKey: true, altKey: true }), false)).toBeNull();
  });
  it("o atalho abre o diálogo só com o botão habilitado", async () => {
    const m = await montar();
    await screen.findByRole("group", { name: "Publicar no GitHub" });
    fireEvent.keyDown(window, { key: "U", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(m.api.prepararCommitPush).toHaveBeenCalled());
    cleanup();
    const n = await montar({ fatos: fatos({ alteradas: 0, novas: 0, suite: { itens: 0, caminhos: [] }, atras: 0, upstream: null, a_frente: 0 }) });
    await screen.findByRole("group", { name: "Publicar no GitHub" });
    fireEvent.keyDown(window, { key: "U", ctrlKey: true, shiftKey: true });
    expect(n.api.prepararCommitPush).not.toHaveBeenCalled();
  });
});

describe("depois de enviar", () => {
  it("entregue: diálogo fecha, o painel é focado e a faixa discreta aparece com 'Acompanhar' e região viva", async () => {
    const m = await montar();
    fireEvent.click(await screen.findByRole("button", { name: /Commit e push/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Commit e push" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Enviar instrução ao agente" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.focadas).toEqual(["sessao_1"]);
    const faixa = document.querySelector(".pub-faixa") as HTMLElement;
    expect(faixa.textContent).toContain("Commit e push enviado ao agente…");
    fireEvent.click(within(faixa).getByRole("button", { name: "Acompanhar" }));
    expect(m.focadas).toEqual(["sessao_1", "sessao_1"]);
    const vivos = [...document.querySelectorAll('[role="status"][aria-live="polite"]')].map((e) => e.textContent);
    expect(vivos).toContain("Commit e push enviado ao agente…");
  });
  it("falhou: continua no diálogo com o motivo e não navega", async () => {
    const m = await montar({ resultado: { estado: "falhou", motivo: "A CLI Claude Code saiu antes de receber a instrução.", pane_id: null, sessao_id: null, entrega: null, instrucao_rel: null } });
    fireEvent.click(await screen.findByRole("button", { name: /Commit e push/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Enviar instrução ao agente" }));
    expect((await screen.findByRole("alert")).textContent).toContain("saiu antes de receber a instrução");
    expect(m.focadas).toEqual([]);
    expect(document.querySelector(".pub-faixa")).toBeNull();
  });
});

describe("Atualizar (pull) e a suíte no cabeçalho (D-691..D-693)", () => {
  const PREPARO_ATUALIZAR = { workspace_id: WS, branch: "feat/x", upstream: "origin/feat/x", remoto: "origin", repo: "dono/repo", commits: 3, a_frente: 0, arquivos_tocados: 1, arquivos: ["src/a.ts"], mais: 0, assuntos: ["feat: a"], conflita: [], divergiu: false, operacao_em_curso: false, clis: [{ id: "claude", nome: "Claude Code" }], cli_padrao: "claude", cli_foco: null } as const;

  it("terceiro botão 'Atualizar' com o badge ↓N e o tooltip; habilitado só com commits atrás", async () => {
    await montar({ fatos: fatos({ tem_upstream: true, upstream: "origin/feat/x", atras: 3 }) });
    const grupo = await screen.findByRole("group", { name: "Publicar no GitHub" });
    const b = within(grupo).getByRole("button", { name: /Atualizar \(↓3\)/ });
    expect(b.getAttribute("aria-disabled")).toBe("false");
    expect(b.getAttribute("title")).toBe("Trazer 3 commits de origin/feat/x para feat/x");
    expect(b.querySelector(".topo-pub-badge")?.textContent).toBe("↓3");
    expect([...grupo.querySelectorAll("button[data-acao]")].map((e) => e.getAttribute("data-acao"))).toEqual(["commit_push", "pr", "atualizar"]);
  });
  it("já atualizado e sem upstream: desabilitado com tooltip claro, clique não abre nada", async () => {
    const m = await montar({ fatos: fatos({ tem_upstream: true, upstream: "origin/feat/x", atras: 0 }) });
    const b = await screen.findByRole("button", { name: /Atualizar/ });
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("title")).toBe("Já está atualizado");
    fireEvent.click(b);
    expect(m.api.prepararAtualizar).not.toHaveBeenCalled();
    cleanup();
    await montar({ fatos: fatos({ tem_upstream: false, upstream: null, atras: 0 }) });
    expect((await screen.findByRole("button", { name: /Atualizar/ })).getAttribute("title")).toMatch(/não tem upstream/);
  });
  it("não aparece fora do Terminais nem sem GitHub (mesma regra dos outros botões)", async () => {
    await montar({ tela: "inicio", fatos: fatos({ atras: 3 }) });
    expect(screen.queryByRole("button", { name: /Atualizar/ })).toBeNull();
    cleanup();
    await montar({ fatos: fatos({ remoto_github: false, atras: 3 }) });
    expect(screen.queryByRole("button", { name: /Atualizar/ })).toBeNull();
  });
  it("clicar abre o diálogo 'Atualizar' (busca o remoto por clique e prepara) sem rodar o pull", async () => {
    const m = await montar({ fatos: fatos({ tem_upstream: true, upstream: "origin/feat/x", atras: 3 }) });
    m.api.prepararAtualizar.mockResolvedValue(PREPARO_ATUALIZAR as never);
    fireEvent.click(await screen.findByRole("button", { name: /Atualizar/ }));
    const d = await screen.findByRole("dialog", { name: "Atualizar" });
    expect(m.api.buscarRemoto).toHaveBeenCalledWith(WS, true);
    expect(d.textContent).toContain("Trazer 3 commits de origin/feat/x para feat/x");
    expect(m.api.atualizar).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole("button", { name: "Trazer 3 commits" }));
    await waitFor(() => expect(m.api.atualizar).toHaveBeenCalledWith(WS));
  });
  it("badge só com a suíte: sem número, 'Nada para commitar', mas o clique abre o diálogo para decidir", async () => {
    const m = await montar({ fatos: fatos({ alteradas: 0, a_frente: 0, suite: { itens: 3, caminhos: [".expx/", ".opencode/", ".expxv/"] } }) });
    const b = await screen.findByRole("button", { name: /Commit e push/ });
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.querySelector(".topo-pub-badge")).toBeNull();
    expect(b.getAttribute("title")).toContain("3 pastas da suíte não rastreadas");
    fireEvent.click(b);
    expect(await screen.findByRole("dialog", { name: "Commit e push" })).toBeTruthy();
    expect(m.api.prepararCommitPush).toHaveBeenCalled();
  });
  it("o resumo do Versionamento com mais um commit atrás refaz os fatos (chave inclui behind)", async () => {
    const m = await montar({ fatos: fatos({ tem_upstream: true, upstream: "origin/feat/x", atras: 1 }) });
    await screen.findByRole("group", { name: "Publicar no GitHub" });
    expect(m.api.estado).toHaveBeenCalled();
  });
});
