import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco } from "../banco/banco";
import { migrar, versaoAtual } from "../banco/migrar";
import { abrirBancoConhecimento } from "./banco";
import { consultaMatch, ftsDisponivel, garantirFts, termosDeIdentificadores } from "./fts";
import { MIGRACOES_CONHECIMENTO } from "./migracoes";
import { criarRepos } from "./repos";

const pastas: string[] = [];
afterEach(() => pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
const T = "2026-09-01T10:00:00.000Z";

function repos() {
  const { banco } = abrirBancoConhecimento(":memory:");
  return { banco, r: criarRepos(banco, () => T) };
}
const meta = (r: ReturnType<typeof criarRepos>, colecao_id: string, origem: string, hash = "h1") => ({ id: `d_${origem}`, colecao_id, tipo: "doc" as const, origem, titulo: origem, hash_conteudo: hash, fonte: "sistema" as const, mission_id: null, task_ref: null, pane_id: null, cli: null, modelo_autor: null, autor: null, importancia: 3, expira_em: null, ocorrido_em: T });
const chunk = (id: string, texto: string) => ({ id, ordem: 0, texto, titulos: "", termos: "", hash: `h_${id}` });

describe("conhecimento.db: migrations próprias", () => {
  it("migration idempotente e user_version próprio", () => {
    const { banco } = abrirBancoConhecimento(":memory:");
    expect(versaoAtual(banco)).toBe(MIGRACOES_CONHECIMENTO.length);
    expect(migrar(banco, { migracoes: MIGRACOES_CONHECIMENTO }).aplicadas).toEqual([]);
    expect(banco.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rag_%'").length).toBeGreaterThan(10);
    banco.fechar();
  });
  it("arquivo em disco: WAL e reabertura preservam os dados", () => {
    const p = mkdtempSync(join(tmpdir(), "ade-conh-"));
    pastas.push(p);
    const caminho = join(p, "conhecimento.db");
    const a = abrirBancoConhecimento(caminho);
    const ra = criarRepos(a.banco, () => T);
    const col = ra.colecao.garantir({ escopo: "workspace", workspace_id: "ws1", nome: "p", modelo: "hash-256-v1", dimensao: 256 });
    ra.documento.gravar(meta(ra, col.id, "a.md"), [chunk("c1", "texto persistido")]);
    a.banco.fechar();
    const b = abrirBancoConhecimento(caminho);
    expect(criarRepos(b.banco).documento.contagens(col.id)).toEqual({ documentos: 1, chunks: 1 });
    b.banco.fechar();
  });
  it("não mistura com o banco do domínio: versão de um não afeta o outro", () => {
    const dom = abrirBanco(":memory:");
    migrar(dom);
    const { banco } = abrirBancoConhecimento(":memory:");
    expect(versaoAtual(dom)).not.toBe(versaoAtual(banco));
    dom.fechar();
    banco.fechar();
  });
});

describe("repositórios", () => {
  it("CASCADE: remover documento apaga chunk, vetor e arestas; nós órfãos saem; tombstone barra reentrada", () => {
    const { r } = repos();
    const col = r.colecao.garantir({ escopo: "workspace", workspace_id: "ws1", nome: "p", modelo: "m", dimensao: 4 });
    const g = r.documento.gravar(meta(r, col.id, "a.md"), [chunk("c1", "alfa beta")], [{ chunk_id: "c1", modelo: "m", vetor: new Float32Array([1, 0, 0, 0]) }]);
    expect(g.resultado).toBe("novo");
    const n1 = r.grafo.upsertNo({ colecao_id: col.id, tipo: "doc", chave: "a.md", rotulo: "a", quando: T });
    const n2 = r.grafo.upsertNo({ colecao_id: col.id, tipo: "arquivo", chave: "x.ts", rotulo: "x", quando: T });
    r.grafo.upsertAresta({ origem_id: n1, destino_id: n2, tipo: "citou", documento_id: "d_a.md", quando: T });
    expect(r.banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_vetor")?.n).toBe(1);
    const rem = r.documento.remover(col.id, { origem: "a.md" });
    expect(rem.removidos).toBe(1);
    expect(r.banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_vetor")?.n).toBe(0);
    expect(r.banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_chunk")?.n).toBe(0);
    expect(r.banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_aresta")?.n).toBe(0);
    expect(r.banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_no")?.n).toBe(0);
    expect(r.documento.gravar(meta(r, col.id, "a.md"), [chunk("c1", "alfa beta")]).resultado).toBe("recusado");
  });
  it("substituir (hash novo) troca os chunks e o índice FTS acompanha", () => {
    const { r, banco } = repos();
    const col = r.colecao.garantir({ escopo: "workspace", workspace_id: "ws1", nome: "p", modelo: "m", dimensao: 4 });
    r.documento.gravar(meta(r, col.id, "a.md", "h1"), [chunk("c1", "palavra velha")]);
    const s = r.documento.gravar(meta(r, col.id, "a.md", "h2"), [chunk("c2", "palavra nova")]);
    expect(s).toMatchObject({ resultado: "substituido", removidos: ["c1"], adicionados: ["c2"] });
    expect(banco.consultar("SELECT rowid FROM rag_chunk_fts WHERE rag_chunk_fts MATCH 'velha'")).toHaveLength(0);
    expect(banco.consultar("SELECT rowid FROM rag_chunk_fts WHERE rag_chunk_fts MATCH 'nova'")).toHaveLength(1);
  });
  it("coleção por workspace é única; feedback é idempotente no dia; fila é limitada", () => {
    const { r } = repos();
    const a = r.colecao.garantir({ escopo: "workspace", workspace_id: "ws1", nome: "p", modelo: "m", dimensao: 4 });
    expect(r.colecao.garantir({ escopo: "workspace", workspace_id: "ws1", nome: "p", modelo: "m", dimensao: 4 }).id).toBe(a.id);
    expect(r.feedback.registrar({ alvo_tipo: "chunk", alvo_id: "c", valor: "util", por: "humano", autor_ref: "humano" })).toBe(true);
    expect(r.feedback.registrar({ alvo_tipo: "chunk", alvo_id: "c", valor: "util", por: "humano", autor_ref: "humano" })).toBe(false);
    for (let i = 0; i < 12; i++) r.fila.enfileirar(`{"i":${i}}`, 5, 10);
    expect(r.fila.pendentes()).toBe(10);
  });
});

describe("FTS5", () => {
  it("detecção por tentativa; consulta segura; termos de identificadores", () => {
    const { banco } = abrirBancoConhecimento(":memory:");
    expect(garantirFts(banco)).toBe(true);
    expect(ftsDisponivel(banco)).toBe(true);
    expect(garantirFts(banco, { simularAusencia: true })).toBe(false);
    expect(ftsDisponivel(banco)).toBe(false);
    expect(consultaMatch('rota" OR NEAR(b) * ^ xyz')).toBe('"rota" OR "xyz"*');
    expect(consultaMatch("")).toBeNull();
    expect(termosDeIdentificadores("exportarCsvPedidos usuario_id")).toEqual(expect.stringContaining("exportar csv pedidos"));
    banco.fechar();
  });
});
