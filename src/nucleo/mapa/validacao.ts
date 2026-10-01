import {
  CONFIANCAS,
  LINGUAGENS,
  OPERACOES_DADO,
  SUBTIPOS_ENTRADA,
  SUBTIPOS_SIMBOLO,
  TIPOS_CHAMADA,
  TIPOS_DINAMICO,
  TIPOS_IMPORT,
  TIPOS_PADRAO,
  VISIBILIDADES,
  type Extracao,
} from "./tipos";

// Validação campo a campo de `Extracao` (T-17.01). Rejeita JSON malformado, tipo errado, linha negativa e
// listas acima do teto. O armazém valida antes de gravar e ao ler de volta (a coluna `extracao.json` é entrada
// não confiável para quem a lê: pode ter vindo de uma versão antiga ou de um arquivo corrompido).

export const LIMITES_EXTRACAO = {
  simbolos: 5_000,
  imports: 10_000,
  chamadas: 50_000,
  herancas: 5_000,
  entradas: 5_000,
  dados: 10_000,
  padroes: 20_000,
  dinamicos: 5_000,
  nomes_por_import: 2_000,
  decoradores: 50,
  shingles: 100_000,
  texto: 2_000,
} as const;

export class ErroExtracaoInvalida extends Error {
  constructor(
    readonly campo: string,
    motivo: string,
  ) {
    super(`extração inválida em ${campo}: ${motivo}`);
    this.name = "ErroExtracaoInvalida";
  }
}

type Obj = Record<string, unknown>;

function ehObjeto(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function inteiro(v: unknown, campo: string, minimo = 0): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new ErroExtracaoInvalida(campo, "esperado inteiro");
  if (v < minimo) throw new ErroExtracaoInvalida(campo, `esperado >= ${minimo}`);
  return v;
}
function texto(v: unknown, campo: string, max: number = LIMITES_EXTRACAO.texto): string {
  if (typeof v !== "string") throw new ErroExtracaoInvalida(campo, "esperado texto");
  if (v.length > max) throw new ErroExtracaoInvalida(campo, `texto acima de ${max} caracteres`);
  return v;
}
function textoOuNulo(v: unknown, campo: string, max?: number): string | null {
  return v === null ? null : texto(v, campo, max);
}
function booleano(v: unknown, campo: string): boolean {
  if (typeof v !== "boolean") throw new ErroExtracaoInvalida(campo, "esperado booleano");
  return v;
}
function enumerado<T extends string>(v: unknown, campo: string, validos: readonly T[]): T {
  if (typeof v !== "string" || !(validos as readonly string[]).includes(v)) throw new ErroExtracaoInvalida(campo, `valor fora de ${validos.join("|")}`);
  return v as T;
}
function lista(v: unknown, campo: string, teto: number): unknown[] {
  if (!Array.isArray(v)) throw new ErroExtracaoInvalida(campo, "esperada lista");
  if (v.length > teto) throw new ErroExtracaoInvalida(campo, `lista acima do teto de ${teto}`);
  return v;
}
function objeto(v: unknown, campo: string): Obj {
  if (!ehObjeto(v)) throw new ErroExtracaoInvalida(campo, "esperado objeto");
  return v;
}

/**
 * Valida e devolve a extração (cópia normalizada: campos desconhecidos são descartados).
 * Aceita o objeto ou o texto JSON. Lança `ErroExtracaoInvalida`.
 */
