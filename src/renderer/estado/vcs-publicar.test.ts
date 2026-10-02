import { describe, expect, it, vi } from "vitest";
import type { ApiVcsPublicar, EstadoPublicacao, OpcoesPublicacao, PedidoPedirMerge, PreparoAtualizar, PreparoPublicacao, ResultadoAtualizar, ResultadoBuscaRemoto, ResultadoEnviarInstrucao, ResultadoIgnorarSuite } from "../../compartilhado/vcs-publicar";
import { criarStorePublicar, DURACAO_ACOMPANHAMENTO_MS, ESPERAS_PR_JA_PUBLICADO_MS, ESPERAS_PR_MS, type StorePublicar } from "./vcs-publicar";

const WS = "ws_AAAAAAAAAAAA";
const fatos = (p: Partial<EstadoPublicacao> = {}): EstadoPublicacao => ({ git: true, remoto_github: true, repo: "dono/repo", gh: "ok", branch: "feat/x", ramo_padrao: "main", no_padrao: false, alteradas: 3, novas: 0, suite: { itens: 0, caminhos: [] }, atras: 0, upstream: null, a_frente: 0, a_frente_base: 1, tem_upstream: false, operacao_em_curso: false, oid: "aaa1111", pr: null, ...p });
const preparo = (p: Partial<PreparoPublicacao> = {}): PreparoPublicacao => ({ tipo: "commit_push", workspace_id: WS, branch: "feat/x", remoto: "origin", repo: "dono/repo", ramo_padrao: "main", no_padrao: false, total_arquivos: 3, novos: 0, suite: { itens: 0, caminhos: [], incluiveis: 0 }, adicionadas: 5, removidas: 1, arquivos: [], mais: 0, sensiveis: [], a_frente: 0, tem_upstream: false, sugestao_ramo: "feat/x-1001", clis: [{ id: "claude", nome: "Claude Code" }], cli_padrao: "claude", cli_foco: null, ...p });
const opcoes = (p: Partial<OpcoesPublicacao> = {}): OpcoesPublicacao => ({ criar_ramo: false, nome_ramo: null, incluir_nao_rastreados: true, incluir_suite: false, mensagem: { modo: "agente", texto: null }, pr: null, confirmar_padrao: null, ...p });
const preparoAtualizar = (p: Partial<PreparoAtualizar> = {}): PreparoAtualizar => ({ workspace_id: WS, branch: "main", upstream: "origin/main", remoto: "origin", repo: "dono/repo", commits: 2, a_frente: 0, arquivos_tocados: 2, arquivos: ["src/a.ts", "src/b.ts"], mais: 0, assuntos: ["feat: b", "feat: a"], conflita: [], divergiu: false, operacao_em_curso: false, clis: [{ id: "claude", nome: "Claude Code" }], cli_padrao: "claude", cli_foco: null, ...p });
const entregue = (p: Partial<ResultadoEnviarInstrucao> = {}): ResultadoEnviarInstrucao => ({ estado: "entregue", motivo: null, pane_id: "pane_1", sessao_id: "sessao_1", entrega: "escrita", instrucao_rel: ".p/publicar/x.md", ...p });

