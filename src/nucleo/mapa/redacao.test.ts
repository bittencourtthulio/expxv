import { describe, expect, it } from "vitest";
import { LIMITE_DOC, primeiraLinhaDoc, redigirSegredos, sanitizarAssinatura } from "./redacao";

describe("redação de segredos (T-17.06)", () => {
  it("remove padrões de segredo plantados", () => {
    const t = redigirSegredos(
      [
        "chave AKIAIOSFODNN7EXAMPLE",
        "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "api sk-ant-abcdefghijklmnopqrstuv",
        "-----BEGIN RSA PRIVATE KEY-----",
        "password: hunter2",
        "senha = \"abc123\"",
        "Bearer abcdefghijklmnop12345678",
        "slack xoxb-123456789012-abcdefghij",
      ].join("\n"),
    );
    for (const s of ["AKIAIOSFODNN7EXAMPLE", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "sk-ant-abcdefghijklmnopqrstuv", "BEGIN RSA PRIVATE KEY", "hunter2", "abc123", "abcdefghijklmnop12345678", "xoxb-123456789012"]) {
      expect(t).not.toContain(s);
    }
    expect(t).toContain("[REDIGIDO]");
    expect(t).toContain("password: [REDIGIDO]");
  });

  it("texto comum não é alterado", () => {
    expect(redigirSegredos("Calcula o total do pedido")).toBe("Calcula o total do pedido");
  });
});

describe("assinatura sanitizada", () => {
  it("literais de texto viram \"…\" (aspas simples, duplas, crase, triplas) e espaços colapsam", () => {
    expect(sanitizarAssinatura("function f(a = 'x', b = \"y\",\n   c = `z ${1}`)")).toBe('function f(a = "…", b = "…", c = "…")');
    expect(sanitizarAssinatura('def f(a="""doc\nlongo"""):')).toBe('def f(a="…"):');
  });

  it("nunca vaza o conteúdo de um literal secreto e respeita o teto", () => {
    expect(sanitizarAssinatura('function c(t = "sk-live-abcdefghijklmnop12345")')).not.toContain("sk-live");
    expect(sanitizarAssinatura("x".repeat(500), 100)).toHaveLength(100);
  });
});

describe("primeira linha do comentário de documentação", () => {
  it("JSDoc, linhas // e docstring: primeira linha útil, sem marcadores nem tags", () => {
    expect(primeiraLinhaDoc("/**\n * Calcula o total.\n * @param a valor\n */")).toBe("Calcula o total.");
    expect(primeiraLinhaDoc("/** Só uma linha */")).toBe("Só uma linha");
    expect(primeiraLinhaDoc("// eslint-disable-next-line\n// Faz algo\n// mais")).toBe("Faz algo");
    expect(primeiraLinhaDoc("# comentário python")).toBe("comentário python");
    expect(primeiraLinhaDoc("/**\n * @deprecated\n */")).toBeNull();
    expect(primeiraLinhaDoc("")).toBeNull();
  });

  it("corta em 160 caracteres e redige segredo", () => {
    const longa = primeiraLinhaDoc(`/** ${"a".repeat(300)} */`)!;
    expect(longa).toHaveLength(LIMITE_DOC);
    expect(longa.endsWith("…")).toBe(true);
    expect(primeiraLinhaDoc("/** usa AKIAIOSFODNN7EXAMPLE aqui */")).toBe("usa [REDIGIDO] aqui");
  });
});
