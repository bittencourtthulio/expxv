// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Mission } from "../../../compartilhado/dominio";
import { criarStoreProvedores } from "../../estado/provedores";
import { criarStoreSquads } from "../../estado/squads";
import { montarApi, squad } from "../squads/fabrica-teste";
import { CriarMissao } from "./Criar";

const rec = { prompt_inicial: true, retomar: true, mcp: true, hook: true };
const f = (id: string, nome: string) => ({ ferramenta: { id, nome, descricao: "", instalado: true, executavel_id: "e", modo_lancamento: null, erro_codigo: null, versao: "1", recursos: rec }, contas: [] }) as never;

async function montar(extra: { modoInicial?: "squad" | "livre"; invalida?: boolean } = {}) {
  const apiP = { listar: vi.fn().mockResolvedValue([f("claude", "Claude Code")]), criarConta: vi.fn(), habilitarConta: vi.fn(), diagnostico: vi.fn() };
  const provedores = criarStoreProvedores({ api: () => apiP });
  await provedores.carregar();
  const { api, store } = montarApi([squad("alfa"), squad("quebrada")], { resumos: [{}, { valida: false }] });
  const criar = vi.fn().mockResolvedValue({ id: "m1" } as Mission);
  const aoCriada = vi.fn();
  const aoCriadaPorSquad = vi.fn();
  const enviarParaSquad = vi.fn().mockResolvedValue({ execucao_id: "sqx_1234567890", mission_id: "m9", pane_id: "p9", avisos: [] });
  await act(async () => { render(<CriarMissao workspaceId="w1" criar={criar} aoFechar={() => undefined} aoCriada={aoCriada} provedores={provedores} squads={store} enviarParaSquad={enviarParaSquad} aoCriadaPorSquad={aoCriadaPorSquad} {...(extra.modoInicial === undefined ? {} : { modoInicial: extra.modoInicial })} />); });
  return { api, criar, aoCriada, aoCriadaPorSquad, enviarParaSquad };
}
async function escolherSquad(slug: string) {
  const sel = (await screen.findByLabelText("Squad")) as HTMLSelectElement;
  await vi.waitFor(() => expect([...sel.options].some((o) => o.value === slug)).toBe(true));
  fireEvent.change(sel, { target: { value: slug } });
}
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });

describe("Wizard de missão: seletor de squad (Fase 14)", () => {
  it("só aparece no modo squad e lista apenas squads válidas", async () => {
    const { api } = await montar();
    expect(screen.queryByLabelText("Squad")).toBeNull();
    await clicar(screen.getByRole("radio", { name: /Squad/ }));
    await vi.waitFor(() => expect(api.squads.listar).toHaveBeenCalled());
    const sel = (await screen.findByLabelText("Squad")) as HTMLSelectElement;
    const opcoes = [...sel.options].map((o) => o.textContent);
    expect(opcoes.some((o) => o?.includes("Squad alfa"))).toBe(true);
    expect(opcoes.some((o) => o?.includes("Squad quebrada"))).toBe(false);
  });

  it("modoInicial=squad (paleta) abre o wizard já nesse modo", async () => {
    await montar({ modoInicial: "squad" });
    expect((screen.getByRole("radio", { name: /Squad/ }) as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByLabelText("Squad")).toBeTruthy();
  });

  it("com squad escolhida: o perfil vem da squad (sem CLI por papel, sem título), mostra o resumo e envia o objetivo à squad", async () => {
    const { criar, enviarParaSquad, aoCriadaPorSquad } = await montar({ modoInicial: "squad" });
    await escolherSquad("alfa");
    expect(screen.getByRole("note").textContent).toMatch(/3 membros/);
    expect(screen.queryByLabelText("Título")).toBeNull();
    expect(screen.queryByLabelText(/Piloto/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Objetivo para a squad/), { target: { value: "Criar o login" } });
    await clicar(screen.getByRole("button", { name: "Enviar à squad" }));
    expect(enviarParaSquad).toHaveBeenCalledWith({ squad_slug: "alfa", objetivo: "Criar o login" });
    expect(aoCriadaPorSquad).toHaveBeenCalledWith("m9");
    expect(criar).not.toHaveBeenCalled();
  });

  it("com squad e objetivo vazio ou acima de 4000: recusa sem enviar", async () => {
    const { enviarParaSquad } = await montar({ modoInicial: "squad" });
    await escolherSquad("alfa");
    await clicar(screen.getByRole("button", { name: "Enviar à squad" }));
    expect(enviarParaSquad).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Objetivo para a squad/), { target: { value: "x".repeat(4001) } });
    await clicar(screen.getByRole("button", { name: "Enviar à squad" }));
    expect(enviarParaSquad).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("sem squad escolhida o comportamento do MVP continua (CLI por papel obrigatória)", async () => {
    const { criar } = await montar({ modoInicial: "squad" });
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "M" } });
    fireEvent.change(screen.getByLabelText("Pedido"), { target: { value: "x" } });
    await clicar(screen.getByRole("button", { name: "Criar missão" }));
    expect(screen.getByText(/exigem um piloto/)).toBeTruthy();
    expect(criar).not.toHaveBeenCalled();
  });
});
