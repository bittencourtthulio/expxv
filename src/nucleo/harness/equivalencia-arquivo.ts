// Leitura do arquivo versionado `resources/harness/equivalencia.json` (única parte com I/O da equivalência).
// A validação e a consulta são puras e vivem em `equivalencia.ts`.
import { readFileSync } from "node:fs";
import { carregarEquivalenciaPadrao, type PadraoCarregado } from "./equivalencia";

/** Lê o arquivo em `caminho`; ausente/ilegível/corrompido ⇒ tabela mínima embutida + aviso (nunca lança). */
export function lerEquivalenciaDeArquivo(caminho: string): PadraoCarregado {
  let texto: string | null = null;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch {
    texto = null;
  }
  return carregarEquivalenciaPadrao(texto);
}
