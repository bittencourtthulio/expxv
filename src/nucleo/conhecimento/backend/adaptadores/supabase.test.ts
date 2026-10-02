import { afterAll, afterEach, describe, expect, it } from "vitest";
import { reg, suiteDeContrato } from "../../../../../tests/fixtures/conhecimento/suite-contrato";
import { criarArmazenamentoStub, fabricaStub, type ArmazenamentoStub } from "../../../../../tests/fixtures/rag/ambiente";
import { gerarScriptSupabase, SCRIPT_PREPARACAO_SUPABASE } from "./supabase";

const { fab, fecharTodos } = fabricaStub("supabase");
afterAll(fecharTodos);
suiteDeContrato("supabase (HTTP + stub em loopback)", fab);

const COL = { dimensao: 4, metrica: "cosseno" as const, modeloEmbedding: "hash-test-v1" };
const uid = (n: number): string => `00000000-0000-5000-8000-${String(n).padStart(12, "0")}`;
const abertos: ArmazenamentoStub[] = [];
afterEach(async () => {
  while (abertos.length) await (abertos.pop() as ArmazenamentoStub).limpar();
});
const criar = async (stub: Parameters<typeof criarArmazenamentoStub>[1] = {}): Promise<ArmazenamentoStub> => {
  const a = await criarArmazenamentoStub("supabase", stub);
  abertos.push(a);
  return a;
};

describe("supabase: script de preparação", () => {
  it("o script copiável traz extensão, tabela, índice HNSW, RPC de busca, filtro estruturado e RLS", () => {
    for (const trecho of ["create extension if not exists vector", "create table if not exists public.rag_conhecimento", "vector(256)", "using hnsw", "vector_cosine_ops", "rag_conhecimento_buscar(", "rag_conhecimento_buscar_texto(", "rag_conhecimento_filtro_ok(", "enable row level security", "create policy", "revoke all", "texto_busca"]) {
      expect(SCRIPT_PREPARACAO_SUPABASE).toContain(trecho);
    }
    expect(SCRIPT_PREPARACAO_SUPABASE).not.toContain("{{");
    const custom = gerarScriptSupabase({ tabela: "meu_rag", dimensao: 768 });
    expect(custom).toContain("public.meu_rag_buscar(consulta vector(768)");
    expect(() => gerarScriptSupabase({ tabela: "Tabela; drop" })).toThrow();
    expect(() => gerarScriptSupabase({ dimensao: 4000 })).toThrow(/dimensão/);
  });
});

describe("supabase: particularidades", () => {
  it("tabela ausente (script não aplicado): testarConexao explica; nada é criado", async () => {
    const a = await criar({ stub: { modo: { tabelaAusente: true } } });
    const r = await a.armazenamento.testarConexao();
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("script de preparação");
    await expect(a.armazenamento.garantirColecao(COL)).rejects.toThrow(/script de preparação/);
  });
  it("upsert usa merge-duplicates com chaves uniformes e embedding em texto; contagem por content-range", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0]), { ...reg(uid(2), [0, 1, 0, 0]), meta: { ...reg(uid(2), [0, 1, 0, 0]).meta, titulo: "T", equipe_id: "eq" } }]);
    const post = a.stub.requisicoes.filter((r) => r.metodo === "POST" && r.caminho.startsWith("/rest/v1/rag_conhecimento?on_conflict=id")).pop();
    expect(post?.cabecalhos.prefer).toContain("resolution=merge-duplicates");
    const linhas = JSON.parse(post?.corpo ?? "[]") as Array<Record<string, unknown>>;
    expect(new Set(linhas.map((l) => Object.keys(l).sort().join(","))).size).toBe(1);
    expect(typeof linhas[0]?.embedding).toBe("string");
    expect(await a.armazenamento.contar()).toBe(2);
    const cont = a.stub.requisicoes.filter((r) => r.cabecalhos.prefer === "count=exact");
    expect(cont.length).toBeGreaterThan(0);
  });
  it("NUL no texto é removido (Postgres não aceita); busca usa a RPC com filtro estruturado", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0], { texto: "a\u0000b" })]);
    expect((await a.armazenamento.obterPorIds([uid(1)]))[0]?.texto).toBe("ab");
    await a.armazenamento.consultar({ vetor: [1, 0, 0, 0], k: 3, filtro: { campo: "projeto_id", igual: "proj_a" } });
    const rpc = a.stub.requisicoes.find((r) => r.caminho === "/rest/v1/rpc/rag_conhecimento_buscar");
    expect(JSON.parse(rpc?.corpo ?? "{}")).toMatchObject({ k: 3, metrica: "cosseno", filtro: { campo: "projeto_id", igual: "proj_a" } });
  });
  it("busca textual: só termos alfanuméricos chegam ao tsquery (sem injeção)", async () => {
    const a = await criar();
    await a.armazenamento.garantirColecao(COL);
    await a.armazenamento.upsert([reg(uid(1), [1, 0, 0, 0], { texto: "comum" }), reg(uid(2), [0, 0, 1, 0], { texto: "raro zanzibar9931" })]);
    const r = await a.armazenamento.consultar({ vetor: [1, 0, 0, 0], texto: "zanzibar9931 ' | & ! (x) :*", k: 2 });
    expect(r[0]?.id).toBe(uid(2));
    const q = a.stub.requisicoes.find((x) => x.caminho.endsWith("_buscar_texto"));
    expect(JSON.parse(q?.corpo ?? "{}").consulta_texto).toMatch(/^[\p{L}\p{N}_]+( \| [\p{L}\p{N}_]+)*$/u);
  });
  it("tabela explícita inválida é recusada; coleção remota que não é identificador SQL cai na tabela padrão", async () => {
    await expect(criar({ segredos: { service_key: "k".repeat(20), tabela: "Tabela-Ruim" } })).rejects.toThrow(/tabela/);
    const a = await criar({ colecao: "col-com-hifen" });
    expect((await a.armazenamento.testarConexao()).ok).toBe(true);
    expect(a.stub.requisicoes[0]?.caminho).toContain("/rest/v1/rag_conhecimento?");
  });
});
