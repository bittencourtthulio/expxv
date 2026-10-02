// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PedidoAprovacaoWorkers, PreferenciaAprovacaoWorkers } from "../../../compartilhado/aprovacao-workers";
import type { AprovacaoDoPane } from "../../../compartilhado/painel-livre";
import { AjustesAprovacaoProjeto, AvisoWorkerAguardando, IndicadorAprovacaoWorker, LinhaAprovacaoDoProjeto, SecaoAprovacaoWorkers, SeletorNiveisAprovacao, type ApiAprovacaoParaTeste } from "./aprovacao-workers";

afterEach(cleanup);

function api(inicial: Partial<PreferenciaAprovacaoWorkers> = {}, doPane: AprovacaoDoPane | null = null) {
  let estado: PreferenciaAprovacaoWorkers = { workspace_id: null, nivel: "automatico_seguro", proprio: true, permitir_raiz: false, confiavel: true, padrao_global: "automatico_seguro", ...inicial };
  const aprovacao = vi.fn(async (p: PedidoAprovacaoWorkers) => {
    estado = { ...estado, workspace_id: p.workspace_id, ...(p.nivel === undefined ? {} : { nivel: p.nivel, proprio: true }), ...(p.permitir_raiz === undefined ? {} : { permitir_raiz: p.permitir_raiz }), ...(p.confiavel === undefined ? {} : { confiavel: p.confiavel }) };
    return estado;
  });
  const aprovacaoDoPane = vi.fn(async () => doPane);
  return { aprovacao, aprovacaoDoPane } as unknown as ApiAprovacaoParaTeste & { aprovacao: typeof aprovacao };
}

