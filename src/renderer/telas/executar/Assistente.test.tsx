// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigExecucaoIpc, ItemConfigExecucao, ListaExecucao } from "../../../compartilhado/executar";
import type { EventoAssistente, PreviaAssistente, PropostaItemIpc, ResultadoAssistente } from "../../../compartilhado/executar-assistente";
import { BotaoExecutar } from "../../casca/BotaoExecutar";
import { criarStoreAssistente } from "../../estado/executar-assistente";
import { criarStoreExecutar } from "../../estado/executar";
import Assistente from "./Assistente";

afterEach(cleanup);

const WS = "ws_AAAAAAAAAAAA";
const HASH = "d".repeat(40);

const PREVIA: PreviaAssistente = {
  workspace_id: WS, dossie_hash: HASH, arquivos: ["README.md", "desktop/package.json", "motor/pyproject.toml"], itens_arvore: 42, bytes: 9_300, tokens_estimados: 3_560, omitidos_sensiveis: 2,
  clis: [{ cli: "claude", disponivel: true, motivo: null }, { cli: "codex", disponivel: true, motivo: null }, { cli: "opencode", disponivel: false, motivo: "não está instalada nesta máquina" }],
  cli: "claude", modelo: null, pistas: 6, limite_tempo_s: 150,
};

const cfg = (id: string, nome: string, extra: Partial<ConfigExecucaoIpc> = {}): ConfigExecucaoIpc => ({
  id, nome, tipo: "rodar", executavel: "npm", argumentos: ["run", "dev"], cwd: "desktop", ambiente: {}, pre_passos: [], porta: null, url: null, abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null, ...extra,
});
const item = (c: ConfigExecucaoIpc, extra: Partial<PropostaItemIpc> = {}): PropostaItemIpc => ({ config: c, justificativa: "Script dev do desktop/package.json.", confianca: 0.9, novo: true, padrao: false, comando: "npm run dev", ...extra });
const RESULTADO = (extra: Partial<ResultadoAssistente> = {}): ResultadoAssistente => ({
  assistente_id: `ass_${"e".repeat(20)}`, workspace_id: WS, fonte: "ia", aviso_fonte: null, avisos: ["Rode npm install em desktop/ antes da primeira execução."], descartados: [{ nome: "Limpar tudo", motivo: "comando ou argumento perigoso: rm" }],
  cli: "claude", tentativas: 1, duracao_ms: 12_000, deteccao_total: 6,
  itens: [
    item(cfg("desktop-rodar-dev", "desktop · Rodar (dev)", { pre_passos: [{ executavel: "npm", argumentos: ["install"] }] }), { padrao: true, novo: false, confianca: 0.93, comando: "npm install && npm run dev" }),
    item(cfg("desktop-testes", "desktop · Testes", { tipo: "teste", argumentos: ["run", "test"] }), { confianca: 0.8 }),
    item(cfg("motor-pytest", "motor · pytest", { tipo: "teste", executavel: "python3", argumentos: ["-m", "pytest"], cwd: "motor" }), { confianca: 0.6, justificativa: "Projeto Python com pytest." }),
  ],
  ...extra,
});

const itemLista = (id: string, cwd: string): ItemConfigExecucao => ({ ...cfg(id, id, { cwd }), origem: "detectada", padrao: false, confiavel: false, comando: "x" });
const lista = (cwds: string[] = ["desktop", "motor", "central"]): ListaExecucao => ({ workspace_id: WS, configuracoes: cwds.map((c, i) => itemLista(`c${i}`, c)), padrao_id: null, armazenamento: "nenhum", vazio: false });

