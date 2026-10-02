// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Mission } from "../../../compartilhado/dominio";
import { criarStoreProvedores } from "../../estado/provedores";
import { montarApi, squad } from "../squads/fabrica-teste";
import { CriarMissao } from "./Criar";
import { montarPedido, tituloDoObjetivo } from "./validar";

const rec = { prompt_inicial: true, retomar: true, mcp: true, hook: true };
const f = (id: string, nome: string) => ({ ferramenta: { id, nome, descricao: "", instalado: true, executavel_id: "e", modo_lancamento: null, erro_codigo: null, versao: "1", recursos: rec }, contas: [] }) as never;

async function montar(modoInicial: "squad" | "agentico") {
  const apiP = { listar: vi.fn().mockResolvedValue([f("claude", "Claude Code"), f("codex", "Codex")]), criarConta: vi.fn(), habilitarConta: vi.fn(), diagnostico: vi.fn() };
  const provedores = criarStoreProvedores({ api: () => apiP });
  await provedores.carregar();
  const { store } = montarApi([squad("alfa")]);
  const criar = vi.fn().mockResolvedValue({ id: "m1" } as Mission);
  const enviarParaSquad = vi.fn().mockResolvedValue({ execucao_id: "sqx_1234567890", mission_id: "m9", pane_id: "p9", avisos: [] });
  await act(async () => { render(<CriarMissao workspaceId="w1" criar={criar} aoFechar={() => undefined} aoCriada={() => undefined} provedores={provedores} squads={store} enviarParaSquad={enviarParaSquad} modoInicial={modoInicial} />); });
  const sel = (await screen.findByLabelText("Squad")) as HTMLSelectElement;
  await vi.waitFor(() => expect([...sel.options].some((o) => o.value === "alfa")).toBe(true));
  await act(async () => { fireEvent.change(sel, { target: { value: "alfa" } }); });
  return { criar, enviarParaSquad };
}
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });

describe("montarPedido com squad", () => {
  it("leva squad_id e squad_cli só fora do modo livre", () => {
    const base = { origem: "livre" as const, titulo: "t", pedido: "p", clis: {}, cadeado: false };
    expect(montarPedido({ ...base, modo: "agentico", squad_id: "alfa", squad_cli: "codex" }, "w")).toMatchObject({ squad_id: "alfa", squad_cli: "codex" });
    const livre = montarPedido({ ...base, modo: "livre", clis: { nenhum: "claude" }, squad_id: "alfa", squad_cli: "codex" }, "w");
    expect(livre.squad_id).toBeUndefined();
    expect(livre.squad_cli).toBeUndefined();
    expect(tituloDoObjetivo("\n  Criar login\nmais")).toBe("Criar login");
  });
});

describe("Wizard: perfil por membro e cadeado (T-14.25)", () => {
  it("mostra uma linha por membro (somente leitura) e o aviso do cadeado", async () => {
    await montar("squad");
    const lista = screen.getByRole("list", { name: "Membros da squad" });
    expect(lista.querySelectorAll("li").length).toBe(3);
    expect(lista.textContent).toMatch(/Orq/);
    expect(lista.textContent).toMatch(/codex/);
    expect(screen.getByRole("note", { name: "Aviso do cadeado" }).textContent).toMatch(/voltam ao padrão/);
    expect(screen.getByRole("note", { name: "Aviso do cadeado" }).textContent).toMatch(/orquestrador mantém/);
  });

  it("modo squad com cadeado cria pela Missão (squad_id + squad_cli) em vez da caixa de prompt", async () => {
    const { criar, enviarParaSquad } = await montar("squad");
    await act(async () => { fireEvent.change(screen.getByLabelText("Mesma CLI para todos (cadeado)"), { target: { value: "codex" } }); });
    fireEvent.change(screen.getByLabelText(/Objetivo para a squad/), { target: { value: "Criar o login\ncom testes" } });
    await clicar(screen.getByRole("button", { name: "Enviar à squad" }));
    expect(enviarParaSquad).not.toHaveBeenCalled();
    expect(criar).toHaveBeenCalledWith(expect.objectContaining({ modo: "squad", squad_id: "alfa", squad_cli: "codex", titulo: "Criar o login" }));
  });

  it("agêntico: squad opcional; sem squad segue o MVP, com squad não exige CLI de piloto", async () => {
    const { criar } = await montar("agentico");
    expect(screen.queryByLabelText(/Piloto/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Objetivo para a squad/), { target: { value: "Refatorar" } });
    await clicar(screen.getByRole("button", { name: "Enviar à squad" }));
    expect(criar).toHaveBeenCalledWith(expect.objectContaining({ modo: "agentico", squad_id: "alfa", titulo: "Refatorar" }));
    expect((criar.mock.calls[0]![0] as { squad_cli?: string }).squad_cli).toBeUndefined();
  });
});
