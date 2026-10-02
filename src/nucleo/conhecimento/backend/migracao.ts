// Consentimento → prévia (dry-run) → migração em lotes com ponto de retomada atômico → verificação → "voltar para local".
// Nada é enviado sem consentimento VÁLIDO para o destino atual; o índice local NUNCA é apagado; o remoto só é apagado com confirmação
// separada. O cursor só avança DEPOIS de o lote ser confirmado (upsert idempotente por id → reexecutar é seguro: 0 duplicata, 0 perda).
import type { ConsentimentoBackend, TipoDocumento } from "../../../compartilhado/conhecimento";
import { ColecaoDivergenteErro, type ArmazenamentoConhecimento, type MetricaDistancia } from "../armazenamento/interface";
import { idLocal } from "../ids";
import type { Repos } from "../repos";
import { TIPOS_COM_AVISO } from "./config";
import { verificarCoerencia } from "./coerencia";
import { amostra, contarEnviavel, proximoLote, type PedidoExportar } from "./exportar";
import { consentimentoVale } from "./config";

export class SemConsentimentoErro extends Error {
  override name = "SemConsentimentoErro";
  constructor() {
    super("Nenhum dado é enviado sem consentimento válido para este destino.");
  }
}

export interface Previa {
  migracao_id: string;
  por_tipo: Record<string, { itens: number; bytes: number }>;
  total: number;
  amostra: Array<{ tipo: string; origem: string; trecho: string }>;
  avisos: string[];
  estimativa_reembutir: number | null;
}

export interface Destino {
  provedor: string;
  host: string;
  colecao: string;
}

export function criarPrevia(p: { repos: Repos; pedido: PedidoExportar; destino: Destino; maxAmostra?: number }): Previa {
  const c = contarEnviavel(p.repos, p.pedido);
  const avisos: string[] = [];
  for (const t of p.pedido.tipos) if ((TIPOS_COM_AVISO as readonly TipoDocumento[]).includes(t)) avisos.push(`O tipo "${t}" pode conter trechos sensíveis e ficará visível a quem tiver acesso à coleção.`);
  if (c.sem_vetor > 0) avisos.push(`${c.sem_vetor} trecho(s) ainda sem vetor do modelo ativo não serão enviados agora.`);
  avisos.push("O conteúdo sairá da máquina e ficará visível a quem tiver acesso à coleção remota.");
  const id = idLocal("mig");
  p.repos.migracao.criar({ id, colecao_id: p.pedido.colecao_id, provedor: p.destino.provedor, host: p.destino.host, colecao_remota: p.destino.colecao, estado: "previa", tipos_json: JSON.stringify(p.pedido.tipos), total: c.total });
  return { migracao_id: id, por_tipo: c.por_tipo, total: c.total, amostra: amostra(p.repos, p.pedido, p.maxAmostra ?? 20), avisos, estimativa_reembutir: c.sem_vetor };
}

export function consentir(repos: Repos, migracao_id: string, consentimento: ConsentimentoBackend): void {
  const m = repos.migracao.obter(migracao_id);
  if (!m) throw new Error("migração inexistente");
  if (!consentimentoVale(consentimento, { provedor: m.provedor, host: m.host, colecao: m.colecao_remota })) throw new SemConsentimentoErro();
  repos.migracao.atualizar(migracao_id, { estado: "consentida", consentimento_em: repos.relogio() });
}

export interface OpcoesMigrar {
  repos: Repos;
  armazenamento: ArmazenamentoConhecimento;
  migracao_id: string;
  projeto_id: string;
  equipe_id?: string | undefined;
  metrica?: MetricaDistancia;
  sinal?: AbortSignal;
  aoProgresso?: (p: { estado: string; enviados: number; total: number }) => void;
  /** espera entre tentativas (injetável; testes passam um no-op). */
  dormir?: (ms: number) => Promise<void>;
  tentativas?: number;
  /** teto de itens por lote (≤ 200). */
  lote?: number;
}

export interface ResultadoMigracao {
  estado: "concluida" | "pausada" | "falhou" | "cancelada" | "verificando";
  enviados: number;
  total: number;
  erro?: string;
}

const padraoDormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Envia (ou RETOMA) a migração. Idempotente e retomável. */
export async function migrar(o: OpcoesMigrar): Promise<ResultadoMigracao> {
  const m = o.repos.migracao.obter(o.migracao_id);
  if (!m) throw new Error("migração inexistente");
  if (!["consentida", "enviando", "pausada", "falhou"].includes(m.estado) || m.consentimento_em === null) throw new SemConsentimentoErro();
  const col = o.repos.colecao.obter(m.colecao_id);
  if (!col) throw new Error("coleção local inexistente");
  const tipos = JSON.parse(m.tipos_json) as TipoDocumento[];
  const pedido: PedidoExportar = { colecao_id: m.colecao_id, projeto_id: o.projeto_id, equipe_id: o.equipe_id, tipos };
  const dormir = o.dormir ?? padraoDormir;
  const caps = o.armazenamento.capacidades();
  const tam = Math.max(1, Math.min(o.lote ?? 200, caps.loteMaximo, 200));
  const metrica = o.metrica ?? (col.metrica as MetricaDistancia);

  // coerência ANTES de qualquer envio
  const coer = verificarCoerencia({ modeloEmbedding: col.modelo_ativo, dimensao: col.dimensao, metrica }, null, caps.dimensaoMaxima);
  if (!coer.ok) {
    o.repos.migracao.atualizar(m.id, { estado: "falhou", erro: coer.diferencas.join("; ").slice(0, 300) });
    return { estado: "falhou", enviados: m.enviados, total: m.total, erro: coer.diferencas.join("; ") };
  }
  try {
    await o.armazenamento.garantirColecao({ dimensao: col.dimensao, metrica, modeloEmbedding: col.modelo_ativo });
  } catch (e) {
    const erro = e instanceof ColecaoDivergenteErro ? e.message : "falha ao preparar a coleção remota";
    o.repos.migracao.atualizar(m.id, { estado: "falhou", erro: erro.slice(0, 300) });
    return { estado: "falhou", enviados: m.enviados, total: m.total, erro };
  }
  o.repos.migracao.atualizar(m.id, { estado: "enviando", erro: null as never });
  let cursor = m.cursor;
  let enviados = m.enviados;
  for (;;) {
    if (o.sinal?.aborted) {
      o.repos.migracao.atualizar(m.id, { estado: "pausada" });
      return { estado: "pausada", enviados, total: m.total };
    }
    const lote = proximoLote(o.repos, pedido, cursor, tam);
    if (lote.lidos === 0) break;
    if (lote.registros.length > 0) {
      let ok = false;
      let erroFinal = "";
      for (let t = 0; t < (o.tentativas ?? 3) && !ok; t++) {
        try {
          await o.armazenamento.upsert(lote.registros);
          ok = true;
        } catch (e) {
          erroFinal = e instanceof Error ? e.message : "erro";
          if (o.sinal?.aborted) break;
          await dormir(2 ** t * 500);
        }
      }
      if (!ok) {
        o.repos.migracao.atualizar(m.id, { estado: "falhou", erro: erroFinal.slice(0, 300) });
        return { estado: "falhou", enviados, total: m.total, erro: erroFinal };
      }
    }
    // ponto de retomada ATÔMICO: só depois do lote confirmado
    cursor = lote.cursor;
    enviados += lote.registros.length;
    o.repos.migracao.atualizar(m.id, { cursor: cursor as string, enviados });
    o.aoProgresso?.({ estado: "enviando", enviados, total: m.total });
  }
  o.repos.migracao.atualizar(m.id, { estado: "verificando" });
  return { estado: "verificando", enviados, total: m.total };
}

export interface ResultadoVerificacao {
  ok: boolean;
  local: number;
  remoto: number;
  amostrados: number;
  divergentes: number;
}

/** Contagem local × remota (reconsulta se a consistência é eventual) + checksum de até 50 ids por `obterPorIds`. */
export async function verificar(o: { repos: Repos; armazenamento: ArmazenamentoConhecimento; migracao_id: string; projeto_id: string; equipe_id?: string | undefined; dormir?: (ms: number) => Promise<void>; esperas?: number }): Promise<ResultadoVerificacao> {
  const m = o.repos.migracao.obter(o.migracao_id);
  if (!m) throw new Error("migração inexistente");
  const tipos = JSON.parse(m.tipos_json) as TipoDocumento[];
  const pedido: PedidoExportar = { colecao_id: m.colecao_id, projeto_id: o.projeto_id, equipe_id: o.equipe_id, tipos };
  // universo local ENVIÁVEL (mesma regra do envio)
  const todos: ReturnType<typeof proximoLote>["registros"] = [];
  let cur: string | null = null;
  for (;;) {
    const l = proximoLote(o.repos, pedido, cur, 500);
    if (l.lidos === 0) break;
    todos.push(...l.registros);
    cur = l.cursor;
  }
  const local = todos.length;
  const dormir = o.dormir ?? padraoDormir;
  const filtro = { campo: "projeto_id", igual: o.projeto_id } as const;
  let remoto = await o.armazenamento.contar(filtro);
  const eventual = o.armazenamento.capacidades().consistenciaEventual;
  for (let i = 0; eventual && remoto < local && i < (o.esperas ?? 5); i++) {
    await dormir(1000 * (i + 1));
    remoto = await o.armazenamento.contar(filtro);
  }
  const passo = Math.max(1, Math.floor(local / 50));
  const amostra = todos.filter((_, i) => i % passo === 0).slice(0, 50);
  const achados = await o.armazenamento.obterPorIds(amostra.map((r) => r.id));
  const porId = new Map(achados.map((r) => [r.id, r]));
  const divergentes = amostra.filter((r) => porId.get(r.id)?.meta.hash_conteudo !== r.meta.hash_conteudo).length;
  const ok = remoto >= local && divergentes === 0;
  o.repos.migracao.atualizar(m.id, ok ? { estado: "concluida" } : { estado: "falhou", erro: `verificação: local ${local}, remoto ${remoto}, divergentes ${divergentes}` });
  return { ok, local, remoto, amostrados: amostra.length, divergentes };
}

export function pausar(repos: Repos, migracao_id: string): void {
  repos.migracao.atualizar(migracao_id, { estado: "pausada" });
}
export function cancelar(repos: Repos, migracao_id: string): void {
  repos.migracao.atualizar(migracao_id, { estado: "cancelada" });
}
