// Leitura do arquivo editável `resources/squads/esforco-por-cli.json` (única parte com I/O do esforço).
import { readFileSync } from "node:fs";
import { carregarTabelaEsforco, type TabelaEsforco } from "./esforco";

export function lerTabelaEsforcoDeArquivo(caminho: string): { tabela: TabelaEsforco; avisos: string[] } {
  let texto: string | null = null;
  try { texto = readFileSync(caminho, "utf8"); } catch { texto = null; }
  return carregarTabelaEsforco(texto);
}
