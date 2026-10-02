import type { CodigoErroAgil } from "../../compartilhado/agil";

/** Erro nominal da gestão ágil. `subcode: "human_only"` = agente tentou uma ação reservada ao humano (D-21). */
export class ErroAgil extends Error {
  constructor(readonly code: CodigoErroAgil, message: string, readonly subcode: string | null = null) {
    super(message);
    this.name = "ErroAgil";
  }
}
export const invalido = (m: string): ErroAgil => new ErroAgil("invalid_argument", m);
export const naoEncontrado = (m: string): ErroAgil => new ErroAgil("not_found", m);
export const regraViolada = (m: string, subcode: string | null = null): ErroAgil => new ErroAgil("rule_violation", m, subcode);
export const apenasHumano = (acao: string): ErroAgil => regraViolada(`ação reservada a humano: ${acao}`, "human_only");
