// Segurança dos adaptadores HTTP (os 4 provedores contra o stub em loopback): a chave só vai no cabeçalho certo, nunca em URL/corpo/erro/log;
// nada sai sem consentimento; escape de filtros; redirecionamento; URL insegura; concorrência de equipe.
import { afterEach, describe, expect, it } from "vitest";
import { reg } from "../../../../../tests/fixtures/conhecimento/suite-contrato";
import { CHAVE_SEMENTE, criarArmazenamentoStub, criarAmbienteRag, type ArmazenamentoStub } from "../../../../../tests/fixtures/rag/ambiente";
import { subirStubRag, type ProvedorStub } from "../../../../../tests/fixtures/rag/servidor-stub";
import { FiltroInvalidoErro, type Filtro } from "../../armazenamento/interface";
import { criarArmazenamentoRag, testarConexaoRag } from "../fabrica";
import { traduzirFiltroPostgrest } from "./supabase";
import { traduzirFiltroPinecone } from "./pinecone";
import { traduzirFiltroQdrant } from "./qdrant";
import { traduzirFiltroUpstash } from "./upstash";

const PROVS: readonly ProvedorStub[] = ["qdrant", "supabase", "upstash", "pinecone"];
const CAB_DA_CHAVE: Record<ProvedorStub, string[]> = { qdrant: ["api-key"], supabase: ["apikey", "authorization"], upstash: ["authorization"], pinecone: ["api-key"] };
const COL = { dimensao: 4, metrica: "cosseno" as const, modeloEmbedding: "hash-test-v1" };
const uid = (n: number): string => `00000000-0000-5000-8000-${String(n).padStart(12, "0")}`;
const v = (...x: number[]): number[] => x;

const abertos: ArmazenamentoStub[] = [];
afterEach(async () => {
  while (abertos.length) await (abertos.pop() as ArmazenamentoStub).limpar();
});
async function criar(p: ProvedorStub, o: Parameters<typeof criarArmazenamentoStub>[1] = {}): Promise<ArmazenamentoStub> {
  const a = await criarArmazenamentoStub(p, o);
  abertos.push(a);
  return a;
}

