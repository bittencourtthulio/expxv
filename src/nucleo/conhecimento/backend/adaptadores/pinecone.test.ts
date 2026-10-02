import { afterAll, afterEach, describe, expect, it } from "vitest";
import { reg, suiteDeContrato } from "../../../../../tests/fixtures/conhecimento/suite-contrato";
import { criarArmazenamentoStub, fabricaStub, type ArmazenamentoStub } from "../../../../../tests/fixtures/rag/ambiente";
import { ColecaoDivergenteErro } from "../../armazenamento/interface";

const { fab, fecharTodos } = fabricaStub("pinecone");
afterAll(fecharTodos);
suiteDeContrato("pinecone (HTTP + stub em loopback)", fab);

const COL = { dimensao: 4, metrica: "cosseno" as const, modeloEmbedding: "hash-test-v1" };
const uid = (n: number): string => `00000000-0000-5000-8000-${String(n).padStart(12, "0")}`;
const abertos: ArmazenamentoStub[] = [];
afterEach(async () => {
  while (abertos.length) await (abertos.pop() as ArmazenamentoStub).limpar();
});
const criar = async (stub: Parameters<typeof criarArmazenamentoStub>[1] = {}): Promise<ArmazenamentoStub> => {
  const a = await criarArmazenamentoStub("pinecone", stub);
  abertos.push(a);
  return a;
};

describe("pinecone: particularidades", () => {
  it("upsert por namespace com versão da API no cabeçalho; metadados sem nulos; texto no metadado", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0], { texto: "olá" })]);
    const up = a.stub.requisicoes.filter((r) => r.caminho === "/vectors/upsert").pop();
    expect(up?.cabecalhos["x-pinecone-api-version"]).toMatch(/^\d{4}-\d{2}$/);
    const corpo = JSON.parse(up?.corpo ?? "{}") as { namespace: string; vectors: Array<{ metadata: Record<string, unknown> }> };
    expect(corpo.namespace).toBe("col_teste");
    expect(corpo.vectors[0]?.metadata.texto).toBe("olá");
    expect(Object.values(corpo.vectors[0]?.metadata ?? {}).includes(null)).toBe(false);
  });
  it("índice de outra dimensão/métrica é recusado; capacidades refletem o plano", async () => {
    const a = await criar();
    await expect(a.armazenamento.garantirColecao({ ...COL, dimensao: 8 })).rejects.toBeInstanceOf(ColecaoDivergenteErro);
    const e = await criar({ stub: { metrica: "euclidiana" } });
    await expect(e.armazenamento.garantirColecao(COL)).rejects.toThrow(/métrica do índice/);
    expect(a.armazenamento.capacidades()).toMatchObject({ consistenciaEventual: true, hibrido: false, loteMaximo: 50 });
  });
  it("contagem filtrada, apagar por filtro e exportação com filtro varrem list+fetch (contagem exata)", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    const regs = Array.from({ length: 30 }, (_, i) => reg(uid(i + 1), [1, i + 1, 0, 0], { tipo: i % 3 === 0 ? "commit" : "doc", ms: 1000 + i }));
    for (let i = 0; i < regs.length; i += 10) await a.armazenamento.upsert(regs.slice(i, i + 10));
    expect(await a.armazenamento.contar({ campo: "tipo", igual: "commit" })).toBe(10);
    expect(await a.armazenamento.contar()).toBe(30);
    const pag = await a.armazenamento.exportarPagina(null, 100, { campo: "criado_em_ms", entre: [1010, 1100] });
    expect(pag.itens.length).toBe(20);
    expect((await a.armazenamento.apagar({ campo: "tipo", igual: "commit" })).apagados).toBe(10);
    expect(await a.armazenamento.contar()).toBe(20);
    expect(a.stub.registros()).toHaveLength(20);
  });
  it("lote de 50 passa; o servidor que recusa lote maior não é atingido pelo fatiamento do chamador", async () => {
    const a = await criar({ stub: { modo: { loteMaxServidor: 50 } } });
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert(Array.from({ length: 50 }, (_, i) => reg(uid(i + 1), [1, i + 1, 0, 0])));
    await expect(a.armazenamento.upsert(Array.from({ length: 51 }, (_, i) => reg(uid(i + 100), [1, i + 1, 0, 0])))).rejects.toThrow(/lote acima/);
  });
});
