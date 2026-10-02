import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { criarScrubber } from "../cofre/scrubber";
import { MARCA_REDIGIDO, redigirTexto } from "./redacao";

const corpus = JSON.parse(readFileSync(join(__dirname, "../../../tests/fixtures/memoria/segredos.json"), "utf8")) as {
  positivos: Array<{ texto: string; segredo: string }>;
  negativos: Array<{ texto: string }>;
};

describe("redigirTexto (T-08.02)", () => {
  it("corpus tem ao menos 60 positivos e 40 negativos", () => {
    expect(corpus.positivos.length).toBeGreaterThanOrEqual(60);
    expect(corpus.negativos.length).toBeGreaterThanOrEqual(40);
  });

  it.each(corpus.positivos.map((c, i) => [i, c] as const))("positivo %i: o segredo some e o texto é marcado", (_i, c) => {
    const r = redigirTexto(c.texto);
    expect(r.texto).not.toContain(c.segredo);
    expect(r.redigido).toBe(true);
    expect(r.substituicoes).toBeGreaterThan(0);
    expect(r.texto).toContain(MARCA_REDIGIDO);
  });

  it.each(corpus.negativos.map((c, i) => [i, c] as const))("negativo %i: texto normal passa intacto", (_i, c) => {
    const r = redigirTexto(c.texto);
    expect(r.texto).toBe(c.texto);
    expect(r.redigido).toBe(false);
  });

  it("idempotente: redigir 2x = 1x (todo o corpus)", () => {
    for (const c of corpus.positivos) {
      const a = redigirTexto(c.texto).texto;
      expect(redigirTexto(a).texto).toBe(a);
    }
  });

  it("mantém o nome da variável e mascara só o valor", () => {
    expect(redigirTexto("API_KEY=xyz").texto).toBe(`API_KEY=${MARCA_REDIGIDO}`);
    expect(redigirTexto("postgres://u:senhaSuperSecreta@h/d").texto).toBe(`postgres://u:${MARCA_REDIGIDO}@h/d`);
    expect(redigirTexto("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123").texto).toContain("Bearer [REDACTED]");
  });

  it("PEM inteiro (com END e sem END) some, e o texto depois do END é preservado", () => {
    const r = redigirTexto("a\n-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\ndepois");
    expect(r.texto).toBe(`a\n${MARCA_REDIGIDO}\ndepois`);
  });

  it("scrubber do cofre remove o valor literal conhecido (e conta como redigido)", () => {
    const s = criarScrubber();
    s.adicionar("MEU_SEGREDO", "valor-bem-pessoal-123");
    const r = redigirTexto("o valor é valor-bem-pessoal-123 ok", { scrubber: s });
    expect(r.texto).not.toContain("valor-bem-pessoal-123");
    expect(r.redigido).toBe(true);
  });

  it("texto vazio e muito curto não quebram", () => {
    expect(redigirTexto("")).toEqual({ texto: "", redigido: false, substituicoes: 0 });
    expect(redigirTexto("a").texto).toBe("a");
  });
});

// O orçamento ESTRITO (P-39: 1 MB adversarial ≤ 100 ms, medido em máquina ociosa) vive em tests/perf/memoria.perf.ts. Aqui, com a suíte
// inteira rodando em paralelo, só se detecta regressão catastrófica (backtracking exponencial/quadrático): teto de 1 s.
describe("redigirTexto: adversarial sem backtracking catastrófico", () => {
  const medir = (fn: () => void): number => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };
  const adversariais: Record<string, string> = {
    a: "a".repeat(1_000_000),
    bearer: "Bearer ".repeat(150_000),
    igual: "=".repeat(1_000_000),
    chave: "key=".repeat(250_000),
    token: "TOKEN: ".repeat(140_000),
    pem: "-----BEGIN PRIVATE KEY-----".repeat(40_000),
    url: "a://:".repeat(200_000),
    alnum: "aB3".repeat(333_333),
    base64: ("aB3+".repeat(10) + " ").repeat(24_000),
  };
  for (const [nome, texto] of Object.entries(adversariais)) {
    it(`1 MB "${nome}" termina em tempo linear (< 1 s sob carga)`, () => {
      redigirTexto("aquecer API_KEY=1 Bearer abcdefghijklmnopqrstuvwxyz"); // JIT
      const ms = medir(() => redigirTexto(texto));
      expect(ms, `${nome}: ${ms.toFixed(1)} ms`).toBeLessThan(1000);
    });
  }
  it("1 000 caracteres típicos ≤ 1 ms (mediana)", () => {
    const t = ("Decidimos usar SQLite; ver src/nucleo/x.ts linha 10 e a task T-08.07. " as string).repeat(14).slice(0, 1000);
    for (let i = 0; i < 50; i++) redigirTexto(t);
    const xs = Array.from({ length: 200 }, () => medir(() => redigirTexto(t))).sort((a, b) => a - b);
    expect(xs[100] ?? 0).toBeLessThan(1);
  });
});