describe.each(PROVS)("%s: credencial e rede", (p) => {
  it("a chave vai SÓ no(s) cabeçalho(s) do provedor: nunca em caminho, query, corpo nem em outro cabeçalho", async () => {
    const a = await criar(p);
    const c = a.armazenamento;
    await c.garantirColecao(COL);
    await c.upsert([reg(uid(1), v(1, 0, 0, 0), { texto: "alfa" })]);
    await c.consultar({ vetor: v(1, 0, 0, 0), texto: "alfa", k: 3 });
    await c.contar();
    await c.contar({ campo: "tipo", igual: "doc" });
    await c.exportarPagina(null, 5);
    await c.obterPorIds([uid(1)]);
    await c.apagar({ campo: "tipo", igual: "inexistente" });
    expect(a.stub.requisicoes.length).toBeGreaterThan(5);
    for (const r of a.stub.requisicoes) {
      expect(r.caminho).not.toContain(CHAVE_SEMENTE);
      expect(r.corpo).not.toContain(CHAVE_SEMENTE);
      const nomes = Object.entries(r.cabecalhos).filter(([, val]) => String(val).includes(CHAVE_SEMENTE)).map(([k]) => k).sort();
      expect(nomes).toEqual([...CAB_DA_CHAVE[p]].sort());
    }
  });

  it("testarConexao não grava nem cria coleção; chave errada falha SEM vazar a chave", async () => {
    const a = await criar(p);
    const r = await a.armazenamento.testarConexao();
    expect(r.ok).toBe(true);
    expect(a.stub.registros()).toHaveLength(0);
    expect(a.stub.colecoes().filter((c) => c !== "rag_conhecimento")).toEqual([]);
    const ruim = await criar(p, { segredos: Object.fromEntries(Object.keys(a.stub.requisicoes[0]?.cabecalhos ?? {}).length > 0 ? [[p === "supabase" ? "service_key" : p === "upstash" ? "token" : "api_key", "chave-errada-0000"]] : []), stub: { modo: { ecoarCredencial: true } } });
    const r2 = await ruim.armazenamento.testarConexao();
    expect(r2.ok).toBe(false);
    expect(r2.motivo).toMatch(/credencial recusada|401/);
    expect(JSON.stringify(r2)).not.toContain("chave-errada-0000");
    expect(JSON.stringify(r2)).not.toContain(CHAVE_SEMENTE);
  });

  it("erro persistente do servidor que ECOA a credencial: mensagens de erro e logs nunca a repetem", async () => {
    const a = await criar(p, { stub: { modo: { ecoarCredencial: true } } });
    await a.armazenamento.garantirColecao(COL);
    a.stub.modo.falhasIniciais = { status: 500, quantas: 99 };
    const erros: string[] = [];
    for (const f of [() => a.armazenamento.upsert([reg(uid(1), v(1, 0, 0, 0))]), () => a.armazenamento.consultar({ vetor: v(1, 0, 0, 0), k: 2 }), () => a.armazenamento.contar(), () => a.armazenamento.exportarPagina(null, 3), () => a.armazenamento.obterPorIds([uid(1)]), () => a.armazenamento.apagar({ campo: "tipo", igual: "x" })]) {
      try {
        await f();
        erros.push("NAO_FALHOU");
      } catch (e) {
        erros.push(`${(e as Error).name}: ${(e as Error).message}\n${JSON.stringify(e)}`);
      }
    }
    expect(erros.every((e) => e !== "NAO_FALHOU")).toBe(true);
    const tudo = `${erros.join("\n")}\n${a.amb.logs.join("\n")}`;
    expect(tudo).not.toContain(CHAVE_SEMENTE);
    expect(tudo).not.toContain("chave_recebida");
    expect(tudo).toContain("HTTP 500");
  });

  it("sem consentimento do host NADA sai: todas as operações falham com consent_required e o servidor não vê conexão", async () => {
    const a = await criar(p, { semConsentimento: true });
    const c = a.armazenamento;
    const falhou = async (f: () => Promise<unknown>): Promise<string> => {
      try {
        await f();
        return "NAO_FALHOU";
      } catch (e) {
        return (e as Error).message;
      }
    };
    for (const f of [() => c.garantirColecao(COL), () => c.upsert([reg(uid(1), v(1, 0, 0, 0))]), () => c.consultar({ vetor: v(1, 0, 0, 0), k: 1 }), () => c.contar(), () => c.exportarPagina(null), () => c.obterPorIds([uid(1)]), () => c.apagar({ campo: "tipo", igual: "x" })]) {
      expect(await falhou(f)).toContain("consent_required");
    }
    expect((await c.testarConexao()).ok).toBe(false);
    expect(a.stub.conexoes()).toBe(0);
    expect(a.stub.requisicoes).toHaveLength(0);
  });

  it("redirecionamento para outro host/porta não é seguido e o destino não recebe a chave", async () => {
    const destino = await subirStubRag({ provedor: p });
    abertos.push({ stub: destino, limpar: () => destino.fechar() } as unknown as ArmazenamentoStub);
    const a = await criar(p, { stub: { modo: { redirecionarPara: `${destino.url}/collections` } } });
    expect((await a.armazenamento.testarConexao()).ok).toBe(false);
    await expect(a.armazenamento.contar()).rejects.toThrow(/redirect/);
    expect(destino.conexoes()).toBe(0);
  });

  it("concorrência de equipe: dois clientes gravando o MESMO id (e lotes sobrepostos) resultam em 1 registro por id", async () => {
    const a = await criar(p);
    const b = a.novoCliente();
    await a.armazenamento.garantirColecao(COL);
    await b.armazenamento.garantirColecao(COL);
    const lote = [reg(uid(1), v(1, 0, 0, 0)), reg(uid(2), v(0, 1, 0, 0))];
    await Promise.all([a.armazenamento.upsert(lote), b.armazenamento.upsert(lote), b.armazenamento.upsert([reg(uid(2), v(0, 1, 0, 0)), reg(uid(3), v(0, 0, 1, 0))])]);
    a.assentar();
    expect(await a.armazenamento.contar()).toBe(3);
    expect(a.stub.registros().map((r) => r.id).sort()).toEqual([uid(1), uid(2), uid(3)]);
    expect(await b.armazenamento.contar()).toBe(3);
  });

  it("coleção de outro modelo/dimensão é recusada com a diferença (nunca mistura)", async () => {
    const a = await criar(p);
    await a.armazenamento.garantirColecao(COL);
    const b = a.novoCliente();
    await expect(b.armazenamento.garantirColecao({ ...COL, modeloEmbedding: "outro" })).rejects.toThrow(/modelo/);
    await expect(b.armazenamento.garantirColecao({ ...COL, metrica: "euclidiana" })).rejects.toThrow(/métrica|distância|similaridade/);
    await expect(b.armazenamento.garantirColecao({ ...COL, dimensao: 8 })).rejects.toThrow(/dimens/);
    await expect(b.armazenamento.upsert([{ ...reg(uid(1), v(1, 0, 0, 0)), meta: { ...reg(uid(1), v(1, 0, 0, 0)).meta, modelo_embedding: "outro" } }])).rejects.toThrow(/modelo/);
  });

  it("filtro hostil (aspas, barra, controle, parênteses, SQL) nunca quebra a consulta nem injeta; não casa com nada", async () => {
    const a = await criar(p);
    await a.armazenamento.garantirColecao(COL);
    const hostil = [`'; DROP TABLE x; --`, `" or 1=1 --`, `a\\'b\\"c`, `)) OR ((origem = 'x`, "x\u0001\u0007\n\r\t", `{"$or":[{}]}`, `*`, `%27`];
    await a.armazenamento.upsert([reg(uid(1), v(1, 0, 0, 0), { origem: "docs/normal.md" }), ...hostil.map((h, i) => reg(uid(10 + i), v(1, 0.1 * (i + 1), 0, 0), { origem: h }))]);
    a.assentar();
    for (const [i, h] of hostil.entries()) {
      const filtro: Filtro = { campo: "origem", igual: h };
      let ids: string[];
      try {
        ids = (await a.armazenamento.consultar({ vetor: v(1, 0, 0, 0), filtro, k: 20 })).map((r) => r.id);
      } catch (e) {
        // único caminho aceitável de recusa: valor com controle no Upstash (dialeto ambíguo)
        expect(p).toBe("upstash");
        expect(e).toBeInstanceOf(FiltroInvalidoErro);
        continue;
      }
      expect(ids).toEqual([uid(10 + i)]);
      expect(await a.armazenamento.contar(filtro)).toBe(1);
    }
    expect(await a.armazenamento.contar()).toBe(1 + hostil.length);
    // `em` com valores hostis
    const em = await a.armazenamento.contar({ campo: "origem", em: ["docs/normal.md", `'); DROP TABLE y; --`] }).catch((e: unknown) => e);
    expect(em).toBe(1);
  });
});

