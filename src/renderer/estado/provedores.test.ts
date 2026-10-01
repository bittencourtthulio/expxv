import { describe, expect, it, vi } from "vitest";
import type { ProvedorInfo } from "../../compartilhado/dominio";
import { criarStoreProvedores } from "./provedores";

const info = (id: string): ProvedorInfo => ({ ferramenta: { id, nome: id, descricao: "", instalado: true, executavel_id: "e", modo_lancamento: "direto", erro_codigo: null, versao: "1", recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true } } as ProvedorInfo["ferramenta"], contas: [] });
const conta = { id: "c1", provedor: "claude", rotulo: "pessoal", config_dir_ref: null, habilitada: true, criado_em: "x", atualizado_em: "x" };

describe("store de provedores", () => {
  it("chamadas simultâneas de carregar viram uma só e 'forcar' chega ao main", async () => {
    const api = { listar: vi.fn().mockResolvedValue([info("claude")]), criarConta: vi.fn(), habilitarConta: vi.fn(), diagnostico: vi.fn() };
    const s = criarStoreProvedores({ api: () => api });
    await Promise.all([s.carregar(), s.carregar()]);
    expect(api.listar).toHaveBeenCalledTimes(1);
    await s.carregar(true);
    expect(api.listar).toHaveBeenLastCalledWith(true);
  });
  it("criar e habilitar conta atualizam a lista local", async () => {
    const api = { listar: vi.fn().mockResolvedValue([info("claude")]), criarConta: vi.fn().mockResolvedValue(conta), habilitarConta: vi.fn().mockResolvedValue({ ...conta, habilitada: false }), diagnostico: vi.fn() };
    const s = criarStoreProvedores({ api: () => api });
    await s.carregar();
    await s.criarConta("claude", "pessoal");
    expect(s.obter().lista?.[0]?.contas).toHaveLength(1);
    await s.habilitarConta("c1", false);
    expect(s.obter().lista?.[0]?.contas[0]?.habilitada).toBe(false);
  });
  it("erro de detecção vira mensagem e a lista fica vazia (não nula)", async () => {
    const api = { listar: vi.fn().mockRejectedValue(new Error("boom")), criarConta: vi.fn(), habilitarConta: vi.fn(), diagnostico: vi.fn() };
    const s = criarStoreProvedores({ api: () => api });
    await s.carregar();
    expect(s.obter().erro).toContain("boom");
    expect(s.obter().lista).toEqual([]);
  });
});
