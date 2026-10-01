import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { detectarLinguagem } from "../linguagens";
import { extrairArquivo } from "./registro";
import { entradasNext } from "./typescript";

// T-17.07: gabarito `esperado.json` das fixtures TypeScript e JavaScript (100% do gabarito, sem armadilhas).

for (const pasta of ["typescript", "javascript"] as const) {
  const gab = carregarGabarito(pasta);
  describe(`extrator TS/JS: fixtures ${pasta}`, () => {
    for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
      it(`${caminho}: 100% do gabarito e nenhuma armadilha`, async () => {
        const texto = lerFixture(pasta, caminho);
        const ling = detectarLinguagem(caminho, texto.split("\n")[0]);
        expect(ling).not.toBeNull();
        const e = await extrairArquivo(texto, ling!, caminho);
        expect(compararComGabarito(e, esperado)).toEqual([]);
      });
    }
  });
}

describe("extrator TS/JS: casos de borda", () => {
  const ext = (texto: string, caminho = "src/x.ts") => extrairArquivo(texto, detectarLinguagem(caminho)!, caminho);

  it("re-export em cadeia, export default de identificador e export { a as b } marcam exportado", async () => {
    const e = await ext("function a() {}\nconst b = () => 1;\nexport { a, b as c };\nexport default a;\n");
    expect(e.simbolos.find((s) => s.nome === "a")?.exportado).toBe(true);
    expect(e.simbolos.find((s) => s.nome === "b")?.exportado).toBe(true);
  });

  it("classe anônima exportada vira símbolo `default`; método de objeto não vira símbolo", async () => {
    const e = await ext("export default class { m() {} }\nconst o = { f() {} };\n");
    expect(e.simbolos.filter((s) => s.tipo !== "constante").map((s) => s.qualificado)).toEqual(["default", "default.m"]);
  });

  it("decorators de método e de classe ficam sanitizados (literais viram \"…\")", async () => {
    const e = await ext('@Injectable("segredo")\nexport class S { @Input("x") campo = 1; @Get("a") m() {} }\n');
    const s = e.simbolos.find((x) => x.qualificado === "S");
    expect(s?.decoradores).toEqual(['@Injectable("…")']);
    expect(JSON.stringify(e)).not.toContain("segredo");
  });

  it("arquivo com erro de sintaxe devolve erros_parse > 0 e ainda extrai o que dá", async () => {
    const e = await ext("export function ok(): number {\n  return 1;\n}\nconst x = ;\nfunction ( {\n");
    expect(e.erros_parse).toBeGreaterThan(0);
    expect(e.simbolos.some((s) => s.qualificado === "ok")).toBe(true);
  });

  it("arquivo vazio e só comentário não quebram", async () => {
    expect((await ext("")).loc).toBe(0);
    const c = await ext("// nada\n");
    expect(c.loc_comentario).toBe(1);
    expect(c.simbolos).toEqual([]);
  });

  it("caracteres não ASCII não deslocam linhas nem trechos (índices UTF-16)", async () => {
    const e = await ext('const á = "ção";\n/** Docção */\nexport function nãoAscii(á: string): void {}\n');
    const s = e.simbolos.find((x) => x.nome === "nãoAscii");
    expect(s?.linha).toBe(3);
    expect(s?.assinatura).toBe("function nãoAscii(á: string): void");
    expect(s?.doc).toBe("Docção");
  });

  it("teto de símbolos: acima de 5 000 corta e marca truncado", async () => {
    const texto = Array.from({ length: 5100 }, (_, i) => `function f${i}() {}`).join("\n");
    const e = await ext(texto);
    expect(e.simbolos).toHaveLength(5000);
    expect(e.truncado).toBe(true);
  });

  it("SQL mal-formado ou frase comum nunca vira tabela", async () => {
    const e = await ext('const a = "Select all items from the cart please";\nconst b = "delete from";\nconst c = `UPDATE ${t} SET x = 1`;\n');
    expect(e.dados).toEqual([]);
  });

  it("chamada em cadeia usa receptor \"?\" (expressão) e não vira chamada nua", async () => {
    const e = await ext("function f() { g().h(); }\n");
    expect(e.chamadas.find((c) => c.alvo === "h")?.receptor).toBe("?");
    expect(e.chamadas.find((c) => c.alvo === "g")?.receptor).toBeNull();
  });

  it("process.env só registra o NOME, nunca o valor", async () => {
    const e = await ext('const t = process.env.SEGREDO_X ?? "valor-padrao-secreto";\n');
    expect(e.padroes).toEqual([{ tipo: "env", nome: "SEGREDO_X", linha: 1 }]);
    expect(JSON.stringify(e)).not.toContain("valor-padrao-secreto");
  });
});

describe("entradasNext (convenção de arquivo)", () => {
  it("grupos, slots paralelos e segmentos dinâmicos", () => {
    expect(entradasNext("app/(marketing)/blog/[slug]/page.tsx", [], true, true).map((e) => e.chave)).toEqual(["GET /blog/:slug"]);
    expect(entradasNext("app/docs/[...all]/page.tsx", [], true, true).map((e) => e.chave)).toEqual(["GET /docs/*all"]);
    expect(entradasNext("pages/_app.tsx", [], true, true)).toEqual([]);
    expect(entradasNext("app/componentes/Botao.tsx", [], true, true)).toEqual([]);
    expect(entradasNext("pages/api/ping.ts", [], true, true).map((e) => e.chave)).toEqual(["ALL /api/ping"]);
  });
});
