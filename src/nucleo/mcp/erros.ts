/**
 * Erros do MCP do app (05-CONTRATOS §3). Contrato externo: `code` e `subcode` em inglês snake_case.
 * O corpo devolvido às CLIs é sempre `{code, subcode?, message}`; nunca segredo, caminho absoluto ou stack.
 */
export const CODIGOS_ERRO = [
  "unauthorized",
  "not_found",
  "invalid_argument",
  "rule_violation",
  "skill_not_allowed",
  "conflict",
  "unavailable",
  "memory_disabled",
  "too_large",
] as const;
export type CodigoErro = (typeof CODIGOS_ERRO)[number];

export const SUBCODIGOS_ERRO = [
  "forbidden_role",
  "gate_pending",
  "reviewer_required",
  "limit_reached",
  "provider_disabled",
  "not_in_mission",
  "handoff_missing",
  "summary_too_long",
  "pilot_cli_unsupported_intake",
] as const;
export type SubcodigoErro = (typeof SUBCODIGOS_ERRO)[number];

export interface CorpoErro {
  code: CodigoErro;
  subcode?: SubcodigoErro;
  message: string;
}

export class ErroMcp extends Error {
  override name = "ErroMcp";
  readonly code: CodigoErro;
  readonly subcode: SubcodigoErro | undefined;

  constructor(code: CodigoErro, message: string, subcode?: SubcodigoErro) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }

  corpo(): CorpoErro {
    return this.subcode === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, subcode: this.subcode, message: this.message };
  }
}

export const naoAutorizado = (mensagem = "Token ausente, inválido ou expirado."): ErroMcp => new ErroMcp("unauthorized", mensagem);
export const naoEncontrado = (mensagem: string): ErroMcp => new ErroMcp("not_found", mensagem);
export const argumentoInvalido = (mensagem: string, subcode?: SubcodigoErro): ErroMcp => new ErroMcp("invalid_argument", mensagem, subcode);
export const violacaoDeRegra = (subcode: SubcodigoErro, mensagem: string): ErroMcp => new ErroMcp("rule_violation", mensagem, subcode);
export const indisponivel = (mensagem: string): ErroMcp => new ErroMcp("unavailable", mensagem);
export const conflito = (mensagem: string): ErroMcp => new ErroMcp("conflict", mensagem);
export const grande = (mensagem: string): ErroMcp => new ErroMcp("too_large", mensagem);

/** Qualquer coisa lançada vira um corpo do contrato; erro desconhecido vira `unavailable` sem vazar detalhe. */
export function corpoDeErro(erro: unknown): CorpoErro {
  if (erro instanceof ErroMcp) return erro.corpo();
  return { code: "unavailable", message: "Falha interna ao executar a tool." };
}
