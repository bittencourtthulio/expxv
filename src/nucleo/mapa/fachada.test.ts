import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../../../tests/fixtures/mapa/compilar";
import { escrever, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";
import { ErroConsulta } from "./consultas";
import { criarFachadaMapa, type FachadaMapa } from "./fachada";
import { criarServicoMapa, type ServicoMapaCompleto } from "./servico";

let dist = "";
const pastas: string[] = [];
const abertos: ServicoMapaCompleto[] = [];

beforeAll(() => {
  dist = compilarMapaParaTeste(["nucleo/mapa/index.ts", "nucleo/mapa/worker-extracao.ts", "nucleo/mapa/pool.ts", "nucleo/mapa/worker-derivada.ts"]);
});
afterEach(async () => {
  for (const s of abertos.splice(0)) await s.encerrar();
});
afterAll(() => {
  for (const p of pastas) removerPasta(p);
});

const BASE: Record<string, string> = {
  "package.json": JSON.stringify({ name: "demo", main: "src/a.ts", scripts: { test: "vitest" }, dependencies: { express: "^4.0.0" } }),
  "docs/LEIA.md": "docs do projeto\n",
  "src/a.ts": 'import { b } from "./b";\nexport function a(x: number): number {\n  return b(x) + 1;\n}\n',
  "src/b.ts": 'import { c } from "./c";\nexport function b(x: number): number {\n  return c(x) * 2;\n}\n',
  "src/c.ts": 'import { a } from "./a";\nexport function c(x: number): number {\n  if (x > 10) return a(x - 1);\n  return x;\n}\n',
  "src/a.test.ts": 'import { a } from "./a";\nit("a", () => { a(1); });\n',
  "src/rotas.ts": 'import express from "express";\nimport { a } from "./a";\nconst app = express();\napp.get("/ping", (req, res) => res.send(String(a(1))));\n',
  "src/db.ts": 'export function lerUsuarios(db: any) {\n  return db.query("SELECT id, nome FROM usuarios WHERE ativo = 1");\n}\n',
};

async function preparar(extra: Record<string, string> = {}): Promise<{ f: FachadaMapa; raiz: string; dados: string }> {
  const raiz = pastaTmp("ade-mapa-fch-");
  const dados = pastaTmp("ade-mapa-fch-db-");
  pastas.push(raiz, dados);
  for (const [c, t] of Object.entries({ ...BASE, ...extra })) escrever(raiz, c, t);
  const s = criarServicoMapa({
    raiz,
    caminhoDb: join(dados, "mapas", "ws_t", "mapa.db"),
    workspaceId: "ws_t",
    caminhoWorkerExtracao: join(dist, "nucleo/mapa/worker-extracao.js"),
    derivada: "inline",
    tamanhoPool: 2,
    ferramentas: () => ({ ctags: false, scc: false, dot: false }),
  });
  abertos.push(s);
  const f = criarFachadaMapa(s, { raiz, pastaExportacao: join(dados, "mapas", "ws_t", "exportacoes"), escolherPasta: async () => join(raiz, "docs", "saida") });
  await s.analisarEAguardar({ modo: "completo" });
  return { f, raiz, dados };
}

function arvore(raiz: string, sub: string): string[] {
  const base = join(raiz, sub);
  if (!existsSync(base)) return [];
  const saida: string[] = [];
  const andar = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) andar(p);
      else saida.push(`${relative(raiz, p)}:${readFileSync(p, "utf8").length}`);
    }
  };
  andar(base);
  return saida;
}

