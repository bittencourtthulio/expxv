// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoLojaMcp } from "../../../compartilhado/loja-mcp";
import { formatar, varrer } from "../../a11y/varredura";
import { criarStoreLojaMcp } from "../../estado/loja-mcp";
import { criarStoreMissoes } from "../../estado/missoes";
import { criarStoreWorkspaces } from "../../estado/workspaces";
import { TelaLojaMcp } from "./index";
import { cartao, CARTOES_PADRAO, detalhe, DIAGNOSTICO_OK, HASH, HASH_KIT, instalado, lojaMcpFalsa, plano, type OpcoesApiFalsa } from "./fabrica-teste";

afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* sem storage */ } });

const WS = { id: "w1", nome: "w1", raiz: "/p/w1", e_git: true, acesso_externo: "leitura", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" } as const;

async function montar(o: OpcoesApiFalsa = {}, ajustar?: (api: ReturnType<typeof lojaMcpFalsa>) => void, comWs = true) {
  const api = lojaMcpFalsa(o);
  let emitir: (e: EventoLojaMcp) => void = () => undefined;
  api.assinar = (cb) => { emitir = cb; return () => undefined; };
  for (const k of Object.keys(api) as Array<keyof typeof api>) { if (k !== "assinar") (api as unknown as Record<string, unknown>)[k] = vi.fn(api[k] as never); }
  ajustar?.(api);
  const store = criarStoreLojaMcp({ api: () => api, workspace: () => (comWs ? "w1" : null), atrasoMs: 5 });
  const apiW = { estado: vi.fn().mockResolvedValue({ atual: comWs ? WS : null, recentes: comWs ? [WS] : [] }), assinar: vi.fn(() => () => undefined), abrir: vi.fn(), definirAtual: vi.fn(), remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn() };
  const workspaces = criarStoreWorkspaces({ api: () => apiW });
  await workspaces.iniciar();
  const apiM = { listar: vi.fn().mockResolvedValue({ itens: [{ id: "mis_1", workspace_id: "w1", titulo: "Login", estado: "executando" }], proximo: null }), criar: vi.fn(), detalhe: vi.fn().mockResolvedValue(null), encerrar: vi.fn(), abortar: vi.fn(), portoes: vi.fn().mockResolvedValue(null), liberarPortao: vi.fn().mockResolvedValue(null), assinar: vi.fn(() => () => undefined) };
  const missoes = criarStoreMissoes({ api: () => apiM as never });
  await missoes.definirWorkspace(comWs ? "w1" : null);
  await act(async () => { render(<TelaLojaMcp store={store} workspaces={workspaces} missoes={missoes} api={api} />); });
  await act(async () => { await vi.waitFor(() => expect(api.listar).toHaveBeenCalled()); });
  await screen.findByRole("list", { name: "Servidores MCP" });
  return { api, store, emitir: (e: EventoLojaMcp) => act(async () => { emitir(e); }) };
}
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const esperar = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const confere = (onde: string) => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };
const botao = (nome: RegExp | string) => screen.getByRole("button", { name: nome });
const abrir = async (nome: string) => { await clicar(botao(new RegExp(`^${nome}: detalhes`))); await screen.findByRole("complementary", { name: new RegExp(`Detalhes de ${nome}`) }); };

