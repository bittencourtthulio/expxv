// Replicação (DEC-8, D-90): o online é a FONTE COMPARTILHADA e o local é o cache quente. A consulta contextual (150 ms) NUNCA vai à rede.
// Modos: `local` (padrão: nada sai) · `espelho` (escrita local + push em segundo plano; leitura local) · `compartilhado` (push + pull
// incremental). Escritas vão para a fila persistente `rag_saida` (idempotente). Offline: continua no local. Sem consentimento válido
// não há push nem pull. Exclusões NÃO se propagam sozinhas (apagar remoto exige confirmação separada).
import type { ConsentimentoBackend, ModoBackend } from "../../../compartilhado/conhecimento";
import { ArmazenamentoLocal } from "../armazenamento/local";
import type { ArmazenamentoConhecimento, Filtro, MetricaDistancia, RegistroConhecimento } from "../armazenamento/interface";
import type { Repos } from "../repos";
import { consentimentoVale } from "./config";
import { registrosDeChunks, type PedidoExportar } from "./exportar";

export interface EstadoReplicacao {
  modo: ModoBackend;
  consentimento: ConsentimentoBackend | null;
  destino: { provedor: string; host: string; colecao: string };
}

/** Só `espelho`/`compartilhado` COM consentimento válido enviam algo. */
export function podeEnviar(e: EstadoReplicacao): boolean {
  return e.modo !== "local" && consentimentoVale(e.consentimento, e.destino);
}

/** Enfileira para envio (a ingestão chama isto por chunk novo). No-op em modo `local`. */
export function enfileirarEnvio(repos: Repos, e: EstadoReplicacao, colecao_id: string, chunkIds: readonly string[]): number {
  if (!podeEnviar(e)) return 0;
  for (const id of chunkIds) repos.saida.enfileirar(colecao_id, id, "upsert");
  return chunkIds.length;
}

export interface ResultadoPush {
  enviados: number;
  restantes: number;
  offline: boolean;
}

export async function empurrar(o: { repos: Repos; armazenamento: ArmazenamentoConhecimento; estado: EstadoReplicacao; pedido: PedidoExportar; lote?: number; sinal?: AbortSignal; metrica?: MetricaDistancia }): Promise<ResultadoPush> {
  const restantes = (): number => o.repos.saida.pendentes(o.pedido.colecao_id);
  if (!podeEnviar(o.estado)) return { enviados: 0, restantes: restantes(), offline: false };
  const col = o.repos.colecao.obter(o.pedido.colecao_id);
  if (!col) return { enviados: 0, restantes: restantes(), offline: false };
  const tam = Math.max(1, Math.min(o.lote ?? 100, o.armazenamento.capacidades().loteMaximo, 200));
  let enviados = 0;
  try {
    await o.armazenamento.garantirColecao({ dimensao: col.dimensao, metrica: o.metrica ?? (col.metrica as MetricaDistancia), modeloEmbedding: col.modelo_ativo });
    while (!o.sinal?.aborted) {
      const itens = o.repos.saida.proximos(o.pedido.colecao_id, tam);
      if (itens.length === 0) break;
      const regs = registrosDeChunks(o.repos, o.pedido, itens.map((i) => i.registro_id));
      const lote = itens.map((i) => regs.get(i.registro_id)).filter((r): r is RegistroConhecimento => r !== undefined);
      if (lote.length > 0) await o.armazenamento.upsert(lote); // idempotente por id
      o.repos.saida.remover(itens.map((i) => i.id)); // só depois de confirmado; sumidos/filtrados saem da fila
      enviados += lote.length;
    }
  } catch {
    return { enviados, restantes: restantes(), offline: true }; // offline/erro: a fila persiste e o local segue
  }
  return { enviados, restantes: restantes(), offline: false };
}

export interface ResultadoPull {
  recebidos: number;
  ignorados: number;
  modelo_divergente: boolean;
  ultimo_ms: number;
}

/** Pull incremental (modo `compartilhado`): só registros mais novos que `desde_ms`; modelo diferente do local é recusado. */
export async function puxar(o: { repos: Repos; armazenamento: ArmazenamentoConhecimento; estado: EstadoReplicacao; colecao_id: string; projeto_id: string; equipe_id?: string | undefined; desde_ms: number; sinal?: AbortSignal }): Promise<ResultadoPull> {
  const r: ResultadoPull = { recebidos: 0, ignorados: 0, modelo_divergente: false, ultimo_ms: o.desde_ms };
  if (o.estado.modo !== "compartilhado" || !podeEnviar(o.estado)) return r;
  const col = o.repos.colecao.obter(o.colecao_id);
  if (!col) return r;
  const local = new ArmazenamentoLocal(o.repos, o.colecao_id, o.projeto_id, o.equipe_id);
  const filtro: Filtro = { e: [{ campo: "projeto_id", igual: o.projeto_id }, { campo: "criado_em_ms", entre: [o.desde_ms + 1, Number.MAX_SAFE_INTEGER] }] };
  let cursor: string | null = null;
  do {
    if (o.sinal?.aborted) break;
    const pag = await o.armazenamento.exportarPagina(cursor, 100, filtro);
    const novos = [];
    for (const reg of pag.itens) {
      if (reg.meta.modelo_embedding !== col.modelo_ativo || reg.meta.dimensao !== col.dimensao) {
        r.modelo_divergente = true;
        r.ignorados++;
        continue;
      }
      const ja = o.repos.banco.consultarUm("SELECT 1 AS x FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE d.colecao_id = ? AND d.tipo = ? AND d.origem = ? AND c.hash = ?", [o.colecao_id, reg.meta.tipo, reg.meta.origem, reg.meta.hash_conteudo]);
      if (ja) {
        r.ignorados++;
        continue;
      }
      novos.push(reg);
      r.ultimo_ms = Math.max(r.ultimo_ms, reg.meta.criado_em_ms);
    }
    if (novos.length > 0) {
      await local.upsert(novos.slice(0, 100));
      r.recebidos += Math.min(novos.length, 100);
    }
    cursor = pag.proximoCursor;
  } while (cursor !== null);
  return r;
}
