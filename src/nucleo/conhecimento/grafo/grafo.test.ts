import { describe, expect, it } from "vitest";
import { doc, novoServico } from "../../../../tests/fixtures/conhecimento/util";
import { caminhosCitados, extrair, importsResolvidos } from "./extrator";
import { detalheNo, documentosVizinhos, recalcularPesos, subgrafo } from "./consultas";
import { posicionarInicial } from "./posicoes";

const ARQUIVOS = new Set(["src/exportar.ts", "src/util/data.ts", "src/util/index.ts", "docs/plano.md", "pkg/mod.py", "pkg/outro.py"]);

describe("extrator determinístico", () => {
  it("resolve caminhos contra git ls-files, T-NN.MM, OC-, D-NN, SHA e #PR", () => {
    const g = extrair(doc({ tipo: "relatorio", origem: "docs/relatorios/r1.md", titulo: "Relatório", texto: "Alteramos src/exportar.ts (T-03.02). Ver OC-2026-01, D-45 e commit 3f2a9c1de (#128). Também citei src/inexistente.ts e https://x.com/a/b.ts", task_ref: "T-03.02", mission_id: "mis_1" }), { arquivos: ARQUIVOS });
    const chaves = g.nos.map((n) => `${n.tipo}:${n.chave}`);
    expect(chaves).toEqual(expect.arrayContaining(["relatorio:docs/relatorios/r1.md", "arquivo:src/exportar.ts", "task:T-03.02", "ocorrencia:OC-2026-01", "decisao:D-45", "commit:3f2a9c1de", "pr:128", "missao:mis_1"]));
    expect(chaves).not.toContain("arquivo:src/inexistente.ts");
    expect(chaves.some((c) => c.includes("x.com"))).toBe(false);
    expect(g.arestas.some((a) => a.tipo === "pertence" && a.para.chave === "mis_1")).toBe(true);
  });
  it("commit fix liga `corrigiu` aos arquivos; commit comum usa `toca`", () => {
    const fix = extrair(doc({ tipo: "commit", origem: "commit:abc1234", titulo: "fix: corrige src/exportar.ts", texto: "", arquivos: ["src/exportar.ts"] }), { arquivos: ARQUIVOS });
    expect(fix.arestas.filter((a) => a.para.chave === "src/exportar.ts").map((a) => a.tipo)).toEqual(["corrigiu"]);
    const feat = extrair(doc({ tipo: "commit", origem: "commit:abc1234", titulo: "feat: nova rota", texto: "", arquivos: ["src/exportar.ts"] }), { arquivos: ARQUIVOS });
    expect(feat.arestas.filter((a) => a.para.chave === "src/exportar.ts").map((a) => a.tipo)).toEqual(["toca"]);
  });
  it("agente executou sessão; código vira nó arquivo + símbolos + depende por import", () => {
    const g = extrair(doc({ tipo: "transcricao", origem: "sessao:s1#0", titulo: "x", texto: "mexi em src/exportar.ts", agente: "claude·opus" }), { arquivos: ARQUIVOS });
    expect(g.arestas.some((a) => a.tipo === "executou" && a.de.chave === "claude·opus")).toBe(true);
    const c = extrair(doc({ tipo: "codigo", formato: "codigo", origem: "src/exportar.ts", titulo: "src/exportar.ts", texto: 'import { f } from "./util/data";\nexport function exportar() {}\n' }), { arquivos: ARQUIVOS });
    expect(c.nos.map((n) => `${n.tipo}:${n.chave}`)).toEqual(expect.arrayContaining(["arquivo:src/exportar.ts", "simbolo:src/exportar.ts#exportar", "arquivo:src/util/data.ts"]));
    expect(c.arestas.some((a) => a.tipo === "depende" && a.para.chave === "src/util/data.ts")).toBe(true);
  });
  it("imports relativos TS/JS/Python resolvem; fora do conjunto não", () => {
    expect(importsResolvidos("src/exportar.ts", 'import a from "./util/data.js"; import b from "./util"; import c from "./nada"; import d from "react"', ARQUIVOS).sort()).toEqual(["src/util/data.ts", "src/util/index.ts"]);
    expect(importsResolvidos("pkg/mod.py", "from .outro import x\nfrom os import path\n", ARQUIVOS)).toEqual(["pkg/outro.py"]);
  });
  it("caminhosCitados sem conjunto conhecido exige diretório e extensão; nunca absoluto", () => {
    expect(caminhosCitados("veja src/a/b.ts e /etc/passwd e ../x/y.ts e a.ts", null)).toEqual(["src/a/b.ts"]);
  });
});

