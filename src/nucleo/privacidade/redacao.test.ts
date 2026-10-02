import { describe, expect, it } from "vitest";
import { FAMILIAS_REDACAO, MASCARA, mensagemSegura, redigirSegredos } from "./redacao";

const AMOSTRAS: readonly [string, string][] = [
  ["bearer", "Authorization: Bearer abcDEF1234567890xyz"],
  ["bearer2", "curl -H 'bearer abcDEF1234567890xyz'"],
  ["basic", "Authorization: Basic dXNlcjpwYXNzd29yZDEyMw=="],
  ["jwt", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"],
  ["pem", "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----"],
  ["url", "git clone https://usuario:s3nh4Forte@github.com/org/repo.git"],
  ["anthropic", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv"],
  ["openrouter", "sk-or-v1-0123456789abcdef0123456789abcdef"],
  ["openai", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
  ["openai2", "sk-AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
  ["github_pat", "github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz"],
  ["ghp", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["gho", "gho_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["gitlab", "glpat-abcdefghijklmnopqrstuv"],
  ["aws", "AKIAIOSFODNN7EXAMPLE"],
  ["aws_sessao", "ASIAIOSFODNN7EXAMPLE"],
  ["google", "AIzaSyA-abcdefghijklmnopqrstuvwxyz012345"],
  ["google_oauth", "ya29.a0AfH6SMBabcdefghijklmnopqrstuv"],
  ["slack", "xoxb-1234567890-abcdefghijkl"],
  ["slack_user", "xoxp-1234567890-abcdefghijkl"],
  ["stripe_live", "sk_live_abcdefghijklmnopqrstuvwx"],
  ["stripe_test", "rk_test_abcdefghijklmnopqrstuvwx"],
  ["whsec", "whsec_abcdefghijklmnopqrstuvwx"],
  ["sendgrid", "SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuv"],
  ["groq", "gsk_abcdefghijklmnopqrstuvwxyz"],
  ["hf", "hf_abcdefghijklmnopqrstuvwxyz"],
  ["npm", "npm_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["telegram", "123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-Xk"],
  ["twilio", "AC0123456789abcdef0123456789abcdef"],
  ["mailgun", "key-0123456789abcdef0123456789abcdef"],
  ["shopify", "shpat_0123456789abcdef0123456789abcdef"],
  ["hex", "0123456789abcdef0123456789abcdef0123456789abcdef"],
  ["x-api-key", "x-api-key: valor-super-secreto-123"],
  ["cookie", "Cookie: sessao=abc123def456; outro=xyz"],
];

describe("redação de segredos", () => {
  it.each(AMOSTRAS)("mascara %s", (_nome, amostra) => {
    const r = redigirSegredos(`antes ${amostra} depois`);
    expect(r).toContain(MASCARA);
    const segredo = amostra.split(/[\s:=]/).filter((p) => p.length >= 16).pop() ?? amostra;
    expect(r).not.toContain(segredo);
  });

  it("tem ao menos 30 amostras e as famílias cobrem todas", () => {
    expect(AMOSTRAS.length).toBeGreaterThanOrEqual(30);
    expect(FAMILIAS_REDACAO.length).toBeGreaterThanOrEqual(25);
  });

  it("atribuições por nome: mascara o valor e mantém o nome", () => {
    expect(redigirSegredos("OPENAI_API_KEY=abc123xyz")).toBe(`OPENAI_API_KEY=${MASCARA}`);
    expect(redigirSegredos('{"password": "hunter2"}')).toContain(MASCARA);
    expect(redigirSegredos("senha: minhaSenhaForte")).toBe(`senha: ${MASCARA}`);
    expect(redigirSegredos("token = 'abc'")).not.toContain("abc");
  });

  it("texto comum fica intacto e a redação é idempotente", () => {
    const comum = "abrir o arquivo config.json e rodar npm test na pasta src";
    expect(redigirSegredos(comum)).toBe(comum);
    const uma = redigirSegredos("Bearer abcDEF1234567890xyz");
    expect(redigirSegredos(uma)).toBe(uma);
  });

  it("mensagemSegura redige e limita, sem stack", () => {
    const e = new Error(`falhou com ${"sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv"} ${"x".repeat(500)}`);
    const m = mensagemSegura(e, 100);
    expect(m.length).toBeLessThanOrEqual(100);
    expect(m).not.toContain("AbCdEfGhIjKl");
    expect(m).not.toContain("at ");
  });
});
