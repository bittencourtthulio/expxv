import { describe, expect, it } from "vitest";
import { chunksDeCodigo, simbolosDeCodigo } from "./codigo";
import { chunksDeCommit } from "./commit";
import { chunksDeMarkdown, janelas } from "./comum";
import { chunksDeEvento } from "./evento";
import { chunksDeTroca } from "./transcricao";

const SEGREDO = ["sk", "ant", "api03", "ZZZZYYYYXXXXWWWWVVVVUUUUTTTTSSSS0123"].join("-");

const TS = `import { a } from "./a";

export interface Pedido { id: string }

export async function exportarCsv(pedidos: Pedido[]): Promise<string> {
  return pedidos.map((p) => p.id).join(",");
}

export const calcularTotal = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export class RepoPedidos {
  listar() { return []; }
}
`;

describe("chunking de código por símbolo", () => {
  it("reconhece símbolos TS, com cabeçalho arquivo › símbolo e termos quebrados", () => {
    const cs = chunksDeCodigo({ arquivo: "src/pedidos.ts", texto: TS });
    const titulos = cs.map((c) => c.titulos);
    expect(titulos).toEqual(expect.arrayContaining(["src/pedidos.ts › Pedido", "src/pedidos.ts › exportarCsv", "src/pedidos.ts › calcularTotal", "src/pedidos.ts › RepoPedidos"]));
    expect(cs.find((c) => c.titulos.endsWith("exportarCsv"))?.texto.startsWith("src/pedidos.ts › exportarCsv\n")).toBe(true);
    expect(cs.find((c) => c.titulos.endsWith("exportarCsv"))?.termos).toContain("exportar");
    expect(cs.find((c) => c.titulos.endsWith("exportarCsv"))?.termos).toContain("csv");
    expect(simbolosDeCodigo("src/pedidos.ts", TS)).toEqual(expect.arrayContaining(["exportarCsv", "RepoPedidos"]));
  });
  it("reconhece Python e Go", () => {
    expect(simbolosDeCodigo("a.py", "import os\n\ndef soma(a, b):\n    return a+b\n\nclass Caixa:\n    pass\n")).toEqual(["soma", "Caixa"]);
    expect(simbolosDeCodigo("a.go", "package x\n\nfunc (s *Srv) Ouvir() {}\n\nfunc Main() {}\n\ntype Cfg struct {}\n")).toEqual(["Srv.Ouvir", "Main", "Cfg"]);
  });
  it("sem símbolo: janelas de 60 linhas; nunca > 2000 caracteres", () => {
    const texto = Array.from({ length: 200 }, (_, i) => `linha ${i} ${"x".repeat(20)}`).join("\n");
    const cs = chunksDeCodigo({ arquivo: "dados.txt", texto });
    expect(cs.length).toBeGreaterThan(3);
    for (const c of cs) expect(c.texto.length).toBeLessThanOrEqual(2000);
  });
  it("linha gigante (minificado) é cortada, sem perder conteúdo", () => {
    const j = janelas(["a".repeat(5000)], 60, 1700);
    expect(j.join("").length).toBe(5000);
    for (const p of j) expect(p.length).toBeLessThanOrEqual(1700);
  });
  it("propriedade: determinístico, ≤ 2000, e a concatenação cobre todas as linhas do código", () => {
    const a = chunksDeCodigo({ arquivo: "src/pedidos.ts", texto: TS });
    const b = chunksDeCodigo({ arquivo: "src/pedidos.ts", texto: TS });
    expect(a).toEqual(b);
    const corpo = a.map((c) => c.texto).join("\n");
    for (const l of TS.split("\n").filter((x) => x.trim() !== "")) expect(corpo).toContain(l);
    for (const c of a) expect(c.texto.length).toBeLessThanOrEqual(2000);
  });
  it("segredo semeado nunca chega ao chunk", () => {
    const cs = chunksDeCodigo({ arquivo: "src/x.ts", texto: `const k = "${SEGREDO}";\nexport function f() {}\n` });
    expect(JSON.stringify(cs)).not.toContain("ZZZZYYYY");
  });
  it("1 MB de código chunka em tempo razoável", () => {
    const grande = TS.repeat(Math.ceil(1_000_000 / TS.length));
    const t0 = performance.now();
    chunksDeCodigo({ arquivo: "src/g.ts", texto: grande });
    expect(performance.now() - t0).toBeLessThan(150 * Number(process.env.EXPXV_PERF_FATOR ?? 1) + 1500);
  });
});

describe("chunking de markdown, evento, commit e transcrição", () => {
  it("markdown: por título, com títulos ancestrais, ≤ 2000, redigido", () => {
    const md = `# Plano\n\n## Decisões\n\nUsar SQLite local. A chave ${SEGREDO} não deve vazar.\n\n## Riscos\n\n${"Risco relevante. ".repeat(200)}`;
    const r = chunksDeMarkdown("docs/plano.md", md);
    expect(r.redigido).toBe(true);
    expect(JSON.stringify(r.chunks)).not.toContain("ZZZZYYYY");
    expect(r.chunks.some((c) => c.titulos.includes("Plano › Decisões"))).toBe(true);
    for (const c of r.chunks) expect(c.texto.length).toBeLessThanOrEqual(2000);
    expect(r.chunks).toEqual(chunksDeMarkdown("docs/plano.md", md).chunks);
  });
  it("evento: título vira cabeçalho e as tags vão junto", () => {
    const cs = chunksDeEvento({ titulo: "Handoff T-01.01", texto: "Concluí o login.", tags: ["handoff"] });
    expect(cs).toHaveLength(1);
    expect(cs[0]?.texto).toContain("Handoff T-01.01");
    expect(cs[0]?.texto).toContain("Tags: handoff");
  });
  it("commit: mensagem + arquivos + diff ≤ 40 linhas; sem binário e sem arquivo de ambiente", () => {
    const diff = Array.from({ length: 100 }, (_, i) => `+linha ${i}`).join("\n");
    const cs = chunksDeCommit({
      sha: "abcdef1234567890",
      mensagem: "fix: corrige exportação\n\ncorpo",
      arquivos: [
        { caminho: "src/a.ts", status: "M", diff },
        { caminho: `.${"env"}`, status: "A", diff: "+TOKEN=x" },
        { caminho: "img.png", status: "A", diff: "Binary files differ" },
      ],
    });
    const todo = cs.map((c) => c.texto).join("\n");
    expect(todo).toContain("src/a.ts");
    expect(todo).not.toContain(`.${"env"}`);
    expect(todo).not.toContain("TOKEN=x");
    expect(cs.find((c) => c.titulos.endsWith("src/a.ts"))?.texto.split("\n").filter((l) => l.startsWith("+")).length).toBe(40);
    expect(todo).not.toContain("Binary files");
  });
  it("transcrição: troca com resumo de tools; arquivos proibidos fora; segredo redigido", () => {
    const cs = chunksDeTroca({ usuario: "corrige o bug", resposta: `feito; a chave era ${SEGREDO}`, ferramentas: ["Edit"], arquivos: ["src/a.ts", `config/${"env"}.json`.replace("env.json", `.${"env"}`)] });
    const t = cs.map((c) => c.texto).join("\n");
    expect(t).toContain("Usuário: corrige o bug");
    expect(t).toContain("Ferramentas: Edit");
    expect(t).toContain("src/a.ts");
    expect(t).not.toContain(`.${"env"}`);
    expect(t).not.toContain("ZZZZYYYY");
  });
});
