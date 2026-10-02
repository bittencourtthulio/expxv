// Canais `laya:*` (Fase 25, D-695 a D-708): validadores ESTRITOS do decisor local (05-CONTRATOS §29). O renderer envia
// só `modelo_id` (id do catálogo versionado, formato fechado), `aceite_versao` do consentimento, host nominal do
// consentimento de rede e patches de `ConfigLaya`; NUNCA URL, caminho, checksum, tamanho nem texto de pergunta.
// Quem decide o que baixar é o catálogo versionado, no main (herdado A1 de AUDITORIA-VOZ-LOCAL).
import type { ConfigLaya, PedidoBaixarModeloLaya } from "../../compartilhado/laya";
import { LIMITES_LAYA } from "../../compartilhado/laya";
import type { Validador } from "./validar";
import { vBooleano, vEnum, vInteiro, vObjeto, vTexto, vVazio } from "./validar";

export const vIdModeloLaya = vTexto({ min: 1, max: 64, padrao: /^[a-z0-9][a-z0-9.-]{0,63}$/ });
const vAceite = vTexto({ min: 1, max: 40, padrao: /^[0-9A-Za-z.-]+$/ });

/** host NOMINAL (sem esquema, caminho, porta, credencial nem query): só o que o consentimento de rede cita. */
export function vHostLaya(host: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(host);
}

const vHost: Validador<string> = (v: unknown) =>
  typeof v === "string" && vHostLaya(v) ? { ok: true, valor: v } : { ok: false, erro: "host inválido" };

/** fração 0..1 (confiança). */
const vFracao: Validador<number> = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? { ok: true, valor: v } : { ok: false, erro: "esperado fração entre 0 e 1" };

const vModeloOpcional: Validador<string | null> = (v: unknown) => (v === null ? { ok: true, valor: null } : vIdModeloLaya(v));

/** patch de `ConfigLaya`: objeto ESTRITO, campos opcionais, faixas conferidas (taxa/ociosidade/limiar). */
export const vPatchConfigLaya: Validador<Partial<ConfigLaya>> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, erro: "esperado objeto" };
  const entrada = v as Record<string, unknown>;
  const campos: Record<string, Validador<unknown>> = {
    habilitado: vBooleano,
    modelo_id: vModeloOpcional,
    confianca_minima: vFracao,
    taxa_maxima_minuto: vInteiro({ min: 1, max: 600 }),
    ociosidade_s: vInteiro({ min: LIMITES_LAYA.ociosidade_min_s, max: LIMITES_LAYA.ociosidade_max_s }),
    usar_no_maestro: vBooleano,
    ordenar_roteamento: vBooleano,
    sinais_terminal: vBooleano,
    classificar_erros: vBooleano,
    urgencia_alertas: vBooleano,
  };
  for (const chave of Object.keys(entrada)) {
    if (!(chave in campos)) return { ok: false, erro: `campo desconhecido: ${chave}` };
  }
  const saida: Record<string, unknown> = {};
  for (const [chave, validador] of Object.entries(campos)) {
    if (!(chave in entrada)) continue;
    const r = validador(entrada[chave]);
    if (!r.ok) return { ok: false, erro: `${chave}: ${r.erro}` };
    saida[chave] = r.valor;
  }
  return { ok: true, valor: saida as Partial<ConfigLaya> };
};

const vConsentir = vObjeto({ host: vHost, aceitar: vBooleano });

export const VALIDADORES_LAYA = {
  "laya:estado": vVazio,
  "laya:consentir": vConsentir,
  "laya:modelos_listar": vVazio,
  "laya:modelo_baixar": vObjeto({ modelo_id: vIdModeloLaya, aceite_versao: vAceite, ativar: vBooleano }) as Validador<PedidoBaixarModeloLaya>,
  "laya:modelo_pausar": vObjeto({ modelo_id: vIdModeloLaya }),
  "laya:modelo_retomar": vObjeto({ modelo_id: vIdModeloLaya }),
  "laya:modelo_cancelar": vObjeto({ modelo_id: vIdModeloLaya }),
  "laya:modelo_apagar": vObjeto({ modelo_id: vIdModeloLaya }),
  "laya:modelo_ativar": vObjeto({ modelo_id: vIdModeloLaya }),
  "laya:testar": vVazio,
  "laya:config_gravar": vObjeto({ patch: vPatchConfigLaya }),
} as const;

export type CanalLaya = keyof typeof VALIDADORES_LAYA;

export const vEstadoLaya = vEnum(["indisponivel", "desligado", "pronto", "carregando", "ativo", "falhou"]);
