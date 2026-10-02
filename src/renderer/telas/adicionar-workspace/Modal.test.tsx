// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../../compartilhado/dominio";
import type { EventoClone, LoteProjetos } from "../../../compartilhado/workspaces-adicionar";
import { HostAdicionarWorkspace } from "../../casca/HostAdicionarWorkspace";
import { criarStoreAdicionar, type StoreAdicionar } from "../../estado/adicionar-workspace";
import { criarStoreWorkspaces } from "../../estado/workspaces";
import ModalAdicionarWorkspace from "./ModalAdicionarWorkspace";

const login = vi.hoisted(() => ({ abrir: vi.fn() }));
vi.mock("../../estado/adicionar-login", () => ({ abrirTerminalDeLogin: login.abrir, COMANDO_LOGIN_GH: "gh auth login --hostname github.com" }));

const ws = (id: string, nome: string): Workspace => ({ id, nome, raiz: `/p/${nome}`, e_git: true, acesso_externo: "leitura", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" });
const evento = (e: Partial<EventoClone>): EventoClone => ({ clone_id: "cl_1", fase: "recebendo", percentual: 45, bytes: 1_258_291, velocidade_bps: 2_516_582, mensagem: "", workspace: null, erro: null, destino_exibicao: "~/Developer/repo", nao_confiavel: true, ...e });
const livre = (nome: string) => ({ ok: true, situacao: "livre", caminho_exibicao: `~/Developer/${nome}`, motivo: null, sugestao: null, ja_workspace: false });

async function montar(sobre: Record<string, unknown> = {}, secao: "pasta" | "clonar" | "novo" = "pasta", suiteEstado = "ausente") {
  let aoProgresso: (e: EventoClone) => void = () => undefined;
  let aoLote: (l: LoteProjetos) => void = () => undefined;
  const api = {
    abrir: vi.fn().mockResolvedValue(null), definirAtual: vi.fn().mockResolvedValue(null),
    adicionarDestinoPadrao: vi.fn().mockResolvedValue({ token: "d_AbCdEfGhIjKl", exibicao: "~/Developer" }),
    adicionarEscolherPasta: vi.fn().mockResolvedValue(null),
    adicionarAvaliarDestino: vi.fn(async (p: { nome: string }) => livre(p.nome)),
    adicionarAbrirDestino: vi.fn().mockResolvedValue(ws("ws_AAAAAAAAAAAA", "repo")),
    adicionarClonar: vi.fn().mockResolvedValue({ ok: true, clone_id: "cl_1" }),
    adicionarCancelarClone: vi.fn().mockResolvedValue(true),
    adicionarBuscarProjetos: vi.fn().mockResolvedValue({ busca_id: "bu_1" }),
    adicionarCancelarBusca: vi.fn().mockResolvedValue(true),
    adicionarProjetoAchado: vi.fn().mockResolvedValue(ws("ws_AAAAAAAAAAAA", "app")),
    adicionarGhEstado: vi.fn().mockResolvedValue({ instalado: true, autenticado: true, usuario: "fulana" }),
    adicionarListarRepos: vi.fn().mockResolvedValue({ ok: true, repos: [], truncado: false }),
    adicionarNovo: vi.fn().mockResolvedValue({ ok: true, workspace: ws("ws_BBBBBBBBBBBB", "novo"), avisos: ["Sem identidade git: sem commit."], instalar_suite: false }),
    assinarAdicionarProgresso: vi.fn((cb: (e: EventoClone) => void) => { aoProgresso = cb; return () => undefined; }),
    assinarAdicionarProjetos: vi.fn((cb: (l: LoteProjetos) => void) => { aoLote = cb; return () => undefined; }),
    ...sobre,
  };
  const suite = { garantirEstado: vi.fn().mockResolvedValue(undefined), estadoDe: vi.fn(() => ({ estado: suiteEstado })), abrirModalPara: vi.fn() };
  const store: StoreAdicionar = criarStoreAdicionar({ api: () => api as never, suite, esperar: async () => undefined });
  const apiWs = { estado: vi.fn().mockResolvedValue({ atual: ws("ws_AAAAAAAAAAAA", "alfa"), recentes: [ws("ws_AAAAAAAAAAAA", "alfa"), ws("ws_CCCCCCCCCCCC", "beta")] }), assinar: vi.fn(() => () => undefined), abrir: vi.fn(), definirAtual: vi.fn(), remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn() };
  const workspaces = criarStoreWorkspaces({ api: () => apiWs });
  await act(async () => { await workspaces.iniciar(); });
  store.abrir(secao);
  render(<ModalAdicionarWorkspace store={store} workspaces={workspaces} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { store, api, suite, emitir: (e: EventoClone) => act(() => aoProgresso(e)), lote: (l: LoteProjetos) => act(() => aoLote(l)) };
}
const digitar = (rotulo: RegExp | string, valor: string): void => { fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } }); };
const assentar = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(() => login.abrir.mockClear());
afterEach(() => vi.restoreAllMocks());

