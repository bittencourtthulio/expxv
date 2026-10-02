// Configuração padrão e validação (T-19.04, versão enxuta). Segurança como padrão inicial: gerar ao fechar LIGADO (só local), redação por IA em `template` até a pessoa consentir,
// nenhum canal externo consentido. Texto nunca carrega caminho, URL fora de http(s) seguro nem controle.
import { VERSAO_CONSENTIMENTO_ENVIO, type ConfigRelatorios } from "../../compartilhado/relatorios";
import { invalido } from "./erros";
import { limparLinha } from "./seguranca";

export const configPadrao = (): ConfigRelatorios => ({ gerar_ao_fechar: true, redacao_modo: "template", consentimento_llm_em: null, csv_bom: true, consentimento_canais: {}, hashtags: [], cta: null });

export const consentimentoCanalValido = (c: ConfigRelatorios, canal: "telegram"): boolean => c.consentimento_canais[canal]?.versao_texto === VERSAO_CONSENTIMENTO_ENVIO;

/** aplica um parcial vindo da UI: só chaves conhecidas, tipos conferidos; o consentimento NUNCA entra por aqui. */
export function mesclarConfig(base: ConfigRelatorios, parcial: unknown): ConfigRelatorios {
  if (typeof parcial !== "object" || parcial === null || Array.isArray(parcial)) throw invalido("configuração inválida");
  const p = parcial as Record<string, unknown>;
  const out: ConfigRelatorios = { ...base };
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case "gerar_ao_fechar": case "csv_bom":
        if (typeof v !== "boolean") throw invalido(`${k} precisa ser verdadeiro ou falso`);
        out[k] = v; break;
      case "redacao_modo":
        if (v !== "auto" && v !== "llm" && v !== "template") throw invalido("modo de redação inválido");
        out.redacao_modo = v; break;
      case "hashtags":
        if (!Array.isArray(v) || v.length > 5 || !v.every((h) => typeof h === "string" && /^#?[\p{L}\p{N}_]{1,30}$/u.test(h))) throw invalido("hashtags inválidas (até 5, só letras e números)");
        out.hashtags = (v as string[]).map((h) => h.replace(/^#/, "")); break;
      case "cta":
        if (v !== null && typeof v !== "string") throw invalido("chamada para ação inválida");
        out.cta = v === null || v.trim() === "" ? null : limparLinha(v, undefined, 80); break;
      default: throw invalido(`campo desconhecido: ${k}`);
    }
  }
  return out;
}