describe("tradução de filtros: escape seguro por dialeto", () => {
  const hostil = `x'"); DROP TABLE rag_chunk; --\\`;
  const f: Filtro = { e: [{ campo: "projeto_id", igual: "p" }, { ou: [{ campo: "origem", igual: hostil }, { campo: "tipo", em: ["a", hostil] }, { campo: "criado_em_ms", entre: [1, 2] }] }] };
  it("Qdrant: valores só como JSON (a string hostil aparece uma vez, como valor, sem alterar a estrutura)", () => {
    const j = traduzirFiltroQdrant(f) as { must: Array<{ should: Array<{ match?: { value?: string; any?: string[] } }> }> };
    expect(j.must[1]?.should[0]?.match?.value).toBe(hostil);
    expect(j.must[1]?.should[1]?.match?.any).toEqual(["a", hostil]);
    expect(Object.keys(j)).toEqual(["must"]);
  });
  it("Pinecone: valores só como JSON dentro de $eq/$in", () => {
    const j = traduzirFiltroPinecone(f) as { $and: Array<{ $or?: Array<Record<string, { $eq?: string; $in?: string[] }>> }> };
    expect(j.$and[1]?.$or?.[0]?.origem?.$eq).toBe(hostil);
    expect(j.$and[1]?.$or?.[1]?.tipo?.$in).toEqual(["a", hostil]);
  });
  it("PostgREST: todo texto entre aspas duplas com `\"` e `\\` escapados", () => {
    const s = traduzirFiltroPostgrest(f);
    expect(s).toContain(`origem.eq."x'\\"); DROP TABLE rag_chunk; --\\\\"`);
    expect(s.startsWith("and(projeto_id.eq.\"p\",or(")).toBe(true);
    expect(s).toContain("and(criado_em_ms.gte.1,criado_em_ms.lte.2)");
    expect(() => traduzirFiltroPostgrest({ campo: "a.b", igual: "x" })).toThrow(FiltroInvalidoErro);
  });
  it("Upstash: aspas simples; `\\` e `'` escapados; controle recusado", () => {
    const s = traduzirFiltroUpstash(f);
    expect(s).toContain(`origem = 'x\\'"); DROP TABLE rag_chunk; --\\\\'`);
    expect(s).toContain("criado_em_ms >= 1 AND criado_em_ms <= 2");
    expect(() => traduzirFiltroUpstash({ campo: "origem", igual: "a\nb" })).toThrow(FiltroInvalidoErro);
    expect(() => traduzirFiltroUpstash({ campo: "origem; x", igual: "a" })).toThrow(FiltroInvalidoErro);
    expect(() => traduzirFiltroUpstash({ campo: "criado_em_ms", entre: [Number.NaN, 1] })).toThrow(FiltroInvalidoErro);
  });
});