describe("modal Adicionar workspace — estrutura e a11y", () => {
  it("diálogo modal com sub-navegação À ESQUERDA (tablist vertical) e três caminhos", async () => {
    await montar();
    const d = screen.getByRole("dialog", { name: "Adicionar workspace" });
    expect(d.getAttribute("aria-modal")).toBe("true");
    const lista = within(d).getByRole("tablist", { name: "Como adicionar o workspace" });
    expect(lista.getAttribute("aria-orientation")).toBe("vertical");
    const abas = within(lista).getAllByRole("tab").map((a) => a.textContent);
    expect(abas).toEqual(["Abrir pasta", "Clonar repositório", "Novo projeto"]);
    expect(within(lista).getByRole("tab", { name: "Abrir pasta" }).getAttribute("aria-selected")).toBe("true");
  });
  it("abre já na seção pedida (entrada pelo ⌘K) e a navegação troca de seção", async () => {
    await montar({}, "clonar");
    expect(screen.getByRole("tab", { name: "Clonar repositório" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText(/URL ou identificador/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Novo projeto" }));
    expect(screen.getByLabelText(/Nome do projeto/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Abrir pasta" }));
    expect(screen.getByRole("button", { name: /Escolher pasta…/ })).toBeTruthy();
  });
  it("sem a ponte do app avisa em vez de quebrar", () => {
    const store = criarStoreAdicionar({ api: () => undefined });
    store.abrir("pasta");
    render(<ModalAdicionarWorkspace store={store} />);
    expect(screen.getByRole("alert").textContent).toMatch(/só funciona no aplicativo/);
  });
  it("Esc fecha quando não há clone", async () => {
    const m = await montar();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(m.store.obter().aberto).toBe(false);
  });
});

describe("Abrir pasta", () => {
  it("ação primária abre o diálogo nativo; recentes aparecem e trocam o workspace", async () => {
    const m = await montar({ abrir: vi.fn().mockResolvedValue(ws("ws_AAAAAAAAAAAA", "zeta")) });
    const botao = screen.getByRole("button", { name: /Escolher pasta…/ });
    expect(botao.className).toContain("botao-primario");
    const recentes = within(screen.getByRole("list", { name: "Recentes" }));
    expect(recentes.getByText("alfa")).toBeTruthy();
    expect(recentes.getByText("Atual")).toBeTruthy();
    await act(async () => { fireEvent.click(recentes.getByText("beta")); });
    expect(m.api.definirAtual).toHaveBeenCalledWith("ws_CCCCCCCCCCCC");
    expect(m.store.obter().aberto).toBe(false);
  });
  it("escolher pasta nativa adiciona e fecha", async () => {
    const m = await montar({ abrir: vi.fn().mockResolvedValue(ws("ws_AAAAAAAAAAAA", "zeta")) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Escolher pasta…/ })); });
    expect(m.api.abrir).toHaveBeenCalledWith(null);
    expect(m.store.obter().aberto).toBe(false);
  });
  it("varredura é OPT-IN: nada roda sozinho; resultados mostram nome, pasta ~, branch e já-workspace; clique adiciona", async () => {
    const m = await montar();
    expect(m.api.adicionarBuscarProjetos).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Procurar projetos/ })); });
    expect(screen.getByRole("button", { name: "Cancelar busca" })).toBeTruthy();
    await m.lote({ busca_id: "bu_1", itens: [{ id: "ach_1", nome: "app", exibicao: "~/Developer/app", branch: "main", e_git: true, manifesto: null, ja_workspace: false }, { id: "ach_2", nome: "velho", exibicao: "~/code/velho", branch: null, e_git: false, manifesto: "package.json", ja_workspace: true }], visitados: 33, fim: true, cancelada: false, limite_atingido: false });
    const lista = within(screen.getByRole("list", { name: "Encontrar projetos nesta máquina" }));
    expect(lista.getByText("~/Developer/app")).toBeTruthy();
    expect(lista.getByText("main")).toBeTruthy();
    expect(lista.getByText("Já é workspace")).toBeTruthy();
    expect(screen.getByText(/2 projetos encontrados em 33 pastas/)).toBeTruthy();
    await act(async () => { fireEvent.click(lista.getByRole("button", { name: /Adicionar app/ })); });
    expect(m.api.adicionarProjetoAchado).toHaveBeenCalledWith("ach_1");
  });
  it("busca sem resultado mostra estado vazio útil", async () => {
    const m = await montar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Procurar projetos/ })); });
    await m.lote({ busca_id: "bu_1", itens: [], visitados: 5, fim: true, cancelada: false, limite_atingido: true });
    expect(screen.getByText(/Nenhum projeto encontrado nos locais comuns/)).toBeTruthy();
    expect(screen.getByText(/limite de 2 000 pastas/)).toBeTruthy();
  });
});

