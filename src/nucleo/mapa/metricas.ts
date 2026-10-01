import type { Node } from "web-tree-sitter";
import type { Linguagem } from "./tipos";

// Métricas por arquivo (T-17.06): LOC (código/comentário/branco), complexidade ciclomática (McCabe: 1 + nós de
// decisão por função) e detecção de teste/gerado. A tabela de decisão por linguagem é reimplementada a partir
// da definição (a ideia dos tokens do lizard/radon; nenhum código copiado).

export interface Intervalo {
  /** Índice UTF-16 inicial (inclusivo). */
  ini: number;
  /** Índice UTF-16 final (exclusivo). */
  fim: number;
}

export interface Loc {
  loc: number;
  loc_codigo: number;
  loc_comentario: number;
  loc_branco: number;
}

/**
 * Conta linhas. `loc` = total de linhas; branco = só espaço; comentário = linhas cujo conteúdo não-branco está
 * inteiramente dentro de comentários; código = o resto (inclui linha com código e comentário no fim).
 */
export function contarLinhas(texto: string, comentarios: readonly Intervalo[]): Loc {
  if (texto === "") return { loc: 0, loc_codigo: 0, loc_comentario: 0, loc_branco: 0 };
  const ordenados = [...comentarios].sort((a, b) => a.ini - b.ini);
  let ponteiro = 0;
  let total = 0;
  let branco = 0;
  let comentario = 0;
  let inicio = 0;
  const n = texto.length;
  while (inicio < n) {
    let fim = texto.indexOf("\n", inicio);
    const proxima = fim === -1 ? n : fim + 1;
    if (fim === -1) fim = n;
    total++;
    while (ponteiro < ordenados.length && (ordenados[ponteiro] as Intervalo).fim <= inicio) ponteiro++;
    let temCodigo = false;
    let temComentario = false;
    let cursor = inicio;
    for (let k = ponteiro; k < ordenados.length; k++) {
      const c = ordenados[k] as Intervalo;
      if (c.ini >= fim) break;
      temComentario = true;
      if (c.ini > cursor && naoBranco(texto, cursor, Math.min(c.ini, fim))) {
        temCodigo = true;
        break;
      }
      cursor = Math.max(cursor, Math.min(c.fim, fim));
    }
    if (!temCodigo && cursor < fim && naoBranco(texto, cursor, fim)) temCodigo = true;
    if (!temCodigo) {
      if (temComentario) comentario++;
      else branco++;
    }
    inicio = proxima;
  }
  return { loc: total, loc_codigo: total - branco - comentario, loc_comentario: comentario, loc_branco: branco };
}

function naoBranco(texto: string, de: number, ate: number): boolean {
  for (let i = de; i < ate; i++) {
    const c = texto.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 13 && c !== 10 && c !== 12 && c !== 11 && c !== 0xfeff) return true;
  }
  return false;
}

/** Tipos de nó de comentário por linguagem. */
export const NOS_COMENTARIO: Readonly<Record<Linguagem, readonly string[]>> = {
  typescript: ["comment"],
  javascript: ["comment"],
  tsx: ["comment"],
  jsx: ["comment"],
  python: ["comment"],
  java: ["line_comment", "block_comment"],
  php: ["comment"],
  csharp: ["comment"],
  go: ["comment"],
  ruby: ["comment"],
  rust: ["line_comment", "block_comment"],
  c: ["comment"],
  cpp: ["comment"],
  outra: [],
};

export function coletarComentarios(raiz: Node, linguagem: Linguagem): Intervalo[] {
  const tipos = NOS_COMENTARIO[linguagem];
  if (tipos.length === 0) return [];
  return raiz.descendantsOfType(tipos as string[]).map((n) => ({ ini: n.startIndex, fim: n.endIndex }));
}

interface TabelaDecisao {
  /** Cada ocorrência soma 1. */
  nos: ReadonlySet<string>;
  /** Nós binários que só somam se o operador (campo `operator`) estiver em `operadores`. */
  binarios: ReadonlySet<string>;
  operadores: ReadonlySet<string>;
}

const conj = (...x: string[]): ReadonlySet<string> => new Set(x);
const LOGICOS = conj("&&", "||", "??", "and", "or");

const TS_JS: TabelaDecisao = {
  nos: conj("if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement", "catch_clause", "ternary_expression", "switch_case"),
  binarios: conj("binary_expression", "augmented_assignment_expression"),
  operadores: conj("&&", "||", "??", "&&=", "||=", "??="),
};

