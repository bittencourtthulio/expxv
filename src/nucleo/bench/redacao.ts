// Redação de segredo e de caminho absoluto em TEXTO que sai do núcleo (log lido pela UI, relatório exportado, notas). Defesa em profundidade: o ambiente do filho já nasce sem segredo, mas uma
// CLI pode ecoar o que leu. Só padrões inequívocos (sem falso positivo em prosa); o scrubber do cofre entra por cima quando existir.
const PADROES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}/g, "[SEGREDO]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[SEGREDO]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[SEGREDO]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[SEGREDO]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[SEGREDO]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[SEGREDO]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [SEGREDO]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[SEGREDO]"],
  [/\b(api[_-]?key|token|secret|password|senha)(["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{12,}/gi, "$1$2[SEGREDO]"],
];
const CAMINHO_ABS = /(?:\/(?:Users|home|var\/folders|private|Volumes|opt|root)\/[^\s"'`<>)\]]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s"'`<>)\]]+)/g;

export function redigirSegredos(texto: string, scrub?: (t: string) => string): string {
  let t = texto;
  for (const [re, sub] of PADROES) t = t.replace(re, sub);
  if (scrub !== undefined) { try { t = scrub(t); } catch { /* o scrubber nunca derruba a leitura */ } }
  return t;
}
export function redigirCaminhos(texto: string): string {
  return texto.replace(CAMINHO_ABS, "[CAMINHO]");
}
export const limpar = (texto: string, scrub?: (t: string) => string): string => redigirCaminhos(redigirSegredos(texto, scrub));
