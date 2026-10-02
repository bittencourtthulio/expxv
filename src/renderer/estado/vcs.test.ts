import { describe, expect, it, vi } from "vitest";
import { apiFalsa, estadoDe, mud } from "../telas/versionamento/teste-fixtures";
import { chaveAlvo, criarStoreVcs, textoResumo } from "./vcs";

const alvo = { workspace_id: "ws_1", mission_id: null };
const um = (): ReturnType<typeof estadoDe> => estadoDe([mud("a.ts", " ", "M")]);

describe("store do versionamento", () => {
  it("observar é contado por referência: liga uma vez, desliga ao soltar a última, assina eventos uma vez", async () => {
    const { api, mocks } = apiFalsa(um());
    const s = criarStoreVcs({ api: () => api });
    const a = s.observar(alvo);
    const b = s.observar(alvo);
    expect(mocks.observar).toHaveBeenCalledTimes(1);
    expect(mocks.assinar).toHaveBeenCalledTimes(1);
    a();
    expect(mocks.observar).toHaveBeenCalledTimes(1);
    b();
    expect(mocks.observar).toHaveBeenLastCalledWith(alvo, false);
    expect(s.observadas()).toBe(0);
    b(); // idempotente
    expect(mocks.observar).toHaveBeenCalledTimes(2);
  });
  it("vcs:mudou atualiza o resumo na hora (≤ 600 ms) e ignora árvore não observada", async () => {
    const e = um();
    const { api, emitir } = apiFalsa(e);
    const s = criarStoreVcs({ api: () => api });
    s.observar(alvo);
    await vi.waitFor(() => expect(s.obter().resumos[chaveAlvo(alvo)]).toBeTruthy());
    const t0 = performance.now();
    emitir({ ...alvo, mission_id: null, resumo: { ...e.resumo, branch: "outro", ahead: 3 } });
    expect(s.obter().resumos[chaveAlvo(alvo)]?.branch).toBe("outro");
    expect(performance.now() - t0).toBeLessThan(600);
    emitir({ workspace_id: "ws_x", mission_id: null, resumo: e.resumo });
    expect(s.obter().resumos[chaveAlvo({ workspace_id: "ws_x", mission_id: null })]).toBeUndefined();
  });
  it("sem repositório (tipo nenhum) o resumo é null: nada para decorar", async () => {
    const e = um();
    const { api } = apiFalsa(e, { observar: vi.fn().mockResolvedValue({ ...e.resumo, tipo: "nenhum" }) });
    const s = criarStoreVcs({ api: () => api });
    s.observar(alvo);
    await vi.waitFor(() => expect(chaveAlvo(alvo) in s.obter().resumos).toBe(true));
    expect(s.obter().resumos[chaveAlvo(alvo)]).toBeNull();
  });
  it("sem a ponte (fora do Electron) não faz nada", () => {
    const s = criarStoreVcs({ api: () => undefined });
    expect(() => s.observar(alvo)()).not.toThrow();
  });
  it("texto curto do resumo", () => {
    expect(textoResumo({ ...um().resumo, branch: "main", sujo: true, ahead: 2, behind: 1 })).toBe("main ● ↑2 ↓1");
  });
  it("atualizar refaz o resumo de uma árvore observada na hora (sem esperar o vcs:mudou) e ignora a não observada (D-691)", async () => {
    const e = um();
    const { api, mocks } = apiFalsa(e);
    const s = criarStoreVcs({ api: () => api });
    await s.atualizar(alvo);
    expect(mocks.estado).not.toHaveBeenCalled();
    s.observar(alvo);
    await vi.waitFor(() => expect(s.obter().resumos[chaveAlvo(alvo)]).toBeTruthy());
    mocks.estado.mockResolvedValueOnce({ ...e, resumo: { ...e.resumo, sujo: false, nao_staged: 0, ahead: 0 } });
    await s.atualizar(alvo);
    expect(s.obter().resumos[chaveAlvo(alvo)]).toMatchObject({ sujo: false, ahead: 0 });
    mocks.estado.mockRejectedValueOnce(new Error("x"));
    await expect(s.atualizar(alvo)).resolves.toBeUndefined();
  });
});
