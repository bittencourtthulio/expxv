// Erros nominais do OpenRouter (Fase 9, T-09.26). Mensagens FIXAS: nunca citam chave, cabeçalho, corpo nem URL com query.

export type CodigoOpenRouter =
  | "sem_consentimento"
  | "sem_chave"
  | "conta_inexistente"
  | "chave_invalida"
  | "limite_de_requisicoes"
  | "indisponivel"
  | "resposta_invalida"
  | "modelo_nao_habilitado"
  | "sem_cli_compativel";

const TEXTOS: Record<CodigoOpenRouter, string> = {
  sem_consentimento: "o OpenRouter ainda não foi consentido; nada é enviado antes disso",
  sem_chave: "a conta não tem chave guardada no cofre",
  conta_inexistente: "conta OpenRouter inexistente",
  chave_invalida: "o OpenRouter recusou a chave",
  limite_de_requisicoes: "o OpenRouter pediu para esperar (limite de requisições)",
  indisponivel: "o OpenRouter não respondeu",
  resposta_invalida: "resposta inesperada do OpenRouter",
  modelo_nao_habilitado: "modelo não habilitado para uso",
  sem_cli_compativel: "nenhuma CLI compatível com o OpenRouter está instalada",
};

export class OpenRouterErro extends Error {
  constructor(
    readonly codigo: CodigoOpenRouter,
    /** complemento SEM dado sensível (ex.: id do modelo, status HTTP). */
    detalhe?: string,
  ) {
    super(`${codigo}: ${TEXTOS[codigo]}${detalhe === undefined ? "" : ` (${detalhe})`}`);
    this.name = "OpenRouterErro";
  }
}
