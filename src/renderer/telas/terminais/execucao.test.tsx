// @vitest-environment jsdom
// Painel "Execução" na tela Terminais: a sessão aberta pelo main (▶ do cabeçalho) entra em aba própria rotulada "Execução", leva o foco quando
// a preferência manda e, a cada nova execução, ENTRA NO LUGAR da anterior (reuso do painel). Medidas e fontes das abas não mudam.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoExecutar } from "../../../compartilhado/executar";
import type { EventoTerminal, FerramentaDetectada, MetadadosSessao } from "../../../compartilhado/terminais";
import { criarArmazem, type Armazem } from "../../componentes/Terminal/armazem";
import { criarStoreTerminais } from "../../estado/terminais";
import { storeExecutar } from "../../estado/executar";
import Tela from "./index";
import type { PropsTerminalGrade } from "./Grade";

afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; });

const meta = (sessao_id: string, ferramenta_id: MetadadosSessao["ferramenta_id"] = "claude"): MetadadosSessao => ({ sessao_id, ferramenta_id, estado: "executando", workspace_id: "ws1", criada_em: "x", persistente: true });
const claude: FerramentaDetectada = { id: "claude", nome: "Claude Code", descricao: "CLI", instalado: true, executavel_id: "e1", modo_lancamento: "direto", erro_codigo: null, versao: "2.0", recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true } };
const ev = (tipo: EventoTerminal["tipo"], sessao_id: string, sequencia: number, extra: object = {}) => ({ versao: 1, tipo, sessao_id, sequencia, ...extra }) as EventoTerminal;

function falso(armazem: Armazem) {
  return function TerminalFalso({ sessaoId }: PropsTerminalGrade) {
    const ref = useRef<HTMLPreElement>(null);
    useEffect(() => armazem.assinar(sessaoId, (x) => { ref.current!.textContent += x; }), [sessaoId]);
    return <pre ref={ref} data-testid={`term-${sessaoId}`} />;
  };
}

describe("painel Execução na tela Terminais", () => {
  let emitirExecucao: (e: EventoExecutar) => void = () => undefined;
  /** liga o store global ao evento e solta a ponte logo depois (o botão de ditado lê `ade().voz` quando a ponte existe) */
  const ligarEvento = (): (() => void) => {
    (globalThis as { ade?: unknown }).ade = { executar: { assinar: (cb: (e: EventoExecutar) => void) => { emitirExecucao = cb; return () => undefined; } } };
    const desligar = storeExecutar.ligar();
    delete (globalThis as { ade?: unknown }).ade;
    return desligar;
  };

  function montar() {
    let ouvir: (e: EventoTerminal) => void = () => undefined;
    const sessoes: MetadadosSessao[] = [meta("a")];
    const api = {
      assinarEventos: vi.fn((cb) => { ouvir = cb; return () => undefined; }), assinarFalhas: vi.fn(() => () => undefined),
      recuperar: vi.fn().mockResolvedValue({ sessoes: [meta("a")] }), listarFerramentas: vi.fn().mockResolvedValue([claude]),
      listarSessoes: vi.fn(async () => [...sessoes]),
      abrir: vi.fn(), confirmarConsumo: vi.fn().mockResolvedValue(true), descartar: vi.fn().mockResolvedValue(true), interromper: vi.fn(), escrever: vi.fn(), redimensionar: vi.fn(),
      lerLayout: vi.fn().mockResolvedValue(null), gravarLayout: vi.fn().mockResolvedValue(true),
    };
    const armazem = criarArmazem();
    const store = criarStoreTerminais({ api: () => api as never, armazem });
    render(<Tela store={store} api={api as never} Terminal={falso(armazem)} tema="escuro" atrasoGravacao={5} infoMissao={{}} workspaceId="ws1" />);
    const abrirDoMain = (id: string, anterior: string | null, focar: boolean) => {
      sessoes.push(meta(id, "personalizado"));
      act(() => emitirExecucao({ tipo: "sessao", workspace_id: "ws1", sessao_id: id, anterior, focar, nome: "Rodar (dev)" }));
      act(() => ouvir(ev("estado", id, 1, { estado: "executando", erro_codigo: null, mensagem: null })));
    };
    return { api, abrirDoMain };
  }

  it("a sessão do main entra em aba própria 'Execução' e, com 'focar', é a aba selecionada; reuso: a nova entra no lugar da anterior", async () => {
    const ligar = ligarEvento();
    const m = montar();
    await screen.findByTestId("term-a");
    expect(screen.getAllByRole("tab")).toHaveLength(1);

    m.abrirDoMain("exec1", null, true);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2), { timeout: 4000 });
    const selecionada = screen.getByRole("tab", { selected: true });
    expect(selecionada.textContent).toContain("Execução");
    expect(screen.getByRole("region", { name: /Execução/ })).toBeTruthy();
    expect(screen.getAllByRole("tab")[0]!.textContent).toContain("Claude Code");

    // segunda execução: mesma posição, uma aba só de execução
    m.abrirDoMain("exec2", "exec1", false);
    await screen.findByTestId("term-exec2");
    await waitFor(() => expect(screen.queryByTestId("term-exec1")).toBeNull());
    const abas = screen.getAllByRole("tab");
    expect(abas).toHaveLength(2);
    expect(abas[1]!.textContent).toContain("Execução");
    ligar();
  });

  it("sem 'focar' (só sinalizar) a aba entra mas o foco continua onde estava", async () => {
    const ligar = ligarEvento();
    const m = montar();
    await screen.findByTestId("term-a");
    m.abrirDoMain("exec9", null, false);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2), { timeout: 4000 });
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("Claude Code");
    expect(screen.getAllByRole("tab")[1]!.textContent).toContain("Execução");
    ligar();
  });
});
