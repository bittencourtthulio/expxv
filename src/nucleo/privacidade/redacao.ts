// Redação de segredos (Fase 11, T-11.03): mascara chaves, tokens e cabeçalhos de autorização em QUALQUER texto que vá a log, diagnóstico, erro ou histórico. Pura.
export const MASCARA = "[REDIGIDO]";

interface Regra { nome: string; padrao: RegExp; trocar?: (m: string, ...g: string[]) => string }

const chaveValor = (m: string, nome: string, sep: string): string => `${nome}${sep}${MASCARA}`;

/** Ordem importa: os padrões mais específicos primeiro. */
const REGRAS: readonly Regra[] = [
  { nome: "pem", padrao: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { nome: "authorization", padrao: /(authorization\s*[:=]\s*)(?:bearer|basic|token|digest)?\s*[^\s"',;]+(?:\s+[A-Za-z0-9._~+/=-]{8,})?/gi, trocar: (_m, pre) => `${pre}${MASCARA}` },
  { nome: "cabecalho_chave", padrao: /((?:x-api-key|x-auth-token|api-key|apikey|proxy-authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, trocar: (_m, pre) => `${pre}${MASCARA}` },
  { nome: "bearer", padrao: /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, trocar: () => `Bearer ${MASCARA}` },
  { nome: "basic", padrao: /\bbasic\s+[A-Za-z0-9+/=]{12,}/gi, trocar: () => `Basic ${MASCARA}` },
  { nome: "jwt", padrao: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { nome: "url_credencial", padrao: /([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, trocar: (_m, esq) => `${esq}${MASCARA}@` },
  { nome: "anthropic", padrao: /\bsk-ant-[A-Za-z0-9_-]{10,}/g },
  { nome: "openrouter", padrao: /\bsk-or-[A-Za-z0-9_-]{10,}/g },
  { nome: "openai", padrao: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g },
  { nome: "github_pat", padrao: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { nome: "github", padrao: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { nome: "gitlab", padrao: /\bglpat-[A-Za-z0-9_-]{16,}/g },
  { nome: "aws", padrao: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g },
  { nome: "google", padrao: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { nome: "google_oauth", padrao: /\bya29\.[0-9A-Za-z_-]{20,}/g },
  { nome: "slack", padrao: /\bxox[abprso]-[A-Za-z0-9-]{10,}/g },
  { nome: "stripe", padrao: /\b[spr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { nome: "stripe_whsec", padrao: /\bwhsec_[A-Za-z0-9]{16,}/g },
  { nome: "sendgrid", padrao: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { nome: "groq", padrao: /\bgsk_[A-Za-z0-9]{20,}/g },
  { nome: "huggingface", padrao: /\bhf_[A-Za-z0-9]{20,}/g },
  { nome: "npm", padrao: /\bnpm_[A-Za-z0-9]{30,}/g },
  { nome: "digitalocean", padrao: /\bdop_v1_[a-f0-9]{40,}/g },
  { nome: "shopify", padrao: /\bshp(?:at|ca|pa|ss)_[a-f0-9]{24,}/g },
  { nome: "twilio", padrao: /\b(?:AC|SK)[0-9a-f]{32}\b/g },
  { nome: "mailgun", padrao: /\bkey-[0-9a-f]{32}\b/g },
  { nome: "telegram", padrao: /\b\d{8,10}:[A-Za-z0-9_-]{34,}\b/g },
  { nome: "discord", padrao: /\b[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g },
  { nome: "atribuicao", padrao: /\b((?:[A-Za-z0-9_.-]*?)(?:api[_-]?key|secret|token|passw(?:or)?d|passwd|senha|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;]+)/gi, trocar: (m, nome, sep) => chaveValor(m, nome, sep) },
  { nome: "hex_longo", padrao: /\b[0-9a-f]{40,}\b/gi },
];

/** Quantidade de famílias de padrão cobertas (o teste exige ≥ 30 amostras mascaradas). */
export const FAMILIAS_REDACAO: readonly string[] = REGRAS.map((r) => r.nome);

/** Mascara qualquer segredo reconhecível. Idempotente e sem efeito colateral. */
export function redigirSegredos(texto: string): string {
  let t = texto;
  for (const r of REGRAS) t = r.trocar === undefined ? t.replace(r.padrao, MASCARA) : t.replace(r.padrao, r.trocar as never);
  return t;
}

/** Mensagem de erro segura para log/UI: redige e limita o tamanho. Nunca stack. */
export function mensagemSegura(e: unknown, max = 300): string {
  const bruto = e instanceof Error ? e.message : String(e);
  return redigirSegredos(bruto).slice(0, max);
}
