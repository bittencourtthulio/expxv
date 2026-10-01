/** Erros nominais do serviço de Git. */
export class GitErro extends Error {
  override name = "GitErro";
  constructor(
    mensagem: string,
    readonly args: readonly string[] = [],
    readonly codigo: number | null = null,
    readonly stderr = "",
  ) {
    super(mensagem);
  }
}
export class GitTimeoutErro extends GitErro {
  override name = "GitTimeoutErro";
  constructor(args: readonly string[], readonly timeoutMs: number) {
    super(`git ${args[0] ?? ""} excedeu o tempo limite de ${timeoutMs} ms.`, args);
  }
}
export class GitIndisponivelErro extends GitErro {
  override name = "GitIndisponivelErro";
  constructor(detalhe: string) {
    super(`Não foi possível executar o git: ${detalhe}`);
  }
}
export class GitOperacaoProibidaErro extends GitErro {
  override name = "GitOperacaoProibidaErro";
  constructor(args: readonly string[]) {
    super(`Operação git proibida neste app: git ${args.join(" ")}`, args);
  }
}
export class NaoEhRepoErro extends GitErro {
  override name = "NaoEhRepoErro";
  constructor(readonly caminho: string) {
    super(`Não é um repositório git: ${caminho}`);
  }
}
export class ArvoreSujaErro extends GitErro {
  override name = "ArvoreSujaErro";
  constructor(readonly caminho: string) {
    super(`A árvore de trabalho tem alterações não salvas: ${caminho}`);
  }
}
export class NomeInvalidoErro extends GitErro {
  override name = "NomeInvalidoErro";
  constructor(readonly nome: string) {
    super(`Nome inválido para git: ${nome}`);
  }
}
export class WorktreeInvalidoErro extends GitErro {
  override name = "WorktreeInvalidoErro";
  constructor(mensagem: string) {
    super(mensagem);
  }
}
export class SufixoEsgotadoErro extends GitErro {
  override name = "SufixoEsgotadoErro";
  constructor(readonly base: string) {
    super(`Não foi possível achar nome livre a partir de "${base}".`);
  }
}
export class GitCanceladoErro extends GitErro {
  override name = "GitCanceladoErro";
  constructor(args: readonly string[] = []) {
    super(`Comando git cancelado: git ${args[0] ?? ""}`.trim(), args);
  }
}
/** `index.lock` (ou outro .lock) preso por OUTRO processo, mesmo depois das tentativas curtas. */
export class GitIndexLockErro extends GitErro {
  override name = "GitIndexLockErro";
  constructor(args: readonly string[], readonly tentativas: number, stderr = "") {
    super(`Outro processo git está usando o repositório (index.lock). Tentei ${tentativas}x; tente de novo em instantes.`, args, 128, stderr);
  }
}
