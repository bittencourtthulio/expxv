// Adaptador de limite `openrouter` (T-09.26): crédito/limite em USD da chave do dono vira uma janela `credit` (sem reset).
// REDE: declara `rede: true` e `intervalo_min_s: 300`; só roda sozinho com o backend CONSENTIDO e Pane OpenRouter vivo (P-104).
// Fora disso devolve o último saldo gravado (por clique em "atualizar saldo"), sem tocar a rede. Conta sem limite informado ⇒ `used_pct:null`
// (nunca 0). `nucleo/` não importa Electron nem rede: a consulta entra por injeção (o main a faz via `nucleo/rede` com consentimento).
import type { LimitSnapshot } from "../../../compartilhado/limites";
import { INTERVALO_REDE_S, type AdaptadorLimite, type ContaLimite, type ContextoLeitura } from "./adaptador";

export interface SaldoGravado {
  limite_usd: number | null;
  usado_usd: number | null;
  saldo_usd: number | null;
  /** ISO do momento em que a API respondeu; `null` = nunca consultado. */
  saldo_em: string | null;
}

export interface FonteSaldoOpenRouter {
  saldoDe(contaId: string): SaldoGravado | undefined;
  consentido(): boolean;
  /** existe Pane aberto com modelo do OpenRouter? */
  paneVivo(): boolean;
  /** consulta a API e GRAVA o saldo (o adaptador relê em seguida). Lança em falha (conta para o breaker do serviço). */
  consultar(contaId: string, sinal: AbortSignal): Promise<void>;
}

export const percentualDeCredito = (limite: number | null, usado: number | null): number | null =>
  limite !== null && limite > 0 && usado !== null && usado >= 0 ? Math.min(100, (usado / limite) * 100) : null;

export function criarAdaptadorOpenRouterSaldo(f: FonteSaldoOpenRouter): AdaptadorLimite {
  const podeConsultar = (): boolean => f.consentido() && f.paneVivo();
  return {
    id: "openrouter",
    fonte: "openrouter_api",
    provedores: ["openrouter"],
    intervalo_min_s: INTERVALO_REDE_S,
    rede: true,
    aplicavel: (conta: ContaLimite) => conta.provedor === "openrouter" && podeConsultar(),
    async ler(conta: ContaLimite, ctx: ContextoLeitura): Promise<LimitSnapshot | null> {
      let s = f.saldoDe(conta.id);
      if (s === undefined) return null;
      const idadeMs = s.saldo_em === null ? Number.POSITIVE_INFINITY : ctx.agora - Date.parse(s.saldo_em);
      if (podeConsultar() && !(idadeMs < INTERVALO_REDE_S * 1000)) {
        await f.consultar(conta.id, ctx.sinal);
        s = f.saldoDe(conta.id) ?? s;
      }
      if (s.saldo_em === null) return null;
      const quando = Date.parse(s.saldo_em);
      return {
        account_id: conta.id,
        provider: "openrouter",
        fetched_at: new Date(Number.isFinite(quando) ? Math.min(quando, ctx.agora) : ctx.agora).toISOString(),
        fonte: "openrouter_api",
        confianca: "medido",
        status: "ok",
        windows: [{ kind: "credit", used_pct: percentualDeCredito(s.limite_usd, s.usado_usd), resets_at: null }],
        model_buckets: {},
        credit: { limit_usd: s.limite_usd, used_usd: s.usado_usd, remaining_usd: s.saldo_usd },
      };
    },
  };
}
