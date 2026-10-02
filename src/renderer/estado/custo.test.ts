import { describe, expect, it, vi } from "vitest";
import type { CustoResumo, EventoCusto } from "../../compartilhado/custo";
import { criarStoreCusto } from "./custo";

const resumo = (usd: number | null): CustoResumo => ({ usd, incompleto: false, aproximado: false, tokens: { entrada: 1, cache_escrita: 0, cache_leitura: 0, saida: 1 }, registros: 1, modelos: [], fontes_ausentes: [], atualizado_em: null });
const montar = () => {
  let cb: (e: EventoCusto) => void = () => undefined;
  const cancelar = vi.fn();
  let n = 0;
  const api = { resumo: vi.fn(async () => resumo(++n)), assinar: vi.fn((f: (e: EventoCusto) => void) => { cb = f; return cancelar; }) };
  const store = criarStoreCusto({ api: () => api as never });
  return { api, store, emitir: (e: EventoCusto) => cb(e), cancelar };
};
const espera = () => new Promise((r) => setTimeout(r, 0));

describe("store de custo", () => {
  it("carrega ao usar, refaz só o escopo visível do evento e libera ao sair", async () => {
    const { api, store, emitir, cancelar } = montar();
    const solta = store.usar("card", "w|t|T-1");
    await espera();
    expect(store.obter("card", "w|t|T-1").resumo?.usd).toBe(1);
    emitir({ tipo: "atualizado", escopos: [{ escopo: "card", chave: "outro" }] });
    await espera();
    expect(api.resumo).toHaveBeenCalledTimes(1);
    emitir({ tipo: "atualizado", escopos: [{ escopo: "card", chave: "w|t|T-1" }, { escopo: "card", chave: "w|t|T-1" }] });
    await espera();
    expect(api.resumo).toHaveBeenCalledTimes(2);
    solta();
    expect(store.tamanho()).toBe(0);
    expect(cancelar).toHaveBeenCalled();
  });
  it("limpar descarta e ignora resposta atrasada de outro workspace", async () => {
    const { store } = montar();
    store.usar("workspace", "w1");
    store.limpar();
    await espera();
    expect(store.obter("workspace", "w1").resumo).toBeNull();
  });
  it("erro mantém o último valor e informa; alertas de teto ficam registrados", async () => {
    const { api, store, emitir } = montar();
    store.usar("missao", "m1");
    await espera();
    api.resumo.mockRejectedValueOnce(new Error("falhou"));
    await store.recarregar("missao", "m1");
    expect(store.obter("missao", "m1").erro).toBe("falhou");
    expect(store.obter("missao", "m1").resumo?.usd).toBe(1);
    emitir({ tipo: "teto", mission_id: "m1", usd: 5, teto_usd: 4 });
    expect(store.alertas()).toHaveLength(1);
  });
});