describe("seletor dos 3 níveis (D-640)", () => {
  it("mostra os três níveis com o que pode e o que continua bloqueado, e os selos por CLI", () => {
    render(<SeletorNiveisAprovacao nivel="automatico_seguro" aoMudar={() => undefined} confirmacao="" aoConfirmacao={() => undefined} />);
    const grupo = screen.getByRole("radiogroup", { name: "Aprovações dos workers" });
    expect(grupo.querySelectorAll("input[type=radio]")).toHaveLength(3);
    expect(screen.getAllByText(/Pode sozinho:/)).toHaveLength(3);
    expect(screen.getAllByText(/Continua bloqueado:/)).toHaveLength(3);
    expect((screen.getByRole("radio", { name: /Automático seguro/ }) as HTMLInputElement).checked).toBe(true);
    const selos = within(screen.getByRole("list", { name: /Quanto cada CLI cumpre/ }));
    expect(selos.getByText(/Claude Code/).closest("li")?.getAttribute("data-selo")).toBe("garantido");
    expect(selos.getByText(/Codex/).closest("li")?.getAttribute("data-selo")).toBe("parcial");
    expect(selos.getByText(/Demais CLIs/).closest("li")?.getAttribute("data-selo")).toBe("pergunta");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("o Total mostra aviso vermelho e o campo da palavra digitada", () => {
    render(<SeletorNiveisAprovacao nivel="total" aoMudar={() => undefined} confirmacao="liber" aoConfirmacao={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Perigo/);
    const campo = screen.getByLabelText(/digite/i) as HTMLInputElement;
    expect(campo.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("Configurações: padrão global", () => {
  it("salva um nível comum direto; o Total só habilita com 'liberar tudo' e envia a confirmação", async () => {
    const a = api();
    render(<SecaoAprovacaoWorkers api={a} />);
    await screen.findByText(/Padrão atual: automático seguro/);
    const salvar = screen.getByRole("button", { name: "Salvar padrão" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Perguntar sempre/ }));
    expect(salvar.disabled).toBe(false);
    await act(async () => { fireEvent.click(salvar); });
    expect(a.aprovacao).toHaveBeenLastCalledWith({ workspace_id: null, nivel: "perguntar" });
    fireEvent.click(screen.getByRole("radio", { name: /Total/ }));
    expect(salvar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/digite/i), { target: { value: "liberar" } });
    expect(salvar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/digite/i), { target: { value: "liberar tudo" } });
    expect(salvar.disabled).toBe(false);
    await act(async () => { fireEvent.click(salvar); });
    expect(a.aprovacao).toHaveBeenLastCalledWith({ workspace_id: null, nivel: "total", confirmacao: "liberar tudo" });
  });
});

describe("ajustes do projeto", () => {
  it("confiança e raiz: raiz pede confirmação antes de gravar; desmarcar a confiança grava na hora", async () => {
    const a = api({ workspace_id: "ws_1", proprio: false });
    render(<AjustesAprovacaoProjeto workspaceId="ws_1" nome="Projeto" api={a} aoFechar={() => undefined} />);
    await screen.findByText(/usa o padrão global/);
    fireEvent.click(screen.getByLabelText(/Permitir também na raiz/));
    expect(a.aprovacao).toHaveBeenCalledTimes(1); // só a leitura inicial
    expect(screen.getByRole("alert").textContent).toMatch(/edita direto a árvore principal/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sim, permitir na raiz" })); });
    expect(a.aprovacao).toHaveBeenLastCalledWith({ workspace_id: "ws_1", permitir_raiz: true });
    await act(async () => { fireEvent.click(screen.getByLabelText(/Projeto confiável/)); });
    expect(a.aprovacao).toHaveBeenLastCalledWith({ workspace_id: "ws_1", confiavel: false });
  });
  it("o cartão mostra o nível vigente e abre os ajustes", async () => {
    render(<LinhaAprovacaoDoProjeto workspaceId="ws_1" nome="Projeto" api={api({ workspace_id: "ws_1", proprio: false })} />);
    await screen.findByText(/aprovações dos workers: automático seguro \(padrão\)/);
    fireEvent.click(screen.getByRole("button", { name: "Alterar aprovações dos workers de Projeto" }));
    await screen.findByRole("dialog");
  });
});

describe("indicador no cabeçalho do worker", () => {
  it("mostra 'aprovações: automático seguro' com o selo no título", async () => {
    render(<IndicadorAprovacaoWorker paneId="pane_1" api={api({}, { nivel: "automatico_seguro", nivel_pedido: "automatico_seguro", selo: "garantido", avisos: [] })} />);
    const chip = await screen.findByText("aprovações: automático seguro");
    expect(chip.getAttribute("title")).toMatch(/garantido pela CLI/);
    expect(chip.getAttribute("data-rebaixado")).toBeNull();
  });
  it("rebaixado por segurança aparece tracejado e explica o motivo", async () => {
    render(<IndicadorAprovacaoWorker paneId="pane_1" api={api({}, { nivel: "perguntar", nivel_pedido: "automatico_seguro", selo: "pergunta", avisos: ["O worker abriu na raiz do projeto."] })} />);
    const chip = await screen.findByText("aprovações: perguntar sempre");
    expect(chip.getAttribute("data-rebaixado")).toBe("true");
    expect(chip.getAttribute("title")).toMatch(/Configurado: automático seguro/);
    expect(chip.getAttribute("title")).toMatch(/raiz do projeto/);
  });
  it("sem política (piloto, painel comum) não mostra nada", async () => {
    const a = api({}, null);
    const { container } = render(<IndicadorAprovacaoWorker paneId="pane_x" api={a} />);
    await waitFor(() => expect(a.aprovacaoDoPane).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("worker aguardando a aprovação do dono (D-644)", () => {
  it("só avisa depois do prazo contínuo em 'aguardando'; o botão leva ao painel; some ao voltar a trabalhar e não aparece com o painel em foco", () => {
    vi.useFakeTimers();
    try {
      const ir = vi.fn();
      const { rerender } = render(<AvisoWorkerAguardando aguardando emFoco={false} aoIr={ir} prazoMs={8000} />);
      expect(screen.queryByText("Worker aguardando sua aprovação")).toBeNull();
      act(() => { vi.advanceTimersByTime(7999); });
      expect(screen.queryByText("Worker aguardando sua aprovação")).toBeNull();
      act(() => { vi.advanceTimersByTime(2); });
      expect(screen.getByText("Worker aguardando sua aprovação")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Ir para o painel" }));
      expect(ir).toHaveBeenCalledTimes(1);
      rerender(<AvisoWorkerAguardando aguardando emFoco aoIr={ir} prazoMs={8000} />);
      expect(screen.queryByRole("button", { name: "Ir para o painel" })).toBeNull();
      rerender(<AvisoWorkerAguardando aguardando={false} emFoco={false} aoIr={ir} prazoMs={8000} />);
      expect(screen.queryByText("Worker aguardando sua aprovação")).toBeNull();
      // recomeça a contar a cada nova espera
      rerender(<AvisoWorkerAguardando aguardando emFoco={false} aoIr={ir} prazoMs={8000} />);
      expect(screen.queryByText("Worker aguardando sua aprovação")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
