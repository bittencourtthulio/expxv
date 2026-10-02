// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetalheMissao } from "../../../compartilhado/dominio";
import type { ApiMemoria } from "../../../compartilhado/memoria";
import { detalhe, missao } from "../../a11y/ade-falso";
import { ESTADO_MEMORIA, entrada, memoriaFalso } from "../../a11y/ade-falso-memoria";
import { instalar, remover } from "../../a11y/ade-falso";
import { criarStoreMemoria } from "../../estado/memoria";
import { MemoriaMissao } from "./MemoriaMissao";

beforeEach(() => { instalar(); });
afterEach(() => { cleanup(); remover(); });

const agentica = (extra: Partial<DetalheMissao["mission"]> = {}): DetalheMissao => ({ ...detalhe, mission: { ...missao, modo: "agentico", ...extra } });
async function montar(d: DetalheMissao, sobre: Partial<ApiMemoria> = {}) {
  const api = memoriaFalso(sobre);
  (globalThis as unknown as { ade: { memoria: ApiMemoria } }).ade.memoria = api;
  const store = criarStoreMemoria({ api: () => api, avisar: () => undefined, quadro: (f) => f() });
  await act(async () => { render(<MemoriaMissao detalhe={d} store={store} />); });
  return { api, store };
}

describe("Memória no card da Missão (discreta)", () => {
  it("Missão livre não mostra nada", async () => {
    await montar({ ...detalhe, mission: { ...missao, modo: "livre" } });
    expect(screen.queryByRole("region", { name: "Memória da missão" })).toBeNull();
  });

  it("chave por Missão: herdar / ligada / desligada vai ao canal (null herda)", async () => {
    const definirMissao = vi.fn(async (id: string, ativa: boolean | null) => ({ mission_id: id, ativa }));
    await montar(agentica(), { definirMissao });
    const sel = await screen.findByLabelText("Memória nesta missão");
    expect((sel as HTMLSelectElement).value).toBe("herdar");
    await act(async () => { fireEvent.change(sel, { target: { value: "desligada" } }); });
    expect(definirMissao).toHaveBeenCalledWith("m1", false);
    await act(async () => { fireEvent.change(sel, { target: { value: "herdar" } }); });
    expect(definirMissao).toHaveBeenLastCalledWith("m1", null);
  });

  it("valor explícito do estado aparece selecionado; chave geral desligada é dita", async () => {
    await montar(agentica(), { estado: async () => ({ ...ESTADO_MEMORIA, missoes: { m1: true }, config: { ...ESTADO_MEMORIA.config, global_ativa: false } }) });
    expect(((await screen.findByLabelText("Memória nesta missão")) as HTMLSelectElement).value).toBe("ligada");
    expect(screen.getByText(/Desligada neste computador/)).toBeTruthy();
  });

  it("Missão agêntica ativa informa o pacote entregue ao piloto", async () => {
    await montar(agentica());
    expect(await screen.findByText(/recebeu o pacote da memória do projeto/)).toBeTruthy();
  });

  it("Missão terminal sem aprendizado do piloto mostra no_learning_recorded (e diz se o sistema resumiu)", async () => {
    const listar = vi.fn(async () => ({ itens: [entrada("mem_sis", { tipo: "aprendizado", fonte: "sistema" })], proximo: null }));
    await montar(agentica({ estado: "concluida" }), { listar });
    const aviso = await screen.findByText(/no_learning_recorded/);
    expect(aviso.parentElement?.textContent).toMatch(/gravou um resumo automático/);
    expect(listar).toHaveBeenCalledWith(expect.objectContaining({ mission_id: "m1", tipos: ["aprendizado"] }));
  });

  it("com aprendizado do agente não há aviso; Missão ativa não consulta", async () => {
    const listar = vi.fn(async () => ({ itens: [entrada("mem_ag", { tipo: "aprendizado", fonte: "agente" })], proximo: null }));
    await montar(agentica({ estado: "concluida" }), { listar });
    await screen.findByLabelText("Memória nesta missão");
    expect(screen.queryByText(/no_learning_recorded/)).toBeNull();
    cleanup();
    const listar2 = vi.fn(async () => ({ itens: [], proximo: null }));
    await montar(agentica(), { listar: listar2 });
    await screen.findByLabelText("Memória nesta missão");
    expect(listar2).not.toHaveBeenCalled();
  });

  it("brief usado: Panes reabertos listam o tamanho do brief entregue", async () => {
    const d = agentica();
    d.panes = [...d.panes, { ...d.panes[0]!, id: "p5", display_id: 5, respawn_de: "p1", eh_piloto: false }];
    const { eventosMemoria } = await import("../../estado/memoria-eventos");
    let emitir: (e: never) => void = () => undefined;
    (globalThis as unknown as { ade: { memoria: ApiMemoria } }).ade.memoria = memoriaFalso({ assinar: (cb) => { emitir = cb as never; return () => undefined; } });
    const off = eventosMemoria.ligar();
    await act(async () => { emitir({ canal: "memoria:brief_montado", payload: { pane_id: "p1", caracteres: 3100, truncado: false } } as never); });
    await montar(d, { assinar: () => () => undefined });
    expect(await screen.findByText(/Painel #5: brief de 3100 caracteres/)).toBeTruthy();
    off();
  });
});
