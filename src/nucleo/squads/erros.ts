// Erros nominais da execução de squads (Fase 14). `codigo` estável para a UI e para os testes; a mensagem nunca cita caminho
// absoluto nem o texto de um prompt.
import type { Achado } from "./tipos";

export abstract class ErroDeSquad extends Error {
  abstract readonly codigo: string;
}
export class SquadInvalidaErro extends ErroDeSquad {
  readonly codigo = "squad_invalida";
  constructor(readonly slug: string, readonly achados: Achado[]) {
    super(`A squad ${slug.slice(0, 40)} tem erros de validação e não pode executar.`);
    this.name = "SquadInvalidaErro";
  }
}
export class ObjetivoInvalidoErro extends ErroDeSquad {
  readonly codigo = "objetivo_invalido";
  constructor(motivo: string) {
    super(`Objetivo inválido: ${motivo}.`);
    this.name = "ObjetivoInvalidoErro";
  }
}
export class CliIndisponivelErro extends ErroDeSquad {
  readonly codigo = "cli_indisponivel";
  constructor(readonly cli: string, readonly membro: string) {
    super(`A CLI "${cli.slice(0, 20)}" de ${membro.slice(0, 40)} não está instalada ou habilitada.`);
    this.name = "CliIndisponivelErro";
  }
}
export class CliSemIntakeErro extends ErroDeSquad {
  readonly codigo = "cli_sem_intake";
  constructor(readonly cli: string) {
    super(`A CLI "${cli.slice(0, 20)}" não oferece contrato de intake: o orquestrador precisa de claude, codex ou opencode.`);
    this.name = "CliSemIntakeErro";
  }
}
export class PromptDoMembroInvalidoErro extends ErroDeSquad {
  readonly codigo = "prompt_invalido";
  constructor(readonly agente_id: string, readonly achados: Achado[]) {
    super(`O prompt de ${agente_id.slice(0, 80)} está ausente ou inválido.`);
    this.name = "PromptDoMembroInvalidoErro";
  }
}
export class SquadAusenteErro extends ErroDeSquad {
  readonly codigo = "squad_ausente";
  constructor(readonly slug: string) {
    super(`A squad ${slug.slice(0, 40)} desta Missão não existe mais.`);
    this.name = "SquadAusenteErro";
  }
}
export class OrquestradorNaoAbriuErro extends ErroDeSquad {
  readonly codigo = "orquestrador_nao_abriu";
  constructor(readonly mission_id: string) {
    super("O terminal do orquestrador não abriu; a Missão foi abortada.");
    this.name = "OrquestradorNaoAbriuErro";
  }
}
