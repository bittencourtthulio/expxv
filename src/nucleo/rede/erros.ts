// Erros nominais da camada de rede. Mensagens fixas: citam só o host (nunca cabeçalhos, corpo, query ou chave).

export type CodigoRede =
  | "consent_required"
  | "host_nao_permitido"
  | "https_obrigatorio"
  | "requisicao_invalida"
  | "redirect_outro_host"
  | "redirect_demais"
  | "timeout"
  | "resposta_grande_demais"
  | "proxy_falhou"
  | "falha_rede";

const TEXTOS: Record<CodigoRede, string> = {
  consent_required: "consentimento do usuário necessário para esta chamada de rede",
  host_nao_permitido: "host fora da lista de hosts consentidos",
  https_obrigatorio: "https é obrigatório",
  requisicao_invalida: "requisição inválida",
  redirect_outro_host: "redirecionamento para outro host recusado",
  redirect_demais: "redirecionamentos demais",
  timeout: "tempo esgotado",
  resposta_grande_demais: "resposta acima do teto de bytes",
  proxy_falhou: "falha ao usar o proxy do sistema",
  falha_rede: "falha de rede",
};

export class RedeErro extends Error {
  constructor(
    readonly codigo: CodigoRede,
    readonly host?: string,
    /** complemento SEM dado sensível (ex.: código errno). */
    detalhe?: string,
  ) {
    super(`${codigo}: ${TEXTOS[codigo]}${host === undefined ? "" : ` (${host})`}${detalhe === undefined ? "" : ` [${detalhe}]`}`);
    this.name = "RedeErro";
  }
}
