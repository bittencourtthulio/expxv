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
}

const H5 = 5 * 3_600_000;
const SEMANA = 7 * 24 * 3_600_000;

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
      const calc = (kind: "five_hour" | "weekly", teto: number | null, ms: number): void => {
        if (teto === null || !(teto > 0)) return;
        const usado = fonte.consumo(conta.id, ms);
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
