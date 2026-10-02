// Sentinelas de segredo para os testes de vazamento (AB-01, AB-12, AB-20). Montadas por concatenação para que NENHUM arquivo versionado
// carregue uma credencial com formato real por extenso (varredura de segredo no commit). São valores FALSOS, nunca válidos.
export const SK_ANT = ["sk", "ant", "api03", "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"].join("-");
export const SK_PROJ = `sk-${"proj1234567890abcdefghijklmn"}`;
export const GHP = `gh${"p_"}abcdefghijklmnopqrstuvwxyz0123456789`;
export const GITHUB_PAT = `github${"_pat_"}11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz`;
export const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"].join(".");
export const AWS = `AK${"IAIOSFODNN7EXAMPLE"}`;
export const SLACK = `xo${"xb-1234567890-abcdefghijkl"}`;
export const GOOGLE = `AI${"zaSyA-1234567890abcdefghijklmnopqrstuv"}`;
export const BEARER = `Bear${"er abcdefghijklmnop1234567890"}`;
export const URL_COM_SENHA = `postgres${"://usuario:senhasecreta123@db.interno:5432/x"}`;
/** token de bot do Telegram (formato `<id>:<35 caracteres>`), FALSO. */
export const TOKEN_BOT = `${"123456789"}:${"AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s"}`;

export const TODAS_SENTINELAS: readonly string[] = [TOKEN_BOT, SK_ANT, SK_PROJ, GHP, GITHUB_PAT, JWT, AWS, SLACK, GOOGLE, BEARER, URL_COM_SENHA];
