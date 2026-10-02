// Canais `limites:*` (Fase 9): validadores (T-09.01) e manipuladores (T-09.08; histórico/previsão/alertas = T-09.09).
// Chave = nome do canal (o teste de contrato do registro confere que cada canal do contrato tem validador).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { JANELAS_KIND, JANELAS_MANUAIS, MAX_PONTOS_HISTORICO, MAX_SEMANAS_EFICIENCIA } from "../../compartilhado/limites";
import type { AccountUsage, AlertaLimite, AmostraLimite, EficienciaSemana, JanelaManual, PedidoHistoricoLimites, PrevisaoZerar, RespostaLimites } from "../../compartilhado/limites";
import type { RegistroIpc } from "./registro";
import { vIdConta } from "./comum-dominio";
import { vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vInstante, vObjetoOpc, vPct, vNulavel, type ValidadoresDaFamilia } from "./validar-harness";

const vBalde = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/ });

/** `desde < ate` (intervalo vazio ou invertido é recusado). */
const vHistorico: Validador<CanaisInvoke["limites:historico"]["entrada"]> = (v) => {
  const base = vObjetoOpc(
    {
      conta_id: vIdConta,
      janela: vEnum([...JANELAS_KIND, "modelo"] as const),
      desde: vInstante,
      ate: vInstante,
      max_pontos: vInteiro({ min: 1, max: MAX_PONTOS_HISTORICO }),
    },
    { balde: vBalde },
  )(v);
  if (!base.ok) return base;
  if (Date.parse(base.valor.desde) >= Date.parse(base.valor.ate)) return { ok: false, erro: "desde deve ser anterior a ate" } satisfies Resultado<never>;
  if (base.valor.janela === "modelo" && base.valor.balde === undefined) return { ok: false, erro: "balde: obrigatório para janela modelo" };
  if (base.valor.janela !== "modelo" && base.valor.balde !== undefined) return { ok: false, erro: "balde: só vale para janela modelo" };
  return base;
};

export const VALIDADORES_LIMITES = {
  "limites:snapshot": vObjetoOpc({}, { conta_ids: vLista(vIdConta, 50) }),
  "limites:atualizar": vObjetoOpc({}, { conta_id: vIdConta }),
  "limites:manual_definir": vObjeto({ conta_id: vIdConta, janela: vEnum(JANELAS_MANUAIS), usado_pct: vPct, reinicia_em: vNulavel(vInstante) }),
  "limites:manual_limpar": vObjetoOpc({ conta_id: vIdConta }, { janela: vEnum(JANELAS_MANUAIS) }),
  "limites:historico": vHistorico,
  "limites:previsao": vObjeto({ conta_id: vIdConta }),
  "limites:eficiencia": vObjetoOpc({ semanas: vInteiro({ min: 1, max: MAX_SEMANAS_EFICIENCIA }) }, { conta_id: vIdConta }),
  "limites:alertas": vObjeto({}),
} satisfies ValidadoresDaFamilia<"limites:">;

export type CanalLimites = keyof typeof VALIDADORES_LIMITES;

// ---------------------------------------------------------------- manipuladores (T-09.08)
// `snapshot` lê só o cache (nunca espera I/O); `atualizar` obedece ≤ 1 leitura/conta/5 s; o limite manual passa pelo
// repositório e relê só a fonte `manual`. Histórico, previsão, eficiência e alertas são da T-09.09: entram por injeção
// (`historico`) e só são registrados se vierem — um canal sem manipulador continua recusado pelo registro.

export interface ServicoLimitesIpc {
  snapshot(contaIds?: readonly string[]): RespostaLimites;
  atualizar(contaId?: string): Promise<RespostaLimites>;
  usoDe(contaId: string): AccountUsage;
  recarregarFonte(contaId: string, adaptadorId: string): Promise<AccountUsage>;
}
export interface ManualLimitesIpc {
  definir(contaId: string, janela: JanelaManual, usadoPct: number, reiniciaEm: string | null): unknown;
  limpar(contaId: string, janela?: JanelaManual): unknown;
}
export interface HistoricoLimitesIpc {
  historico(pedido: PedidoHistoricoLimites): AmostraLimite[] | Promise<AmostraLimite[]>;
  previsao(contaId: string): PrevisaoZerar[] | Promise<PrevisaoZerar[]>;
  eficiencia(semanas: number, contaId?: string): EficienciaSemana[] | Promise<EficienciaSemana[]>;
  alertas(): AlertaLimite[] | Promise<AlertaLimite[]>;
}
export interface DependenciasIpcLimites {
  registro: RegistroIpc;
  servico: ServicoLimitesIpc;
  manual: ManualLimitesIpc;
  historico?: HistoricoLimitesIpc;
}

/** Id do adaptador manual (adaptadores/manual.ts). */
export const ID_ADAPTADOR_MANUAL = "manual";

export function registrarIpcLimites(d: DependenciasIpcLimites): void {
  const { registro, servico, manual, historico } = d;
  const V = VALIDADORES_LIMITES;
  registro.invoke("limites:snapshot", V["limites:snapshot"], ({ conta_ids }) => servico.snapshot(conta_ids));
  registro.invoke("limites:atualizar", V["limites:atualizar"], ({ conta_id }) => servico.atualizar(conta_id));
  registro.invoke("limites:manual_definir", V["limites:manual_definir"], async ({ conta_id, janela, usado_pct, reinicia_em }) => {
    manual.definir(conta_id, janela, usado_pct, reinicia_em);
    return servico.recarregarFonte(conta_id, ID_ADAPTADOR_MANUAL);
  });
  registro.invoke("limites:manual_limpar", V["limites:manual_limpar"], async ({ conta_id, janela }) => {
    manual.limpar(conta_id, janela);
    return servico.recarregarFonte(conta_id, ID_ADAPTADOR_MANUAL);
  });
  if (historico === undefined) return;
  registro.invoke("limites:historico", V["limites:historico"], (p) => historico.historico(p));
  registro.invoke("limites:previsao", V["limites:previsao"], ({ conta_id }) => historico.previsao(conta_id));
  registro.invoke("limites:eficiencia", V["limites:eficiencia"], ({ semanas, conta_id }) => historico.eficiencia(semanas, conta_id));
  registro.invoke("limites:alertas", V["limites:alertas"], () => historico.alertas());
}
