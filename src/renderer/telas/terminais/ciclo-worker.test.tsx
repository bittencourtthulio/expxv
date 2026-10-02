// @vitest-environment jsdom
// D-520: ciclo de vida do PAINEL do worker na grade. Fechamento pedido pelo app some na hora e a grade reflui; o worker que termina sozinho mostra "Concluído"; o que MORRE com erro
// fica visível ("Falhou (código N)") com alerta no orquestrador, "limpar encerrados" e fecha sozinho em 60 s se o dono não interagir. O 143 de um fechamento solicitado nunca aparece.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoTerminal, FerramentaDetectada, MetadadosSessao } from "../../../compartilhado/terminais";
import { criarArmazem, type Armazem } from "../../componentes/Terminal/armazem";
import { criarStoreTerminais } from "../../estado/terminais";
import Tela from "./index";
import type { PropsTerminalGrade } from "./Grade";
import type { InfoPane, MapaMissao } from "./missao";
import { PRAZO_FALHA_PAINEL_MS, resultadoDoWorker, textoDoFimDoWorker } from "./ciclo-worker";

afterEach(cleanup);

const meta = (sessao_id: string): MetadadosSessao => ({ sessao_id, ferramenta_id: "claude", estado: "executando", workspace_id: "ws1", criada_em: "x", persistente: true });
const claude: FerramentaDetectada = { id: "claude", nome: "Claude Code", descricao: "CLI", instalado: true, executavel_id: "e1", modo_lancamento: "direto", erro_codigo: null, versao: "2.0", recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true } };
let seq = 100;
const ev = (tipo: EventoTerminal["tipo"], sessao_id: string, extra: object = {}) => ({ versao: 1, tipo, sessao_id, sequencia: ++seq, ...extra }) as EventoTerminal;
const executando = (id: string) => ev("estado", id, { estado: "executando", erro_codigo: null, mensagem: null });

function falso(armazem: Armazem) {
  return function TerminalFalso({ sessaoId }: PropsTerminalGrade) {
    const ref = useRef<HTMLPreElement>(null);
    useEffect(() => armazem.assinar(sessaoId, (x) => { ref.current!.textContent += x; }), [sessaoId]);
    return <pre ref={ref} data-testid={`term-${sessaoId}`} />;
  };
}

const info = (sessaoId: string, extra: Partial<InfoPane> = {}): InfoPane => ({ sessaoId, paneId: `pane-${sessaoId}`, displayId: 1, cli: "claude", papel: "explorador", ehPiloto: false, missaoId: "m1", missaoTitulo: "Missão avulsa · #1", avulsa: true, ...extra });

async function montarComWorkers(n: number, extra: { prazoFalhaMs?: number } = {}) {
  let ouvir: (e: EventoTerminal) => void = () => undefined;
  const workers = Array.from({ length: n }, (_, i) => meta(`w${i + 1}`));
  const mapa: Record<string, InfoPane> = { p: info("p", { displayId: 1, ehPiloto: true, papel: "piloto" }) };
  workers.forEach((w, i) => { mapa[w.sessao_id] = info(w.sessao_id, { displayId: i + 2, tarefa: `Tarefa ${i + 1}` }); });
  const api = {
    assinarEventos: vi.fn((cb) => { ouvir = cb; return () => undefined; }), assinarFalhas: vi.fn(() => () => undefined),
    recuperar: vi.fn().mockResolvedValue({ sessoes: [meta("p")] }), listarFerramentas: vi.fn().mockResolvedValue([claude]),
    listarSessoes: vi.fn(async () => [meta("p"), ...workers]),
    abrir: vi.fn(), confirmarConsumo: vi.fn().mockResolvedValue(true), descartar: vi.fn().mockResolvedValue(true), interromper: vi.fn(), escrever: vi.fn(), redimensionar: vi.fn(),
    lerLayout: vi.fn().mockResolvedValue(null), gravarLayout: vi.fn().mockResolvedValue(true),
  };
  let fechar = true;
  const painelLivre = {
    preferencia: vi.fn(async (workspace_id: string, _a?: boolean, _e?: boolean, f?: boolean) => { if (f !== undefined) fechar = f; return { workspace_id, ativa: true, orquestrador_edita: false, fechar_workers: fechar }; }),
    abrir: vi.fn(), orquestrar: vi.fn(), ponteGrok: vi.fn(),
  };
  const armazem = criarArmazem();
  const store = criarStoreTerminais({ api: () => api as never, armazem });
  render(<Tela store={store} api={api as never} Terminal={falso(armazem)} tema="escuro" atrasoGravacao={5} infoMissao={mapa as MapaMissao} workspaceId="ws1" painelLivre={painelLivre as never} {...(extra.prazoFalhaMs === undefined ? {} : { prazoFalhaMs: extra.prazoFalhaMs })} />);
  await screen.findByTestId("term-p");
  const emitir = (e: EventoTerminal): void => act(() => ouvir(e));
  for (const w of workers) emitir(executando(w.sessao_id));
  await waitFor(() => expect(document.querySelectorAll("[data-sessao]")).toHaveLength(n + 1), { timeout: 3000 });
  return { api, painelLivre, emitir, store };
}
const paineis = (): string[] => Array.from(document.querySelectorAll("[data-sessao]")).map((e) => e.getAttribute("data-sessao") as string);
const orquestrador = (): HTMLElement => screen.getByRole("region", { name: "Painel #1 · Claude Code · orquestrando" });

