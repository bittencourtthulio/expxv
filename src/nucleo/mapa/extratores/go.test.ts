import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { detectarLinguagem } from "../linguagens";
import { extrairArquivo } from "./registro";

// T-17.12 (Go): gabarito `esperado.json` das fixtures, casos de borda e referência cruzada com `go/parser` (se houver `go`).

const gab = carregarGabarito("go");
describe("extrator Go: fixtures", () => {
  for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
    it(`${caminho}: 100% do gabarito e nenhuma armadilha`, async () => {
      const texto = lerFixture("go", caminho);
      const e = await extrairArquivo(texto, detectarLinguagem(caminho)!, caminho);
      expect(compararComGabarito(e, esperado)).toEqual([]);
    });
  }
});

describe("extrator Go: casos de borda", () => {
  const ext = (texto: string, caminho = "x.go") => extrairArquivo(texto, "go", caminho);

  it("import ponto e em branco viram alias `.` e `_`; fábrica de genéricos e alias de tipo", async () => {
    const e = await ext('package x\nimport (\n\t. "a/b"\n\t_ "c/d"\n)\ntype A = string\nfunc G[T any](x T) T { return x }\nfunc k() { _ = G[int](1) }\n');
    expect(e.imports.map((i) => [i.especificador, i.nomes[0]?.alias])).toEqual([["a/b", "."], ["c/d", "_"]]);
    expect(e.simbolos.map((s) => `${s.tipo}:${s.qualificado}`)).toEqual(["tipo:A", "funcao:G", "funcao:k"]);
    expect(e.chamadas.some((c) => c.alvo === "G" && c.de === "k")).toBe(true);
  });

  it("net/http com padrão de método do Go 1.22 e mux.Handle com receptor desconhecido", async () => {
    const e = await ext('package x\nimport "net/http"\nfunc f(mux *http.ServeMux) { mux.HandleFunc("GET /a/{id}", h) }\n');
    expect(e.entradas).toMatchObject([{ chave: "GET /a/{id}", framework: "net/http", handler: "h" }]);
  });

  it("rota sem framework conhecido é heurística", async () => {
    const e = await ext('package x\nfunc f() { r.GET("/x", h) }\n');
    expect(e.entradas).toMatchObject([{ chave: "GET /x", framework: "go-http", confianca: "heuristica" }]);
  });

  it("complexidade: switch, select e operadores lógicos", async () => {
    const e = await ext("package x\nfunc f(a, b int, z any) {\n if a > 0 || b > 0 {}\n switch a { case 1: case 2: }\n switch z.(type) { case int: }\n select { case <-c: }\n}\n");
    expect(e.simbolos[0]?.complexidade).toBe(1 + 2 + 2 + 1 + 1);
  });

  it("SQL com verbo de formato é heurístico; frase comum nunca vira tabela", async () => {
    const e = await ext('package x\nfunc f() { q(fmt.Sprintf("DELETE FROM %s WHERE id = 1", t)); s := "Select all items from the cart please" }\n');
    expect(e.dados.every((d) => d.confianca === "heuristica")).toBe(true);
    expect(e.dados.some((d) => d.tabela === "the")).toBe(false);
  });

  it("erro de sintaxe devolve erros_parse > 0; arquivo vazio não quebra", async () => {
    const e = await ext("package x\nfunc ok() {}\nfunc ( {\n");
    expect(e.erros_parse).toBeGreaterThan(0);
    expect(e.simbolos.some((s) => s.qualificado === "ok")).toBe(true);
    expect((await ext("")).simbolos).toEqual([]);
  });

  it("os.Getenv registra só o NOME", async () => {
    const e = await ext('package x\nfunc f() { _ = os.Getenv("TOKEN_X") }\n');
    expect(e.padroes).toEqual([{ tipo: "env", nome: "TOKEN_X", linha: 2 }]);
  });
});

const temGo = spawnSync("go", ["version"]).status === 0;
describe.skipIf(!temGo)("extrator Go: referência cruzada com go/parser", () => {
  it("imports, funções e tipos de cada fixture batem com a biblioteca padrão do Go", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mapa-go-"));
    try {
      mkdirSync(join(dir, "ref"));
      writeFileSync(join(dir, "go.mod"), "module ref\n\ngo 1.21\n");
      writeFileSync(
        join(dir, "ref", "main.go"),
        `package main
import ("encoding/json";"go/ast";"go/parser";"go/token";"os";"strings")
func main() {
  out := map[string]any{}
  for _, f := range os.Args[1:] {
    b, _ := os.ReadFile(f)
    fs := token.NewFileSet()
    a, err := parser.ParseFile(fs, f, b, 0)
    if err != nil { continue }
    var imps, fns, tipos []string
    for _, i := range a.Imports { imps = append(imps, strings.Trim(i.Path.Value, "\\"\`")) }
    for _, d := range a.Decls {
      switch x := d.(type) {
      case *ast.FuncDecl:
        n := x.Name.Name
        if x.Recv != nil && len(x.Recv.List) > 0 {
          t := x.Recv.List[0].Type
          if s, ok := t.(*ast.StarExpr); ok { t = s.X }
          if id, ok := t.(*ast.Ident); ok { n = id.Name + "." + n }
        }
        fns = append(fns, n)
      case *ast.GenDecl:
        for _, s := range x.Specs { if ts, ok := s.(*ast.TypeSpec); ok { tipos = append(tipos, ts.Name.Name) } }
      }
    }
    out[f] = map[string]any{"imports": imps, "fns": fns, "tipos": tipos}
  }
  json.NewEncoder(os.Stdout).Encode(out)
}
`,
      );
      const arquivos = Object.keys(gab.arquivos);
      const absolutos = arquivos.map((a) => {
        const p = join(dir, a.replace(/\//g, "_"));
        writeFileSync(p, lerFixture("go", a));
        return p;
      });
      const r = spawnSync("go", ["run", "./ref", ...absolutos], { cwd: dir, encoding: "utf8", env: { ...process.env, GOFLAGS: "-mod=mod", GOTOOLCHAIN: "local" } });
      expect(r.status, r.stderr).toBe(0);
      const ref = JSON.parse(r.stdout) as Record<string, { imports: string[]; fns: string[]; tipos: string[] }>;
      for (const [i, a] of arquivos.entries()) {
        const e = await extrairArquivo(lerFixture("go", a), "go", a);
        const esperado = ref[absolutos[i] as string]!;
        expect(e.imports.map((x) => x.especificador).sort()).toEqual([...(esperado.imports ?? [])].sort());
        expect(e.simbolos.filter((s) => s.tipo === "funcao" || s.tipo === "metodo").map((s) => s.qualificado).sort()).toEqual([...(esperado.fns ?? [])].sort());
        expect(e.simbolos.filter((s) => s.tipo === "struct" || s.tipo === "interface" || s.tipo === "tipo").map((s) => s.qualificado).sort()).toEqual([...(esperado.tipos ?? [])].sort());
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
