// Ponte do Grok (D-514): arquivo de projeto sem segredo, criado só com `wx`, removido só se tem a marca; nunca toca em ~/.grok nem em arquivo de outra pessoa.
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, limpar } from "../../../tests/fixtures/dominio/ambiente";
import { PRODUTO } from "../produto";
import { aplicarPonteGrok, ambienteDaPonteGrok, ARQUIVO_DA_PONTE_GROK, conteudoDaPonteGrok, estadoDaPonteGrok, MARCA_DA_PONTE_GROK, removerPonteGrok, VARIAVEL_PONTE_TOKEN, VARIAVEL_PONTE_URL } from "./ponte-grok";

afterEach(limpar);

describe("conteúdo exato da ponte", () => {
  it("referencia só variáveis de ambiente (sem segredo, sem porta, sem token); marca na primeira linha; servidor com o id do produto", () => {
    const t = conteudoDaPonteGrok();
    expect(t.split("\n")[0]).toBe(MARCA_DA_PONTE_GROK);
    expect(t).toContain(`[mcp_servers.${PRODUTO.id}]`);
    expect(t).toContain("url = \"${" + VARIAVEL_PONTE_URL + "}\"");
    expect(t).toContain("Bearer ${" + VARIAVEL_PONTE_TOKEN + "}");
    expect(t).not.toMatch(/token-|127\.0\.0\.1|localhost|:\d{4,5}/);
    expect(ARQUIVO_DA_PONTE_GROK).toBe(".grok/config.toml"); // relativo, nunca absoluto
  });
  it("o ambiente da sessão preenche as duas variáveis", () => {
    expect(ambienteDaPonteGrok("http://127.0.0.1:9/mcp", "t")).toEqual({ [VARIAVEL_PONTE_URL]: "http://127.0.0.1:9/mcp", [VARIAVEL_PONTE_TOKEN]: "t" });
  });
});

describe("aplicar e remover", () => {
  it("ausente, ativa, ausente; a pasta .grok criada por ela some junto", () => {
    const raiz = criarTmp("ponte-");
    expect(estadoDaPonteGrok(raiz).estado).toBe("ausente");
    expect(aplicarPonteGrok(raiz).estado).toBe("ativa");
    expect(readFileSync(join(raiz, ARQUIVO_DA_PONTE_GROK), "utf8")).toBe(conteudoDaPonteGrok());
    expect(aplicarPonteGrok(raiz).estado).toBe("ativa"); // idempotente
    expect(removerPonteGrok(raiz).estado).toBe("ausente");
    expect(existsSync(join(raiz, ".grok"))).toBe(false);
    expect(removerPonteGrok(raiz).estado).toBe("ausente"); // idempotente
  });
  it("pasta .grok com outras coisas: só o nosso arquivo sai", () => {
    const raiz = criarTmp("ponte-");
    mkdirSync(join(raiz, ".grok"));
    writeFileSync(join(raiz, ".grok", "agents.md"), "meu");
    expect(aplicarPonteGrok(raiz).estado).toBe("ativa");
    removerPonteGrok(raiz);
    expect(existsSync(join(raiz, ".grok", "agents.md"))).toBe(true);
    expect(existsSync(join(raiz, ARQUIVO_DA_PONTE_GROK))).toBe(false);
  });
  it("NUNCA sobrescreve nem remove um .grok/config.toml de outra pessoa (estado 'bloqueada')", () => {
    const raiz = criarTmp("ponte-");
    mkdirSync(join(raiz, ".grok"));
    writeFileSync(join(raiz, ARQUIVO_DA_PONTE_GROK), "[mcp_servers.meu]\nurl = \"http://x\"\n");
    expect(estadoDaPonteGrok(raiz).estado).toBe("bloqueada");
    expect(aplicarPonteGrok(raiz).estado).toBe("bloqueada");
    expect(removerPonteGrok(raiz).estado).toBe("bloqueada");
    expect(readFileSync(join(raiz, ARQUIVO_DA_PONTE_GROK), "utf8")).toContain("meu");
  });
  it("recusa .grok que é link simbólico (não escreve através de links)", () => {
    const raiz = criarTmp("ponte-");
    const fora = criarTmp("fora-");
    symlinkSync(fora, join(raiz, ".grok"));
    expect(estadoDaPonteGrok(raiz).estado).toBe("bloqueada");
    expect(aplicarPonteGrok(raiz).estado).toBe("bloqueada");
    expect(existsSync(join(fora, "config.toml"))).toBe(false);
  });
});
