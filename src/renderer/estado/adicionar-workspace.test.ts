import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../compartilhado/dominio";
import type { AchadoProjeto, AvaliacaoDestino, EventoClone, LoteProjetos } from "../../compartilhado/workspaces-adicionar";
import { criarStoreAdicionar, podeClonar, podeCriar, type OpcoesAdicionar, type SuiteAdicionar } from "./adicionar-workspace";

const ws = (id = "ws_AAAAAAAAAAAA", nome = "repo"): Workspace => ({ id, nome, raiz: `/p/${nome}`, e_git: true, acesso_externo: "leitura", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" });
const livre = (nome: string): AvaliacaoDestino => ({ ok: true, situacao: "livre", caminho_exibicao: `~/Developer/${nome}`, motivo: null, sugestao: null, ja_workspace: false });
const evento = (e: Partial<EventoClone>): EventoClone => ({ clone_id: "cl_1", fase: "recebendo", percentual: 45, bytes: null, velocidade_bps: null, mensagem: "", workspace: null, erro: null, destino_exibicao: "~/Developer/repo", nao_confiavel: true, ...e });

function montar(sobre: Record<string, unknown> = {}, opSuite?: Partial<SuiteAdicionar>) {
  let aoProgresso: (e: EventoClone) => void = () => undefined;
  let aoLote: (l: LoteProjetos) => void = () => undefined;
  const api = {
    abrir: vi.fn().mockResolvedValue(null),
    definirAtual: vi.fn().mockResolvedValue(null),
    adicionarDestinoPadrao: vi.fn().mockResolvedValue({ token: "d_AbCdEfGhIjKl", exibicao: "~/Developer" }),
    adicionarEscolherPasta: vi.fn().mockResolvedValue(null),
    adicionarAvaliarDestino: vi.fn(async (p: { nome: string }) => livre(p.nome)),
    adicionarAbrirDestino: vi.fn().mockResolvedValue(ws()),
    adicionarClonar: vi.fn().mockResolvedValue({ ok: true, clone_id: "cl_1" }),
    adicionarCancelarClone: vi.fn().mockResolvedValue(true),
    adicionarBuscarProjetos: vi.fn().mockResolvedValue({ busca_id: "bu_1" }),
    adicionarCancelarBusca: vi.fn().mockResolvedValue(true),
    adicionarProjetoAchado: vi.fn().mockResolvedValue(ws()),
    adicionarGhEstado: vi.fn().mockResolvedValue({ instalado: true, autenticado: true, usuario: "fulana" }),
    adicionarListarRepos: vi.fn().mockResolvedValue({ ok: true, repos: [], truncado: false }),
    adicionarNovo: vi.fn().mockResolvedValue({ ok: true, workspace: ws("ws_BBBBBBBBBBBB", "novo"), avisos: [], instalar_suite: false }),
    assinarAdicionarProgresso: vi.fn((cb: (e: EventoClone) => void) => { aoProgresso = cb; return () => undefined; }),
    assinarAdicionarProjetos: vi.fn((cb: (l: LoteProjetos) => void) => { aoLote = cb; return () => undefined; }),
    ...sobre,
  };
  const suite: SuiteAdicionar = { garantirEstado: vi.fn().mockResolvedValue(undefined), estadoDe: vi.fn(() => ({ estado: "ausente" })), abrirModalPara: vi.fn(), ...opSuite };
  const aoAdicionar = vi.fn();
  const store = criarStoreAdicionar({ api: () => api as unknown as ReturnType<OpcoesAdicionar["api"]>, suite, aoAdicionar, esperar: async () => undefined } as OpcoesAdicionar);
  return { store, api, suite, aoAdicionar, emitir: (e: EventoClone) => aoProgresso(e), lote: (l: LoteProjetos) => aoLote(l) };
}
const assentar = async (): Promise<void> => { await vi.waitFor(() => undefined); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => void 0);
afterEach(() => vi.restoreAllMocks());

describe("abrir / fechar (lazy)", () => {
  it("fechado, nada é pedido ao main; abrir pede só o destino padrão e liga os eventos", async () => {
    const m = montar();
    expect(m.api.adicionarDestinoPadrao).not.toHaveBeenCalled();
    expect(m.api.assinarAdicionarProgresso).not.toHaveBeenCalled();
    m.store.abrir("clonar");
    await assentar();
    expect(m.store.obter()).toMatchObject({ aberto: true, secao: "clonar", destino: { exibicao: "~/Developer" } });
    expect(m.api.adicionarDestinoPadrao).toHaveBeenCalledTimes(1);
    expect(m.api.assinarAdicionarProgresso).toHaveBeenCalledTimes(1);
    expect(m.api.adicionarGhEstado).toHaveBeenCalledTimes(1); // estado local do gh só ao entrar em Clonar
    expect(m.api.adicionarListarRepos).not.toHaveBeenCalled(); // rede só no clique
    expect(m.api.adicionarBuscarProjetos).not.toHaveBeenCalled(); // varredura só no clique
  });
  it("abre já na seção pedida; reabrir com o modal aberto só troca a seção", async () => {
    const m = montar();
    m.store.abrir("novo");
    expect(m.store.obter().secao).toBe("novo");
    m.store.abrir("pasta");
    expect(m.store.obter().secao).toBe("pasta");
    expect(m.api.adicionarDestinoPadrao).toHaveBeenCalledTimes(1);
  });
  it("sem a ponte do app (fora do Electron): abre avisando que só funciona no aplicativo", () => {
    const store = criarStoreAdicionar({ api: () => undefined });
    store.abrir("pasta");
    expect(store.obter()).toMatchObject({ aberto: true, disponivel: false });
  });
  it("fechar cancela a busca em andamento", async () => {
    const m = montar();
    m.store.abrir("pasta");
    await m.store.buscarProjetos();
    m.store.fechar();
    expect(m.api.adicionarCancelarBusca).toHaveBeenCalledWith("bu_1");
    expect(m.store.obter().aberto).toBe(false);
  });
});

describe("abrir pasta", () => {
  it("diálogo nativo: adiciona, avisa e fecha", async () => {
    const m = montar({ abrir: vi.fn().mockResolvedValue(ws()) });
    m.store.abrir("pasta");
    expect(await m.store.escolherPastaNativa()).toBe(true);
    expect(m.api.abrir).toHaveBeenCalledWith(null);
    expect(m.aoAdicionar).toHaveBeenCalled();
    expect(m.store.obter().aberto).toBe(false);
  });
  it("diálogo cancelado: o modal continua aberto", async () => {
    const m = montar();
    m.store.abrir("pasta");
    expect(await m.store.escolherPastaNativa()).toBe(false);
    expect(m.store.obter().aberto).toBe(true);
  });
  it("recente: troca o workspace e fecha", async () => {
    const m = montar();
    m.store.abrir("pasta");
    await m.store.abrirRecente("ws_AAAAAAAAAAAA");
    expect(m.api.definirAtual).toHaveBeenCalledWith("ws_AAAAAAAAAAAA");
    expect(m.store.obter().aberto).toBe(false);
  });
  it("varredura: lotes chegam, ignora lote de outra busca, adiciona achado por id (nunca por caminho)", async () => {
    const m = montar();
    m.store.abrir("pasta");
    await m.store.buscarProjetos();
    const a: AchadoProjeto = { id: "ach_1", nome: "app", exibicao: "~/Developer/app", branch: "main", e_git: true, manifesto: null, ja_workspace: false };
    m.lote({ busca_id: "bu_outra", itens: [{ ...a, id: "ach_x" }], visitados: 1, fim: false, cancelada: false, limite_atingido: false });
    expect(m.store.obter().busca.itens).toHaveLength(0);
    m.lote({ busca_id: "bu_1", itens: [a], visitados: 12, fim: false, cancelada: false, limite_atingido: false });
    expect(m.store.obter().busca).toMatchObject({ fase: "buscando", visitados: 12 });
    m.lote({ busca_id: "bu_1", itens: [], visitados: 40, fim: true, cancelada: false, limite_atingido: false });
    expect(m.store.obter().busca).toMatchObject({ fase: "pronta", itens: [a] });
    expect(await m.store.adicionarAchado("ach_1")).toBe(true);
    expect(m.api.adicionarProjetoAchado).toHaveBeenCalledWith("ach_1");
    expect(m.store.obter().aberto).toBe(false);
  });
  it("cancelar busca", async () => {
    const m = montar();
    m.store.abrir("pasta");
    await m.store.buscarProjetos();
    await m.store.cancelarBusca();
    expect(m.api.adicionarCancelarBusca).toHaveBeenCalledWith("bu_1");
    expect(m.store.obter().busca).toMatchObject({ fase: "pronta", cancelada: true });
  });
});

describe("clonar — formulário", () => {
  it("valida a URL ao digitar (origem), sugere o nome e avalia o destino", async () => {
    const m = montar();
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "https://github.com/dono/meu-repo.git" });
    await assentar();
    const c = m.store.obter().clonar;
    expect(c.origem).toMatchObject({ ok: true, origem: { host: "github.com", repo: "meu-repo" } });
    expect(c.nome).toBe("meu-repo");
    expect(m.api.adicionarAvaliarDestino).toHaveBeenLastCalledWith({ destino_token: "d_AbCdEfGhIjKl", nome: "meu-repo" });
    expect(c.avaliacao?.ok).toBe(true);
    expect(podeClonar(c, m.store.obter().destino)).toBe(true);
  });
  it("recusa URL com credencial e opção injetada (não deixa clonar)", async () => {
    const m = montar();
    m.store.abrir("clonar");
    await assentar();
    for (const e of ["https://u:p@github.com/a/b", "--upload-pack=x", "ext::sh -c id"]) {
      m.store.definirClonar({ entrada: e });
      await assentar();
      expect(m.store.obter().clonar.origem?.ok).toBe(false);
      expect(podeClonar(m.store.obter().clonar, m.store.obter().destino)).toBe(false);
    }
  });
  it("nome editado pelo dono não é sobrescrito pela sugestão; nome/branch inválidos bloqueiam", async () => {
    const m = montar();
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "dono/repo" });
    m.store.definirClonar({ nome: "meu-nome" });
    m.store.definirClonar({ entrada: "dono/outro" });
    expect(m.store.obter().clonar.nome).toBe("meu-nome");
    m.store.definirClonar({ nome: "../fora" });
    expect(m.store.obter().clonar.erroNome).toBeTruthy();
    m.store.definirClonar({ nome: "ok", branch: "--upload-pack=x" });
    await assentar();
    expect(m.store.obter().clonar.erroBranch).toBeTruthy();
    expect(podeClonar(m.store.obter().clonar, m.store.obter().destino)).toBe(false);
  });
  it("caminho local só com a permissão E a confirmação", async () => {
    const m = montar();
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "/tmp/repo" });
    expect(m.store.obter().clonar.origem).toMatchObject({ ok: false, codigo: "local_bloqueado" });
    m.store.definirClonar({ permitirLocal: true });
    expect(m.store.obter().clonar.origem?.ok).toBe(false);
    m.store.definirClonar({ localConfirmado: true });
    expect(m.store.obter().clonar.origem?.ok).toBe(true);
    m.store.definirClonar({ permitirLocal: false });
    expect(m.store.obter().clonar.localConfirmado).toBe(false);
    expect(m.store.obter().clonar.origem?.ok).toBe(false);
  });
  it("colisão: a avaliação ocupada bloqueia e oferece a sugestão", async () => {
    const m = montar({ adicionarAvaliarDestino: vi.fn().mockResolvedValue({ ok: false, situacao: "ocupado", caminho_exibicao: "~/Developer/repo", motivo: "x", sugestao: "repo-2", ja_workspace: false }) });
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "dono/repo" });
    await assentar();
    expect(podeClonar(m.store.obter().clonar, m.store.obter().destino)).toBe(false);
    m.store.usarSugestao();
    expect(m.store.obter().clonar.nome).toBe("repo-2");
  });
  it("avaliação velha não sobrescreve a nova", async () => {
    let n = 0;
    const m = montar({ adicionarAvaliarDestino: vi.fn(async (p: { nome: string }) => { n++; if (n === 1) await new Promise((r) => setTimeout(r, 30)); return livre(p.nome); }) });
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "dono/a" });
    m.store.definirClonar({ entrada: "dono/b" });
    await new Promise((r) => setTimeout(r, 60));
    expect(m.store.obter().clonar.avaliacao?.caminho_exibicao).toBe("~/Developer/b");
  });
  it("seletor nativo do destino: lembrar vai ao main; o novo token vale", async () => {
    const m = montar({ adicionarEscolherPasta: vi.fn().mockResolvedValue({ token: "d_OutroToken123", exibicao: "~/Projetos" }) });
    m.store.abrir("clonar");
    await assentar();
    await m.store.escolherDestino(true);
    expect(m.api.adicionarEscolherPasta).toHaveBeenCalledWith(true);
    expect(m.store.obter().destino?.token).toBe("d_OutroToken123");
  });
});