function montar(opcoes: { previa?: Partial<PreviaAssistente>; proporFalha?: Error } = {}) {
  let ouvinte: ((e: EventoAssistente) => void) | null = null;
  const api = {
    // executar
    listar: vi.fn(async () => lista()), estado: vi.fn(async () => ({ fase: "ocioso" })), historico: vi.fn(async () => []), assinar: vi.fn(() => () => undefined),
    // assistente
    assistentePrevia: vi.fn(async (_ws: string, cli?: string) => ({ ...PREVIA, ...(opcoes.previa ?? {}), ...(cli === undefined ? {} : { cli: cli as never }) })),
    assistentePropor: vi.fn(async () => { if (opcoes.proporFalha !== undefined) throw opcoes.proporFalha; return { assistente_id: `ass_${"e".repeat(20)}` }; }),
    assistenteCancelar: vi.fn(async () => ({ ok: true })),
    assistenteSalvar: vi.fn(async () => lista()),
    assistenteAssinar: vi.fn((cb: (e: EventoAssistente) => void) => { ouvinte = cb; return () => { ouvinte = null; }; }),
  };
  const executar = criarStoreExecutar({ api: () => api as never, workspaces: { obter: () => ({ atual: { id: WS } }) as never, assinar: () => () => undefined }, ocioso: () => undefined });
  executar.ligar();
  const assistente = criarStoreAssistente({ api: () => api as never, executar });
  const emitir = (e: EventoAssistente): void => { act(() => { ouvinte?.(e); }); };
  const tela = render(<Assistente store={assistente} executar={executar} />);
  return { api, executar, assistente, emitir, tela };
}

async function abrirConsentimento(m: ReturnType<typeof montar>) {
  await act(async () => { await m.assistente.abrir(); });
  return screen.findByRole("dialog", { name: /configurar a execução com ia/i });
}
async function consentir(m: ReturnType<typeof montar>) {
  await abrirConsentimento(m);
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /concordo, analisar/i })); });
}
async function chegarNaProposta(m: ReturnType<typeof montar>, resultado: ResultadoAssistente = RESULTADO()) {
  await consentir(m);
  m.emitir({ tipo: "concluido", workspace_id: WS, assistente_id: resultado.assistente_id, resultado });
  return screen.findByRole("dialog", { name: /proposta da ia/i });
}

