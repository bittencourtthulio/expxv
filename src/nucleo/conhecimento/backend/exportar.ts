// Local → registros remotos: ids determinísticos (G §7) recalculados do CONTEÚDO (iguais em qualquer máquina), só texto JÁ redigido,
// só o vetor do modelo ativo (sem vetor → pulado e contado), só os tipos escolhidos. Nunca caminho absoluto nem usuário do SO.
import type { TipoDocumento } from "../../../compartilhado/conhecimento";
import type { MetaRegistro, RegistroConhecimento } from "../armazenamento/interface";
import { idChunk, uuid5 } from "../ids";
import type { Repos } from "../repos";
import { caminhoProibido } from "../seguranca";

export interface PedidoExportar {
  colecao_id: string;
  projeto_id: string;
  equipe_id?: string | undefined;
  tipos: readonly TipoDocumento[];
}

interface LinhaExport {
  id: string;
  texto: string;
  ordem: number;
  hash: string;
  titulo: string;
  tipo: string;
  origem: string;
  criado_em: string;
  modelo: string;
  dimensao: number;
  vetor: Uint8Array;
}

/** Escopo de identidade: projeto (+ equipe). */
export const escopoRemoto = (projeto_id: string, equipe_id?: string): string => (equipe_id ? `${projeto_id}:${equipe_id}` : projeto_id);

export function contarEnviavel(repos: Repos, p: PedidoExportar): { por_tipo: Record<string, { itens: number; bytes: number }>; sem_vetor: number; total: number } {
  const por: Record<string, { itens: number; bytes: number }> = {};
  let total = 0;
  if (p.tipos.length === 0) return { por_tipo: por, sem_vetor: 0, total };
  const ph = p.tipos.map(() => "?").join(",");
  for (const l of repos.banco.consultar<{ tipo: string; n: number; b: number }>(
    `SELECT d.tipo AS tipo, count(*) AS n, COALESCE(sum(length(c.texto)),0) AS b FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ? AND d.estado='ativo' AND d.tipo IN (${ph}) GROUP BY d.tipo`,
    [p.colecao_id, ...p.tipos],
  )) {
    por[l.tipo] = { itens: Number(l.n), bytes: Number(l.b) };
    total += Number(l.n);
  }
  const col = repos.colecao.obter(p.colecao_id);
  const sem = col
    ? Number(repos.banco.consultarUm<{ n: number }>(`SELECT count(*) AS n FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ? AND d.estado='ativo' AND d.tipo IN (${ph}) AND NOT EXISTS (SELECT 1 FROM rag_vetor v WHERE v.chunk_id = c.id AND v.modelo = ?)`, [p.colecao_id, ...p.tipos, col.modelo_ativo])?.n ?? 0)
    : 0;
  return { por_tipo: por, sem_vetor: sem, total };
}

/** Próximo lote (ordem estável por id local, depois de `cursor`). Devolve também o novo cursor. */
export function proximoLote(repos: Repos, p: PedidoExportar, cursor: string | null, tamanho: number): { registros: RegistroConhecimento[]; cursor: string | null; lidos: number } {
  const col = repos.colecao.obter(p.colecao_id);
  if (!col || p.tipos.length === 0) return { registros: [], cursor, lidos: 0 };
  const ph = p.tipos.map(() => "?").join(",");
  const linhas = repos.banco.consultar<LinhaExport>(
    `SELECT c.id, c.texto, c.ordem, c.hash, d.titulo, d.tipo, d.origem, d.ocorrido_em AS criado_em, v.modelo, v.dimensao, v.vetor
     FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id JOIN rag_vetor v ON v.chunk_id = c.id AND v.modelo = ?
     WHERE d.colecao_id = ? AND d.estado = 'ativo' AND d.tipo IN (${ph}) AND c.id > ? ORDER BY c.id LIMIT ?`,
    [col.modelo_ativo, p.colecao_id, ...p.tipos, cursor ?? "", tamanho],
  );
  return { registros: linhas.map((l) => paraRegistro(l, p)).filter((r): r is RegistroConhecimento => r !== null), cursor: linhas.length > 0 ? (linhas[linhas.length - 1] as LinhaExport).id : cursor, lidos: linhas.length };
}

