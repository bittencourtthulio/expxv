import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../fixtures/mapa/compilar";
import { pastaTmp, removerPasta } from "../fixtures/vcs/repos";
import { PRODUTO } from "../../src/nucleo/produto";
import { criarFachadaMapa } from "../../src/nucleo/mapa/fachada";
import { criarServicoMapa, type ServicoMapaCompleto } from "../../src/nucleo/mapa/servico";

// T-17.43 (serviço persistido): o serviço completo (varredura, pool, fase derivada em worker_threads, armazém SQLite) analisa o
// PRÓPRIO repositório em modo somente leitura: o banco vai para uma pasta temporária e nada é gravado no repositório (nem a pasta do produto).

const RAIZ = resolve(__dirname, "../..");
const FATOR = Number(process.env.EXPXV_PERF_FATOR ?? "1");
let dist = "";
let dados = "";
let servico: ServicoMapaCompleto | undefined;
beforeAll(() => {
  dist = compilarMapaParaTeste(["nucleo/mapa/index.ts", "nucleo/mapa/worker-extracao.ts", "nucleo/mapa/pool.ts", "nucleo/mapa/worker-derivada.ts"]);
  dados = pastaTmp("ade-mapa-real-");
});
afterAll(async () => {
  await servico?.encerrar();
  removerPasta(dados);
});

describe("T-17.43: serviço completo contra o próprio repositório", () => {
  it("analisa o ExpxDev, consulta o raio de comandos.ts e não escreve nada no repositório", async () => {
    const existiaPastaProduto = existsSync(join(RAIZ, PRODUTO.pastaNoProjeto));
    servico = criarServicoMapa({
      raiz: RAIZ,
      caminhoDb: join(dados, "mapas", "ws_real", "mapa.db"),
      workspaceId: "ws_real",
      caminhoWorkerExtracao: join(dist, "nucleo/mapa/worker-extracao.js"),
      caminhoWorkerDerivada: join(dist, "nucleo/mapa/worker-derivada.js"),
      derivada: "worker",
      tamanhoPool: 3,
    });
    const f = criarFachadaMapa(servico, { raiz: RAIZ, pastaExportacao: join(dados, "exp") });
    const t0 = performance.now();
    const r = await servico.analisarEAguardar({ modo: "completo" });
    const ms = performance.now() - t0;
    console.log(`[mapa-real-servico] ${r.novos} arquivos em ${(ms / 1000).toFixed(1)} s (extração ${r.ms["extracao"]} ms, derivada ${r.ms["derivada"]} ms), falhas=${r.falhas}`);
    expect(r.estado).toBe("concluida");
    expect(r.erro).toBeNull();
    expect(r.novos).toBeGreaterThanOrEqual(500);
    expect(ms).toBeLessThanOrEqual(60_000 * FATOR);
    const resumo = f.resumo();
    expect(resumo.estado).toBe("pronto");
    expect(resumo.arestas.exata / Math.max(1, resumo.arestas.exata + resumo.arestas.heuristica)).toBeGreaterThanOrEqual(0.85);

    // reanálise sem mudanças: nada reextraído e mesma versão
    const r2 = await servico.analisarEAguardar({ modo: "incremental" });
    expect(r2.extraidos).toBe(0);

    // raio de comandos.ts: os importadores diretos vistos pelo grafo (não-teste) estão entre os chamadores
    const alvo = "src/nucleo/metodo/comandos.ts";
    const importadores = f.vizinhos(`arq:${alvo}`, "entrada", 1, 500).nos.map((n) => n.id.replace(/^arq:/, "")).filter((c) => c !== alvo && !/\.test\.tsx?$/.test(c));
    expect(importadores.length).toBeGreaterThan(0);
    const raio = f.raio([alvo]);
    for (const c of importadores) expect(raio.chamadores).toContain(c);
    expect(raio.nota).toMatch(/provisório/);
    expect(f.analise("entradas").dados.itens.length).toBeGreaterThan(0);
    expect(f.grafo("modulo").nos.length).toBeGreaterThan(5);

    // somente leitura: o repositório não ganhou pasta do produto por causa da análise
    expect(existsSync(join(RAIZ, PRODUTO.pastaNoProjeto))).toBe(existiaPastaProduto);
  }, 180_000);
});
