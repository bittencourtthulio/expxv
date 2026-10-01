/** Erros nominais do domínio: a UI/IPC distingue por `name`/classe, nunca por texto. */
export class ErroDominio extends Error {
  override name = "ErroDominio";
}

export class NaoEncontradoErro extends ErroDominio {
  override name = "NaoEncontradoErro";
  constructor(
    readonly entidade: string,
    readonly id: string,
  ) {
    super(`${entidade} não encontrado(a): ${id}.`);
  }
}

export class TransicaoMissaoInvalidaErro extends ErroDominio {
  override name = "TransicaoMissaoInvalidaErro";
  constructor(
    readonly de: string,
    readonly para: string,
  ) {
    super(`Transição de Missão inválida: ${de} → ${para}.`);
  }
}

export class PilotoDuplicadoErro extends ErroDominio {
  override name = "PilotoDuplicadoErro";
  constructor(readonly missionId: string) {
    super(`A Missão ${missionId} já tem um piloto ativo.`);
  }
}

export class ValidacaoSemRevisorErro extends ErroDominio {
  override name = "ValidacaoSemRevisorErro";
  constructor(readonly taskId: string) {
    super(`A task ${taskId} só pode ser validada com handoff "ok" de um Pane de papel "revisor".`);
  }
}

export class ResumoLongoErro extends ErroDominio {
  override name = "ResumoLongoErro";
  constructor(
    readonly tamanho: number,
    readonly maximo: number,
  ) {
    super(`Resumo do handoff com ${tamanho} caracteres; máximo ${maximo}.`);
  }
}

export class ValorInvalidoErro extends ErroDominio {
  override name = "ValorInvalidoErro";
  constructor(
    readonly campo: string,
    readonly valor: unknown,
  ) {
    super(`Valor inválido para ${campo}: ${String(valor)}.`);
  }
}

export class DuplicadoErro extends ErroDominio {
  override name = "DuplicadoErro";
  constructor(
    readonly entidade: string,
    readonly chave: string,
  ) {
    super(`${entidade} já existe: ${chave}.`);
  }
}