describe("fachada e consultas do mapa (T-17.33)", () => {
  it("grafo nos três níveis, com ciclo marcado e arestas por índice", async () => {
    const { f } = await preparar();
    const arq = f.grafo("arquivo");
    expect(arq.nos.map((n) => n.id)).toContain("arq:src/a.ts");
    const ia = arq.nos.findIndex((n) => n.id === "arq:src/a.ts");
    const ib = arq.nos.findIndex((n) => n.id === "arq:src/b.ts");
    expect(arq.arestas.some(([d, p, t, e]) => d === ia && p === ib && t === "importa" && e === 1)).toBe(true);
    expect(arq.nos.find((n) => n.id === "arq:src/a.ts")?.c).toBeDefined();
    expect(arq.truncado).toBe(false);
    const mod = f.grafo("modulo");
    expect(mod.nos.some((n) => n.id === "mod:src")).toBe(true);
    const sim = f.grafo("simbolo", { pasta: "src" });
    expect(sim.nos.some((n) => n.id === "sim:src/a.ts#a")).toBe(true);
    expect(sim.arestas.length).toBeGreaterThan(0);
    // filtro por ciclos e limite
    expect(f.grafo("arquivo", { so_ciclos: true }).nos.map((n) => n.r).sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(f.grafo("arquivo", {}, 2).truncado).toBe(true);
  }, 60_000);

  it("vizinhos, detalhe do nó e fluxo da rota até a tabela/externo", async () => {
    const { f } = await preparar();
    const v = f.vizinhos("arq:src/a.ts", "ambas", 1);
    expect(v.nos.map((n) => n.id)).toEqual(expect.arrayContaining(["arq:src/a.ts", "arq:src/b.ts"]));
    const d = f.no("arq:src/b.ts");
    expect(d?.arquivo?.linguagem).toBe("typescript");
    expect(d?.chamadores.some((x) => x.id === "arq:src/a.ts")).toBe(true);
    expect(f.no("arq:src/nao-existe.ts")).toBeNull();
    const entradas = f.analise("entradas").dados.itens;
    const rota = entradas.find((e) => e.chave === "GET /ping");
    expect(rota).toBeDefined();
    const fluxo = f.fluxo((rota as { id: string }).id, 6);
    expect(fluxo.nos.length).toBeGreaterThan(1);
    expect(fluxo.nos[0]?.nivel).toBe(0);
  }, 60_000);

  it("análises prontas: ciclos, camadas, sem teste, dados, externas, zonas, entradas", async () => {
    const { f } = await preparar();
    expect(f.analise("ciclos").dados.total).toBe(1);
    expect(f.analise("camadas").dados.modulos.length).toBeGreaterThan(0);
    expect(f.analise("sem_teste").dados.itens.some((i) => i.caminho === "src/b.ts")).toBe(true);
    expect(f.analise("dados", { tabela: "usuarios" }).dados.tabelas[0]?.nome).toBe("usuarios");
    expect(f.analise("externas").dados.itens.some((i) => i.nome === "express")).toBe(true);
    expect(f.analise("hotspots").dados.disponivel).toBe(false);
    expect(f.analise("mortos").dados.rotulo).toMatch(/candidato/);
    expect(f.analise("entradas", { limite: 1 }).truncado).toBe(true);
    expect(() => f.analise("invalida" as never)).toThrow(ErroConsulta);
  }, 60_000);

  it("raio: chamadores por arquivo, faixa provisória e nota; entradas inválidas são recusadas", async () => {
    const { f } = await preparar();
    const r = f.raio(["src/a.ts"]);
    expect(r.chamadores).toEqual(expect.arrayContaining(["src/rotas.ts"]));
    expect(["BAIXO", "MEDIO", "ALTO"]).toContain(r.faixa);
    expect(r.nota).toMatch(/provisório/);
    expect(r.sinais).toHaveLength(8);
    expect(() => f.raio(["/etc/passwd"])).toThrow(ErroConsulta);
    expect(() => f.raio(["../fora.ts"])).toThrow(ErroConsulta);
    expect(() => f.raio([".env"])).toThrow(ErroConsulta);
    expect(() => f.raio(["src/inexistente.ts"])).toThrow(/não está no mapa/);
    expect(() => f.raio(Array.from({ length: 51 }, (_, i) => `src/x${i}.ts`))).toThrow(ErroConsulta);
    expect(() => f.no("sim:../../etc/passwd#x")).toThrow(ErroConsulta);
    expect(() => f.grafo("arquivo", { pasta: "/etc" })).toThrow(ErroConsulta);
  }, 60_000);

  it("busca por prefixo e tipo; layout ida e volta; perfil provisório com a nota", async () => {
    const { f } = await preparar();
    expect(f.buscar("a").length).toBeGreaterThan(0);
    expect(f.buscar("lerUsu", ["simbolo"])[0]?.id).toBe("sim:src/db.ts#lerUsuarios");
    expect(f.buscar("")).toEqual([]);
    expect(f.layoutLer("k1")).toBeNull();
    f.layoutGravar("k1", "arquivo", [1, 2, 3.5, 4]);
    expect(f.layoutLer("k1")).toEqual({ nivel: "arquivo", posicoes: [1, 2, 3.5, 4] });
    expect(() => f.layoutGravar("../x", "arquivo", [1])).toThrow(ErroConsulta);
    expect(() => f.layoutGravar("k2", "arquivo", [Number.NaN])).toThrow(ErroConsulta);
    const p = f.perfil();
    expect(p.nota).toMatch(/provisório/);
    expect(p.stack.linguagens.length).toBeGreaterThan(0);
  }, 60_000);

  it("exportar: formatos sintaticamente válidos; destino dentro de docs/ é recusado; nada vai para docs/", async () => {
    const { f, raiz, dados } = await preparar();
    const antes = arvore(raiz, "docs");
    const vista = { tipo: "grafo", nivel: "arquivo" } as const;
    for (const formato of ["mermaid", "dot", "svg", "json", "csv"] as const) {
      const r = await f.exportar(formato, vista);
      expect(existsSync(r.caminho)).toBe(true);
      expect(r.caminho.startsWith(join(dados, "mapas", "ws_t", "exportacoes"))).toBe(true);
    }
    const md = await f.exportar("md", { tipo: "relatorio" });
    expect(readFileSync(md.caminho, "utf8")).toMatch(/Mapa lógico do código/);
    const svg = readFileSync(join(dados, "mapas", "ws_t", "exportacoes", "mapa.svg"), "utf8");
    expect(svg.startsWith("<?xml") || svg.startsWith("<svg")).toBe(true);
    await expect(f.exportar("mermaid", vista, "escolher")).rejects.toThrow(/não escreve em docs/);
    expect(arvore(raiz, "docs")).toEqual(antes);
    await expect(f.exportar("svg", { tipo: "relatorio" })).rejects.toThrow(ErroConsulta);
  }, 60_000);

  it("pacote de contexto: grava só em .expxv/mapa, com caminhos relativos, e mantém docs/ idêntico", async () => {
    const { f, raiz } = await preparar();
    const antes = arvore(raiz, "docs");
    const p = f.gerarPacote({ trabalho_id: "OC-1", arquivos: ["src/a.ts"] });
    expect(p.pasta_rel).toMatch(/^\.expxv\/mapa\/\d{8}T\d{6}Z$/);
    expect(p.arquivos).toEqual(expect.arrayContaining(["RESUMO.md", "inventario-stackx.json", "perfil-provisorio.json", "entradas.json", "arquivos.jsonl", "mudancas-desde-ultimo.json", "raio-OC-1.json"]));
    for (const n of p.arquivos) expect(readFileSync(join(raiz, p.pasta_rel, n), "utf8")).not.toContain(raiz);
    expect(readFileSync(join(raiz, ".expxv/.gitignore"), "utf8")).toBe("*\n");
    expect(arvore(raiz, "docs")).toEqual(antes);
    expect(f.resumo().pacote.carimbo).toBe(p.carimbo);
    mkdirSync(join(raiz, "x"), { recursive: true });
    writeFileSync(join(raiz, "x", ".keep"), "");
  }, 60_000);

  it("consulta com o mapa vazio devolve erro tipado (mapa_nao_pronto), nunca trava", async () => {
    const raiz = pastaTmp("ade-mapa-fch-vazio-");
    const dados = pastaTmp("ade-mapa-fch-db-");
    pastas.push(raiz, dados);
    const s = criarServicoMapa({ raiz, caminhoDb: join(dados, "m", "mapa.db"), workspaceId: "ws_v", derivada: "inline", ferramentas: () => ({ ctags: false, scc: false, dot: false }) });
    abertos.push(s);
    const f = criarFachadaMapa(s, { raiz, pastaExportacao: join(dados, "exp") });
    expect(() => f.grafo("arquivo")).toThrow(/ainda não foi analisado/);
    expect(f.resumo().estado).toBe("vazio");
    expect(f.analise("ciclos").dados.total).toBe(0);
    expect(() => f.gerarPacote()).toThrow(ErroConsulta);
  });
});
