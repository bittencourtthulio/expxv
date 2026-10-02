// Estimativa por consumo observado (fonte `estimado`, confiança `estimado`). Só existe com TETO que o dono informou
// (`teto_tokens_5h`/`teto_tokens_semana` em `conta_roteamento`) e consumo observado fornecido por injeção (Fase 10).
// Sem teto ou sem consumo → `null` (desconhecido): nunca inventa folga. Janela móvel: sem `resets_at`.
import type { JanelaLimite, LimitSnapshot } from "../../../compartilhado/limites";
import { INTERVALO_PADRAO_S, type AdaptadorLimite, type ContaLimite, type ContextoLeitura } from "./adaptador";

export interface FonteEstimativa {
  /** Tetos informados pelo dono para a conta (null = não informado). */
  tetos(contaId: string): { cinco_horas: number | null; semana: number | null };
  /** Tokens consumidos pela conta nos últimos `ms` (null = sem medição de uso). */
  consumo(contaId: string, ms: number): number | null;
  /**
   * Fase 10 (T-10.22), OPCIONAL: último `resets_at` conhecido da janela (epoch ms, de fonte medida ou manual, nunca do próprio estimado). Junto com `consumoDesde`
   * liga o MODO POR CICLO: o consumo é somado desde o INÍCIO do ciclo inferido desse reset; sem reset conhecido a janela não produz nada (`null`, nunca chute).
   * Ausente = o modo de janela móvel de antes (compatível).
   */
  ultimoReset?(contaId: string, kind: "five_hour" | "weekly"): number | null;
  /** Fase 10 (T-10.22), OPCIONAL: tokens observados desde `desdeMs` (lidos do agregado por conta; null = sem medição). */
  consumoDesde?(contaId: string, desdeMs: number): number | null;
}

const H5 = 5 * 3_600_000;
const SEMANA = 7 * 24 * 3_600_000;

/** Início do ciclo corrente a partir de UM reset conhecido (passado ou futuro) e da duração do ciclo. Determinístico: `reset + k·duração ≤ agora < reset + (k+1)·duração`. */
export function inicioDoCiclo(resetMs: number, duracaoMs: number, agoraMs: number): number | null {
  if (!Number.isFinite(resetMs) || !(duracaoMs > 0) || !Number.isFinite(agoraMs)) return null;
  return resetMs + Math.floor((agoraMs - resetMs) / duracaoMs) * duracaoMs;
}

export function criarAdaptadorEstimado(fonte: FonteEstimativa): AdaptadorLimite {
  return {
    id: "estimado",
    fonte: "estimado",
    provedores: null,
    intervalo_min_s: INTERVALO_PADRAO_S,
    rede: false,
    aplicavel: () => true,
    async ler(conta: ContaLimite, ctx: ContextoLeitura): Promise<LimitSnapshot | null> {
      const t = fonte.tetos(conta.id);
      const janelas: JanelaLimite[] = [];
      const porCiclo = fonte.ultimoReset !== undefined && fonte.consumoDesde !== undefined;
      const calc = (kind: "five_hour" | "weekly", teto: number | null, ms: number): void => {
        if (teto === null || !(teto > 0)) return;
        let usado: number | null;
        if (porCiclo) {
          const reset = fonte.ultimoReset?.(conta.id, kind) ?? null;
          const inicio = reset === null ? null : inicioDoCiclo(reset, ms, ctx.agora);
          usado = inicio === null ? null : (fonte.consumoDesde?.(conta.id, inicio) ?? null);
        } else usado = fonte.consumo(conta.id, ms);
        if (usado === null || !Number.isFinite(usado) || usado < 0) return;
        janelas.push({ kind, used_pct: Math.min(100, (usado / teto) * 100), resets_at: null });
      };
      calc("five_hour", t.cinco_horas, H5);
      calc("weekly", t.semana, SEMANA);
      if (janelas.length === 0) return null;
      return { account_id: conta.id, provider: conta.provedor, fetched_at: new Date(ctx.agora).toISOString(), fonte: "estimado", confianca: "estimado", status: "ok", windows: janelas, model_buckets: {} };
    },
  };
}
