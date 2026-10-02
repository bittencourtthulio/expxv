import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VERSAO_EXTRATOR, type Extracao, type SimboloBruto } from "../../../src/nucleo/mapa/tipos";

// Geradores determinísticos para os testes e para os orçamentos (padrão de tests/fixtures/metodo/gerar.ts).
// Nada de aleatoriedade real: a "semente" é só o índice do arquivo.

const PASTAS = 50;

export function caminhoSintetico(i: number): string {
  return `m${i % PASTAS}/f${i}.ts`;
}

/** Texto TypeScript sintético (≈ 6 KB) com imports para arquivos anteriores, classe, funções, SQL e throw. */
export function textoSintetico(i: number): string {
  const imports: string[] = [];
  for (const passo of [1, 7, 31]) {
    const j = i - passo;
    if (j >= 0) imports.push(`import { f${j}_0 } from "../${caminhoSintetico(j).replace(/\.ts$/, "")}";`);
  }
  const funcoes: string[] = [];
  for (let k = 0; k < 10; k++) {
    const alvo = i >= 1 ? `f${i - 1}_0` : "Math.abs";
    funcoes.push(
      [
        `/** Funcao ${k} do modulo ${i}: calcula o valor ajustado. */`,
        `export function f${i}_${k}(valor: number, modo: string = "padrao", limite = ${k + 3}): number {`,
        `  if (valor > limite && modo !== "x") {`,
        `    return ${alvo}(valor - 1) + ${k};`,
        `  } else if (valor < 0 || modo === "neg") {`,
        `    throw new Error("valor invalido");`,
        `  }`,
        `  for (let n = 0; n < limite; n++) {`,
        `    if (n % 2 === 0) { valor += n; } else { valor -= 1; }`,
        `  }`,
        `  return valor > 100 ? 100 : valor;`,
        `}`,
      ].join("\n"),
    );
  }
  return [
    ...imports,
    "",
    `export interface Dado${i} { id: number; nome: string; ativo: boolean }`,
    "",
    `/** Servico do modulo ${i}. */`,
    `export class Servico${i} {`,
    `  consultar(db: any, id: number): Promise<unknown> {`,
    `    return db.query("SELECT id, nome FROM tabela${i % 100} WHERE id = ?", [id]);`,
    `  }`,
    `  gravar(db: any): void {`,
    `    db.query("INSERT INTO log_${i % 20} (a, b) VALUES (?, ?)");`,
    `    f${i}_0(1);`,
    `  }`,
    `}`,
    "",
    ...funcoes,
    "",
  ].join("\n");
}

/** Escreve `n` arquivos TypeScript sintéticos sob `raiz` e devolve os caminhos relativos. */
export function gerarProjetoTs(raiz: string, n: number): string[] {
  const caminhos: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = caminhoSintetico(i);
    const abs = join(raiz, c);
    if (i < PASTAS) mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, textoSintetico(i));
    caminhos.push(c);
  }
  return caminhos;
}

/** `Extracao` sintética com tamanho realista (≈ 25 símbolos, 4 imports, 20 chamadas), sem passar pelo parser. */
export function extracaoSintetica(i: number, hash = `h${i}`): Extracao {
  const simbolos: SimboloBruto[] = Array.from({ length: 12 }, (_, k): SimboloBruto => ({
    nome: `f${i}_${k}`,
    qualificado: `f${i}_${k}`,
    tipo: "funcao",
    linha: 10 + k * 12,
    linha_fim: 20 + k * 12,
    exportado: true,
    visibilidade: null,
    complexidade: 3 + (k % 4),
    assinatura: `function f${i}_${k}(valor: number, modo: string = "…", limite = ${k + 3}): number`,
    doc: `Funcao ${k} do modulo ${i}: calcula o valor ajustado.`,
    decoradores: [],
  }));
  simbolos.push({ nome: `Servico${i}`, qualificado: `Servico${i}`, tipo: "funcao" as const, linha: 3, linha_fim: 9, exportado: true, visibilidade: null, complexidade: 1, assinatura: `class Servico${i}`, doc: null, decoradores: [] });
  return {
    versao_extrator: VERSAO_EXTRATOR,
    linguagem: "typescript",
    hash,
    loc: 160,
    loc_codigo: 130,
    loc_comentario: 10,
    complexidade_total: 40,
    complexidade_max: 6,
    erros_parse: 0,
    e_teste: false,
    e_gerado: false,
    truncado: false,
    simbolos,
    imports: [1, 7, 31].filter((p) => i - p >= 0).map((p) => ({ especificador: `../m${(i - p) % PASTAS}/f${i - p}`, tipo: "estatico" as const, linha: 1, so_tipo: false, nomes: [{ nome: `f${i - p}_0`, alias: null }] })),
    chamadas: Array.from({ length: 20 }, (_, k) => ({ de: `f${i}_${k % 12}`, alvo: k % 3 === 0 && i > 0 ? `f${i - 1}_0` : `f${i}_${(k + 1) % 12}`, receptor: null, tipo: "chamada" as const, linha: 12 + k })),
    herancas: [],
    entradas: i % 25 === 0 ? [{ tipo: "rota" as const, chave: `GET /r${i}`, framework: "express", handler: `f${i}_0`, linha: 5, confianca: "exata" as const }] : [],
    dados: [{ tabela: `tabela${i % 100}`, operacao: "le" as const, de: `Servico${i}`, linha: 5, confianca: "exata" as const, fonte: "sql" }],
    padroes: [{ tipo: "throw", nome: null, linha: 15 }],
    dinamicos: [],
  };
}
