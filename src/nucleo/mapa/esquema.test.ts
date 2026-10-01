import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco/banco";
import { INDICES_MAPA, lerVersao, migrar, TABELAS_MAPA } from "./esquema";
import { SCHEMA_VERSION } from "./tipos";

const abertos: Banco[] = [];
const pastas: string[] = [];
afterEach(() => {
  for (const b of abertos.splice(0)) b.fechar();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});
const memoria = (): Banco => {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  return b;
};

describe("esquema do armazém do mapa (T-17.01)", () => {
  it("cria todas as tabelas e índices e fixa user_version = 1", () => {
    const b = memoria();
    expect(migrar(b)).toEqual({ estado: "criado", versao_antes: 0, versao_depois: SCHEMA_VERSION });
    const tabelas = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((l) => l.name);
    for (const t of TABELAS_MAPA) expect(tabelas, t).toContain(t);
    const indices = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").map((l) => l.name);
    for (const i of INDICES_MAPA) expect(indices, i).toContain(i);
    expect(lerVersao(b)).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("migrar é idempotente", () => {
    const b = memoria();
    migrar(b);
    expect(migrar(b).estado).toBe("atual");
  });

  it("versão MAIOR que a do app sinaliza `reconstruir` sem tocar no banco", () => {
    const b = memoria();
    migrar(b);
    b.executar(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    const r = migrar(b);
    expect(r.estado).toBe("reconstruir");
    expect(lerVersao(b)).toBe(SCHEMA_VERSION + 1);
    expect(b.consultar("SELECT name FROM sqlite_master WHERE name='arquivo'")).toHaveLength(1);
  });

  it("tabelas sem versão (origem desconhecida) também pedem reconstrução", () => {
    const b = memoria();
    b.executar("CREATE TABLE meta(chave TEXT)");
    expect(migrar(b).estado).toBe("reconstruir");
  });

  it("confianca só aceita exata|heuristica e ON DELETE CASCADE limpa nós e arestas do arquivo", () => {
    const b = memoria();
    migrar(b);
    b.executar("INSERT INTO arquivo(id,caminho,linguagem,hash,tamanho,mtime_ms,modulo,analisado_em) VALUES (1,'a.ts','typescript','h',1,1,'.', 'agora')");
    b.executar("INSERT INTO no(id,tipo,rotulo,arquivo_id) VALUES ('arq:a.ts','arquivo','a.ts',1)");
    expect(() => b.executar("INSERT INTO aresta(tipo,de,para,confianca,arquivo_id) VALUES ('importa','a','b','talvez',1)")).toThrow();
    b.executar("INSERT INTO aresta(tipo,de,para,confianca,arquivo_id) VALUES ('importa','a','b','exata',1)");
    b.executar("INSERT INTO extracao(arquivo_id,versao_extrator,json) VALUES (1,1,'{}')");
    b.executar("DELETE FROM arquivo WHERE id = 1");
    expect(b.consultar("SELECT 1 FROM no")).toHaveLength(0);
    expect(b.consultar("SELECT 1 FROM aresta")).toHaveLength(0);
    expect(b.consultar("SELECT 1 FROM extracao")).toHaveLength(0);
  });

  it("em arquivo: sobrevive a reabertura com a mesma versão", () => {
    const dir = mkdtempSync(join(tmpdir(), "mapa-esquema-"));
    pastas.push(dir);
    const caminho = join(dir, "mapa.db");
    const a = abrirBanco(caminho);
    migrar(a);
    a.fechar();
    const b = abrirBanco(caminho);
    abertos.push(b);
    expect(migrar(b).estado).toBe("atual");
  });
});
