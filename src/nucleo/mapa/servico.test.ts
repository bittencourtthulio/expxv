import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../../../tests/fixtures/mapa/compilar";
import { commit, escrever, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";
import { CONFIG_MAPA_PADRAO, type EventoMapaIpc } from "../../compartilhado/mapa";
import { criarServicoMapa, normalizarConfig, type ServicoMapaCompleto } from "./servico";

let dist = "";
const pastas: string[] = [];
const servicos: ServicoMapaCompleto[] = [];

beforeAll(() => {
  isolarConfigGit();
  dist = compilarMapaParaTeste(["nucleo/mapa/index.ts", "nucleo/mapa/worker-extracao.ts", "nucleo/mapa/pool.ts", "nucleo/mapa/worker-derivada.ts"]);
});

afterEach(async () => {
  for (const s of servicos.splice(0)) await s.encerrar();
});
afterAll(() => {
  for (const p of pastas) removerPasta(p);
});

function projeto(arquivos: Record<string, string>, git = false): { raiz: string; dados: string } {
  const raiz = pastaTmp("ade-mapa-srv-");
  const dados = pastaTmp("ade-mapa-db-");
  pastas.push(raiz, dados);
  if (git) initRepo(raiz, false);
  for (const [c, t] of Object.entries(arquivos)) escrever(raiz, c, t);
  if (git) commit(raiz, "inicial");
  return { raiz, dados };
}

function novo(p: { raiz: string; dados: string }, extra: Partial<Parameters<typeof criarServicoMapa>[0]> = {}): { s: ServicoMapaCompleto; eventos: EventoMapaIpc[] } {
  const eventos: EventoMapaIpc[] = [];
  const s = criarServicoMapa({
    raiz: p.raiz,
    caminhoDb: join(p.dados, "mapas", "ws_teste", "mapa.db"),
    workspaceId: "ws_teste",
    caminhoWorkerExtracao: join(dist, "nucleo/mapa/worker-extracao.js"),
    caminhoWorkerDerivada: join(dist, "nucleo/mapa/worker-derivada.js"),
    derivada: "inline",
    tamanhoPool: 2,
    emitir: (e) => eventos.push(e),
    ferramentas: () => ({ ctags: false, scc: false, dot: false }),
    ...extra,
  });
  servicos.push(s);
  return { s, eventos };
}

const BASE: Record<string, string> = {
  "package.json": JSON.stringify({ name: "demo", main: "src/a.ts", scripts: { test: "vitest" }, dependencies: { express: "^4.0.0" } }),
  "src/a.ts": 'import { b } from "./b";\nexport function a(x: number): number {\n  return b(x) + 1;\n}\n',
  "src/b.ts": 'import { c } from "./c";\nexport function b(x: number): number {\n  return c(x) * 2;\n}\n',
  "src/c.ts": 'import { a } from "./a";\nexport function c(x: number): number {\n  if (x > 10) return a(x - 1);\n  return x;\n}\n',
  "src/a.test.ts": 'import { a } from "./a";\nit("a", () => { a(1); });\n',
  "src/rotas.ts": 'import express from "express";\nimport { a } from "./a";\nconst app = express();\napp.get("/ping", (req, res) => res.send(String(a(1))));\n',
};

function arestas(s: ServicoMapaCompleto): string[] {
  return s
    .armazem()
    .banco.consultar<{ tipo: string; de: string; para: string; confianca: string }>("SELECT tipo, de, para, confianca FROM aresta ORDER BY tipo, de, para")
    .map((l) => `${l.tipo}|${l.de}|${l.para}|${l.confianca}`);
}

describe("serviço do mapa (T-17.21)", () => {
  it("análise completa: extrai, resolve imports, detecta ciclo, entrada, teste e externo; versao_mapa sobe", async () => {
    const p = projeto(BASE);
    const { s, eventos } = novo(p);
    expect(s.resumo().estado).toBe("vazio");
    const r = await s.analisarEAguardar({ modo: "completo" });
    expect(r.estado).toBe("concluida");
    expect(r.novos).toBe(5);
    expect(r.extraidos).toBe(5);
    expect(r.falhas).toBe(0);
    expect(r.versao_mapa).toBeGreaterThanOrEqual(1);
    const a = arestas(s);
    expect(a).toContain("importa|arq:src/a.ts|arq:src/b.ts|exata");
    expect(a).toContain("importa|arq:src/rotas.ts|ext:npm:express|exata");
    expect(a.some((x) => x.startsWith("testa|arq:src/a.test.ts|arq:src/a.ts"))).toBe(true);
    const ciclos = s.armazem().lerAnaliseCache<{ ciclos: Array<{ tamanho: number }>; total: number }>("analise:ciclos");
    expect(ciclos?.total).toBe(1);
    expect(ciclos?.ciclos[0]?.tamanho).toBe(3);
    const entradas = s.armazem().lerAnaliseCache<{ itens: Array<{ chave: string }> }>("analise:entradas");
    expect(entradas?.itens.map((e) => e.chave)).toContain("GET /ping");
    const resumo = s.resumo();
    expect(resumo.estado).toBe("pronto");
    expect(resumo.arquivos).toBe(5);
    expect(resumo.arestas.exata).toBeGreaterThan(0);
    expect(resumo.analisando).toBe(false);
    expect(eventos.some((e) => e.tipo === "mudou")).toBe(true);
    expect(eventos.some((e) => e.tipo === "progresso")).toBe(true);
  }, 60_000);

  it("incremental: sem mudança = 0 extrações e mesma versão; mudar 1 arquivo = 1 extração", async () => {
    const p = projeto(BASE);
    const { s } = novo(p);
    const r1 = await s.analisarEAguardar({ modo: "completo" });
    const r2 = await s.analisarEAguardar({ modo: "incremental" });
    expect(r2.extraidos).toBe(0);
    expect(r2.inalterados).toBe(5);
    expect(r2.versao_mapa).toBe(r1.versao_mapa);
    writeFileSync(join(p.raiz, "src/c.ts"), "export function c(x: number): number {\n  return x + 1;\n}\n");
    const r3 = await s.analisarEAguardar({ modo: "incremental" });
    expect(r3.alterados).toBe(1);
    expect(r3.extraidos).toBe(1);
    expect(r3.versao_mapa).toBeGreaterThan(r1.versao_mapa);
    // o ciclo desapareceu junto com a aresta c -> a
    expect(s.armazem().lerAnaliseCache<{ total: number }>("analise:ciclos")?.total).toBe(0);
    expect(arestas(s)).not.toContain("importa|arq:src/c.ts|arq:src/a.ts|exata");
  }, 60_000);

  it("incremental por LISTA (observador): só olha os caminhos citados, descarta os perigosos e emite `mudou` já na etapa 1", async () => {
    const p = projeto(BASE);
    const { s, eventos } = novo(p);
    const r1 = await s.analisarEAguardar({ modo: "completo" });
    writeFileSync(join(p.raiz, "src/c.ts"), "export function c(x: number): number {\n  return x + 1;\n}\n");
    writeFileSync(join(p.raiz, "src/b.ts"), "export function b(x: number): number {\n  return x + 2;\n}\n"); // mudou, mas NÃO foi citado
    const antes = eventos.filter((e) => e.tipo === "mudou").length;
    const r2 = await s.analisarEAguardar({ modo: "incremental", arquivos: ["src/c.ts", "../fora.ts", "/etc/passwd", "src/nao-existe.ts"] });
    expect(r2.estado).toBe("concluida");
    expect(r2.alterados).toBe(1);
    expect(r2.extraidos).toBe(1);
    expect(r2.novos).toBe(0);
    expect(r2.removidos).toBe(0);
    expect(r2.versao_mapa).toBeGreaterThan(r1.versao_mapa);
    expect(eventos.filter((e) => e.tipo === "mudou").length - antes).toBe(2); // etapa 1 (nós) e fim da derivada
    // o arquivo não citado continua como estava; a varredura incremental completa o pega depois
    expect(s.armazem().lerExtracao("src/b.ts")?.imports.length).toBe(1);
    const r3 = await s.analisarEAguardar({ modo: "incremental" });
    expect(r3.alterados).toBe(1);
    expect(s.armazem().lerExtracao("src/b.ts")?.imports.length).toBe(0);
    // remoção por lista
    rmSync(join(p.raiz, "src/c.ts"));
    const r4 = await s.analisarEAguardar({ modo: "incremental", arquivos: ["src/c.ts"] });
    expect(r4.removidos).toBe(1);
    expect(s.armazem().no("arq:src/c.ts")).toBeUndefined();
  }, 60_000);

  it("verificarMudancas conta o que mudou de fato (sem extrair) e a análise por lista consome a contagem", async () => {
    const p = projeto(BASE);
    const { s } = novo(p);
    await s.analisarEAguardar({ modo: "completo" });
    expect((await s.verificarMudancas()).alterados_n).toBe(0);
    writeFileSync(join(p.raiz, "src/c.ts"), "export function c(): number {\n  return 7;\n}\n");
    escrever(p.raiz, "src/novo.ts", "export const n = 1;\n");
    rmSync(join(p.raiz, "src/a.test.ts"));
    expect((await s.verificarMudancas()).alterados_n).toBe(3);
    expect(s.resumo().desatualizado).toBe(true);
    expect(s.listaAlterados().sort()).toEqual(["src/a.test.ts", "src/c.ts", "src/novo.ts"]);
    const r = await s.analisarEAguardar({ modo: "incremental", arquivos: s.listaAlterados() });
    expect([r.novos, r.alterados, r.removidos]).toEqual([1, 1, 1]);
    expect((await s.verificarMudancas()).alterados_n).toBe(0);
    expect(s.resumo().desatualizado).toBe(false);
  }, 60_000);

  it("arquivo novo resolve import antes pendente; arquivo removido remove nós e arestas", async () => {
    const p = projeto({ ...BASE, "src/d.ts": 'import { novo } from "./novo";\nexport const d = novo();\n' });
    const { s } = novo(p);
    await s.analisarEAguardar({ modo: "completo" });
    expect(arestas(s).some((x) => x.startsWith("importa|arq:src/d.ts|arq:src/novo.ts"))).toBe(false);
    escrever(p.raiz, "src/novo.ts", "export function novo(): number { return 1; }\n");
    const r = await s.analisarEAguardar({ modo: "incremental" });
    expect(r.novos).toBe(1);
    expect(arestas(s)).toContain("importa|arq:src/d.ts|arq:src/novo.ts|exata");
    rmSync(join(p.raiz, "src/novo.ts"));
    const r2 = await s.analisarEAguardar({ modo: "incremental" });
    expect(r2.removidos).toBe(1);
    expect(s.armazem().no("arq:src/novo.ts")).toBeUndefined();
    expect(arestas(s).some((x) => x.includes("arq:src/novo.ts"))).toBe(false);
  }, 60_000);

  it("cancelar no meio deixa o banco consistente e a retomada produz o mesmo grafo da análise completa", async () => {
    const arqs: Record<string, string> = { ...BASE };
    for (let i = 0; i < 60; i++) arqs[`src/m${i}.ts`] = `import { a } from "./a";\nexport function m${i}(): number { return a(${i}); }\n`;
    const p = projeto(arqs);
    const { s } = novo(p);
    const { execucao_id } = await s.analisar({ modo: "completo" });
    await s.cancelar();
    const r = await s.aguardarExecucao(execucao_id);
    expect(["cancelada", "concluida"]).toContain(r.estado);
    expect(s.armazem().verificarIntegridade()).toBe(true);
    if (r.estado === "cancelada") expect(["vazio", "parcial"]).toContain(s.resumo().estado);
    await s.analisarEAguardar({ modo: "incremental" });
    const parcial = arestas(s);
    const p2 = projeto(arqs);
    const { s: s2 } = novo(p2);
    await s2.analisarEAguardar({ modo: "completo" });
    expect(parcial).toEqual(arestas(s2));
    expect(s.resumo().estado).toBe("pronto");
  }, 90_000);

  it("cancelar DURANTE a extração (no 1º progresso) marca parcial; a retomada fecha igual à completa", async () => {
    const arqs: Record<string, string> = { ...BASE };
    for (let i = 0; i < 150; i++) arqs[`src/n${i}.ts`] = `import { b } from "./b";\nexport function n${i}(): number { return b(${i}); }\n`;
    const p = projeto(arqs);
    let ref: ServicoMapaCompleto | undefined;
    let cancelou = false;
    const { s } = novo(p, {
      emitir: (e) => {
        if (e.tipo === "progresso" && e.progresso?.fase === "extraindo" && !cancelou) {
          cancelou = true;
          void ref?.cancelar();
        }
      },
    });
    ref = s;
    const r = await s.analisarEAguardar({ modo: "completo" });
    expect(cancelou).toBe(true);
    expect(r.estado).toBe("cancelada");
    expect(s.armazem().verificarIntegridade()).toBe(true);
    expect(s.armazem().lerMeta("estado")).toBe("parcial");
    const depois = await s.analisarEAguardar({ modo: "incremental" });
    expect(depois.estado).toBe("concluida");
    expect(depois.novos + depois.alterados + depois.inalterados).toBe(155);
    const p2 = projeto(arqs);
    const { s: s2 } = novo(p2);
    await s2.analisarEAguardar({ modo: "completo" });
    expect(arestas(s)).toEqual(arestas(s2));
    expect(s.resumo().estado).toBe("pronto");
  }, 90_000);

  it("duas análises simultâneas serializam (a segunda só começa quando a primeira termina)", async () => {
    const p = projeto(BASE);
    const { s, eventos } = novo(p);
    const [x, y] = await Promise.all([s.analisar({ modo: "completo" }), s.analisar({ modo: "incremental" })]);
    expect(y.execucao_id).toBeGreaterThan(x.execucao_id);
    const rx = await s.aguardarExecucao(x.execucao_id);
    const ry = await s.aguardarExecucao(y.execucao_id);
    expect(rx.estado).toBe("concluida");
    expect(ry.estado).toBe("concluida");
    expect(ry.extraidos).toBe(0);
    expect(eventos.filter((e) => e.tipo === "terminou")).toHaveLength(2);
  }, 60_000);

  it("cancelar na fase DERIVADA: estado parcial; sem mudar nenhum arquivo, a próxima análise refaz a derivada e fecha igual à completa (A-05)", async () => {
    const arqs: Record<string, string> = { ...BASE };
    for (let i = 0; i < 40; i++) arqs[`src/q${i}.ts`] = `import { a } from "./a";\nexport function q${i}(): number { return a(${i}); }\n`;
    const p = projeto(arqs);
    let ref: ServicoMapaCompleto | undefined;
    let cancelou = false;
    const { s } = novo(p, {
      emitir: (e) => {
        if (e.tipo === "progresso" && e.progresso?.fase === "analises" && !cancelou) {
          cancelou = true;
          void ref?.cancelar();
        }
      },
    });
    ref = s;
    const r = await s.analisarEAguardar({ modo: "completo" });
    expect(cancelou).toBe(true);
    expect(r.estado).toBe("cancelada");
    expect(s.armazem().lerMeta("estado")).toBe("parcial");
    const depois = await s.analisarEAguardar({ modo: "incremental" });
    expect(depois.estado).toBe("concluida");
    expect(depois.extraidos).toBe(0); // nenhum arquivo mudou: quem refez foi a derivada (estado != pronto)
    expect(depois.derivada).not.toBeNull();
    expect(s.armazem().lerMeta("estado")).toBe("pronto");
    const p2 = projeto(arqs);
    const { s: s2 } = novo(p2);
    await s2.analisarEAguardar({ modo: "completo" });
    expect(arestas(s)).toEqual(arestas(s2));
  }, 90_000);

  it("anti-inundação: pedidos repetidos de análise reaproveitam a que já espera na fila (no máximo 1 rodando + 1 esperando)", async () => {
    const p = projeto(BASE);
    const { s } = novo(p);
    const ids = await Promise.all(Array.from({ length: 12 }, () => s.analisar({ modo: "incremental" })));
    const distintos = new Set(ids.map((i) => i.execucao_id));
    expect(distintos.size).toBeLessThanOrEqual(2);
    for (const id of distintos) expect((await s.aguardarExecucao(id)).estado).toBe("concluida");
    expect(s.armazem().banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM execucao")?.n).toBeLessThanOrEqual(2);
  }, 60_000);

  it("fase derivada em worker_threads (produção) dá o mesmo resultado que a inline", async () => {
    const p = projeto(BASE);
    const { s } = novo(p, { derivada: "worker" });
    const r = await s.analisarEAguardar({ modo: "completo" });
    expect(r.estado).toBe("concluida");
    expect(r.erro).toBeNull();
    expect(arestas(s)).toContain("importa|arq:src/a.ts|arq:src/b.ts|exata");
    expect(s.handles().worker_derivada).toBe(false);
  }, 60_000);

  it("história git alimenta churn e hotspots; sem git a história é indisponível", async () => {
    const p = projeto(BASE, true);
    for (let i = 0; i < 3; i++) {
      escrever(p.raiz, "src/b.ts", `${BASE["src/b.ts"] as string}// rev ${i}\n`);
      commit(p.raiz, `fix: ajuste ${i}`);
    }
    const { s } = novo(p);
    await s.analisarEAguardar({ modo: "completo", historia: true });
    expect(s.resumo().historia).toBe("ok");
    const linha = s.armazem().banco.consultarUm<{ churn_total: number; commits_correcao: number }>("SELECT churn_total, commits_correcao FROM arquivo WHERE caminho = 'src/b.ts'");
    expect(linha?.churn_total).toBe(4);
    expect(linha?.commits_correcao).toBe(3);
    const hot = s.armazem().lerAnaliseCache<{ disponivel: boolean }>("analise:hotspots");
    expect(hot?.disponivel).toBe(true);
    const p2 = projeto(BASE, false);
    const { s: s2 } = novo(p2);
    await s2.analisarEAguardar({ modo: "completo" });
    expect(s2.resumo().historia).toBe("indisponivel");
  }, 90_000);

  it("não abre .env nem chave, não segue symlink para fora e confina `..`", async () => {
    const chave = ["-----BEGIN ", "PRIVATE KEY-----\n"].join("");
    const p = projeto({ ...BASE, ".env": "SEGREDO=abc\n", "chave.pem": chave });
    const fora = pastaTmp("ade-mapa-fora-");
    pastas.push(fora);
    writeFileSync(join(fora, "isca.ts"), 'export const ISCA = "nao-deve-entrar";\n');
    mkdirSync(join(p.raiz, "src"), { recursive: true });
    symlinkSync(join(fora, "isca.ts"), join(p.raiz, "src/isca.ts"));
    const { s } = novo(p);
    await s.analisarEAguardar({ modo: "completo" });
    const caminhos = s.armazem().banco.consultar<{ caminho: string }>("SELECT caminho FROM arquivo").map((l) => l.caminho);
    expect(caminhos).not.toContain(".env");
    expect(caminhos).not.toContain("chave.pem");
    expect(caminhos).not.toContain("src/isca.ts");
    const json = JSON.stringify(s.armazem().banco.consultar("SELECT json FROM extracao"));
    expect(json).not.toContain("SEGREDO");
    expect(json).not.toContain("nao-deve-entrar");
  }, 60_000);

  it("apagar exige a confirmação digitada e remove só mapa.db e .expxv/mapa", async () => {
    const p = projeto(BASE);
    const { s } = novo(p);
    await s.analisarEAguardar({ modo: "completo" });
    mkdirSync(join(p.raiz, ".expxv/mapa/20260101T000000Z"), { recursive: true });
    writeFileSync(join(p.raiz, ".expxv/mapa/20260101T000000Z/RESUMO.md"), "x");
    writeFileSync(join(p.raiz, ".expxv/outro.txt"), "fica");
    await expect(s.apagar("apagar")).rejects.toThrow(/APAGAR/);
    expect(s.resumo().arquivos).toBe(5);
    await s.apagar("APAGAR");
    expect(s.resumo().arquivos).toBe(0);
    expect(existsSync(join(p.raiz, ".expxv/mapa"))).toBe(false);
    expect(readFileSync(join(p.raiz, ".expxv/outro.txt"), "utf8")).toBe("fica");
    expect(existsSync(join(p.raiz, "src/a.ts"))).toBe(true);
  }, 60_000);

  it("encerrar libera pool, worker e handle do armazém (P-248)", async () => {
    const p = projeto(BASE);
    const { s } = novo(p);
    await s.analisarEAguardar({ modo: "completo" });
    expect(s.handles().armazem_aberto).toBe(true);
    await s.encerrar();
    expect(s.handles()).toEqual({ workers_extracao: 0, worker_derivada: false, armazem_aberto: false });
    expect(() => s.armazem()).toThrow();
  }, 60_000);

  it("configuração: valida e limita; ignora globs perigosos", () => {
    const c = normalizarConfig(CONFIG_MAPA_PADRAO, { workers: 99, total_max: 5, arquivo_max_bytes: 9e9, ignorar: ["../x", "/etc", "ok/**", 3], expor_agentes: true, desconhecido: 1 });
    expect(c.workers).toBe(3);
    expect(c.total_max).toBe(100);
    expect(c.arquivo_max_bytes).toBe(5_000_000);
    expect(c.ignorar).toEqual(["ok/**"]);
    expect(c.expor_agentes).toBe(true);
    expect(Object.keys(c)).not.toContain("desconhecido");
  });
});
