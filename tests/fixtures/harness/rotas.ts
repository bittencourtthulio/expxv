// Construtores do roteador/perfil/decisões (Fase 9, onda 3-B). Só dados puros.
import { PADROES_HARNESS, type ConfigHarness, type DecisaoEntrada, type Politica } from "../../../src/compartilhado/harness";
import type { ContaRoteamento } from "../../../src/compartilhado/harness";
import { gerarSemente } from "../../../src/nucleo/harness/semente";
import type { ContaDoSistema, DepsRoteador } from "../../../src/nucleo/harness/roteador";
import { AGORA, PADRAO, conta, type ExtraConta } from "./construtores";

export const WS = "ws1";
export const PROVEDORES = ["claude", "codex", "gemini"] as const;

export function config(sobre: Partial<ConfigHarness> = {}): ConfigHarness {
  return { workspace_id: WS, modo_troca: "automatico", ...PADROES_HARNESS, atualizado_em: "2026-10-01T00:00:00.000Z", ...sobre };
}
/** Semente global completa (uma política por tipo), já como `Politica`. */
export function politicasGlobais(provedores: readonly string[] = PROVEDORES): Politica[] {
  return gerarSemente(provedores, provedores, PADRAO).map((p, i) => ({ ...p, id: `pol_${i}`, atualizado_por: "semente" as const, atualizado_em: "2026-10-01T00:00:00.000Z" }));
}
export function politicaDoWorkspace(base: Politica, sobre: Partial<Politica>): Politica {
  return { ...base, id: `${base.id}_ws`, workspace_id: WS, atualizado_por: "usuario", ...sobre };
}

/** Conta candidata `ExtraConta` → par {conta do sistema, candidata} para os dados do roteador. */
export function mundo(spec: Array<[string, string, ExtraConta?]>): { contas: ContaDoSistema[]; usos: DepsRoteador["usos"] } {
  const contas: ContaDoSistema[] = [];
  const usos: Array<NonNullable<ReturnType<typeof conta>["uso"]>> = [];
  for (const [id, prov, x] of spec) {
    const c = conta(id, prov, x ?? {});
    const rot: ContaRoteamento = {
      conta_id: id,
      reservada_modelos: c.reservada_modelos,
      reservada_papeis: c.reservada_papeis,
      workspaces_fixados: c.fixada_em,
      auth: c.auth,
      em_cooldown_ate: c.cooldown_ate,
      teto_tokens_5h: null,
      teto_tokens_semana: null,
      atualizado_em: "2026-10-01T00:00:00.000Z",
    };
    contas.push({ conta_id: id, provedor: prov, habilitada: c.habilitada, roteamento: rot });
    if (c.uso) usos.push(c.uso);
  }
  return { contas, usos };
}

export function deps(spec: Array<[string, string, ExtraConta?]>, sobre: Partial<DepsRoteador> = {}): DepsRoteador {
  const { contas, usos } = mundo(spec);
  return {
    politica: { globais: politicasGlobais(), doWorkspace: [] },
    usos,
    contas,
    equivalencia: PADRAO,
    config: config(),
    agora: AGORA,
    provedoresViaveis: [...PROVEDORES],
    ...sobre,
  };
}

export function decisaoEntrada(sobre: Partial<DecisaoEntrada> = {}): DecisaoEntrada {
  return {
    proposito: "selecao_conta", workspace_id: WS, mission_id: null, pane_id: null, tipo: "choice", opcoes: ["claude:opus", "codex:default"], probs: null, escolhida: "claude:opus",
    confianca: 0.9, fonte: "politica", escolha_regra: "claude:opus", divergiu: false, latencia_ms: null, custo_usd: null, custo_origem: "desconhecido", decisor: null,
    resumo_enviado: null, resumo_hash: null, skills_aplicadas: false, recibo: "Mantido claude/opus (c1): 10% usado, abaixo do gatilho de 85%. Confiança alta.", ...sobre,
  };
}
