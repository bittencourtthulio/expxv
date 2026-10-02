// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiVcsPublicar, ArquivoPublicacao, EstadoPublicacao, PedidoEnviarInstrucao, PreparoPublicacao, ResultadoEnviarInstrucao } from "../../compartilhado/vcs-publicar";
import { criarStorePublicar } from "../estado/vcs-publicar";
import DialogoPublicar from "./DialogoPublicar";

afterEach(() => cleanup());

const WS = "ws_AAAAAAAAAAAA";
const arq = (n: number): ArquivoPublicacao[] => Array.from({ length: n }, (_, i) => ({ caminho: `src/arq${i + 1}.ts`, situacao: i === 0 ? "novo" : "modificado", sensivel: false }));
const preparo = (p: Partial<PreparoPublicacao> = {}): PreparoPublicacao => ({ tipo: "commit_push", workspace_id: WS, branch: "feat/x", remoto: "origin", repo: "dono/repo", ramo_padrao: "main", no_padrao: false, total_arquivos: 11, novos: 0, suite: { itens: 0, caminhos: [], incluiveis: 0 }, adicionadas: 40, removidas: 7, arquivos: arq(8), mais: 3, sensiveis: [], a_frente: 0, tem_upstream: false, sugestao_ramo: "feat/renderer-1001", clis: [{ id: "claude", nome: "Claude Code" }, { id: "codex", nome: "Codex" }], cli_padrao: "claude", cli_foco: null, ...p });
const entregue: ResultadoEnviarInstrucao = { estado: "entregue", motivo: null, pane_id: "pane_1", sessao_id: "sessao_1", entrega: "escrita", instrucao_rel: "x.md" };

async function abrir(tipo: "commit_push" | "pr", p: PreparoPublicacao, resultado: ResultadoEnviarInstrucao = entregue) {
  const api = {
    estado: vi.fn(async () => ({}) as EstadoPublicacao),
    prepararCommitPush: vi.fn(async () => p),
    prepararPr: vi.fn(async () => p),
    enviarInstrucao: vi.fn(async (_: PedidoEnviarInstrucao) => resultado),
    abrirUrl: vi.fn(async () => true),
    buscarRemoto: vi.fn(async () => ({ buscou: false, atras: 0, erro: null })),
    prepararAtualizar: vi.fn(async () => ({}) as never),
    atualizar: vi.fn(async () => ({ estado: "ok", motivo: null, trouxe: 1, sugerir_commitar: false }) as never),
    pedirMerge: vi.fn(async () => ({}) as never),
    ignorarSuite: vi.fn(async () => ({ estado: "ok", linhas: 1 }) as never),
  } satisfies ApiVcsPublicar;
  const store = criarStorePublicar({ api: () => api, avisar: () => 1, focar: () => undefined, sessaoEmFoco: () => null, agendar: () => () => undefined });
  store.definirWorkspace(WS);
  await store.abrir(tipo);
  render(<DialogoPublicar store={store} />);
  await act(async () => { await Promise.resolve(); });
  return { api, store };
}
const enviar = () => fireEvent.click(screen.getByRole("button", { name: "Enviar instrução ao agente" }));