describe("grafo no serviço: subgrafo, detalhe, vizinhos, posições", () => {
  it("ingestão cria nós/arestas com proveniência; detalhe do nó cita as fontes", async () => {
    const { s, fechar } = novoServico({ arquivosConhecidos: () => ARQUIVOS });
    await s.pipeline.ingerir(s.colecaoId, doc({ tipo: "task", origem: "task:T-03.02", titulo: "T-03.02", texto: "Tocou src/exportar.ts e src/util/data.ts", task_ref: "T-03.02", mission_id: "mis_1" }));
    await s.pipeline.ingerir(s.colecaoId, doc({ tipo: "relatorio", origem: "docs/relatorios/r.md", titulo: "R", texto: "Relatório sobre src/exportar.ts" }));
    const sg = s.subgrafo({});
    const arq = sg.nos.find((n) => n.rotulo === "src/exportar.ts");
    expect(arq).toBeDefined();
    const d = s.detalheNo(arq?.id as string);
    expect(d?.fontes.map((f) => f.origem).sort()).toEqual(["docs/relatorios/r.md", "task:T-03.02"]);
    expect(d?.vizinhos.length).toBeGreaterThanOrEqual(2);
    // filtros
    expect(s.subgrafo({ tipos: ["task"] }).nos.every((n) => n.tipo === "task")).toBe(true);
    expect(s.subgrafo({ mission_id: "mis_1" }).nos.length).toBeGreaterThan(0);
    expect(s.subgrafo({ foco_no_id: arq?.id as string, saltos: 1 }).nos.length).toBeGreaterThanOrEqual(3);
    expect(s.subgrafo({ desde: "2999-01-01T00:00:00.000Z" }).nos).toHaveLength(0);
    // vizinhança de documentos (braço de grafo)
    const viz = documentosVizinhos(s.repos, s.colecaoId, { arquivos: ["src/exportar.ts"] });
    expect(viz.length).toBe(2);
    // esquecer o documento remove nós órfãos
    s.esquecer({ origem: "docs/relatorios/r.md" });
    expect(s.detalheNo(arq?.id as string)?.fontes.map((f) => f.origem)).toEqual(["task:T-03.02"]);
    expect(recalcularPesos(s.repos, s.colecaoId)).toBeGreaterThan(0);
    // posições persistidas
    const nos = s.subgrafo({}).nos;
    const pos = posicionarInicial(nos);
    expect(s.gravarPosicoes([...pos, { id: nos[0]?.id as string, x: NaN, y: 1 }])).toBe(pos.length);
    expect(s.subgrafo({}).nos.every((n) => n.x !== null || n.id.startsWith("agg:"))).toBe(true);
    expect(posicionarInicial(s.subgrafo({}).nos)).toEqual([]); // já posicionados
    fechar();
  });
  it("teto de nós com AGREGAÇÃO por tipo (truncado)", async () => {
    const { s, fechar } = novoServico();
    for (let i = 0; i < 40; i++) s.repos.grafo.upsertNo({ colecao_id: s.colecaoId, tipo: "arquivo", chave: `f${i}.ts`, rotulo: `f${i}`, quando: "2026-09-01T00:00:00.000Z" });
    const sg = s.subgrafo({ max_nos: 10 });
    expect(sg.truncado).toBe(true);
    expect(sg.nos.some((n) => n.id === "agg:arquivo")).toBe(true);
    fechar();
  });
});
