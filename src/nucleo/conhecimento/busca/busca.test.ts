import { describe, expect, it } from "vitest";
import { abrirBancoConhecimento } from "../banco";
import { normalizarL2, type ProvedorEmbedding } from "../embeddings/provedor";
import { RegistroEmbeddings } from "../embeddings/registro";
import { GerenciadorIndices } from "../indice/gerenciador";
import { criarRepos, type Repos } from "../repos";
import { Buscador } from "./buscador";
import { fatorFeedback, fatorTempo, fatorTipo, meiaVidaDe } from "./fatores";
import { fundir, type MetaFusao } from "./fusao";

const AGORA = Date.parse("2026-09-01T00:00:00.000Z");
const meta = (id: string, o: Partial<MetaFusao> = {}): MetaFusao => ({ documento_id: `d_${id}`, tipo: "doc", ocorrido_em: "2026-09-01T00:00:00.000Z", mission_id: null, feedback: { util: 0, inutil: 0, errado: 0 }, ...o });
const metas = (o: Record<string, Partial<MetaFusao>>) => (id: string) => (id in o || /^[a-z0-9]+$/.test(id) ? meta(id, o[id] ?? {}) : undefined);

describe("fatores", () => {
  it.each([
    [{ util: 0, inutil: 0, errado: 0 }, 1],
    [{ util: 1, inutil: 0, errado: 0 }, 1.2],
    [{ util: 10, inutil: 0, errado: 0 }, 1.6],
    [{ util: 0, inutil: 3, errado: 0 }, 0.2],
    [{ util: 0, inutil: 0, errado: 2 }, 0.2],
    [{ util: 2, inutil: 1, errado: 0 }, 1.1],
  ])("fatorFeedback %j → %d", (f, esperado) => expect(fatorFeedback(f)).toBeCloseTo(esperado, 5));
  it.each([
    [0, 365, 1],
    [365, 365, 0.5],
    [730, 365, 0.3],
    [100000, 365, 0.3],
    [-5, 90, 1],
    [90, 90, 0.5],
  ])("fatorTempo idade %d meia-vida %d → %d", (i, m, esperado) => expect(fatorTempo(i, m)).toBeCloseTo(esperado, 5));
  it("fator de tipo e meia-vida por tipo", () => {
    expect(fatorTipo("aprendizado")).toBe(1.3);
    expect(fatorTipo("decisao")).toBe(1.2);
    expect(fatorTipo("chat")).toBe(0.7);
    expect(fatorTipo("desconhecido")).toBe(1);
    expect(meiaVidaDe("decisao")).toBe(365);
    expect(meiaVidaDe("transcricao")).toBe(60);
    expect(meiaVidaDe("aprendizado", "fato")).toBe(90);
    expect(meiaVidaDe("doc")).toBe(180);
  });
});