describe("diálogo de commit e push (D-632)", () => {
  it("resumo calculado localmente: rota, +A/−R, os 8 primeiros NOMES e 'e mais N'; modal com título e uma ação primária", async () => {
    await abrir("commit_push", preparo());
    const d = screen.getByRole("dialog", { name: "Commit e push" });
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(within(d).getByLabelText("De feat/x para origin/feat/x")).toBeTruthy();
    expect(d.textContent).toContain("11 arquivos alterados");
    expect(d.textContent).toContain("+40");
    expect(d.textContent).toContain("−7");
    const lista = within(d).getByRole("list", { name: "Primeiros arquivos (só nomes)" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(9);
    expect(lista.textContent).toContain("e mais 3");
    expect(d.querySelectorAll(".botao-primario")).toHaveLength(1);
    expect(within(d).getByText(/Nada sai do seu computador agora/)).toBeTruthy();
  });
  it("arquivos de segredo: aviso em destaque 'Não vou incluir estes arquivos' com os nomes", async () => {
    await abrir("commit_push", preparo({ sensiveis: [".env", "certs/server.pem"] }));
    const alerta = screen.getByRole("alert");
    expect(alerta.textContent).toContain("Não vou incluir estes arquivos");
    expect(alerta.textContent).toContain(".env");
    expect(alerta.textContent).toContain("certs/server.pem");
    expect(alerta.textContent).toContain("proíbe commitá-los");
  });
  it("branch padrão: 'Criar branch novo' já vem marcado, com o nome sugerido editável", async () => {
    await abrir("commit_push", preparo({ branch: "main", no_padrao: true }));
    const caixa = screen.getByRole("checkbox", { name: /Criar branch novo/ }) as HTMLInputElement;
    expect(caixa.checked).toBe(true);
    expect((screen.getByLabelText("Nome do branch novo") as HTMLInputElement).value).toBe("feat/renderer-1001");
    expect(screen.getByLabelText("De main para origin/feat/renderer-1001")).toBeTruthy();
  });
  it("envio com branch novo: manda as opções certas e fecha com entrega confirmada", async () => {
    const { api, store } = await abrir("commit_push", preparo({ branch: "main", no_padrao: true }));
    fireEvent.change(screen.getByLabelText("Nome do branch novo"), { target: { value: "feat/minha-coisa" } });
    enviar();
    await waitFor(() => expect(api.enviarInstrucao).toHaveBeenCalled());
    expect(api.enviarInstrucao.mock.calls[0]![0]).toMatchObject({ workspace_id: WS, tipo: "commit_push", cli: "claude", modo_painel: "auto", opcoes: { criar_ramo: true, nome_ramo: "feat/minha-coisa", incluir_nao_rastreados: true, incluir_suite: false, mensagem: { modo: "agente", texto: null }, pr: null, confirmar_padrao: null } });
    await waitFor(() => expect(store.obter().dialogo).toBeNull());
  });
  it("nome de branch inválido bloqueia o botão primário e explica", async () => {
    await abrir("commit_push", preparo({ branch: "main", no_padrao: true }));
    const campo = screen.getByLabelText("Nome do branch novo");
    for (const ruim of ["a; rm -rf ~", "a..b", "-x", "a b", "main"]) {
      fireEvent.change(campo, { target: { value: ruim } });
      expect((screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement).disabled, ruim).toBe(true);
      expect(screen.getAllByRole("alert").some((a) => a.className.includes("pub-erro-campo")), ruim).toBe(true);
    }
    fireEvent.change(campo, { target: { value: "feat/ok" } });
    expect((screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("branch padrão sem criar branch: NÃO envia; abre o diálogo à parte e só libera com a frase exata 'push na main'", async () => {
    const { api } = await abrir("commit_push", preparo({ branch: "main", no_padrao: true }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Criar branch novo/ }));
    expect(screen.getByText(/vou pedir uma confirmação digitada à parte/)).toBeTruthy();
    enviar();
    const confirmar = await screen.findByRole("dialog", { name: "Enviar direto para main?" });
    expect(api.enviarInstrucao).not.toHaveBeenCalled();
    const botao = within(confirmar).getByRole("button", { name: "Enviar direto" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    const campo = within(confirmar).getByLabelText("Digite push na main para confirmar");
    for (const ruim of ["push na master", "push na main ", "Push na main", "push"]) {
      fireEvent.change(campo, { target: { value: ruim } });
      expect(botao.disabled, ruim).toBe(true);
    }
    fireEvent.change(campo, { target: { value: "push na main" } });
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(api.enviarInstrucao).toHaveBeenCalled());
    expect(api.enviarInstrucao.mock.calls[0]![0].opcoes).toMatchObject({ criar_ramo: false, nome_ramo: null, confirmar_padrao: "push na main" });
  });
  it("'Voltar e criar um branch' da confirmação volta ao formulário sem enviar", async () => {
    const { api, store } = await abrir("commit_push", preparo({ branch: "main", no_padrao: true }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Criar branch novo/ }));
    enviar();
    fireEvent.click(await screen.findByRole("button", { name: "Voltar e criar um branch" }));
    expect(store.obter().dialogo?.fase).toBe("pronto");
    expect(api.enviarInstrucao).not.toHaveBeenCalled();
  });
  it("mensagem manual vazia bloqueia; com texto vai nas opções; não rastreados desmarcável; troca de agente", async () => {
    const { api } = await abrir("commit_push", preparo());
    fireEvent.click(screen.getByRole("radio", { name: /Escrever eu mesmo/ }));
    expect((screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Mensagem do commit"), { target: { value: "fix: ajusta o topo" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Incluir arquivos novos/ }));
    fireEvent.change(screen.getByLabelText("Agente que vai executar"), { target: { value: "codex" } });
    enviar();
    await waitFor(() => expect(api.enviarInstrucao).toHaveBeenCalled());
    expect(api.enviarInstrucao.mock.calls[0]![0]).toMatchObject({ cli: "codex", opcoes: { criar_ramo: false, incluir_nao_rastreados: false, mensagem: { modo: "manual", texto: "fix: ajusta o topo" } } });
  });
  it("o agente do painel em foco vem selecionado e rotulado", async () => {
    await abrir("commit_push", preparo({ cli_foco: "codex" }));
    const sel = screen.getByLabelText("Agente que vai executar") as HTMLSelectElement;
    expect(sel.value).toBe("codex");
    expect(sel.selectedOptions[0]!.textContent).toContain("painel em foco");
  });
  it("sem CLI de IA instalada: avisa e bloqueia o envio", async () => {
    await abrir("commit_push", preparo({ clis: [], cli_padrao: null }));
    expect(screen.getByText("Nenhuma CLI de IA instalada neste computador.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("agente ocupado: pergunta e só abre painel novo se o dono aceitar", async () => {
    const { api } = await abrir("commit_push", preparo(), { estado: "ocupado", motivo: "O agente está trabalhando. Abrir um painel novo para isto?", pane_id: "pane_1", sessao_id: null, entrega: null, instrucao_rel: null });
    enviar();
    const pergunta = await screen.findByText("O agente está trabalhando. Abrir um painel novo para isto?");
    expect(pergunta.closest('[role="alert"]')).not.toBeNull();
    api.enviarInstrucao.mockResolvedValueOnce(entregue);
    fireEvent.click(screen.getByRole("button", { name: "Abrir painel novo" }));
    await waitFor(() => expect(api.enviarInstrucao).toHaveBeenCalledTimes(2));
    expect(api.enviarInstrucao.mock.calls[1]![0].modo_painel).toBe("novo");
  });
  it("Esc fecha sem enviar; o foco inicial vai ao resumo (topo do diálogo, sem rolar até o botão)", async () => {
    const { api, store } = await abrir("commit_push", preparo());
    expect(document.activeElement).toBe(screen.getByLabelText("Resumo do que será enviado"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(store.obter().dialogo).toBeNull();
    expect(api.enviarInstrucao).not.toHaveBeenCalled();
  });
  it("só commits locais (sem arquivos alterados): título 'Enviar commits'", async () => {
    await abrir("commit_push", preparo({ total_arquivos: 0, arquivos: [], mais: 0, adicionadas: 0, removidas: 0, a_frente: 2, tem_upstream: true }));
    expect(screen.getByRole("dialog", { name: "Enviar commits" })).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("2 commits locais ainda não enviados");
  });
});

describe("diálogo do PR", () => {
  it("título/descrição pelo agente ou manual, rascunho, base e revisores; manda as opções do PR", async () => {
    const { api } = await abrir("pr", preparo({ tipo: "pr", a_frente: 0, tem_upstream: true }));
    const d = screen.getByRole("dialog", { name: "Enviar PR" });
    expect(within(d).queryByRole("checkbox", { name: /Criar branch novo/ })).toBeNull();
    fireEvent.click(within(d).getAllByRole("radio", { name: /Escrever eu mesmo/ })[0]!);
    expect((screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Título do PR"), { target: { value: "feat: botões de publicar" } });
    fireEvent.click(within(d).getByRole("checkbox", { name: /rascunho/ }));
    fireEvent.change(within(d).getByLabelText("Base"), { target: { value: "develop" } });
    fireEvent.change(within(d).getByPlaceholderText("maria-dev, joao"), { target: { value: "maria-dev, joao" } });
    enviar();
    await waitFor(() => expect(api.enviarInstrucao).toHaveBeenCalled());
    expect(api.enviarInstrucao.mock.calls[0]![0]).toMatchObject({ tipo: "pr", opcoes: { criar_ramo: false, nome_ramo: null, pr: { titulo: { modo: "manual", texto: "feat: botões de publicar" }, descricao: { modo: "agente", texto: null }, rascunho: true, base: "develop", revisores: ["maria-dev", "joao"] } } });
  });
  it("revisor inválido e base inválida bloqueiam; base igual ao padrão vai como null", async () => {
    const { api } = await abrir("pr", preparo({ tipo: "pr" }));
    const d = screen.getByRole("dialog");
    fireEvent.change(within(d).getByPlaceholderText("maria-dev, joao"), { target: { value: "x --admin" } });
    expect((screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(d).getByPlaceholderText("maria-dev, joao"), { target: { value: "@maria" } });
    expect((screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(d).getByPlaceholderText("maria-dev, joao"), { target: { value: "" } });
    fireEvent.change(within(d).getByLabelText("Base"), { target: { value: "main; id" } });
    expect((screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Base"), { target: { value: "main" } });
    enviar();
    await waitFor(() => expect(api.enviarInstrucao).toHaveBeenCalled());
    expect(api.enviarInstrucao.mock.calls[0]![0].opcoes.pr?.base).toBeNull();
  });
});

describe("falhas do preparo", () => {
  it("erro ao preparar: mensagem e 'Fechar'; nada para enviar", async () => {
    const api = { estado: vi.fn(), prepararCommitPush: vi.fn(async () => { throw new Error("[vcs-erro] O remoto origin não aponta para o GitHub (github.com)."); }), prepararPr: vi.fn(), enviarInstrucao: vi.fn(), abrirUrl: vi.fn() };
    const store = criarStorePublicar({ api: () => api as never, avisar: () => 1, focar: () => undefined, sessaoEmFoco: () => null, agendar: () => () => undefined });
    store.definirWorkspace(WS);
    await store.abrir("commit_push");
    render(<DialogoPublicar store={store} />);
    expect(screen.getByRole("alert").textContent).toContain("O remoto origin não aponta para o GitHub");
    expect(screen.queryByRole("button", { name: "Enviar instrução ao agente" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(store.obter().dialogo).toBeNull();
  });
});

describe("contagem separada e pastas da suíte (D-691/D-692)", () => {
  const suite = { itens: 3, caminhos: [".expx/", ".opencode/", ".expxv/"], incluiveis: 2 };
  it("mostra 'N arquivos alterados' e 'M pastas/arquivos novos' separados", async () => {
    await abrir("commit_push", preparo({ total_arquivos: 2, novos: 1 }));
    const d = screen.getByRole("dialog", { name: "Commit e push" });
    expect(d.textContent).toContain("2 arquivos alterados · 1 pasta/arquivo novo");
    cleanup();
    await abrir("commit_push", preparo({ total_arquivos: 0, novos: 4 }));
    expect(screen.getByRole("dialog").textContent).toContain("4 pastas/arquivos novos");
    expect(screen.getByRole("dialog").textContent).not.toContain("0 arquivos alterados");
  });
  it("seção '3 pastas da suíte não rastreadas': explica o .git/info/exclude local e oferece as duas ações; incluir vem desmarcado", async () => {
    const { api } = await abrir("commit_push", preparo({ suite }));
    const s = screen.getByRole("region", { name: "Pastas da suíte ExpxDev" });
    expect(s.textContent).toContain("3 pastas da suíte não rastreadas");
    expect(s.textContent).toContain(".git/info/exclude");
    expect(s.textContent).toContain("nunca vai ao remoto");
    expect(s.textContent).toContain(".expx/");
    expect((within(s).getByRole("checkbox", { name: /Incluir no commit/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(s).getByRole("button", { name: "Ignorar neste computador" }));
    await waitFor(() => expect(api.ignorarSuite).toHaveBeenCalledWith(WS));
  });
  it("sem pastas da suíte: a seção não existe", async () => {
    await abrir("commit_push", preparo());
    expect(screen.queryByRole("region", { name: "Pastas da suíte ExpxDev" })).toBeNull();
  });
  it("'Incluir no commit' marcado vai em incluir_suite; desmarcado (padrão) vai false", async () => {
    const a = await abrir("commit_push", preparo({ suite }));
    enviar();
    await waitFor(() => expect(a.api.enviarInstrucao).toHaveBeenCalled());
    expect(a.api.enviarInstrucao.mock.calls[0]![0].opcoes.incluir_suite).toBe(false);
    cleanup();
    const b = await abrir("commit_push", preparo({ suite }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Incluir no commit/ }));
    enviar();
    await waitFor(() => expect(b.api.enviarInstrucao).toHaveBeenCalled());
    expect(b.api.enviarInstrucao.mock.calls[0]![0].opcoes.incluir_suite).toBe(true);
  });
  it("só a suíte (nada alterado): o envio fica bloqueado com o aviso até marcar 'Incluir no commit'", async () => {
    await abrir("commit_push", preparo({ total_arquivos: 0, novos: 0, a_frente: 0, suite }));
    const botao = screen.getByRole("button", { name: "Enviar instrução ao agente" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(screen.getByText(/Nada para commitar/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Incluir no commit/ }));
    expect(botao.disabled).toBe(false);
  });
  it("a opção de incluir não existe no diálogo do PR", async () => {
    await abrir("pr", preparo({ tipo: "pr", suite }));
    expect(screen.queryByRole("region", { name: "Pastas da suíte ExpxDev" })).toBeNull();
  });
});
