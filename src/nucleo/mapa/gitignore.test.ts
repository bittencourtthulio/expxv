import { describe, expect, it } from "vitest";
import { AvaliadorGitignore, parseGitignore } from "./gitignore";

const av = (texto: string, base = ""): AvaliadorGitignore => new AvaliadorGitignore(parseGitignore(texto, base));

describe("analisador de .gitignore (T-17.03)", () => {
  it("nome simples casa em qualquer profundidade; negação reinclui", () => {
    const a = av("*.log\n!importante.log\ntemp\n");
    expect(a.ignorado("a.log")).toBe(true);
    expect(a.ignorado("x/y/a.log")).toBe(true);
    expect(a.ignorado("x/importante.log")).toBe(false);
    expect(a.ignorado("temp", true)).toBe(true);
    expect(a.ignorado("src/temp/f.ts")).toBe(true);
  });

  it("âncora pela barra inicial ou do meio; barra final = só diretório", () => {
    const a = av("/raiz.txt\nsrc/gerado\nbuild/\n");
    expect(a.ignorado("raiz.txt")).toBe(true);
    expect(a.ignorado("sub/raiz.txt")).toBe(false);
    expect(a.ignorado("src/gerado")).toBe(true);
    expect(a.ignorado("outro/src/gerado")).toBe(false);
    expect(a.ignorado("build", true)).toBe(true);
    expect(a.ignorado("build", false)).toBe(false); // arquivo chamado build não é a pasta
    expect(a.ignorado("a/build/x.js")).toBe(true);
  });

  it("curingas: *, ?, [..], ** em início, meio e fim", () => {
    const a = av("a?c.ts\nlog[0-9].txt\n**/cache/*.tmp\ndocs/**/rascunho\nsaida/**\n");
    expect(a.ignorado("abc.ts")).toBe(true);
    expect(a.ignorado("ab/c.ts")).toBe(false);
    expect(a.ignorado("log3.txt")).toBe(true);
    expect(a.ignorado("logx.txt")).toBe(false);
    expect(a.ignorado("x/cache/a.tmp")).toBe(true);
    expect(a.ignorado("cache/a.tmp")).toBe(true);
    expect(a.ignorado("docs/rascunho")).toBe(true);
    expect(a.ignorado("docs/a/b/rascunho")).toBe(true);
    expect(a.ignorado("saida/qualquer/coisa.js")).toBe(true);
  });

  it("pai ignorado nunca tem filho reincluído (semântica do git)", () => {
    const a = av("pasta/\n!pasta/ok.txt\n");
    expect(a.ignorado("pasta/ok.txt")).toBe(true);
  });

  it(".gitignore aninhado vale só abaixo da sua pasta e vence o da raiz (a última regra decide)", () => {
    const a = new AvaliadorGitignore([...parseGitignore("*.gen.ts\n", ""), ...parseGitignore("!manter.gen.ts\nlocal.txt\n", "pkg")]);
    expect(a.ignorado("a.gen.ts")).toBe(true);
    expect(a.ignorado("pkg/manter.gen.ts")).toBe(false);
    expect(a.ignorado("pkg/x/local.txt")).toBe(true);
    expect(a.ignorado("outro/local.txt")).toBe(false);
  });

  it("comentários, linhas vazias, # escapado, ! escapado e espaços finais", () => {
    const a = av("# comentário\n\n\\#nome\n\\!feito\nespaco\\ \nnormal   \n");
    expect(a.ignorado("#nome")).toBe(true);
    expect(a.ignorado("!feito")).toBe(true);
    expect(a.ignorado("espaco ")).toBe(true);
    expect(a.ignorado("normal")).toBe(true);
    expect(a.ignorado("comentário")).toBe(false);
  });

  it("CRLF no arquivo e padrão inválido não quebram", () => {
    const a = av("um.txt\r\ndois.txt\r\n[abc\r\n");
    expect(a.ignorado("um.txt")).toBe(true);
    expect(a.ignorado("dois.txt")).toBe(true);
  });
});