function montar(o: { fatos?: EstadoPublicacao; preparo?: PreparoPublicacao; resultado?: ResultadoEnviarInstrucao | Error } = {}) {
  let f = o.fatos ?? fatos();
  const api = {
    estado: vi.fn(async (_ws: string, consultarPr?: boolean) => (consultarPr === true ? { ...f, pr: pr } : f)),
    prepararCommitPush: vi.fn(async () => o.preparo ?? preparo()),
    prepararPr: vi.fn(async () => o.preparo ?? preparo({ tipo: "pr" })),
    enviarInstrucao: vi.fn(async (): Promise<ResultadoEnviarInstrucao> => { if (o.resultado instanceof Error) throw o.resultado; return o.resultado ?? entregue(); }),
    abrirUrl: vi.fn(async () => true),
    buscarRemoto: vi.fn(async (_ws: string, _forcar: boolean): Promise<ResultadoBuscaRemoto> => ({ buscou: false, atras: 0, erro: null })),
    prepararAtualizar: vi.fn(async (): Promise<PreparoAtualizar> => preparoAtualizar()),
    atualizar: vi.fn(async (): Promise<ResultadoAtualizar> => ({ estado: "ok", motivo: null, trouxe: 2, sugerir_commitar: false })),
    pedirMerge: vi.fn(async (_p: PedidoPedirMerge): Promise<ResultadoEnviarInstrucao> => entregue()),
    ignorarSuite: vi.fn(async (): Promise<ResultadoIgnorarSuite> => ({ estado: "ok", linhas: 3 })),
  } satisfies ApiVcsPublicar;
  let pr: EstadoPublicacao["pr"] = null;
  const avisos: Array<{ texto: string; tom?: string; acao?: { rotulo: string; executar: () => void } }> = [];
  const agendados: Array<{ fn: () => void; ms: number; cancelado: boolean }> = [];
  const focadas: string[] = [];
  const resumos: string[] = [];
  let t = 1_000;
  const store: StorePublicar = criarStorePublicar({
    api: () => api,
    agora: () => t,
    agendar: (fn, ms) => { const a = { fn: () => { a.cancelado = true; fn(); }, ms, cancelado: false }; agendados.push(a); return () => { a.cancelado = true; }; },
    avisar: (texto, tom, acao) => { avisos.push({ texto, ...(tom === undefined ? {} : { tom }), ...(acao === undefined ? {} : { acao }) }); return avisos.length; },
    focar: (id) => void focadas.push(id),
    sessaoEmFoco: () => "sessao_foco",
    atualizarResumo: (id) => void resumos.push(id),
  });
  store.definirWorkspace(WS);
  return {
    api, store, avisos, agendados, focadas, resumos,
    fatosAgora: (n: Partial<EstadoPublicacao>) => { f = { ...f, ...n }; return store.atualizar(); },
    definirPr: (p: EstadoPublicacao["pr"]) => { pr = p; },
    avancar: (ms: number) => void (t += ms),
    pendentes: () => agendados.filter((a) => !a.cancelado),
  };
}

describe("fatos e diálogo", () => {
  it("atualizar busca os fatos do workspace atual (coalesce várias chamadas)", async () => {
    const m = montar();
    await Promise.all([m.store.atualizar(), m.store.atualizar(), m.store.atualizar()]);
    expect(m.store.obter().fatos?.branch).toBe("feat/x");
    expect(m.api.estado.mock.calls.length).toBeLessThanOrEqual(2);
    expect(m.api.estado).toHaveBeenCalledWith(WS, false);
  });
  it("gh ainda 'desconhecido': refaz UMA vez em 3 s (sem polling)", async () => {
    const m = montar({ fatos: fatos({ gh: "desconhecido" }) });
    await m.store.atualizar();
    expect(m.pendentes().map((a) => a.ms)).toEqual([3_000]);
  });
  it("abrir: prepara com a sessão em foco e mostra o diálogo pronto; erro vira fase erro", async () => {
    const m = montar();
    await m.store.abrir("commit_push");
    expect(m.api.prepararCommitPush).toHaveBeenCalledWith(WS, "sessao_foco");
    expect(m.store.obter().dialogo).toMatchObject({ tipo: "commit_push", fase: "pronto" });
    m.store.fechar();
    expect(m.store.obter().dialogo).toBeNull();
    m.api.prepararPr.mockRejectedValueOnce(new Error("[vcs-erro] O remoto origin não aponta para o GitHub"));
    await m.store.abrir("pr");
    expect(m.store.obter().dialogo).toMatchObject({ fase: "erro", erro: "O remoto origin não aponta para o GitHub" });
  });
  it("trocar de workspace fecha tudo e esquece os fatos", async () => {
    const m = montar();
    await m.store.atualizar();
    await m.store.abrir("commit_push");
    m.store.definirWorkspace("ws_BBBBBBBBBBBB");
    expect(m.store.obter()).toMatchObject({ fatos: null, dialogo: null, faixa: null, workspaceId: "ws_BBBBBBBBBBBB" });
  });
});

