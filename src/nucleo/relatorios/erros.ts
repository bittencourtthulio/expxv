// Erros nominais da Fase 19. O texto NUNCA carrega caminho absoluto, SQL, segredo nem stack: o main só repassa `[codigo] mensagem`.
export type CodigoErroRelatorio = "invalid_argument" | "not_found" | "rule_violation" | "consent_required" | "unavailable";

export class ErroRelatorio extends Error {
  override name = "ErroRelatorio";
  constructor(readonly code: CodigoErroRelatorio, message: string) {
    super(message);
  }
}
export const invalido = (m: string): ErroRelatorio => new ErroRelatorio("invalid_argument", m);
export const naoEncontrado = (m: string): ErroRelatorio => new ErroRelatorio("not_found", m);
export const regraViolada = (m: string): ErroRelatorio => new ErroRelatorio("rule_violation", m);
export const semConsentimento = (m: string): ErroRelatorio => new ErroRelatorio("consent_required", m);
export const indisponivel = (m: string): ErroRelatorio => new ErroRelatorio("unavailable", m);