describe("funções puras do fim do worker", () => {
  it("worker que terminou: erro = falhou, encerrada = concluído; piloto e painel comum nunca são worker", () => {
    expect(resultadoDoWorker(info("w"), "erro")).toBe("falhou");
    expect(resultadoDoWorker(info("w"), "encerrada")).toBe("concluido");
    expect(resultadoDoWorker(info("w"), "executando")).toBeNull();
    // saiu limpo (0) mas o handoff diz que falhou: é falha (sem código na etiqueta)
    expect(resultadoDoWorker(info("w", { handoffFalhou: true }), "encerrada")).toBe("falhou");
    expect(textoDoFimDoWorker("falhou", 0)).toBe("Falhou");
    expect(resultadoDoWorker(info("p", { ehPiloto: true, papel: "piloto" }), "erro")).toBeNull();
    expect(resultadoDoWorker(undefined, "erro")).toBeNull();
    expect(textoDoFimDoWorker("falhou", 2)).toBe("Falhou (código 2)");
    expect(textoDoFimDoWorker("falhou", null)).toBe("Falhou");
    expect(textoDoFimDoWorker("concluido", 0)).toBe("Concluído");
    expect(PRAZO_FALHA_PAINEL_MS).toBe(60_000);
  });
});

describe("fechamento pedido pelo app: sai da grade na hora e a grade reflui", () => {
  it("um a um: 3 workers fecham (fechada) e a grade vai 4 → 3 → 2 → 1, sem NENHUM 'Sessão encerrada' pendurado e com o foco no orquestrador", async () => {
    const m = await montarComWorkers(3);
    expect(document.querySelector(".terminais-painel-fim")).toBeNull();
    m.emitir(ev("fechada", "w2"));
    m.emitir(ev("encerramento", "w2", { codigo: 143, sinal: null, solicitado: true }));
    await waitFor(() => expect(paineis()).toHaveLength(3));
    expect(paineis()).not.toContain("w2");
    expect(document.querySelector(".terminais-painel-fim")).toBeNull();
    m.emitir(ev("fechada", "w1"));
    await waitFor(() => expect(paineis()).toHaveLength(2));
    m.emitir(ev("fechada", "w3"));
    await waitFor(() => expect(paineis()).toEqual(["p"]));
    expect(document.body.textContent).not.toContain("Sessão encerrada");
    expect(document.body.textContent).not.toContain("143");
    expect(orquestrador().getAttribute("data-foco")).toBe("true");
    expect(m.api.descartar).not.toHaveBeenCalled(); // o main já descartou: a interface não repete
  });

  it("o orquestrador ocupa a coluna da esquerda e os workers restantes refluem no espaço (divisão proporcional refeita)", async () => {
    const m = await montarComWorkers(3);
    const antes = (document.querySelector(".terminais-divisao") as HTMLElement).style.gridTemplateColumns;
    expect(antes.startsWith("0.45fr")).toBe(true);
    m.emitir(ev("fechada", "w3"));
    await waitFor(() => expect(paineis()).toHaveLength(3));
    expect((document.querySelector(".terminais-divisao") as HTMLElement).style.gridTemplateColumns.startsWith("0.5fr")).toBe(true); // 2 workers: 50%
  });
});

describe("worker que terminou sozinho", () => {
  it("saiu com 0 e o app ainda não fechou o painel (opção desligada): mostra 'Concluído' com o botão Fechar, sem código", async () => {
    const m = await montarComWorkers(2);
    m.emitir(ev("encerramento", "w1", { codigo: 0, sinal: null }));
    m.emitir(ev("estado", "w1", { estado: "encerrada", erro_codigo: null, mensagem: null }));
    const painel = screen.getByRole("region", { name: "Painel #2 · Claude Code · Tarefa 1" });
    expect(within(painel).getByText("Concluído")).toBeTruthy();
    expect(painel.textContent).not.toContain("Sessão encerrada");
    fireEvent.click(within(painel).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(m.api.descartar).toHaveBeenCalledWith("w1"));
    await waitFor(() => expect(paineis()).not.toContain("w1"));
  });
});

