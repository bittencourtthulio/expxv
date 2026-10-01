// T-09.08 · Limite manual: o dono informa "usado X%, reinicia em Y" por janela (confiança `manual`). Expira quando
// `reinicia_em` passa. Sobrevive a reinício (tabela `limite_manual`). Cada linha vira um snapshot com o seu
// `informado_em`, para que um dado MEDIDO mais novo vença no merge do serviço.
import type { LimitSnapshot } from "../../../compartilhado/limites";
import { INTERVALO_PADRAO_S, type AdaptadorLimite, type ContaLimite, type ContextoLeitura } from "./adaptador";

export interface LinhaManual {
  conta_id: string;
  janela: "five_hour" | "weekly" | "monthly";
  usado_pct: number;
  reinicia_em: string | null;
  informado_em: string;
}

export function criarAdaptadorManual(fonte: { listar(contaId: string): readonly LinhaManual[] }): AdaptadorLimite {
  return {
    id: "manual",
    fonte: "manual",
    provedores: null,
    intervalo_min_s: INTERVALO_PADRAO_S,
    rede: false,
    aplicavel: () => true,
    async ler(conta: ContaLimite, ctx: ContextoLeitura): Promise<LimitSnapshot[] | null> {
      const linhas = fonte.listar(conta.id).filter((l) => l.reinicia_em === null || Date.parse(l.reinicia_em) > ctx.agora);
      if (linhas.length === 0) return null;
      return linhas.map((l) => ({
        account_id: conta.id,
        provider: conta.provedor,
        fetched_at: new Date(Math.min(Date.parse(l.informado_em) || ctx.agora, ctx.agora)).toISOString(),
        fonte: "manual",
        confianca: "manual",
        status: "ok",
        windows: [{ kind: l.janela, used_pct: l.usado_pct, resets_at: l.reinicia_em }],
        model_buckets: {},
      }));
    },
  };
}
