// Validadores estritos dos canais `atualizacao:*` (Fase 21, T-21.02). SÓ validadores: o registro dos canais em
// `src/compartilhado/ipc.ts`, o preload e os manipuladores entram na onda W3 (coordenador). Nenhum campo carrega URL.
import { CANAIS_ATUALIZACAO, LIMITES_ATUALIZACAO, type ConfigAtualizacao } from "../../compartilhado/atualizacao";
import { vBooleano, vEnum, vInteiro, vObjeto, vTexto, vVazio, type Resultado, type Validador } from "./validar";

const vVersaoSemver = vTexto({ min: 5, max: LIMITES_ATUALIZACAO.versao_max, padrao: /^\d{1,6}\.\d{1,6}\.\d{1,6}(-[0-9A-Za-z.-]{1,32})?$/ });

const CAMPOS_CONFIG = {
  ligada: vBooleano,
  canal: vEnum(CANAIS_ATUALIZACAO),
  baixar_automatico: vBooleano,
  instalar_ao_sair: vBooleano,
  verificar_ao_abrir: vBooleano,
  consentimento_versao: vInteiro({ min: 0, max: 1000 }),
} as const;

/** `atualizacao:config_definir`: objeto PARCIAL e estrito (chave desconhecida é erro; vazio é erro). */
export const vConfigParcial: Validador<Partial<ConfigAtualizacao>> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, erro: "esperado objeto" };
  const entrada = v as Record<string, unknown>;
  const chaves = Object.keys(entrada);
  if (chaves.length === 0) return { ok: false, erro: "nada a alterar" };
  const saida: Record<string, unknown> = {};
  for (const chave of chaves) {
    const validador = (CAMPOS_CONFIG as Record<string, Validador<unknown>>)[chave];
    if (validador === undefined) return { ok: false, erro: `campo desconhecido: ${chave}` };
    const r = validador(entrada[chave]);
    if (!r.ok) return { ok: false, erro: `${chave}: ${r.erro}` };
    saida[chave] = r.valor;
  }
  return { ok: true, valor: saida as Partial<ConfigAtualizacao> };
};

export const VALIDADORES_ATUALIZACAO = {
  "atualizacao:estado": vVazio,
  "atualizacao:config_obter": vVazio,
  "atualizacao:config_definir": vConfigParcial,
  "atualizacao:verificar": vVazio,
  "atualizacao:baixar": vVazio,
  "atualizacao:cancelar": vVazio,
  "atualizacao:instalar": vObjeto({ confirmar_panes: vBooleano }),
  "atualizacao:reverter": vObjeto({ versao: vVersaoSemver }),
  "atualizacao:historico": vObjeto({ limite: vInteiro({ min: 1, max: LIMITES_ATUALIZACAO.historico_max }) }),
} as const;

export type CanalAtualizacaoIpc = keyof typeof VALIDADORES_ATUALIZACAO;

export function validarAtualizacao<C extends CanalAtualizacaoIpc>(canal: C, payload: unknown): Resultado<unknown> {
  return (VALIDADORES_ATUALIZACAO[canal] as Validador<unknown>)(payload);
}
