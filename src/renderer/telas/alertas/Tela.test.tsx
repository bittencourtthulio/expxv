// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatar, varrer } from "../../a11y/varredura";
import { criarStoreAlertas } from "../../estado/alertas";
import { TelaAlertas } from "./index";
import { Lista } from "./Lista";
import { alertaFalso, apiAlertasFalsa, canalFalso, CATALOGO_FALSO, estadoTelegramFalso } from "./fabrica-teste";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const esperar = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const digitar = (el: HTMLElement, valor: string) => act(async () => { fireEvent.change(el, { target: { value: valor } }); });
const confere = (onde: string) => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };
const TOKEN = "123456789:AAEhBOweik6ad9r_QXMENQjcrTu1jibl3cs";
const cons = { versao_texto: "tg-1", aceito_em: "2026-10-01T10:00:00Z", host: "api.telegram.org" };

async function montar(api = apiAlertasFalsa(), aba: "alertas" | "regras" | "canais" | "modelos" | "auditoria" = "alertas") {
  await act(async () => { render(<TelaAlertas api={api} abaInicial={aba} />); });
  await esperar();
  return api;
}

describe("tela Alertas: casca e lista", () => {
  it("sub-navegação lateral com as 5 seções; painel acessível", async () => {
    await montar(apiAlertasFalsa({ alertas: [alertaFalso("a1")] }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Alertas", "Regras", "Canais", "Modelos", "Auditoria"]);
    expect(screen.getByRole("tablist", { name: "Seções dos alertas" }).getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    confere("lista");
  });
  it("sem API: estado indisponível por texto", async () => {
    await act(async () => { render(<TelaAlertas api={undefined} />); });
    expect(screen.getByText("Alertas indisponíveis")).toBeTruthy();
  });
  it("estado vazio explica o que fazer", async () => {
    await montar();
    expect(screen.getByText("Nada por aqui")).toBeTruthy();
    expect(screen.getByText(/Crie regras na aba Regras/)).toBeTruthy();
  });
  it("erro de leitura aparece com 'Tentar de novo'", async () => {
    const api = await montar(apiAlertasFalsa({ listarErro: true }));
    expect(screen.getByRole("alert").textContent).toMatch(/falha de leitura/);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect((api.listar as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
  it("carregando mostra aria-busy antes da resposta", async () => {
    const api = apiAlertasFalsa();
    api.listar = vi.fn(() => new Promise(() => undefined)) as never;
    await act(async () => { render(<Lista api={api} catalogo={CATALOGO_FALSO} workspaces={[]} />); });
    expect(screen.getByText("Lendo alertas…")).toBeTruthy();
  });
  it("virtualiza: 1 000 alertas ficam em até 80 linhas no DOM", async () => {
    const muitos = Array.from({ length: 1000 }, (_, i) => alertaFalso(`a${String(i).padStart(4, "0")}`));
    await montar(apiAlertasFalsa({ alertas: muitos }));
    // linha do padrão único de listas (D-694): a classe da linha é a do ItemLista
    const linhas = document.querySelectorAll(".lst-linha").length;
    expect(linhas).toBeGreaterThan(0);
    expect(linhas).toBeLessThanOrEqual(80);
    expect(screen.getByRole("button", { name: "Carregar mais" })).toBeTruthy();
  });
  it("marcar como lido por linha e em lote; silenciar tipo/entidade; abrir navega pelo destino", async () => {
    const api = apiAlertasFalsa({ alertas: [alertaFalso("a1"), alertaFalso("a2")] });
    const navegar = vi.fn();
    await act(async () => { render(<Lista api={api} catalogo={CATALOGO_FALSO} workspaces={[{ id: "w1", nome: "App" }]} aoNavegar={navegar} agora={() => Date.parse("2026-10-01T10:05:00Z")} />); });
    await esperar();
    await clicar(screen.getByRole("button", { name: "Marcar como lido: Alerta a1" }));
    expect(api.marcarLido).toHaveBeenCalledWith(["a1"]);
    await clicar(screen.getByLabelText("Selecionar Alerta a2"));
    await clicar(screen.getByRole("button", { name: "Marcar selecionados como lidos" }));
    expect(api.marcarLido).toHaveBeenCalledWith(["a2"]);
  });
  it("silenciar e abrir (alertas ainda na lista)", async () => {
    const api = apiAlertasFalsa({ alertas: [alertaFalso("a1")] });
    const navegar = vi.fn();
    await act(async () => { render(<Lista api={api} catalogo={CATALOGO_FALSO} workspaces={[]} aoNavegar={navegar} agora={() => Date.parse("2026-10-01T10:05:00Z")} />); });
    await esperar();
    await digitar(screen.getByLabelText("Silenciar: Alerta a1"), "tipo:8");
    expect(api.silenciar).toHaveBeenCalledWith({ tipo: "tarefa_concluida" }, "2026-10-01T18:05:00.000Z");
    await digitar(screen.getByLabelText("Silenciar: Alerta a1"), "entidade:1");
    expect(api.silenciar).toHaveBeenCalledWith({ entidade_tipo: "task", entidade_id: "T-1" }, "2026-10-01T11:05:00.000Z");
    await clicar(screen.getByRole("button", { name: "Abrir: Alerta a1" }));
    expect(navegar).toHaveBeenCalledWith("metodo");
  });
  it("marcar todos usa o filtro atual e a busca tem debounce", async () => {
    const api = apiAlertasFalsa({ alertas: [alertaFalso("a1")] });
    await montar(api);
    await clicar(screen.getByRole("button", { name: "Marcar todos como lidos" }));
    expect(api.marcarTodosLidos).toHaveBeenCalledWith({ estado: "nao_lidos" });
    const antes = (api.listar as ReturnType<typeof vi.fn>).mock.calls.length;
    await digitar(screen.getByLabelText("Buscar no título"), "login");
    expect((api.listar as ReturnType<typeof vi.fn>).mock.calls.length).toBe(antes);
    await esperar(320);
    expect((api.listar as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toMatchObject({ busca: "login" });
  });
  it("cartão de plano pendente no desktop: aprovar e cancelar com args_hash", async () => {
    const api = apiAlertasFalsa();
    const store = criarStoreAlertas({ api: () => api, ocioso: () => undefined });
    store.iniciar();
    await act(async () => { render(<Lista api={api} catalogo={CATALOGO_FALSO} workspaces={[]} store={store} agora={() => Date.parse("2026-10-01T10:00:00Z")} />); });
    await act(async () => { (api.emitir["plano"] as (x: unknown) => void)({ plano_id: "pl1", resumo: "Corrigir bug do login", args_hash: "h1", expira_em: "2026-10-01T10:08:00Z" }); await new Promise((r) => setTimeout(r, 5)); });
    expect(screen.getByText("Corrigir bug do login")).toBeTruthy();
    expect(screen.getByText("expira em 8 min")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Aprovar" }));
    expect(api.telegram.planoDecidirDesktop).toHaveBeenCalledWith({ plano_id: "pl1", args_hash: "h1", decisao: "aprovar" });
    await waitFor(() => expect(screen.queryByText("Corrigir bug do login")).toBeNull());
  });
});

describe("regras, modelos e auditoria", () => {
  it("preset do Telegram sem canal avisa; com canal chama a API", async () => {
    const api = await montar(apiAlertasFalsa({ canais: [canalFalso({ id: "c-so", tipo: "so", nome: "Sistema", estado: "ativo" })] }), "regras");
    await clicar(screen.getByRole("button", { name: "Só atrasadas e erros no Telegram" }));
    expect(screen.getByText(/Configure o Telegram na aba Canais/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Tudo no app" }));
    expect(api.regraPreset).toHaveBeenCalledWith("tudo_no_app", "c-so");
  });
  it("editor de regra em diálogo: valida, avisa do curinga e grava", async () => {
    const api = await montar(apiAlertasFalsa(), "regras");
    expect(screen.getByText("Nenhuma regra ainda")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Nova regra" }));
    const dlg = screen.getByRole("dialog");
    confere("editor de regra");
    await clicar(within(dlg).getByRole("button", { name: "Salvar regra" }));
    expect(within(dlg).getByText("Dê um nome à regra.")).toBeTruthy();
    await digitar(within(dlg).getByLabelText("Nome"), "Minha regra");
    await digitar(within(dlg).getByLabelText("Canal"), "c-tg");
    await clicar(within(dlg).getByLabelText("Todos os tipos (curinga)"));
    expect(within(dlg).getByText(/Mensagens de agentes nunca vão a canal externo/)).toBeTruthy();
    expect(within(dlg).getByText(/PR aberto \(sem fonte ainda\)/)).toBeTruthy();
    await clicar(within(dlg).getByRole("button", { name: "Salvar regra" }));
    expect(api.regraGravar).toHaveBeenCalledWith(expect.objectContaining({ nome: "Minha regra", canal_id: "c-tg", tipos: ["*"] }));
  });
  it("silêncio global: silenciar tudo por 1 h grava com data futura", async () => {
    const api = await montar(apiAlertasFalsa(), "regras");
    await clicar(screen.getByRole("button", { name: "Silenciar tudo por 1 h" }));
    const arg = (api.silencioGravar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { temporario_ate: string };
    expect(Date.parse(arg.temporario_ate)).toBeGreaterThan(Date.now());
  });
  it("apagar regra pede confirmação própria (sem window.confirm)", async () => {
    const regra = { id: "r1", nome: "R1", ativa: true, tipos: ["tarefa_atrasada" as const], canal_id: "c-tg", filtros: {}, silencio: {}, agrupamento: { modo: "imediato" as const }, nivel: "minimo" as const, efemera_ate: null, origem: "usuario" as const };
    const conf = vi.spyOn(window, "confirm");
    const api = await montar(apiAlertasFalsa({ regras: [regra] }), "regras");
    await clicar(screen.getByRole("button", { name: "Apagar a regra R1" }));
    await clicar(within(screen.getByRole("dialog")).getByRole("button", { name: "Apagar" }));
    expect(api.regraApagar).toHaveBeenCalledWith("r1");
    expect(conf).not.toHaveBeenCalled();
  });
  it("modelos: prévia ao vivo, erro de validação e contador", async () => {
    const api = await montar(apiAlertasFalsa(), "modelos");
    await clicar(screen.getByRole("button", { name: /Tarefa concluída · Telegram · Mínimo/ }));
    await esperar(250);
    expect(screen.getByLabelText("Prévia").textContent).toContain("Corrigir login");
    expect(screen.getByText(/caracteres/)).toBeTruthy();
    await digitar(screen.getByLabelText("Corpo do modelo"), "{{xx}}");
    await esperar(250);
    expect(screen.getAllByRole("alert")[0]?.textContent).toMatch(/Campo desconhecido/);
    expect((screen.getByRole("button", { name: "Salvar modelo" }) as HTMLButtonElement).disabled).toBe(true);
    await digitar(screen.getByLabelText("Corpo do modelo"), "{{titulo}} ok");
    await esperar(250);
    await clicar(screen.getByRole("button", { name: "Salvar modelo" }));
    expect(api.modeloGravar).toHaveBeenCalled();
    await clicar(screen.getByRole("button", { name: "Restaurar padrão" }));
    expect(api.modeloRestaurar).toHaveBeenCalled();
  });
  it("auditoria: vazio e exportar CSV", async () => {
    const api = await montar(apiAlertasFalsa(), "auditoria");
    expect(screen.getByText("Sem registros")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(api.telegram.auditoriaExportar).toHaveBeenCalled();
    expect(screen.getByText("Arquivo CSV salvo.")).toBeTruthy();
  });
});

describe("canais e assistente do Telegram", () => {
  it("canal SO: liga/desliga e envia teste", async () => {
    const api = await montar(apiAlertasFalsa(), "canais");
    await clicar(screen.getByRole("button", { name: "Desligar" }));
    expect(api.canais.desligarSaida).toHaveBeenCalledWith("c-so");
    await clicar(screen.getByRole("button", { name: "Ligar" }));
    await clicar(screen.getByRole("button", { name: "Enviar teste" }));
    expect(api.canais.testeEnvio).toHaveBeenCalledWith("c-so");
    confere("canais");
  });
  it("começa no passo 1 sem token e tem Parar tudo; token em campo password sem autocomplete", async () => {
    await montar(apiAlertasFalsa(), "canais");
    expect(screen.getByText("Procure @BotFather.")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Já criei o bot, continuar" }));
    const campo = screen.getByLabelText("Token do bot") as HTMLInputElement;
    expect(campo.type).toBe("password");
    expect(campo.getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByRole("button", { name: "Parar tudo" })).toBeTruthy();
    confere("assistente passo 2");
  });
  it("token inválido: erro por texto, campo limpo, nada de token no DOM", async () => {
    const api = apiAlertasFalsa();
    (api.telegram.tokenTestar as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, erro: "nao_autorizado" });
    await montar(api, "canais");
    await clicar(screen.getByRole("button", { name: "Já criei o bot, continuar" }));
    await digitar(screen.getByLabelText("Token do bot"), TOKEN);
    await clicar(screen.getByRole("button", { name: "Testar" }));
    expect(screen.getAllByRole("alert").some((a) => /recusou este token/.test(a.textContent ?? ""))).toBe(true);
    expect((screen.getByLabelText("Token do bot") as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
  it("token ok: testa, mostra o bot, salva e mostra só o mascarado", async () => {
    const api = await montar(apiAlertasFalsa(), "canais");
    await clicar(screen.getByRole("button", { name: "Já criei o bot, continuar" }));
    await digitar(screen.getByLabelText("Token do bot"), TOKEN);
    await clicar(screen.getByRole("button", { name: "Testar" }));
    expect(screen.getByText(/Bot encontrado: @meu_bot/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Salvar token" }));
    expect(api.telegram.tokenSalvar).toHaveBeenCalledWith(TOKEN);
    await esperar();
    expect(screen.getByText("1234…:AA…xyz")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
  it("webhook ativo oferece Limpar webhook", async () => {
    const api = apiAlertasFalsa();
    (api.telegram.tokenTestar as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, erro: "webhook_ativo" });
    await montar(api, "canais");
    await clicar(screen.getByRole("button", { name: "Já criei o bot, continuar" }));
    await digitar(screen.getByLabelText("Token do bot"), TOKEN);
    await clicar(screen.getByRole("button", { name: "Testar" }));
    await clicar(screen.getByRole("button", { name: "Limpar webhook" }));
    expect(api.telegram.webhookLimpar).toHaveBeenCalled();
  });
  it("cofre indisponível mostra a instrução e nunca guarda em arquivo", async () => {
    await montar(apiAlertasFalsa({ telegram: estadoTelegramFalso({ cofre_disponivel: false }) }), "canais");
    await clicar(screen.getByRole("button", { name: "Já criei o bot, continuar" }));
    expect(screen.getByText(/cofre do sistema não está disponível/)).toBeTruthy();
  });
  it("consentimento: mostra o texto e grava com versão e hash", async () => {
    const api = await montar(apiAlertasFalsa({ telegram: estadoTelegramFalso({ token_mascarado: "1234…:AA…xyz" }) }), "canais");
    expect(screen.getByLabelText("Texto do consentimento").textContent).toMatch(/api\.telegram\.org/);
    expect(screen.getByText("Tarefa concluída")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Aceitar e continuar" }));
    expect(api.canais.consentir).toHaveBeenCalledWith("c-tg", "tg-1", "h");
  });
  it("pareamento: mostra o código uma vez com contagem e cancela", async () => {
    const api = await montar(apiAlertasFalsa({ telegram: estadoTelegramFalso({ token_mascarado: "1234…:AA…xyz", canal: canalFalso({ consentimento: cons }) }) }), "canais");
    await clicar(screen.getByRole("button", { name: "Gerar código de pareamento" }));
    expect(screen.getByText("ABCDE-23456", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/Expira em [45]:\d\d/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Cancelar pareamento" }));
    expect(api.telegram.parearCancelar).toHaveBeenCalled();
    expect(screen.queryByText("ABCDE-23456")).toBeNull();
  });
  const autorizado = { id: "a1", canal_id: "c-tg", nome_exibicao: "Ana", modo_padrao: "aprovar" as const, texto_livre: true, com_pin: false, criado_em: "2026-10-01T10:00:00Z", ultimo_uso_em: "2026-10-01T10:00:00Z", expira_em: "2026-10-31T10:00:00Z", revogado_em: null, workspaces: [] };
  const estadoCompleto = () => estadoTelegramFalso({ token_mascarado: "1234…:AA…xyz", canal: canalFalso({ consentimento: cons }), autorizados: [autorizado] });
  it("passo 5 com workspaces: nenhum liberado por padrão; direto pede confirmação; salva", async () => {
    const api = apiAlertasFalsa({ telegram: estadoCompleto() });
    const { TelegramAssistente } = await import("./TelegramAssistente");
    await act(async () => { render(<TelegramAssistente api={api} workspaces={[{ id: "w1", nome: "App Web" }]} />); });
    await esperar();
    const sel = screen.getByLabelText("Modo em App Web") as HTMLSelectElement;
    expect(sel.value).toBe("nenhum");
    await digitar(sel, "direto");
    expect(screen.getByRole("group", { name: "Confirmação do modo direto" })).toBeTruthy();
    expect(screen.getByText(/nunca a branch padrão ou protegida/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Salvar permissões" }));
    expect(api.telegram.autorizadoConfig).not.toHaveBeenCalled();
    expect(screen.getByText(/Digite DIRETO/, { selector: "p" })).toBeTruthy();
    await digitar(screen.getByLabelText(/Digite DIRETO para confirmar/), "DIRETO");
    await clicar(screen.getByRole("button", { name: "Salvar permissões" }));
    expect(api.telegram.autorizadoConfig).toHaveBeenCalledWith({ id: "a1", patch: { workspaces: [{ workspace_id: "w1", modo: "direto", padrao: true }], texto_livre: true }, confirmacao: "DIRETO" });
  });
  it("passo 5: PIN nunca aparece depois de enviado; ligar pedidos e alertas; menu e teste", async () => {
    const api = apiAlertasFalsa({ telegram: estadoCompleto() });
    const { TelegramAssistente } = await import("./TelegramAssistente");
    await act(async () => { render(<TelegramAssistente api={api} workspaces={[{ id: "w1", nome: "App Web" }]} />); });
    await esperar();
    await digitar(screen.getByLabelText(/Novo PIN/), "1234");
    await clicar(screen.getByRole("button", { name: "Definir PIN" }));
    expect(api.telegram.autorizadoConfig).toHaveBeenCalledWith({ id: "a1", patch: { pin: "1234" } });
    expect((screen.getByLabelText(/Novo PIN/) as HTMLInputElement).value).toBe("");
    await clicar(screen.getByRole("button", { name: "Ligar pedidos" }));
    expect(api.telegram.entradaLigar).toHaveBeenCalledWith(true);
    await clicar(screen.getByRole("button", { name: "Ligar alertas" }));
    expect(api.canais.ligarSaida).toHaveBeenCalledWith("c-tg");
    await clicar(screen.getByRole("button", { name: "Atualizar menu de comandos do bot" }));
    expect(api.telegram.comandosConfigurar).toHaveBeenCalled();
  });
  it("entrada recusada pelo main mostra a causa em texto", async () => {
    const api = apiAlertasFalsa({ telegram: estadoCompleto() });
    (api.telegram.entradaLigar as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, erro: "sem_workspace_liberado", estado: estadoCompleto() });
    const { TelegramAssistente } = await import("./TelegramAssistente");
    await act(async () => { render(<TelegramAssistente api={api} workspaces={[]} />); });
    await esperar();
    await clicar(screen.getByRole("button", { name: "Ligar pedidos" }));
    expect(screen.getByText(/Libere ao menos um workspace/)).toBeTruthy();
  });
  it("conflito do poller: alerta com texto e botão Retomar", async () => {
    const e = estadoCompleto();
    e.poller = { estado: "conflito", ultimo_poll_em: null, conflito: true };
    const api = apiAlertasFalsa({ telegram: e });
    const { TelegramAssistente } = await import("./TelegramAssistente");
    await act(async () => { render(<TelegramAssistente api={api} workspaces={[]} />); });
    await esperar();
    expect(screen.getAllByRole("alert").some((a) => /Outro programa está lendo este bot/.test(a.textContent ?? ""))).toBe(true);
    await clicar(screen.getByRole("button", { name: "Retomar" }));
    expect(api.telegram.retomar).toHaveBeenCalled();
  });
  it("revogar conta pede confirmação e chama a API", async () => {
    const api = apiAlertasFalsa({ telegram: estadoCompleto() });
    const { TelegramAssistente } = await import("./TelegramAssistente");
    await act(async () => { render(<TelegramAssistente api={api} workspaces={[]} />); });
    await esperar();
    await clicar(screen.getByRole("button", { name: "4. Parear (feito)" }));
    await clicar(screen.getByRole("button", { name: "Revogar Ana" }));
    await clicar(within(screen.getByRole("dialog")).getByRole("button", { name: "Revogar" }));
    expect(api.telegram.autorizadoRevogar).toHaveBeenCalledWith("a1");
  });
});

describe("cartão da Início", () => {
  it("mostra até 3 não lidos graves e some sem canal", async () => {
    const { CartaoAlertasInicio, maisGraves } = await import("./CartaoAlertasInicio");
    const lista = [alertaFalso("a", { severidade: "critico" }), alertaFalso("b", { severidade: "sucesso" }), alertaFalso("c", { severidade: "aviso" }), alertaFalso("d", { severidade: "aviso", lido_em: "2026-10-01T10:00:00Z" }), alertaFalso("e", { severidade: "aviso" }), alertaFalso("f", { severidade: "aviso" })];
    expect(maisGraves(lista).map((a) => a.id)).toEqual(["a", "c", "e"]);
    const api = apiAlertasFalsa({ alertas: lista });
    const store = criarStoreAlertas({ api: () => api, ocioso: () => undefined });
    await act(async () => { render(<CartaoAlertasInicio store={store} />); });
    await esperar();
    expect(screen.getByRole("region", { name: "Alertas" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    cleanup();
    const vazio = criarStoreAlertas({ api: () => undefined });
    const { container } = render(<CartaoAlertasInicio store={vazio} />);
    await esperar();
    expect(container.textContent).toBe("");
  });
});
