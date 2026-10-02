// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoTerminal, FerramentaDetectada, MetadadosSessao } from "../../../compartilhado/terminais";
import { criarArmazem, type Armazem } from "../../componentes/Terminal/armazem";
import { criarStoreTerminais } from "../../estado/terminais";
import Tela from "./index";
import type { PropsTerminalGrade } from "./Grade";
import type { InfoPane, MapaMissao } from "./missao";
import { TEXTO_ORQUESTRADOR_SO_DELEGA } from "../../../compartilhado/orquestrador";
import { TEXTO_AVISO_ORQUESTRAR } from "./orquestrar";

afterEach(cleanup);

const meta = (sessao_id: string, ferramenta_id: MetadadosSessao["ferramenta_id"] = "claude"): MetadadosSessao => ({ sessao_id, ferramenta_id, estado: "executando", workspace_id: "ws1", criada_em: "x", persistente: true });
const claude: FerramentaDetectada = { id: "claude", nome: "Claude Code", descricao: "CLI", instalado: true, executavel_id: "e1", modo_lancamento: "direto", erro_codigo: null, versao: "2.0", recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true } };
const ev = (tipo: EventoTerminal["tipo"], sessao_id: string, sequencia: number, extra: object = {}) => ({ versao: 1, tipo, sessao_id, sequencia, ...extra }) as EventoTerminal;

function falso(armazem: Armazem) {
  return function TerminalFalso({ sessaoId, webgl }: PropsTerminalGrade) {
    const ref = useRef<HTMLPreElement>(null);
    useEffect(() => armazem.assinar(sessaoId, (x) => { ref.current!.textContent += x; }), [sessaoId]);
    return <pre ref={ref} data-testid={`term-${sessaoId}`} data-webgl={webgl} />;
  };
}

function montar(opcoes: { recuperadas: MetadadosSessao[]; externas?: MetadadosSessao[]; info?: MapaMissao; prefAtiva?: boolean; workspaceId?: string | null; painelLivre?: boolean }) {
  let ouvir: (e: EventoTerminal) => void = () => undefined;
  let proximo = 1;
  const api = {
    assinarEventos: vi.fn((cb) => { ouvir = cb; return () => undefined; }), assinarFalhas: vi.fn(() => () => undefined),
    recuperar: vi.fn().mockResolvedValue({ sessoes: opcoes.recuperadas }), listarFerramentas: vi.fn().mockResolvedValue([claude]),
    listarSessoes: vi.fn(async () => [...opcoes.recuperadas, ...(opcoes.externas ?? [])]),
    abrir: vi.fn(async () => ({ versao: 1, sessao_id: `novo${proximo++}`, estado: "iniciando" })),
    confirmarConsumo: vi.fn().mockResolvedValue(true), descartar: vi.fn().mockResolvedValue(true), interromper: vi.fn(), escrever: vi.fn(), redimensionar: vi.fn(),
    lerLayout: vi.fn().mockResolvedValue(null), gravarLayout: vi.fn().mockResolvedValue(true),
  };
  let pref = opcoes.prefAtiva === true;
  let edita = false;
  let fechar = true;
  const painelLivre = {
    preferencia: vi.fn(async (workspace_id: string, ativa?: boolean, orquestradorEdita?: boolean, fecharWorkers?: boolean) => { if (ativa !== undefined) pref = ativa; if (orquestradorEdita !== undefined) edita = orquestradorEdita; if (fecharWorkers !== undefined) fechar = fecharWorkers; return { workspace_id, ativa: pref, orquestrador_edita: edita, fechar_workers: fechar }; }),
    aprovacao: vi.fn(async (p: { workspace_id: string | null; nivel?: string }) => ({ workspace_id: p.workspace_id, nivel: p.nivel ?? "automatico_seguro", proprio: p.nivel !== undefined, permitir_raiz: false, confiavel: true, padrao_global: "automatico_seguro" })),
    aprovacaoDoPane: vi.fn(async () => null),
    abrir: vi.fn(async () => ({ sessao_id: "orq-novo", pane_id: "p1", missao_id: "m1", orquestrando: true, aviso: null })),
    orquestrar: vi.fn(async (p: { sessao_id: string; ligar: boolean }) => ({ sessao_id: `${p.sessao_id}-r`, pane_id: "p1", missao_id: p.ligar ? "m1" : null, orquestrando: p.ligar, retomado: true, aviso: null })),
  };
  const armazem = criarArmazem();
  const store = criarStoreTerminais({ api: () => api as never, armazem });
  const props = { store, api: api as never, Terminal: falso(armazem), tema: "escuro" as const, atrasoGravacao: 5, infoMissao: opcoes.info ?? ({} as MapaMissao), workspaceId: opcoes.workspaceId === undefined ? "ws1" : opcoes.workspaceId, ...(opcoes.painelLivre === false ? {} : { painelLivre: painelLivre as never }) };
  const ui = render(<Tela {...props} />);
  return { api, painelLivre, store, ui, emitir: (e: EventoTerminal) => act(() => ouvir(e)), reRender: (info: MapaMissao) => ui.rerender(<Tela {...props} infoMissao={info} />) };
}

