import { describe, expect, it } from "vitest";
import type { ModeloOpenRouter } from "../../../compartilhado/harness";
import {
  TEXTO_CONSENTIMENTO_OPENROUTER, VERSAO_TEXTO_CONSENTIMENTO, aceitarSugestao, codigoDoErro, explicarCli, faixaSugerida, filtrarModelos, formatarMtok, formatarUsd,
  mascararChave, mensagemDoErro, ordemSugerida, validarChave,
} from "./openrouter-logica";

const m = (id: string, extra: Partial<ModeloOpenRouter> = {}): ModeloOpenRouter => ({ id, nome: id, contexto: 128000, suporta_tools: true, preco_entrada_por_mtok: 1, preco_saida_por_mtok: 5, habilitado: false, faixa: null, ordem: 0, tipos_permitidos: [], ...extra });

describe("preço e chave", () => {
  it("preço em US$/Mtok; ausente é 'sem preço', nunca zero", () => {
    expect(formatarMtok(null)).toBe("sem preço");
    expect(formatarMtok(0)).toBe("US$ 0,00");
    expect(formatarMtok(15)).toBe("US$ 15,00");
    expect(formatarMtok(0.123456)).toBe("US$ 0,1235");
  });
  it("usd e saldo", () => {
    expect(formatarUsd(null)).toBe("sem dado");
    expect(formatarUsd(7.1)).toBe("US$ 7,10");
  });
  it("chave mascarada mostra só os últimos 4", () => {
    expect(mascararChave("ab12")).toBe("sk-or-••••ab12");
    expect(mascararChave("")).toBe("sk-or-••••");
  });
  it("validarChave recusa vazio, espaço e curta; aceita sem tocar no valor", () => {
    expect(validarChave("")).toMatch(/Cole a chave/);
    expect(validarChave("sk-or-v1 abc")).toMatch(/espaço/);
    expect(validarChave("curta")).toMatch(/8 caracteres/);
    expect(validarChave("sk-or-v1-abcdef")).toBeNull();
    expect(validarChave("  sk-or-v1-abcdef  ")).toBeNull();
  });
  it("texto de consentimento é claro", () => {
    expect(TEXTO_CONSENTIMENTO_OPENROUTER).toMatch(/prompts e código/);
    expect(TEXTO_CONSENTIMENTO_OPENROUTER).toMatch(/nada é enviado até você usar/i);
    expect(VERSAO_TEXTO_CONSENTIMENTO).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("erros com código", () => {
  it("extrai o código do texto e explica o próximo passo", () => {
    const e = new Error("sem_consentimento: o OpenRouter ainda não foi consentido");
    expect(codigoDoErro(e)).toBe("sem_consentimento");
    expect(mensagemDoErro(e)).toMatch(/Ative o OpenRouter/);
    expect(mensagemDoErro(new Error("chave_invalida: x"))).toMatch(/recusou a chave/);
    expect(mensagemDoErro(new Error("Error invoking remote method 'x': OpenRouterErro: limite_de_requisicoes: x"))).toMatch(/esperar/);
  });
  it("sem código conhecido devolve a mensagem sem inventar", () => {
    expect(codigoDoErro(new Error("boom"))).toBeNull();
    expect(mensagemDoErro(new Error("boom"))).toBe("boom");
  });
});

describe("faixa e ordem sugeridas", () => {
  it("faixa por preço de saída; sem preço, sem sugestão", () => {
    expect(faixaSugerida(m("a", { preco_saida_por_mtok: 75 }))).toBe("topo");
    expect(faixaSugerida(m("a", { preco_saida_por_mtok: 15 }))).toBe("alto");
    expect(faixaSugerida(m("a", { preco_saida_por_mtok: 2 }))).toBe("medio");
    expect(faixaSugerida(m("a", { preco_saida_por_mtok: 0.4 }))).toBe("rapido");
    expect(faixaSugerida(m("a", { preco_saida_por_mtok: null }))).toBeNull();
  });
  it("ordem sugerida: dentro da faixa, mais barato primeiro, começando em 1", () => {
    const lista = [m("caro", { preco_saida_por_mtok: 20 }), m("barato", { preco_saida_por_mtok: 12 }), m("meio", { preco_saida_por_mtok: 2 })];
    expect(ordemSugerida(lista[1]!, lista)).toBe(1);
    expect(ordemSugerida(lista[0]!, lista)).toBe(2);
    expect(ordemSugerida(lista[2]!, lista)).toBe(1);
    expect(ordemSugerida(m("x", { preco_saida_por_mtok: null }), lista)).toBeNull();
  });
  it("aceitar sugestão mantém habilitação e tipos", () => {
    const lista = [m("a", { preco_saida_por_mtok: 20, habilitado: true, tipos_permitidos: ["bug-fix"] })];
    expect(aceitarSugestao(lista[0]!, lista)).toEqual({ id: "a", habilitado: true, faixa: "alto", tipos_permitidos: ["bug-fix"], ordem: 1 });
    expect(aceitarSugestao(m("z", { preco_saida_por_mtok: null }), lista)).toBeNull();
  });
});

describe("filtro e CLIs", () => {
  it("busca por id/nome, case-insensitive", () => {
    const l = [m("anthropic/claude-x", { nome: "Claude X" }), m("openai/gpt", { nome: "GPT" })];
    expect(filtrarModelos(l, "CLAUDE").map((x) => x.id)).toEqual(["anthropic/claude-x"]);
    expect(filtrarModelos(l, "  ")).toHaveLength(2);
  });
  it("explica cada status do adaptador", () => {
    expect(explicarCli({ cli: "opencode", instalada: true, status: "verificado" }).texto).toMatch(/Verificada/);
    expect(explicarCli({ cli: "codex", instalada: true, status: "a_verificar" }).texto).toMatch(/A verificar/);
    expect(explicarCli({ cli: "codex", instalada: true, status: "a_verificar" }).detalhe).toMatch(/desligad/);
    expect(explicarCli({ cli: "goose", instalada: false, status: "desligado" }).detalhe).toMatch(/desligad/);
    expect(explicarCli({ cli: "aider", instalada: false, status: "verificado" }).detalhe).toMatch(/não instalada/);
  });
});

import { cliPreferida } from "./openrouter-logica";
describe("CLI preferida", () => {
  it("primeira instalada e verificada; senão nenhuma", () => {
    expect(cliPreferida([{ cli: "codex", instalada: true, status: "a_verificar" }, { cli: "aider", instalada: false, status: "verificado" }, { cli: "opencode", instalada: true, status: "verificado" }])).toBe("opencode");
    expect(cliPreferida([{ cli: "codex", instalada: true, status: "a_verificar" }])).toBeNull();
  });
});
