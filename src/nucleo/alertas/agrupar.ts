// Agrupamento (T-20.11, PURO): `imediato`, `lote` (janela curta por Missão) e `digest` (hora local). Resumo de lote e liberação de grupos.
import type { AgrupamentoDef, AlertaVisao, EntregaRegistro } from "../../compartilhado/alertas";
import { CATALOGO } from "./catalogo";
import { minutosDe, partesDoSistema, type ResolverLocal } from "./silencio";

export const JANELA_LOTE_PADRAO_S = 5;

/** próximo instante (ms) em que o relógio local marca `hora_digest` (HH:MM), estritamente depois de `agora`. */
export function proximaHoraDigest(hora: string, agora: number, resolver: ResolverLocal = partesDoSistema): number | null {
  const alvo = minutosDe(hora);
  if (alvo === null) return null;
  const base = Math.floor(agora / 60_000) * 60_000;
  // procura minuto a minuto em passos de 15 e refina; 25 h cobre qualquer virada de horário de verão
  for (let t = base + 60_000; t <= base + 25 * 3_600_000; t += 15 * 60_000) {
    const p = resolver(t);
    const delta = (alvo - p.minutos + 1440) % 1440;
    if (delta < 15) {
      for (let a = t - 14 * 60_000; a <= t + 15 * 60_000; a += 60_000) if (a > agora && resolver(a).minutos === alvo) return a;
    }
  }
  return null;
}

export interface DecisaoAgrupamento {
  estado: "pendente" | "agrupado";
  liberar_em: number | null;
  motivo: "imediato" | "lote" | "digest";
}
export function decidirAgrupamento(def: AgrupamentoDef, alerta: Pick<AlertaVisao, "severidade">, agora: number, resolver: ResolverLocal = partesDoSistema): DecisaoAgrupamento {
  if (alerta.severidade === "critico" || def.modo === "imediato") return { estado: "pendente", liberar_em: null, motivo: "imediato" };
  if (def.modo === "lote") return { estado: "agrupado", liberar_em: agora + (def.janela_s ?? JANELA_LOTE_PADRAO_S) * 1000, motivo: "lote" };
  const prox = proximaHoraDigest(def.hora_digest ?? "18:00", agora, resolver);
  return prox === null ? { estado: "pendente", liberar_em: null, motivo: "imediato" } : { estado: "agrupado", liberar_em: prox, motivo: "digest" };
}

export interface Lote {
  canal_id: string;
  regra_id: string | null;
  chat_ref: string | null;
  entrega_ids: string[];
  alerta_ids: string[];
  titulo: string;
}

/** "3 × Tarefa concluída, 1 × Tarefa bloqueada" (ordem estável por contagem decrescente). */
export function tituloDoLote(alertas: Array<Pick<AlertaVisao, "tipo" | "contagem">>): string {
  const por = new Map<string, number>();
  for (const a of alertas) por.set(a.tipo, (por.get(a.tipo) ?? 0) + Math.max(1, a.contagem));
  const partes = [...por.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([t, n]) => `${n} × ${CATALOGO[t as keyof typeof CATALOGO].rotulo}`);
  return partes.join(", ");
}

/**
 * Entre as entregas `agrupado`, junta as que já podem sair (`liberar_em <= agora`) em UM lote por (canal, regra, chat).
 * `liberar` informa o instante de liberação de cada entrega (guardado pelo chamador em `proxima_tentativa_em`).
 */
export function liberarLotes(entregas: EntregaRegistro[], alertas: ReadonlyMap<string, AlertaVisao>, agora: number): Lote[] {
  const grupos = new Map<string, EntregaRegistro[]>();
  for (const e of entregas) {
    if (e.estado !== "agrupado" || e.proxima_tentativa_em === null || Date.parse(e.proxima_tentativa_em) > agora) continue;
    const k = `${e.canal_id}|${e.regra_id ?? ""}|${e.chat_ref ?? ""}`;
    grupos.set(k, [...(grupos.get(k) ?? []), e]);
  }
  const saida: Lote[] = [];
  for (const [, es] of grupos) {
    const as = es.map((e) => alertas.get(e.alerta_id)).filter((a): a is AlertaVisao => a !== undefined);
    const e0 = es[0] as EntregaRegistro;
    saida.push({ canal_id: e0.canal_id, regra_id: e0.regra_id, chat_ref: e0.chat_ref, entrega_ids: es.map((e) => e.id), alerta_ids: as.map((a) => a.id), titulo: tituloDoLote(as) });
  }
  return saida;
}
