import type { Banco } from "../banco/banco";
import { SCHEMA_VERSION } from "./tipos";

// DDL do armazém do mapa (§4.4 do plano; T-17.01). Arquivo SQLite PRÓPRIO por workspace
// (`<userData>/mapas/<ws>/mapa.db`); NÃO usa as migrations do banco principal. É cache reconstruível:
// `PRAGMA user_version` = SCHEMA_VERSION; versão maior que a do app => `reconstruir`.

export const TABELAS_MAPA = [
  "meta",
  "arquivo",
  "extracao",
  "no",
  "aresta",
  "externo",
  "acoplamento_temporal",
  "regra_fronteira",
  "layout_cache",
  "analise_cache",
  "execucao",
] as const;

export const INDICES_MAPA = ["no_arquivo", "no_tipo", "no_rotulo", "aresta_de", "aresta_para", "aresta_arq"] as const;

export const DDL_V1 = `
CREATE TABLE meta(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE arquivo(
  id INTEGER PRIMARY KEY, caminho TEXT NOT NULL UNIQUE, linguagem TEXT NOT NULL, hash TEXT NOT NULL, tamanho INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
  loc INTEGER, loc_codigo INTEGER, loc_comentario INTEGER, complexidade_total INTEGER, complexidade_max INTEGER,
  e_teste INTEGER NOT NULL DEFAULT 0, e_gerado INTEGER NOT NULL DEFAULT 0, e_migracao INTEGER NOT NULL DEFAULT 0,
  erros_parse INTEGER NOT NULL DEFAULT 0, degradado INTEGER NOT NULL DEFAULT 0, modulo TEXT NOT NULL,
  camada INTEGER, ciclo_id INTEGER, pagerank REAL,
  churn_total INTEGER, churn_janela INTEGER, autores_n INTEGER, criado_git TEXT, ultima_alt TEXT, commits_correcao INTEGER,
  cobertura_estado TEXT, cobertura_pct REAL, cobertura_fonte TEXT, analisado_em TEXT NOT NULL);
CREATE TABLE extracao(arquivo_id INTEGER PRIMARY KEY REFERENCES arquivo(id) ON DELETE CASCADE, versao_extrator INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE no(id TEXT PRIMARY KEY, tipo TEXT NOT NULL, subtipo TEXT, rotulo TEXT NOT NULL,
  arquivo_id INTEGER REFERENCES arquivo(id) ON DELETE CASCADE, linha_ini INTEGER, linha_fim INTEGER, exportado INTEGER, atributos TEXT);
CREATE TABLE aresta(id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, de TEXT NOT NULL, para TEXT NOT NULL,
  confianca TEXT NOT NULL CHECK(confianca IN ('exata','heuristica')), peso INTEGER NOT NULL DEFAULT 1, candidatos INTEGER,
  fonte TEXT NOT NULL DEFAULT 'extracao', arquivo_id INTEGER REFERENCES arquivo(id) ON DELETE CASCADE, linha INTEGER, evidencias TEXT);
CREATE INDEX no_arquivo ON no(arquivo_id);
CREATE INDEX no_tipo ON no(tipo, subtipo);
-- busca por prefixo do nome (LIKE 'abc%' usa o índice porque o LIKE do SQLite ignora maiúsculas e minúsculas em ASCII)
CREATE INDEX no_rotulo ON no(rotulo COLLATE NOCASE);
CREATE INDEX aresta_de ON aresta(de, tipo);
CREATE INDEX aresta_para ON aresta(para, tipo);
CREATE INDEX aresta_arq ON aresta(arquivo_id);
CREATE TABLE externo(id TEXT PRIMARY KEY, ecossistema TEXT, nome TEXT, versao TEXT, declarado INTEGER, dev INTEGER, licenca TEXT, licenca_fonte TEXT);
CREATE TABLE acoplamento_temporal(a INTEGER, b INTEGER, co_alteracoes INTEGER, grau REAL, PRIMARY KEY(a,b));
CREATE TABLE regra_fronteira(id INTEGER PRIMARY KEY, origem TEXT, destino TEXT, tipo TEXT, fonte_arquivo TEXT, fonte_linha INTEGER, ferramenta TEXT);
CREATE TABLE layout_cache(chave TEXT PRIMARY KEY, nivel TEXT, posicoes BLOB, criado_em TEXT);
CREATE TABLE analise_cache(chave TEXT PRIMARY KEY, versao_mapa INTEGER, json TEXT);
CREATE TABLE execucao(id INTEGER PRIMARY KEY, tipo TEXT, iniciada_em TEXT, terminada_em TEXT, estado TEXT, arquivos_total INTEGER, arquivos_extraidos INTEGER, erros INTEGER);
`;

export type EstadoMigracao = "criado" | "atual" | "migrado" | "reconstruir";

export interface ResultadoMigracao {
  estado: EstadoMigracao;
  versao_antes: number;
  versao_depois: number;
}

/** Migrações incrementais: índice = versão de destino. Vazio enquanto a versão 1 é a única. */
const MIGRACOES: Record<number, string> = {};

export function lerVersao(db: Banco): number {
  const linha = db.consultarUm<{ user_version: number }>("PRAGMA user_version");
  return Number(linha?.user_version ?? 0);
}

/**
 * Cria ou atualiza o esquema. Banco de versão MAIOR que a do app não é tocado: devolve `reconstruir`
 * e quem abriu renomeia o arquivo (nunca apaga em silêncio) e recomeça.
 */
export function migrar(db: Banco): ResultadoMigracao {
  const antes = lerVersao(db);
  if (antes > SCHEMA_VERSION) return { estado: "reconstruir", versao_antes: antes, versao_depois: antes };
  if (antes === SCHEMA_VERSION) return { estado: "atual", versao_antes: antes, versao_depois: antes };
  if (antes === 0) {
    const existe = db.consultarUm("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'");
    if (existe !== undefined) return { estado: "reconstruir", versao_antes: 0, versao_depois: 0 }; // tabelas sem versão: origem desconhecida
    db.transacao((tx) => {
      tx.executar(DDL_V1);
      tx.executar(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    return { estado: "criado", versao_antes: 0, versao_depois: SCHEMA_VERSION };
  }
  db.transacao((tx) => {
    for (let v = antes + 1; v <= SCHEMA_VERSION; v++) {
      const sql = MIGRACOES[v];
      if (sql === undefined) throw new Error(`migração do mapa para a versão ${v} ausente`);
      tx.executar(sql);
    }
    tx.executar(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
  return { estado: "migrado", versao_antes: antes, versao_depois: SCHEMA_VERSION };
}
