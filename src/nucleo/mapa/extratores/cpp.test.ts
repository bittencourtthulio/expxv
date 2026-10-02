import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { detectarLinguagem } from "../linguagens";
import { extrairArquivo } from "./registro";

// T-17.14 (C/C++): gabarito `esperado.json` de `c/` e `cpp/` e casos de borda (macro pesada, Pro*C, erro tolerado).
// Não há compilador de referência determinístico para os símbolos; o gabarito é conferido à mão contra o fonte.

for (const pasta of ["cpp", "c"] as const) {
  const gab = carregarGabarito(pasta);
  describe(`extrator C/C++: fixtures ${pasta}`, () => {
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

describe("extrator C/C++: casos de borda", () => {
  const ext = (texto: string, caminho = "src/x.cpp") => extrairArquivo(texto, detectarLinguagem(caminho)!, caminho);

  it("macro pesada e #ifdef não derrubam o parse; símbolos dentro de #ifdef são extraídos", async () => {
    const e = await ext('#ifdef WIN\n#define API __declspec(dllexport)\n#endif\n#define LOOP(n) for (int i = 0; i < (n); i++) {\nvoid f() {}\n#ifdef X\nint g(void) { return 1; }\n#endif\n');
    expect(e.simbolos.some((s) => s.qualificado === "f")).toBe(true);
    expect(e.simbolos.some((s) => s.qualificado === "g")).toBe(true);
  });

  it("extern \"C\" e namespace anônimo (não exportado)", async () => {
    const e = await ext('extern "C" { int a(void) { return 0; } }\nnamespace { void b() {} }\n');
    expect(e.simbolos.map((s) => [s.qualificado, s.exportado])).toEqual([["a", true], ["b", false]]);
  });

  it("struct em C: membros de função não existem; visibilidade pública por padrão; class é privada", async () => {
    const e = await ext("struct S { void m(); };\nclass C { void p(); public: void q(); };\n", "src/x.hpp");
    expect(Object.fromEntries(e.simbolos.filter((s) => s.tipo === "metodo").map((s) => [s.qualificado, s.visibilidade]))).toEqual({ "S.m": "publica", "C.p": "privada", "C.q": "publica" });
  });

  it("template de classe com base qualificada; operator e destrutor", async () => {
    const e = await ext("template <class T> class V : public std::vector<T> { public: ~V() {} bool operator==(const V&) const { return true; } };\n");
    expect(e.herancas).toMatchObject([{ classe: "V", base: "std::vector", tipo: "herda" }]);
    expect(e.simbolos.map((s) => s.nome)).toEqual(["V", "~V", "operator=="]);
  });

  it("complexidade: default não conta; && e ||; ternário; while; do", async () => {
    const e = await ext("int f(int a) {\n switch (a) { case 1: break; case 2: break; default: break; }\n while (a && a > 1) {}\n do { a--; } while (a || 0);\n return a ? 1 : 2;\n}\n");
    expect(e.simbolos[0]?.complexidade).toBe(1 + 2 + 2 + 2 + 1);
  });

  it("getenv registra só o NOME; erro de sintaxe devolve erros_parse > 0; vazio não quebra", async () => {
    const e = await ext('void f() { getenv("TOKEN_Y"); }\nint ( {\n');
    expect(e.padroes).toEqual([{ tipo: "env", nome: "TOKEN_Y", linha: 1 }]);
    expect(e.erros_parse).toBeGreaterThan(0);
    expect((await ext("")).simbolos).toEqual([]);
  });
});
