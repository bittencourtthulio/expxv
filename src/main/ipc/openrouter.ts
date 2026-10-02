// Canais `provedores:openrouter_*` (Fase 9): validadores (T-09.01) e manipuladores (T-09.26).
// A chave entra UMA vez (`chave_gravar`/`testar`), vai direto ao cofre/uso único e nunca volta. Rede só por clique e só com consentimento.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { OpenRouterErro, type ServicoOpenRouter } from "../../nucleo/openrouter";
import type { RegistroIpc } from "./registro";
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

// ---------------------------------------------------------------- manipuladores (T-09.26)

export interface DependenciasIpcOpenRouter {
  registro: RegistroIpc;
  /** serviço sob demanda (nada de cofre/rede até alguém clicar). */
  servico: () => ServicoOpenRouter;
}

/**
 * Erro que o renderer pode ver: `OpenRouterErro` (código nominal, mensagem fixa, sem chave) ou texto genérico. A mensagem original de qualquer
 * outra falha (cofre, banco, rede) não é repassada: poderia citar caminho ou valor.
 */
export function sanearErroOpenRouter(e: unknown): Error {
  if (e instanceof OpenRouterErro) return e;
  return new Error("falha no OpenRouter");
}

export function registrarIpcOpenRouter({ registro, servico }: DependenciasIpcOpenRouter): void {
  const V = VALIDADORES_OPENROUTER;
  const com = <T>(f: (s: ServicoOpenRouter) => Promise<T> | T): Promise<T> =>
    Promise.resolve()
      .then(() => f(servico()))
      .catch((e: unknown) => {
        throw sanearErroOpenRouter(e);
      });
  registro.invoke("provedores:openrouter_estado", V["provedores:openrouter_estado"], () => com((s) => s.estado()));
  registro.invoke("provedores:openrouter_consentir", V["provedores:openrouter_consentir"], ({ versao_texto }) => com((s) => s.consentir(versao_texto)));
  registro.invoke("provedores:openrouter_revogar", V["provedores:openrouter_revogar"], () => com((s) => s.revogar()));
  registro.invoke("provedores:openrouter_chave_gravar", V["provedores:openrouter_chave_gravar"], ({ conta_id, rotulo, chave }) =>
    com((s) => s.gravarChave({ ...(conta_id === undefined ? {} : { conta_id }), rotulo, chave })),
  );
  registro.invoke("provedores:openrouter_chave_apagar", V["provedores:openrouter_chave_apagar"], ({ conta_id }) => com((s) => s.apagarChave(conta_id)));
  registro.invoke("provedores:openrouter_testar", V["provedores:openrouter_testar"], ({ conta_id, chave }) =>
    com((s) => s.testar({ ...(conta_id === undefined ? {} : { conta_id }), ...(chave === undefined ? {} : { chave }) })),
  );
  registro.invoke("provedores:openrouter_modelos_atualizar", V["provedores:openrouter_modelos_atualizar"], ({ conta_id }) => com((s) => s.atualizarModelos(conta_id)));
  registro.invoke("provedores:openrouter_modelos_listar", V["provedores:openrouter_modelos_listar"], (p) => com((s) => s.listarModelos(p)));
  registro.invoke("provedores:openrouter_modelo_gravar", V["provedores:openrouter_modelo_gravar"], (p) => com((s) => s.gravarModelo(p)));
  registro.invoke("provedores:openrouter_saldo_atualizar", V["provedores:openrouter_saldo_atualizar"], ({ conta_id }) => com((s) => s.atualizarSaldo(conta_id)));
}