describe("worker que MORREU com erro (ninguém pediu): fica visível", () => {
  async function comFalha(extra: { prazoFalhaMs?: number } = {}) {
    const m = await montarComWorkers(3, extra);
    m.emitir(ev("encerramento", "w2", { codigo: 2, sinal: null }));
    m.emitir(ev("estado", "w2", { estado: "erro", erro_codigo: "processo_falhou", mensagem: "O terminal foi encerrado com erro." }));
    return m;
  }

  it("mostra 'Falhou (código 2)' com Fechar, o alerta no orquestrador e o 'limpar encerrados'", async () => {
    await comFalha();
    const painel = screen.getByRole("region", { name: "Painel #3 · Claude Code · Tarefa 2" });
    expect(within(painel).getByText("Falhou (código 2)")).toBeTruthy();
    expect(painel.getAttribute("data-resultado")).toBe("falhou");
    expect(within(painel).getByRole("button", { name: "Fechar" })).toBeTruthy();
    expect(within(orquestrador()).getByText("1 agente falhou")).toBeTruthy();
    expect(within(orquestrador()).getByRole("button", { name: "Limpar encerrados" }).textContent).toContain("(1)");
    expect(paineis()).toHaveLength(4); // nada some sozinho já
  });

  it("'Limpar encerrados' fecha SÓ os painéis que terminaram; os que trabalham ficam", async () => {
    const m = await comFalha();
    m.emitir(ev("encerramento", "w3", { codigo: 0, sinal: null }));
    m.emitir(ev("estado", "w3", { estado: "encerrada", erro_codigo: null, mensagem: null }));
    expect(within(orquestrador()).getByRole("button", { name: "Limpar encerrados" }).textContent).toContain("(2)");
    fireEvent.click(within(orquestrador()).getByRole("button", { name: "Limpar encerrados" }));
    await waitFor(() => expect(paineis().sort()).toEqual(["p", "w1"]));
    expect(m.api.descartar).toHaveBeenCalledTimes(2);
    expect(within(orquestrador()).queryByRole("button", { name: "Limpar encerrados" })).toBeNull();
    expect(within(orquestrador()).queryByText(/falhou/)).toBeNull();
  });

  it("sem interação, o painel que falhou fecha sozinho depois do prazo (60 s por padrão)", async () => {
    const m = await comFalha({ prazoFalhaMs: 60 });
    await waitFor(() => expect(paineis()).not.toContain("w2"), { timeout: 2000 });
    expect(m.api.descartar).toHaveBeenCalledWith("w2");
    expect(paineis().sort()).toEqual(["p", "w1", "w3"]);
  });

  it("com interação (passar o mouse, clicar ou digitar) o painel NÃO fecha sozinho", async () => {
    const m = await comFalha({ prazoFalhaMs: 150 });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "Painel #3 · Claude Code · Tarefa 2" }));
    await new Promise((r) => setTimeout(r, 400));
    expect(paineis()).toContain("w2");
    expect(m.api.descartar).not.toHaveBeenCalled();
  });

  it("o 143 que NÃO foi pedido (processo morto de fora) é falha e aparece com o código", async () => {
    const m = await montarComWorkers(1);
    m.emitir(ev("encerramento", "w1", { codigo: 143, sinal: null }));
    m.emitir(ev("estado", "w1", { estado: "erro", erro_codigo: "processo_falhou", mensagem: null }));
    expect(within(screen.getByRole("region", { name: "Painel #2 · Claude Code · Tarefa 1" })).getByText("Falhou (código 143)")).toBeTruthy();
  });
});

describe("painel comum: o 143 solicitado nunca aparece", () => {
  it("sessão encerrada pelo app (solicitado) mostra 'Sessão encerrada' sem código", async () => {
    const m = await montarComWorkers(1);
    m.emitir(ev("encerramento", "p", { codigo: 143, sinal: null, solicitado: true }));
    m.emitir(ev("estado", "p", { estado: "encerrada", erro_codigo: null, mensagem: null }));
    expect(screen.getByText("Sessão encerrada")).toBeTruthy();
    expect(document.body.textContent).not.toContain("(código 143)");
  });
});

describe("chave 'Fechar workers ao terminar'", () => {
  it("no cabeçalho do orquestrador: padrão ligada; clicar grava `fechar_workers: false` sem tocar nas outras preferências", async () => {
    const m = await montarComWorkers(1);
    const chave = await within(orquestrador()).findByRole("switch", { name: "Fechar workers ao terminar" });
    expect(chave.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(chave);
    await waitFor(() => expect(m.painelLivre.preferencia).toHaveBeenCalledWith("ws1", undefined, undefined, false));
    await waitFor(() => expect(within(orquestrador()).getByRole("switch", { name: "Fechar workers ao terminar" }).getAttribute("aria-checked")).toBe("false"));
  });
});