describe("envio (contrato de entrega D-620)", () => {
  it("entregue: fecha o diálogo, FOCA o painel do agente, mostra a faixa e passa a acompanhar", async () => {
    const m = montar();
    await m.store.atualizar();
    await m.store.abrir("commit_push");
    await m.store.enviar(opcoes(), "claude");
    expect(m.api.enviarInstrucao).toHaveBeenCalledWith({ workspace_id: WS, tipo: "commit_push", opcoes: opcoes(), sessao_foco: "sessao_foco", cli: "claude", modo_painel: "auto" });
    expect(m.focadas).toEqual(["sessao_1"]);
    const e = m.store.obter();
    expect(e.dialogo).toBeNull();
    expect(e.faixa).toMatchObject({ tipo: "commit_push", texto: "Commit e push enviado ao agente…", sessaoId: "sessao_1" });
    expect(e.seguindo).toBe(true);
    m.store.focarAgente();
    expect(m.focadas).toEqual(["sessao_1", "sessao_1"]);
  });
  it("falhou: mostra o motivo, mantém o diálogo e NÃO navega", async () => {
    const m = montar({ resultado: entregue({ estado: "falhou", motivo: "A CLI Claude Code saiu antes de receber a instrução.", sessao_id: "sessao_x", pane_id: "pane_x", entrega: null }) });
    await m.store.atualizar();
    await m.store.abrir("commit_push");
    await m.store.enviar(opcoes(), "claude");
    expect(m.focadas).toEqual([]);
    expect(m.store.obter().dialogo).toMatchObject({ fase: "erro", erro: "A CLI Claude Code saiu antes de receber a instrução." });
    expect(m.store.obter().faixa).toBeNull();
    expect(m.store.obter().seguindo).toBe(false);
  });
  it("exceção do IPC também não navega", async () => {
    const m = montar({ resultado: new Error("[vcs-erro] Nada para commitar.") });
    await m.store.abrir("commit_push");
    await m.store.enviar(opcoes(), "claude");
    expect(m.focadas).toEqual([]);
    expect(m.store.obter().dialogo).toMatchObject({ fase: "erro", erro: "Nada para commitar." });
  });
  it("agente ocupado: pergunta; 'abrir painel novo' reenvia com modo novo; 'cancelar' volta ao formulário", async () => {
    const m = montar({ resultado: entregue({ estado: "ocupado", motivo: "O agente está trabalhando. Abrir um painel novo para isto?", sessao_id: null, pane_id: "pane_1", entrega: null }) });
    await m.store.abrir("commit_push");
    await m.store.enviar(opcoes(), "claude");
    expect(m.store.obter().dialogo?.fase).toBe("ocupado");
    expect(m.focadas).toEqual([]);
    await m.store.responderOcupado(false);
    expect(m.store.obter().dialogo?.fase).toBe("pronto");
    await m.store.enviar(opcoes(), "claude");
    m.api.enviarInstrucao.mockResolvedValueOnce(entregue({ entrega: "prompt_inicial", sessao_id: "sessao_novo" }));
    await m.store.responderOcupado(true);
    expect(m.api.enviarInstrucao).toHaveBeenLastCalledWith(expect.objectContaining({ modo_painel: "novo" }));
    expect(m.focadas).toEqual(["sessao_novo"]);
  });
  it("branch padrão sem criar branch: NÃO envia; abre a confirmação digitada à parte e só envia com a frase (o main confere de novo)", async () => {
    const m = montar({ preparo: preparo({ no_padrao: true, branch: "main" }) });
    await m.store.abrir("commit_push");
    await m.store.enviar(opcoes({ criar_ramo: false }), "claude");
    expect(m.api.enviarInstrucao).not.toHaveBeenCalled();
    expect(m.store.obter().dialogo?.fase).toBe("confirmar_padrao");
    m.store.cancelarConfirmacao();
    expect(m.store.obter().dialogo?.fase).toBe("pronto");
    await m.store.enviar(opcoes({ criar_ramo: false }), "claude");
    await m.store.confirmarPadrao("push na main");
    expect(m.api.enviarInstrucao).toHaveBeenCalledWith(expect.objectContaining({ opcoes: expect.objectContaining({ confirmar_padrao: "push na main", criar_ramo: false }) }));
  });
  it("branch padrão criando branch novo: envia direto (sem diálogo extra)", async () => {
    const m = montar({ preparo: preparo({ no_padrao: true, branch: "main" }) });
    await m.store.abrir("commit_push");
    await m.store.enviar(opcoes({ criar_ramo: true, nome_ramo: "feat/x" }), "claude");
    expect(m.api.enviarInstrucao).toHaveBeenCalledOnce();
  });
});

