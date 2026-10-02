// Apoio de testes do Bichinho: leitor de projeto sobre um objeto { caminho: conteúdo } (sem disco).
import type { LeitorProjeto } from "./sinais";

export function leitorDeObjeto(arquivos: Record<string, string>): LeitorProjeto {
  const caminhos = Object.keys(arquivos);
  return {
    ler: (rel) => arquivos[rel] ?? null,
    existe: (rel) => caminhos.some((c) => c === rel || c.startsWith(`${rel}/`)),
    listar: (rel) => {
      const prefixo = rel === "" ? "" : `${rel}/`;
      const nomes = new Set<string>();
      for (const c of caminhos) if (c.startsWith(prefixo)) nomes.add(c.slice(prefixo.length).split("/")[0]!);
      return [...nomes];
    },
  };
}

/** `n` arquivos vazios com a extensão, em `pasta` (para dar peso de linguagem). */
export function muitos(pasta: string, ext: string, n: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`${pasta === "" ? "" : `${pasta}/`}arq${i}.${ext}`, ""]));
}
