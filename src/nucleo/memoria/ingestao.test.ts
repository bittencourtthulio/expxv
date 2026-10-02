import { describe, expect, it } from "vitest";
import { dividirEmChunks, normalizarParaIndice, prepararDocumento } from "./ingestao";

const md = (n: number): string =>
  Array.from({ length: n }, (_, i) => `# Seção ${i}\n\n${"Parágrafo de exemplo com algumas palavras úteis. ".repeat(6)}\n\n## Sub ${i}\n\n${"Outra frase longa para o chunker contar. ".repeat(10)}\n`).join("\n");

describe("normalizarParaIndice", () => {
  it("CRLF→LF, tira ANSI/controles/bidi e colapsa espaços fora de código", () => {
    const t = normalizarParaIndice("a  b\r\nc\u001b[31m d\u0007‮\n\n\n\ne");
    expect(t).toBe("a b\nc d\n\ne");
  });
  it("não mexe em espaços dentro de cerca de código", () => {
    const t = normalizarParaIndice("x\n```py\n  a    =   1\n\n\n\nb\n```\ny");
    expect(t).toContain("  a    =   1\n\n\n\nb");
  });
});

describe("dividirEmChunks (T-08.34)", () => {
  it("determinístico: mesma entrada = mesmos chunks e hashes", () => {
    const t = normalizarParaIndice(md(20));
    expect(dividirEmChunks(t)).toEqual(dividirEmChunks(t));
  });
  it("nenhum chunk acima de maxChars; todos têm hash sha256 e ordem sequencial", () => {
    const t = normalizarParaIndice(md(40) + "x".repeat(5000) + "\n\n" + "frase. ".repeat(900));
    const cs = dividirEmChunks(t, { maxChars: 1500, alvoChars: 1000 });
    expect(cs.length).toBeGreaterThan(10);
    cs.forEach((c, i) => {
      expect(c.texto.length).toBeLessThanOrEqual(1500);
      expect(c.ordem).toBe(i);
      expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(t.slice(c.inicio, c.fim)).toBe(c.texto);
    });
  });
  it("propriedade: os chunks cobrem todo caractere não-branco do texto", () => {
    for (const t0 of [md(15), "a ".repeat(3000), "um parágrafo\n\n".repeat(500), "```\n" + "linha de código\n".repeat(300) + "```\n\nfim"]) {
      const t = normalizarParaIndice(t0);
      const cs = dividirEmChunks(t);
      const coberto = new Uint8Array(t.length);
      for (const c of cs) coberto.fill(1, c.inicio, c.fim);
      for (let i = 0; i < t.length; i++) if (!/\s/.test(t.charAt(i))) expect(coberto[i], `posição ${i}`).toBe(1);
    }
  });
  it("não corta cerca de código no meio quando cabe em maxChars", () => {
    const cerca = "```ts\n" + "const a = 1;\n".repeat(60) + "```";
    const t = normalizarParaIndice(`${"Texto antes. ".repeat(80)}\n\n${cerca}\n\n${"Texto depois. ".repeat(80)}`);
    const cs = dividirEmChunks(t);
    const dentro = cs.filter((c) => c.texto.includes("const a = 1;"));
    expect(dentro).toHaveLength(1);
    expect(dentro[0]?.texto).toContain(cerca);
  });
  it("carrega os títulos da hierarquia e respeita markdown", () => {
    const cs = dividirEmChunks(normalizarParaIndice("# A\n\ntexto a\n\n## B\n\ntexto b"), { alvoChars: 200 });
    expect(cs.map((c) => c.titulos)).toEqual([["A"], ["A", "B"]]);
    expect(cs.map((c) => c.texto)).toEqual(["# A\n\ntexto a", "## B\n\ntexto b"]);
  });
  it("vazio devolve nada; palavra gigante sem espaço é cortada em maxChars", () => {
    expect(dividirEmChunks("   ")).toEqual([]);
    const cs = dividirEmChunks("z".repeat(9000), { maxChars: 2000, alvoChars: 1200 });
    expect(Math.max(...cs.map((c) => c.texto.length))).toBeLessThanOrEqual(2000);
  });
});

describe("prepararDocumento", () => {
  it("redige ANTES de chunkar: o segredo não aparece em nenhum chunk e o hash é do texto redigido", () => {
    const segredo = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const d = prepararDocumento({ origem: "docs/x.md", texto: `# T\n\nchave ${segredo}\n\nAPI_KEY=zzz\n${"texto ".repeat(500)}` });
    expect(d.redigido).toBe(true);
    for (const c of d.chunks) {
      expect(c.texto).not.toContain(segredo);
      expect(c.texto).not.toContain("zzz");
    }
    expect(d.chunks[0]?.texto).toContain("[REDACTED]");
  });
});