describe("acompanhamento (sem polling novo)", () => {
  async function seguir(tipo: "commit_push" | "pr", f: Partial<EstadoPublicacao> = {}, op: Partial<OpcoesPublicacao> = {}) {
    const m = montar({ fatos: fatos(f) });
    await m.store.atualizar();
    await m.store.abrir(tipo);
    await m.store.enviar(opcoes(op), "claude");
    return m;
  }
  it("commit criado: toast; depois do push: toast com 'Abrir no navegador' (https://github.com do branch) e a faixa some", async () => {
    const m = await seguir("commit_push");
    await m.fatosAgora({ oid: "bbb2222", a_frente: 1, alteradas: 0 });
    expect(m.avisos.map((a) => a.texto)).toEqual(["Commit bbb2222 criado em feat/x."]);
    expect(m.store.obter().faixa?.texto).toBe("Commit bbb2222 criado; aguardando o push…");
    await m.fatosAgora({ a_frente: 0, tem_upstream: true });
    expect(m.avisos.map((a) => a.texto)).toEqual(["Commit bbb2222 criado em feat/x.", "Commit bbb2222 enviado para origin/feat/x."]);
    const toast = m.avisos[1]!;
    expect(toast.tom).toBe("sucesso");
    toast.acao?.executar();
    expect(m.api.abrirUrl).toHaveBeenCalledWith(WS, "https://github.com/dono/repo/tree/feat/x");
    expect(m.store.obter()).toMatchObject({ faixa: null, seguindo: false });
  });
  it("branch novo criado pelo agente: o push é do branch alvo", async () => {
    const m = await seguir("commit_push", { branch: "main", no_padrao: true, tem_upstream: true }, { criar_ramo: true, nome_ramo: "feat/novo" });
    await m.fatosAgora({ branch: "feat/novo", oid: "ccc3333", no_padrao: false, tem_upstream: true, a_frente: 0 });
    expect(m.avisos.map((a) => a.texto)).toEqual(["Commit ccc3333 criado em feat/novo.", "Commit ccc3333 enviado para origin/feat/novo."]);
  });
  it("sem mudança nenhuma não há toast", async () => {
    const m = await seguir("commit_push");
    await m.fatosAgora({});
    expect(m.avisos).toEqual([]);
  });
  it("PR: depois do push consulta o gh em tentativas LIMITADAS e mostra 'PR #42 criado' com link seguro", async () => {
    const m = await seguir("pr");
    await m.fatosAgora({ oid: "bbb2222", tem_upstream: true, a_frente: 0 });
    expect(m.pendentes().map((a) => a.ms)).toEqual([ESPERAS_PR_MS[0]]);
    const consultasAntes = m.api.estado.mock.calls.filter((c) => c[1] === true).length;
    expect(consultasAntes).toBe(0);
    // 1ª consulta: ainda sem PR → reagenda; 2ª: PR existe
    m.pendentes()[0]!.fn();
    await vi.waitFor(() => expect(m.api.estado.mock.calls.filter((c) => c[1] === true).length).toBe(1));
    await vi.waitFor(() => expect(m.pendentes().map((a) => a.ms)).toEqual([ESPERAS_PR_MS[1]]));
    m.definirPr({ numero: 42, url: "https://github.com/dono/repo/pull/42", estado: "aberto" });
    m.pendentes()[0]!.fn();
    await vi.waitFor(() => expect(m.avisos.map((a) => a.texto)).toContain("PR #42 criado"));
    m.avisos.find((a) => a.texto === "PR #42 criado")!.acao?.executar();
    expect(m.api.abrirUrl).toHaveBeenCalledWith(WS, "https://github.com/dono/repo/pull/42");
    expect(m.store.obter().seguindo).toBe(false);
  });
  it("PR com no máximo 3 consultas ao gh, e desiste (nada de polling infinito)", async () => {
    const m = await seguir("pr");
    await m.fatosAgora({ oid: "bbb2222", tem_upstream: true, a_frente: 0 });
    for (let i = 0; i < 5; i++) {
      const p = m.pendentes();
      if (p.length === 0) break;
      p[0]!.fn();
      await new Promise((ok) => setTimeout(ok, 0));
    }
    expect(m.api.estado.mock.calls.filter((c) => c[1] === true).length).toBe(ESPERAS_PR_MS.length);
    expect(m.avisos).toEqual([expect.objectContaining({ texto: "Commit bbb2222 criado em feat/x." })]);
  });
  it("PR com branch já publicado: sem sinal local, agenda as consultas espaçadas logo depois da entrega", async () => {
    const m = await seguir("pr", { tem_upstream: true, a_frente: 0 });
    expect(m.pendentes().map((a) => a.ms)).toEqual([ESPERAS_PR_JA_PUBLICADO_MS[0]]);
  });
  it("o acompanhamento expira e some com a faixa; trocar de workspace cancela as consultas", async () => {
    const m = await seguir("commit_push");
    m.avancar(DURACAO_ACOMPANHAMENTO_MS + 1);
    await m.fatosAgora({ oid: "bbb2222" });
    expect(m.avisos).toEqual([]);
    expect(m.store.obter()).toMatchObject({ seguindo: false, faixa: null });

    const n = await seguir("pr", { tem_upstream: true, a_frente: 0 });
    expect(n.pendentes()).toHaveLength(1);
    n.store.definirWorkspace("ws_BBBBBBBBBBBB");
    expect(n.pendentes()).toHaveLength(0);
  });
  it("faixa pode ser dispensada", async () => {
    const m = await seguir("commit_push");
    m.store.dispensarFaixa();
    expect(m.store.obter().faixa).toBeNull();
  });
});

