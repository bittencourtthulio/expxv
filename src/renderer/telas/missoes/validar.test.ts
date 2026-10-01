import { describe, expect, it } from "vitest";
import { aplicarCli, montarPedido, validar, type FormMissao } from "./validar";

const base: FormMissao = { modo: "livre", origem: "livre", titulo: "T", pedido: "", clis: { nenhum: "claude" }, cadeado: false };

describe("validação da missão", () => {
  it("modo livre com origem livre aceita pedido vazio; título e CLI são obrigatórios", () => {
    expect(validar(base, ["claude"])).toEqual({});
    expect(validar({ ...base, titulo: " ", clis: {} }, ["claude"])).toMatchObject({ titulo: expect.any(String), nenhum: expect.any(String) });
  });
  it("squad e agêntico exigem piloto; papéis opcionais podem ficar vazios", () => {
    for (const modo of ["squad", "agentico"] as const) {
      const f: FormMissao = { ...base, modo, pedido: "faça", clis: { executor: "claude" } };
      expect(validar(f, ["claude"]).piloto).toMatch(/piloto/);
      expect(validar({ ...f, clis: { piloto: "claude" } }, ["claude"])).toEqual({});
    }
  });
  it("origem de trabalho exige pedido; CLI não instalada é recusada", () => {
    expect(validar({ ...base, origem: "feature" }, ["claude"]).pedido).toBeDefined();
    expect(validar({ ...base, clis: { nenhum: "codex" } }, ["claude"]).nenhum).toMatch(/não está instalada/);
  });
  it("cadeado aplica a mesma CLI a todos os papéis; sem cadeado só o papel", () => {
    const f: FormMissao = { ...base, modo: "squad", clis: {}, cadeado: true };
    expect(aplicarCli(f, "revisor", "codex").clis).toEqual({ piloto: "codex", executor: "codex", explorador: "codex", revisor: "codex" });
    expect(aplicarCli({ ...f, cadeado: false }, "revisor", "codex").clis).toEqual({ revisor: "codex" });
  });
  it("montarPedido só leva papéis preenchidos do modo", () => {
    const p = montarPedido({ ...base, modo: "squad", titulo: " x ", clis: { piloto: "claude", executor: "", nenhum: "lixo" } }, "w1");
    expect(p).toMatchObject({ workspace_id: "w1", titulo: "x", clis: { piloto: "claude" } });
  });
});
