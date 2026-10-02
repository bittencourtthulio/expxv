import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco } from "../banco/banco";
import { extracaoSintetica } from "../../../tests/fixtures/mapa/gerar";
import { fatorPerf } from "../../../tests/perf/registro";
import { lerFixture } from "../../../tests/fixtures/mapa/comparar";
import { abrirArmazem, caminhoMapaDb, type Armazem, type ItemExtracao } from "./armazem";
import { lerVersao } from "./esquema";
import { extrairArquivo } from "./extratores/registro";
import { SCHEMA_VERSION, type Aresta } from "./tipos";

const abertos: Armazem[] = [];
const pastas: string[] = [];
afterEach(() => {
  for (const a of abertos.splice(0)) a.fechar();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function pasta(): string {
  const p = mkdtempSync(join(tmpdir(), "mapa-arm-"));
  pastas.push(p);
  return p;
}
function abrir(caminho?: string): Armazem {
  const a = abrirArmazem({ caminho: caminho ?? join(pasta(), "mapas", "ws1", "mapa.db") });
  abertos.push(a);
  return a;
}
const item = (caminho: string, e = extracaoSintetica(1), hash = e.hash): ItemExtracao => ({ caminho, linguagem: e.linguagem, hash, tamanho: 100, mtime_ms: 1000, extracao: { ...e, hash } });

async function dosFixtures(caminho: string): Promise<ItemExtracao> {
  const texto = lerFixture("typescript", caminho);
  const e = await extrairArquivo(texto, "typescript", caminho);
  return { caminho, linguagem: "typescript", hash: e.hash, tamanho: texto.length, mtime_ms: 5, extracao: e };
}

describe("armazém SQLite do mapa (T-17.04)", () => {
  it("cria <userData>/mapas/<ws>/mapa.db com o esquema e user_version", () => {
    const raiz = pasta();
    const caminho = caminhoMapaDb(raiz, "ws1");
    expect(caminho).toBe(join(raiz, "mapas", "ws1", "mapa.db"));
    const a = abrir(caminho);
    expect(existsSync(caminho)).toBe(true);
    expect(a.aviso).toBeNull();
    expect(lerVersao(a.banco)).toBe(SCHEMA_VERSION);
    expect(a.resumo()).toMatchObject({ estado: "vazio", arquivos: 0, versao_mapa: 0 });
  });

  it("upsert idempotente por hash: repetir não reescreve; mudar o hash substitui nós, arestas e extração", async () => {
    const a = abrir();
    const it1 = await dosFixtures("src/dados.ts");
    expect(a.gravarLote([it1])).toEqual({ gravados: 1, inalterados: 0, invalidos: 0 });
    const antes = a.contagens();
    const idAntes = a.lerHashes().get("src/dados.ts")!.id;
    expect(a.gravarLote([it1])).toEqual({ gravados: 0, inalterados: 1, invalidos: 0 });
    expect(a.contagens()).toEqual(antes);
    // mesmo hash mas só mtime/tamanho mudaram: atualiza o stat sem regravar
    a.gravarLote([{ ...it1, mtime_ms: 9999, tamanho: 7 }]);
    expect(a.lerHashes().get("src/dados.ts")).toMatchObject({ mtime_ms: 9999, tamanho: 7, hash: it1.hash });
    // conteúdo novo: mesmo id de arquivo, grafo substituído
    const novo = { ...it1, hash: "novo", extracao: { ...it1.extracao, hash: "novo", simbolos: [], dados: [] } };
    expect(a.gravarLote([novo])).toEqual({ gravados: 1, inalterados: 0, invalidos: 0 });
    expect(a.lerHashes().get("src/dados.ts")).toMatchObject({ id: idAntes, hash: "novo" });
    expect(a.buscar("consultar", { tipos: ["simbolo"] })).toEqual([]);
    expect(a.banco.consultar("SELECT 1 FROM aresta WHERE arquivo_id = ?", [idAntes])).toHaveLength(0);
  });

  it("versão do extrator diferente regrava mesmo com o mesmo hash", () => {
    const a = abrir();
    const e = extracaoSintetica(3);
    a.gravarLote([item("a.ts", e)]);
    expect(a.gravarLote([item("a.ts", { ...e, versao_extrator: e.versao_extrator + 1 })]).gravados).toBe(1);
  });

  it("grafo do arquivo: nós de arquivo/símbolo/entrada/tabela, `aciona` e arestas de dados com confiança", async () => {
    const a = abrir();
    a.gravarLote([await dosFixtures("src/nest.controller.ts"), await dosFixtures("src/dados.ts")]);
    expect(a.no("arq:src/nest.controller.ts")).toMatchObject({ tipo: "arquivo", rotulo: "nest.controller.ts" });
    const metodo = a.no("sim:src/nest.controller.ts#ClientesController.buscar")!;
    expect(metodo).toMatchObject({ tipo: "simbolo", subtipo: "metodo", exportado: true });
    expect(metodo.atributos).toMatchObject({ v: "publica", cx: 1 });
    const rota = a.buscar("GET /clientes/:id", { tipos: ["entrada"] })[0]!;
    expect(rota.id).toBe("ent:src/nest.controller.ts#GET /clientes/:id");
    const aciona = a.vizinhos(rota.id, { direcao: "saida", tipos: ["aciona"] });
    expect(aciona).toHaveLength(1);
    expect(aciona[0]!.no.id).toBe("sim:src/nest.controller.ts#ClientesController.buscar");
    expect(aciona[0]!.aresta).toMatchObject({ confianca: "exata", fonte: "extracao", linha: 7 });
    expect(aciona[0]!.aresta.evidencias).toEqual(["src/nest.controller.ts:7"]);
    // dados
    const t = a.vizinhos("tab:clientes", { direcao: "entrada" });
    expect(t.map((v) => [v.aresta.tipo, v.no.id])).toEqual([["le_tabela", "sim:src/dados.ts#consultar"]]);
    const escr = a.vizinhos("sim:src/dados.ts#consultar", { tipos: ["escreve_tabela"] }).map((v) => v.no.id);
    expect(escr.sort()).toEqual(["tab:auditoria", "tab:estoque", "tab:fatura", "tab:produtos", "tab:sessoes"]);
    const exata = a.vizinhos("sim:src/dados.ts#consultar", { tipos: ["escreve_tabela"], min_confianca: "exata" }).map((v) => v.no.id);
    expect(exata).not.toContain("tab:sessoes"); // SQL interpolado = heurística
    expect(exata).toContain("tab:estoque");
  });

  it("consultas: no(), vizinhos nos dois sentidos, limite e busca por prefixo/nome com escape de curinga", () => {
    const a = abrir();
    a.gravarLote([item("src/a.ts", extracaoSintetica(1)), item("src/b.ts", extracaoSintetica(2))]);
    const ids = a.lerHashes();
    const aId = ids.get("src/a.ts")!.id;
    const bId = ids.get("src/b.ts")!.id;
    const arestas: Aresta[] = [
      { tipo: "importa", de: "arq:src/b.ts", para: "arq:src/a.ts", confianca: "exata", peso: 2, candidatos: null, fonte: "regra", arquivo_id: bId, linha: 1, evidencias: ["src/b.ts:1"] },
      { tipo: "importa", de: "arq:src/b.ts", para: "ext:npm:react", confianca: "exata", peso: 1, candidatos: null, fonte: "regra", arquivo_id: bId, linha: 2, evidencias: null },
      { tipo: "chama", de: "sim:src/b.ts#f2_0", para: "sim:src/a.ts#f1_0", confianca: "heuristica", peso: 1, candidatos: 2, fonte: "regra", arquivo_id: bId, linha: 12, evidencias: null },
    ];
    expect(a.substituirArestas({ tipos: ["importa", "chama"], arquivoIds: [bId] }, arestas)).toBe(3);
    const entrada = a.vizinhos("arq:src/a.ts", { direcao: "entrada" });
    expect(entrada.map((v) => v.no.id)).toEqual(["arq:src/b.ts"]);
    const saida = a.vizinhos("arq:src/b.ts", { direcao: "saida", tipos: ["importa"] });
    expect(saida.map((v) => v.no.id).sort()).toEqual(["arq:src/a.ts", "ext:npm:react"]);
    expect(saida.find((v) => v.no.id === "ext:npm:react")!.no).toMatchObject({ tipo: "externo", rotulo: "npm:react" });
    expect(a.vizinhos("arq:src/b.ts", { direcao: "saida", limite: 1 })).toHaveLength(1);
    expect(a.vizinhos("arq:src/b.ts", { direcao: "ambas" })).toHaveLength(2);
    const heur = a.vizinhos("sim:src/b.ts#f2_0", { tipos: ["chama"] })[0]!.aresta;
    expect(heur).toMatchObject({ confianca: "heuristica", candidatos: 2 });
    expect(a.no("nao-existe")).toBeUndefined();
    expect(aId).not.toBe(bId);
    // busca
    expect(a.buscar("f1_0")[0]!.rotulo).toBe("f1_0");
    expect(a.buscar("servico", { tipos: ["simbolo"] }).map((n) => n.rotulo).sort()).toEqual(["Servico1", "Servico2"]);
    // sem casar por prefixo, cai na busca por trecho (nome ou id); `trecho: true` soma os dois
    expect(a.buscar("ervico1", { tipos: ["simbolo"] }).map((n) => n.rotulo)).toEqual(["Servico1"]);
    expect(a.buscar("src/b.ts#f2_0", { tipos: ["simbolo"] }).map((n) => n.id)).toEqual(["sim:src/b.ts#f2_0"]);
    expect(a.buscar("f2_1", { tipos: ["simbolo"], trecho: true }).map((n) => n.rotulo)).toContain("f2_1");
    expect(a.buscar("%")).toEqual([]); // curinga escapado
    expect(a.buscar("")).toEqual([]);
    expect(a.buscar("f", { limite: 3 })).toHaveLength(3);
  });

  it("substituirArestas troca só o escopo pedido", () => {
    const a = abrir();
    a.gravarLote([item("a.ts", extracaoSintetica(1)), item("b.ts", extracaoSintetica(2))]);
    const ids = a.lerHashes();
    const mk = (de: string, arq: number): Aresta => ({ tipo: "importa", de, para: "arq:x", confianca: "exata", peso: 1, candidatos: null, fonte: "regra", arquivo_id: arq, linha: 1, evidencias: null });
    a.substituirArestas({ tipos: ["importa"] }, [mk("arq:a.ts", ids.get("a.ts")!.id), mk("arq:b.ts", ids.get("b.ts")!.id)]);
    a.substituirArestas({ tipos: ["importa"], arquivoIds: [ids.get("a.ts")!.id] }, []);
    expect(a.banco.consultar<{ de: string }>("SELECT de FROM aresta WHERE tipo='importa'").map((l) => l.de)).toEqual(["arq:b.ts"]);
    expect(a.substituirArestas({ tipos: [] }, [])).toBe(0);
  });

  it("removerArquivos: ON DELETE CASCADE, dependentes e arestas apontando para o removido", () => {
    const a = abrir();
    a.gravarLote([item("a.ts", extracaoSintetica(1)), item("b.ts", extracaoSintetica(2)), item("c.ts", extracaoSintetica(3))]);
    const ids = a.lerHashes();
    a.substituirArestas(
      { tipos: ["chama"] },
      [
        { tipo: "chama", de: "sim:b.ts#f2_0", para: "sim:a.ts#f1_0", confianca: "exata", peso: 1, candidatos: null, fonte: "regra", arquivo_id: ids.get("b.ts")!.id, linha: 3, evidencias: null },
        { tipo: "chama", de: "sim:c.ts#f3_0", para: "sim:c.ts#f3_1", confianca: "exata", peso: 1, candidatos: null, fonte: "regra", arquivo_id: ids.get("c.ts")!.id, linha: 3, evidencias: null },
      ],
    );
    const antes = a.contagens();
    expect(a.removerArquivos(["a.ts", "inexistente.ts"])).toEqual({ removidos: 1, dependentes: ["b.ts"] });
    expect(a.no("arq:a.ts")).toBeUndefined();
    expect(a.no("sim:a.ts#f1_0")).toBeUndefined();
    expect(a.lerExtracao("a.ts")).toBeNull();
    expect(a.banco.consultar("SELECT 1 FROM aresta WHERE para LIKE 'sim:a.ts#%'")).toHaveLength(0);
    expect(a.banco.consultar("SELECT 1 FROM aresta WHERE tipo = 'chama' AND de LIKE 'sim:c.ts#%'")).toHaveLength(1);
    expect(a.contagens().arquivos).toBe(antes.arquivos - 1);
  });

  it("extração inválida é contada e não derruba o lote", () => {
    const a = abrir();
    const ruim = item("ruim.ts");
    (ruim.extracao as unknown as Record<string, unknown>).loc = -5;
    expect(a.gravarLote([item("ok.ts"), ruim])).toEqual({ gravados: 1, inalterados: 0, invalidos: 1 });
    expect(a.lerHashes().has("ruim.ts")).toBe(false);
  });

  it("lerExtracao devolve a extração validada; JSON corrompido na coluna vira null", () => {
    const a = abrir();
    const e = extracaoSintetica(4);
    a.gravarLote([item("a.ts", e)]);
    expect(a.lerExtracao("a.ts")).toEqual(e);
    a.banco.executar("UPDATE extracao SET json = '{quebrado'");
    expect(a.lerExtracao("a.ts")).toBeNull();
  });

  it("não guarda código-fonte: nem o texto dos literais, nem do corpo (sanitização)", async () => {
    const a = abrir();
    a.gravarLote([await dosFixtures("src/servico.ts"), await dosFixtures("src/segredo.ts")]);
    const todo = JSON.stringify([a.banco.consultar("SELECT * FROM extracao"), a.banco.consultar("SELECT * FROM no"), a.banco.consultar("SELECT * FROM aresta")]);
    for (const proibido of ["valor-que-nao-pode-vazar", "id inválido", "AKIAIOSFODNN7EXAMPLE", "hunter2", "sk-live-abcdefghijklmnop12345", "ghp_abcdef"]) expect(todo, proibido).not.toContain(proibido);
  });

  it("meta, versão do mapa e cache de análise por versão", () => {
    const a = abrir();
    expect(a.versaoMapa()).toBe(0);
    a.gravarAnaliseCache("ciclos", { n: 3 });
    expect(a.lerAnaliseCache("ciclos")).toEqual({ n: 3 });
    expect(a.incrementarVersao()).toBe(1);
    expect(a.lerAnaliseCache("ciclos")).toBeNull(); // versão mudou: cache vencido
    a.gravarAnaliseCache("ciclos", { n: 4 });
    expect(a.lerAnaliseCache("ciclos")).toEqual({ n: 4 });
    a.gravarMeta("estado", "pronto");
    a.gravarMeta("estado", "parcial");
    expect(a.lerMeta("estado")).toBe("parcial");
    expect(a.lerMeta("nada")).toBeNull();
    const id = a.iniciarExecucao("completa", 10);
    a.finalizarExecucao(id, "ok", 9, 1);
    expect(a.banco.consultarUm("SELECT estado, arquivos_extraidos AS e, erros FROM execucao WHERE id = ?", [id])).toEqual({ estado: "ok", e: 9, erros: 1 });
  });

  it("resumo: linguagens, arestas por confiança, estado", () => {
    const a = abrir();
    a.gravarLote([item("a.ts", extracaoSintetica(1)), item("b.ts", extracaoSintetica(2))]);
    a.gravarMeta("estado", "pronto");
    a.substituirArestas({ tipos: ["importa"] }, [
      { tipo: "importa", de: "arq:b.ts", para: "arq:a.ts", confianca: "exata", peso: 1, candidatos: null, fonte: "regra", arquivo_id: null, linha: 1, evidencias: null },
      { tipo: "importa", de: "arq:a.ts", para: "arq:b.ts", confianca: "heuristica", peso: 1, candidatos: null, fonte: "regra", arquivo_id: null, linha: 1, evidencias: null },
    ]);
    expect(a.resumo()).toMatchObject({ estado: "pronto", arquivos: 2, arestas: { exata: 1, heuristica: 1 }, linguagens: [{ linguagem: "typescript", arquivos: 2, loc: 320 }] });
  });

  it("limparOrfaos remove tabelas sem aresta; limpar esvazia tudo mantendo o esquema", async () => {
    const a = abrir();
    a.gravarLote([await dosFixtures("src/dados.ts")]);
    expect(a.no("tab:clientes")).toBeDefined();
    a.removerArquivos(["src/dados.ts"]);
    expect(a.no("tab:clientes")).toBeDefined(); // órfão até a limpeza
    expect(a.limparOrfaos()).toBeGreaterThan(0);
    expect(a.no("tab:clientes")).toBeUndefined();
    a.gravarLote([item("a.ts")]);
    a.limpar();
    expect(a.contagens()).toEqual({ arquivos: 0, nos: 0, arestas: 0, extracoes: 0 });
    expect(lerVersao(a.banco)).toBe(SCHEMA_VERSION);
  });

  it("compactar e verificarIntegridade", () => {
    const a = abrir();
    a.gravarLote([item("a.ts")]);
    expect(a.verificarIntegridade()).toBe(true);
    expect(() => a.compactar()).not.toThrow();
    expect(a.contagens().arquivos).toBe(1);
  });
});

describe("banco corrompido ou de versão maior (nunca apaga em silêncio)", () => {
  it("lixo no lugar do banco: renomeia para mapa.db.corrompido-<carimbo> e recomeça", () => {
    const dir = pasta();
    const caminho = join(dir, "mapa.db");
    writeFileSync(caminho, "isto não é um banco sqlite, é lixo de 100 bytes ".repeat(5));
    const a = abrir(caminho);
    expect(a.aviso).toMatchObject({ tipo: "recriado", motivo: "corrompido" });
    expect(a.aviso!.arquivo_antigo).toMatch(/mapa\.db\.corrompido-\d{8}T\d{6}Z$/);
    expect(existsSync(a.aviso!.arquivo_antigo)).toBe(true);
    expect(a.contagens().arquivos).toBe(0);
    a.gravarLote([item("a.ts")]);
    expect(a.contagens().arquivos).toBe(1);
  });

  it("schema_version maior que a do app: guarda o arquivo antigo (com -wal) e recria", () => {
    const dir = pasta();
    const caminho = join(dir, "mapa.db");
    const velho = abrirArmazem({ caminho });
    velho.gravarLote([item("a.ts")]);
    velho.banco.executar(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
    velho.fechar();
    const a = abrir(caminho);
    expect(a.aviso).toMatchObject({ tipo: "recriado", motivo: "versao_maior" });
    expect(a.contagens().arquivos).toBe(0);
    const arq = a.aviso!.arquivo_antigo;
    const antigo = abrirBanco(arq);
    expect(Number(antigo.consultarUm<{ user_version: number }>("PRAGMA user_version")?.user_version)).toBe(SCHEMA_VERSION + 5);
    expect(antigo.consultar("SELECT caminho FROM arquivo")).toEqual([{ caminho: "a.ts" }]);
    antigo.fechar();
  });

  it("duas corrupções seguidas não sobrescrevem o arquivo guardado", () => {
    const dir = pasta();
    const caminho = join(dir, "mapa.db");
    for (let i = 0; i < 2; i++) {
      writeFileSync(caminho, `lixo ${i} `.repeat(40));
      abrir(caminho).fechar();
    }
    expect(readdirSync(dir).filter((n) => n.includes(".corrompido-")).length).toBe(2);
  });
});

describe("ciclo de vida e concorrência", () => {
  it("fechar libera o handle (idempotente), o banco recusa uso e o arquivo pode ser apagado; apagar() remove tudo", () => {
    const dir = pasta();
    const caminho = join(dir, "mapa.db");
    const a = abrirArmazem({ caminho });
    a.gravarLote([item("a.ts")]);
    a.fechar();
    a.fechar();
    expect(() => a.contagens()).toThrow(/fechado/);
    const b = abrirArmazem({ caminho });
    expect(b.contagens().arquivos).toBe(1);
    b.apagar();
    expect(readdirSync(dir).filter((n) => n.startsWith("mapa.db"))).toEqual([]);
  });

  it("duas escritas concorrentes (dois handles, mesmo arquivo) serializam sem perder dados", async () => {
    const caminho = join(pasta(), "mapa.db");
    const a = abrir(caminho);
    const b = abrir(caminho);
    const lote = (de: number, n: number): ItemExtracao[] => Array.from({ length: n }, (_, k) => item(`p/f${de + k}.ts`, extracaoSintetica(de + k)));
    const [ra, rb] = await Promise.all([a.gravarEmFatias(lote(0, 200), { fatia: 20 }), b.gravarEmFatias(lote(1000, 200), { fatia: 20 })]);
    expect(ra.gravados).toBe(200);
    expect(rb.gravados).toBe(200);
    expect(a.contagens().arquivos).toBe(400);
    expect(b.verificarIntegridade()).toBe(true);
  });
});

describe("desempenho do armazém (T-17.04)", () => {
  it("5 000 arquivos inseridos em até 1,5 s; consulta quente ≤ 5 ms; busca ≤ 50 ms; fatias não travam o event loop", async () => {
    const itens = Array.from({ length: 5000 }, (_, i) => item(`m${i % 50}/f${i}.ts`, extracaoSintetica(i)));
    // melhor de 3 execuções em armazéns novos: reduz o ruído de uma máquina compartilhada (o mínimo é o custo real)
    let a = abrir();
    let ms = Infinity;
    for (let n = 0; n < 3; n++) {
      a = abrir();
      const t0 = performance.now();
      const r = a.gravarLote(itens);
      ms = Math.min(ms, performance.now() - t0);
      expect(r.gravados).toBe(5000);
    }
    console.log(`gravarLote 5 000 arquivos: ${ms.toFixed(0)} ms (nós: ${a.contagens().nos})`);
    // no teste de unidade os arquivos de teste rodam em paralelo (máquina disputada): folga de 2×; o orçamento estrito de
    // 1,5 s é medido em série por tests/perf/mapa.perf.ts
    expect(ms).toBeLessThan(1500 * 2 * fatorPerf());

    // consulta quente: mediana de 100 execuções após aquecimento
    const medir = (fn: () => unknown): number => {
      for (let i = 0; i < 5; i++) fn();
      const t: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s = performance.now();
        fn();
        t.push(performance.now() - s);
      }
      return t.sort((x, y) => x - y)[50] as number;
    };
    const mNo = medir(() => a.no("sim:m3/f2503.ts#f2503_4"));
    const mViz = medir(() => a.vizinhos("sim:m3/f2503.ts#f2503_4", { direcao: "ambas" }));
    const mBusca = medir(() => a.buscar("f2503_4", { tipos: ["simbolo"] }));
    console.log(`consulta quente (mediana): no ${mNo.toFixed(3)} ms, vizinhos ${mViz.toFixed(3)} ms, busca ${mBusca.toFixed(2)} ms`);
    expect(mNo).toBeLessThan(5);
    expect(mViz).toBeLessThan(5);
    expect(mBusca).toBeLessThan(50);

    // reanálise parcial em fatias: o event loop continua respirando
    const a2 = abrir();
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    await a2.gravarEmFatias(itens.slice(0, 2000)); // fatia padrão (10 arquivos por transação)
    h.disable();
    const maxMs = h.max / 1e6;
    console.log(`gravarEmFatias 2 000 arquivos (fatia padrão): pior atraso do event loop ${maxMs.toFixed(1)} ms`);
    expect(maxMs).toBeLessThan(50 * 2 * fatorPerf()); // 2× de folga: suítes em paralelo; o limite estrito de 50 ms é de tests/perf/mapa.perf.ts
  }, 60_000);
});