/** Tabela de nós de decisão por linguagem. Python/Java/TS/JS validados por teste; as demais são a tabela inicial das T-17.09..14. */
export const DECISAO: Readonly<Record<Linguagem, TabelaDecisao>> = {
  typescript: TS_JS,
  javascript: TS_JS,
  tsx: TS_JS,
  jsx: TS_JS,
  python: {
    nos: conj("if_statement", "elif_clause", "for_statement", "while_statement", "except_clause", "conditional_expression", "case_clause", "boolean_operator", "for_in_clause", "if_clause"),
    binarios: conj(),
    operadores: conj(),
  },
  java: {
    nos: conj("if_statement", "for_statement", "enhanced_for_statement", "while_statement", "do_statement", "catch_clause", "ternary_expression", "switch_block_statement_group", "switch_rule"),
    binarios: conj("binary_expression"),
    operadores: LOGICOS,
  },
  php: {
    nos: conj("if_statement", "else_if_clause", "for_statement", "foreach_statement", "while_statement", "do_statement", "catch_clause", "conditional_expression", "case_statement"),
    binarios: conj("binary_expression"),
    operadores: LOGICOS,
  },
  csharp: {
    nos: conj("if_statement", "for_statement", "foreach_statement", "while_statement", "do_statement", "catch_clause", "conditional_expression", "switch_section", "switch_expression_arm"),
    binarios: conj("binary_expression"),
    operadores: LOGICOS,
  },
  go: {
    nos: conj("if_statement", "for_statement", "expression_case", "type_case", "communication_case"),
    binarios: conj("binary_expression"),
    operadores: LOGICOS,
  },
  ruby: {
    nos: conj("if", "elsif", "unless", "while", "until", "for", "when", "rescue", "conditional", "if_modifier", "unless_modifier", "while_modifier", "until_modifier"),
    binarios: conj("binary"),
    operadores: LOGICOS,
  },
  rust: {
    nos: conj("if_expression", "for_expression", "while_expression", "loop_expression", "match_arm", "try_expression"),
    binarios: conj("binary_expression"),
    operadores: LOGICOS,
  },
  c: {
    nos: conj("if_statement", "for_statement", "while_statement", "do_statement", "case_statement", "conditional_expression"),
    binarios: conj("binary_expression"),
    operadores: LOGICOS,
  },
  cpp: {
    nos: conj("if_statement", "for_statement", "for_range_loop", "while_statement", "do_statement", "case_statement", "catch_clause", "conditional_expression"),
    binarios: conj("binary_expression"),
    operadores: LOGICOS,
  },
  outra: { nos: conj(), binarios: conj(), operadores: conj() },
};

/** `true` se o nó soma 1 à complexidade ciclomática. */
export function ehDecisao(linguagem: Linguagem, no: Node): boolean {
  const t = DECISAO[linguagem];
  const tipo = no.type;
  if (t.nos.has(tipo)) return true;
  if (t.binarios.has(tipo)) {
    const op = no.childForFieldName("operator");
    return op !== null && t.operadores.has(op.type);
  }
  return false;
}

/** Complexidade ciclomática de uma subárvore: 1 + nós de decisão. Iterativa (sem recursão profunda). */
export function complexidadeDe(raiz: Node, linguagem: Linguagem): number {
  let total = 1;
  const pilha: Node[] = [raiz];
  for (;;) {
    const no = pilha.pop();
    if (no === undefined) break;
    if (ehDecisao(linguagem, no)) total++;
    for (let i = no.namedChildCount - 1; i >= 0; i--) {
      const filho = no.namedChild(i);
      if (filho !== null) pilha.push(filho);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Teste e gerado

const SEGMENTOS_TESTE = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e", "testing"]);

/** Arquivo de teste por caminho/nome (e cabeçalho, quando informado). */
export function ehArquivoDeTeste(caminho: string, cabecalho = ""): boolean {
  const partes = caminho.replace(/\\/g, "/").split("/");
  const nome = partes[partes.length - 1] ?? "";
  if (partes.slice(0, -1).some((p) => SEGMENTOS_TESTE.has(p.toLowerCase()))) return true;
  if (/\.(test|spec)\.[a-z0-9]+$/i.test(nome)) return true;
  if (/(^test_.+\.py$)|(_test\.(py|go|rb|rs|c|cc|cpp)$)|(_spec\.rb$)/i.test(nome)) return true;
  if (/(Tests?|Spec|IT)\.(java|cs|php|kt)$/.test(nome)) return true;
  return /@(vitest|jest)-environment|\[TestFixture\]|\[TestClass\]/.test(cabecalho);
}

const NOME_GERADO = /(\.min\.[a-z]+$)|(\.generated\.)|(\.g\.cs$)|(\.designer\.cs$)|(_pb2(_grpc)?\.py$)|(\.pb\.go$)|(_generated\.go$)|(\.pb\.[tj]s$)/i;
const CABECALHO_GERADO = /@generated\b|auto-?generated|code generated .{0,80}do not edit|<auto-generated|this file (was|is) (automatically )?generated|generated by (the )?(protoc|swagger|openapi|prisma|graphql)/i;

export function ehArquivoGerado(caminho: string, texto: string): boolean {
  if (NOME_GERADO.test(caminho)) return true;
  return CABECALHO_GERADO.test(texto.slice(0, 1200));
}
