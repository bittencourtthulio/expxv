// Tools `headline_limits` e `headline_pick` (Fase 9, T-09.17). `headline_pick` NÃO implementa escolha de conta: delega, pela porta, a
// `pickAccount` (harness/escolher-conta.ts), a única implementação (D-55). Respostas ≤ 4 KB; dado desconhecido é `null`, nunca 0.
import type { AccountUsage } from "../../../compartilhado/limites";
import { ErroMcp, argumentoInvalido, indisponivel, violacaoDeRegra } from "../erros";
import type { EstrategiaDeEscolha, JanelaDeEscolha, PortaLimites } from "../portas";
import { comoObjeto, identificador, identificadorOpcional, textoOpcional, type DepsTools, type ImplTool } from "./comum";
import { caberEm4Kb } from "./harness";

function exigirLimites(deps: DepsTools): PortaLimites {
  if (deps.limites === undefined) throw indisponivel("O serviço de limites não está disponível.");
  return deps.limites;
}

const JANELAS: readonly JanelaDeEscolha[] = ["five_hour", "weekly", "auto"];
const ESTRATEGIAS: readonly EstrategiaDeEscolha[] = ["expires_first", "max_slack"];

/** Forma compacta (sem caminho, sem chave): só o que o piloto precisa para decidir. */
function compacta(u: AccountUsage): Record<string, unknown> {
  const baldes = Object.entries(u.model_buckets);
  return {
    account_id: u.account_id,
    provider: u.provider,
    source: u.fonte,
    confidence: u.confianca,
    status: u.status,
    bottleneck: u.bottleneck,
    slack_pct: u.slack_pct,
    age_s: u.idade_s,
    windows: u.windows.map((w) => ({ kind: w.kind, used_pct: w.used_pct, resets_at: w.resets_at })),
    ...(baldes.length > 0 ? { model_buckets: Object.fromEntries(baldes.map(([k, b]) => [k, { used_pct: b.used_pct, resets_at: b.resets_at }])) } : {}),
    ...(u.credit === undefined ? {} : { credit: { limit_usd: u.credit.limit_usd, used_usd: u.credit.used_usd, remaining_usd: u.credit.remaining_usd } }),
  };
}

export const headlineLimits: ImplTool = async (args, { deps }) => {
  const a = comoObjeto(args);
  const provedor = identificadorOpcional(a, "provider");
  const r = await exigirLimites(deps).limites(provedor);
  const g = r.geral;
  const overall = {
    worst: g.pior === null ? null : { account_id: g.pior.conta_id, kind: g.pior.kind, used_pct: g.pior.used_pct },
    mean_slack_pct: g.folga_media_pct,
    coverage: { with_data: g.cobertura.com_dado, total: g.cobertura.total },
    alerting: g.em_alerta,
    exhausted: g.esgotadas,
  };
  return caberEm4Kb(r.contas, (itens, extra) => ({ accounts: itens.map(compacta), overall, ...extra }));
};

export const headlinePick: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const provedor = identificador(a, "provider");
  const janela = (textoOpcional(a, "window", 20) ?? "auto") as JanelaDeEscolha;
  if (!JANELAS.includes(janela)) throw argumentoInvalido('O campo "window" deve ser five_hour, weekly ou auto.');
  const estrategia = (textoOpcional(a, "strategy", 20) ?? "expires_first") as EstrategiaDeEscolha;
  if (!ESTRATEGIAS.includes(estrategia)) throw argumentoInvalido('O campo "strategy" deve ser expires_first ou max_slack.');
  const modelo = identificadorOpcional(a, "model");
  // só provedores habilitados são expostos às CLIs (mesma regra de `model_list`)
  const habilitados = await deps.provedores.listar(claims.workspace_id);
  if (!habilitados.some((p) => p.provedor === provedor && p.habilitado)) throw violacaoDeRegra("provider_disabled", `O provedor "${provedor}" não está habilitado.`);
  const r = await exigirLimites(deps).escolher({ workspace_id: claims.workspace_id, provedor, janela, estrategia, modelo });
  if (r === null) throw new ErroMcp("unavailable", `Nenhuma conta de "${provedor}" está disponível agora (esgotadas, desabilitadas ou em espera).`, "no_account_available");
  return { account_id: r.conta_id, slack_pct: r.folga_pct, reason: r.motivo.slice(0, 240), strategy: estrategia };
};