const info = (sessaoId: string, extra: Partial<InfoPane> = {}): InfoPane => ({ sessaoId, paneId: `pane-${sessaoId}`, displayId: 1, cli: "claude", papel: "executor", ehPiloto: false, missaoId: "m1", missaoTitulo: "Missão avulsa · #1", avulsa: true, ...extra });

describe("interruptor Orquestrar neste painel", () => {
  it("só aparece em painel de CLI livre: nem shell nem worker de Missão", async () => {
    montar({ recuperadas: [meta("a"), meta("sh", "terminal"), meta("w")], info: { w: info("w", { displayId: 3 }) } });
    await screen.findByTestId("term-a");
    const abas = screen.getAllByRole("tab");
    expect(screen.getByRole("switch", { name: "Orquestrar" })).toBeTruthy();
    fireEvent.click(abas[1]!); // shell
    expect(screen.queryByRole("switch", { name: "Orquestrar" })).toBeNull();
    fireEvent.click(abas[2]!); // worker da Missão avulsa
    expect(screen.queryByRole("switch", { name: "Orquestrar" })).toBeNull();
  });

  it("preferência desligada: mostra o aviso; 'Permitir neste projeto e ligar' grava a preferência, reabre a CLI e a nova sessão toma o lugar", async () => {
    const m = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    const chave = screen.getByRole("switch", { name: "Orquestrar" });
    expect(chave.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(chave);
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(TEXTO_AVISO_ORQUESTRAR)).toBeTruthy();
    expect(m.painelLivre.orquestrar).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Permitir neste projeto e ligar" }));
    await screen.findByTestId("term-a-r");
    expect(m.painelLivre.preferencia).toHaveBeenCalledWith("ws1", true);
    expect(m.painelLivre.orquestrar).toHaveBeenCalledWith({ workspace_id: "ws1", sessao_id: "a", ligar: true });
    expect(screen.queryByTestId("term-a")).toBeNull();
    expect(m.api.descartar).toHaveBeenCalledWith("a");
  });

  it("cancelar o aviso não reinicia nada", async () => {
    const m = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.painelLivre.orquestrar).not.toHaveBeenCalled();
    expect(screen.getByTestId("term-a")).toBeTruthy();
  });

  it("preferência ligada liga direto; ligado, o clique desliga", async () => {
    const m = montar({ recuperadas: [meta("a")], prefAtiva: true });
    await screen.findByTestId("term-a");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    await screen.findByTestId("term-a-r");
    expect(screen.queryByRole("dialog")).toBeNull();
    m.reRender({ "a-r": info("a-r", { ehPiloto: true, papel: "piloto" }) });
    const ligada = await screen.findByRole("switch", { name: "Orquestrar", checked: true });
    fireEvent.click(ligada);
    await waitFor(() => expect(m.painelLivre.orquestrar).toHaveBeenLastCalledWith({ workspace_id: "ws1", sessao_id: "a-r", ligar: false }));
  });

  it("falha mostra o erro no painel e mantém a sessão", async () => {
    const m = montar({ recuperadas: [meta("a")], prefAtiva: true });
    m.painelLivre.orquestrar.mockRejectedValueOnce(new Error("A CLI não suporta o MCP do app."));
    await screen.findByTestId("term-a");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("A CLI não suporta o MCP do app.");
    expect(screen.getByTestId("term-a")).toBeTruthy();
  });

  it("sem projeto aberto o interruptor fica desabilitado com explicação", async () => {
    montar({ recuperadas: [{ ...meta("a"), workspace_id: null }], workspaceId: null });
    await screen.findByTestId("term-a");
    const chave = screen.getByRole("switch", { name: "Orquestrar" }) as HTMLButtonElement;
    expect(chave.disabled).toBe(true);
    expect(chave.title).toMatch(/Abra um projeto/);
  });
});