describe("consentimento", () => {
  it("diz o que será enviado, o que nunca é, a CLI e o custo; é um diálogo modal acessível", async () => {
    const m = montar();
    const d = await abrirConsentimento(m);
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(within(d).getByText("O que será enviado")).toBeTruthy();
    expect(within(d).getByLabelText("Arquivos cujo trecho será enviado").textContent).toContain("desktop/package.json");
    expect(d.textContent).toContain("42");
    expect(d.textContent).toMatch(/9,1 KB/);
    expect(d.textContent).toMatch(/≈ 3\.560 tokens/);
    expect(d.textContent).toMatch(/Nada é executado/);
    expect(d.textContent).toMatch(/nada é salvo/);
    expect(d.textContent).toMatch(/nunca é enviado/i);
    expect(d.textContent).toMatch(/Arquivos de ambiente, chaves, credenciais/);
    expect(d.textContent).toMatch(/Foram omitidos 2 arquivos sensíveis/);
    expect(d.textContent).toMatch(/redação de segredos/);
    expect(d.textContent).toMatch(/consome tokens da sua conta/);
    expect(d.textContent).toMatch(/até 2 min 30 s/);
    expect(d.textContent).toMatch(/sem ferramentas/);
    expect(d.textContent).toContain("padrão da CLI");
    const seletor = within(d).getByLabelText("CLI") as HTMLSelectElement;
    expect(seletor.value).toBe("claude");
    const opencode = [...seletor.options].find((o) => o.value === "opencode")!;
    expect(opencode.disabled).toBe(true);
    expect(opencode.textContent).toContain("não está instalada");
    // nada saiu antes do clique
    expect(m.api.assistentePropor).not.toHaveBeenCalled();
  });

  it("o foco inicial está em Cancelar (o caminho seguro); Cancelar e Esc fecham sem enviar nada", async () => {
    const m = montar();
    await abrirConsentimento(m);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancelar"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.api.assistentePropor).not.toHaveBeenCalled();
    await abrirConsentimento(m);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.api.assistentePropor).not.toHaveBeenCalled();
  });

  it("trocar a CLI recarrega a prévia; o consentimento envia a CLI escolhida e o hash do que foi mostrado", async () => {
    const m = montar();
    await abrirConsentimento(m);
    await act(async () => { fireEvent.change(screen.getByLabelText("CLI"), { target: { value: "codex" } }); });
    await waitFor(() => expect(m.api.assistentePrevia).toHaveBeenLastCalledWith(WS, "codex"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /concordo, analisar/i })); });
    expect(m.api.assistentePropor).toHaveBeenCalledWith(WS, "codex", HASH, true);
  });

  it("sem nenhuma CLI: aviso claro e o botão de consentir fica desligado", async () => {
    const m = montar({ previa: { clis: [{ cli: "claude", disponivel: false, motivo: "não está instalada" }, { cli: "codex", disponivel: false, motivo: "não está instalada" }, { cli: "opencode", disponivel: false, motivo: "não está instalada" }], cli: null } });
    await abrirConsentimento(m);
    expect(screen.getByRole("alert").textContent).toMatch(/Nenhuma CLI compatível/);
    expect((screen.getByRole("button", { name: /concordo, analisar/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("gerando", () => {
  it("mostra a fase e o tempo, anuncia só a fase (aria-live), cancela a CLI e volta ao consentimento", async () => {
    const m = montar();
    await consentir(m);
    const d = await screen.findByRole("dialog", { name: /analisando o projeto/i });
    const status = within(d).getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toMatch(/Montando o resumo/);
    m.emitir({ tipo: "progresso", workspace_id: WS, assistente_id: `ass_${"e".repeat(20)}`, fase: "consultando", decorrido_ms: 800 });
    expect(status.textContent).toBe("Consultando Claude Code…");
    expect(d.textContent).toMatch(/00:0\d de até 02:30/);
    expect(d.textContent).toMatch(/Nada está sendo executado/);
    m.emitir({ tipo: "progresso", workspace_id: WS, assistente_id: `ass_${"e".repeat(20)}`, fase: "retentando", decorrido_ms: 90_000 });
    expect(status.textContent).toMatch(/uma única retentativa/);
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Cancelar análise" })); });
    expect(m.api.assistenteCancelar).toHaveBeenCalledWith(WS);
    expect(status.textContent).toBe("Cancelando…");
    m.emitir({ tipo: "cancelado", workspace_id: WS, assistente_id: `ass_${"e".repeat(20)}` });
    expect(await screen.findByRole("dialog", { name: /configurar a execução com ia/i })).toBeTruthy();
  });

  it("evento de outro workspace ou de outra análise é ignorado", async () => {
    const m = montar();
    await consentir(m);
    m.emitir({ tipo: "progresso", workspace_id: WS, assistente_id: `ass_${"e".repeat(20)}`, fase: "consultando", decorrido_ms: 1 });
    m.emitir({ tipo: "concluido", workspace_id: "ws_ZZZZZZZZZZZZ", assistente_id: `ass_${"e".repeat(20)}`, resultado: RESULTADO({ workspace_id: "ws_ZZZZZZZZZZZZ" }) });
    m.emitir({ tipo: "concluido", workspace_id: WS, assistente_id: `ass_${"f".repeat(20)}`, resultado: RESULTADO({ assistente_id: `ass_${"f".repeat(20)}` }) });
    expect(screen.getByRole("dialog", { name: /analisando/i })).toBeTruthy();
  });

  it("Esc durante a análise cancela (nunca deixa a CLI órfã)", async () => {
    const m = montar();
    await consentir(m);
    await act(async () => { fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" }); });
    expect(m.api.assistenteCancelar).toHaveBeenCalledWith(WS);
  });
});

describe("proposta da IA (revisão humana)", () => {
  it("mostra cada configuração editável, justificativa, confiança, novo/já detectada, avisos, descartados e a comparação", async () => {
    const m = montar();
    const d = await chegarNaProposta(m);
    const cartoes = within(d).getAllByRole("listitem").filter((li) => li.classList.contains("asst-cartao"));
    expect(cartoes).toHaveLength(3);
    expect((within(cartoes[0]!).getByLabelText("Nome") as HTMLInputElement).value).toBe("desktop · Rodar (dev)");
    expect((within(cartoes[0]!).getByLabelText(/^Comando \(programa/) as HTMLInputElement).value).toBe("npm run dev");
    expect((within(cartoes[0]!).getByLabelText(/Pasta/) as HTMLSelectElement).value).toBe("desktop");
    expect((within(cartoes[0]!).getByLabelText(/Pré-passos/) as HTMLTextAreaElement).value).toBe("npm install");
    expect(cartoes[0]!.textContent).toMatch(/já detectada/);
    expect(cartoes[0]!.textContent).toMatch(/confiança 93%/);
    expect(cartoes[1]!.textContent).toMatch(/novo/);
    expect(cartoes[2]!.textContent).toContain("Projeto Python com pytest.");
    // comando exato em fonte mono
    const exato = within(cartoes[0]!).getByLabelText("Comando exato de desktop · Rodar (dev)");
    expect(exato.textContent).toBe("$ npm install\n$ npm run dev");
    expect(exato.tagName).toBe("PRE");
    // avisos, descartados e comparação
    expect(within(d).getByLabelText("Avisos e pré-requisitos").textContent).toContain("Rode npm install em desktop/");
    expect(d.textContent).toMatch(/A detecção automática achou 6 configurações; 2 itens da proposta são novos/);
    expect(d.textContent).toMatch(/1 item da IA foi descartado/);
    expect(d.textContent).toContain("comando ou argumento perigoso: rm");
    expect(d.textContent).toMatch(/ainda pede a sua confirmação/);
    expect(d.textContent).toMatch(/a IA nunca concede confiança/);
    // nada salvo ainda
    expect(m.api.assistenteSalvar).not.toHaveBeenCalled();
  });

  it("a pasta é um seletor limitado às pastas do projeto (nunca texto livre)", async () => {
    const m = montar();
    await m.executar.carregarLista();
    const d = await chegarNaProposta(m);
    const seletor = within(d).getAllByLabelText(/Pasta \(dentro do projeto\)/)[0] as HTMLSelectElement;
    expect(seletor.tagName).toBe("SELECT");
    expect([...seletor.options].map((o) => o.value)).toEqual([".", "central", "desktop", "motor"]);
  });

  it("editar o comando atualiza o comando exato; salvar envia o que foi editado e marcado, com a padrão escolhida", async () => {
    const m = montar();
    const d = await chegarNaProposta(m);
    const cartoes = within(d).getAllByRole("listitem").filter((li) => li.classList.contains("asst-cartao"));
    fireEvent.change(within(cartoes[1]!).getByLabelText(/^Comando \(programa/), { target: { value: "npm run test -- --run" } });
    expect(within(cartoes[1]!).getByLabelText("Comando exato de desktop · Testes").textContent).toBe("$ npm run test -- --run");
    fireEvent.change(within(cartoes[1]!).getByLabelText("Nome"), { target: { value: "desktop · Testes (rápidos)" } });
    fireEvent.change(within(cartoes[1]!).getByLabelText("Porta esperada"), { target: { value: "5173" } });
    fireEvent.click(within(cartoes[2]!).getByLabelText("Salvar motor · pytest")); // desmarca a 3ª
    fireEvent.click(within(cartoes[1]!).getByLabelText("Definir desktop · Testes (rápidos) como padrão"));
    const botao = within(d).getByRole("button", { name: /Salvar configurações \(2\)/ });
    await act(async () => { fireEvent.click(botao); });
    expect(m.api.assistenteSalvar).toHaveBeenCalledTimes(1);
    const [ws, id, configs, padrao] = m.api.assistenteSalvar.mock.calls[0] as unknown as [string, string, ConfigExecucaoIpc[], string | null];
    expect(ws).toBe(WS);
    expect(id).toBe(`ass_${"e".repeat(20)}`);
    expect(configs.map((c) => c.nome)).toEqual(["desktop · Rodar (dev)", "desktop · Testes (rápidos)"]);
    expect(configs[0]).toMatchObject({ pre_passos: [{ executavel: "npm", argumentos: ["install"] }], cwd: "desktop", shell: null });
    expect(configs[1]).toMatchObject({ executavel: "npm", argumentos: ["run", "test", "--", "--run"], porta: 5173, shell: null });
    expect(padrao).toBe("desktop-testes");
    // confirmação de salvo com o lembrete da confiança
    const salvo = await screen.findByRole("dialog", { name: /configurações salvas/i });
    expect(salvo.textContent).toMatch(/2 configurações salvas/);
    expect(salvo.textContent).toMatch(/pede a sua confirmação/);
  });

  it("nenhuma marcada ou comando inválido desliga o Salvar e mostra o motivo", async () => {
    const m = montar();
    const d = await chegarNaProposta(m);
    const cartoes = within(d).getAllByRole("listitem").filter((li) => li.classList.contains("asst-cartao"));
    fireEvent.change(within(cartoes[0]!).getByLabelText(/^Comando \(programa/), { target: { value: "npm run 'dev" } });
    expect(within(cartoes[0]!).getByRole("alert").textContent).toMatch(/aspas/);
    expect((within(d).getByRole("button", { name: /Salvar configurações/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(cartoes[0]!).getByLabelText("Salvar desktop · Rodar (dev)")); // desmarcar a inválida libera
    expect((within(d).getByRole("button", { name: /Salvar configurações/ }) as HTMLButtonElement).disabled).toBe(false);
    for (const c of cartoes.slice(1)) fireEvent.click(within(c).getByLabelText(/^Salvar /));
    expect((within(d).getByRole("button", { name: /Salvar configurações/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(cartoes[0]!).getByLabelText(/^Comando \(programa/), { target: { value: "npm run dev" } });
    fireEvent.change(within(cartoes[0]!).getByLabelText("Porta esperada"), { target: { value: "99999" } });
    fireEvent.click(within(cartoes[0]!).getByLabelText("Salvar desktop · Rodar (dev)"));
    expect(within(cartoes[0]!).getByRole("alert").textContent).toMatch(/Porta/);
  });

  it("erro do main ao salvar aparece no diálogo (sem fechá-lo)", async () => {
    const m = montar();
    m.api.assistenteSalvar.mockRejectedValueOnce(new Error("Esta proposta já foi salva ou expirou. Peça ao assistente de novo."));
    const d = await chegarNaProposta(m);
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: /Salvar configurações/ })); });
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent).join(" ")).toMatch(/já foi salva ou expirou/);
    expect(screen.getByRole("dialog", { name: /proposta da ia/i })).toBeTruthy();
  });

  it("Cancelar descarta a proposta sem salvar", async () => {
    const m = montar();
    const d = await chegarNaProposta(m);
    fireEvent.click(within(d).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.api.assistenteSalvar).not.toHaveBeenCalled();
  });

  it("proposta que veio da detecção automática avisa com honestidade que NÃO veio da IA", async () => {
    const m = montar();
    const r = RESULTADO({ fonte: "deterministico", aviso_fonte: "A IA não ajudou desta vez: a resposta da IA não veio no formato pedido. Mostrando só o que a detecção automática encontrou.", avisos: [], descartados: [], tentativas: 2 });
    const d = await chegarNaProposta(m, r);
    expect(within(d).getByRole("note").textContent).toMatch(/NÃO veio da IA/);
    expect(d.textContent).toMatch(/não veio no formato pedido/);
    expect(d.textContent).not.toMatch(/Proposta de Claude Code/);
  });

  it("sem itens: estado vazio com os avisos da IA e caminho para o editor", async () => {
    const m = montar();
    const d = await chegarNaProposta(m, RESULTADO({ itens: [], avisos: ["É só documentação; não há o que executar."], descartados: [] }));
    expect(d.textContent).toMatch(/não encontrou uma forma segura/);
    expect(within(d).getByLabelText("Avisos e pré-requisitos").textContent).toContain("só documentação");
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: /Abrir o editor/ })); });
    expect(m.executar.obter().editor).toBe("editar");
    expect(screen.queryByRole("dialog", { name: /proposta/i })).toBeNull();
  });
});

describe("erro acionável", () => {
  it.each([
    ["cli_ausente", "A CLI escolhida não está disponível nesta máquina.", "Instale a CLI ou escolha outra no menu do consentimento."],
    ["sem_login", "A CLI parece não estar logada.", "Abra a CLI num terminal, faça login e tente de novo."],
    ["limite", "A conta da CLI atingiu um limite de uso.", "Espere o limite renovar ou escolha outra CLI/conta."],
  ] as const)("%s: mensagem simples + sugestão; Tentar de novo volta ao consentimento", async (codigo, mensagem, sugestao) => {
    const m = montar();
    await consentir(m);
    m.emitir({ tipo: "erro", workspace_id: WS, assistente_id: `ass_${"e".repeat(20)}`, erro: { codigo, mensagem, sugestao } });
    const d = await screen.findByRole("dialog", { name: /não foi possível analisar/i });
    expect(within(d).getByRole("alert").textContent).toBe(mensagem);
    expect(d.textContent).toContain(sugestao);
    expect(d.textContent).toMatch(/Nada foi executado nem salvo/);
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Tentar de novo" })); });
    expect(await screen.findByRole("dialog", { name: /configurar a execução com ia/i })).toBeTruthy();
  });

  it("falha ao pedir a análise (ex.: projeto mudou depois da prévia) vira erro acionável", async () => {
    const m = montar({ proporFalha: new Error("O projeto mudou depois da prévia. Abra o assistente de novo para rever o que será enviado.") });
    await consentir(m);
    const d = await screen.findByRole("dialog", { name: /não foi possível analisar/i });
    expect(d.textContent).toMatch(/O projeto mudou/);
  });

  it("Usar a detecção automática fecha o assistente e abre o editor comum", async () => {
    const m = montar();
    await consentir(m);
    m.emitir({ tipo: "erro", workspace_id: WS, assistente_id: `ass_${"e".repeat(20)}`, erro: { codigo: "limite", mensagem: "x", sugestao: "y" } });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Usar a detecção automática" })); });
    expect(m.executar.obter().editor).toBe("editar");
    expect(screen.queryByRole("dialog", { name: /analisar/i })).toBeNull();
  });
});

describe("pontos de entrada: menu do ▶ e 'nada detectado'", () => {
  it("o menu do ▶ tem 'Configurar com IA…' e, sem nada detectado, convida a usar a IA; o clique abre o consentimento", async () => {
    let ouvinte: ((e: EventoAssistente) => void) | null = null;
    void ouvinte;
    const api = {
      listar: vi.fn(async () => ({ workspace_id: WS, configuracoes: [], padrao_id: null, armazenamento: "nenhum", vazio: true })), estado: vi.fn(async () => ({ fase: "ocioso", workspace_id: WS, execucao_id: null, config_id: null, nome: null, tipo: null, passo: 0, passos_total: 0, sessao_id: null, iniciado_em: null, terminado_em: null, porta: null, url: null, codigo: null, sinal: null, mensagem: null })),
      historico: vi.fn(async () => []), assinar: vi.fn(() => () => undefined),
      assistentePrevia: vi.fn(async () => PREVIA), assistentePropor: vi.fn(), assistenteCancelar: vi.fn(), assistenteSalvar: vi.fn(), assistenteAssinar: vi.fn(() => () => undefined),
    };
    const executar = criarStoreExecutar({ api: () => api as never, workspaces: { obter: () => ({ atual: { id: WS } }) as never, assinar: () => () => undefined }, ocioso: () => undefined });
    const assistente = criarStoreAssistente({ api: () => api as never, executar });
    render(<BotaoExecutar store={executar} assistente={assistente} />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurações de execução" }));
    const menu = await screen.findByRole("menu", { name: "Configurações de execução" });
    await waitFor(() => expect(menu.textContent).toMatch(/Nenhuma configuração detectada/));
    expect(menu.textContent).toMatch(/A IA da sua CLI pode ler o projeto/);
    await act(async () => { fireEvent.click(within(menu).getByRole("menuitem", { name: /Configurar com IA/ })); });
    expect(await screen.findByRole("dialog", { name: /configurar a execução com ia/i })).toBeTruthy();
    expect(api.assistentePrevia).toHaveBeenCalledWith(WS, undefined);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
