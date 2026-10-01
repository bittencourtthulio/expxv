import { SufixoEsgotadoErro } from "./erros";

export const SLUG_MAX = 60;

/** Minúsculas, sem acento, hifens no lugar de tudo que não é [a-z0-9], no máximo `max` (60) caracteres. */
export function slugificar(texto: string, max: number = SLUG_MAX): string {
  const s = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s === "" ? "trabalho" : s;
}

/**
 * Primeiro slug livre: `base`, `base-2`, `base-3`… (o sufixo cabe dentro do limite de 60 cortando a
 * base). `ocupado` decide o que já existe (caminho de worktree, branch…).
 */
export async function slugLivre(base: string, ocupado: (slug: string) => boolean | Promise<boolean>, max: number = SLUG_MAX): Promise<string> {
  const limpo = slugificar(base, max);
  for (let n = 1; n <= 1000; n++) {
    const sufixo = n === 1 ? "" : `-${n}`;
    const candidato = limpo.slice(0, max - sufixo.length).replace(/-+$/g, "") + sufixo;
    if (!(await ocupado(candidato))) return candidato;
  }
  throw new SufixoEsgotadoErro(base);
}