describe("clonar — consentimento, progresso e término", () => {
  async function pronto() {
    const m = montar();
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "https://github.com/dono/repo" });
    await assentar();
    return m;
  }
  it("sem consentimento não clona; o consentimento mostra a linha e só então o botão Clonar chama o main", async () => {
    const m = await pronto();
    await m.store.clonarAgora();
    expect(m.api.adicionarClonar).not.toHaveBeenCalled();
    m.store.pedirConsentimento();
    expect(m.store.obter().clonar.consentindo).toBe(true);
    await m.store.clonarAgora();
    expect(m.api.adicionarClonar).toHaveBeenCalledWith({ entrada: "https://github.com/dono/repo", permitir_local: false, destino_token: "d_AbCdEfGhIjKl", nome: "repo", branch: null, raso: false, submodulos: false, consentimento: true });
  });
  it("mudar qualquer campo desfaz o consentimento (confirma o que vê)", async () => {
    const m = await pronto();
    m.store.pedirConsentimento();
    m.store.definirClonar({ raso: true });
    expect(m.store.obter().clonar.consentindo).toBe(false);
  });
  it("progresso ao vivo, depois concluído com workspace; confere a suíte", async () => {
    const m = await pronto();
    m.store.pedirConsentimento();
    await m.store.clonarAgora();
    expect(m.store.obter().clone.fase).toBe("iniciando");
    m.emitir(evento({ fase: "recebendo", percentual: 45, bytes: 1_258_291 }));
    expect(m.store.obter().clone).toMatchObject({ fase: "clonando", evento: { percentual: 45 } });
    m.emitir(evento({ fase: "concluido", percentual: 100, workspace: ws() }));
    await assentar();
    expect(m.store.obter().clone).toMatchObject({ fase: "pronto", suiteFalta: true });
    expect(m.suite.garantirEstado).toHaveBeenCalledWith("ws_AAAAAAAAAAAA", true);
    m.store.instalarSuiteDoClone();
    expect(m.suite.abrirModalPara).toHaveBeenCalledWith("ws_AAAAAAAAAAAA");
    expect(m.store.obter().aberto).toBe(false);
  });
  it("suíte já completa: não oferece instalar", async () => {
    const m = montar({}, { estadoDe: () => ({ estado: "completa" }) });
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "dono/repo" });
    await assentar();
    m.store.pedirConsentimento();
    await m.store.clonarAgora();
    m.emitir(evento({ fase: "concluido", workspace: ws() }));
    await assentar();
    expect(m.store.obter().clone.suiteFalta).toBe(false);
  });
  it("evento que chega ANTES da resposta do invoke não se perde; evento de outro clone é ignorado", async () => {
    let resolver: (v: unknown) => void = () => undefined;
    const m = montar({ adicionarClonar: vi.fn(() => new Promise((r) => { resolver = r; })) });
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "dono/repo" });
    await assentar();
    m.store.pedirConsentimento();
    const p = m.store.clonarAgora();
    m.emitir(evento({ fase: "recebendo", percentual: 10 }));
    resolver({ ok: true, clone_id: "cl_1" });
    await p;
    expect(m.store.obter().clone.evento?.percentual).toBe(10);
    m.emitir(evento({ clone_id: "cl_outro", percentual: 99 }));
    expect(m.store.obter().clone.evento?.percentual).toBe(10);
  });
  it("erro de acesso: fase erro com a ação de login; tentar de novo volta ao formulário", async () => {
    const m = await pronto();
    m.store.pedirConsentimento();
    await m.store.clonarAgora();
    m.emitir(evento({ fase: "falhou", erro: { codigo: "sem_acesso", mensagem: "Sem acesso", acao: "login_gh", sugestao: null } }));
    expect(m.store.obter().clone).toMatchObject({ fase: "erro", erro: { acao: "login_gh" } });
    m.store.reiniciarClone();
    expect(m.store.obter().clone.fase).toBe("ocioso");
    expect(m.store.obter().clonar.entrada).toBe("https://github.com/dono/repo");
  });
  it("recusa do main ao iniciar (ex.: colisão) vira erro sem ficar preso em 'iniciando'", async () => {
    const m = montar({ adicionarClonar: vi.fn().mockResolvedValue({ ok: false, erro: { codigo: "colisao", mensagem: "existe", acao: "escolher_outro_nome", sugestao: "repo-2" } }) });
    m.store.abrir("clonar");
    await assentar();
    m.store.definirClonar({ entrada: "dono/repo" });
    await assentar();
    m.store.pedirConsentimento();
    await m.store.clonarAgora();
    expect(m.store.obter().clone).toMatchObject({ fase: "erro", erro: { codigo: "colisao" } });
  });
  it("cancelar clone chama o main com o id; cancelado vira fase cancelado", async () => {
    const m = await pronto();
    m.store.pedirConsentimento();
    await m.store.clonarAgora();
    await m.store.cancelarClone();
    expect(m.api.adicionarCancelarClone).toHaveBeenCalledWith("cl_1");
    m.emitir(evento({ fase: "cancelado" }));
    expect(m.store.obter().clone.fase).toBe("cancelado");
  });
  it("clone em andamento sobrevive a fechar e reabrir; o formulário não é editável durante", async () => {
    const m = await pronto();
    m.store.pedirConsentimento();
    await m.store.clonarAgora();
    m.emitir(evento({ percentual: 30 }));
    m.store.definirClonar({ entrada: "dono/outro" });
    expect(m.store.obter().clonar.entrada).toBe("https://github.com/dono/repo");
    m.store.fechar();
    m.emitir(evento({ percentual: 60 }));
    m.store.abrir("clonar");
    expect(m.store.obter().clone).toMatchObject({ fase: "clonando", evento: { percentual: 60 } });
  });
  it("abrir a pasta existente em vez de sobrescrever", async () => {
    const m = await pronto();
    expect(await m.store.abrirExistente("clonar")).toBe(true);
    expect(m.api.adicionarAbrirDestino).toHaveBeenCalledWith({ destino_token: "d_AbCdEfGhIjKl", nome: "repo" });
    expect(m.store.obter().aberto).toBe(false);
  });
});

