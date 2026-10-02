// Erros nominais do cofre. A mensagem cita no máximo o NOME da entrada (nunca o valor, nunca a senha-mestra,
// nunca pista sobre o motivo de uma decifragem falhar).

export type CodigoCofre =
  | "cofre_indisponivel"
  | "cofre_bloqueado"
  | "senha_incorreta"
  | "senha_mestra_nao_definida"
  | "senha_mestra_invalida"
  | "entrada_inexistente"
  | "entrada_corrompida"
  | "nome_invalido"
  | "valor_invalido"
  | "arquivo_ilegivel";

const MENSAGENS: Record<CodigoCofre, string> = {
  cofre_indisponivel: "cofre indisponível neste sistema",
  cofre_bloqueado: "cofre bloqueado: desbloqueie com a senha-mestra",
  senha_incorreta: "senha-mestra incorreta",
  senha_mestra_nao_definida: "senha-mestra ainda não definida",
  senha_mestra_invalida: "senha-mestra inválida (mínimo de 8 caracteres)",
  entrada_inexistente: "entrada inexistente no cofre",
  entrada_corrompida: "entrada do cofre ilegível ou adulterada",
  nome_invalido: "nome de entrada inválido",
  valor_invalido: "valor inválido",
  arquivo_ilegivel: "arquivo do cofre ilegível",
};

export class CofreErro extends Error {
  constructor(
    readonly codigo: CodigoCofre,
    /** só o NOME da entrada (nunca o valor). */
    readonly nome?: string,
  ) {
    super(nome === undefined ? `${codigo}: ${MENSAGENS[codigo]}` : `${codigo}: ${MENSAGENS[codigo]} (${nome})`);
    this.name = "CofreErro";
  }
}