describe("Clonar repositório", () => {
  it("estado vazio: orienta, 'Revisar e clonar…' desabilitado, destino padrão visível", async () => {
    await montar({}, "clonar");
    expect(screen.getByText("~/Developer")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Revisar e clonar…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Nada é baixado antes de você confirmar/)).toBeTruthy();
  });
  it("URL válida: mostra o host, sugere o nome e libera; URL com senha é recusada com orientação", async () => {
    await montar({}, "clonar");
    digitar(/URL ou identificador/, "https://u:segredo@github.com/dono/repo");
    expect(screen.getByText(/gh auth login/)).toBeTruthy();
    expect(screen.queryByText(/segredo/)).toBeNull();
    expect((screen.getByRole("button", { name: "Revisar e clonar…" }) as HTMLButtonElement).disabled).toBe(true);
    digitar(/URL ou identificador/, "https://gitlab.com/grupo/projeto.git");
    await assentar();
    expect(screen.getByText("GitLab")).toBeTruthy();
    expect((screen.getByLabelText(/Nome da pasta/) as HTMLInputElement).value).toBe("projeto");
    expect((screen.getByRole("button", { name: "Revisar e clonar…" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("CONSENTIMENTO claro (host, repositório, destino exato, frase) e só então 'Clonar'", async () => {
    const m = await montar({}, "clonar");
    digitar(/URL ou identificador/, "dono/repo");
    await assentar();
    fireEvent.change(screen.getByLabelText(/Branch/), { target: { value: "dev" } });
    await assentar();
    fireEvent.click(screen.getByRole("radio", { name: /Raso/ }));
    await assentar();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e clonar…" }));
    const g = screen.getByRole("group", { name: /Isto baixa o repositório para o seu computador/ });
    expect(within(g).getByText("github.com")).toBeTruthy();
    expect(within(g).getByText("github.com/dono/repo")).toBeTruthy();
    expect(within(g).getByText("~/Developer/repo")).toBeTruthy();
    expect(within(g).getByText(/raso \(último commit\) · branch dev/)).toBeTruthy();
    expect(m.api.adicionarClonar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(g).getByRole("button", { name: "Clonar" })); });
    expect(m.api.adicionarClonar).toHaveBeenCalledWith(expect.objectContaining({ entrada: "dono/repo", branch: "dev", raso: true, submodulos: false, consentimento: true, destino_token: "d_AbCdEfGhIjKl" }));
  });
  it("progresso ao vivo: progressbar com valor, bytes/velocidade, aria-live e cancelar", async () => {
    const m = await montar({}, "clonar");
    digitar(/URL ou identificador/, "dono/repo");
    await assentar();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e clonar…" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clonar" })); });
    await m.emitir(evento({ fase: "recebendo", percentual: 45 }));
    const barra = screen.getByRole("progressbar");
    expect(barra.getAttribute("aria-valuenow")).toBe("45");
    expect(barra.getAttribute("aria-valuemin")).toBe("0");
    expect(barra.getAttribute("aria-valuemax")).toBe("100");
    expect(screen.getByText("45%")).toBeTruthy();
    expect(screen.getByText(/1,2 MiB · 2,4 MiB\/s/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Recebendo objetos 25 por cento.");
    await m.emitir(evento({ fase: "contando", percentual: null }));
    expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false); // indeterminada
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancelar clone" })); });
    expect(m.api.adicionarCancelarClone).toHaveBeenCalledWith("cl_1");
  });
  it("Esc durante o clone NÃO fecha: pergunta; 'Continuar clonando' mantém, confirmar cancela e fecha", async () => {
    const m = await montar({}, "clonar");
    digitar(/URL ou identificador/, "dono/repo");
    await assentar();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e clonar…" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clonar" })); });
    await m.emitir(evento({ percentual: 10 }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(m.store.obter().aberto).toBe(true);
    const confirma = screen.getByRole("dialog", { name: "Cancelar o clone?" });
    fireEvent.click(within(confirma).getByRole("button", { name: "Continuar clonando" }));
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(m.api.adicionarCancelarClone).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "Cancelar o clone?" })).getByRole("button", { name: "Cancelar clone e fechar" })); });
    expect(m.api.adicionarCancelarClone).toHaveBeenCalledWith("cl_1");
    expect(m.store.obter().aberto).toBe(false);
  });
  it("pronto: 'Abrir' fecha e 'Instalar suíte ExpxDev' (quando falta) abre o assistente já existente", async () => {
    const m = await montar({}, "clonar");
    digitar(/URL ou identificador/, "dono/repo");
    await assentar();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e clonar…" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clonar" })); });
    await m.emitir(evento({ fase: "concluido", percentual: 100, workspace: ws("ws_AAAAAAAAAAAA", "repo") }));
    await assentar();
    expect(screen.getByRole("heading", { name: /Pronto/ })).toBeTruthy();
    expect(screen.getByText(/não confiável/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Instalar suíte ExpxDev" }));
    expect(m.suite.abrirModalPara).toHaveBeenCalledWith("ws_AAAAAAAAAAAA");
  });
  it("pronto com suíte completa não oferece instalar; 'Abrir' fecha o modal", async () => {
    const m = await montar({}, "clonar", "completa");
    digitar(/URL ou identificador/, "dono/repo");
    await assentar();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e clonar…" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clonar" })); });
    await m.emitir(evento({ fase: "concluido", workspace: ws("ws_AAAAAAAAAAAA", "repo") }));
    await assentar();
    expect(screen.queryByRole("button", { name: "Instalar suíte ExpxDev" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(m.store.obter().aberto).toBe(false);
  });
  it("erro de acesso: mensagem simples, botão do terminal (sem executar login) e 'tentar de novo'", async () => {
    const m = await montar({}, "clonar");
    digitar(/URL ou identificador/, "dono/privado");
    await assentar();
    fireEvent.click(screen.getByRole("button", { name: "Revisar e clonar…" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clonar" })); });
    await m.emitir(evento({ fase: "falhou", erro: { codigo: "nao_encontrado", mensagem: "Repositório não encontrado, ou é privado. Rode `gh auth login` no terminal.", acao: "login_gh", sugestao: null } }));
    const alerta = screen.getAllByRole("alert")[0] as HTMLElement;
    expect(alerta.textContent).toMatch(/privado/);
    expect(within(alerta).getAllByText("gh auth login", { selector: "code" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/O app só digita o comando/)).toBeTruthy();
    fireEvent.click(within(alerta).getByRole("button", { name: /Abrir terminal para/ }));
    expect(login.abrir).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/URL ou identificador/)).toBeTruthy(); // formulário preservado
  });
  it("colisão de nome: oferece 'Usar outro nome' e 'Abrir a existente' em vez de sobrescrever", async () => {
    const m = await montar({ adicionarAvaliarDestino: vi.fn().mockResolvedValue({ ok: false, situacao: "ocupado", caminho_exibicao: "~/Developer/repo", motivo: "x", sugestao: "repo-2", ja_workspace: false }) }, "clonar");
    digitar(/URL ou identificador/, "dono/repo");
    await assentar();
    expect((screen.getByRole("button", { name: "Revisar e clonar…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Nada será sobrescrito/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Usar “repo-2”/ }));
    expect((screen.getByLabelText(/Nome da pasta/) as HTMLInputElement).value).toBe("repo-2");
    await assentar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Abrir a existente" })); });
    expect(m.api.adicionarAbrirDestino).toHaveBeenCalled();
  });
  it("Meus repositórios: só ao clicar; filtra localmente; mostra selo de privado; clique preenche a URL", async () => {
    const repos = [
      { nome: "alfa", nome_com_dono: "fulana/alfa", descricao: "primeiro", privado: true, atualizado_em: "2026-09-30T00:00:00Z", url: "https://github.com/fulana/alfa" },
      { nome: "beta", nome_com_dono: "fulana/beta", descricao: "segundo", privado: false, atualizado_em: "2020-01-01T00:00:00Z", url: "https://github.com/fulana/beta" },
    ];
    const m = await montar({ adicionarListarRepos: vi.fn().mockResolvedValue({ ok: true, repos, truncado: false }) }, "clonar");
    expect(m.api.adicionarListarRepos).not.toHaveBeenCalled();
    expect(screen.getByText(/Consulta o GitHub \(usa a internet\)/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Carregar meus repositórios" })); });
    expect(m.api.adicionarListarRepos).toHaveBeenCalledWith(true);
    const lista = within(screen.getByRole("list", { name: "Meus repositórios" }));
    expect(lista.getByText("Privado")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filtrar meus repositórios"), { target: { value: "beta" } });
    expect(lista.queryByText("fulana/alfa")).toBeNull();
    fireEvent.click(lista.getByRole("button", { name: /fulana\/beta/ }));
    await assentar();
    expect((screen.getByLabelText(/URL ou identificador/) as HTMLInputElement).value).toBe("https://github.com/fulana/beta");
  });
  it("gh não autenticado: explica e oferece o terminal (sem rede)", async () => {
    const m = await montar({ adicionarGhEstado: vi.fn().mockResolvedValue({ instalado: true, autenticado: false, usuario: null }) }, "clonar");
    expect(screen.queryByRole("button", { name: "Carregar meus repositórios" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Abrir terminal para/ }));
    expect(login.abrir).toHaveBeenCalled();
    expect(m.api.adicionarListarRepos).not.toHaveBeenCalled();
  });
  it("gh ausente: orienta a instalar ou colar a URL", async () => {
    await montar({ adicionarGhEstado: vi.fn().mockResolvedValue({ instalado: false, autenticado: false, usuario: null }) }, "clonar");
    expect(screen.getByText(/instale a CLI do GitHub/)).toBeTruthy();
  });
  it("caminho local exige a permissão e a confirmação", async () => {
    await montar({}, "clonar");
    digitar(/URL ou identificador/, "/tmp/meu-repo");
    expect(screen.getByText(/Caminho local não é aceito por padrão/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Origem em pasta local do computador/));
    fireEvent.click(screen.getByRole("checkbox", { name: /Permitir caminho local/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que esta pasta/ }));
    await assentar();
    expect(screen.getByText("pasta local")).toBeTruthy();
  });
});

describe("Novo projeto", () => {
  it("opções, validação do nome e criação com 'Pronto'", async () => {
    const m = await montar({}, "novo");
    expect((screen.getByRole("button", { name: "Criar projeto" }) as HTMLButtonElement).disabled).toBe(true);
    digitar(/Nome do projeto/, "../x");
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    digitar(/Nome do projeto/, "meu-app");
    await assentar();
    expect(screen.getByText(/Será criada em/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Node/ }));
    await assentar();
    expect((screen.getByRole("checkbox", { name: /Iniciar repositório git/ }) as HTMLInputElement).checked).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar projeto" })); });
    expect(m.api.adicionarNovo).toHaveBeenCalledWith(expect.objectContaining({ nome: "meu-app", template: "node", git: true, instalar_suite: false }));
    expect(screen.getByRole("heading", { name: "Pronto" })).toBeTruthy();
    expect(screen.getByText("Sem identidade git: sem commit.")).toBeTruthy();
  });
  it("sem git, as opções dependentes ficam desabilitadas", async () => {
    await montar({}, "novo");
    fireEvent.click(screen.getByRole("checkbox", { name: /Iniciar repositório git/ }));
    expect((screen.getByRole("checkbox", { name: /Fazer o commit inicial/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /gitignore/ }) as HTMLInputElement).disabled).toBe(true);
  });
  it("padrão 'Pasta vazia' e suíte desmarcada (opt-in)", async () => {
    await montar({}, "novo");
    expect((screen.getByRole("radio", { name: /Pasta vazia/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Instalar a suíte ExpxDev ao criar/ }) as HTMLInputElement).checked).toBe(false);
  });
  it("erro do main (pasta já existe) aparece sem travar", async () => {
    await montar({ adicionarNovo: vi.fn().mockResolvedValue({ ok: false, erro: { codigo: "colisao", mensagem: "Já existe uma pasta com esse nome.", acao: null, sugestao: null } }) }, "novo");
    digitar(/Nome do projeto/, "x");
    await assentar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar projeto" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/Já existe/);
    expect((screen.getByRole("button", { name: "Criar projeto" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("HostAdicionarWorkspace (lazy)", () => {
  it("não monta nada fechado; abre o modal só quando pedido", async () => {
    const store = criarStoreAdicionar({ api: () => undefined });
    render(<HostAdicionarWorkspace store={store} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => store.abrir("clonar"));
    expect(await screen.findByRole("dialog", { name: "Adicionar workspace" })).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".aw")).not.toBeNull());
  });
});
