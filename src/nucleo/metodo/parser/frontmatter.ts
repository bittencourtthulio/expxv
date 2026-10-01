import { parse } from "yaml";

export type MotivoFrontmatter = "ok" | "sem_frontmatter" | "yaml_invalido" | "truncado";

export interface ResultadoFrontmatter {
  dados: Record<string, unknown> | null;
  corpo: string;
  motivo: MotivoFrontmatter;
}

export function removerBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/**
 * Separa o frontmatter YAML do corpo. Tolera BOM, CRLF e chave extra. Nunca lança: YAML
 * truncado (arquivo gravado pela metade) ou inválido devolve `dados: null` com o motivo, e o
 * chamador espera o próximo evento do observador (D-18).
 */
export function extrairFrontmatter(entrada: string): ResultadoFrontmatter {
  if (typeof entrada !== "string") return { dados: null, corpo: "", motivo: "sem_frontmatter" };
  const texto = removerBom(entrada).replace(/\r\n?/g, "\n");
  if (!/^---[ \t]*(\n|$)/.test(texto)) return { dados: null, corpo: texto, motivo: "sem_frontmatter" };

  const aposAbertura = texto.indexOf("\n") + 1;
  if (aposAbertura === 0) return { dados: null, corpo: "", motivo: "truncado" };
  const resto = texto.slice(aposAbertura);
  // o fechamento é o primeiro `---` sozinho em uma linha (um segundo bloco no corpo não conta)
  const fechamento = /^---[ \t]*$/m.exec(resto);
  if (!fechamento) return { dados: null, corpo: "", motivo: "truncado" };

  const yamlTexto = resto.slice(0, fechamento.index);
  let corpo = resto.slice(fechamento.index + fechamento[0].length);
  if (corpo.startsWith("\n")) corpo = corpo.slice(1);

  try {
    const valor: unknown = yamlTexto.trim() === "" ? {} : parse(yamlTexto, { maxAliasCount: 100 });
    if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
      return { dados: null, corpo, motivo: "yaml_invalido" };
    }
    return { dados: valor as Record<string, unknown>, corpo, motivo: "ok" };
  } catch {
    return { dados: null, corpo, motivo: "yaml_invalido" };
  }
}