describe("botões publicados para a paleta", () => {
  it("definirBotoes só notifica quando muda", () => {
    const m = montar();
    const ouvinte = vi.fn();
    m.store.assinar(ouvinte);
    const b = { commit: { visivel: true, habilitado: true, rotulo: "Commit e push", tooltip: "", badge: null }, pr: { visivel: true, habilitado: false, rotulo: "Enviar PR", tooltip: "", badge: null }, atualizar: { visivel: true, habilitado: false, rotulo: "Atualizar", tooltip: "", badge: null } };
    m.store.definirBotoes(b);
    m.store.definirBotoes({ ...b });
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(m.store.obter().botoes).toEqual(b);
  });
});

describe("depois do commit/push o resumo se atualiza sem esperar (D-691)", () => {
  it("ao ver o commit e depois o push, o acompanhamento refaz o resumo do Versionamento na hora", async () => {
    const m = montar();
    await m.store.atualizar();
    await m.store.abrir("commit_push");
    await m.store.enviar(opcoes({ criar_ramo: false }), "claude");
    expect(m.resumos).toEqual([]);
    await m.fatosAgora({ oid: "bbb2222", alteradas: 0 });
    expect(m.resumos).toEqual([WS]);
    await m.fatosAgora({ oid: "bbb2222", alteradas: 0, tem_upstream: true, a_frente: 0 });
    expect(m.resumos).toEqual([WS, WS]);
    await m.fatosAgora({ oid: "bbb2222" });
    expect(m.resumos).toHaveLength(2);
  });
  it("a fotografia do clique conta rastreados + novos (a suíte nunca entra)", async () => {
    const m = montar({ fatos: fatos({ alteradas: 1, novas: 2, suite: { itens: 3, caminhos: [".expx/"] } }) });
    await m.store.atualizar();
    await m.store.abrir("commit_push");
    await m.store.enviar(opcoes({ criar_ramo: false }), "claude");
    expect(m.api.enviarInstrucao).toHaveBeenCalledOnce();
  });
});

