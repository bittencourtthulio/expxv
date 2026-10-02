import { describe, expect, it, vi } from "vitest";
import type { EventoChat } from "../../compartilhado/chat";
import { chatFalso, mensagem } from "../a11y/ade-falso-conhecimento";
import { criarStoreChat } from "./chat";

function montar(sobre: Parameters<typeof chatFalso>[0] = {}) {
  const api = chatFalso(sobre);
  const fila: Array<() => void> = [];
  const avisar = vi.fn();
  const store = criarStoreChat({ api: () => api, avisar, quadro: (f) => fila.push(f) });
  store.iniciar();
  return { api, store, avisar, quadros: () => { while (fila.length > 0) fila.shift()?.(); }, emitir: (e: EventoChat) => api.emitir(e) };
}
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

describe("store do chat", () => {
  it("abre a conversa mais recente ao trocar de workspace e carrega o perfil", async () => {
    const { store } = montar();
    await store.definirWorkspace("w1");
    expect(store.obter().atualId).toBe("cv1");
    expect(store.obter().mensagens).toHaveLength(2);
    expect(store.obter().perfil?.perfil?.cli).toBe("claude");
  });

  it("tokens são coalescidos: N eventos, UMA aplicação por quadro; a mensagem completa substitui o parcial", async () => {
    const { store, emitir, quadros } = montar();
    await store.definirWorkspace("w1");
    emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem("m9", { texto: "", estado: "transmitindo" }) } });
    const antes = store.obter().mensagens;
    for (const d of ["Ol", "á", ", ", "mundo"]) emitir({ canal: "chat:token", payload: { mensagem_id: "m9", delta: d } });
    expect(store.obter().mensagens).toBe(antes); // nada mudou antes do quadro
    expect(store.obter().transmitindoId).toBe("m9");
    quadros();
    expect(store.obter().mensagens.find((m) => m.id === "m9")?.texto).toBe("Olá, mundo");
    emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem("m9", { texto: "Olá, mundo!", estado: "completa" }) } });
    expect(store.obter().mensagens.find((m) => m.id === "m9")?.texto).toBe("Olá, mundo!");
    expect(store.obter().transmitindoId).toBeNull();
  });

  it("mensagem de outra conversa é ignorada", async () => {
    const { store, emitir } = montar();
    await store.definirWorkspace("w1");
    emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem("mx", { conversa_id: "outra" }) } });
    expect(store.obter().mensagens.some((m) => m.id === "mx")).toBe(false);
  });

  it("enviar no modo orquestrar: mensagem otimista, plano chega por evento e o envio termina", async () => {
    const { store, api } = montar();
    const enviar = vi.spyOn(api, "enviar");
    await store.definirWorkspace("w1");
    store.definirModo("orquestrar");
    expect(await store.enviar("preciso implementar X")).toBe(true);
    expect(enviar).toHaveBeenCalledWith({ conversa_id: "cv1", texto: "preciso implementar X", modo: "orquestrar", mission_alvo_id: null });
    await tick();
    expect(store.obter().planos).toHaveLength(1);
    expect(store.obter().planos[0]?.estado).toBe("proposto");
    expect(store.obter().enviando).toBe(false);
    expect(store.obter().mensagens.some((m) => m.papel === "usuario" && m.texto === "preciso implementar X")).toBe(true);
  });

  it("texto vazio ou acima de 8000 não envia; sem conversa cria uma", async () => {
    const enviar = vi.fn(chatFalso().enviar);
    const { store } = montar({ enviar, listarConversas: async () => [] });
    await store.definirWorkspace("w1");
    expect(await store.enviar("   ")).toBe(false);
    expect(await store.enviar("a".repeat(8001))).toBe(false);
    expect(enviar).not.toHaveBeenCalled();
    expect(await store.enviar("oi")).toBe(true);
    expect(store.obter().atualId).toBe("cv-novo");
  });

  it("falha no envio remove a mensagem otimista e avisa", async () => {
    const { store, avisar } = montar({ enviar: async () => { throw new Error("CLI sumiu"); } });
    await store.definirWorkspace("w1");
    expect(await store.enviar("oi")).toBe(false);
    expect(store.obter().mensagens.some((m) => m.texto === "oi")).toBe(false);
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("CLI sumiu"), "erro");
    expect(store.obter().enviando).toBe(false);
  });

  it("progresso por terminal é mantido por plano; decidir plano atualiza o cartão; apagar a atual abre a próxima", async () => {
    const { store, emitir } = montar();
    await store.definirWorkspace("w1");
    emitir({ canal: "chat:plano", payload: { plano: { ...(await import("../a11y/ade-falso-conhecimento")).PLANO } } });
    emitir({ canal: "chat:progresso", payload: { plano_id: "pl1", pane_id: "p1", estado: "executando", resumo: "abrindo" } });
    emitir({ canal: "chat:progresso", payload: { plano_id: "pl1", pane_id: "p1", estado: "concluido", resumo: "pronto" } });
    expect(store.obter().progresso["pl1"]).toHaveLength(1);
    expect(store.obter().progresso["pl1"]?.[0]?.estado).toBe("concluido");
    await store.decidirPlano({ plano_id: "pl1", decisao: "aprovar" });
    expect(store.obter().planos[0]?.estado).toBe("aprovado");
    await store.apagarConversa("cv1");
    expect(store.obter().atualId).toBeNull();
  });
});
