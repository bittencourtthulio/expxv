// Configuração do Maestro (chaves `maestro.*`, fora do banco; sem segredo). Defaults seguros: o plano SEMPRE aparece (`confirmar_plano = 1`), o decisor
// externo fica DESLIGADO e "executar direto" é opt-in do workspace.
import type { PermissaoMembro } from "../../compartilhado/squads";
import { BRANCHES_PROTEGIDAS_PADRAO } from "./rigidez/travas";

export type HookModo = "desligado" | "notificar" | "encaminhar";
export interface ConfigMaestro {
  confirmar_plano: boolean;
  hook_modo: HookModo;
  hook_confianca_min: number;
  producao: boolean;
  branches_protegidas: readonly string[];
  escrever_hooks: boolean;
  hooks_aplicar_ja: boolean;
  max_terminais: number;
  fechar_concluidos: boolean;
  timeout_sem_progresso_min: number;
  proposta_expira_min: number;
  permissao: PermissaoMembro;
}
export const CONFIG_MAESTRO_PADRAO: ConfigMaestro = {
  confirmar_plano: true,
  hook_modo: "encaminhar",
  hook_confianca_min: 0.75,
  producao: false,
  branches_protegidas: BRANCHES_PROTEGIDAS_PADRAO,
  escrever_hooks: true,
  hooks_aplicar_ja: false,
  max_terminais: 4,
  fechar_concluidos: true,
  timeout_sem_progresso_min: 30,
  proposta_expira_min: 30,
  permissao: "seguro",
};
const n = (v: unknown, min: number, max: number, padrao: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v * 100) / 100)) : padrao);
/** Normaliza o que veio do disco/IPC: valor inválido volta ao padrão (nunca lança). `confirmar_plano = false` só vale com `confirmado: true`. */
export function normalizarConfigMaestro(bruto: unknown, opcoes: { confirmado?: boolean } = {}): ConfigMaestro {
  const o = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  const d = CONFIG_MAESTRO_PADRAO;
  const bool = (v: unknown, padrao: boolean): boolean => (typeof v === "boolean" ? v : padrao);
  return {
    confirmar_plano: o.confirmar_plano === false ? opcoes.confirmado !== true : bool(o.confirmar_plano, d.confirmar_plano),
    hook_modo: o.hook_modo === "desligado" || o.hook_modo === "notificar" || o.hook_modo === "encaminhar" ? o.hook_modo : d.hook_modo,
    hook_confianca_min: n(o.hook_confianca_min, 0.5, 1, d.hook_confianca_min),
    producao: bool(o.producao, d.producao),
    branches_protegidas: Array.isArray(o.branches_protegidas) && o.branches_protegidas.every((x) => typeof x === "string" && x.length <= 80) ? (o.branches_protegidas as string[]).slice(0, 50) : d.branches_protegidas,
    escrever_hooks: bool(o.escrever_hooks, d.escrever_hooks),
    hooks_aplicar_ja: bool(o.hooks_aplicar_ja, d.hooks_aplicar_ja),
    max_terminais: n(o.max_terminais, 1, 8, d.max_terminais),
    fechar_concluidos: bool(o.fechar_concluidos, d.fechar_concluidos),
    timeout_sem_progresso_min: n(o.timeout_sem_progresso_min, 5, 240, d.timeout_sem_progresso_min),
    proposta_expira_min: n(o.proposta_expira_min, 5, 240, d.proposta_expira_min),
    permissao: o.permissao === "seguro" || o.permissao === "equilibrado" || o.permissao === "automatico" ? o.permissao : d.permissao,
  };
}
