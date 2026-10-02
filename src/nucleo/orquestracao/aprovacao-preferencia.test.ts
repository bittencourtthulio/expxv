import { describe, expect, it } from "vitest";
import { ErroAprovacaoWorkers, aprovacaoEfetivaDoWorkspace, definirAprovacaoWorkers, lerAprovacaoWorkers, type PortaConfigAprovacao } from "./aprovacao-preferencia";

const porta = (): PortaConfigAprovacao & { dados: Map<string, unknown> } => {
  const dados = new Map<string, unknown>();
  return { dados, obter: <T>(c: string) => dados.get(c) as T | undefined, definir: (c, v) => void dados.set(c, v), remover: (c) => void dados.delete(c) };
};

describe("preferências da aprovação dos workers (D-640)", () => {
  it("sem nada gravado vale o padrão global automatico_seguro (novos e existentes)", () => {
    const c = porta();
    expect(lerAprovacaoWorkers(c, null)).toMatchObject({ nivel: "automatico_seguro", padrao_global: "automatico_seguro" });
    expect(lerAprovacaoWorkers(c, "ws_1")).toMatchObject({ nivel: "automatico_seguro", proprio: false, permitir_raiz: false, confiavel: true });
    expect(aprovacaoEfetivaDoWorkspace(c, "ws_1")).toEqual({ nivel: "automatico_seguro", totalConfirmado: false, permitirNaRaiz: false, projetoConfiavel: true });
  });
  it("valor corrompido ou nível desconhecido volta ao padrão seguro, nunca ao total", () => {
    const c = porta();
    c.dados.set("orquestracao.aprovacao_workers.global", { nivel: "bypass", total_confirmado: true });
    c.dados.set("orquestracao.aprovacao_workers.ws.ws_1", "lixo");
    expect(lerAprovacaoWorkers(c, "ws_1").nivel).toBe("automatico_seguro");
    c.dados.set("orquestracao.aprovacao_workers.global", { nivel: "total" });
    expect(aprovacaoEfetivaDoWorkspace(c, "ws_1")).toMatchObject({ nivel: "total", totalConfirmado: false });
  });
  it("total exige a palavra digitada e não grava nada sem ela", () => {
    const c = porta();
    for (const confirmacao of [undefined, "", "liberar", "sim"]) {
      expect(() => definirAprovacaoWorkers(c, { workspace_id: "ws_1", nivel: "total", ...(confirmacao === undefined ? {} : { confirmacao }) })).toThrow(ErroAprovacaoWorkers);
    }
    expect(c.dados.size).toBe(0);
    definirAprovacaoWorkers(c, { workspace_id: "ws_1", nivel: "total", confirmacao: " Liberar Tudo " });
    expect(aprovacaoEfetivaDoWorkspace(c, "ws_1")).toMatchObject({ nivel: "total", totalConfirmado: true });
  });
  it("a confirmação some quando o nível deixa de ser total e voltar a total pede de novo", () => {
    const c = porta();
    definirAprovacaoWorkers(c, { workspace_id: "ws_1", nivel: "total", confirmacao: "liberar tudo" });
    definirAprovacaoWorkers(c, { workspace_id: "ws_1", nivel: "automatico_seguro" });
    expect(c.dados.get("orquestracao.aprovacao_workers.ws.ws_1")).not.toHaveProperty("total_confirmado");
    expect(() => definirAprovacaoWorkers(c, { workspace_id: "ws_1", nivel: "total" })).toThrow();
  });
  it("global em total vale para quem herda, com a confirmação do global", () => {
    const c = porta();
    definirAprovacaoWorkers(c, { workspace_id: null, nivel: "total", confirmacao: "liberar tudo" });
    expect(aprovacaoEfetivaDoWorkspace(c, "ws_9")).toMatchObject({ nivel: "total", totalConfirmado: true });
  });
  it("raiz e confiança só por workspace; herdar limpa o nível próprio mas mantém raiz/confiança", () => {
    const c = porta();
    expect(() => definirAprovacaoWorkers(c, { workspace_id: null, permitir_raiz: true })).toThrow(ErroAprovacaoWorkers);
    expect(() => definirAprovacaoWorkers(c, { workspace_id: null, confiavel: false })).toThrow(ErroAprovacaoWorkers);
    definirAprovacaoWorkers(c, { workspace_id: "ws_1", nivel: "perguntar", permitir_raiz: true, confiavel: false });
    expect(lerAprovacaoWorkers(c, "ws_1")).toMatchObject({ nivel: "perguntar", proprio: true, permitir_raiz: true, confiavel: false });
    definirAprovacaoWorkers(c, { workspace_id: "ws_1", herdar: true });
    expect(lerAprovacaoWorkers(c, "ws_1")).toMatchObject({ nivel: "automatico_seguro", proprio: false, permitir_raiz: true, confiavel: false });
  });
  it("um workspace não afeta o outro", () => {
    const c = porta();
    definirAprovacaoWorkers(c, { workspace_id: "ws_1", nivel: "perguntar" });
    expect(lerAprovacaoWorkers(c, "ws_2").nivel).toBe("automatico_seguro");
  });
});