describe("fundir (RRF + fatores): tabela de casos", () => {
  const base = { k: 5, agora: AGORA };
  const casos: Array<[string, Parameters<typeof fundir>[0], Partial<Parameters<typeof fundir>[1]> & { meta?: (id: string) => MetaFusao | undefined }, string[]]> = [
    ["lista vazia", [], {}, []],
    ["só lexical mantém a ordem", [{ braco: "lexical", ids: ["a", "b", "c"], peso: 1 }], {}, ["a", "b", "c"]],
    ["só vetorial mantém a ordem", [{ braco: "vetorial", ids: ["c", "b"], peso: 0.5 }], {}, ["c", "b"]],
    ["presente nos dois sobe", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }, { braco: "vetorial", ids: ["b", "c"], peso: 1 }], {}, ["b", "a", "c"]],
    ["peso do vetorial hash (0,5) < lexical", [{ braco: "lexical", ids: ["a"], peso: 1 }, { braco: "vetorial", ids: ["z"], peso: 0.5 }], {}, ["a", "z"]],
    ["peso do vetorial real (1,0) empata e desempata pelo id", [{ braco: "lexical", ids: ["b"], peso: 1 }, { braco: "vetorial", ids: ["a"], peso: 1 }], {}, ["a", "b"]],
    ["corta em k", [{ braco: "lexical", ids: ["a", "b", "c", "d"], peso: 1 }], { k: 2 }, ["a", "b"]],
    ["máx. 2 por documento", [{ braco: "lexical", ids: ["a1", "a2", "a3", "b"], peso: 1 }], { meta: (id) => meta(id, { documento_id: id.startsWith("a") ? "dA" : "dB" }) }, ["a1", "a2", "b"]],
    ["descarta chunk sem meta", [{ braco: "lexical", ids: ["x", "a"], peso: 1 }], { meta: (id) => (id === "x" ? undefined : meta(id)) }, ["a"]],
    ["aprendizado ×1,3 passa doc", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { tipo: id === "b" ? "aprendizado" : "doc" }) }, ["b", "a"]],
    ["decisão ×1,2 passa doc vizinho", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { tipo: id === "b" ? "decisao" : "doc" }) }, ["b", "a"]],
    ["código ×0,9 perde para doc", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { tipo: id === "a" ? "codigo" : "doc" }) }, ["b", "a"]],
    ["transcrição perde", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { tipo: id === "a" ? "transcricao" : "doc" }) }, ["b", "a"]],
    ["chat ×0,7 perde", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { tipo: id === "a" ? "chat" : "doc" }) }, ["b", "a"]],
    ["errado ×2 derruba", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { feedback: id === "a" ? { util: 0, inutil: 0, errado: 2 } : { util: 0, inutil: 0, errado: 0 } }) }, ["b", "a"]],
    ["inútil ×3 derruba", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { feedback: id === "a" ? { util: 0, inutil: 3, errado: 0 } : { util: 0, inutil: 0, errado: 0 } }) }, ["b", "a"]],
    ["útil sobe", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { feedback: id === "b" ? { util: 3, inutil: 0, errado: 0 } : { util: 0, inutil: 0, errado: 0 } }) }, ["b", "a"]],
    ["antigo perde para equivalente novo", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { ocorrido_em: id === "a" ? "2024-01-01T00:00:00.000Z" : "2026-09-01T00:00:00.000Z" }) }, ["b", "a"]],
    ["antigo continua achável (piso 0,3)", [{ braco: "lexical", ids: ["a"], peso: 1 }], { meta: (id) => meta(id, { ocorrido_em: "2000-01-01T00:00:00.000Z" }) }, ["a"]],
    ["mesma Missão ×1,15", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { mission_id: "m1", meta: (id) => meta(id, { mission_id: id === "b" ? "m1" : "m2" }) }, ["b", "a"]],
    ["candidato ×0,7 perde", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, { aprendizado_estado: id === "a" ? "candidato" : "ativo" }) }, ["b", "a"]],
    ["grafo entra como terceiro braço", [{ braco: "lexical", ids: ["a"], peso: 1 }, { braco: "grafo", ids: ["g"], peso: 0.6 }], {}, ["a", "g"]],
    ["grafo + lexical no mesmo chunk sobe", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }, { braco: "grafo", ids: ["b"], peso: 0.6 }], {}, ["b", "a"]],
    ["ids repetidos na mesma lista somam", [{ braco: "lexical", ids: ["a", "b", "a"], peso: 1 }], {}, ["a", "b"]],
    ["k=1", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { k: 1 }, ["a"]],
    ["máx por documento configurável (1)", [{ braco: "lexical", ids: ["a1", "a2"], peso: 1 }], { maxPorDocumento: 1, meta: (id) => meta(id, { documento_id: "dA" }) }, ["a1"]],
    ["data inválida não quebra", [{ braco: "lexical", ids: ["a"], peso: 1 }], { meta: (id) => meta(id, { ocorrido_em: "lixo" }) }, ["a"]],
    ["feedback útil + tipo aprendizado empilham", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }], { meta: (id) => meta(id, id === "b" ? { tipo: "aprendizado", feedback: { util: 2, inutil: 0, errado: 0 } } : {}) }, ["b", "a"]],
    ["vetorial forte em 1º vence lexical em 2º", [{ braco: "lexical", ids: ["x", "a"], peso: 1 }, { braco: "vetorial", ids: ["a", "y"], peso: 1 }], {}, ["a", "x", "y"]],
    ["listas disjuntas intercalam por rank", [{ braco: "lexical", ids: ["a", "b"], peso: 1 }, { braco: "vetorial", ids: ["c", "d"], peso: 1 }], {}, ["a", "c", "b", "d"]],
    ["lista sem ids", [{ braco: "lexical", ids: [], peso: 1 }], {}, []],
  ];
  it.each(casos)("%s", (_nome, listas, opc, esperado) => {
    const { meta: m, ...resto } = opc;
    const r = fundir(listas, { ...base, ...resto, meta: m ?? metas({}) });
    expect(r.map((x) => x.chunk_id)).toEqual(esperado);
  });
  it("braço reportado: lexical, vetorial, grafo ou ambos", () => {
    const r = fundir([{ braco: "lexical", ids: ["a", "b"], peso: 1 }, { braco: "vetorial", ids: ["b", "c"], peso: 1 }, { braco: "grafo", ids: ["d"], peso: 1 }], { ...base, k: 10, meta: metas({}) });
    expect(Object.fromEntries(r.map((x) => [x.chunk_id, x.braco]))).toEqual({ a: "lexical", b: "ambos", c: "vetorial", d: "grafo" });
  });
  it("determinístico", () => {
    const l = [{ braco: "lexical" as const, ids: ["a", "b", "c"], peso: 1 }, { braco: "vetorial" as const, ids: ["c", "a"], peso: 0.5 }];
    expect(fundir(l, { ...base, meta: metas({}) })).toEqual(fundir(l, { ...base, meta: metas({}) }));
  });
});

