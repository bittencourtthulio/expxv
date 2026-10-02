// Suíte ÚNICA de contrato dos armazenamentos (G §8): roda contra o stub em memória e contra o ArmazenamentoLocal (e, no futuro,
// contra servidores locais self-host). Sem rede. Cada fábrica devolve um armazenamento NOVO e vazio.
import { describe, expect, it } from "vitest";
import { ColecaoDivergenteErro, CursorInvalidoErro, FiltroInvalidoErro, type ArmazenamentoConhecimento, type MetricaDistancia, type RegistroConhecimento } from "../../../src/nucleo/conhecimento/armazenamento/interface";

export interface Fabrica {
  /** o armazenamento enxerga UM projeto (escopo da coleção): registros de outro projeto são recusados. */
  unicoProjeto?: boolean;
  criar(opcoes?: { loteMaximo?: number; metrica?: MetricaDistancia }): Promise<{ armazenamento: ArmazenamentoConhecimento; limpar(): void; assentar?(): void }>;
}

const DIM = 4;
const MODELO = "hash-test-v1";
const norm = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
};

export function reg(id: string, vetor: number[], o: { texto?: string; projeto?: string; tipo?: string; origem?: string; hash?: string; ms?: number; indice?: number } = {}): RegistroConhecimento {
  const ms = o.ms ?? 1_700_000_000_000;
  return {
    id,
    vetor,
    texto: o.texto ?? `texto ${id}`,
    meta: { projeto_id: o.projeto ?? "proj_a", tipo: o.tipo ?? "doc", origem: o.origem ?? `docs/${id}.md`, hash_conteudo: o.hash ?? `h_${id}`, modelo_embedding: MODELO, dimensao: DIM, criado_em: new Date(ms).toISOString(), criado_em_ms: ms, indice: o.indice ?? 0 },
  };
}

const COL = (metrica: MetricaDistancia = "cosseno") => ({ dimensao: DIM, metrica, modeloEmbedding: MODELO });
const uid = (n: number): string => `00000000-0000-5000-8000-${String(n).padStart(12, "0")}`;

