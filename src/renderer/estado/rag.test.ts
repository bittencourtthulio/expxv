import { describe, expect, it, vi } from "vitest";
import type { EventoRag } from "../../compartilhado/rag";
import { PREVIA, ragFalso } from "../a11y/ade-falso-conhecimento";
import { criarStoreRag } from "./rag";

function montar(sobre: Parameters<typeof ragFalso>[0] = {}) {
  const api = ragFalso(sobre);
  let ouvinte: ((e: EventoRag) => void) | null = null;
  api.assinar = (cb) => { ouvinte = cb; return () => { ouvinte = null; }; };
  const avisar = vi.fn();
  const store = criarStoreRag({ api: () => api, avisar });
  return { api, store, avisar, emitir: (e: EventoRag) => ouvinte?.(e) };
}
const pedido = { provedor: "qdrant" as const, url: "https://q.exemplo.com", colecao_remota: "expxv", campos_secretos: { api_key: "SEGREDO-123" }, modo: "espelho" as const, tipos: ["doc" as const] };

describe("store do backend RAG", () => {
  it("o segredo passa ao main e NUNCA fica no estado do store", async () => {
    const configurar = vi.fn(async () => ({ ok: true, mascarado: { api_key: "••••1234" } }));
    const { store } = montar({ configurar });
    await store.definirWorkspace("w1");
    await store.configurar(pedido);
    expect(configurar).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "w1", campos_secretos: { api_key: "SEGREDO-123" } }));
    expect(JSON.stringify(store.obter())).not.toContain("SEGREDO-123");
    await store.testar(pedido);
    expect(JSON.stringify(store.obter())).not.toContain("SEGREDO-123");
  });

  it("migração só começa depois do consentimento; sem prévia ou sem pedir consentimento não envia nada", async () => {
    const iniciarMigracao = vi.fn(async () => ({ migracao_id: "mg1" }));
    const { store } = montar({ iniciarMigracao });
    await store.definirWorkspace("w1");
    expect(await store.consentirEIniciar()).toBe(false);
    await store.gerarPrevia(["doc"]);
    expect(store.obter().maquina.etapa).toBe("previa");
    expect(await store.consentirEIniciar()).toBe(false); // ainda não pediu o consentimento
    expect(iniciarMigracao).not.toHaveBeenCalled();
    store.pedirConsentimento();
    expect(await store.consentirEIniciar()).toBe(true);
    expect(iniciarMigracao).toHaveBeenCalledWith({ workspace_id: "w1", previa_id: PREVIA.previa_id, consentimento: { provedor: "qdrant", host: "qdrant.exemplo.com", colecao: "conhecimento_projeto", versao_politica: 1 } });
    expect(store.obter().maquina.etapa).toBe("migrando");
  });

  it("progresso por evento move a máquina até concluir e só vale para a migração atual", async () => {
    const { store, emitir } = montar();
    store.iniciar();
    await store.definirWorkspace("w1");
    await store.gerarPrevia(["doc"]);
    store.pedirConsentimento();
    await store.consentirEIniciar();
    emitir({ canal: "rag:migracao_progresso", payload: { migracao_id: "outra", estado: "concluida", enviados: 9, total: 9 } });
    expect(store.obter().maquina.etapa).toBe("migrando");
    emitir({ canal: "rag:migracao_progresso", payload: { migracao_id: "mg1", estado: "enviando", enviados: 5, total: 10 } });
    expect(store.obter().maquina).toMatchObject({ etapa: "migrando", enviados: 5, total: 10 });
    emitir({ canal: "rag:migracao_progresso", payload: { migracao_id: "mg1", estado: "concluida", enviados: 10, total: 10 } });
    expect(store.obter().maquina.etapa).toBe("concluida");
  });

  it("falha ao iniciar volta o assistente ao início; aviso offline vira estado e toast", async () => {
    const { store, avisar, emitir } = montar({ iniciarMigracao: async () => { throw new Error("recusado"); } });
    store.iniciar();
    await store.definirWorkspace("w1");
    await store.gerarPrevia(["doc"]);
    store.pedirConsentimento();
    expect(await store.consentirEIniciar()).toBe(false);
    expect(store.obter().maquina.etapa).toBe("inicio");
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("recusado"), "erro");
    emitir({ canal: "rag:aviso", payload: { codigo: "offline", mensagem: "sem rede" } });
    expect(store.obter().avisoRag).toBe("sem rede");
  });

  it("apagar remoto e voltar para local chamam o main com os argumentos certos", async () => {
    const apagarRemoto = vi.fn(async () => ({ apagados: 3 as number | "desconhecido" }));
    const voltarParaLocal = vi.fn(async () => ({ ok: true }));
    const { store } = montar({ apagarRemoto, voltarParaLocal });
    await store.definirWorkspace("w1");
    await store.apagarRemoto("conhecimento_projeto");
    expect(apagarRemoto).toHaveBeenCalledWith("w1", "conhecimento_projeto");
    await store.voltarParaLocal(true);
    expect(voltarParaLocal).toHaveBeenCalledWith("w1", true);
  });
});