// ---- Buscador com banco real e embedding falso controlado --------------------------------------------------------------------------
const T = "2026-09-01T00:00:00.000Z";
/** Embedding falso: grupos semânticos controlados (paráfrases compartilham eixo, mesmo sem palavra em comum). */
const GRUPOS: Record<string, number> = { carro: 0, automovel: 0, veiculo: 0, banana: 1, fruta: 1, cache: 2 };
const falso: ProvedorEmbedding = {
  id: "fake:grupos:4",
  dimensao: 4,
  qualidade: 1,
  local: true,
  disponivel: async () => true,
  embutir: async (ts) => ts.map((t) => {
    const v = [0, 0, 0, 0.01];
    for (const w of t.toLowerCase().split(/\W+/)) if (w in GRUPOS) v[GRUPOS[w] as number] = (v[GRUPOS[w] as number] as number) + 1;
    return normalizarL2(v);
  }),
};

async function ambiente(textos: Array<{ id: string; texto: string; tipo?: string; ocorrido?: string }>, modelo = falso) {
  const { banco } = abrirBancoConhecimento(":memory:");
  const r: Repos = criarRepos(banco, () => T);
  const col = r.colecao.garantir({ escopo: "workspace", workspace_id: "w", nome: "n", modelo: modelo.id, dimensao: modelo.dimensao });
  const reg = new RegistroEmbeddings();
  reg.registrar(modelo);
  for (const t of textos) {
    const [v] = await modelo.embutir([t.texto]);
    r.documento.gravar({ id: `d_${t.id}`, colecao_id: col.id, tipo: (t.tipo ?? "doc") as never, origem: `${t.id}.md`, titulo: t.id, hash_conteudo: `h_${t.id}`, fonte: "sistema", mission_id: null, task_ref: null, pane_id: null, cli: null, modelo_autor: null, autor: null, importancia: 3, expira_em: null, ocorrido_em: t.ocorrido ?? T }, [{ id: `c_${t.id}`, ordem: 0, texto: t.texto, titulos: "", termos: "", hash: `x_${t.id}` }], [{ chunk_id: `c_${t.id}`, modelo: modelo.id, vetor: v as Float32Array }]);
  }
  const b = new Buscador({ repos: r, registro: reg, indices: new GerenciadorIndices(r), relogio: () => AGORA });
  return { b, r, col, banco };
}

