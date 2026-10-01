import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiAde } from "../../compartilhado/ipc";
import type { IndiceProjeto } from "../../nucleo/metodo/tipos";
import { criarStoreMetodo } from "./metodo";

const indice = (raiz: string): IndiceProjeto => ({
  raiz, gerado_em: "2026-01-01T00:00:00Z", duracao_ms: 1, trabalhos: [], violacoes: [], rejeicoes: [], avisos: [],
  camadas: { convencoes: false, perfil_legado: false, design_system: false, produto: false, hooks: false, lock: false, memoria: false },
  artefatos_lidos: 0,
});

function falso(atual: string | null = "w1") {
  let cbMetodo: ((e: { workspace_id: string; trabalhos: number; violacoes: number; gerado_em: string }) => void) | null = null;
  let cbWs: ((e: { atual: { id: string } | null; recentes: [] }) => void) | null = null;
  const estado = vi.fn(async (id: string) => indice(id));
  const assinarMetodo = vi.fn((cb: typeof cbMetodo) => { cbMetodo = cb; return () => { cbMetodo = null; }; });
  const assinarWs = vi.fn((cb: typeof cbWs) => { cbWs = cb; return () => { cbWs = null; }; });
  const api = {
    metodo: { estado, assinar: assinarMetodo },
    workspaces: { estado: async () => ({ atual: atual ? { id: atual } : null, recentes: [] }), assinar: assinarWs },
  } as unknown as ApiAde;
  return {
    api, estado, assinarMetodo,
    emitir: (ws = "w1") => cbMetodo?.({ workspace_id: ws, trabalhos: 1, violacoes: 0, gerado_em: "x" }),
    trocar: (id: string | null) => cbWs?.({ atual: id ? { id } : null, recentes: [] }),
  };
}

describe("store do Método", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("abre sem bloquear, lê o workspace atual e usa uma só assinatura", async () => {
    const f = falso();
    const s = criarStoreMetodo({ api: () => f.api, atrasoMs: 50 });
    expect(s.obter().carregado).toBe(false);
    const a = s.iniciar();
    const b = s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.assinarMetodo).toHaveBeenCalledTimes(1);
    expect(s.obter().indice?.raiz).toBe("w1");
    expect(s.obter().carregado).toBe(true);
    a(); b();
  });

  it("coalesce rajadas de eventos em uma releitura", async () => {
    const f = falso();
    const s = criarStoreMetodo({ api: () => f.api, atrasoMs: 50 });
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    f.estado.mockClear();
    for (let i = 0; i < 10; i++) f.emitir();
    f.emitir("outro");
    await vi.advanceTimersByTimeAsync(60);
    expect(f.estado).toHaveBeenCalledTimes(1);
  });

  it("troca de workspace descarta resposta antiga e desligar cancela a assinatura", async () => {
    const f = falso();
    const s = criarStoreMetodo({ api: () => f.api, atrasoMs: 50 });
    const parar = s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    f.trocar("w2");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.obter().workspaceId).toBe("w2");
    expect(s.obter().indice?.raiz).toBe("w2");
    f.trocar(null);
    expect(s.obter()).toMatchObject({ workspaceId: null, indice: null, carregado: true });
    parar();
    f.estado.mockClear();
    f.emitir();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.estado).not.toHaveBeenCalled();
  });

  it("sem API (fora do Electron) fica carregado e vazio", () => {
    const s = criarStoreMetodo({ api: () => undefined });
    s.iniciar();
    expect(s.obter()).toMatchObject({ carregado: true, indice: null });
  });
});