export function validarExtracao(entrada: unknown): Extracao {
  let bruto = entrada;
  if (typeof entrada === "string") {
    try {
      bruto = JSON.parse(entrada);
    } catch {
      throw new ErroExtracaoInvalida("json", "JSON malformado");
    }
  }
  const e = objeto(bruto, "extracao");
  const saida: Extracao = {
    versao_extrator: inteiro(e.versao_extrator, "versao_extrator", 1),
    linguagem: enumerado(e.linguagem, "linguagem", LINGUAGENS),
    hash: texto(e.hash, "hash", 128),
    loc: inteiro(e.loc, "loc"),
    loc_codigo: inteiro(e.loc_codigo, "loc_codigo"),
    loc_comentario: inteiro(e.loc_comentario, "loc_comentario"),
    complexidade_total: inteiro(e.complexidade_total, "complexidade_total"),
    complexidade_max: inteiro(e.complexidade_max, "complexidade_max"),
    erros_parse: inteiro(e.erros_parse, "erros_parse"),
    e_teste: booleano(e.e_teste, "e_teste"),
    e_gerado: booleano(e.e_gerado, "e_gerado"),
    truncado: e.truncado === undefined ? false : booleano(e.truncado, "truncado"),
    simbolos: lista(e.simbolos, "simbolos", LIMITES_EXTRACAO.simbolos).map((s, i) => {
      const c = `simbolos[${i}]`;
      const o = objeto(s, c);
      const linha = inteiro(o.linha, `${c}.linha`, 1);
      return {
        nome: texto(o.nome, `${c}.nome`, 400),
        qualificado: texto(o.qualificado, `${c}.qualificado`, 800),
        tipo: enumerado(o.tipo, `${c}.tipo`, SUBTIPOS_SIMBOLO),
        linha,
        linha_fim: inteiro(o.linha_fim, `${c}.linha_fim`, linha),
        exportado: booleano(o.exportado, `${c}.exportado`),
        visibilidade: o.visibilidade === null ? null : enumerado(o.visibilidade, `${c}.visibilidade`, VISIBILIDADES),
        complexidade: inteiro(o.complexidade, `${c}.complexidade`, 0),
        assinatura: texto(o.assinatura, `${c}.assinatura`, 400),
        doc: textoOuNulo(o.doc, `${c}.doc`, 200),
        decoradores: lista(o.decoradores, `${c}.decoradores`, LIMITES_EXTRACAO.decoradores).map((d, j) => texto(d, `${c}.decoradores[${j}]`, 200)),
      };
    }),
    imports: lista(e.imports, "imports", LIMITES_EXTRACAO.imports).map((s, i) => {
      const c = `imports[${i}]`;
      const o = objeto(s, c);
      return {
        especificador: texto(o.especificador, `${c}.especificador`, 1000),
        tipo: enumerado(o.tipo, `${c}.tipo`, TIPOS_IMPORT),
        linha: inteiro(o.linha, `${c}.linha`, 1),
        so_tipo: booleano(o.so_tipo, `${c}.so_tipo`),
        nomes: lista(o.nomes, `${c}.nomes`, LIMITES_EXTRACAO.nomes_por_import).map((n, j) => {
          const on = objeto(n, `${c}.nomes[${j}]`);
          return { nome: texto(on.nome, `${c}.nomes[${j}].nome`, 400), alias: textoOuNulo(on.alias, `${c}.nomes[${j}].alias`, 400) };
        }),
      };
    }),
    chamadas: lista(e.chamadas, "chamadas", LIMITES_EXTRACAO.chamadas).map((s, i) => {
      const c = `chamadas[${i}]`;
      const o = objeto(s, c);
      return {
        de: textoOuNulo(o.de, `${c}.de`, 800),
        alvo: texto(o.alvo, `${c}.alvo`, 400),
        receptor: textoOuNulo(o.receptor, `${c}.receptor`, 400),
        tipo: enumerado(o.tipo, `${c}.tipo`, TIPOS_CHAMADA),
        linha: inteiro(o.linha, `${c}.linha`, 1),
      };
    }),
    herancas: lista(e.herancas, "herancas", LIMITES_EXTRACAO.herancas).map((s, i) => {
      const c = `herancas[${i}]`;
      const o = objeto(s, c);
      return { classe: texto(o.classe, `${c}.classe`, 800), base: texto(o.base, `${c}.base`, 400), tipo: enumerado(o.tipo, `${c}.tipo`, ["herda", "implementa"] as const), linha: inteiro(o.linha, `${c}.linha`, 1) };
    }),
    entradas: lista(e.entradas, "entradas", LIMITES_EXTRACAO.entradas).map((s, i) => {
      const c = `entradas[${i}]`;
      const o = objeto(s, c);
      return {
        tipo: enumerado(o.tipo, `${c}.tipo`, SUBTIPOS_ENTRADA),
        chave: texto(o.chave, `${c}.chave`, 600),
        framework: texto(o.framework, `${c}.framework`, 80),
        handler: textoOuNulo(o.handler, `${c}.handler`, 800),
        linha: inteiro(o.linha, `${c}.linha`, 1),
        confianca: enumerado(o.confianca, `${c}.confianca`, CONFIANCAS),
      };
    }),
    dados: lista(e.dados, "dados", LIMITES_EXTRACAO.dados).map((s, i) => {
      const c = `dados[${i}]`;
      const o = objeto(s, c);
      return {
        tabela: texto(o.tabela, `${c}.tabela`, 200),
        operacao: enumerado(o.operacao, `${c}.operacao`, OPERACOES_DADO),
        de: textoOuNulo(o.de, `${c}.de`, 800),
        linha: inteiro(o.linha, `${c}.linha`, 1),
        confianca: enumerado(o.confianca, `${c}.confianca`, CONFIANCAS),
        fonte: texto(o.fonte, `${c}.fonte`, 40),
      };
    }),
    padroes: lista(e.padroes, "padroes", LIMITES_EXTRACAO.padroes).map((s, i) => {
      const c = `padroes[${i}]`;
      const o = objeto(s, c);
      return { tipo: enumerado(o.tipo, `${c}.tipo`, TIPOS_PADRAO), nome: textoOuNulo(o.nome, `${c}.nome`, 200), linha: inteiro(o.linha, `${c}.linha`, 1) };
    }),
    dinamicos: lista(e.dinamicos, "dinamicos", LIMITES_EXTRACAO.dinamicos).map((s, i) => {
      const c = `dinamicos[${i}]`;
      const o = objeto(s, c);
      return { tipo: enumerado(o.tipo, `${c}.tipo`, TIPOS_DINAMICO), linha: inteiro(o.linha, `${c}.linha`, 1) };
    }),
  };
  if (e.shingles !== undefined) {
    saida.shingles = lista(e.shingles, "shingles", LIMITES_EXTRACAO.shingles).map((p, i) => {
      if (!Array.isArray(p) || p.length !== 2) throw new ErroExtracaoInvalida(`shingles[${i}]`, "esperado par");
      return [inteiro(p[0], `shingles[${i}][0]`), inteiro(p[1], `shingles[${i}][1]`)] as [number, number];
    });
  }
  return saida;
}