function paraRegistro(l: LinhaExport, p: PedidoExportar): RegistroConhecimento | null {
  if (caminhoProibido(l.origem) || l.origem.startsWith("/") || /^[A-Za-z]:[\\/]/.test(l.origem)) return null; // nunca absoluto, nunca proibido
  const copia = new Uint8Array(l.vetor.byteLength);
  copia.set(l.vetor);
  const meta: MetaRegistro = {
    projeto_id: p.projeto_id,
    ...(p.equipe_id !== undefined ? { equipe_id: p.equipe_id } : {}),
    tipo: l.tipo,
    origem: l.origem,
    hash_conteudo: l.hash,
    modelo_embedding: l.modelo,
    dimensao: Number(l.dimensao),
    criado_em: l.criado_em,
    criado_em_ms: Date.parse(l.criado_em) || 0,
    indice: Number(l.ordem),
    titulo: l.titulo,
  };
  const escopo = escopoRemoto(p.projeto_id, p.equipe_id);
  return { id: idChunk({ escopo, tipo: l.tipo, origem: l.origem, indice: Number(l.ordem), texto: l.texto }), vetor: Array.from(new Float32Array(copia.buffer, 0, Math.floor(copia.byteLength / 4))), texto: l.texto, meta };
}

/** Registros de chunks locais específicos (fila de saída do espelho). Chunks sumidos, sem vetor ou de tipo não escolhido ficam de fora. */
export function registrosDeChunks(repos: Repos, p: PedidoExportar, chunkIds: readonly string[]): Map<string, RegistroConhecimento> {
  const col = repos.colecao.obter(p.colecao_id);
  const saida = new Map<string, RegistroConhecimento>();
  if (!col || p.tipos.length === 0 || chunkIds.length === 0) return saida;
  const ph = p.tipos.map(() => "?").join(",");
  for (let i = 0; i < chunkIds.length; i += 200) {
    const f = chunkIds.slice(i, i + 200);
    const linhas = repos.banco.consultar<LinhaExport>(
      `SELECT c.id, c.texto, c.ordem, c.hash, d.titulo, d.tipo, d.origem, d.ocorrido_em AS criado_em, v.modelo, v.dimensao, v.vetor
       FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id JOIN rag_vetor v ON v.chunk_id = c.id AND v.modelo = ?
       WHERE d.colecao_id = ? AND d.estado = 'ativo' AND d.tipo IN (${ph}) AND c.id IN (${f.map(() => "?").join(",")})`,
      [col.modelo_ativo, p.colecao_id, ...p.tipos, ...f],
    );
    for (const l of linhas) {
      const r = paraRegistro(l, p);
      if (r) saida.set(l.id, r);
    }
  }
  return saida;
}

export function amostra(repos: Repos, p: PedidoExportar, n: number): Array<{ tipo: string; origem: string; trecho: string }> {
  const col = repos.colecao.obter(p.colecao_id);
  if (!col || p.tipos.length === 0) return [];
  const ph = p.tipos.map(() => "?").join(",");
  return repos.banco
    .consultar<{ tipo: string; origem: string; texto: string }>(`SELECT d.tipo, d.origem, c.texto FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ? AND d.estado='ativo' AND d.tipo IN (${ph}) ORDER BY c.id LIMIT ?`, [p.colecao_id, ...p.tipos, Math.min(n, 20)])
    .map((l) => ({ tipo: l.tipo, origem: l.origem, trecho: l.texto.replace(/\s+/g, " ").slice(0, 200) }));
}

export const idVerificacao = (id: string): string => uuid5(id);
