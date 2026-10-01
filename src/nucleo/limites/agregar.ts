// `agregarCotas` (T-09.03): cota geral do topo. Pior caso entre as contas; folga média SÓ das contas com dado;
// `cobertura` ("3/4") sempre visível — conta sem dado nunca é escondida nem contada como folga.
import type { AccountUsage, CotaGeral } from "../../compartilhado/limites";
import { usoDoGargalo } from "./derivar";

export interface OpcoesAgregar {
  /** rótulo exibido por conta (padrão: o id). */
  rotulos?: Readonly<Record<string, string>>;
  /** ≥ este uso a conta conta como "em alerta" (padrão 85). */
  limiar_alerta_pct?: number;
  /** ≥ este uso a conta conta como esgotada (padrão 100). */
  limiar_esgotada_pct?: number;
}

export function agregarCotas(usos: readonly AccountUsage[], opcoes: OpcoesAgregar = {}): CotaGeral {
  const alerta = opcoes.limiar_alerta_pct ?? 85;
  const esgotada = opcoes.limiar_esgotada_pct ?? 100;
  let pior: CotaGeral["pior"] = null;
  let somaFolga = 0;
  let comDado = 0;
  let emAlerta = 0;
  let esgotadas = 0;
  for (const u of usos) {
    const usado = usoDoGargalo(u);
    if (usado === null || u.bottleneck === null || u.slack_pct === null) continue;
    comDado++;
    somaFolga += u.slack_pct;
    if (usado >= esgotada) esgotadas++;
    else if (usado >= alerta) emAlerta++;
    if (pior === null || usado > pior.used_pct || (usado === pior.used_pct && u.account_id < pior.conta_id)) {
      pior = { conta_id: u.account_id, rotulo: opcoes.rotulos?.[u.account_id] ?? u.account_id, kind: u.bottleneck, used_pct: usado };
    }
  }
  return {
    pior,
    folga_media_pct: comDado === 0 ? null : Math.round((somaFolga / comDado) * 10) / 10,
    cobertura: { com_dado: comDado, total: usos.length },
    em_alerta: emAlerta,
    esgotadas,
  };
}
