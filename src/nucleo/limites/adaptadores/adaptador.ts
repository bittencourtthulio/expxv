// Contrato dos adaptadores de fonte de limite (T-09.04). Um adaptador lê UMA fonte (arquivo que a CLI já grava,
// valor manual, estimativa, API do dono) e devolve snapshots já normalizados; `null` = sem dado (não é erro).
// Exceção/timeout = falha (conta para o breaker). Nenhum adaptador toca credencial de CLI (D-57).
import type { FonteLimite, LimitSnapshot } from "../../../compartilhado/limites";

export interface ContaLimite {
  id: string;
  provedor: string;
  rotulo: string;
  /** Config dir ABSOLUTO da conta (CODEX_HOME / CLAUDE_CONFIG_DIR); `null` se a conta não tem. */
  config_dir: string | null;
  habilitada: boolean;
}

export interface ContextoLeitura {
  /** Abortado pelo serviço no timeout (2 s). O adaptador deve respeitar; o serviço não depende disso para seguir. */
  sinal: AbortSignal;
  /** epoch ms (relógio do serviço). */
  agora: number;
}

export interface AdaptadorLimite {
  id: string;
  fonte: FonteLimite;
  /** `null` = vale para qualquer provedor. */
  provedores: readonly string[] | null;
  /** Intervalo mínimo entre leituras desta fonte por conta (padrão 60; rede ≥ 300). */
  intervalo_min_s: number;
  /** Fonte que usa a rede: só roda com o backend consentido e Pane vivo (decidido em `aplicavel`). */
  rede: boolean;
  aplicavel(conta: ContaLimite): boolean;
  ler(conta: ContaLimite, ctx: ContextoLeitura): Promise<LimitSnapshot | LimitSnapshot[] | null>;
}

export const INTERVALO_PADRAO_S = 60;
export const INTERVALO_REDE_S = 300;

export function atendeProvedor(a: Pick<AdaptadorLimite, "provedores">, conta: Pick<ContaLimite, "provedor">): boolean {
  return a.provedores === null || a.provedores.includes(conta.provedor);
}