describe("subagentes internos: chip e faixa", () => {
  it("mostra o chip somente leitura e a faixa; Ativar segue o mesmo fluxo; dispensar esconde a faixa", async () => {
    const m = montar({ recuperadas: [meta("a")], prefAtiva: true });
    await screen.findByTestId("term-a");
    expect(screen.queryByRole("note")).toBeNull();
    m.emitir(ev("subagente_iniciado", "a", 1, { subagente_id: "s1", rotulo: "x", descricao: null }));
    m.emitir(ev("subagente_iniciado", "a", 2, { subagente_id: "s2", rotulo: "y", descricao: null }));
    const chip = await screen.findByRole("img", { name: "Subagentes internos: 2 ativos de 2" });
    expect(chip.getAttribute("title")).toMatch(/não são terminais/);
    const faixa = screen.getByRole("note");
    expect(faixa.textContent).toContain("Este agente abriu subagentes internos (2).");
    expect(faixa.textContent).toContain("Ative Orquestrar neste painel");
    expect(document.querySelectorAll("[data-sessao]")).toHaveLength(1); // subagente nunca vira terminal
    fireEvent.click(within(faixa).getByRole("button", { name: "Ativar" }));
    await waitFor(() => expect(m.painelLivre.orquestrar).toHaveBeenCalledWith({ workspace_id: "ws1", sessao_id: "a", ligar: true }));
  });

  it("dispensar esconde a faixa; painel orquestrando e shell nunca mostram a faixa", async () => {
    const m = montar({ recuperadas: [meta("a"), meta("sh", "terminal")] });
    await screen.findByTestId("term-a");
    m.emitir(ev("subagente_iniciado", "a", 1, { subagente_id: "s1", rotulo: "x", descricao: null }));
    fireEvent.click(await screen.findByRole("button", { name: "Dispensar aviso de subagentes internos" }));
    expect(screen.queryByRole("note")).toBeNull();
    m.emitir(ev("subagente_iniciado", "sh", 1, { subagente_id: "s9", rotulo: "x", descricao: null }));
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(screen.getAllByRole("tab")[0]!);
    m.reRender({ a: info("a", { ehPiloto: true, papel: "piloto" }) });
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("workers do painel que orquestra na grade", () => {
  it("8 workers entram ao lado do pedinte, foco no pedinte, rótulo curto e no máximo 6 painéis com WebGL", async () => {
    const workers = Array.from({ length: 8 }, (_, i) => meta(`w${i + 1}`));
    const mapa: Record<string, InfoPane> = { p: info("p", { displayId: 1, ehPiloto: true, papel: "piloto" }) };
    workers.forEach((w, i) => { mapa[w.sessao_id] = info(w.sessao_id, { displayId: i + 2, tarefa: `Tarefa ${i + 1}` }); });
    const m = montar({ recuperadas: [meta("p")], externas: workers, info: mapa });
    await screen.findByTestId("term-p");
    for (let i = 0; i < workers.length; i++) m.emitir(ev("estado", `w${i + 1}`, 1, { estado: "executando", erro_codigo: null, mensagem: null }));
    await waitFor(() => expect(document.querySelectorAll("[data-sessao]")).toHaveLength(9), { timeout: 3000 });
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Painel #3 · Claude Code · Tarefa 2" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Painel #1 · Claude Code · orquestrando" }).getAttribute("data-foco")).toBe("true");
    const comWebgl = Array.from(document.querySelectorAll("pre[data-webgl]")).filter((e) => e.getAttribute("data-webgl") === "true");
    expect(comWebgl.length).toBeLessThanOrEqual(6);
    expect(comWebgl.length).toBeGreaterThan(0);
    // grade equilibrada (3 linhas de 3) em vez de piloto fixo + workers
    expect(document.querySelector(".terminais-missao")).toBeNull();
  });

  it("sessão externa sem Pane de Missão avulsa entra como nova aba, sem roubar o foco", async () => {
    const m = montar({ recuperadas: [meta("a")], externas: [meta("x")] });
    await screen.findByTestId("term-a");
    m.emitir(ev("estado", "x", 1, { estado: "executando", erro_codigo: null, mensagem: null }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2), { timeout: 4000 });
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("#1");
  });
});

describe("criação já orquestrando", () => {
  it("com a chave da barra ligada, o novo painel abre por painelLivre.abrir (pede permissão se preciso)", async () => {
    const m = montar({ recuperadas: [], prefAtiva: true });
    await screen.findByText("Nenhum terminal aberto");
    const chave = screen.getByRole("switch", { name: "Abrir novos painéis com Orquestrar neste painel" });
    expect(chave.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(chave);
    expect(chave.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
    await screen.findByTestId("term-orq-novo");
    expect(m.painelLivre.abrir).toHaveBeenCalledWith({ workspace_id: "ws1", ferramenta_id: "claude", orquestrar: true });
    expect(m.api.abrir).not.toHaveBeenCalled();
  });

  it("sem a API do painel livre (fora do Electron) nada de interruptor nem chave", async () => {
    montar({ recuperadas: [meta("a")], painelLivre: false });
    await screen.findByTestId("term-a");
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("orquestrador de verdade: selo, opt-out e CLIs que não orquestram (D-510 a D-514)", () => {
  it("o aviso explica que o orquestrador só lê e delega, mostra o selo da CLI e o opt-out; marcar o opt-out grava junto da permissão", async () => {
    const m = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(TEXTO_ORQUESTRADOR_SO_DELEGA)).toBeTruthy();
    expect(within(dialogo).getByText(/Claude Code: orquestração completa\./)).toBeTruthy();
    expect(within(dialogo).getByText(/shell da CLI segue com as aprovações normais/)).toBeTruthy(); // limite honesto
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Orquestrador pode editar arquivos neste projeto" }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Permitir neste projeto e ligar" }));
    await screen.findByTestId("term-a-r");
    expect(m.painelLivre.preferencia).toHaveBeenCalledWith("ws1", true, true);
  });

  it("orquestrando: o selo vai no título do interruptor e 'pode editar' é uma chave do projeto (padrão desligada)", async () => {
    const m = montar({ recuperadas: [meta("a")], prefAtiva: true, info: { a: info("a", { ehPiloto: true, papel: "piloto" }) } });
    await screen.findByTestId("term-a");
    const chave = await screen.findByRole("switch", { name: "Orquestrar", checked: true });
    expect(chave.title).toMatch(/orquestração completa/);
    expect(chave.title).toMatch(/só delega/);
    const edita = screen.getByRole("switch", { name: "Orquestrador pode editar" });
    expect(edita.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(edita);
    await waitFor(() => expect(m.painelLivre.preferencia).toHaveBeenCalledWith("ws1", undefined, true));
  });

  it("CLI sem MCP por sessão (Gemini): explica que não orquestra, oferece a alternativa e não chama o main", async () => {
    const m = montar({ recuperadas: [meta("g", "gemini")], prefAtiva: true });
    await screen.findByTestId("term-g");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/Gemini CLI ainda não orquestra/)).toBeTruthy();
    expect(within(dialogo).getByText(/Use Claude Code, Codex ou OpenCode como orquestrador/)).toBeTruthy();
    expect(m.painelLivre.orquestrar).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Entendi" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Grok: mostra o arquivo EXATO da ponte, só grava com o 'sim' e então liga; cancelar não grava nem reinicia", async () => {
    const m = montar({ recuperadas: [meta("k", "grok")], prefAtiva: true });
    const ponte = vi.fn(async (_ws: string, acao: string) => ({ estado: acao === "aplicar" ? "ativa" : "ausente", arquivo: ".grok/config.toml", conteudo: "[mcp_servers.x]\nurl = \"${VAR}\"\n", detalhe: "A ponte não está ligada neste projeto." }));
    (m.painelLivre as unknown as { ponteGrok: typeof ponte }).ponteGrok = ponte;
    await screen.findByTestId("term-k");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    let dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText("Adicionar o servidor do app em .grok do projeto?")).toBeTruthy();
    expect(within(dialogo).getByLabelText("Conteúdo exato de .grok/config.toml").textContent).toContain("[mcp_servers.x]");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ponte).not.toHaveBeenCalledWith("ws1", "aplicar");
    expect(m.painelLivre.orquestrar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar o arquivo e ligar" }));
    await screen.findByTestId("term-k-r");
    expect(ponte).toHaveBeenCalledWith("ws1", "aplicar");
    expect(m.painelLivre.orquestrar).toHaveBeenCalledWith({ workspace_id: "ws1", sessao_id: "k", ligar: true });
  });

  it("Grok com .grok/config.toml de outra pessoa (bloqueada): explica e NÃO liga", async () => {
    const m = montar({ recuperadas: [meta("k", "grok")], prefAtiva: true });
    (m.painelLivre as unknown as { ponteGrok: unknown }).ponteGrok = vi.fn(async () => ({ estado: "bloqueada", arquivo: ".grok/config.toml", conteudo: "x", detalhe: "Já existe um .grok/config.toml neste projeto: o app não o edita." }));
    await screen.findByTestId("term-k");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/o app não o edita/)).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Entendi" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.painelLivre.orquestrar).not.toHaveBeenCalled();
  });

  async function comWorkers(n: number) {
    const mapa: Record<string, InfoPane> = { p: info("p", { displayId: 1, ehPiloto: true, papel: "piloto" }) };
    const ws = Array.from({ length: n }, (_, i) => meta(`w${i + 1}`));
    ws.forEach((w, i) => { mapa[w.sessao_id] = info(w.sessao_id, { displayId: i + 2, tarefa: `Tarefa ${i + 1}` }); });
    const m = montar({ recuperadas: [meta("p")], externas: ws, info: mapa });
    await screen.findByTestId("term-p");
    for (const w of ws) m.emitir(ev("estado", w.sessao_id, 1, { estado: "executando", erro_codigo: null, mensagem: null }));
    await waitFor(() => expect(document.querySelectorAll("[data-sessao]")).toHaveLength(n + 1), { timeout: 3000 });
    return m;
  }

  it("fechar o ORQUESTRADOR com agentes vivos pergunta 'Encerrar também os N agentes?'; cancelar mantém tudo, confirmar fecha", async () => {
    const m = await comWorkers(2);
    const fechar = (): HTMLElement => screen.getByRole("button", { name: "Fechar #1 · Claude Code · orquestrando" });
    fireEvent.click(fechar());
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/Encerrar também os 2 agentes que este painel abriu\?/)).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.api.descartar).not.toHaveBeenCalled();
    fireEvent.click(fechar());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Encerrar também os 2 agentes" }));
    await waitFor(() => expect(m.api.descartar).toHaveBeenCalledWith("p"));
  });

  it("fechar um worker é direto (sem pergunta) e a grade reflui: o foco volta ao orquestrador", async () => {
    const m = await comWorkers(3);
    expect(document.querySelectorAll("[data-sessao]")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Fechar #3 · Claude Code · Tarefa 2" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(m.api.descartar).toHaveBeenCalledWith("w2"));
    await waitFor(() => expect(document.querySelectorAll("[data-sessao]")).toHaveLength(3));
    expect(screen.getByRole("region", { name: "Painel #1 · Claude Code · orquestrando" }).getAttribute("data-foco")).toBe("true");
  });

  it("os workers mostram o chip '↳ orq.' e o orquestrador fica na coluna da esquerda com a divisão proporcional (45%)", async () => {
    await comWorkers(3);
    expect(document.querySelectorAll(".terminais-painel-orq[data-papel=\"worker\"]")).toHaveLength(3);
    expect(screen.getAllByText("↳ orq.").length).toBe(3);
    const raiz = document.querySelector(".terminais-divisao") as HTMLElement;
    expect(raiz.style.gridTemplateColumns.startsWith("0.45fr")).toBe(true);
    expect(raiz.firstElementChild?.getAttribute("data-sessao")).toBe("p"); // orquestrador primeiro (esquerda)
  });
});

describe("aprovações dos workers no aviso de Orquestrar (D-640)", () => {
  it("mostra os 3 níveis com o recomendado marcado e liga sem gravar nada quando o nível não mudou", async () => {
    const m = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getAllByRole("radio")).toHaveLength(3);
    expect((within(dialogo).getByRole("radio", { name: /Automático seguro/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Permitir neste projeto e ligar" }));
    await waitFor(() => expect(m.painelLivre.orquestrar).toHaveBeenCalled());
    expect(m.painelLivre.aprovacao).toHaveBeenCalledTimes(1); // só a leitura
  });

  it("escolher 'Perguntar sempre' grava o nível do projeto antes de ligar", async () => {
    const m = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("radio", { name: /Perguntar sempre/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Permitir neste projeto e ligar" }));
    await waitFor(() => expect(m.painelLivre.orquestrar).toHaveBeenCalled());
    expect(m.painelLivre.aprovacao).toHaveBeenLastCalledWith({ workspace_id: "ws1", nivel: "perguntar" });
  });

  it("o Total só liga com a palavra digitada: o botão fica desabilitado até 'liberar tudo'", async () => {
    const m = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    fireEvent.click(screen.getByRole("switch", { name: "Orquestrar" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("radio", { name: /Total/ }));
    const botao = within(dialogo).getByRole("button", { name: "Permitir neste projeto e ligar" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(within(dialogo).getByLabelText(/digite/i), { target: { value: "liberar tudo" } });
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(m.painelLivre.orquestrar).toHaveBeenCalled());
    expect(m.painelLivre.aprovacao).toHaveBeenLastCalledWith({ workspace_id: "ws1", nivel: "total", confirmacao: "liberar tudo" });
  });
});