export function suiteDeContrato(nome: string, fab: Fabrica): void {
  describe(`contrato do armazenamento: ${nome}`, () => {
    async function novo(op?: { loteMaximo?: number }) {
      const a = await fab.criar(op);
      await a.armazenamento.garantirColecao(COL());
      return a;
    }

    it("testarConexao ok e sem efeito colateral (não cria coleção nem grava)", async () => {
      const a = await fab.criar();
      expect((await a.armazenamento.testarConexao()).ok).toBe(true);
      a.limpar();
    });

    it("garantirColecao é idempotente e RECUSA dimensão, métrica e modelo divergentes (com dados)", async () => {
      const a = await novo();
      await a.armazenamento.garantirColecao(COL());
      await a.armazenamento.upsert([reg(uid(1), norm([1, 0, 0, 0]))]);
      await expect(a.armazenamento.garantirColecao({ ...COL(), dimensao: 8 })).rejects.toBeInstanceOf(ColecaoDivergenteErro);
      await expect(a.armazenamento.garantirColecao({ ...COL(), modeloEmbedding: "outro-modelo" })).rejects.toBeInstanceOf(ColecaoDivergenteErro);
      await expect(a.armazenamento.garantirColecao(COL("euclidiana"))).rejects.toBeInstanceOf(ColecaoDivergenteErro);
      a.limpar();
    });

    it("upsert é idempotente por id; mesmo id com conteúdo novo substitui (não duplica)", async () => {
      const a = await novo();
      const lote = [reg(uid(1), norm([1, 0, 0, 0])), reg(uid(2), norm([0, 1, 0, 0]))];
      expect((await a.armazenamento.upsert(lote)).gravados).toBe(2);
      await a.armazenamento.upsert(lote);
      a.assentar?.();
      expect(await a.armazenamento.contar()).toBe(2);
      await a.armazenamento.upsert([reg(uid(1), norm([1, 0, 0, 0]), { texto: "conteúdo novo" })]);
      a.assentar?.();
      expect(await a.armazenamento.contar()).toBe(2);
      expect((await a.armazenamento.obterPorIds([uid(1)]))[0]?.texto).toBe("conteúdo novo");
      a.limpar();
    });

    it("lote acima do máximo é recusado (o chamador fatia); vetor de dimensão errada é recusado", async () => {
      const a = await novo({ loteMaximo: 3 });
      const cap = a.armazenamento.capacidades().loteMaximo;
      const muitos = Array.from({ length: cap + 1 }, (_, i) => reg(uid(i + 1), norm([1, i + 1, 0, 0])));
      await expect(a.armazenamento.upsert(muitos)).rejects.toThrow();
      for (let i = 0; i < muitos.length; i += cap) await a.armazenamento.upsert(muitos.slice(i, i + cap));
      a.assentar?.();
      expect(await a.armazenamento.contar()).toBe(cap + 1);
      await expect(a.armazenamento.upsert([reg(uid(99), [1, 0])])).rejects.toBeInstanceOf(ColecaoDivergenteErro);
      a.limpar();
    });

    it.each(["cosseno", "produto_interno", "euclidiana"] as const)("consultar acha o vizinho esperado (%s), com escore em 0..1 ordenado", async (metrica) => {
      const a = await fab.criar({ metrica });
      await a.armazenamento.garantirColecao(COL(metrica));
      await a.armazenamento.upsert([reg(uid(1), norm([1, 0, 0, 0])), reg(uid(2), norm([0, 1, 0, 0])), reg(uid(3), norm([0.9, 0.1, 0, 0]))]);
      const r = await a.armazenamento.consultar({ vetor: norm([1, 0.05, 0, 0]), k: 3 });
      expect(r.map((x) => x.id)[0]).toBe(uid(1));
      expect(r.map((x) => x.id)).toEqual([uid(1), uid(3), uid(2)]);
      for (const x of r) {
        expect(x.escore).toBeGreaterThanOrEqual(0);
        expect(x.escore).toBeLessThanOrEqual(1);
      }
      for (let i = 1; i < r.length; i++) expect((r[i - 1] as { escore: number }).escore).toBeGreaterThanOrEqual((r[i] as { escore: number }).escore);
      a.limpar();
    });

    it("filtro: projeto isola; tipo, em, entre, e/ou; valor com aspas e caracteres especiais não quebra nem injeta", async () => {
      const a = await novo();
      const estranho = `x'"); DROP TABLE rag_chunk; --`;
      const outro = fab.unicoProjeto === true ? "proj_a" : "proj_b";
      await a.armazenamento.upsert([
        reg(uid(1), norm([1, 0, 0, 0]), { projeto: "proj_a", tipo: "doc", ms: 100 }),
        reg(uid(2), norm([1, 0.1, 0, 0]), { projeto: outro, tipo: "doc", ms: 200, origem: "docs/outro.md" }),
        reg(uid(3), norm([1, 0.2, 0, 0]), { projeto: "proj_a", tipo: "decisao", ms: 300 }),
        reg(uid(4), norm([1, 0.3, 0, 0]), { projeto: "proj_a", tipo: "commit", ms: 400, origem: estranho }),
      ]);
      a.assentar?.();
      const q = norm([1, 0, 0, 0]);
      const ids = async (filtro: Parameters<ArmazenamentoConhecimento["consultar"]>[0]["filtro"]) => (await a.armazenamento.consultar({ vetor: q, ...(filtro ? { filtro } : {}), k: 10 })).map((r) => r.id).sort();
      if (fab.unicoProjeto === true) {
        await expect(a.armazenamento.upsert([reg(uid(9), norm([1, 0, 0, 0]), { projeto: "proj_b" })])).rejects.toThrow(/projeto/);
        expect(await ids({ campo: "projeto_id", igual: "proj_b" })).toEqual([]);
      } else {
        expect(await ids({ campo: "projeto_id", igual: "proj_a" })).toEqual([uid(1), uid(3), uid(4)]);
        expect(await ids({ campo: "projeto_id", igual: "proj_b" })).toEqual([uid(2)]);
      }
      expect(await ids({ campo: "tipo", em: ["decisao", "commit"] })).toEqual([uid(3), uid(4)]);
      expect(await ids({ campo: "criado_em_ms", entre: [150, 350] })).toEqual([uid(2), uid(3)]);
      expect(await ids({ e: [{ campo: "projeto_id", igual: "proj_a" }, { ou: [{ campo: "tipo", igual: "doc" }, { campo: "tipo", igual: "commit" }] }] })).toEqual(fab.unicoProjeto === true ? [uid(1), uid(2), uid(4)] : [uid(1), uid(4)]);
      expect(await ids({ campo: "origem", igual: estranho })).toEqual([uid(4)]);
      expect(await a.armazenamento.contar({ campo: "projeto_id", igual: "proj_a" })).toBe(fab.unicoProjeto === true ? 4 : 3);
      expect(await a.armazenamento.contar({ campo: "origem", igual: `'; DROP TABLE x; --` })).toBe(0);
      expect(await a.armazenamento.contar()).toBe(4);
      await expect(a.armazenamento.consultar({ vetor: q, k: 1, filtro: { campo: "campo_inexistente", igual: "x" } })).rejects.toBeInstanceOf(FiltroInvalidoErro);
      a.limpar();
    });

    it("híbrido: um termo raro sem proximidade semântica sobe (nativo ou RRF no cliente: mesmo contrato)", async () => {
      const a = await novo();
      await a.armazenamento.upsert([
        reg(uid(1), norm([1, 0, 0, 0]), { texto: "assunto comum" }),
        reg(uid(2), norm([0.9, 0.1, 0, 0]), { texto: "outro assunto comum" }),
        reg(uid(3), norm([0, 0, 1, 0]), { texto: "o código zanzibar9931 aparece aqui" }),
      ]);
      const so = await a.armazenamento.consultar({ vetor: norm([1, 0, 0, 0]), k: 3 });
      expect(so[0]?.id).toBe(uid(1));
      const h = await a.armazenamento.consultar({ vetor: norm([1, 0, 0, 0]), texto: "zanzibar9931", k: 3 });
      expect(h.map((x) => x.id)).toContain(uid(3));
      expect(h.findIndex((x) => x.id === uid(3))).toBeLessThanOrEqual(1);
      a.limpar();
    });

    it("exportarPagina percorre tudo sem repetir nem perder (páginas de tamanhos variados); cursor inválido dá erro; reimportar reproduz ids e checksums", async () => {
      const a = await novo();
      const todos = Array.from({ length: 23 }, (_, i) => reg(uid(i + 1), norm([1, i + 1, 0, 0]), { hash: `h${i}` }));
      for (let i = 0; i < todos.length; i += 5) await a.armazenamento.upsert(todos.slice(i, i + 5));
      a.assentar?.();
      for (const tam of [1, 4, 7, 100]) {
        const vistos: string[] = [];
        let cursor: string | null = null;
        do {
          const p: Awaited<ReturnType<ArmazenamentoConhecimento["exportarPagina"]>> = await a.armazenamento.exportarPagina(cursor, tam);
          vistos.push(...p.itens.map((r) => r.id));
          cursor = p.proximoCursor;
        } while (cursor !== null);
        expect(vistos).toHaveLength(23);
        expect(new Set(vistos).size).toBe(23);
      }
      await expect(a.armazenamento.exportarPagina("lixo-invalido")).rejects.toBeInstanceOf(CursorInvalidoErro);
      const novo2 = await fab.criar();
      await novo2.armazenamento.garantirColecao(COL());
      let cur: string | null = null;
      do {
        const p: Awaited<ReturnType<ArmazenamentoConhecimento["exportarPagina"]>> = await a.armazenamento.exportarPagina(cur, 5);
        await novo2.armazenamento.upsert(p.itens);
        cur = p.proximoCursor;
      } while (cur !== null);
      novo2.assentar?.();
      expect(await novo2.armazenamento.contar()).toBe(23);
      const ck = async (x: ArmazenamentoConhecimento) => (await x.obterPorIds(todos.map((r) => r.id))).map((r) => `${r.id}:${r.meta.hash_conteudo}`).sort();
      expect(await ck(novo2.armazenamento)).toEqual(await ck(a.armazenamento));
      a.limpar();
      novo2.limpar();
    });

    it("apagar remove só o escopo do filtro; filtro vazio é recusado", async () => {
      const a = await novo();
      await a.armazenamento.upsert([reg(uid(1), norm([1, 0, 0, 0]), { tipo: "doc" }), reg(uid(2), norm([0, 1, 0, 0]), { tipo: "commit" }), reg(uid(3), norm([0, 0, 1, 0]), { tipo: "commit" })]);
      a.assentar?.();
      expect((await a.armazenamento.apagar({ campo: "tipo", igual: "commit" })).apagados).toBe(2);
      a.assentar?.();
      expect(await a.armazenamento.contar()).toBe(1);
      await expect(a.armazenamento.apagar({ e: [] })).rejects.toBeInstanceOf(FiltroInvalidoErro);
      await expect(a.armazenamento.apagar(undefined as never)).rejects.toBeInstanceOf(FiltroInvalidoErro);
      expect(await a.armazenamento.contar()).toBe(1);
      a.limpar();
    });

    it("Unicode, texto grande no limite e meta completo atravessam sem perda", async () => {
      const a = await novo();
      const texto = `ação — 日本語 — 🚀 ${"x".repeat(1900)}`.slice(0, 2000);
      await a.armazenamento.upsert([reg(uid(1), norm([1, 1, 1, 1]), { texto, origem: "docs/ação/日本語.md", ms: 1_800_000_000_123 })]);
      const [r] = await a.armazenamento.obterPorIds([uid(1)]);
      expect(r?.texto).toBe(texto);
      expect(r?.meta.origem).toBe("docs/ação/日本語.md");
      expect(r?.meta.criado_em_ms).toBe(1_800_000_000_123);
      expect(r?.meta.modelo_embedding).toBe(MODELO);
      a.limpar();
    });

    it("capacidades coerentes", async () => {
      const a = await fab.criar();
      const c = a.armazenamento.capacidades();
      expect(c.loteMaximo).toBeGreaterThan(0);
      expect(c.exportarComCursor).toBe(true);
      expect(c.apagarPorFiltro).toBe(true);
      a.limpar();
    });
  });
}
