// Erros tipados da Bot API. Mensagens FIXAS: nunca citam caminho, token, corpo nem texto da API sem sanitizar (AB-01/AB-20).
// O código de status/`error_code` prevalece sobre o texto da descrição (o texto exato de 409/webhook não é confirmado).
export type CodigoTelegram =
  | "token_invalido"
  | "token_ausente"
  | "chat_inalcancavel"
  | "conflito"
  | "limite_de_taxa"
  | "requisicao"
  | "servidor"
  | "rede"
  | "abortado"
  | "consentimento_ausente"
  | "resposta_invalida";

const TEXTOS: Record<CodigoTelegram, string> = {
  token_invalido: "token do bot inválido ou revogado",
  token_ausente: "token do bot ausente no cofre",
  chat_inalcancavel: "o chat não aceita mensagens do bot",
  conflito: "outro leitor está usando este bot (conflito de getUpdates)",
  limite_de_taxa: "limite de taxa do Telegram",
  requisicao: "requisição recusada pelo Telegram",
  servidor: "erro no servidor do Telegram",
  rede: "falha de rede ao falar com o Telegram",
  abortado: "chamada cancelada",
  consentimento_ausente: "consentimento para api.telegram.org ausente",
  resposta_invalida: "resposta inválida do Telegram",
};

export class ErroTelegram extends Error {
  constructor(
    readonly codigo: CodigoTelegram,
    /** `error_code` HTTP/da API quando houver. */
    readonly http?: number,
    /** descrição JÁ sanitizada (sem token), só para diagnóstico. */
    readonly descricao?: string,
  ) {
    super(`${codigo}: ${TEXTOS[codigo]}${http === undefined ? "" : ` [${http}]`}`);
    this.name = "ErroTelegram";
  }
}
export class LimiteDeTaxa extends ErroTelegram {
  constructor(readonly retry_after_s: number) {
    super("limite_de_taxa", 429);
    this.name = "LimiteDeTaxa";
  }
}

const TOKEN = /\d{6,12}:[A-Za-z0-9_-]{30,50}/g;
// troca o segmento /bot<token>/ do caminho por /bot-oculto/ e qualquer token literal por asteriscos.
export function sanitizarTexto(t: string, tokenConhecido?: string): string {
  let s = t.replace(/\/bot[^/\s"']{1,80}\//g, "/bot***/").replace(TOKEN, "***");
  if (tokenConhecido !== undefined && tokenConhecido.length >= 6) s = s.split(tokenConhecido).join("***");
  return s;
}
export const ehErroTelegram = (e: unknown): e is ErroTelegram => e instanceof ErroTelegram;
