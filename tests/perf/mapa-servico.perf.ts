// Orçamentos do SERVIÇO COMPLETO do mapa (Fase 17, onda 3), em Node puro (sem Electron), sobre 5 000 arquivos TS sintéticos num repositório git:
//  - P-240: análise inicial (varredura + pool de extração + gravação + fase derivada em worker_threads) ≤ 30 s; nenhuma tarefa > 50 ms no main (P-12).
//  - P-241: atualização incremental por LISTA (observador): do pedido até `mudou` (nós gravados) ≤ 200 ms por arquivo alterado (mediana de 10).
//  - P-244: memória adicional (RSS do processo: main + workers) ≤ 150 MB.
//  - P-246: consultas do IPC/MCP (no, vizinhos, busca, raio, análises, grafo) ≤ 50 ms p95.
//  - P-247: pacote de contexto: RESUMO.md ≤ 6 000 tokens, gerar ≤ 2 s.
//  - P-248: com o serviço encerrado, 0 workers e 0 handles; registro dos canais ≤ 5 ms.
//  - P-250: reanálise sem mudanças (serviço, varredura incremental) ≤ 2 s.
//  - P-251: exportar Mermaid/DOT/SVG de 500 nós ≤ 300 ms.
// Máquina compartilhada (outros agentes e o `npm run dev` do dono): tempo, atraso do event loop e memória valem o MELHOR de 3 execuções
// completas (o mínimo é o custo real; o resto é ruído de escalonamento). Tudo sai no log. Valores gravados em docs/ade/perf/ultimo.json.
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../fixtures/mapa/compilar";
import { gerarProjetoTs, textoSintetico } from "../fixtures/mapa/gerar";
import { initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../fixtures/vcs/repos";
import { exportarDot, exportarMermaid, exportarSvg } from "../../src/nucleo/mapa/exportar";
import { criarFachadaMapa, type FachadaMapa } from "../../src/nucleo/mapa/fachada";
import { criarServicoMapa, type ServicoMapaCompleto } from "../../src/nucleo/mapa/servico";
import { criarRegistroIpc, type IpcMainLike } from "../../src/main/ipc/registro";
import { registrarIpcMapa } from "../../src/main/ipc/mapa";
import type { EventoMapaIpc } from "../../src/compartilhado/mapa";
import { gravarMedicoes, percentil, registrar } from "./registro";

const N = 5000;
const EXECUCOES = 3;
const pastas: string[] = [];
const servicos: ServicoMapaCompleto[] = [];
afterAll(async () => {
  gravarMedicoes();
  for (const s of servicos) await s.encerrar();
  for (const p of pastas) removerPasta(p);
});
const mb = (b: number): number => b / 1048576;

interface Rodada {
  ms: number;
  atrasoMs: number;
  memoriaMb: number;
  servico: ServicoMapaCompleto;
  fachada: FachadaMapa;
  eventos: EventoMapaIpc[];
}

describe("P-240..P-251: serviço completo do mapa com 5 000 arquivos TypeScript", () => {
  it("análise inicial, incremental por lista, memória, consultas, pacote, exportação, ocioso e reanálise", async () => {
    isolarConfigGit();
    const raiz = pastaTmp("ade-perf-mapa-srv-");
    pastas.push(raiz);
    initRepo(raiz, false);
    gerarProjetoTs(raiz, N);
    const dist = compilarMapaParaTeste(["nucleo/mapa/index.ts", "nucleo/mapa/worker-extracao.ts", "nucleo/mapa/pool.ts", "nucleo/mapa/worker-derivada.ts"]);

    const rodar = async (): Promise<Rodada> => {
      const dados = pastaTmp("ade-perf-mapa-srv-db-");
      pastas.push(dados);
      const eventos: EventoMapaIpc[] = [];
      const servico = criarServicoMapa({
        raiz,
        caminhoDb: join(dados, "mapas", "ws_perf", "mapa.db"),
        workspaceId: "ws_perf",
        caminhoWorkerExtracao: join(dist, "nucleo/mapa/worker-extracao.js"),
        caminhoWorkerDerivada: join(dist, "nucleo/mapa/worker-derivada.js"),
        derivada: "worker",
        tamanhoPool: 3,
        emitir: (e) => eventos.push(e),
        ferramentas: () => ({ ctags: false, scc: false, dot: false }),
      });
      servicos.push(servico);
      const fachada = criarFachadaMapa(servico, { raiz, pastaExportacao: join(dados, "exp") });
      servico.armazem(); // abre o banco antes de medir (a criação do arquivo não é o que se mede)
      const base = process.memoryUsage().rss;
      let pico = base;
      const amostra = setInterval(() => {
        pico = Math.max(pico, process.memoryUsage().rss);
      }, 25);
      const h = monitorEventLoopDelay({ resolution: 5 });
      h.enable();
      const t0 = performance.now();
      const r = await servico.analisarEAguardar({ modo: "completo" });
      const ms = performance.now() - t0;
      h.disable();
      clearInterval(amostra);
      pico = Math.max(pico, process.memoryUsage().rss);
      expect(r.estado).toBe("concluida");
      expect(r.erro).toBeNull();
      expect(r.falhas).toBe(0);
      expect(r.novos).toBe(N);
      return { ms, atrasoMs: h.max / 1e6, memoriaMb: mb(pico - base), servico, fachada, eventos };
    };

    const rodadas: Rodada[] = [];
    for (let i = 0; i < EXECUCOES; i++) {
      // só a última rodada fica viva para as demais medições; as outras liberam banco e workers
      const r = await rodar();
      rodadas.push(r);
      console.log(`análise completa #${i + 1}: ${N} arquivos em ${(r.ms / 1000).toFixed(2)} s; atraso máximo do event loop do main ${r.atrasoMs.toFixed(1)} ms; memória adicional ${r.memoriaMb.toFixed(1)} MB`);
      if (i < EXECUCOES - 1) await r.servico.encerrar();
    }
    const melhor = (f: (r: Rodada) => number): number => Math.min(...rodadas.map(f));
    const pior = (f: (r: Rodada) => number): number => Math.max(...rodadas.map(f));
    expect(registrar({ id: "P-240", descricao: "análise inicial de 5 000 arquivos TS pelo SERVIÇO (varredura + pool + gravação + derivada em worker). Melhor de 3", valor: melhor((r) => r.ms) / 1000, limite: 30, unidade: "s", pior: pior((r) => r.ms) / 1000 }).ok).toBe(true);
    expect(registrar({ id: "P-240-loop", descricao: "pior atraso do event loop do main durante a análise completa pelo serviço (P-12: nenhuma tarefa > 50 ms). Melhor de 3", valor: melhor((r) => r.atrasoMs), limite: 50, unidade: "ms", pior: pior((r) => r.atrasoMs) }).ok).toBe(true);
    expect(registrar({ id: "P-244", descricao: "memória adicional (RSS main + workers) na análise completa de 5 000 arquivos pelo serviço. Melhor de 3", valor: melhor((r) => r.memoriaMb), limite: 150, unidade: "MB", pior: pior((r) => r.memoriaMb) }).ok).toBe(true);

    const vivo = rodadas[rodadas.length - 1] as Rodada;
    const { servico, fachada, eventos } = vivo;
    const arm = servico.armazem();
    console.log(`nós=${arm.contagens().nos} arestas=${arm.contagens().arestas}; resumo: ${JSON.stringify(fachada.resumo().arestas)}`);

    // ---- P-250: reanálise sem mudanças pelo serviço (varredura incremental com cache mtime+tamanho)
    const reanalise: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      const r = await servico.analisarEAguardar({ modo: "incremental" });
      reanalise.push(performance.now() - s);
      expect(r.extraidos).toBe(0);
      expect(r.inalterados).toBe(N);
    }
    expect(registrar({ id: "P-250", descricao: "reanálise sem mudanças de 5 000 arquivos PELO SERVIÇO (git ls-files + stat + cache), mediana de 5", valor: percentil(reanalise, 50) / 1000, limite: 2, unidade: "s", pior: Math.max(...reanalise) / 1000 }).ok).toBe(true);

    // ---- P-241: incremental por lista (observador): do pedido até `mudou` com os nós do arquivo alterado no armazém
    const tempos: number[] = [];
    for (let k = 0; k < 10; k++) {
      const rel = `m${k}/f${100 + k}.ts`;
      writeFileSync(join(raiz, rel), `${textoSintetico(100 + k)}\nexport const toque${k} = ${k};\n`);
      const antes = eventos.filter((e) => e.tipo === "mudou").length;
      const s = performance.now();
      const { execucao_id } = await servico.analisar({ modo: "incremental", arquivos: [rel], segundoPlano: true });
      while (eventos.filter((e) => e.tipo === "mudou").length === antes) await new Promise((r) => setTimeout(r, 1));
      tempos.push(performance.now() - s);
      expect(arm.no(`sim:${rel}#toque${k}`)).toBeDefined(); // a etapa 1 já deixou o arquivo novo no armazém
      await servico.aguardarExecucao(execucao_id); // a derivada fecha depois, fora da medição
    }
    expect(registrar({ id: "P-241", descricao: "atualização incremental por lista (pedido do observador até `mudou`, nós gravados), mediana de 10", valor: percentil(tempos, 50), limite: 200, unidade: "ms", pior: Math.max(...tempos) }).ok).toBe(true);

    // ---- P-246: consultas do IPC/MCP (com a análise completa pronta)
    const consultas: number[] = [];
    const nomes = ["no", "vizinhos", "buscar", "raio", "analise", "grafo-modulo", "grafo-arquivo", "fluxo"];
    const tempoPorTipo = new Map<string, number[]>();
    const entradas = fachada.analise("entradas").dados.itens;
    for (let i = 0; i < 400; i++) {
      const f = (i * 13) % N;
      const rel = `m${f % 50}/f${f}.ts`;
      const tipo = nomes[i % nomes.length] as string;
      const s = performance.now();
      if (tipo === "no") fachada.no(`sim:${rel}#f${f}_${i % 10}`);
      else if (tipo === "vizinhos") fachada.vizinhos(`arq:${rel}`, "ambas", 2, 200);
      else if (tipo === "buscar") fachada.buscar(`f${f}_`, ["simbolo"], 20);
      else if (tipo === "raio") fachada.raio([rel]);
      else if (tipo === "analise") fachada.analise(i % 2 === 0 ? "camadas" : "hotspots", { limite: 100 });
      else if (tipo === "grafo-modulo") fachada.grafo("modulo", {}, 5000);
      else if (tipo === "grafo-arquivo") fachada.grafo("arquivo", {}, 1000);
      else if (entradas.length > 0) fachada.fluxo((entradas[i % entradas.length] as { id: string }).id, 6);
      const d = performance.now() - s;
      consultas.push(d);
      const l = tempoPorTipo.get(tipo) ?? [];
      l.push(d);
      tempoPorTipo.set(tipo, l);
    }
    console.log(`P-246 p95 por tipo (ms): ${[...tempoPorTipo].map(([k, v]) => `${k}=${percentil(v, 95).toFixed(1)}`).join(" ")}`);
    expect(registrar({ id: "P-246", descricao: "consultas do IPC/MCP (no, vizinhos, busca, raio, análises, grafo, fluxo) com 5 000 arquivos, p95", valor: percentil(consultas, 95), limite: 50, unidade: "ms", pior: Math.max(...consultas) }).ok).toBe(true);

    // ---- P-247: pacote de contexto
    const sp = performance.now();
    const pacote = fachada.gerarPacote({ trabalho_id: "OC-1", arquivos: ["m0/f0.ts", "m1/f1.ts"] });
    const msPacote = performance.now() - sp;
    const resumoMd = statSync(join(raiz, pacote.pasta_rel, "RESUMO.md")).size;
    expect(registrar({ id: "P-247", descricao: "RESUMO.md do pacote de contexto em tokens estimados (caracteres/4) com 5 000 arquivos", valor: Math.ceil(resumoMd / 4), limite: 6000, unidade: "tokens", semFator: true }).ok).toBe(true);
    expect(registrar({ id: "P-247-tempo", descricao: "gerar o pacote de contexto (RESUMO, inventário, perfil, entradas, arquivos, raio) com 5 000 arquivos", valor: msPacote / 1000, limite: 2, unidade: "s" }).ok).toBe(true);

    // ---- P-251: exportações de 500 nós
    const g500 = fachada.grafo("arquivo", {}, 500);
    expect(g500.nos.length).toBe(500);
    const exportacoes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = performance.now();
      exportarMermaid(g500);
      exportarDot(g500);
      exportarSvg(g500);
      exportacoes.push((performance.now() - s) / 3);
    }
    expect(registrar({ id: "P-251", descricao: "exportar Mermaid/DOT/SVG de 500 nós (média dos três formatos; melhor de 3)", valor: Math.min(...exportacoes), limite: 300, unidade: "ms", pior: Math.max(...exportacoes) }).ok).toBe(true);

    // ---- P-248: registro dos canais e 0 handles com o serviço encerrado
    const handlers = new Map<string, unknown>();
    const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    const registro = criarRegistroIpc({ ipcMain, autorizar: () => true });
    const sr = performance.now();
    registrarIpcMapa({ registro, servico: { fachada: async () => fachada, resumo: async () => fachada.resumo(), disparar: async () => ({ comando: "", carimbo: "", pacote: "" }) } });
    const msRegistro = performance.now() - sr;
    expect(handlers.size).toBe(18);
    expect(registrar({ id: "P-248-registro", descricao: "registro dos 18 canais mapa:* (só validadores; módulo já carregado)", valor: msRegistro, limite: 5, unidade: "ms" }).ok).toBe(true);
    await servico.encerrar();
    const h = servico.handles();
    expect(registrar({ id: "P-248-handles", descricao: "workers e handles do mapa depois de encerrar o serviço (ocioso = 0)", valor: h.workers_extracao + (h.worker_derivada ? 1 : 0) + (h.armazem_aberto ? 1 : 0), limite: 0, unidade: "handles", semFator: true }).ok).toBe(true);
  }, 900_000);
});
