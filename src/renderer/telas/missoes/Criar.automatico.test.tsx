// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProvedorInfo } from "../../../compartilhado/dominio";
import { criarStoreProvedores } from "../../estado/provedores";
import { criarStoreSquads } from "../../estado/squads";
import { CriarMissao } from "./Criar";

const rec = { prompt_inicial: true, retomar: true, mcp: true, hook: true };
const claude: ProvedorInfo = { ferramenta: { id: "claude", nome: "Claude Code", descricao: "CLI", instalado: true, executavel_id: "e", modo_lancamento: "direto", erro_codigo: null, versao: "2", recursos: rec }, contas: [] };
const rotaOk = { executor: { provider: "claude", cli: "claude", model: "sonnet", effort: null, faixa: "medio" }, conta_id: "c1", task_type: "bug-fix", decisoes: [], fontes: { task_type: "heuristica", executor: "regra", conta: "regra" }, recibo: "conta cl·1 reseta antes", avisos: [], skills_aplicadas: false };

afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; });

async function montar(harness: unknown) {
  if (harness !== undefined) (globalThis as { ade?: unknown }).ade = { harness };
  const criar = vi.fn().mockResolvedValue({ id: "m1" });
  const store = criarStoreProvedores({ api: () => ({ listar: vi.fn().mockResolvedValue([claude]) }) as never });
  await act(async () => { render(<CriarMissao workspaceId="w1" criar={criar} aoFechar={() => undefined} aoCriada={() => undefined} provedores={store} squads={criarStoreSquads({ squads: () => undefined, agentes: () => undefined })} />); });
  return criar;
}

describe("Wizard: Automático (harness)", () => {
  it("com o harness ligado: escolher Automático mostra a rota prevista e o recibo, e cria com cli 'auto'", async () => {
    const resolverPerfil = vi.fn().mockResolvedValue(rotaOk);
    const criar = await montar({ resolverPerfil });
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Pedido"), { target: { value: "arrumar botão" } });
    await act(async () => { fireEvent.change(screen.getByLabelText(/^CLI/), { target: { value: "auto" } }); });
    const nota = await screen.findByRole("note", { name: /Rota prevista/ });
    await waitFor(() => expect(nota.textContent).toMatch(/claude · sonnet · faixa medio · conta c1/));
    expect(nota.textContent).toMatch(/Recibo: conta cl·1 reseta antes/);
    expect(resolverPerfil).toHaveBeenCalledWith({ perfil: expect.objectContaining({ cli: "auto" }), ctx: { workspace_id: "w1", papel: "nenhum", mission_id: null } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar missão" })); });
    expect(criar).toHaveBeenCalledWith(expect.objectContaining({ clis: { nenhum: "auto" } }));
  });
  it("sem harness (canal ausente): a opção fica desabilitada como indisponível", async () => {
    await montar(undefined);
    const op = screen.getByRole("option", { name: /Automático \(harness\) \(indisponível\)/ }) as HTMLOptionElement;
    expect(op.disabled).toBe(true);
  });
  it("prévia que falha por canal ausente mantém o estado 'indisponível' sem bloquear a criação", async () => {
    const criar = await montar({ resolverPerfil: vi.fn().mockRejectedValue(new Error("No handler registered for 'harness:resolver_perfil'")) });
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Pedido"), { target: { value: "p" } });
    await act(async () => { fireEvent.change(screen.getByLabelText(/^CLI/), { target: { value: "auto" } }); });
    expect((await screen.findByRole("note", { name: /Rota prevista/ })).textContent).toMatch(/indisponível/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar missão" })); });
    expect(criar).toHaveBeenCalled();
  });
  it("erro de capacidade aparece em texto", async () => {
    await montar({ resolverPerfil: vi.fn().mockRejectedValue(new Error("no_capacity: x")) });
    await act(async () => { fireEvent.change(screen.getByLabelText(/^CLI/), { target: { value: "auto" } }); });
    expect((await screen.findByRole("note", { name: /Rota prevista/ })).textContent).toMatch(/Sem capacidade/);
  });
});
