// Canais `provedores:openrouter_*` (Fase 9, T-09.01). SÓ validadores nesta onda; manipuladores na T-09.26.
// A chave entra UMA vez (`chave_gravar`/`testar`), vai direto ao cofre/uso único e nunca volta. Rede só por clique.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { FAIXAS } from "../../compartilhado/harness";
import { vIdConta } from "./comum-dominio";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Validador } from "./validar";
import { vNulavel, vObjetoOpc, vSemCaminhoNemUrl, vVerdadeiro, type ValidadoresDaFamilia } from "./validar-harness";

/** `vendor/modelo` como a API devolve (uma barra, sem `..`, sem caminho absoluto, sem URL). */
export const vIdModeloOpenRouter: Validador<string> = (v) => {
  const base = vTexto({ min: 3, max: 120, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:+~-]*$/ })(v);
  if (!base.ok) return base;
  return base.valor.includes("..") ? { ok: false, erro: "id inválido" } : base;
};
/** Chave de API do dono: texto opaco; tamanho limitado; nunca logado (canal `sensivel`). */
const vChave = vTexto({ min: 8, max: 512, padrao: /^[\x21-\x7e]+$/ });
const vTipoTarefa = vTexto({ min: 1, max: 40, padrao: /^[a-z][a-z0-9-]{0,39}$/ });
const vCursor = vTexto({ min: 1, max: 160, padrao: /^[A-Za-z0-9_./:~+-]{1,160}$/ });

const vTestar: Validador<CanaisInvoke["provedores:openrouter_testar"]["entrada"]> = (v) => {
  const r = vObjetoOpc({}, { conta_id: vIdConta, chave: vChave })(v);
  if (!r.ok) return r;
  // `chave` = testar SEM salvar; `conta_id` = usar a do cofre. Os dois juntos são ambíguos.
  if (r.valor.conta_id !== undefined && r.valor.chave !== undefined) return { ok: false, erro: "informe conta_id OU chave, não os dois" };
  return r;
};

export const VALIDADORES_OPENROUTER = {
  "provedores:openrouter_estado": vObjeto({}),
  "provedores:openrouter_consentir": vObjeto({ consentimento: vVerdadeiro, versao_texto: vTexto({ min: 1, max: 40, padrao: /^[A-Za-z0-9._-]+$/ }) }),
  "provedores:openrouter_revogar": vObjeto({}),
  "provedores:openrouter_chave_gravar": vObjetoOpc({ rotulo: vSemCaminhoNemUrl({ min: 1, max: 60 }), chave: vChave }, { conta_id: vIdConta }),
  "provedores:openrouter_chave_apagar": vObjeto({ conta_id: vIdConta }),
  "provedores:openrouter_testar": vTestar,
  "provedores:openrouter_modelos_atualizar": vObjetoOpc({}, { conta_id: vIdConta }),
  "provedores:openrouter_modelos_listar": vObjetoOpc(
    {},
    { busca: vSemCaminhoNemUrl({ max: 80 }), so_habilitados: vBooleano, cursor: vCursor, limite: vInteiro({ min: 1, max: 100 }) },
  ),
  "provedores:openrouter_modelo_gravar": vObjeto({
    id: vIdModeloOpenRouter,
    habilitado: vBooleano,
    faixa: vNulavel(vEnum(FAIXAS)),
    tipos_permitidos: vLista(vTipoTarefa, 50),
    ordem: vInteiro({ min: 0, max: 100_000 }),
  }),
  "provedores:openrouter_saldo_atualizar": vObjetoOpc({}, { conta_id: vIdConta }),
} satisfies ValidadoresDaFamilia<"provedores:openrouter_">;

export type CanalOpenRouter = keyof typeof VALIDADORES_OPENROUTER;
