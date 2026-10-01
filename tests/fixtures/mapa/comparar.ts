import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Extracao } from "../../../src/nucleo/mapa/tipos";

// Gabarito `esperado.json` de cada linguagem (fixtures em tests/fixtures/mapa/<linguagem>/).
// Cada item esperado é um SUBCONJUNTO: todos os campos informados precisam bater com algum elemento da extração.
// `ausentes` lista armadilhas: nenhum elemento da extração pode casar com o item.

export const RAIZ_FIXTURES_MAPA = resolve(__dirname);

export interface GabaritoArquivo {
  metricas?: Partial<Pick<Extracao, "complexidade_max" | "complexidade_total" | "erros_parse" | "e_teste" | "e_gerado" | "loc" | "loc_codigo" | "loc_comentario">>;
  simbolos?: Array<Record<string, unknown>>;
  imports?: Array<Record<string, unknown>>;
  chamadas?: Array<Record<string, unknown>>;
  herancas?: Array<Record<string, unknown>>;
  entradas?: Array<Record<string, unknown>>;
  dados?: Array<Record<string, unknown>>;
  padroes?: Array<Record<string, unknown>>;
  dinamicos?: Array<Record<string, unknown>>;
  ausentes?: Record<string, Array<Record<string, unknown>>>;
}

export interface Gabarito {
  linguagem: string;
  arquivos: Record<string, GabaritoArquivo>;
}

export function carregarGabarito(linguagem: string): Gabarito {
  return JSON.parse(readFileSync(join(RAIZ_FIXTURES_MAPA, linguagem, "esperado.json"), "utf8")) as Gabarito;
}

export function lerFixture(linguagem: string, caminho: string): string {
  return readFileSync(join(RAIZ_FIXTURES_MAPA, linguagem, caminho), "utf8");
}

function nomesImport(e: unknown): string[] {
  return (e as Array<{ nome: string; alias: string | null }>).map((n) => (n.alias === null ? n.nome : `${n.nome}=${n.alias}`));
}

function casa(real: Record<string, unknown>, esperado: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(esperado)) {
    const r = k === "nomes" ? nomesImport(real[k]) : real[k];
    if (JSON.stringify(r) !== JSON.stringify(v)) return false;
  }
  return true;
}

const CATEGORIAS = ["simbolos", "imports", "chamadas", "herancas", "entradas", "dados", "padroes", "dinamicos"] as const;

/** Devolve as divergências (lista vazia = 100% do gabarito). */
export function compararComGabarito(extracao: Extracao, gab: GabaritoArquivo): string[] {
  const erros: string[] = [];
  for (const [k, v] of Object.entries(gab.metricas ?? {})) {
    const real = (extracao as unknown as Record<string, unknown>)[k];
    if (real !== v) erros.push(`métrica ${k}: esperado ${String(v)}, obtido ${String(real)}`);
  }
  for (const cat of CATEGORIAS) {
    const reais = extracao[cat] as unknown as Array<Record<string, unknown>>;
    for (const esp of gab[cat] ?? []) if (!reais.some((r) => casa(r, esp))) erros.push(`${cat}: faltou ${JSON.stringify(esp)}`);
    for (const esp of gab.ausentes?.[cat] ?? []) {
      const achou = reais.find((r) => casa(r, esp));
      if (achou !== undefined) erros.push(`${cat}: armadilha ${JSON.stringify(esp)} casou com ${JSON.stringify(achou)}`);
    }
  }
  return erros;
}
