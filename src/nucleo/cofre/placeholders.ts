// Placeholders `{{vault:NOME}}` para consumidores INTERNOS do main (broker): o texto resolvido nunca é exibido nem logado.

const PADRAO = /\{\{vault:([A-Z][A-Z0-9_]{0,63})\}\}/g;

/** Nomes citados no texto, sem repetição. */
export function nomesCitados(texto: string): string[] {
  return [...new Set([...texto.matchAll(PADRAO)].map((m) => m[1] as string))];
}

/** Substitui cada `{{vault:NOME}}` pelo valor devolvido por `obter` (que lança se a entrada não existir/estiver bloqueada). */
export async function resolverPlaceholders(texto: string, obter: (nome: string) => Promise<string>): Promise<string> {
  const nomes = nomesCitados(texto);
  if (nomes.length === 0) return texto;
  const valores = new Map<string, string>();
  for (const n of nomes) valores.set(n, await obter(n));
  return texto.replace(PADRAO, (_m, n: string) => valores.get(n) as string);
}
