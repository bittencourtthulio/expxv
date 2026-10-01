import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, limpar } from "../../../tests/fixtures/dominio/ambiente";
import { MEMOX_SCRIPT, consultarMemox, proporcaoPedidosSemTrabalho } from "./memox";
import type { IndiceProjeto } from "./tipos";

afterEach(limpar);

function projetoComMemox(script: string | null): string {
  const raiz = criarTmp("memox-");
  if (script !== null) {
    mkdirSync(join(raiz, ".claude/skills/memox/assets"), { recursive: true });
    writeFileSync(join(raiz, MEMOX_SCRIPT), script);
  }
  return raiz;
}

const SCRIPT_OK = `
import sys, json
if sys.argv[1] == "estado":
    print("memox — estado do indice\\n  3 trabalhos indexados")
elif sys.argv[1] == "arquivo":
    print(json.dumps({"tipo": "arquivo", "alvo": sys.argv[2], "regressoes": 2}))
else:
    sys.exit(2)
`;

describe("memox (leitura)", () => {
  it("ausente é estado normal, não erro", async () => {
    const r = await consultarMemox(projetoComMemox(null), { tipo: "estado" });
    expect(r).toMatchObject({ estado: "ausente", aviso: null });
    expect(r.texto).toBeNull();
  });

  it("estado: devolve o texto do memox", async () => {
    const r = await consultarMemox(projetoComMemox(SCRIPT_OK), { tipo: "estado" });
    expect(r.estado).toBe("ok");
    expect(r.texto).toContain("3 trabalhos indexados");
  });

  it("arquivo: devolve o JSON do memox", async () => {
    const r = await consultarMemox(projetoComMemox(SCRIPT_OK), { tipo: "arquivo", caminho: "src/a.ts" });
    expect(r).toMatchObject({ estado: "ok", dados: { tipo: "arquivo", alvo: "src/a.ts", regressoes: 2 } });
  });

  it("lento: estoura o timeout e vira aviso discreto (processo morto)", async () => {
    const raiz = projetoComMemox("import time\ntime.sleep(10)\n");
    const t0 = Date.now();
    const r = await consultarMemox(raiz, { tipo: "estado" }, { timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(2_500);
    expect(r.estado).toBe("lento");
    expect(r.aviso).toMatch(/demorou/);
  });

  it("timeout padrão é de 2 s", async () => {
    const raiz = projetoComMemox("import time\ntime.sleep(10)\n");
    const t0 = Date.now();
    const r = await consultarMemox(raiz, { tipo: "estado" });
    const gasto = Date.now() - t0;
    expect(r.estado).toBe("lento");
    expect(gasto).toBeGreaterThanOrEqual(1_900);
    expect(gasto).toBeLessThan(4_000);
  });

  it("saída inválida: JSON quebrado, vazia ou sem o formato esperado", async () => {
    const quebrado = await consultarMemox(projetoComMemox('print("{nao eh json")'), { tipo: "arquivo", caminho: "a.ts" });
    expect(quebrado.estado).toBe("saida_invalida");
    const semTipo = await consultarMemox(projetoComMemox('print("[1,2]")'), { tipo: "arquivo", caminho: "a.ts" });
    expect(semTipo.estado).toBe("saida_invalida");
    const vazia = await consultarMemox(projetoComMemox(""), { tipo: "estado" });
    expect(vazia.estado).toBe("saida_invalida");
    const binario = await consultarMemox(projetoComMemox('import sys\nsys.stdout.write("memox\\x00lixo")'), { tipo: "estado" });
    expect(binario.estado).toBe("saida_invalida");
  });

  it("erro do script (exit != 0) vira aviso, sem vazar stderr cru", async () => {
    const r = await consultarMemox(projetoComMemox('import sys\nsys.stderr.write("/Users/x/segredo traceback")\nsys.exit(1)'), { tipo: "estado" });
    expect(r.estado).toBe("erro");
    expect(r.aviso).not.toContain("/Users/x/segredo");
  });

  it("recusa caminho perigoso antes de chamar o script", async () => {
    const raiz = projetoComMemox(SCRIPT_OK);
    for (const caminho of ["--help", "../fora.ts", "/etc/passwd", "a\0b", "", "a\nb"]) {
      const r = await consultarMemox(raiz, { tipo: "arquivo", caminho });
      expect(r.estado).toBe("erro");
      expect(r.aviso).toMatch(/caminho/i);
    }
  });

  it("não escreve nada na árvore do projeto", async () => {
    const raiz = projetoComMemox(SCRIPT_OK);
    await consultarMemox(raiz, { tipo: "estado" });
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(raiz)).toEqual([".claude"]);
    expect(readdirSync(join(raiz, ".claude/skills/memox/assets"))).toEqual(["memox.py"]); // sem __pycache__
  });

  it("o ambiente do script não carrega segredos do app (só o mínimo)", async () => {
    process.env["SEGREDO_DE_TESTE_TOKEN"] = "valor-secreto";
    try {
      const raiz = projetoComMemox('import os\nprint("memox — ok " + str("SEGREDO_DE_TESTE_TOKEN" in os.environ))');
      const r = await consultarMemox(raiz, { tipo: "estado" });
      expect(r.texto).toContain("False");
    } finally {
      delete process.env["SEGREDO_DE_TESTE_TOKEN"];
    }
  });
});

describe("proporção de pedidos prodx que não viram trabalho", () => {
  const indice = (pedidos: Array<string | null>): IndiceProjeto =>
    ({ trabalhos: pedidos.map((v, i) => ({ id: `PD-${i}`, tipo: "pedido", prodx: { veredito: v, assinado: false, briefing: false } })) }) as unknown as IndiceProjeto;

  it("conta só pedidos com veredito; 'fazer' vira trabalho, o resto não", () => {
    expect(proporcaoPedidosSemTrabalho(indice(["fazer", "nao_fazer", "ja_existe", null]))).toEqual({ total: 3, sem_trabalho: 2, proporcao: 2 / 3 });
    expect(proporcaoPedidosSemTrabalho(indice([]))).toEqual({ total: 0, sem_trabalho: 0, proporcao: null });
  });
});
