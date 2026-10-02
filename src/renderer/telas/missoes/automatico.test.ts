import { describe, expect, it } from "vitest";
import type { ResultadoDeRota } from "../../../compartilhado/harness";
import { CLI_AUTOMATICA, ROTULO_AUTOMATICO, perfilAutomatico, resumirRota, textoErroRota } from "./automatico";
import { aplicarCli, montarPedido, validar, type FormMissao } from "./validar";

const rota = (extra: Partial<ResultadoDeRota> = {}): ResultadoDeRota => ({
  executor: { provider: "claude", cli: "claude", model: "sonnet", effort: "high", faixa: "alto" }, conta_id: "c1", task_type: "bug-fix", decisoes: ["d1"],
  fontes: { task_type: "heuristica", executor: "regra", conta: "regra" }, recibo: "conta cl·1 reseta antes", avisos: [], skills_aplicadas: false, ...extra,
} as ResultadoDeRota);

describe("Automático (harness) no wizard", () => {
  it("usa o id 'auto' do núcleo e um rótulo claro", () => {
    expect(CLI_AUTOMATICA).toBe("auto");
    expect(ROTULO_AUTOMATICO).toBe("Automático (harness)");
  });
  it("perfil de prévia é não concreto (cli auto) e válido para o canal", () => {
    expect(perfilAutomatico()).toEqual({ agente_id: null, provider: "auto", cli: "auto", modelo: null, esforco: null, faixa: "medio" });
  });
  it("resumo da rota: provedor, modelo, esforço, faixa e conta", () => {
    expect(resumirRota(rota())).toBe("claude · sonnet · esforço high · faixa alto · conta c1");
    expect(resumirRota(rota({ executor: { provider: "codex", cli: "codex", model: null, effort: null, faixa: "medio" }, conta_id: null } as never))).toBe("codex · faixa medio");
  });
  it("erros do harness viram texto com próximo passo; canal ausente vira indisponível", () => {
    expect(textoErroRota(new Error("no_capacity: Nenhum executor viável"))).toMatch(/Sem capacidade/);
    expect(textoErroRota(new Error("No handler registered for 'harness:resolver_perfil'"))).toMatch(/indisponível/);
    expect(textoErroRota(new Error("boom"))).toBe("Prévia indisponível: boom");
  });
  it("'auto' vira CLI do papel no pedido e é aceito pela validação quando o harness existe", () => {
    const f: FormMissao = { modo: "livre", origem: "livre", titulo: "t", pedido: "p", clis: {}, cadeado: false };
    const com = aplicarCli(f, "nenhum", CLI_AUTOMATICA);
    expect(validar(com, ["claude", CLI_AUTOMATICA])).toEqual({});
    expect(validar(com, ["claude"]).nenhum).toMatch(/não está instalada/);
    expect(montarPedido(com, "w1").clis).toEqual({ nenhum: "auto" });
  });
});
