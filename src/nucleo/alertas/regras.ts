// Avaliação de regras (T-20.11, PURA e determinística): alerta x regras x canais x relógio -> entregas planejadas.
// Nenhuma regra => nenhum envio externo. Canal externo sem consentimento => nunca. Idempotência por (alerta, canal, regra).
import type { AlertaVisao, CanalRegistro, FiltrosRegra, NivelTemplate, Regra, TipoCanal } from "../../compartilhado/alertas";
import { CATALOGO, severidadeMin } from "./catalogo";
import { decidirAgrupamento } from "./agrupar";
import { avaliarSilencio, partesDoSistema, type ContextoSilencio, type ResolverLocal, type SilencioTemporario } from "./silencio";
import type { SilencioDef } from "../../compartilhado/alertas";

export const CANAIS_EXTERNOS: ReadonlySet<TipoCanal> = new Set<TipoCanal>(["telegram", "webhook"]);
export const ehExterno = (t: TipoCanal): boolean => CANAIS_EXTERNOS.has(t);

export interface EntregaPlanejada {
  alerta_id: string;
  canal_id: string;
  regra_id: string;
  estado: "pendente" | "agrupado";
  /** ms epoch em que pode sair; `null` = já. */
  liberar_em: number | null;
  motivo: "imediato" | "lote" | "digest" | "silencio";
  nivel: NivelTemplate;
  chat_ref: string | null;
}

export interface ContextoAvaliacao {
  agora: number;
  resolver?: ResolverLocal;
  silencio_global?: SilencioDef;
  silencio_global_temporario?: SilencioTemporario;
  /** silêncio por canal (`/silenciar`), por id do canal. */
  silencio_canal?: Record<string, SilencioTemporario | undefined>;
}

export function casaFiltros(f: FiltrosRegra, a: AlertaVisao): boolean {
  if (f.workspace_ids !== undefined && f.workspace_ids.length > 0 && (a.workspace_id === null || !f.workspace_ids.includes(a.workspace_id))) return false;
  if (f.mission_ids !== undefined && f.mission_ids.length > 0 && (a.mission_id === null || !f.mission_ids.includes(a.mission_id))) return false;
  if (f.severidade_min !== undefined && !severidadeMin(a.severidade, f.severidade_min)) return false;
  if (f.sp_min !== undefined) {
    const sp = a.dados.story_points;
    if (typeof sp !== "number" || sp < f.sp_min) return false;
  }
  if (f.so_atrasadas === true && a.tipo !== "tarefa_atrasada" && !(typeof a.dados.atraso_ms === "number" && a.dados.atraso_ms > 0)) return false;
  return true;
}

function casaTipo(r: Regra, a: AlertaVisao, canal: CanalRegistro): boolean {
  if (r.tipos.includes(a.tipo)) return true;
  if (!r.tipos.includes("*")) return false;
  // curinga nunca leva tipo "só app" (agente_mensagem, AB-12) a canal externo: exige regra explícita pelo tipo
  return !(ehExterno(canal.tipo) && !CATALOGO[a.tipo].externo_por_padrao);
}

export function avaliar(alerta: AlertaVisao, regras: Regra[], canais: CanalRegistro[], ctx: ContextoAvaliacao): EntregaPlanejada[] {
  const resolver = ctx.resolver ?? partesDoSistema;
  const porId = new Map(canais.map((c) => [c.id, c]));
  const saida: EntregaPlanejada[] = [];
  const vistos = new Set<string>();
  if (alerta.dados.somente_app === true) return saida; // ex.: "nada hoje": só no Centro
  for (const r of regras) {
    if (!r.ativa) continue;
    if (r.efemera_ate !== null && Date.parse(r.efemera_ate) <= ctx.agora) continue;
    const canal = porId.get(r.canal_id);
    if (canal === undefined || !canal.saida_ligada || canal.estado !== "ativo") continue;
    if (ehExterno(canal.tipo) && canal.consentimento === null) continue;
    if (!casaTipo(r, alerta, canal) || !casaFiltros(r.filtros, alerta)) continue;
    const chave = `${alerta.id}|${canal.id}|${r.id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const ctxSil: ContextoSilencio = { regra: r.silencio };
    if (ctx.silencio_global !== undefined) ctxSil.global = ctx.silencio_global;
    if (ctx.silencio_global_temporario !== undefined) ctxSil.global_temporario = ctx.silencio_global_temporario;
    const sc = ctx.silencio_canal?.[canal.id] ?? (canal.silenciado_ate === null ? undefined : { ate: canal.silenciado_ate, incluir_criticos: false });
    if (sc !== undefined) ctxSil.canal = sc;
    const sil = avaliarSilencio(ctxSil, alerta.severidade, ctx.agora, resolver);
    const chat_ref = r.chat_ref ?? null;
    if (sil.silenciado) {
      saida.push({ alerta_id: alerta.id, canal_id: canal.id, regra_id: r.id, estado: "agrupado", liberar_em: sil.ate_ms ?? ctx.agora + 3_600_000, motivo: "silencio", nivel: r.nivel, chat_ref });
      continue;
    }
    const g = decidirAgrupamento(r.agrupamento, alerta, ctx.agora, resolver);
    saida.push({ alerta_id: alerta.id, canal_id: canal.id, regra_id: r.id, estado: g.estado, liberar_em: g.liberar_em, motivo: g.motivo, nivel: r.nivel, chat_ref });
  }
  return saida;
}