describe("fetch silencioso do Atualizar (D-693)", () => {
  it("só com upstream e remoto github.com; no máximo a cada 60 s; busca de novo e refaz os fatos quando buscou", async () => {
    const m = montar({ fatos: fatos({ tem_upstream: true }) });
    m.api.buscarRemoto.mockResolvedValueOnce({ buscou: true, atras: 2, erro: null });
    await m.store.atualizar();
    await Promise.resolve(); await Promise.resolve();
    expect(m.api.buscarRemoto).toHaveBeenCalledWith(WS, false);
    await m.store.atualizar();
    expect(m.api.buscarRemoto).toHaveBeenCalledTimes(1);
    m.avancar(61_000);
    await m.store.atualizar();
    expect(m.api.buscarRemoto).toHaveBeenCalledTimes(2);
  });
  it("sem upstream ou sem GitHub: nenhum fetch", async () => {
    const a = montar({ fatos: fatos({ tem_upstream: false }) });
    await a.store.atualizar();
    const b = montar({ fatos: fatos({ tem_upstream: true, remoto_github: false }) });
    await b.store.atualizar();
    expect(a.api.buscarRemoto).not.toHaveBeenCalled();
    expect(b.api.buscarRemoto).not.toHaveBeenCalled();
  });
  it("falha do fetch é silenciosa", async () => {
    const m = montar({ fatos: fatos({ tem_upstream: true }) });
    m.api.buscarRemoto.mockRejectedValueOnce(new Error("sem rede"));
    await m.store.atualizar();
    await Promise.resolve(); await Promise.resolve();
    expect(m.avisos).toEqual([]);
  });
});

describe("diálogo e execução do Atualizar (D-693)", () => {
  it("abrir: busca o remoto por clique (forcar) e mostra o preparo", async () => {
    const m = montar();
    await m.store.abrirAtualizar();
    expect(m.api.buscarRemoto).toHaveBeenCalledWith(WS, true);
    expect(m.store.obter().atualizar).toMatchObject({ fase: "pronto", preparo: { commits: 2, upstream: "origin/main" } });
  });
  it("falha ao preparar: fase erro com o motivo, diálogo continua aberto", async () => {
    const m = montar();
    m.api.prepararAtualizar.mockRejectedValueOnce(new Error("[vcs-erro] Este branch não tem upstream"));
    await m.store.abrirAtualizar();
    expect(m.store.obter().atualizar).toMatchObject({ fase: "erro", erro: "Este branch não tem upstream" });
    m.store.fecharAtualizar();
    expect(m.store.obter().atualizar).toBeNull();
  });
  it("sucesso: toast 'Trouxe N commits', fecha, atualiza resumo e fatos; botão fica desabilitado enquanto roda", async () => {
    const m = montar();
    await m.store.abrirAtualizar();
    let liberar: (r: ResultadoAtualizar) => void = () => undefined;
    m.api.atualizar.mockReturnValueOnce(new Promise<ResultadoAtualizar>((ok) => { liberar = ok; }));
    const p = m.store.confirmarAtualizar();
    expect(m.store.obter().atualizando).toBe(true);
    expect(m.store.obter().atualizar?.fase).toBe("executando");
    liberar({ estado: "ok", motivo: null, trouxe: 2, sugerir_commitar: false });
    await p;
    expect(m.store.obter()).toMatchObject({ atualizando: false, atualizar: null });
    expect(m.avisos).toEqual([{ texto: "Trouxe 2 commits", tom: "sucesso" }]);
    expect(m.resumos).toEqual([WS]);
    m.api.atualizar.mockResolvedValueOnce({ estado: "ok", motivo: null, trouxe: 1, sugerir_commitar: false });
    await m.store.abrirAtualizar();
    await m.store.confirmarAtualizar();
    expect(m.avisos.at(-1)?.texto).toBe("Trouxe 1 commit");
  });
  it("já atualizado: toast informativo e fecha", async () => {
    const m = montar();
    await m.store.abrirAtualizar();
    m.api.atualizar.mockResolvedValueOnce({ estado: "ja_atualizado", motivo: null, trouxe: 0, sugerir_commitar: false });
    await m.store.confirmarAtualizar();
    expect(m.avisos).toEqual([{ texto: "Já está atualizado", tom: "info" }]);
    expect(m.store.obter().atualizar).toBeNull();
  });
  it("recusado (árvore suja que conflita): mostra o motivo e a dica de commitar; não fecha, não avisa sucesso", async () => {
    const m = montar();
    await m.store.abrirAtualizar();
    m.api.atualizar.mockResolvedValueOnce({ estado: "recusado", motivo: "Você alterou localmente arquivos que o remoto também mudou (README.md)", trouxe: 0, sugerir_commitar: true });
    await m.store.confirmarAtualizar();
    expect(m.store.obter().atualizar).toMatchObject({ fase: "recusado", sugerirCommitar: true, erro: expect.stringContaining("README.md") });
    expect(m.avisos).toEqual([]);
    expect(m.store.obter().atualizando).toBe(false);
  });
  it("divergiu: oferece o pedido de merge ao agente; entregue foca o painel e mostra a faixa", async () => {
    const m = montar();
    await m.store.abrirAtualizar();
    m.api.atualizar.mockResolvedValueOnce({ estado: "divergiu", motivo: "O branch divergiu do remoto: peça ao agente para fazer o merge.", trouxe: 0, sugerir_commitar: false });
    await m.store.confirmarAtualizar();
    expect(m.store.obter().atualizar?.fase).toBe("divergiu");
    await m.store.pedirMerge("claude");
    expect(m.api.pedirMerge).toHaveBeenCalledWith({ workspace_id: WS, sessao_foco: "sessao_foco", cli: "claude", modo_painel: "auto" });
    expect(m.store.obter().atualizar).toBeNull();
    expect(m.store.obter().faixa).toMatchObject({ tipo: "merge", sessaoId: "sessao_1" });
    expect(m.focadas).toEqual(["sessao_1"]);
  });
  it("pedido de merge com agente ocupado: pergunta e, se aceito, abre painel novo", async () => {
    const m = montar();
    await m.store.abrirAtualizar();
    m.api.pedirMerge.mockResolvedValueOnce({ estado: "ocupado", motivo: "x", pane_id: "p", sessao_id: null, entrega: null, instrucao_rel: null });
    await m.store.pedirMerge("claude");
    expect(m.store.obter().atualizar?.fase).toBe("ocupado");
    await m.store.responderOcupadoMerge(true);
    expect(m.api.pedirMerge).toHaveBeenLastCalledWith({ workspace_id: WS, sessao_foco: "sessao_foco", cli: "claude", modo_painel: "novo" });
    expect(m.store.obter().atualizar).toBeNull();
  });
  it("pedido de merge que falha: volta a 'divergiu' com o motivo", async () => {
    const m = montar();
    await m.store.abrirAtualizar();
    m.api.pedirMerge.mockResolvedValueOnce({ estado: "falhou", motivo: "Nenhuma CLI de IA instalada.", pane_id: null, sessao_id: null, entrega: null, instrucao_rel: null });
    await m.store.pedirMerge(null);
    expect(m.store.obter().atualizar).toMatchObject({ fase: "divergiu", erro: "Nenhuma CLI de IA instalada." });
  });
  it("trocar de workspace fecha tudo", async () => {
    const m = montar();
    await m.store.abrirAtualizar();
    m.store.definirWorkspace("ws_BBBBBBBBBBBB");
    expect(m.store.obter()).toMatchObject({ atualizar: null, atualizando: false });
  });
});

