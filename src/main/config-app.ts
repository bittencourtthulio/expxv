// Leitura tipada das chaves de configuração que o main consome (gravadas por app:config_gravar em
// preferencias.json). Valor ausente ou fora da faixa nunca propaga: cai no padrão seguro.
import type { Permissao } from "../compartilhado/dominio";
import type { Preferencias } from "./preferencias";

export const LIMITE_PAINEIS_PADRAO = 16;

type Leitor = Pick<Preferencias, "obter">;

/** `limite_paineis` (1–64) = sessões por janela. */
export function limitePaineisDe(prefs: Leitor): number {
  const v = prefs.obter("limite_paineis");
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 64 ? v : LIMITE_PAINEIS_PADRAO;
}

/** `permissao_padrao` dos novos workspaces: 'automatico' só se for exatamente esse valor (D-14). */
export function permissaoPadraoDe(prefs: Leitor): Permissao {
  return prefs.obter("permissao_padrao") === "automatico" ? "automatico" : "seguro";
}