describe("Buscador híbrido (AC-15.01, 11, 12)", () => {
  const corpus = [
    { id: "raro", texto: "o ticket XPTO9931 trata de reconciliacao bancaria" },
    { id: "parafrase", texto: "comprei um automovel novo e fui pagar" },
    { id: "ruido1", texto: "reuniao semanal sobre planejamento" },
    { id: "ruido2", texto: "cache redis expira em cinco minutos" },
    { id: "ruido3", texto: "fruta banana madura" },
  ];
  it("termo raro só pelo lexical; paráfrase só pelo vetorial; híbrido ≥ cada braço", async () => {
    const { b, col, banco } = await ambiente(corpus);
    const lexRaro = await b.buscar({ colecao_id: col.id, consulta: "XPTO9931", modo: "lexical" });
    expect(lexRaro.hits[0]?.chunk.origem).toBe("raro.md");
    const vetRaro = await b.buscar({ colecao_id: col.id, consulta: "XPTO9931", modo: "semantico" });
    // sem proximidade semântica o braço vetorial não discrimina: todos empatam (o lexical é quem acha)
    expect(new Set(vetRaro.hits.map((h) => h.escore.toFixed(9))).size).toBeLessThanOrEqual(2);
    const lexPar = await b.buscar({ colecao_id: col.id, consulta: "carro", modo: "lexical" });
    expect(lexPar.hits.some((h) => h.chunk.origem === "parafrase.md")).toBe(false);
    const vetPar = await b.buscar({ colecao_id: col.id, consulta: "carro", modo: "semantico" });
    expect(vetPar.hits[0]?.chunk.origem).toBe("parafrase.md");
    for (const [q, alvo] of [["XPTO9931", "raro.md"], ["carro", "parafrase.md"]] as const) {
      const h = await b.buscar({ colecao_id: col.id, consulta: q, modo: "hibrido", semGrafo: true });
      expect(h.hits.some((x) => x.chunk.origem === alvo)).toBe(true);
    }
    banco.fechar();
  });
  it("3× inútil derruba o ranking; errado ×2 humano derruba mais; ainda achável", async () => {
    const { b, r, col, banco } = await ambiente([{ id: "a", texto: "estratégia de cache redis" }, { id: "b", texto: "estratégia de cache redis" }]);
    const antes = await b.buscar({ colecao_id: col.id, consulta: "cache redis", modo: "lexical" });
    const primeiro = antes.hits[0]?.chunk.documento_id as string;
    for (const dia of ["a", "b", "c"]) r.banco.executar("INSERT INTO rag_feedback (id,alvo_tipo,alvo_id,valor,por,criado_em) VALUES (?,?,?,?,?,?)", [`f${dia}`, "documento", primeiro, "inutil", "humano", T]);
    const depois = await b.buscar({ colecao_id: col.id, consulta: "cache redis", modo: "lexical" });
    expect(depois.hits[0]?.chunk.documento_id).not.toBe(primeiro);
    expect(depois.hits.some((h) => h.chunk.documento_id === primeiro)).toBe(true);
    banco.fechar();
  });
  it("decaimento: antigo perde para equivalente novo e continua achável", async () => {
    const { b, col, banco } = await ambiente([{ id: "velho", texto: "decisão sobre autenticação", tipo: "decisao", ocorrido: "2020-01-01T00:00:00.000Z" }, { id: "novo", texto: "decisão sobre autenticação", tipo: "decisao" }]);
    const r = await b.buscar({ colecao_id: col.id, consulta: "autenticação", modo: "lexical" });
    expect(r.hits.map((h) => h.chunk.origem)).toEqual(["novo.md", "velho.md"]);
    banco.fechar();
  });
  it("filtro por tipo e por Missão; estado vazio", async () => {
    const { b, col, banco } = await ambiente([{ id: "a", texto: "alfa unico", tipo: "doc" }, { id: "b", texto: "alfa unico", tipo: "decisao" }]);
    const r = await b.buscar({ colecao_id: col.id, consulta: "alfa", modo: "hibrido", filtro: { tipos: ["decisao"] }, semGrafo: true });
    expect(r.hits.map((h) => h.chunk.tipo)).toEqual(["decisao"]);
    const v = await b.buscar({ colecao_id: col.id, consulta: "inexistentexyz", modo: "lexical" });
    expect(v.estado).toBe("vazio");
    banco.fechar();
  });
  it("modelo real fora do ar → degradado com aviso, piso hash e lexical continuam", async () => {
    const { b, col, r, banco } = await ambiente([{ id: "a", texto: "relatório mensal" }]);
    const fora: ProvedorEmbedding = { ...falso, disponivel: async () => false };
    const reg = new RegistroEmbeddings();
    reg.registrar(fora);
    const b2 = new Buscador({ repos: r, registro: reg, indices: new GerenciadorIndices(r), relogio: () => AGORA });
    const res = await b2.buscar({ colecao_id: col.id, consulta: "relatório", modo: "hibrido" });
    expect(res.estado).toBe("degradado");
    expect(res.aviso).toContain("indisponível");
    expect(res.hits[0]?.chunk.origem).toBe("a.md");
    void b;
    banco.fechar();
  });
  it("embedding lento estoura o prazo: devolve o lexical com estado lento", async () => {
    const lento: ProvedorEmbedding = { ...falso, embutir: () => new Promise((res) => setTimeout(() => res([new Float32Array(4)]), 400)) };
    const { r, col, banco } = await ambiente([{ id: "a", texto: "texto lexical achavel" }]);
    const reg = new RegistroEmbeddings();
    reg.registrar(lento);
    const b = new Buscador({ repos: r, registro: reg, indices: new GerenciadorIndices(r), relogio: () => AGORA });
    const t0 = performance.now();
    const res = await b.buscar({ colecao_id: col.id, consulta: "lexical", modo: "hibrido", prazoMs: 50 });
    expect(performance.now() - t0).toBeLessThan(300);
    expect(res.estado).toBe("lento");
    expect(res.hits[0]?.chunk.origem).toBe("a.md");
    banco.fechar();
  });
  it("coleção inexistente → indisponível sem lançar", async () => {
    const { b, banco } = await ambiente([]);
    expect((await b.buscar({ colecao_id: "nao", consulta: "x" })).estado).toBe("indisponivel");
    banco.fechar();
  });
});