describe("meus repositórios (gh)", () => {
  it("só carrega no clique, com consentimento; erro com ação de login", async () => {
    const m = montar({ adicionarListarRepos: vi.fn().mockResolvedValue({ ok: false, erro: { codigo: "sem_acesso", mensagem: "login", acao: "login_gh", sugestao: null } }) });
    m.store.abrir("clonar");
    await assentar();
    expect(m.api.adicionarListarRepos).not.toHaveBeenCalled();
    await m.store.carregarRepos();
    expect(m.api.adicionarListarRepos).toHaveBeenCalledWith(true);
    expect(m.store.obter().repos).toMatchObject({ fase: "erro", erro: { acao: "login_gh" } });
  });
  it("escolher um repositório preenche a URL e a validação roda", async () => {
    const repo = { nome: "r", nome_com_dono: "fulana/r", descricao: "", privado: true, atualizado_em: null, url: "https://github.com/fulana/r" };
    const m = montar({ adicionarListarRepos: vi.fn().mockResolvedValue({ ok: true, repos: [repo], truncado: false }) });
    m.store.abrir("clonar");
    await assentar();
    await m.store.carregarRepos();
    expect(m.store.obter().repos.lista).toEqual([repo]);
    m.store.escolherRepo(repo);
    expect(m.store.obter().clonar).toMatchObject({ entrada: "https://github.com/fulana/r", nome: "r" });
  });
  it("gh ausente/não autenticado só informa o estado", async () => {
    const m = montar({ adicionarGhEstado: vi.fn().mockResolvedValue({ instalado: true, autenticado: false, usuario: null }) });
    m.store.abrir("clonar");
    await assentar();
    expect(m.store.obter().gh).toEqual({ instalado: true, autenticado: false, usuario: null });
  });
});

