import { describe, expect, it } from "vitest";
import { celulaCsv, codigoMd, csvDe, escaparHtml, escaparMd, limparTexto, nomeDePacoteValido, semCaminhoAbsoluto, urlSegura } from "./seguranca";

describe("escape de HTML e Markdown", () => {
  it("escapa tudo que fecha tag, atributo ou entidade", () => {
    expect(escaparHtml(`<img src=x onerror="alert(1)">'&\``)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;&#96;");
  });
  it("Markdown: nada vira marcação, link ou HTML embutido", () => {
    const m = escaparMd("**negrito** [x](javascript:alert(1)) <b>oi</b> a|b # título");
    expect(m).not.toMatch(/(?<!\\)[*[\]<>|]/);
    expect(escaparMd("# cabeçalho")).toBe("\\# cabeçalho");
    expect(escaparMd("- item")).toBe("\\- item");
    expect(codigoMd("a`b")).toBe("`a'b`");
  });
});

describe("CSV: RFC 4180 e injeção de fórmula", () => {
  it.each(["=SOMA(A1)", "+1+1", "-2+3", "@cmd", "\t=1", " =1+1", "＝1+1"])("neutraliza %j", (v) => {
    const c = celulaCsv(v);
    expect(c.replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("número legítimo (tipo number) não é alterado; null/undefined viram vazio, nunca 0", () => {
    expect(celulaCsv(-5)).toBe("-5");
    expect(celulaCsv(null)).toBe("");
    expect(celulaCsv(undefined)).toBe("");
    expect(celulaCsv(Number.NaN)).toBe("");
  });
  it("aspas, vírgula, quebra de linha e acentos", () => {
    expect(celulaCsv('diz "oi", ação\nlinha')).toBe('"diz ""oi"", ação\nlinha"');
    expect(csvDe(["a", "b"], [{ a: 1, b: "x" }], { bom: true })).toBe("\uFEFFa,b\r\n1,x\r\n");
  });
});

describe("limpeza de texto", () => {
  it("remove caminho absoluto (POSIX, Windows, UNC, ~) e preserva o relativo", () => {
    const t = semCaminhoAbsoluto("veja /Users/ana/proj/src/a.ts e C:\\Users\\ana\\x.ts e \\\\srv\\pasta\\a e ~/segredo.txt mas src/a.ts fica");
    expect(t).toBe("veja [caminho] e [caminho] e [caminho] e [caminho] mas src/a.ts fica");
  });
  it("URL: http(s) sem credencial fica; file://, javascript: e user:senha@ saem", () => {
    expect(semCaminhoAbsoluto("ver https://github.com/x/y/pull/1 ok")).toContain("https://github.com/x/y/pull/1");
    expect(semCaminhoAbsoluto("file:///Users/ana/a.txt")).toBe("[link removido]");
    expect(semCaminhoAbsoluto("https://usuario:senha@host.com/a")).toBe("[link removido]");
    expect(urlSegura("javascript:alert(1)")).toBeNull();
    expect(urlSegura("https://a.com/x y")).toBeNull();
    expect(urlSegura("https://a.com/x")).toBe("https://a.com/x");
  });
  it("segredos por padrão, cofre (scrub) e controle", () => {
    const t = limparTexto("token=abcdef123456 e sk-ABCDEFGHIJKLMNOP1234 e MEUSEGREDO_XYZ\u0007\u202e fim", (x) => x.replace("MEUSEGREDO_XYZ", "«cofre:K»"));
    expect(t).not.toMatch(/abcdef123456|sk-ABCDEF|MEUSEGREDO|\u0007|\u202e/);
    expect(t).toContain("«cofre:K»");
  });
  it("nomes de arquivo do pacote: um segmento, ou divulgacao/<segmento>", () => {
    for (const ok of ["tecnico.md", "divulgacao/email.txt"]) expect(nomeDePacoteValido(ok)).toBe(true);
    for (const ruim of ["../x", "/etc/passwd", "a/b/c", "divulgacao/../x", ".ssh", "a\\b", "x/y.md"]) expect(nomeDePacoteValido(ruim)).toBe(false);
  });
});