describe("Loja de MCPs: lista, busca e filtros", () => {
  it("lista o catálogo com selos, risco máximo e um botão primário por estado", async () => {
    await montar();
    expect(screen.getByRole("list", { name: "Servidores MCP" })).toBeTruthy();
    expect(botao("Instalar: Context7")).toBeTruthy();
    expect(botao("Configurar: Sentry")).toBeTruthy();
    expect((botao("Não confirmado: Em duvida") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("executa código").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kit", { selector: ".lst-selo" }).length).toBe(2);
    expect(screen.getByText("plano grátis")).toBeTruthy();
  });

  it("contador, busca fuzzy sem IPC e estado 'nada encontrado' com limpar filtros", async () => {
    const { api } = await montar();
    expect(screen.getByText("6 de 6")).toBeTruthy();
    const chamadas = (api.listar as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { fireEvent.change(screen.getByLabelText("Buscar servidores MCP"), { target: { value: "playw" } }); });
    expect(screen.getByText("1 de 6")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Context7: detalhes/ })).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText("Buscar servidores MCP"), { target: { value: "zzzz" } }); });
    expect(screen.getByText("Nada encontrado")).toBeTruthy();
    await clicar(botao("Limpar filtros"));
    expect(screen.getByText("6 de 6")).toBeTruthy();
    expect((api.listar as ReturnType<typeof vi.fn>).mock.calls.length).toBe(chamadas);
  });

  it("filtros: instalável, instalado, grátis, Kit e categoria", async () => {
    await montar();
    await clicar(botao("Instalável"));
    expect(screen.queryByRole("button", { name: /^Em duvida: detalhes/ })).toBeNull();
    await clicar(botao("Instalável"));
    await clicar(botao("Instalado"));
    expect(screen.getByText("1 de 6")).toBeTruthy();
    await clicar(botao("Instalado"));
    await clicar(botao("Grátis"));
    expect(screen.queryByRole("button", { name: /^Servico Pago: detalhes/ })).toBeNull();
    await clicar(botao("Grátis"));
    await clicar(botao("Kit"));
    expect(screen.getByText("2 de 6")).toBeTruthy();
    await clicar(botao("Kit"));
    await act(async () => { fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "navegador_testes" } }); });
    expect(screen.getByText("1 de 6")).toBeTruthy();
  });

  it("virtualiza: 300 entradas não viram 300 nós de cartão (P-90)", async () => {
    const muitos = Array.from({ length: 300 }, (_v, i) => cartao(`srv-${i}`));
    await montar({ cartoes: muitos });
    expect(document.querySelectorAll(".lm-linha").length).toBeLessThan(60);
    expect(screen.getByText("300 de 300")).toBeTruthy();
  });

  it("catálogo vazio: estado vazio explica o próximo passo", async () => {
    const api = lojaMcpFalsa({ cartoes: [] });
    const store = criarStoreLojaMcp({ api: () => api, atrasoMs: 5 });
    await act(async () => { render(<TelaLojaMcp store={store} api={api} />); });
    await screen.findByText("Catálogo vazio");
  });

  it("erro de carga mostra 'Tentar de novo' que recarrega", async () => {
    const api = lojaMcpFalsa();
    const boa = api.listar;
    api.listar = vi.fn().mockRejectedValueOnce(new Error("falha")).mockImplementation(boa);
    const store = criarStoreLojaMcp({ api: () => api, atrasoMs: 5 });
    await act(async () => { render(<TelaLojaMcp store={store} api={api} />); });
    await screen.findByText(/falha/);
    await clicar(botao("Tentar de novo"));
    await screen.findByRole("list", { name: "Servidores MCP" });
  });

  it("carregando: mostra o estado ocupado enquanto a lista não chega", async () => {
    const api = lojaMcpFalsa();
    api.listar = vi.fn(() => new Promise<never>(() => undefined));
    const store = criarStoreLojaMcp({ api: () => api, atrasoMs: 5 });
    await act(async () => { render(<TelaLojaMcp store={store} api={api} />); });
    expect(screen.getByText("Carregando catálogo…").getAttribute("aria-busy")).toBe("true");
  });

  it("sem a API (fora do Electron): estado indisponível", async () => {
    await act(async () => { render(<TelaLojaMcp store={criarStoreLojaMcp({ api: () => undefined })} api={undefined} />); });
    expect(screen.getByText("Loja de MCPs indisponível")).toBeTruthy();
  });

  it("catálogo somente leitura: aviso e instalar/Kit desligados", async () => {
    await montar({ somenteLeitura: true });
    expect(screen.getAllByRole("alert").some((a) => /somente leitura/i.test(a.textContent ?? ""))).toBe(true);
    expect((botao("Instalar: Context7") as HTMLButtonElement).disabled).toBe(true);
    expect((botao("Kit de desenvolvimento") as HTMLButtonElement).disabled).toBe(true);
  });

  it("aviso de npm/uv ausentes via diagnóstico()", async () => {
    await montar({ diagnostico: { ...DIAGNOSTICO_OK, npm: { ok: false, versao: null }, uv: { ok: false, versao: null } }, cartoes: [cartao("a", { metodo: "npm" }), cartao("b", { metodo: "uvx" })] });
    await waitFor(() => expect(document.querySelector('[data-aviso="npm"]')).not.toBeNull());
    expect(document.querySelector('[data-aviso="uv"]')?.textContent).toMatch(/Instale o uv/);
  });

  it("teclado: ArrowDown/ArrowUp move o foco entre os cartões e o botão abre o painel", async () => {
    await montar();
    const a = botao(/^Context7: detalhes/);
    a.focus();
    await act(async () => { fireEvent.keyDown(a, { key: "ArrowDown" }); });
    await waitFor(() => expect(document.activeElement).toBe(botao(/^DeepWiki: detalhes/)));
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" }); });
    await waitFor(() => expect(document.activeElement).toBe(botao(/^Context7: detalhes/)));
  });

  it("andamento por evento: só o cartão do id mostra o progresso", async () => {
    const { emitir } = await montar();
    await emitir({ tipo: "progresso", instalacao_id: "inst_abc123", id: "context7", passo: 3, rotulo: "Baixando" });
    expect(screen.getByRole("status", { name: "Context7: Baixando" })).toBeTruthy();
    expect((botao("Instalando…: Context7") as HTMLButtonElement).disabled).toBe(true);
    expect(botao("Instalar: Playwright")).toBeTruthy();
  });
});

