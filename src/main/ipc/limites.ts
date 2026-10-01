// Canais `limites:*` (Fase 9, T-09.01). SÓ validadores nesta onda; os manipuladores chegam com a T-09.08/T-09.09.
// Chave = nome do canal (o teste de contrato do registro confere que cada canal do contrato tem validador).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { JANELAS_KIND, JANELAS_MANUAIS, MAX_PONTOS_HISTORICO, MAX_SEMANAS_EFICIENCIA } from "../../compartilhado/limites";
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
