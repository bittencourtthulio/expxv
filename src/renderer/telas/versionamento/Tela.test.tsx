// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EstadoVcs } from "../../../compartilhado/vcs";
import { criarStoreMissoes } from "../../estado/missoes";
import { criarStoreVcs } from "../../estado/vcs";
import { criarStoreWorkspaces } from "../../estado/workspaces";
import { TelaVersionamento } from "./index";
import { apiFalsa, estadoDe, estadoSvn, mud, WS } from "./teste-fixtures";

async function montar(estado: EstadoVcs, sobre: Parameters<typeof apiFalsa>[1] = {}, atual: typeof WS | null = WS) {
  const f = apiFalsa(estado, sobre);
  const apiW = { estado: vi.fn().mockResolvedValue({ atual, recentes: atual ? [atual] : [] }), assinar: vi.fn(() => () => undefined) };
  const apiM = { listar: vi.fn().mockResolvedValue({ itens: [], proximo: null }), assinar: vi.fn(() => () => undefined), detalhe: vi.fn().mockResolvedValue(null), portoes: vi.fn().mockResolvedValue(null) };
  const ws = criarStoreWorkspaces({ api: () => apiW as never });
  const mis = criarStoreMissoes({ api: () => apiM as never });
  const store = criarStoreVcs({ api: () => f.api });
  await ws.iniciar();
  let r!: ReturnType<typeof render>;
  await act(async () => { r = render(<TelaVersionamento api={f.api} workspaces={ws} missoes={mis} store={store} />); });
  return { ...f, ...r };
}

const arquivos = [mud("src/a.ts", " ", "M"), mud("src/b.ts", "M", " "), mud("novo.txt", " ", " ", "naorastreado")];

describe("Tela Versionamento: estados", () => {
  it("sem workspace guia para abrir uma pasta", async () => {
    await montar(estadoDe(arquivos), {}, null);
    expect(screen.getByText("Abra um workspace primeiro")).toBeTruthy();
  });
  it("sem repositório explica o próximo passo", async () => {
    await montar(estadoDe([], { tipo: "nenhum", mensagem: null }));
    expect(screen.getByText("Sem repositório")).toBeTruthy();
  });
  it("uma linha de controles, abas Mudanças | Branches | Histórico | PRs | Conflitos e branch com ahead/behind", async () => {
    await montar(estadoDe(arquivos, {}, { ahead: 2, behind: 1 }));
    expect(screen.getByRole("toolbar", { name: "Controles do versionamento" }).textContent).toContain("feature/x");
    expect(screen.getByRole("toolbar").textContent).toContain("↑2");
    expect(screen.getByRole("toolbar").textContent).toContain("↓1");
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, ""))).toEqual(["Mudanças", "Branches", "Histórico", "PRs", "Conflitos"]);
  });
  it("ramo padrão aparece marcado; 'Forçar…' só com divergência e fora do padrão", async () => {
    await montar(estadoDe([], { ramo_protegido: true }, { ahead: 1, behind: 1 }));
    expect(screen.getByText("padrão")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Forçar…" })).toBeNull();
  });
  it("recarrega o estado ao receber vcs:mudou da árvore", async () => {
    const m = await montar(estadoDe(arquivos));
    const antes = m.mocks.estado.mock.calls.length;
    await act(async () => { m.emitir({ workspace_id: WS.id, mission_id: null, resumo: estadoDe(arquivos).resumo }); await new Promise((r) => setTimeout(r, 120)); });
    expect(m.mocks.estado.mock.calls.length).toBeGreaterThan(antes);
  });
});

