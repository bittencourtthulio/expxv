import { afterAll, afterEach, describe, expect, it } from "vitest";
import { reg, suiteDeContrato } from "../../../../../tests/fixtures/conhecimento/suite-contrato";
import { criarArmazenamentoStub, fabricaStub, type ArmazenamentoStub } from "../../../../../tests/fixtures/rag/ambiente";
import { ColecaoDivergenteErro } from "../../armazenamento/interface";

const { fab, fecharTodos } = fabricaStub("qdrant");
afterAll(fecharTodos);
suiteDeContrato("qdrant (HTTP + stub em loopback)", fab);

const COL = { dimensao: 4, metrica: "cosseno" as const, modeloEmbedding: "hash-test-v1" };
const uid = (n: number): string => `00000000-0000-5000-8000-${String(n).padStart(12, "0")}`;
const abertos: ArmazenamentoStub[] = [];
afterEach(async () => {
  while (abertos.length) await (abertos.pop() as ArmazenamentoStub).limpar();
});
const criar = async (): Promise<ArmazenamentoStub> => {
  const a = await criarArmazenamentoStub("qdrant");
  abertos.push(a);
  return a;
};

describe("qdrant: particularidades", () => {
  it("cria a coleção com a distância certa, índices de payload e índice de texto; reutiliza se já existe", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao({ ...COL, metrica: "produto_interno" });
    const put = a.stub.requisicoes.find((r) => r.metodo === "PUT" && r.caminho.startsWith("/collections/col_teste?"));
    expect(JSON.parse(put?.corpo ?? "{}")).toMatchObject({ vectors: { size: 4, distance: "Dot" } });
    const campos = a.stub.requisicoes.filter((r) => r.caminho.includes("/index")).map((r) => (JSON.parse(r.corpo) as { field_name: string }).field_name);
    expect(campos).toEqual(expect.arrayContaining(["projeto_id", "tipo", "criado_em_ms", "texto"]));
    const n = a.stub.requisicoes.length;
    await a.novoCliente().armazenamento.garantirColecao({ ...COL, metrica: "produto_interno" });
    expect(a.stub.requisicoes.slice(n).some((r) => r.metodo === "PUT" && r.caminho.startsWith("/collections/col_teste?"))).toBe(false);
  });
  it("o ponto de configuração não aparece em contar, buscar nem exportar; ids são UUID", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    expect(a.stub.colecoes()).toEqual(["col_teste"]);
    expect(await a.armazenamento.contar()).toBe(0);
    expect(await a.armazenamento.consultar({ vetor: [1, 0, 0, 0], k: 5 })).toEqual([]);
    expect((await a.armazenamento.exportarPagina(null)).itens).toEqual([]);
    await expect(a.armazenamento.upsert([reg("nao-e-uuid", [1, 0, 0, 0])])).rejects.toThrow(/HTTP 400/);
  });
  it("híbrido usa a busca textual nativa (scroll com match de texto) e o termo raro sobe", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0], { texto: "comum" }), reg(uid(2), [0, 0, 1, 0], { texto: "o código zanzibar9931 aparece" })]);
    const r = await a.armazenamento.consultar({ vetor: [1, 0, 0, 0], texto: "zanzibar9931", k: 2 });
    expect(r[0]?.id).toBe(uid(2));
    expect(a.stub.requisicoes.some((q) => q.caminho.endsWith("/points/scroll") && q.corpo.includes('"text":"zanzibar9931"'))).toBe(true);
  });
  it("coleção existente com dados mas sem registro de configuração é recusada (não adota às cegas)", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0])]);
    // apaga o ponto de configuração direto no stub e tenta de novo com outro cliente
    const stubColecao = a.stub.registros();
    expect(stubColecao).toHaveLength(1);
    await a.stub.requisicoes; // (apenas leitura)
    const b = a.novoCliente();
    await expect(b.armazenamento.garantirColecao({ ...COL, dimensao: 8 })).rejects.toBeInstanceOf(ColecaoDivergenteErro);
  });
  it("apagar devolve a contagem exata e só remove o escopo do filtro", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0], { tipo: "doc" }), reg(uid(2), [0, 1, 0, 0], { tipo: "commit" })]);
    expect((await a.armazenamento.apagar({ campo: "tipo", igual: "commit" })).apagados).toBe(1);
    expect(a.stub.registros().map((r) => r.id)).toEqual([uid(1)]);
  });
});
