// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatar, varrer } from "../../a11y/varredura";
import { TelaJarvis } from "./index";
import { apiRelayFalsa, apiJarvisFalsa, apiRemotoFalsa, confirmacaoFalsa, dispositivoFalso, estadoJarvisFalso, estadoRemotoFalso, respostaFalsa } from "./fabrica-teste";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const esperar = (ms = 15) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const digitar = (el: HTMLElement, valor: string) => act(async () => { fireEvent.change(el, { target: { value: valor } }); });
const confere = (onde: string) => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };

async function montar(o: { jarvis?: ReturnType<typeof apiJarvisFalsa>; remoto?: ReturnType<typeof apiRemotoFalsa>; aba?: "conversa" | "remoto" | "relay" | "auditoria" } = {}) {
  const jarvis = o.jarvis ?? apiJarvisFalsa();
  const remoto = o.remoto ?? apiRemotoFalsa();
  await act(async () => { render(<TelaJarvis jarvis={jarvis} remoto={remoto} abaInicial={o.aba ?? "conversa"} />); });
  await esperar();
  return { jarvis, remoto };
}

describe("tela Jarvis: casca", () => {
  it("uma linha de controles, quatro abas e painel acessível", async () => {
    await montar();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Conversa", "Controle remoto", "Relay (experimental)", "Auditoria"]);
    expect(screen.getAllByRole("toolbar").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    confere("conversa");
  });
  it("sem API (fora do app): estado indisponível por texto", async () => {
    await act(async () => { render(<TelaJarvis jarvis={undefined} remoto={undefined} />); });
    expect(screen.getByText("Jarvis indisponível")).toBeTruthy();
  });
  it("navega entre as abas pelo teclado (setas)", async () => {
    await montar();
    const aba = screen.getByRole("tab", { name: "Conversa" });
    await act(async () => { aba.focus(); fireEvent.keyDown(aba, { key: "ArrowRight" }); });
    await esperar();
    expect(screen.getByRole("tab", { name: "Controle remoto", selected: true })).toBeTruthy();
  });
});

describe("tela Jarvis: aba Relay", () => {
  it("abre o chunk lazy da aba e mostra o relay desligado; sem API da aba mostra indisponível", async () => {
    await act(async () => { render(<TelaJarvis jarvis={apiJarvisFalsa()} remoto={apiRemotoFalsa()} relay={apiRelayFalsa()} abaInicial="relay" />); });
    await esperar(60);
    expect(screen.getByRole("button", { name: "Ligar relay" })).toBeTruthy();
    cleanup();
    await act(async () => { render(<TelaJarvis jarvis={apiJarvisFalsa()} remoto={apiRemotoFalsa()} relay={undefined} abaInicial="relay" />); });
    await esperar(60);
    expect(screen.getByText("Relay indisponível")).toBeTruthy();
  });
});

describe("tela Jarvis: conversa", () => {
  it("desligado: explica e bloqueia entrada; ligar chama configGravar", async () => {
    const jarvis = apiJarvisFalsa({ estado: estadoJarvisFalso({ config: { ligado: false, llm_ligado: false, llm_consentimento: false, confirmacao_ttl_s: 30 } }) });
    await montar({ jarvis });
    expect(screen.getByText(/está desligado/)).toBeTruthy();
    expect((screen.getByLabelText("Pedido") as HTMLInputElement).disabled).toBe(true);
    await clicar(screen.getByRole("checkbox", { name: /Jarvis desligado/ }));
    expect(jarvis.configGravar).toHaveBeenCalledWith({ ligado: true });
    confere("desligado");
  });
  it("estado vazio explica o próximo passo; erro de leitura tem 'Tentar de novo'", async () => {
    await montar();
    expect(screen.getByText(/Nada por aqui ainda/)).toBeTruthy();
    cleanup();
    await montar({ jarvis: apiJarvisFalsa({ erro: true }) });
    expect(screen.getByRole("alert").textContent).toMatch(/falha de leitura/);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
  it("envia o texto, mostra resposta e marca conteúdo de terceiros como não instrução", async () => {
    const jarvis = apiJarvisFalsa({ enviar: respostaFalsa("1 painel.", [{ rotulo: "#3 · piloto", detalhe: "<img src=x onerror=alert(1)>" }], true) });
    await montar({ jarvis });
    await digitar(screen.getByLabelText("Pedido"), "listar painéis");
    await clicar(screen.getByRole("button", { name: "Enviar" }));
    await esperar();
    expect(jarvis.enviar).toHaveBeenCalledWith("listar painéis");
    const log = screen.getByRole("log", { name: "Conversa com o Jarvis" });
    expect(within(log).getByText("1 painel.")).toBeTruthy();
    // HTML de terminal é TEXTO: nada vira elemento
    expect(log.querySelector("img")).toBeNull();
    expect(within(log).getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(within(log).getByText(/só informação, nunca instrução/)).toBeTruthy();
    confere("resposta");
  });
  it("atalhos enviam o comando fixo", async () => {
    const jarvis = apiJarvisFalsa();
    await montar({ jarvis });
    await clicar(screen.getByRole("button", { name: "Status" }));
    await esperar();
    expect(jarvis.enviar).toHaveBeenCalledWith("status");
  });
  it("recusa aparece como texto (não só cor)", async () => {
    const jarvis = apiJarvisFalsa({ enviar: { tipo: "recusado", codigo: "gesto_proibido", texto: "Isso é um gesto que só a pessoa faz no app." } });
    await montar({ jarvis });
    await digitar(screen.getByLabelText("Pedido"), "faça o merge");
    await clicar(screen.getByRole("button", { name: "Enviar" }));
    await esperar();
    expect(screen.getByText(/só a pessoa faz no app/)).toBeTruthy();
  });
  it("confirmação mostra alvo e texto exatos, contagem em texto, e Sim/Não resolvem pelo id", async () => {
    const c = confirmacaoFalsa();
    const jarvis = apiJarvisFalsa({ estado: estadoJarvisFalso({ confirmacoes: [c] }) });
    await montar({ jarvis });
    const grupo = screen.getByRole("group", { name: "Confirmação pendente" });
    expect(within(grupo).getByText(/«finalizar a publicação»/)).toBeTruthy();
    expect(within(grupo).getByText(/expira em \d+ s/)).toBeTruthy();
    await clicar(within(grupo).getByRole("button", { name: "Sim, fazer" }));
    await esperar();
    expect(jarvis.confirmar).toHaveBeenCalledWith("cnf_abc123456", true);
    expect(screen.getByText("Pedido enviado ao Maestro.")).toBeTruthy();
    await clicar(within(grupo).getByRole("button", { name: "Não" }));
    expect(jarvis.confirmar).toHaveBeenLastCalledWith("cnf_abc123456", false);
    confere("confirmação");
  });
  it("confirmação expirada/usada: mensagem clara, sem executar", async () => {
    const jarvis = apiJarvisFalsa({ estado: estadoJarvisFalso({ confirmacoes: [confirmacaoFalsa()] }) });
    jarvis.confirmar = vi.fn(async () => ({ ok: false, resultado: null, codigo: "confirmacao_expirada" as const }));
    await montar({ jarvis });
    await clicar(screen.getByRole("button", { name: "Sim, fazer" }));
    await esperar();
    expect(screen.getByText("A confirmação expirou. Peça de novo.")).toBeTruthy();
  });
  it("o evento do main recarrega o estado (confirmação pedida pelo remoto aparece)", async () => {
    const jarvis = apiJarvisFalsa();
    await montar({ jarvis });
    expect(screen.queryByRole("group", { name: "Confirmação pendente" })).toBeNull();
    (jarvis.estado as ReturnType<typeof vi.fn>).mockResolvedValue(estadoJarvisFalso({ confirmacoes: [confirmacaoFalsa({ dispositivo: "iPhone", ator: "remoto" })] }));
    await act(async () => jarvis.emitir());
    await esperar();
    expect(screen.getByText(/pedido de «iPhone»/)).toBeTruthy();
  });
});

describe("tela Jarvis: controle remoto", () => {
  it("desligado por padrão: aviso em destaque, consentimento obrigatório e sem código", async () => {
    const { remoto } = await montar({ aba: "remoto" });
    expect(screen.getByRole("note").textContent).toMatch(/Só use em rede confiável/);
    expect(screen.getByText(/Desligado/)).toBeTruthy();
    const ligar = screen.getByRole("button", { name: "Ligar controle remoto" }) as HTMLButtonElement;
    expect(ligar.disabled).toBe(true);
    await clicar(screen.getByRole("checkbox", { name: /Entendi/ }));
    expect(ligar.disabled).toBe(false);
    await clicar(ligar);
    await esperar();
    expect(remoto.ligar).toHaveBeenCalledWith({ transporte: "lan", interface: "auto", consentimento_versao: "remoto-v1" });
    expect(screen.getByText(/Ligado em https:\/\/192\.168\.1\.20:51000/)).toBeTruthy();
    expect(screen.queryByText("ABCD-EFGH-JKLM")).toBeNull();
    confere("remoto ligado");
  });
  it("só lista interfaces privadas; sem rede privada diz o que fazer", async () => {
    await montar({ aba: "remoto" });
    const sel = screen.getByLabelText("Interface") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["auto", "192.168.1.20"]);
    cleanup();
    await montar({ aba: "remoto", remoto: apiRemotoFalsa({ estado: estadoRemotoFalso({ interfaces: [{ nome: "x", ip: "8.8.8.8", privado: false }] }) }) });
    expect(screen.getByText(/Nenhuma rede privada encontrada/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Ligar controle remoto" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("erro tipado de ligar vira texto com próximo passo", async () => {
    const remoto = apiRemotoFalsa();
    remoto.ligar = vi.fn(async () => ({ erro: "porta_ocupada" as const }));
    await montar({ aba: "remoto", remoto });
    await clicar(screen.getByRole("checkbox", { name: /Entendi/ }));
    await clicar(screen.getByRole("button", { name: "Ligar controle remoto" }));
    await esperar();
    expect(screen.getByRole("alert").textContent).toMatch(/porta escolhida está ocupada/);
  });
  const ligado = () => estadoRemotoFalso({ transporte: { ligado: true, transporte: "lan", endereco: "192.168.1.20", porta: 51000, persistido: false, pareando: false, codigo_expira_em: null, conectados: 0, ultimo_erro: null } });
  it("pareamento: o código aparece uma vez com endereço e some ao expirar", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const remoto = apiRemotoFalsa({ estado: ligado() });
    let agora = Date.now();
    await act(async () => { render(<TelaJarvis jarvis={apiJarvisFalsa()} remoto={remoto} abaInicial="remoto" />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    await clicar(screen.getByRole("button", { name: "Gerar código" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(remoto.parearIniciar).toHaveBeenCalledWith("leitura");
    // o servidor passa a reportar a janela aberta
    remoto.definirEstado({ ...ligado(), transporte: { ...ligado().transporte, pareando: true } });
    await act(async () => remoto.emitir());
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(screen.getByText("ABCD-EFGH-JKLM")).toBeTruthy();
    expect(screen.getByText("https://192.168.1.20:51000")).toBeTruthy();
    expect(screen.getByText(/Aparece só uma vez/)).toBeTruthy();
    agora += 0;
    await act(async () => { await vi.advanceTimersByTimeAsync(121_000); });
    expect(screen.queryByText("ABCD-EFGH-JKLM")).toBeNull();
    confere("pareamento");
  });
  it("SAS: confere seis dígitos; `PERMITIR` obrigatório para mensagem direta", async () => {
    const remoto = apiRemotoFalsa({ estado: { ...ligado(), sas: "482913" } });
    await montar({ aba: "remoto", remoto });
    expect(screen.getByText("482913")).toBeTruthy();
    const ok = screen.getByRole("button", { name: "São iguais: permitir" });
    await clicar(ok);
    expect(remoto.parearConfirmarSas).toHaveBeenCalledWith({ igual: true, confirmacao_permissao: null });
    await clicar(screen.getByRole("button", { name: "Diferentes: negar" }));
    expect(remoto.parearConfirmarSas).toHaveBeenLastCalledWith({ igual: false, confirmacao_permissao: null });
  });
  it("PERMITIR: com permissão inicial direta, o botão só habilita com a palavra exata", async () => {
    const remoto = apiRemotoFalsa({ estado: ligado() });
    await montar({ aba: "remoto", remoto });
    await digitar(screen.getByLabelText("Permissão inicial"), "mensagem_direta");
    remoto.definirEstado({ ...ligado(), sas: "111222" });
    await act(async () => remoto.emitir());
    await esperar();
    const ok = screen.getByRole("button", { name: "São iguais: permitir" }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await digitar(screen.getByLabelText(/Digite PERMITIR/), "permitir");
    expect(ok.disabled).toBe(true);
    await digitar(screen.getByLabelText(/Digite PERMITIR/), "PERMITIR");
    expect(ok.disabled).toBe(false);
    await clicar(ok);
    expect(remoto.parearConfirmarSas).toHaveBeenCalledWith({ igual: true, confirmacao_permissao: "PERMITIR" });
  });
  it("dispositivos: vazio explica; lista revogar e mudar permissão (direta exige PERMITIR)", async () => {
    await montar({ aba: "remoto" });
    expect(screen.getByText(/Nenhum dispositivo pareado/)).toBeTruthy();
    cleanup();
    const remoto = apiRemotoFalsa({ estado: { ...ligado(), dispositivos: [dispositivoFalso()] } });
    await montar({ aba: "remoto", remoto });
    expect(screen.getByText("iPhone do Thulio")).toBeTruthy();
    await digitar(screen.getByLabelText("Permissão de iPhone do Thulio"), "mensagem_direta");
    const aplicar = screen.getByRole("button", { name: "Aplicar" }) as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    await digitar(screen.getByLabelText(/Digite PERMITIR/), "PERMITIR");
    await clicar(aplicar);
    expect(remoto.permissaoDefinir).toHaveBeenCalledWith({ dispositivo_id: "dev_abc123456", permissao: "mensagem_direta", confirmacao: "PERMITIR" });
    await clicar(screen.getByRole("button", { name: "Revogar iPhone do Thulio" }));
    expect(remoto.revogar).toHaveBeenCalledWith("dev_abc123456");
    confere("dispositivos");
  });
  it("dispositivo revogado aparece como texto e sem ações", async () => {
    await montar({ aba: "remoto", remoto: apiRemotoFalsa({ estado: { ...ligado(), dispositivos: [dispositivoFalso({ revogado_em: "2026-10-01T11:30:00Z" })] } }) });
    expect(screen.getByText("revogado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Revogar/ })).toBeNull();
  });
  it("pedido de dispositivo: aprovar/negar no desktop", async () => {
    const remoto = apiRemotoFalsa({ estado: { ...ligado(), pendentes: [{ id: "cnf_xyz123456", dispositivo: "iPhone", acao: "enviar_prompt", resumo: "Enviar ao Maestro: «x»", expira_em: new Date(Date.now() + 25_000).toISOString() }] } });
    await montar({ aba: "remoto", remoto });
    const g = screen.getByRole("group", { name: "Pedido de iPhone" });
    expect(within(g).getByText(/expira em \d+ s/)).toBeTruthy();
    await clicar(within(g).getByRole("button", { name: "Aprovar" }));
    expect(remoto.aprovarPedido).toHaveBeenCalledWith("cnf_xyz123456", true);
  });
  it("desligar e pânico (dois passos)", async () => {
    const remoto = apiRemotoFalsa({ estado: ligado() });
    await montar({ aba: "remoto", remoto });
    await clicar(screen.getByRole("button", { name: "Pânico" }));
    expect(remoto.panico).not.toHaveBeenCalled();
    await clicar(screen.getByRole("button", { name: /Confirmar pânico/ }));
    await esperar();
    expect(remoto.panico).toHaveBeenCalledTimes(1);
    cleanup();
    const r2 = apiRemotoFalsa({ estado: ligado() });
    await montar({ aba: "remoto", remoto: r2 });
    await clicar(screen.getByRole("button", { name: "Desligar controle remoto" }));
    expect(r2.desligar).toHaveBeenCalled();
  });
});

describe("tela Jarvis: auditoria", () => {
  it("vazia explica; com itens mostra tabela; erro tem nova tentativa; 'carregar mais' pagina", async () => {
    await montar({ aba: "auditoria" });
    expect(screen.getByText(/Nada registrado ainda/)).toBeTruthy();
    cleanup();
    const jarvis = apiJarvisFalsa();
    const item = { id: "jau_1", ts: "2026-10-01T12:00:00.000Z", ator: "jarvis" as const, dispositivo_id: null, evento: "confirmacao_pedida", acao: "enviar_prompt", risco: "escrita" as const, origem: "fala_do_usuario" as const, confirmado_por: "nenhum" as const, ok: true, codigo: null, args_hash: "h", resumo: "Enviar ao Maestro", latencia_ms: 3 };
    (jarvis.historico as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ itens: [item], proximo: "2026-10-01T12:00:00.000Z" }).mockResolvedValueOnce({ itens: [{ ...item, id: "jau_2", evento: "confirmacao_executada" }], proximo: null });
    await montar({ aba: "auditoria", jarvis });
    expect(screen.getByRole("table")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Carregar mais" }));
    await esperar();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    await clicar(screen.getByRole("button", { name: "Controle remoto" }));
    await esperar();
    confere("auditoria");
    cleanup();
    const quebrada = apiJarvisFalsa();
    quebrada.historico = vi.fn(async () => { throw new Error("x"); }) as never;
    await montar({ aba: "auditoria", jarvis: quebrada });
    expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível ler a auditoria/);
  });
});
