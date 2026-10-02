import { describe, expect, it } from "vitest";
import type { Executor, PoliticaEntrada } from "../../../compartilhado/harness";
import { aplicarDiferenca, celulaAlterada, hostDe, lerCelulaEquivalencia, problemaExecutor, problemasPolitica, textoCelulaEquivalencia, validarHttps, validarLimiar, validarNomeCofre } from "./validar";

const ex = (extra: Partial<Executor> = {}): Executor => ({ provider: "claude", cli: "claude", model: "opus", effort: "high", faixa: "topo", ...extra });
const ctx = { provedoresAtivos: new Set(["claude", "codex"]) };
const pol = (extra: Partial<PoliticaEntrada> = {}): PoliticaEntrada => ({ workspace_id: null, task_type: "bug-fix", executor: ex(), alternativas: [], fallback: [ex({ provider: "codex" })], skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: false, habilitada: true, ...extra });

describe("validações do harness", () => {
  it("limiar 50..99 inteiro", () => {
    expect(validarLimiar("85")).toEqual({ ok: true, valor: 85 });
    expect(validarLimiar("49").ok).toBe(false);
    expect(validarLimiar("100").ok).toBe(false);
    expect(validarLimiar("8.5").ok).toBe(false);
    expect(validarLimiar("").ok).toBe(false);
  });
  it("executor com provedor desativado bloqueia com o motivo", () => {
    expect(problemaExecutor(ex({ provider: "aider" }), ctx)).toMatch(/desativado/);
    expect(problemaExecutor(ex(), ctx)).toBeNull();
    expect(problemaExecutor(ex({ model: "ruim modelo!" }), ctx)).toMatch(/inválido/);
  });
  it("política: fallback nunca vazio e cada executor validado", () => {
    expect(problemasPolitica(pol(), ctx)).toEqual([]);
    expect(problemasPolitica(pol({ fallback: [] }), ctx)[0]).toMatch(/fallback/i);
    expect(problemasPolitica(pol({ executor: ex({ provider: "x" }) }), ctx)).toHaveLength(1);
  });
  it("célula de equivalência: modelo@esforço, vazio = sem equivalente, inválido recusado", () => {
    expect(lerCelulaEquivalencia("gpt-5@high, o4-mini")).toEqual({ ok: true, valor: [{ modelo: "gpt-5", esforco: "high" }, { modelo: "o4-mini", esforco: null }] });
    expect(lerCelulaEquivalencia("")).toEqual({ ok: true, valor: [] });
    expect(lerCelulaEquivalencia("modelo ruim").ok).toBe(false);
    expect(textoCelulaEquivalencia([{ modelo: "a", esforco: "low" }])).toBe("a@low");
  });
  it("grava só a diferença e remove quando volta ao padrão", () => {
    const padrao = { codex: { topo: [{ modelo: "gpt-5", esforco: null }] } };
    const d1 = aplicarDiferenca({}, padrao, "codex", "topo", [{ modelo: "gpt-6", esforco: null }]);
    expect(d1).toEqual({ codex: { topo: [{ modelo: "gpt-6", esforco: null }] } });
    expect(celulaAlterada(d1, "codex", "topo")).toBe(true);
    expect(aplicarDiferenca(d1, padrao, "codex", "topo", [{ modelo: "gpt-5", esforco: null }])).toEqual({});
  });
  it("nome do cofre UPPER_SNAKE e https sem credencial", () => {
    expect(validarNomeCofre("MINHA_CHAVE")).toBeNull();
    expect(validarNomeCofre("minha")).not.toBeNull();
    expect(validarHttps("https://a.com/v1")).toBeNull();
    expect(validarHttps("http://a.com")).not.toBeNull();
    expect(validarHttps("https://u:p@a.com")).not.toBeNull();
    expect(hostDe("https://a.com/v1")).toBe("a.com");
  });
});