describe("Mudanças: stage, descarte e commit", () => {
  it("agrupa e estagia/desestagia por ícone", async () => {
    const m = await montar(estadoDe(arquivos));
    expect(screen.getByRole("button", { name: /No stage/ })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Estagiar src/a.ts" })); });
    expect(m.mocks.estagio).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: WS.id }), "estagiar", { caminhos: ["src/a.ts"] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remover src/b.ts do stage" })); });
    expect(m.mocks.estagio).toHaveBeenCalledWith(expect.anything(), "desestagiar", { caminhos: ["src/b.ts"] });
  });
  it("escolher um arquivo carrega o diff dele (staged só no grupo staged)", async () => {
    const m = await montar(estadoDe(arquivos));
    await act(async () => { fireEvent.click(screen.getByTitle("src/b.ts")); });
    expect(m.mocks.diff).toHaveBeenCalledWith(expect.objectContaining({ caminho: "src/b.ts", staged: true }));
  });
  it("descartar nunca é um clique: simula, mostra o que se perde e só então confirma", async () => {
    const sim = { simulado: true, itens: [{ caminho: "src/a.ts", acao: "restaurar", insercoes: 4, delecoes: 2 }], idDesfazer: null, naLixeira: [] };
    const estagio = vi.fn().mockImplementation(async (_a, op, args) => (op === "descartar" ? { ...sim, simulado: args.simular, idDesfazer: args.simular ? null : "id-1" } : { ok: true }));
    const m = await montar(estadoDe(arquivos), { estagio });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Descartar src/a.ts" })); });
    expect(estagio).toHaveBeenCalledWith(expect.anything(), "descartar", expect.objectContaining({ simular: true, confirmar: false }));
    const dlg = await screen.findByRole("dialog", { name: "Descartar mudanças" });
    await waitFor(() => expect(within(dlg).getByText(/restaura/)).toBeTruthy());
    expect(estagio.mock.calls.filter((c) => c[1] === "descartar" && c[2].simular === false)).toHaveLength(0);
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: /Descartar 1 arquivo/ })); });
    expect(estagio).toHaveBeenCalledWith(expect.anything(), "descartar", expect.objectContaining({ simular: false, confirmar: true }));
    expect(m.mocks.estado.mock.calls.length).toBeGreaterThan(1);
  });
  it("⌘Enter comita; assunto longo avisa; sem stage o botão fica desabilitado", async () => {
    const m = await montar(estadoDe(arquivos));
    const caixa = screen.getByLabelText("Mensagem do commit");
    fireEvent.change(caixa, { target: { value: "x".repeat(80) } });
    expect(screen.getByText(/passa de 72/)).toBeTruthy();
    fireEvent.change(caixa, { target: { value: "feat: algo" } });
    await act(async () => { fireEvent.keyDown(caixa, { key: "Enter", metaKey: true }); });
    expect(m.mocks.commit).toHaveBeenCalledWith(expect.anything(), "criar", { mensagem: "feat: algo", amend: false, pular_hooks: false, coautores: [] });
  });
  it("pular hooks só vale depois da confirmação explícita", async () => {
    const m = await montar(estadoDe(arquivos));
    fireEvent.click(screen.getByLabelText("Pular hooks"));
    const dlg = await screen.findByRole("dialog", { name: "Pular os hooks do git?" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar" }));
    expect((screen.getByLabelText("Pular hooks") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Pular hooks"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Pular hooks neste commit" }));
    fireEvent.change(screen.getByLabelText("Mensagem do commit"), { target: { value: "fix: y" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Comitar/ })); });
    expect(m.mocks.commit).toHaveBeenCalledWith(expect.anything(), "criar", expect.objectContaining({ pular_hooks: true }));
  });
  it("emendar commit já publicado avisa e bloqueia", async () => {
    const commit = vi.fn().mockImplementation(async (_a, op) => (op === "ultimo_publicado" ? { publicado: true, remotas: ["origin"] } : {}));
    await montar(estadoDe(arquivos), { commit });
    fireEvent.click(screen.getByLabelText("Emendar o último"));
    expect((await screen.findByRole("alert")).textContent).toContain("já foi publicado");
    expect((screen.getByRole("button", { name: "Emendar" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("⌘⇧U remove tudo do stage", async () => {
    const m = await montar(estadoDe(arquivos));
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Arquivos alterados"), { key: "u", metaKey: true, shiftKey: true }); });
    expect(m.mocks.estagio).toHaveBeenCalledWith(expect.anything(), "desestagiar", { caminhos: ["src/b.ts"] });
  });
  it("P-16/P-31: 5 000 arquivos alterados renderizam virtualizados (tempo medido)", async () => {
    const muitos = Array.from({ length: 5000 }, (_, i) => mud(`pasta${i % 50}/arquivo-${i}.ts`, i % 4 === 0 ? "M" : " ", i % 4 === 0 ? " " : "M"));
    const f = apiFalsa(estadoDe(muitos));
    const apiW = { estado: vi.fn().mockResolvedValue({ atual: WS, recentes: [WS] }), assinar: vi.fn(() => () => undefined) };
    const ws = criarStoreWorkspaces({ api: () => apiW as never });
    const mis = criarStoreMissoes({ api: () => ({ listar: vi.fn().mockResolvedValue({ itens: [], proximo: null }), assinar: vi.fn(() => () => undefined) }) as never });
    await ws.iniciar();
    const t0 = performance.now();
    await act(async () => { render(<TelaVersionamento api={f.api} workspaces={ws} missoes={mis} store={criarStoreVcs({ api: () => f.api })} />); });
    const ms = performance.now() - t0;
    const noDom = document.querySelectorAll(".vc-arq").length;
    // eslint-disable-next-line no-console
    console.info(`[6E] Mudanças com 5 000 arquivos: render ${ms.toFixed(0)} ms, ${noDom} linhas no DOM`);
    expect(noDom).toBeLessThan(120);
    expect(ms).toBeLessThan(1500);
  });
});

describe("Branches, remoto e SVN", () => {
  const ramos = [
    { nome: "main", atual: false, remoto: false, upstream: "origin/main", ahead: 0, behind: 0, hash: "a", ref: "refs/heads/main", upstreamSumiu: false, ultimoCommit: { hash: "a", assunto: "x", autor: "y", data: "d" } },
    { nome: "feat/y", atual: true, remoto: false, upstream: null, ahead: 0, behind: 0, hash: "b", ref: "refs/heads/feat/y", upstreamSumiu: false, ultimoCommit: { hash: "b", assunto: "x", autor: "y", data: "d" } },
  ];
  it("apagar com commits órfãos exige DIGITAR o nome do branch", async () => {
    const apagar = vi.fn().mockImplementation(async (_a, op, args) => {
      if (op === "listar") return ramos;
      if (op === "apagar") return args.simular ? { apagado: false, simulado: true, orfaos: [{ hash: "z".repeat(40), assunto: "trabalho solto", autor: "a", data: "d" }], requerForcar: true, hashAnterior: "q".repeat(40) } : { apagado: true, simulado: false, orfaos: [], requerForcar: false, hashAnterior: "q".repeat(40) };
      return {};
    });
    const m = await montar(estadoDe(arquivos), { ramos: apagar });
    fireEvent.click(screen.getByRole("tab", { name: /Branches/ }));
    const alvoBtn = await screen.findByRole("button", { name: "Apagar main" });
    await act(async () => { fireEvent.click(alvoBtn); });
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/trabalho solto/)).toBeTruthy();
    const botao = within(dlg).getByRole("button", { name: "Apagar mesmo assim" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "mai" } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "main" } });
    expect(botao.disabled).toBe(false);
    await act(async () => { fireEvent.click(botao); });
    expect(m.mocks.ramos).toHaveBeenCalledWith(expect.anything(), "apagar", { nome: "main", forcar: true, simular: false, confirmacao: "main" });
  });
  it("trocar de branch com conflito oferece levar/stash/cancelar", async () => {
    const ramosFn = vi.fn().mockImplementation(async (_a, op, args) => {
      if (op === "listar") return ramos;
      if (op === "trocar") return args.estrategia === null ? { trocou: false, conflito: true, arquivos: ["src/a.ts"], opcoes: ["cancelar", "levar", "stash"] } : { trocou: true, de: "feat/y", para: "main", levouMudancas: false, stashCriado: "stash@{0}", conflitoAoReaplicar: false, arquivos: [] };
      return {};
    });
    const m = await montar(estadoDe(arquivos), { ramos: ramosFn });
    fireEvent.click(screen.getByRole("tab", { name: /Branches/ }));
    const alvoBtn = await screen.findByRole("button", { name: "Trocar para main" });
    await act(async () => { fireEvent.click(alvoBtn); });
    const dlg = await screen.findByRole("dialog", { name: "Mudanças locais atrapalham a troca" });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Guardar em stash e trocar" })); });
    expect(m.mocks.ramos).toHaveBeenCalledWith(expect.anything(), "trocar", { destino: "main", estrategia: "stash" });
  });
  it("push pede confirmação e nunca é forçado; force-with-lease exige digitar o branch e simula antes", async () => {
    const remoto = vi.fn().mockImplementation(async (_a, op, args) => {
      if (op === "push") return { remoto: "origin", ramo: "feature/x", upstreamDefinido: false, atualizado: true };
      if (op === "lease") return { simulado: args.simular, remoto: "origin", ramo: "feature/x", refEsperada: "r1", sobrescreveria: [{ hash: "h".repeat(40), hashCurto: "hhhhhhh", assunto: "do remoto", autor: "z", data: "d", pais: [], email: "e", refs: [] }], enviado: !args.simular };
      return {};
    });
    const ramosFn = vi.fn().mockResolvedValue([{ nome: "origin/feature/x", atual: false, remoto: true, upstream: null, ahead: 0, behind: 0, hash: "r1", ref: "refs/remotes/origin/feature/x", upstreamSumiu: false, ultimoCommit: { hash: "r1", assunto: "x", autor: "y", data: "d" } }]);
    const m = await montar(estadoDe(arquivos, {}, { ahead: 2, behind: 1 }), { remoto, ramos: ramosFn });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Push" })); });
    expect(remoto).not.toHaveBeenCalled();
    const dlgPush = await screen.findByRole("dialog");
    await act(async () => { fireEvent.click(within(dlgPush).getByRole("button", { name: "Enviar (push)" })); });
    expect(remoto).toHaveBeenCalledWith(expect.anything(), "push", { remoto: null, ramo: null });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Forçar…" })); });
    expect(remoto).toHaveBeenCalledWith(expect.anything(), "lease", expect.objectContaining({ simular: true, confirmacao: null, ref_esperada: "r1" }));
    const dlg = await screen.findByRole("dialog", { name: /force with lease/ });
    expect(within(dlg).getAllByText(/do remoto/).length).toBeGreaterThan(0);
    const b = within(dlg).getByRole("button", { name: "Sobrescrever remoto" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "feature/x" } });
    await act(async () => { fireEvent.click(b); });
    expect(remoto).toHaveBeenCalledWith(expect.anything(), "lease", expect.objectContaining({ simular: false, confirmacao: "feature/x" }));
    expect(m.mocks.estado).toHaveBeenCalled();
  });
  it("pull mostra os commits que entram antes de confirmar", async () => {
    const remoto = vi.fn().mockImplementation(async (_a, _op, args) => ({ resultado: args.simular ? "simulado" : "ok", modoUsado: "ff-only", antes: "a", depois: "b", entrariam: [{ hash: "h".repeat(40), hashCurto: "hhhhhhh", assunto: "chegou", autor: "z", data: "d", pais: [], email: "e", refs: [] }] }));
    await montar(estadoDe(arquivos, {}, { behind: 1 }), { remoto });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pull" })); });
    const dlg = await screen.findByRole("dialog", { name: /pull/ });
    expect(within(dlg).getByText(/chegou/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Fazer pull" })); });
    expect(remoto).toHaveBeenLastCalledWith(expect.anything(), "pull", expect.objectContaining({ simular: false }));
  });
  it("SVN: sem stage/stash; commit grava no servidor e pede confirmação; sem aba PRs; mensagem de svn ausente", async () => {
    const svn = vi.fn().mockResolvedValue({ revisao: 12, saida: "" });
    const e = { ...estadoSvn([mud("a.c", " ", "M"), mud("n.c", " ", " ", "naorastreado")]), mensagem: "svn não instalado: brew install subversion" };
    await montar(e, { svn });
    expect(screen.queryByRole("tab", { name: "PRs" })).toBeNull();
    expect(screen.getByText(/brew install subversion/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Mensagem do commit SVN"), { target: { value: "msg" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enviar ao servidor/ })); });
    expect(svn).not.toHaveBeenCalledWith(expect.anything(), "commit", expect.anything());
    const dlgSvn = await screen.findByRole("dialog", { name: "Enviar ao servidor SVN?" });
    await act(async () => { fireEvent.click(within(dlgSvn).getByRole("button", { name: "Enviar commit" })); });
    expect(svn).toHaveBeenCalledWith(expect.anything(), "commit", { mensagem: "msg", caminhos: null, changelist: null });
  });
  it("conflitos: operação em curso mostra continuar desabilitado enquanto houver conflito, e abortar confirma", async () => {
    const e = estadoDe([mud("c.ts", "U", "U", "conflito")], { operacao: { operacao: "merge", parado: "conflito", conflitos: ["c.ts"] } });
    const operacao = vi.fn().mockResolvedValue({ resultado: "ok", hash: null, conflitos: [], estado: { operacao: null, conflitos: [] }, avisos: [], saida: "" });
    await montar(e, { operacao });
    fireEvent.click(screen.getByRole("tab", { name: /Conflitos/ }));
    expect((await screen.findByRole("button", { name: "Continuar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Abortar" }));
    const dlgAb = await screen.findByRole("dialog");
    await act(async () => { fireEvent.click(within(dlgAb).getByRole("button", { name: "Abortar" })); });
    expect(operacao).toHaveBeenCalledWith(expect.anything(), "abortar", {});
  });
  it("erro de uma ação vira faixa com role=alert", async () => {
    const estagio = vi.fn().mockRejectedValue(new Error("index.lock existe"));
    await montar(estadoDe(arquivos), { estagio });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Estagiar src/a.ts" })); });
    expect((await screen.findByRole("alert")).textContent).toContain("index.lock existe");
  });
});
