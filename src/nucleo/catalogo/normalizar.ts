// Normalização de nomes do catálogo (T-07.03). Pura.

/** minúsculo, sem `-_ .` e sem espaços, descarta o prefixo `plugin:`. Dois-pontos internos (nomes de hook `Evento:script`) são mantidos. */
export function normalizarNome(s: string): string {
  let t = s.normalize("NFKC").toLowerCase().trim();
  if (t.startsWith("plugin:")) t = t.slice("plugin:".length);
  return t.replace(/[-_.\s]+/g, "");
}

const RE_NOME_VALIDO = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Nome seguro para virar caminho/política (sem `/`, `..`, maiúsculas). */
export function nomeValido(s: string): boolean {
  return typeof s === "string" && RE_NOME_VALIDO.test(s) && !s.includes("..");
}
