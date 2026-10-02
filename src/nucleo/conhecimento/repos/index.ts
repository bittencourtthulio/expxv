// Repositórios do conhecimento.db (T-15.03). Texto SEMPRE já redigido (o pipeline redige antes de chegar aqui).
// Transação por documento: apaga a versão antiga (mesmo tipo+origem, hash diferente) e grava a nova atomicamente.
import type { Banco } from "../../banco/banco";
import type { TipoDocumento } from "../../../compartilhado/conhecimento";
import { uuid5 } from "../ids";

const iso = (): string => new Date().toISOString();

export interface ColecaoLinha {
  id: string;
  escopo: "workspace" | "usuario" | "compartilhada";
  workspace_id: string | null;
  projeto_id: string | null;
  nome: string;
  modelo_ativo: string;
  dimensao: number;
  metrica: string;
  versao_politica: number;
}

export interface MetaDocumento {
  id: string;
  colecao_id: string;
  tipo: TipoDocumento;
  origem: string;
  titulo: string;
  hash_conteudo: string;
  fonte: "sistema" | "agente" | "usuario";
  mission_id: string | null;
  task_ref: string | null;
  pane_id: string | null;
  cli: string | null;
  modelo_autor: string | null;
  autor: string | null;
  importancia: number;
  expira_em: string | null;
  ocorrido_em: string;
}

export interface ChunkGravar {
  id: string;
  ordem: number;
  texto: string;
  titulos: string;
  termos: string;
  hash: string;
}

export interface VetorLinha {
  chunk_id: string;
  modelo: string;
  vetor: Float32Array;
}

export interface ChunkCompleto {
  chunk_id: string;
  documento_id: string;
  ordem: number;
  texto: string;
  titulos: string;
  tipo: TipoDocumento;
  origem: string;
  titulo: string;
  mission_id: string | null;
  task_ref: string | null;
  pane_id: string | null;
  fonte: string;
  ocorrido_em: string;
  importancia: number;
  doc_estado: string;
  aprendizado_id: string | null;
  aprendizado_estado: string | null;
  feedback: { util: number; inutil: number; errado: number };
}

export type FiltroRemocao =
  | { documento_id: string }
  | { origem: string }
  | { mission_id: string }
  | { pane_id: string }
  | { tipo: TipoDocumento }
  | { antes_de: string }
  | { tudo: true };

export interface NoLinha {
  id: string;
  colecao_id: string;
  tipo: string;
  chave: string;
  rotulo: string;
  props_json: string;
  peso: number;
  x: number | null;
  y: number | null;
  primeiro_em: string;
  ultimo_em: string;
}
export interface ArestaLinha {
  origem_id: string;
  destino_id: string;
  tipo: string;
  documento_id: string;
  peso: number;
}

