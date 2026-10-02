import { afterAll, afterEach, describe, expect, it } from "vitest";
import { reg, suiteDeContrato } from "../../../../../tests/fixtures/conhecimento/suite-contrato";
import { criarArmazenamentoStub, fabricaStub, type ArmazenamentoStub } from "../../../../../tests/fixtures/rag/ambiente";
import { ColecaoDivergenteErro } from "../../armazenamento/interface";

const { fab, fecharTodos } = fabricaStub("upstash");
afterAll(fecharTodos);
suiteDeContrato("upstash (HTTP + stub em loopback)", fab);

const COL = { dimensao: 4, metrica: "cosseno" as const, modeloEmbedding: "hash-test-v1" };
const uid = (n: number): string => `00000000-0000-5000-8000-${String(n).padStart(12, "0")}`;
const abertos: ArmazenamentoStub[] = [];
afterEach(async () => {
  while (abertos.length) await (abertos.pop() as ArmazenamentoStub).limpar();
});
const criar = async (stub: Parameters<typeof criarArmazenamentoStub>[1] = {}): Promise<ArmazenamentoStub> => {
  const a = await criarArmazenamentoStub("upstash", stub);
  abertos.push(a);
  return a;
};

describe("upstash: particularidades", () => {
  it("namespace no caminho; texto em `data`, meta nos metadados; token só em Authorization", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0], { texto: "olá" })]);
    const up = a.stub.requisicoes.filter((r) => r.caminho === "/upsert/col_teste").pop();
    const [v] = JSON.parse(up?.corpo ?? "[]") as Array<{ id: string; data: string; metadata: Record<string, unknown> }>;
    expect(v?.data).toBe("olá");
    expect(v?.metadata.projeto_id).toBe("proj_a");
    expect(v?.metadata.texto).toBeUndefined();
  });
  it("dimensão acima do teto do plano grátis (1536) e índice de outra dimensão/função são recusados", async () => {
    const a = await criar();
    await expect(a.armazenamento.garantirColecao({ ...COL, dimensao: 3072 })).rejects.toBeInstanceOf(ColecaoDivergenteErro);
    expect(a.armazenamento.capacidades()).toMatchObject({ dimensaoMaxima: 1536, consistenciaEventual: true, hibrido: false });
    await expect(a.armazenamento.garantirColecao({ ...COL, dimensao: 8 })).rejects.toThrow(/dimensão do índice/);
    const e = await criar({ stub: { metrica: "euclidiana" } });
    await expect(e.armazenamento.garantirColecao(COL)).rejects.toThrow(/similaridade/);
  });
  it("consistência eventual: a contagem só enxerga o que foi assentado", async () => {
    const a = await criar({ stub: { modo: { eventual: true } } });
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0]), reg(uid(2), [0, 1, 0, 0])]);
    expect(await a.armazenamento.contar()).toBe(0);
    a.assentar();
    expect(await a.armazenamento.contar()).toBe(2);
  });
  it("sem texto de híbrido nativo: o termo raro sobe por RRF no cliente sobre os candidatos", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0], { texto: "comum" }), reg(uid(2), [0, 0, 1, 0], { texto: "raro zanzibar9931" })]);
    expect((await a.armazenamento.consultar({ vetor: [1, 0, 0, 0], texto: "zanzibar9931", k: 2 }))[0]?.id).toBe(uid(2));
  });
  it("apagar por filtro usa o delete nativo e devolve a contagem do servidor", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0], { tipo: "doc" }), reg(uid(2), [0, 1, 0, 0], { tipo: "commit" })]);
    expect((await a.armazenamento.apagar({ campo: "tipo", igual: "commit" })).apagados).toBe(1);
    expect(a.stub.requisicoes.some((r) => r.caminho === "/delete/col_teste" && r.corpo.includes('"filter"'))).toBe(true);
  });
});
