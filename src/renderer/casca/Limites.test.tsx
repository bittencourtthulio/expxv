// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTAS_FALSAS, GERAL_FALSO, RESPOSTA_LIMITES, uso } from "../a11y/ade-falso-harness";
import { criarStoreAvisos } from "../estado/avisos";
import { criarStoreLimites, storeLimites } from "../estado/limites";
import { fecharPopoverLimites } from "../estado/popover-limites";
import { CotaGeralTopo } from "./CotaGeralTopo";
import { MedidorLimites } from "./MedidorLimites";
import { Avisos } from "./Avisos";

afterEach(() => { cleanup(); fecharPopoverLimites(); delete (globalThis as { ade?: unknown }).ade; });

/** Troca a API do store singleton (os componentes leem `storeLimites`): instala `window.ade.limites` e inicia do zero. */
function instalar(extra: Record<string, unknown> = {}, resposta = RESPOSTA_LIMITES) {
  const limites = { snapshot: vi.fn().mockResolvedValue(resposta), atualizar: vi.fn().mockResolvedValue(resposta), definirManual: vi.fn().mockResolvedValue(resposta.contas[0]), limparManual: vi.fn().mockResolvedValue(resposta.contas[0]), previsao: vi.fn().mockResolvedValue([]), assinar: vi.fn().mockReturnValue(() => undefined), ...extra };
  (globalThis as unknown as { ade: unknown }).ade = { limites };
  return limites;
}
async function montarComStore(ui: React.ReactElement, resposta = RESPOSTA_LIMITES) {
  const limites = instalar({}, resposta);
  await act(async () => { await storeLimites.iniciar(); await storeLimites.atualizar(); });
  await act(async () => { render(ui); });
  return limites;
}

describe("store de limites", () => {
  it("sem API fica indisponível (nunca erro) e com API carrega contas, rótulos e cota geral", async () => {
    const sem = criarStoreLimites({ api: () => undefined });
    await sem.iniciar();
    expect(sem.obter()).toMatchObject({ disponivel: false, carregado: true });
    const eventos: Array<(e: unknown) => void> = [];
    const api = { snapshot: vi.fn().mockResolvedValue(RESPOSTA_LIMITES), assinar: vi.fn((cb: (e: unknown) => void) => { eventos.push(cb); return () => undefined; }) };
    const avisar = vi.fn();
    const s = criarStoreLimites({ api: () => api as never, avisar });
    await s.iniciar();
    expect(s.obter().rotulos).toEqual({ c1: "cl·1", c2: "cl·2", c3: "co·1" });
    expect(s.obter().geral).toEqual(GERAL_FALSO);
    await act(async () => { eventos[0]!({ tipo: "consumo_alto", conta_id: "c2", janela: "five_hour", used_pct: 87 }); });
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("87%"), "aviso");
    expect(api.snapshot).toHaveBeenCalledTimes(2);
  });
});

describe("rodapé: medidor por conta", () => {
  it("mostra por conta logo + % do gargalo + minibarra, agrupa por provedor e é discreto (uma linha)", async () => {
    await montarComStore(<MedidorLimites />);
    const grupo = screen.getByRole("group", { name: "Cotas por conta" });
    const claude = within(grupo).getByRole("group", { name: "Claude" });
    expect(within(claude).getAllByRole("button")).toHaveLength(2);
    const c1 = within(grupo).getByRole("button", { name: /Claude, conta cl·1, janela de 5 horas, 62 por cento, reinicia em .*; janela semanal, 31 por cento/ });
    expect(c1.textContent).toContain("62%");
    expect(c1.querySelector("svg.logo-provedor[data-provedor='claude']")).not.toBeNull();
    expect(c1.querySelector(".medidor-barra")).not.toBeNull();
    const c2 = within(grupo).getByRole("button", { name: /Claude, conta cl·2.*87 por cento.*consumo alto/ });
    expect(c2.textContent).toContain("▲");
    expect(c2.getAttribute("data-tom")).toBe("aviso");
    const semDado = within(grupo).getByRole("button", { name: /Codex, conta co·1, sem dado/ });
    expect(semDado.textContent).toBe("—");
    expect(semDado.textContent).not.toContain("0%");
    expect(within(grupo).getByRole("group", { name: "Codex" })).toBeTruthy();
  });
  it("usa o nome da conta quando o snapshot o traz", async () => {
    await montarComStore(<MedidorLimites />, { contas: [uso("n1", "claude", { account_label: "Pessoal" })], geral: GERAL_FALSO });
    expect(screen.getByRole("button", { name: /Claude, conta Pessoal, janela de 5 horas, 62 por cento/ })).toBeTruthy();
  });
  it("provedor desconhecido cai nas iniciais, sem logo inventado", async () => {
    await montarComStore(<MedidorLimites />, { contas: [uso("z1", "zeta")], geral: GERAL_FALSO });
    const b = screen.getByRole("button", { name: /Zeta, conta/ });
    expect(b.querySelector("svg")).toBeNull();
    expect(b.querySelector(".logo-provedor-iniciais")?.textContent).toBe("ZE");
  });
  it("mais de 4 contas viram +N", async () => {
    const muitas = Array.from({ length: 6 }, (_, i) => uso(`x${i}`, "claude"));
    await montarComStore(<MedidorLimites />, { contas: muitas, geral: GERAL_FALSO });
    const grupo = screen.getByRole("group", { name: "Cotas por conta" });
    expect(within(grupo).getAllByRole("button")).toHaveLength(5);
    expect(within(grupo).getByRole("button", { name: "Mais 2 contas" }).textContent).toBe("+2");
  });
  it("conta de crédito mostra saldo, nunca 0%", async () => {
    await montarComStore(<MedidorLimites />, { contas: [uso("o1", "openrouter", { windows: [], credit: { limit_usd: 20, used_usd: 12.9, remaining_usd: 7.1 } })], geral: GERAL_FALSO });
    const b = screen.getByRole("button", { name: /OpenRouter, conta op·1/ });
    expect(b.textContent).toMatch(/7,10/);
    expect(b.getAttribute("aria-label")).toMatch(/7,10.*restantes/);
    expect(b.textContent).not.toContain("0%");
  });
});