export interface AprendizadoLinha {
  id: string;
  colecao_id: string;
  documento_id: string | null;
  tipo: string;
  titulo: string;
  texto: string;
  fonte: string;
  estado: string;
  confianca: number;
  hash: string;
  util: number;
  inutil: number;
  errado: number;
  vezes_visto: number;
  proveniencia_json: string;
  substitui_id: string | null;
  ultimo_uso_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ConsultaRegistro {
  id: string;
  colecao_id: string | null;
  workspace_id: string | null;
  mission_id: string | null;
  task_ref: string | null;
  pane_id: string | null;
  origem: string;
  modo: string;
  consulta_redigida: string;
  estado: string;
  n_resultados: number;
  latencia_ms: number;
  sinais_json: string | null;
  criado_em: string;
}

export interface FonteLinha {
  colecao_id: string;
  tipo: string;
  ref: string;
  mtime_ms: number | null;
  tamanho: number | null;
  hash: string | null;
  ultimo_offset: number;
  ultimo_sha: string | null;
}

export interface MigracaoLinha {
  id: string;
  colecao_id: string;
  provedor: string;
  host: string;
  colecao_remota: string;
  estado: string;
  tipos_json: string;
  total: number;
  enviados: number;
  cursor: string | null;
  consentimento_em: string | null;
  erro: string | null;
}

const SEL_CHUNK = `
  SELECT c.id AS chunk_id, c.documento_id, c.ordem, c.texto, c.titulos, d.tipo, d.origem, d.titulo, d.mission_id, d.task_ref, d.pane_id,
         d.fonte, d.ocorrido_em, d.importancia, d.estado AS doc_estado,
         (SELECT a.id FROM rag_aprendizado a WHERE a.documento_id = d.id LIMIT 1) AS aprendizado_id,
         (SELECT a.estado FROM rag_aprendizado a WHERE a.documento_id = d.id LIMIT 1) AS aprendizado_estado,
         (SELECT count(*) FROM rag_feedback f WHERE f.alvo_id IN (c.id, d.id, (SELECT a.id FROM rag_aprendizado a WHERE a.documento_id = d.id LIMIT 1)) AND f.valor = 'util') AS f_util,
         (SELECT count(*) FROM rag_feedback f WHERE f.alvo_id IN (c.id, d.id, (SELECT a.id FROM rag_aprendizado a WHERE a.documento_id = d.id LIMIT 1)) AND f.valor = 'inutil') AS f_inutil,
         (SELECT count(*) FROM rag_feedback f WHERE f.alvo_id IN (c.id, d.id, (SELECT a.id FROM rag_aprendizado a WHERE a.documento_id = d.id LIMIT 1)) AND f.valor = 'errado') AS f_errado
  FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id`;

type LinhaChunk = Omit<ChunkCompleto, "feedback"> & { f_util: number; f_inutil: number; f_errado: number };
const montarChunk = (l: LinhaChunk): ChunkCompleto => {
  const { f_util, f_inutil, f_errado, ...resto } = l;
  return { ...resto, feedback: { util: Number(f_util), inutil: Number(f_inutil), errado: Number(f_errado) } };
};

export function criarRepos(banco: Banco, relogio: () => string = iso) {
  const colecao = {
    garantir(p: { escopo: ColecaoLinha["escopo"]; workspace_id: string | null; projeto_id?: string | null; nome: string; modelo: string; dimensao: number }): ColecaoLinha {
      const ex =
        p.escopo === "workspace"
          ? banco.consultarUm<ColecaoLinha>("SELECT * FROM rag_colecao WHERE escopo='workspace' AND workspace_id = ?", [p.workspace_id])
          : banco.consultarUm<ColecaoLinha>("SELECT * FROM rag_colecao WHERE escopo = ? AND nome = ?", [p.escopo, p.nome]);
      if (ex) return ex;
      const id = `col_${uuid5(`${p.escopo}\n${p.workspace_id ?? ""}\n${p.nome}`).slice(0, 18)}`;
      const t = relogio();
      banco.executar("INSERT INTO rag_colecao (id,escopo,workspace_id,projeto_id,nome,modelo_ativo,dimensao,metrica,versao_politica,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,'cosseno',1,?,?)", [id, p.escopo, p.workspace_id, p.projeto_id ?? null, p.nome, p.modelo, p.dimensao, t, t]);
      return banco.consultarUm<ColecaoLinha>("SELECT * FROM rag_colecao WHERE id = ?", [id]) as ColecaoLinha;
    },
    obter: (id: string): ColecaoLinha | undefined => banco.consultarUm<ColecaoLinha>("SELECT * FROM rag_colecao WHERE id = ?", [id]),
    definirModelo(id: string, modelo: string, dimensao: number): void {
      banco.executar("UPDATE rag_colecao SET modelo_ativo = ?, dimensao = ?, atualizado_em = ? WHERE id = ?", [modelo, dimensao, relogio(), id]);
    },
  };

  const documento = {
    obter: (colecao_id: string, tipo: string, origem: string): (MetaDocumento & { estado: string }) | undefined =>
      banco.consultarUm("SELECT * FROM rag_documento WHERE colecao_id = ? AND tipo = ? AND origem = ?", [colecao_id, tipo, origem]),
    porId: (id: string): (MetaDocumento & { estado: string }) | undefined => banco.consultarUm("SELECT * FROM rag_documento WHERE id = ?", [id]),
    /** Renova a data de relevância (meia-vida renovada por feedback útil). */
    renovar: (id: string, quando: string): void => void banco.executar("UPDATE rag_documento SET ocorrido_em = ?, atualizado_em = ? WHERE id = ?", [quando, quando, id]),
    /** Grava (substituindo a versão antiga). `recusado` quando o hash está em tombstone. */
    gravar(meta: MetaDocumento, chunks: readonly ChunkGravar[], vetores: readonly VetorLinha[] = []): { resultado: "novo" | "substituido" | "inalterado" | "recusado"; removidos: string[]; adicionados: string[] } {
      return banco.transacao((tx) => {
        if (tx.consultarUm("SELECT 1 AS x FROM rag_tombstone WHERE colecao_id = ? AND hash = ?", [meta.colecao_id, meta.hash_conteudo])) return { resultado: "recusado" as const, removidos: [], adicionados: [] };
        const t = relogio();
        const ex = tx.consultarUm<{ id: string; hash_conteudo: string; estado: string }>("SELECT id, hash_conteudo, estado FROM rag_documento WHERE colecao_id = ? AND tipo = ? AND origem = ?", [meta.colecao_id, meta.tipo, meta.origem]);
        if (ex && ex.hash_conteudo === meta.hash_conteudo && ex.estado === "ativo") {
          tx.executar("UPDATE rag_documento SET atualizado_em = ? WHERE id = ?", [t, ex.id]);
          return { resultado: "inalterado" as const, removidos: [], adicionados: [] };
        }
        let removidos: string[] = [];
        if (ex) {
          removidos = tx.consultar<{ id: string }>("SELECT id FROM rag_chunk WHERE documento_id = ?", [ex.id]).map((r) => r.id);
          tx.executar("DELETE FROM rag_chunk WHERE documento_id = ?", [ex.id]);
          tx.executar("DELETE FROM rag_aresta WHERE documento_id = ?", [ex.id]);
          tx.executar("DELETE FROM rag_documento WHERE id = ?", [ex.id]);
        }
        tx.executar(
          "INSERT INTO rag_documento (id,colecao_id,tipo,origem,titulo,hash_conteudo,fonte,mission_id,task_ref,pane_id,cli,modelo_autor,autor,importancia,estado,expira_em,ocorrido_em,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ativo',?,?,?,?)",
          [meta.id, meta.colecao_id, meta.tipo, meta.origem, meta.titulo.slice(0, 200), meta.hash_conteudo, meta.fonte, meta.mission_id, meta.task_ref, meta.pane_id, meta.cli, meta.modelo_autor, meta.autor, meta.importancia, meta.expira_em, meta.ocorrido_em, t, t],
        );
        const ins = tx.preparar("INSERT OR REPLACE INTO rag_chunk (id,documento_id,ordem,texto,titulos,termos,hash,criado_em) VALUES (?,?,?,?,?,?,?,?)");
        for (const c of chunks) ins.executar([c.id, meta.id, c.ordem, c.texto, c.titulos, c.termos, c.hash, t]);
        for (const v of vetores) vetor.gravarEm(tx, v);
        return { resultado: ex ? ("substituido" as const) : ("novo" as const), removidos, adicionados: chunks.map((c) => c.id) };
      });
    },
    /** Esquece (e, por padrão, grava tombstone para a fonte não reentrar). Devolve ids de chunk removidos para o índice. */
    remover(colecao_id: string, filtro: FiltroRemocao, comTombstone = true): { removidos: number; chunks: string[] } {
      let onde = "colecao_id = ?";
      const args: Array<string | number> = [colecao_id];
      if ("documento_id" in filtro) (onde += " AND id = ?"), args.push(filtro.documento_id);
      else if ("origem" in filtro) (onde += " AND origem = ?"), args.push(filtro.origem);
      else if ("mission_id" in filtro) (onde += " AND mission_id = ?"), args.push(filtro.mission_id);
      else if ("pane_id" in filtro) (onde += " AND pane_id = ?"), args.push(filtro.pane_id);
      else if ("tipo" in filtro) (onde += " AND tipo = ?"), args.push(filtro.tipo);
      else if ("antes_de" in filtro) (onde += " AND ocorrido_em < ?"), args.push(filtro.antes_de);
      return banco.transacao((tx) => {
        const docs = tx.consultar<{ id: string; hash_conteudo: string }>(`SELECT id, hash_conteudo FROM rag_documento WHERE ${onde}`, args);
        if (docs.length === 0) return { removidos: 0, chunks: [] };
        const chunks: string[] = [];
        const nosTocados = new Set<string>();
        const t = relogio();
        for (const d of docs) {
          for (const c of tx.consultar<{ id: string }>("SELECT id FROM rag_chunk WHERE documento_id = ?", [d.id])) chunks.push(c.id);
          for (const a of tx.consultar<{ origem_id: string; destino_id: string }>("SELECT origem_id, destino_id FROM rag_aresta WHERE documento_id = ?", [d.id])) (nosTocados.add(a.origem_id), nosTocados.add(a.destino_id));
          tx.executar("UPDATE rag_aprendizado SET documento_id = NULL WHERE documento_id = ?", [d.id]);
          tx.executar("DELETE FROM rag_aresta WHERE documento_id = ?", [d.id]);
          if (comTombstone) tx.executar("INSERT OR IGNORE INTO rag_tombstone (colecao_id, hash, criado_em) VALUES (?,?,?)", [colecao_id, d.hash_conteudo, t]);
          tx.executar("DELETE FROM rag_documento WHERE id = ?", [d.id]);
        }
        for (const n of nosTocados) {
          if (!tx.consultarUm("SELECT 1 AS x FROM rag_aresta WHERE origem_id = ? OR destino_id = ? LIMIT 1", [n, n])) tx.executar("DELETE FROM rag_no WHERE id = ?", [n]);
        }
        return { removidos: docs.length, chunks };
      });
    },
    /** Documentos cujo `expira_em` passou: ficam `resumido` (texto do chunk descartado; aprendizados e grafo permanecem). */
    resumirExpirados(colecao_id: string, agora: string): { documentos: number; chunks: string[] } {
      return banco.transacao((tx) => {
        const docs = tx.consultar<{ id: string }>("SELECT id FROM rag_documento WHERE colecao_id = ? AND estado = 'ativo' AND expira_em IS NOT NULL AND expira_em < ?", [colecao_id, agora]);
        const chunks: string[] = [];
        for (const d of docs) {
          for (const c of tx.consultar<{ id: string }>("SELECT id FROM rag_chunk WHERE documento_id = ?", [d.id])) chunks.push(c.id);
          tx.executar("DELETE FROM rag_chunk WHERE documento_id = ?", [d.id]);
          tx.executar("UPDATE rag_documento SET estado = 'resumido', atualizado_em = ? WHERE id = ?", [relogio(), d.id]);
        }
        return { documentos: docs.length, chunks };
      });
    },
    listar(colecao_id: string, p: { tipo?: string | null; mission_id?: string | null; limite?: number } = {}): MetaDocumento[] {
      let sql = "SELECT * FROM rag_documento WHERE colecao_id = ? AND estado = 'ativo'";
      const args: Array<string | number> = [colecao_id];
      if (p.tipo) (sql += " AND tipo = ?"), args.push(p.tipo);
      if (p.mission_id) (sql += " AND mission_id = ?"), args.push(p.mission_id);
      sql += " ORDER BY ocorrido_em DESC LIMIT ?";
      args.push(Math.min(p.limite ?? 50, 200));
      return banco.consultar<MetaDocumento>(sql, args);
    },
    contagens(colecao_id: string): { documentos: number; chunks: number } {
      const d = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_documento WHERE colecao_id = ? AND estado = 'ativo'", [colecao_id])?.n ?? 0);
      const c = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ?", [colecao_id])?.n ?? 0);
      return { documentos: d, chunks: c };
    },
    chunksPorIds(ids: readonly string[]): ChunkCompleto[] {
      const saida: ChunkCompleto[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const fatia = ids.slice(i, i + 200);
        const rows = banco.consultar<LinhaChunk>(`${SEL_CHUNK} WHERE c.id IN (${fatia.map(() => "?").join(",")})`, fatia);
        saida.push(...rows.map(montarChunk));
      }
      return saida;
    },
    primeirosChunks(docIds: readonly string[]): string[] {
      const ids: string[] = [];
      for (let i = 0; i < docIds.length; i += 200) {
        const f = docIds.slice(i, i + 200);
        ids.push(...banco.consultar<{ id: string }>(`SELECT id FROM rag_chunk WHERE documento_id IN (${f.map(() => "?").join(",")}) AND ordem = 0`, f).map((r) => r.id));
      }
      return ids;
    },
    chunksDoDocumento: (documento_id: string): Array<{ id: string; texto: string; ordem: number }> => banco.consultar("SELECT id, texto, ordem FROM rag_chunk WHERE documento_id = ? ORDER BY ordem", [documento_id]),
  };

  const vetor = {
    gravarEm(b: Banco, v: VetorLinha): void {
      const copia = new Uint8Array(v.vetor.byteLength);
      copia.set(new Uint8Array(v.vetor.buffer, v.vetor.byteOffset, v.vetor.byteLength));
      b.executar("INSERT OR REPLACE INTO rag_vetor (chunk_id, modelo, dimensao, q, escala, vetor) VALUES (?,?,?,0,NULL,?)", [v.chunk_id, v.modelo, v.vetor.length, copia]);
    },
    gravar(vs: readonly VetorLinha[]): void {
      banco.transacao((tx) => vs.forEach((v) => vetor.gravarEm(tx, v)));
    },
    semVetor(colecao_id: string, modelo: string, limite: number): Array<{ id: string; texto: string }> {
      return banco.consultar(
        "SELECT c.id, c.texto FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ? AND d.estado = 'ativo' AND NOT EXISTS (SELECT 1 FROM rag_vetor v WHERE v.chunk_id = c.id AND v.modelo = ?) LIMIT ?",
        [colecao_id, modelo, limite],
      );
    },
    cobertura(colecao_id: string, modelo: string): { com: number; total: number } {
      const total = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ? AND d.estado = 'ativo'", [colecao_id])?.n ?? 0);
      const com = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_vetor v JOIN rag_chunk c ON c.id = v.chunk_id JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ? AND d.estado = 'ativo' AND v.modelo = ?", [colecao_id, modelo])?.n ?? 0);
      return { com, total };
    },
    porIds(modelo: string, ids: readonly string[]): Map<string, Float32Array> {
      const saida = new Map<string, Float32Array>();
      for (let i = 0; i < ids.length; i += 200) {
        const f = ids.slice(i, i + 200);
        for (const r of banco.consultar<{ chunk_id: string; vetor: Uint8Array }>(`SELECT chunk_id, vetor FROM rag_vetor WHERE modelo = ? AND chunk_id IN (${f.map(() => "?").join(",")})`, [modelo, ...f])) {
          const copia = new Uint8Array(r.vetor.byteLength);
          copia.set(r.vetor);
          saida.set(r.chunk_id, new Float32Array(copia.buffer, 0, Math.floor(copia.byteLength / 4)));
        }
      }
      return saida;
    },
    /** Itera os vetores do modelo (warm-up do índice em RAM), em páginas. */
    *iterar(colecao_id: string, modelo: string, pagina = 2000): Generator<{ id: string; vetor: Float32Array }> {
      let ultimo = "";
      for (;;) {
        const rows = banco.consultar<{ chunk_id: string; vetor: Uint8Array }>(
          "SELECT v.chunk_id, v.vetor FROM rag_vetor v JOIN rag_chunk c ON c.id = v.chunk_id JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ? AND d.estado = 'ativo' AND v.modelo = ? AND v.chunk_id > ? ORDER BY v.chunk_id LIMIT ?",
          [colecao_id, modelo, ultimo, pagina],
        );
        if (rows.length === 0) return;
        for (const r of rows) {
          const copia = new Uint8Array(r.vetor.byteLength);
          copia.set(r.vetor);
          yield { id: r.chunk_id, vetor: new Float32Array(copia.buffer, 0, Math.floor(copia.byteLength / 4)) };
        }
        ultimo = (rows[rows.length - 1] as { chunk_id: string }).chunk_id;
      }
    },
  };

  const grafo = {
    upsertNo(p: { colecao_id: string; tipo: string; chave: string; rotulo: string; props?: Record<string, unknown>; peso?: number; quando: string }): string {
      const id = `no_${uuid5(`${p.colecao_id}\n${p.tipo}\n${p.chave}`).replace(/-/g, "").slice(0, 20)}`;
      banco.executar(
        `INSERT INTO rag_no (id,colecao_id,tipo,chave,rotulo,props_json,peso,primeiro_em,ultimo_em) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(colecao_id,tipo,chave) DO UPDATE SET ultimo_em = CASE WHEN excluded.ultimo_em > ultimo_em THEN excluded.ultimo_em ELSE ultimo_em END, rotulo = excluded.rotulo`,
        [id, p.colecao_id, p.tipo, p.chave, p.rotulo.slice(0, 120), JSON.stringify(p.props ?? {}), p.peso ?? 1, p.quando, p.quando],
      );
      return id;
    },
    upsertAresta(p: { origem_id: string; destino_id: string; tipo: string; documento_id?: string | null; peso?: number; quando: string }): void {
      if (p.origem_id === p.destino_id) return;
      banco.executar("INSERT OR IGNORE INTO rag_aresta (origem_id,destino_id,tipo,documento_id,peso,criado_em) VALUES (?,?,?,?,?,?)", [p.origem_id, p.destino_id, p.tipo, p.documento_id ?? "", p.peso ?? 1, p.quando]);
    },
    nosPorChave: (colecao_id: string, tipo: string, chave: string): NoLinha | undefined => banco.consultarUm("SELECT * FROM rag_no WHERE colecao_id = ? AND tipo = ? AND chave = ?", [colecao_id, tipo, chave]),
    no: (id: string): NoLinha | undefined => banco.consultarUm("SELECT * FROM rag_no WHERE id = ?", [id]),
    nos(colecao_id: string, tipos?: readonly string[] | null, limite = 5000): NoLinha[] {
      if (tipos && tipos.length > 0) return banco.consultar(`SELECT * FROM rag_no WHERE colecao_id = ? AND tipo IN (${tipos.map(() => "?").join(",")}) ORDER BY ultimo_em DESC LIMIT ?`, [colecao_id, ...tipos, limite]);
      return banco.consultar("SELECT * FROM rag_no WHERE colecao_id = ? ORDER BY ultimo_em DESC LIMIT ?", [colecao_id, limite]);
    },
    arestasDe(ids: readonly string[], direcao: "saida" | "entrada" | "ambas" = "ambas"): ArestaLinha[] {
      const saida: ArestaLinha[] = [];
      for (let i = 0; i < ids.length; i += 300) {
        const f = ids.slice(i, i + 300);
        const ph = f.map(() => "?").join(",");
        if (direcao !== "entrada") saida.push(...banco.consultar<ArestaLinha>(`SELECT origem_id, destino_id, tipo, documento_id, peso FROM rag_aresta WHERE origem_id IN (${ph})`, f));
        if (direcao !== "saida") saida.push(...banco.consultar<ArestaLinha>(`SELECT origem_id, destino_id, tipo, documento_id, peso FROM rag_aresta WHERE destino_id IN (${ph})`, f));
      }
      return saida;
    },
    arestasEntre(ids: ReadonlySet<string>): ArestaLinha[] {
      return grafo.arestasDe([...ids], "saida").filter((a) => ids.has(a.destino_id));
    },
    /** `colecao_id` dado = só nós DESTA coleção (id de nó de outro workspace é inerte). */
    gravarPosicoes(posicoes: ReadonlyArray<{ id: string; x: number; y: number }>, colecao_id?: string): void {
      banco.transacao((tx) => {
        const st = colecao_id === undefined ? tx.preparar("UPDATE rag_no SET x = ?, y = ? WHERE id = ?") : tx.preparar("UPDATE rag_no SET x = ?, y = ? WHERE id = ? AND colecao_id = ?");
        for (const p of posicoes) if (Number.isFinite(p.x) && Number.isFinite(p.y)) st.executar(colecao_id === undefined ? [p.x, p.y, p.id] : [p.x, p.y, p.id, colecao_id]);
      });
    },
    contagens(colecao_id: string): { nos: number; arestas: number } {
      return {
        nos: Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_no WHERE colecao_id = ?", [colecao_id])?.n ?? 0),
        arestas: Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_aresta a JOIN rag_no n ON n.id = a.origem_id WHERE n.colecao_id = ?", [colecao_id])?.n ?? 0),
      };
    },
  };

  const aprendizado = {
    porHash: (colecao_id: string, hash: string): AprendizadoLinha | undefined => banco.consultarUm("SELECT * FROM rag_aprendizado WHERE colecao_id = ? AND hash = ? AND estado IN ('candidato','ativo')", [colecao_id, hash]),
    obter: (id: string): AprendizadoLinha | undefined => banco.consultarUm("SELECT * FROM rag_aprendizado WHERE id = ?", [id]),
    inserir(a: Omit<AprendizadoLinha, "util" | "inutil" | "errado" | "vezes_visto" | "ultimo_uso_em" | "criado_em" | "atualizado_em"> & { quando: string }): void {
      banco.executar(
        "INSERT INTO rag_aprendizado (id,colecao_id,documento_id,tipo,titulo,texto,fonte,estado,confianca,hash,proveniencia_json,substitui_id,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [a.id, a.colecao_id, a.documento_id, a.tipo, a.titulo.slice(0, 120), a.texto.slice(0, 1000), a.fonte, a.estado, a.confianca, a.hash, a.proveniencia_json, a.substitui_id, a.quando, a.quando],
      );
    },
    atualizar(id: string, campos: Partial<Pick<AprendizadoLinha, "estado" | "texto" | "titulo" | "confianca" | "vezes_visto" | "proveniencia_json" | "documento_id" | "ultimo_uso_em" | "util" | "inutil" | "errado">>): void {
      const chaves = Object.keys(campos) as Array<keyof typeof campos>;
      if (chaves.length === 0) return;
      banco.executar(`UPDATE rag_aprendizado SET ${chaves.map((k) => `${k} = ?`).join(", ")}, atualizado_em = ? WHERE id = ?`, [...chaves.map((k) => campos[k] as string | number | null), relogio(), id]);
    },
    listar(colecao_id: string, p: { estado?: string | null; tipo?: string | null; limite?: number } = {}): AprendizadoLinha[] {
      let sql = "SELECT * FROM rag_aprendizado WHERE colecao_id = ?";
      const args: Array<string | number> = [colecao_id];
      if (p.estado) (sql += " AND estado = ?"), args.push(p.estado);
      if (p.tipo) (sql += " AND tipo = ?"), args.push(p.tipo);
      sql += " ORDER BY criado_em DESC LIMIT ?";
      args.push(Math.min(p.limite ?? 100, 500));
      return banco.consultar(sql, args);
    },
    contagens(colecao_id: string): Record<"candidato" | "ativo" | "arquivado" | "rejeitado", number> {
      const r = { candidato: 0, ativo: 0, arquivado: 0, rejeitado: 0 };
      for (const l of banco.consultar<{ estado: keyof typeof r; n: number }>("SELECT estado, count(*) AS n FROM rag_aprendizado WHERE colecao_id = ? GROUP BY estado", [colecao_id])) r[l.estado] = Number(l.n);
      return r;
    },
  };

  const feedback = {
    /** Append-only; mesmo (alvo, valor, autor, dia) é idempotente. */
    registrar(f: { alvo_tipo: "chunk" | "documento" | "aprendizado"; alvo_id: string; valor: "util" | "inutil" | "errado"; por: "agente" | "humano"; autor_ref: string; pane_id?: string | null; consulta_id?: string | null; nota?: string | null }): boolean {
      const quando = relogio();
      const id = uuid5(`${f.alvo_id}\n${f.valor}\n${f.autor_ref}\n${quando.slice(0, 10)}`);
      const r = banco.executar("INSERT OR IGNORE INTO rag_feedback (id,alvo_tipo,alvo_id,valor,por,pane_id,consulta_id,nota,criado_em) VALUES (?,?,?,?,?,?,?,?,?)", [id, f.alvo_tipo, f.alvo_id, f.valor, f.por, f.pane_id ?? null, f.consulta_id ?? null, (f.nota ?? "").slice(0, 200) || null, quando]);
      return r.alteracoes > 0;
    },
    contar(alvo_id: string): { util: number; inutil: number; errado: number } {
      const r = { util: 0, inutil: 0, errado: 0 };
      for (const l of banco.consultar<{ valor: keyof typeof r; n: number }>("SELECT valor, count(*) AS n FROM rag_feedback WHERE alvo_id = ? GROUP BY valor", [alvo_id])) r[l.valor] = Number(l.n);
      return r;
    },
    /** Quem disse "errado": distingue Panes e humanos (anti-envenenamento). */
    erradoPor: (alvo_id: string): { humanos: number; panes: number } => {
      const h = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_feedback WHERE alvo_id = ? AND valor = 'errado' AND por = 'humano'", [alvo_id])?.n ?? 0);
      const p = Number(banco.consultarUm<{ n: number }>("SELECT count(DISTINCT pane_id) AS n FROM rag_feedback WHERE alvo_id = ? AND valor = 'errado' AND por = 'agente' AND pane_id IS NOT NULL", [alvo_id])?.n ?? 0);
      return { humanos: h, panes: p };
    },
  };

  const consulta = {
    registrar(c: ConsultaRegistro): void {
      banco.executar(
        "INSERT INTO rag_consulta (id,colecao_id,workspace_id,mission_id,task_ref,pane_id,origem,modo,consulta_redigida,estado,n_resultados,latencia_ms,sinais_json,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [c.id, c.colecao_id, c.workspace_id, c.mission_id, c.task_ref, c.pane_id, c.origem, c.modo, c.consulta_redigida.slice(0, 200), c.estado, c.n_resultados, c.latencia_ms, c.sinais_json, c.criado_em],
      );
    },
    consultouDesde: (mission_id: string, task_ref: string, desde: string, colecao_id?: string): boolean =>
      (colecao_id === undefined
        ? banco.consultarUm("SELECT 1 AS x FROM rag_consulta WHERE mission_id = ? AND task_ref = ? AND criado_em >= ? LIMIT 1", [mission_id, task_ref, desde])
        : banco.consultarUm("SELECT 1 AS x FROM rag_consulta WHERE colecao_id = ? AND mission_id = ? AND task_ref = ? AND criado_em >= ? LIMIT 1", [colecao_id, mission_id, task_ref, desde])) !== undefined,
    contarDesde: (desde: string): number => Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_consulta WHERE criado_em >= ?", [desde])?.n ?? 0),
  };

  const fonte = {
    obter: (colecao_id: string, tipo: string, ref: string): FonteLinha | undefined => banco.consultarUm("SELECT colecao_id,tipo,ref,mtime_ms,tamanho,hash,ultimo_offset,ultimo_sha FROM rag_fonte WHERE colecao_id = ? AND tipo = ? AND ref = ?", [colecao_id, tipo, ref]),
    gravar(f: Partial<FonteLinha> & Pick<FonteLinha, "colecao_id" | "tipo" | "ref">): void {
      banco.executar(
        `INSERT INTO rag_fonte (id,colecao_id,tipo,ref,mtime_ms,tamanho,hash,ultimo_offset,ultimo_sha,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(colecao_id,tipo,ref) DO UPDATE SET mtime_ms=excluded.mtime_ms, tamanho=excluded.tamanho, hash=excluded.hash, ultimo_offset=excluded.ultimo_offset, ultimo_sha=excluded.ultimo_sha, atualizado_em=excluded.atualizado_em`,
        [uuid5(`${f.colecao_id}\n${f.tipo}\n${f.ref}`), f.colecao_id, f.tipo, f.ref, f.mtime_ms ?? null, f.tamanho ?? null, f.hash ?? null, f.ultimo_offset ?? 0, f.ultimo_sha ?? null, relogio()],
      );
    },
  };

  const fila = {
    enfileirar(eventoJson: string, prioridade = 5, teto = 5000, colecao_id: string | null = null): void {
      banco.transacao((tx) => {
        tx.executar("INSERT INTO rag_fila (prioridade, evento_json, criado_em, colecao_id) VALUES (?,?,?,?)", [prioridade, eventoJson, relogio(), colecao_id]);
        const n = Number(tx.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_fila")?.n ?? 0);
        // fila limitada: descarta o mais antigo de menor prioridade
        if (n > teto) tx.executar("DELETE FROM rag_fila WHERE id IN (SELECT id FROM rag_fila ORDER BY prioridade DESC, id ASC LIMIT ?)", [n - teto]);
      });
    },
    /** `colecao_id` dado = só os itens DESTA coleção (cada workspace drena a própria fila; sem isso um workspace gravaria o evento do outro). */
    proximos: (n: number, colecao_id?: string): Array<{ id: number; evento_json: string; tentativas: number }> =>
      colecao_id === undefined
        ? banco.consultar("SELECT id, evento_json, tentativas FROM rag_fila ORDER BY prioridade ASC, id ASC LIMIT ?", [n])
        : banco.consultar("SELECT id, evento_json, tentativas FROM rag_fila WHERE colecao_id = ? ORDER BY prioridade ASC, id ASC LIMIT ?", [colecao_id, n]),
    concluir: (ids: readonly number[]): void => void banco.transacao((tx) => ids.forEach((i) => tx.executar("DELETE FROM rag_fila WHERE id = ?", [i]))),
    falhou(id: number, maxTentativas = 3): void {
      banco.executar("UPDATE rag_fila SET tentativas = tentativas + 1 WHERE id = ?", [id]);
      banco.executar("DELETE FROM rag_fila WHERE id = ? AND tentativas >= ?", [id, maxTentativas]);
    },
    pendentes: (colecao_id?: string): number =>
      Number((colecao_id === undefined ? banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_fila") : banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_fila WHERE colecao_id = ?", [colecao_id]))?.n ?? 0),
  };

  const tombstone = {
    tem: (colecao_id: string, hash: string): boolean => banco.consultarUm("SELECT 1 AS x FROM rag_tombstone WHERE colecao_id = ? AND hash = ?", [colecao_id, hash]) !== undefined,
    adicionar: (colecao_id: string, hash: string): void => void banco.executar("INSERT OR IGNORE INTO rag_tombstone (colecao_id, hash, criado_em) VALUES (?,?,?)", [colecao_id, hash, relogio()]),
  };

  const saida = {
    enfileirar: (colecao_id: string, registro_id: string, operacao: "upsert" | "apagar"): void =>
      void banco.executar("INSERT OR IGNORE INTO rag_saida (colecao_id, registro_id, operacao, criado_em) VALUES (?,?,?,?)", [colecao_id, registro_id, operacao, relogio()]),
    proximos: (colecao_id: string, n: number): Array<{ id: number; registro_id: string; operacao: "upsert" | "apagar" }> => banco.consultar("SELECT id, registro_id, operacao FROM rag_saida WHERE colecao_id = ? ORDER BY id LIMIT ?", [colecao_id, n]),
    remover: (ids: readonly number[]): void => void banco.transacao((tx) => ids.forEach((i) => tx.executar("DELETE FROM rag_saida WHERE id = ?", [i]))),
    pendentes: (colecao_id: string): number => Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_saida WHERE colecao_id = ?", [colecao_id])?.n ?? 0),
  };

  const migracao = {
    criar(m: Omit<MigracaoLinha, "enviados" | "cursor" | "consentimento_em" | "erro">): void {
      const t = relogio();
      banco.executar("INSERT INTO rag_migracao (id,colecao_id,provedor,host,colecao_remota,estado,tipos_json,total,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)", [m.id, m.colecao_id, m.provedor, m.host, m.colecao_remota, m.estado, m.tipos_json, m.total, t, t]);
    },
    obter: (id: string): MigracaoLinha | undefined => banco.consultarUm("SELECT id,colecao_id,provedor,host,colecao_remota,estado,tipos_json,total,enviados,cursor,consentimento_em,erro FROM rag_migracao WHERE id = ?", [id]),
    atualizar(id: string, c: Partial<Pick<MigracaoLinha, "estado" | "enviados" | "cursor" | "consentimento_em" | "erro" | "total">>): void {
      const chaves = Object.keys(c) as Array<keyof typeof c>;
      if (chaves.length === 0) return;
      banco.executar(`UPDATE rag_migracao SET ${chaves.map((k) => `${k} = ?`).join(", ")}, atualizado_em = ? WHERE id = ?`, [...chaves.map((k) => c[k] as string | number | null), relogio(), id]);
    },
  };

  return { banco, relogio, colecao, documento, vetor, grafo, aprendizado, feedback, consulta, fonte, fila, tombstone, saida, migracao };
}

export type Repos = ReturnType<typeof criarRepos>;
