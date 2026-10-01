import type { Node, Tree } from "web-tree-sitter";
import type { AcessoDadoBruto, ChamadaBruta, DinamicoBruto, EntradaBruta, HerancaBruta, ImportBruto, Linguagem, PadraoBruto, SimboloBruto } from "../tipos";

// Contrato dos extratores por linguagem (T-17.06). Nenhum extrator depende de outro; cada um vive em seu arquivo
// e é carregado sob demanda por `registro.ts`.

export interface ContextoExtracao {
  texto: string;
  linguagem: Linguagem;
  /** Caminho relativo à raiz do workspace, normalizado com `/`. */
  caminho: string;
  arvore: Tree;
  raiz: Node;
}

export interface ResultadoExtrator {
  simbolos: SimboloBruto[];
  imports: ImportBruto[];
  chamadas: ChamadaBruta[];
  herancas: HerancaBruta[];
  entradas: EntradaBruta[];
  dados: AcessoDadoBruto[];
  padroes: PadraoBruto[];
  dinamicos: DinamicoBruto[];
  /** Nós `ERROR`/`MISSING` encontrados. */
  erros_parse: number;
  /** Decisões fora de qualquer função (somam à complexidade total do arquivo). */
  decisoes_topo: number;
  truncado: boolean;
}

export interface Extrator {
  /** Mudar o comportamento de qualquer extrator exige subir `VERSAO_EXTRATOR` (tipos.ts): invalida as extrações antigas. */
  extrair(ctx: ContextoExtracao): ResultadoExtrator;
}

export type CodigoErroExtracao = "nao_implementado" | "sem_gramatica" | "parse_falhou" | "arquivo_sensivel" | "arquivo_ilegivel";

export class ErroExtracao extends Error {
  constructor(
    readonly codigo: CodigoErroExtracao,
    detalhe = "",
  ) {
    super(detalhe === "" ? codigo : `${codigo}: ${detalhe}`);
    this.name = "ErroExtracao";
  }
}

/** Teto de símbolos por arquivo (T-17.06). */
export const MAX_SIMBOLOS = 5_000;

export function resultadoVazio(): ResultadoExtrator {
  return { simbolos: [], imports: [], chamadas: [], herancas: [], entradas: [], dados: [], padroes: [], dinamicos: [], erros_parse: 0, decisoes_topo: 0, truncado: false };
}

/** Garante nomes qualificados únicos dentro do arquivo: a duplicata ganha `~2`, `~3`… */
export class NomesUnicos {
  private readonly vistos = new Map<string, number>();
  unico(qualificado: string): string {
    const n = (this.vistos.get(qualificado) ?? 0) + 1;
    this.vistos.set(qualificado, n);
    return n === 1 ? qualificado : `${qualificado}~${n}`;
  }
}

/** Texto de um intervalo do fonte. */
export function trecho(texto: string, no: Node): string {
  return texto.slice(no.startIndex, no.endIndex);
}

export function linhaIni(no: Node): number {
  return no.startPosition.row + 1;
}

export function linhaFim(no: Node): number {
  return no.endPosition.row + 1;
}
