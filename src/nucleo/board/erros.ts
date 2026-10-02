// Erros nominais do board: `codigo` é o contrato com a UI/IPC (`not_found`, `rule_violation`, `conflict`, `forbidden`, `invalid`, `unavailable`); `subcodigo` detalha.
export type CodigoErroBoard = "not_found" | "rule_violation" | "conflict" | "forbidden" | "invalid" | "unavailable";
export class ErroBoard extends Error {
  override name = "ErroBoard";
  constructor(
    readonly codigo: CodigoErroBoard,
    message: string,
    readonly subcodigo: string | null = null,
  ) {
    super(message);
  }
}
