import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../fixtures/mapa/compilar";
import { novoServico, T0 } from "../fixtures/conhecimento/util";
import { escrever, pastaTmp, removerPasta } from "../fixtures/vcs/repos";
import { sincronizarMapa } from "../../src/nucleo/conhecimento/fontes/mapa";
import type { MapaLeitura } from "../../src/nucleo/mapa/contrato";
import { criarServicoMapa, type ServicoMapaCompleto } from "../../src/nucleo/mapa/servico";

// T-17.35 (contrato com a Fase 15): o grafo de conhecimento consome o mapa SÓ pela interface `MapaLeitura` (somente leitura) e liga os
// nós por REFERÊNCIA ao id do mapa; o `Armazem` real, preenchido pela análise completa, satisfaz essa interface. A Fase 15 nunca
// copia nós de código nem recebe código-fonte: só ids, rótulos e arestas.

const pastas: string[] = [];
let servico: ServicoMapaCompleto | undefined;
let dist = "";
beforeAll(() => {
  dist = compilarMapaParaTeste(["nucleo/mapa/index.ts", "nucleo/mapa/worker-extracao.ts", "nucleo/mapa/pool.ts", "nucleo/mapa/worker-derivada.ts"]);
});
afterAll(async () => {
  await servico?.encerrar();
  for (const p of pastas) removerPasta(p);
});

describe("contrato mapa -> conhecimento (Fase 15)", () => {
  it("o armazém real é um MapaLeitura que alimenta o grafo de dependências do conhecimento, sem copiar código", async () => {
    const raiz = pastaTmp("ade-mapa-f15-");
    const dados = pastaTmp("ade-mapa-f15-db-");
    pastas.push(raiz, dados);
    escrever(raiz, "src/a.ts", 'import { b } from "./b";\nexport function alfa(): number {\n  return b() + 1;\n}\n');
    escrever(raiz, "src/b.ts", 'export function b(): number {\n  const segredo = "valor-que-nao-pode-vazar";\n  return segredo.length;\n}\n');
    servico = criarServicoMapa({ raiz, caminhoDb: join(dados, "m", "mapa.db"), workspaceId: "ws_f15", caminhoWorkerExtracao: join(dist, "nucleo/mapa/worker-extracao.js"), derivada: "inline", tamanhoPool: 1 });
    await servico.analisarEAguardar({ modo: "completo" });
    const mapa: MapaLeitura = servico.armazem();
    expect(mapa.resumo().estado).toBe("pronto");

    const { s, fechar } = novoServico();
    const r = sincronizarMapa({ mapa, repos: s.repos, colecao_id: s.colecaoId, arquivos: ["src/a.ts", "src/b.ts"], quando: T0 });
    expect(r.nos).toBeGreaterThanOrEqual(4);
    expect(r.arestas).toBeGreaterThanOrEqual(3);
    const sg = s.subgrafo({});
    expect(sg.arestas.some((a) => a.tipo === "depende")).toBe(true);
    expect(sg.nos.map((n) => n.rotulo)).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts", "alfa"]));
    // idempotente: sincronizar de novo não duplica
    const antes = s.subgrafo({}).arestas.length;
    sincronizarMapa({ mapa, repos: s.repos, colecao_id: s.colecaoId, arquivos: ["src/a.ts", "src/b.ts"], quando: T0 });
    expect(s.subgrafo({}).arestas.length).toBe(antes);
    // nenhum código-fonte chegou ao conhecimento
    expect(JSON.stringify(sg)).not.toContain("valor-que-nao-pode-vazar");
    expect(JSON.stringify(sg)).not.toContain("segredo.length");
    // a interface é só leitura: o contrato não expõe método de escrita
    expect(Object.keys({ resumo: mapa.resumo, no: mapa.no, vizinhos: mapa.vizinhos, buscar: mapa.buscar }).sort()).toEqual(["buscar", "no", "resumo", "vizinhos"]);
    fechar();
  }, 60_000);
});