describe("novo projeto", () => {
  it("valida o nome, avalia o destino e cria; adiciona e troca", async () => {
    const m = montar();
    m.store.abrir("novo");
    await assentar();
    expect(podeCriar(m.store.obter().novo, m.store.obter().destino)).toBe(false);
    m.store.definirNovo({ nome: "../x" });
    expect(m.store.obter().novo.erroNome).toBeTruthy();
    m.store.definirNovo({ nome: "app-novo", template: "node" });
    await assentar();
    expect(podeCriar(m.store.obter().novo, m.store.obter().destino)).toBe(true);
    expect(await m.store.criarNovo()).toBe(true);
    expect(m.api.adicionarNovo).toHaveBeenCalledWith({ nome: "app-novo", destino_token: "d_AbCdEfGhIjKl", git: true, gitignore: true, commit_inicial: true, readme: true, template: "node", instalar_suite: false });
    expect(m.aoAdicionar).toHaveBeenCalled();
    expect(m.store.obter().criacao.fase).toBe("pronto");
    expect(m.store.obter().aberto).toBe(true); // mostra "Pronto"; o dono fecha
  });
  it("sem git, .gitignore e commit saem desligados no pedido", async () => {
    const m = montar();
    m.store.abrir("novo");
    await assentar();
    m.store.definirNovo({ nome: "x", git: false });
    await assentar();
    await m.store.criarNovo();
    expect(m.api.adicionarNovo).toHaveBeenCalledWith(expect.objectContaining({ git: false, gitignore: false, commit_inicial: false }));
  });
  it("instalar suíte ao criar: fecha o modal e abre o assistente existente (não reimplementa)", async () => {
    const m = montar({ adicionarNovo: vi.fn().mockResolvedValue({ ok: true, workspace: ws("ws_BBBBBBBBBBBB", "novo"), avisos: [], instalar_suite: true }) });
    m.store.abrir("novo");
    await assentar();
    m.store.definirNovo({ nome: "novo", instalarSuite: true });
    await assentar();
    await m.store.criarNovo();
    expect(m.suite.abrirModalPara).toHaveBeenCalledWith("ws_BBBBBBBBBBBB");
    expect(m.store.obter().aberto).toBe(false);
  });
  it("erro do main (ex.: pasta existente) fica visível e liberta o formulário", async () => {
    const m = montar({ adicionarNovo: vi.fn().mockResolvedValue({ ok: false, erro: { codigo: "colisao", mensagem: "Já existe", acao: "escolher_outro_nome", sugestao: "x-2" } }) });
    m.store.abrir("novo");
    await assentar();
    m.store.definirNovo({ nome: "x" });
    await assentar();
    expect(await m.store.criarNovo()).toBe(false);
    expect(m.store.obter().criacao).toMatchObject({ fase: "erro", erro: { codigo: "colisao" } });
    m.store.definirNovo({ nome: "x-2" });
    expect(m.store.obter().criacao.fase).toBe("ocioso");
  });
});