describe("topo: cota geral e popover", () => {
  it("chip mostra pior, folga e cobertura; clique abre o popover com janelas e baldes; Esc fecha", async () => {
    await montarComStore(<CotaGeralTopo />);
    const chip = screen.getByRole("button", { name: /Cota geral/ });
    expect(chip.textContent).toContain("pior trabalho 87% · folga 45% (2/3)");
    expect(chip.textContent).toContain("▲");
    await act(async () => { fireEvent.click(chip); });
    const dlg = screen.getByRole("dialog", { name: "Cotas e limites" });
    // provedor → conta → janelas e modelos
    expect(within(dlg).getByRole("region", { name: "Claude" })).toBeTruthy();
    expect(within(dlg).getByRole("region", { name: "Codex" })).toBeTruthy();
    expect(within(dlg).getAllByRole("meter", { name: /Claude, conta cl·1, janela de 5 horas, 62 por cento, reinicia em/ })).toHaveLength(1);
    const opus = within(dlg).getAllByRole("meter", { name: /Claude, conta cl·1, modelo Opus, 100 por cento/ });
    expect(opus).toHaveLength(1);
    expect(opus[0]!.closest(".uso-modelo")?.textContent).toContain("esgotado");
    expect(within(dlg).getByText("Pior caso", { exact: false })).toBeTruthy();
    expect(within(dlg).getAllByText("sem dado por modelo").length).toBeGreaterThan(0);
    await act(async () => { fireEvent.keyDown(dlg, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("atualizar chama o main; informar manualmente valida e grava", async () => {
    const limites = await montarComStore(<CotaGeralTopo />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Cota geral/ })); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Atualizar" })[0]!); });
    expect(limites.atualizar).toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Informar manualmente" })[0]!); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gravar" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/entre 0 e 100/);
    fireEvent.change(screen.getByLabelText("Uso %"), { target: { value: "40" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gravar" })); });
    expect(limites.definirManual).toHaveBeenCalledWith("c1", "five_hour", 40, null);
  });
  it("sem contas, o popover explica o próximo passo", async () => {
    await montarComStore(<CotaGeralTopo />, { contas: [], geral: { ...GERAL_FALSO, pior: null, folga_media_pct: null, cobertura: { com_dado: 0, total: 0 } } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Cota geral/ })); });
    expect(screen.getByText(/Nenhuma conta com limites/)).toBeTruthy();
  });
});

describe("toasts", () => {
  it("avisa, anuncia (alert para erro) e fecha", async () => {
    const store = criarStoreAvisos({ agendar: () => undefined });
    await act(async () => { render(<Avisos store={store} ligarHarness={false} />); });
    await act(async () => { store.avisar("Troca feita", "sucesso"); store.avisar("Falhou", "erro"); });
    expect(screen.getByRole("status").textContent).toContain("Troca feita");
    expect(screen.getByRole("alert").textContent).toContain("Falhou");
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Dispensar aviso" })[0]!); });
    expect(screen.queryByText("Troca feita")).toBeNull();
  });
  it("limita a 4 avisos", () => {
    const store = criarStoreAvisos({ agendar: () => undefined });
    for (let i = 0; i < 7; i++) store.avisar(`a${i}`);
    expect(store.obter()).toHaveLength(4);
    expect(store.obter()[3]?.texto).toBe("a6");
  });
});
void CONTAS_FALSAS;