describe("fábrica: URL e campos", () => {
  const amb = criarAmbienteRag();
  const base = { provedor: "qdrant", colecao_remota: "col", segredos: { api_key: CHAVE_SEMENTE }, transporte: amb.transporte, projeto_id: "0123456789abcdef" };
  it("http em host público, credencial embutida, esquema errado e campos faltando são recusados", async () => {
    expect(() => criarArmazenamentoRag({ ...base, url: "http://exemplo.com:6333" })).toThrow(/HTTPS/);
    expect(() => criarArmazenamentoRag({ ...base, url: `https://u:${CHAVE_SEMENTE}@exemplo.com` })).toThrow(/usuário nem senha/);
    expect(() => criarArmazenamentoRag({ ...base, url: "ftp://exemplo.com" })).toThrow();
    expect(() => criarArmazenamentoRag({ ...base, provedor: "x" as never, url: "https://exemplo.com" })).toThrow(/provedor/);
    expect(() => criarArmazenamentoRag({ ...base, url: "https://exemplo.com", colecao_remota: "a b/c" })).toThrow(/coleção/);
    expect(() => criarArmazenamentoRag({ ...base, provedor: "upstash", url: "https://x.upstash.io", segredos: {} })).toThrow(/token/);
    expect(() => criarArmazenamentoRag({ ...base, provedor: "pinecone", url: "https://x.pinecone.io", segredos: {} })).toThrow(/api_key/);
    expect(() => criarArmazenamentoRag({ ...base, provedor: "supabase", url: "https://x.supabase.co", segredos: {} })).toThrow(/service_key/);
    expect(() => criarArmazenamentoRag({ ...base, provedor: "supabase", url: "https://x.supabase.co", segredos: { service_key: "k".repeat(20), tabela: "Tabela-Ruim" } })).toThrow(/tabela/);
    expect(() => criarArmazenamentoRag({ ...base, url: "https://qdrant.exemplo.com:6333" })).not.toThrow();
    expect(() => criarArmazenamentoRag({ ...base, provedor: "pinecone", url: "meu-indice-abc.svc.pinecone.io" })).not.toThrow(); // host sem esquema
  });
  it("testarConexaoRag nunca lança, devolve motivo sanitizado e não vaza segredo", async () => {
    const r = await testarConexaoRag({ ...base, url: `http://exemplo.com/?k=${CHAVE_SEMENTE}` });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(CHAVE_SEMENTE);
    const sem = await testarConexaoRag({ ...base, provedor: "upstash", url: "https://x.upstash.io", segredos: {} });
    expect(sem).toMatchObject({ ok: false });
  });
});
