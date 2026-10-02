// T-21.25 / D-347.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErroNotas, escaparHtml, extrairSecao, gerarNotas, MARCA_HISTORICO } from "../../scripts/lib/notas-versao.mjs";
import { principal } from "../../scripts/notas-versao.mjs";

const RAIZ = join(__dirname, "..", "..");
const changelog = readFileSync(join(RAIZ, "tests/fixtures/notas/CHANGELOG.md"), "utf8");

describe("extração do CHANGELOG", () => {
  it("extrai só a seção pedida, com itens multilinha, sem rodapé", () => {
    const n = extrairSecao(changelog, "1.2.0");
    expect(n.data).toBe("2026-09-30");
    expect(n.secoes.map((s) => s.titulo)).toEqual(["Adicionado", "Corrigido"]);
    expect(n.secoes[1]!.itens).toEqual(["Terminal travava ao colar texto longo"]);
    expect(JSON.stringify(n)).not.toContain("Tema escuro");
    expect(JSON.stringify(n)).not.toContain("example.com");
  });
  it("aceita prefixo v", () => {
    expect(extrairSecao(changelog, "v1.1.0").secoes[0]!.itens).toEqual(["Tema escuro refinado"]);
  });
  it("seção inexistente => erro claro", () => {
    expect(() => extrairSecao(changelog, "9.9.9")).toThrow(ErroNotas);
    expect(() => extrairSecao(changelog, "9.9.9")).toThrow(/\[9\.9\.9\] não encontrada/);
  });
});

describe("escape na origem", () => {
  it("HTML e script saem escapados no Markdown e no texto puro", () => {
    const r = gerarNotas({ versao: "1.2.0", changelog });
    for (const t of [r.markdown, r.texto]) {
      expect(t).not.toContain("<script");
      expect(t).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;aspas&quot;");
    }
    expect(escaparHtml("<b>'x'</b>")).toBe("&lt;b&gt;&#39;x&#39;&lt;/b&gt;");
  });
  it("texto puro não tem marcação Markdown de cabeçalho", () => {
    expect(gerarNotas({ versao: "1.1.0", changelog }).texto).toBe("Alterado:\n- Tema escuro refinado\n");
  });
});

describe("sem CHANGELOG", () => {
  it("usa git log da tag anterior, marcada como gerada do histórico, com executor injetado", () => {
    const chamadas: string[][] = [];
    const r = gerarNotas({
      versao: "1.3.0",
      changelog: null,
      executorGit: (a) => { chamadas.push(a); return a[0] === "describe" ? "v1.2.0\n" : "feat: <img onerror=x>\nfix: algo\n"; },
    });
    expect(chamadas[1]).toEqual(["log", "v1.2.0..HEAD", "--pretty=%s"]);
    expect(r.origem).toBe("historico");
    expect(r.markdown).toContain(MARCA_HISTORICO);
    expect(r.texto).toContain(MARCA_HISTORICO);
    expect(r.markdown).not.toContain("<img");
  });
  it("sem tag usa HEAD; sem commits => erro claro", () => {
    const c: string[][] = [];
    gerarNotas({ versao: "0.1.0", changelog: null, executorGit: (a) => { c.push(a); if (a[0] === "describe") throw new Error("sem tag"); return "primeiro\n"; } });
    expect(c[1]).toEqual(["log", "HEAD", "--pretty=%s"]);
    expect(() => gerarNotas({ versao: "0.1.0", changelog: null, executorGit: () => "" })).toThrow(/sem commits/);
  });
});

describe("CLI", () => {
  it("grava NOTAS.md e texto, é idempotente e rápido", () => {
    const dir = mkdtempSync(join(tmpdir(), "notas-"));
    const args = ["--versao", "1.2.0", "--changelog", join(RAIZ, "tests/fixtures/notas/CHANGELOG.md"), "--saida", join(dir, "NOTAS.md"), "--saida-texto", join(dir, "notas.txt")];
    const t0 = performance.now();
    expect(principal(args)).toBe(0);
    const ms = performance.now() - t0;
    const a = [readFileSync(join(dir, "NOTAS.md"), "utf8"), readFileSync(join(dir, "notas.txt"), "utf8")];
    expect(principal(args)).toBe(0);
    expect([readFileSync(join(dir, "NOTAS.md"), "utf8"), readFileSync(join(dir, "notas.txt"), "utf8")]).toEqual(a);
    expect(ms).toBeLessThan(200);
  });
  it("versão inexistente retorna 1 sem gravar", () => {
    const dir = mkdtempSync(join(tmpdir(), "notas-"));
    const antes = console.error;
    console.error = () => {};
    try {
      expect(principal(["--versao", "9.9.9", "--changelog", join(RAIZ, "tests/fixtures/notas/CHANGELOG.md"), "--saida", join(dir, "N.md")])).toBe(1);
    } finally { console.error = antes; }
    expect(() => readFileSync(join(dir, "N.md"))).toThrow();
  });
});