describe("Loja de MCPs: instalar com consentimento explícito", () => {
  it("mostra o comando EXATO e o hash; o botão só habilita com 'Entendi'; instalar reenvia o hash", async () => {
    const { api } = await montar();
    await clicar(botao("Instalar: Context7"));
    const d = await screen.findByRole("dialog", { name: "Instalar Servidor context7" });
    const p = plano("context7");
    expect(within(d).getByLabelText("Comando de instalação de Servidor context7").textContent).toBe(p.comando_instalacao.join("\n"));
    expect(within(d).getByLabelText("Comando de execução de Servidor context7").textContent).toBe(p.comando_exato);
    expect(within(d).getByLabelText("Hash de Servidor context7").textContent).toBe(HASH);
    expect(within(d).getByText(/registry\.npmjs\.org/)).toBeTruthy();
    confere("consentimento");
    const confirmar = within(d).getByRole("button", { name: "Instalar" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    await clicar(within(d).getByRole("checkbox"));
    expect(confirmar.disabled).toBe(false);
    await clicar(confirmar);
    await waitFor(() => expect(api.instalar).toHaveBeenCalledWith({ ids: ["context7"], consentimento: { aceito: true, comando_hashes: { context7: HASH } }, workspace_id: "w1" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status", { name: /Context7: Preparando/ })).toBeTruthy();
  });

  it("cancelar não instala; Esc fecha", async () => {
    const { api } = await montar();
    await clicar(botao("Instalar: Context7"));
    await screen.findByRole("dialog");
    await clicar(botao("Cancelar"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.instalar).not.toHaveBeenCalled();
  });

  it("scripts permitidos e avisos aparecem em destaque", async () => {
    await montar({}, (api) => { api.planoInstalacao = vi.fn(async (ids) => ({ planos: ids.map((id: string) => plano(id, { permissoes: { ...plano(id).permissoes, scripts_permitidos: true }, avisos: [{ codigo: "transitivas_nao_travadas", nivel: "atencao" as const, texto: "dependências transitivas não travadas" }] })), bloqueios: [] })); });
    await clicar(botao("Instalar: Context7"));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText(/Scripts de instalação permitidos/)).toBeTruthy();
    expect(within(d).getByText(/dependências transitivas não travadas/)).toBeTruthy();
  });

  it("plano com bloqueio: sem botão de instalar habilitado e motivo visível", async () => {
    await montar({}, (api) => { api.planoInstalacao = vi.fn(async () => ({ planos: [], bloqueios: [{ id: "context7", codigo: "prerequisito_ausente", motivo: "npm não encontrado", acao: "Instale o Node." }] })); });
    await clicar(botao("Instalar: Context7"));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText(/npm não encontrado/)).toBeTruthy();
    expect((within(d).getByRole("button", { name: "Instalar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("falha do instalar mostra erro nominal no diálogo (sem fechar)", async () => {
    await montar({}, (api) => { api.instalar = vi.fn().mockRejectedValue(new Error("O comando mudou")); });
    await clicar(botao("Instalar: Context7"));
    const d = await screen.findByRole("dialog");
    await clicar(within(d).getByRole("checkbox"));
    await clicar(within(d).getByRole("button", { name: "Instalar" }));
    await within(d).findByText("O comando mudou");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Kit de desenvolvimento: um consentimento do conjunto com o hash do conjunto", async () => {
    const { api } = await montar();
    await clicar(botao("Kit de desenvolvimento"));
    const d = await screen.findByRole("dialog", { name: "Kit de desenvolvimento" });
    expect(within(d).getByText(HASH_KIT)).toBeTruthy();
    expect(within(d).getAllByLabelText(/^Comando de instalação de/)).toHaveLength(2);
    await clicar(within(d).getByRole("checkbox"));
    await clicar(within(d).getByRole("button", { name: "Instalar o Kit" }));
    await waitFor(() => expect(api.kitInstalar).toHaveBeenCalledWith({ aceito: true, comando_hash: HASH_KIT }, "w1"));
  });

  it("Kit já instalado: aviso, sem diálogo", async () => {
    await montar({}, (api) => { api.kitPlano = vi.fn(async () => ({ planos: [], bloqueios: [], comando_hash: HASH_KIT })); });
    await clicar(botao("Kit de desenvolvimento"));
    await screen.findByText("O Kit de desenvolvimento já está instalado.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Loja de MCPs: painel, habilitação e saúde", () => {
  const instaladoOk = (id: string, extra = {}) => cartao(id, { nome: id === "ok" ? "Servidor ok" : id, instalado: instalado(), ...extra });

  it("painel mostra descrição, comando exato, permissões, fontes e 'não confirmado' sem botão de instalar", async () => {
    await montar();
    await abrir("Em duvida");
    const p = screen.getByRole("complementary", { name: /Detalhes de Em duvida/ });
    expect(within(p).getByText(/Não confirmado\./)).toBeTruthy();
    expect(within(p).queryByRole("button", { name: "Instalar" })).toBeNull();
    await clicar(within(p).getByRole("button", { name: "Fechar detalhes" }));
    await abrir("Playwright");
    const q = screen.getByRole("complementary", { name: /Detalhes de Playwright/ });
    await within(q).findByLabelText("Comando exato");
    expect(within(q).getByText(/api\.exemplo\.com/)).toBeTruthy();
    expect(within(q).getByRole("link", { name: "documentação" })).toBeTruthy();
    confere("painel");
  });

  it("habilitar por escopo: workspace, Missão e agente; selo de isolamento por CLI", async () => {
    const { api } = await montar({ cartoes: [instaladoOk("ok")] });
    await abrir("Servidor ok");
    const m = await screen.findByRole("region", { name: "Habilitado em" });
    expect(within(m).getByText(/Gemini: sem injeção por Pane/)).toBeTruthy();
    expect(within(m).getByText(/Claude Code: isolamento total/)).toBeTruthy();
    expect(within(m).getByText(/Codex: isolamento parcial/)).toBeTruthy();
    const grupo = within(m).getByRole("group", { name: "Nova habilitação" });
    await clicar(within(grupo).getByRole("button", { name: "Habilitar" }));
    await waitFor(() => expect(api.habilitar).toHaveBeenCalledWith("ok", "workspace", "w1", true));
    await act(async () => { fireEvent.change(within(grupo).getByLabelText("Escopo"), { target: { value: "missao" } }); });
    await act(async () => { fireEvent.change(within(grupo).getByLabelText("Missão"), { target: { value: "mis_1" } }); });
    await clicar(within(grupo).getByRole("button", { name: "Habilitar" }));
    await waitFor(() => expect(api.habilitar).toHaveBeenCalledWith("ok", "missao", "mis_1", true));
    await act(async () => { fireEvent.change(within(grupo).getByLabelText("Escopo"), { target: { value: "agente" } }); });
    const campo = within(grupo).getByLabelText("Agente");
    await act(async () => { fireEvent.change(campo, { target: { value: "../x" } }); });
    expect((within(grupo).getByRole("button", { name: "Habilitar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.change(campo, { target: { value: "squad.exec" } }); });
    await clicar(within(grupo).getByRole("button", { name: "Habilitar" }));
    await waitFor(() => expect(api.habilitar).toHaveBeenCalledWith("ok", "agente", "squad.exec", true));
  });

  it("habilitar sem configurar: mensagem nominal e atalho para Configurar", async () => {
    await montar({ cartoes: [instaladoOk("ok")] }, (api) => { api.habilitar = vi.fn(async () => ({ ok: false, codigo: "nao_configurado", detalhe: null })); });
    await abrir("Servidor ok");
    const m = await screen.findByRole("region", { name: "Habilitado em" });
    await clicar(within(m).getByRole("button", { name: "Habilitar" }));
    await within(m).findByText(/Faltam variáveis obrigatórias/);
    expect(within(m).getByRole("button", { name: "Configurar" })).toBeTruthy();
  });

  it("habilitação existente aparece e pode ser desabilitada", async () => {
    const hab = { id: "h1", servidor_id: "ok", alvo_tipo: "workspace" as const, alvo_valor: "w1", habilitado: true, atualizado_em: "x", isolamento: { claude: "duro", codex: "parcial", opencode: "parcial", gemini: "nenhum" } as const };
    const { api } = await montar({ cartoes: [instaladoOk("ok")], habilitacoes: [hab] });
    expect(botao("Gerenciar: Servidor ok")).toBeTruthy();
    expect(screen.getByText("habilitado", { selector: ".lst-selo" })).toBeTruthy();
    await abrir("Servidor ok");
    const m = await screen.findByRole("region", { name: "Habilitado em" });
    await clicar(await within(m).findByRole("button", { name: "Desabilitar" }));
    await waitFor(() => expect(api.habilitar).toHaveBeenCalledWith("ok", "workspace", "w1", false));
  });

  it("botão Habilitar do cartão habilita no workspace atual", async () => {
    const { api } = await montar({ cartoes: [instaladoOk("ok")] });
    await clicar(botao("Habilitar: Servidor ok"));
    await waitFor(() => expect(api.habilitar).toHaveBeenCalledWith("ok", "workspace", "w1", true));
  });

  it("testar: mostra ok com ferramentas e latência", async () => {
    const { api } = await montar({ cartoes: [instaladoOk("ok")] });
    await abrir("Servidor ok");
    const p = screen.getByRole("complementary", { name: /Detalhes de Servidor ok/ });
    await clicar(within(p).getByRole("button", { name: "Testar" }));
    await waitFor(() => expect(api.testar).toHaveBeenCalledWith("ok", "w1"));
    await screen.findByText(/ok · 3 ferramentas · 120 ms/);
  });

  it("remover pede confirmação, oferece apagar segredos e mostra resíduos", async () => {
    const { api } = await montar({ cartoes: [instaladoOk("ok")] });
    await abrir("Servidor ok");
    const p = screen.getByRole("complementary", { name: /Detalhes de Servidor ok/ });
    await clicar(within(p).getByRole("button", { name: "Remover" }));
    const d = await screen.findByRole("dialog", { name: "Remover Servidor ok?" });
    expect(api.desinstalar).not.toHaveBeenCalled();
    await clicar(within(d).getByRole("checkbox"));
    await clicar(within(d).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(api.desinstalar).toHaveBeenCalledWith("ok", true));
    await screen.findByText(/Resíduos: 0/);
  });

  it("remover recusado (em uso) mostra a mensagem e mantém o diálogo", async () => {
    await montar({ cartoes: [instaladoOk("ok")] }, (api) => { api.desinstalar = vi.fn(async () => ({ ok: false, codigo: "em_uso", residuos: [] })); });
    await abrir("Servidor ok");
    await clicar(within(screen.getByRole("complementary", { name: /Detalhes de Servidor ok/ })).getByRole("button", { name: "Remover" }));
    const d = await screen.findByRole("dialog");
    await clicar(within(d).getByRole("button", { name: "Remover" }));
    await within(d).findByText(/Servidor em uso/);
  });

  it("atualizar: mostra o diff e exige novo consentimento com o hash do diff", async () => {
    const diff = { disponivel: true, versao_de: "1.0.0", versao_para: "1.1.0", comando: { antes: "a --v1", depois: "a --v2" }, variaveis: { adicionadas: ["NOVA"], removidas: [] }, riscos: { adicionados: ["segredos"], removidos: [] }, comando_hash: "c".repeat(64) };
    const { api } = await montar({ cartoes: [instaladoOk("ok", { instalado: instalado({ atualizacao_disponivel: true }) })] }, (a) => { a.planoAtualizacao = vi.fn(async () => diff); });
    await clicar(botao("Atualizar: Servidor ok"));
    const d = await screen.findByRole("dialog", { name: "Atualizar Servidor ok" });
    expect(within(d).getByLabelText("Comando depois da atualização").textContent).toBe("a --v2");
    expect(within(d).getByText(/NOVA/)).toBeTruthy();
    const ok = within(d).getByRole("button", { name: "Atualizar" }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await clicar(within(d).getByRole("checkbox"));
    await clicar(ok);
    await waitFor(() => expect(api.atualizar).toHaveBeenCalledWith("ok", { aceito: true, comando_hash: "c".repeat(64) }, "w1"));
  });

  it("logs recolhíveis", async () => {
    await montar({ cartoes: [instaladoOk("ok")] }, (api) => { api.logs = vi.fn(async () => [{ em: "2026-10-01T00:00:00Z", nivel: "info" as const, evento: "instalado", detalhe: "ok" }]); });
    await abrir("Servidor ok");
    await clicar(screen.getByRole("button", { name: "Ver logs" }));
    const l = await screen.findByRole("list", { name: "Logs do servidor" });
    expect(within(l).getByText("instalado")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Ocultar logs" }));
    expect(screen.queryByRole("list", { name: "Logs do servidor" })).toBeNull();
  });
});

describe("Loja de MCPs: credenciais (campo mascarado, valor nunca persiste)", () => {
  const SEGREDO = "sk-teste-NAO-PERSISTIR-123";
  it("grava pelo canal sensível, limpa o campo ANTES da resposta e nunca deixa o valor no DOM nem no storage", async () => {
    let resolver: (v: { ok: boolean; codigo: string | null }) => void = () => undefined;
    const { api } = await montar({ cartoes: [cartao("sentry", { nome: "Sentry", instalado: instalado(), precisa_configurar: true, pede_chave: true })] }, (a) => {
      a.gravarVariavel = vi.fn(() => new Promise<{ ok: boolean; codigo: string | null }>((r) => { resolver = r; }));
    });
    await clicar(botao("Configurar: Sentry"));
    const d = await screen.findByRole("dialog", { name: "Configurar Sentry" });
    const campo = await within(d).findByLabelText("API_KEY") as HTMLInputElement;
    expect(campo.type).toBe("password");
    expect(campo.autocomplete).toBe("off");
    expect(within(d).getByRole("link", { name: "Onde conseguir" }).getAttribute("href")).toBe("https://exemplo.com/chaves");
    await act(async () => { fireEvent.change(campo, { target: { value: SEGREDO } }); });
    await clicar(within(d).getByRole("button", { name: "Salvar no cofre" }));
    expect(api.gravarVariavel).toHaveBeenCalledWith("sentry", "API_KEY", SEGREDO);
    expect(campo.value).toBe(""); // limpo antes mesmo da resposta
    expect(document.body.innerHTML.includes(SEGREDO)).toBe(false);
    await act(async () => { resolver({ ok: true, codigo: null }); });
    await within(d).findByText("Salvo no cofre.");
    expect(document.body.innerHTML.includes(SEGREDO)).toBe(false);
    expect(JSON.stringify({ ...localStorage })).not.toContain(SEGREDO);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(SEGREDO);
    confere("credenciais");
  });

  it("valor inválido é recusado localmente (sem IPC); cofre indisponível bloqueia salvar", async () => {
    const { api } = await montar({ cartoes: [cartao("sentry", { nome: "Sentry", instalado: instalado(), precisa_configurar: true })] });
    await clicar(botao("Configurar: Sentry"));
    const d = await screen.findByRole("dialog");
    const campo = await within(d).findByLabelText("API_KEY");
    await act(async () => { fireEvent.change(campo, { target: { value: "x".repeat(5000) } }); });
    await clicar(within(d).getByRole("button", { name: "Salvar no cofre" }));
    await within(d).findByText(/4 KB/);
    expect(api.gravarVariavel).not.toHaveBeenCalled();
  });

  it("cofre indisponível: campos desabilitados e explicação", async () => {
    await montar({ cartoes: [cartao("sentry", { nome: "Sentry", instalado: instalado(), precisa_configurar: true })], diagnostico: { ...DIAGNOSTICO_OK, cofre: { disponivel: false } } });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await clicar(botao("Configurar: Sentry"));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText(/Cofre indisponível/)).toBeTruthy();
    expect((await within(d).findByLabelText("API_KEY") as HTMLInputElement).disabled).toBe(true);
  });

  it("falha nominal do cofre no gravar aparece sem eco do valor", async () => {
    await montar({ cartoes: [cartao("sentry", { nome: "Sentry", instalado: instalado(), precisa_configurar: true })] }, (a) => { a.gravarVariavel = vi.fn(async () => ({ ok: false, codigo: "cofre_indisponivel" })); });
    await clicar(botao("Configurar: Sentry"));
    const d = await screen.findByRole("dialog");
    await act(async () => { fireEvent.change(await within(d).findByLabelText("API_KEY"), { target: { value: SEGREDO } }); });
    await clicar(within(d).getByRole("button", { name: "Salvar no cofre" }));
    await within(d).findByText(/cofre do sistema não está disponível/);
    expect(document.body.innerHTML.includes(SEGREDO)).toBe(false);
  });

  it("Testar mostra o resultado nominal (não autorizado) sem eco", async () => {
    await montar({ cartoes: [cartao("sentry", { nome: "Sentry", instalado: instalado(), precisa_configurar: true })] }, (a) => { a.testar = vi.fn(async () => ({ estado: "indisponivel" as const, n_ferramentas: 0, latencia_ms: 80, erro: "nao_autorizado", variaveis_faltando: [] })); });
    await clicar(botao("Configurar: Sentry"));
    const d = await screen.findByRole("dialog");
    await clicar(within(d).getByRole("button", { name: "Testar" }));
    await within(d).findByText(/recusou a credencial/);
  });
});

describe("Loja de MCPs: instalar na minha CLI (confirmação digitada)", () => {
  const abrirCli = async (api?: (a: ReturnType<typeof lojaMcpFalsa>) => void) => {
    const m = await montar({ cartoes: [cartao("ok", { nome: "Servidor ok", instalado: instalado() })] }, api);
    await abrir("Servidor ok");
    await clicar(within(screen.getByRole("complementary", { name: /Detalhes de Servidor ok/ })).getByRole("button", { name: "Instalar na minha CLI" }));
    const d = await screen.findByRole("dialog", { name: "Instalar Servidor ok na minha CLI" });
    return { ...m, d };
  };
  it("só instala depois da prévia e do nome digitado exato", async () => {
    const { api, d } = await abrirCli();
    const instalar = within(d).getByRole("button", { name: "Instalar na minha CLI" }) as HTMLButtonElement;
    expect(instalar.disabled).toBe(true);
    await clicar(within(d).getByRole("button", { name: "Ver prévia do comando" }));
    expect((await within(d).findByLabelText("Prévia do comando")).textContent).toMatch(/claude mcp add --scope user ev_ok/);
    expect(instalar.disabled).toBe(true);
    const campo = within(d).getByLabelText("Confirmação digitada");
    await act(async () => { fireEvent.change(campo, { target: { value: "ev_ok " } }); });
    expect(instalar.disabled).toBe(false);
    await act(async () => { fireEvent.change(campo, { target: { value: "ev_o" } }); });
    expect(instalar.disabled).toBe(true);
    await act(async () => { fireEvent.change(campo, { target: { value: "ev_ok" } }); });
    await clicar(instalar);
    await waitFor(() => expect(api.instalarNaCli).toHaveBeenCalledWith("ok", "claude", "ev_ok", "w1"));
    await within(d).findByText(/Instalado na sua CLI/);
  });
  it("prévia recusada (CLI sem suporte) mostra o motivo", async () => {
    const { d } = await abrirCli((a) => { a.previaCliUsuario = vi.fn(async () => ({ ok: false as const, codigo: "cli_sem_suporte", motivo: "" })); });
    await clicar(within(d).getByRole("button", { name: "Ver prévia do comando" }));
    await within(d).findByText(/não permite instalar servidor por comando/);
  });
  it("já instalado na CLI: oferece remover só do que o app criou", async () => {
    const { api } = await montar({ cartoes: [cartao("ok", { nome: "Servidor ok", instalado: instalado() })] }, (a) => { a.detalhe = vi.fn(async (id: string) => detalhe(cartao(id, { nome: "Servidor ok", instalado: instalado() }), { clis: [{ cli: "claude", nome_na_cli: "ev_ok" }] })); });
    await abrir("Servidor ok");
    await waitFor(() => expect(api.detalhe).toHaveBeenCalled());
    await clicar(within(screen.getByRole("complementary", { name: /Detalhes de Servidor ok/ })).getByRole("button", { name: "Instalar na minha CLI" }));
    const d = await screen.findByRole("dialog");
    await clicar(within(d).getByRole("button", { name: /Remover da Claude Code/ }));
    await waitFor(() => expect(api.removerDaCli).toHaveBeenCalledWith("ok", "claude"));
  });
});

describe("Loja de MCPs: paleta, a11y e preferências do renderer", () => {
  it("nenhum diálogo nativo e nada de segredo/estado em localStorage", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    await montar();
    await clicar(botao("Instalar: Context7"));
    await screen.findByRole("dialog");
    expect(confirmar).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("varredura de acessibilidade: lista, painel e diálogos", async () => {
    await montar();
    confere("Loja: lista");
    await abrir("Playwright");
    await screen.findByLabelText("Comando exato");
    confere("Loja: painel");
    await clicar(botao("Kit de desenvolvimento"));
    await screen.findByRole("dialog");
    confere("Loja: Kit");
  });

  it("o comando de paleta 'Loja de MCPs: instalar o Kit' abre o consentimento do Kit", async () => {
    const { pedirLojaMcp } = await import("../../estado/loja-mcp-acoes");
    await montar();
    await act(async () => { pedirLojaMcp("kit"); });
    await screen.findByRole("dialog", { name: "Kit de desenvolvimento" });
  });
});

describe("Loja de MCPs: descobrir no Registro Oficial (só por clique)", () => {
  const cand = { nome: "io.github.acme/docs", descricao: "Servidor de documentação de exemplo", versao: "1.0.0", repositorio: "https://github.com/acme/docs", namespace_verificado: true, transportes: ["stdio"], curado: false as const, instalavel: false as const };
  it("abrir a Loja não consulta; buscar chama UMA vez; resultado é 'não curado', sem botão de instalar, e 'Sugerir' copia só um rascunho confirmado:false", async () => {
    const escrito: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { escrito.push(t); } } });
    const { api } = await montar({}, (a) => { a.descobrir = vi.fn(async () => ({ candidatos: [cand], descartados: 2, aviso: "Resultados não curados." })); });
    expect(api.descobrir).not.toHaveBeenCalled();
    await clicar(botao("Descobrir"));
    const d = await screen.findByRole("dialog", { name: "Descobrir no Registro Oficial" });
    const buscar = within(d).getByRole("button", { name: "Buscar" }) as HTMLButtonElement;
    expect(buscar.disabled).toBe(true);
    await act(async () => { fireEvent.change(within(d).getByLabelText("Buscar"), { target: { value: "docs" } }); });
    await clicar(buscar);
    await waitFor(() => expect(api.descobrir).toHaveBeenCalledTimes(1));
    expect(api.descobrir).toHaveBeenCalledWith("docs");
    const lista = await within(d).findByRole("list", { name: "Resultados do Registro Oficial" });
    expect(within(lista).getByText("não curado")).toBeTruthy();
    expect(within(lista).getByText("namespace verificado")).toBeTruthy();
    expect(within(lista).queryByRole("button", { name: /Instalar/ })).toBeNull();
    await clicar(within(lista).getByRole("button", { name: "Sugerir ao catálogo" }));
    await within(lista).findByRole("button", { name: "Rascunho copiado" });
    const rascunho = JSON.parse(escrito[0]!) as { confirmado: boolean; comando: unknown; instalacao: { versao: unknown; integridade: unknown } };
    expect(rascunho).toMatchObject({ confirmado: false, comando: null, instalacao: { versao: null, integridade: null } });
    confere("Loja: descobrir");
  });
  it("erro nominal aparece no diálogo e o catálogo segue navegável", async () => {
    await montar({}, (a) => { a.descobrir = vi.fn().mockRejectedValue(new Error("Sem rede para consultar o Registro Oficial.")); });
    await clicar(botao("Descobrir"));
    const d = await screen.findByRole("dialog");
    await act(async () => { fireEvent.change(within(d).getByLabelText("Buscar"), { target: { value: "docs" } }); });
    await clicar(within(d).getByRole("button", { name: "Buscar" }));
    await within(d).findByText("Sem rede para consultar o Registro Oficial.");
    await clicar(within(d).getByRole("button", { name: "Fechar" }));
    expect(botao("Instalar: Context7")).toBeTruthy();
  });
});

void CARTOES_PADRAO;