describe("pastas da suíte: ignorar neste computador (D-692)", () => {
  it("chama o main, avisa, atualiza resumo e fatos e refaz o preparo do diálogo aberto (a seção some)", async () => {
    const m = montar({ preparo: preparo({ suite: { itens: 3, caminhos: [".expx/"], incluiveis: 2 } }) });
    await m.store.abrir("commit_push");
    m.api.prepararCommitPush.mockResolvedValueOnce(preparo({ suite: { itens: 0, caminhos: [], incluiveis: 0 } }));
    expect(await m.store.ignorarSuite()).toBe(true);
    expect(m.api.ignorarSuite).toHaveBeenCalledWith(WS);
    expect(m.avisos).toEqual([{ texto: "Ignorei 3 pastas da suíte neste computador", tom: "sucesso" }]);
    expect(m.resumos).toEqual([WS]);
    expect(m.store.obter().dialogo?.preparo?.suite.itens).toBe(0);
  });
  it("erro do main vira aviso e retorna false", async () => {
    const m = montar();
    m.api.ignorarSuite.mockRejectedValueOnce(new Error("[vcs-erro] Esta pasta não é um repositório git."));
    expect(await m.store.ignorarSuite()).toBe(false);
    expect(m.avisos).toEqual([{ texto: "Esta pasta não é um repositório git.", tom: "erro" }]);
  });
});
