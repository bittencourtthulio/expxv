import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { detectarLinguagem } from "../linguagens";
import { extrairArquivo } from "./registro";

// T-17.08: gabarito `esperado.json` das fixtures Python (100% do gabarito, sem armadilhas).

const gab = carregarGabarito("python");
describe("extrator Python: fixtures", () => {
  for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
    it(`${caminho}: 100% do gabarito e nenhuma armadilha`, async () => {
      const texto = lerFixture("python", caminho);
      const e = await extrairArquivo(texto, detectarLinguagem(caminho, texto.split("\n")[0])!, caminho);
      expect(compararComGabarito(e, esperado)).toEqual([]);
    });
  }
  it("arquivo com erro de sintaxe: erros_parse > 0 sem lançar", async () => {
    const texto = lerFixture("python", "app/quebrado.py");
    const e = await extrairArquivo(texto, "python", "app/quebrado.py");
    expect(e.erros_parse).toBeGreaterThan(0);
  });
});

describe("extrator Python: casos de borda", () => {
  const ext = (t: string, c = "pkg/x.py") => extrairArquivo(t, "python", c);

  it("arquivo vazio e só comentário", async () => {
    expect((await ext("")).loc).toBe(0);
    const c = await ext("# nada\n");
    expect(c.loc_comentario).toBe(1);
    expect(c.simbolos).toEqual([]);
  });

  it("except com corpo real não é catch vazio; except com ... é", async () => {
    const e = await ext("try:\n    a()\nexcept ValueError:\n    log()\ntry:\n    b()\nexcept:\n    ...\n");
    expect(e.padroes.filter((p) => p.tipo === "catch_vazio").map((p) => p.linha)).toEqual([7]);
  });

  it("os.environ['X'] e os.getenv só registram o NOME; valor nunca aparece", async () => {
    const e = await ext('t = os.environ["SEGREDO_X"]\nu = os.getenv("OUTRO", "padrao-secreto")\nv = os.environ.get(chave)\n');
    expect(e.padroes).toEqual([
      { tipo: "env", nome: "SEGREDO_X", linha: 1 },
      { tipo: "env", nome: "OUTRO", linha: 2 },
    ]);
    expect(JSON.stringify(e)).not.toContain("padrao-secreto");
  });

  it("literais de texto saem da assinatura e do decorador", async () => {
    const e = await ext('@x("senha123")\ndef f(a="token-abc"):\n    pass\n');
    expect(JSON.stringify(e)).not.toContain("senha123");
    expect(JSON.stringify(e)).not.toContain("token-abc");
  });

  it("caracteres não ASCII não deslocam linhas", async () => {
    const e = await ext('# ção\ndef nãoAscii(á):\n    """Docção."""\n');
    const s = e.simbolos.find((x) => x.nome === "nãoAscii");
    expect(s?.linha).toBe(2);
    expect(s?.doc).toBe("Docção.");
  });

  it("teto de símbolos: acima de 5 000 corta e marca truncado", async () => {
    const e = await ext(Array.from({ length: 5100 }, (_, i) => `def f${i}(): pass`).join("\n"));
    expect(e.simbolos).toHaveLength(5000);
    expect(e.truncado).toBe(true);
  });

  it("duplicata ganha ~2", async () => {
    const e = await ext("def f(): pass\ndef f(): pass\n");
    expect(e.simbolos.map((s) => s.qualificado)).toEqual(["f", "f~2"]);
  });

  it("complexidade: elif, comprehension com if, and/or, except e ternário", async () => {
    const e = await ext("def f(x):\n    if x: a = 1\n    elif x and x: a = 2\n    y = [i for i in x if i]\n    return 1 if y else 2\n");
    expect(e.simbolos[0]?.complexidade).toBe(7);
  });

  it("SQL em prosa nunca vira tabela; f-string com interpolação vira heurística", async () => {
    const e = await ext('a = "Select an item from the cart"\nb = f"DELETE FROM pedidos WHERE id = {i}"\n');
    expect(e.dados).toEqual([{ tabela: "pedidos", operacao: "escreve", de: null, linha: 2, confianca: "heuristica", fonte: "sql" }]);
  });

  it("docstring com SQL no texto não vira acesso a dados", async () => {
    const e = await ext('def f():\n    """SELECT a, b FROM tabela_doc t"""\n');
    expect(e.dados).toEqual([]);
  });

  it("segredo no comentário de doc é redigido", async () => {
    const e = await ext('def f():\n    """password: abc123 usado aqui"""\n');
    expect(e.simbolos[0]?.doc).not.toContain("abc123");
  });
});

describe("extrator Python: referência cruzada com o `ast` do python3", () => {
  it("imports e símbolos de topo coincidem com o `ast`", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const teste = spawnSync("python3", ["-c", "import ast"]);
    if (teste.status !== 0) return; // sem python3: pula
    const dir = mkdtempSync(join(tmpdir(), "mapa-py-"));
    try {
      const arq = join(dir, "s.py");
      writeFileSync(arq, lerFixture("python", "app/servico.py"));
      const script =
        "import ast,json,sys\nt=ast.parse(open(sys.argv[1]).read())\nimps=[]\nfor n in ast.walk(t):\n if isinstance(n,ast.Import):\n  for a in n.names: imps.append(a.name)\n elif isinstance(n,ast.ImportFrom): imps.append('.'*n.level+(n.module or ''))\ntop=[n.name for n in t.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))]\nprint(json.dumps({'imps':sorted(set(imps)),'top':top}))\n";
      const r = spawnSync("python3", ["-c", script, arq], { encoding: "utf8" });
      expect(r.status).toBe(0);
      const ref = JSON.parse(r.stdout) as { imps: string[]; top: string[] };
      const e = await extrairArquivo(lerFixture("python", "app/servico.py"), "python", "app/servico.py");
      const nossos = [...new Set(e.imports.filter((i) => i.tipo === "estatico").map((i) => i.especificador))].sort();
      expect(nossos).toEqual(ref.imps);
      expect(e.simbolos.filter((s) => !s.qualificado.includes(".") && s.tipo !== "constante").map((s) => s.nome)).toEqual(ref.top);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
