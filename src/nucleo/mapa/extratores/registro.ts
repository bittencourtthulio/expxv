import { obterParser, type OpcoesRuntime } from "../gramaticas";
import { hashConteudo } from "../hash";
import { coletarComentarios, contarLinhas, ehArquivoDeTeste, ehArquivoGerado } from "../metricas";
import { VERSAO_EXTRATOR, type Extracao, type Linguagem } from "../tipos";
import { ErroExtracao, type Extrator } from "./comum";

// Despacho de extratores por linguagem (T-17.06). Carga LAZY: cada extrator só é importado quando a linguagem
// aparece, e os arquivos de extratores são disjuntos (nenhum depende de outro).

async function carregarExtrator(linguagem: Linguagem): Promise<Extrator> {
  switch (linguagem) {
    case "typescript":
    case "javascript":
    case "tsx":
    case "jsx":
      return (await import("./typescript")).extratorTypescript;
    case "python":
      return (await import("./python")).extratorPython;
    case "java":
      return (await import("./java")).extratorJava;
    case "php":
      return (await import("./php")).extratorPhp;
    case "csharp":
      return (await import("./csharp")).extratorCsharp;
    case "go":
      return (await import("./go")).extratorGo;
    case "rust":
      return (await import("./rust")).extratorRust;
    case "ruby":
      return (await import("./ruby")).extratorRuby;
    case "c":
    case "cpp":
      return (await import("./cpp")).extratorCpp;
    case "outra":
      return (await import("./generico")).extratorGenerico;
  }
}

const cacheExtratores = new Map<Linguagem, Promise<Extrator>>();

export function obterExtrator(linguagem: Linguagem): Promise<Extrator> {
  let p = cacheExtratores.get(linguagem);
  if (p === undefined) {
    p = carregarExtrator(linguagem);
    cacheExtratores.set(linguagem, p);
  }
  return p;
}

export interface OpcoesExtracao {
  /** Hash já calculado pelo chamador (worker/varredura). Sem ele, calcula do texto. */
  hash?: string;
  runtime?: OpcoesRuntime;
}

/**
 * Extrai o mapa de UM arquivo: parseia, roda o extrator da linguagem e acrescenta LOC, complexidade, `e_teste`
 * e `e_gerado`. Arquivo com erros de sintaxe devolve `erros_parse > 0` sem lançar. Lança `ErroExtracao` só para
 * linguagem sem gramática/extrator.
 */
export async function extrairArquivo(texto: string, linguagem: Linguagem, caminho: string, opcoes: OpcoesExtracao = {}): Promise<Extracao> {
  const extrator = await obterExtrator(linguagem);
  const parser = await obterParser(linguagem, opcoes.runtime);
  if (parser === null) throw new ErroExtracao("sem_gramatica", linguagem);
  const arvore = parser.parse(texto);
  if (arvore === null) throw new ErroExtracao("parse_falhou", caminho);
  try {
    const raiz = arvore.rootNode;
    const r = extrator.extrair({ texto, linguagem, caminho, arvore, raiz });
    const comentarios = coletarComentarios(raiz, linguagem);
    const loc = contarLinhas(texto, comentarios);
    const funcoes = r.simbolos.filter((s) => s.tipo === "funcao" || s.tipo === "metodo");
    const complexidadeTotal = funcoes.reduce((a, s) => a + s.complexidade, 0) + r.decisoes_topo;
    const complexidadeMax = funcoes.reduce((a, s) => Math.max(a, s.complexidade), 0);
    return {
      versao_extrator: VERSAO_EXTRATOR,
      linguagem,
      hash: opcoes.hash ?? hashConteudo(Buffer.from(texto, "utf8")),
      loc: loc.loc,
      loc_codigo: loc.loc_codigo,
      loc_comentario: loc.loc_comentario,
      complexidade_total: complexidadeTotal,
      complexidade_max: complexidadeMax,
      erros_parse: r.erros_parse,
      e_teste: ehArquivoDeTeste(caminho, texto.slice(0, 600)),
      e_gerado: ehArquivoGerado(caminho, texto),
      truncado: r.truncado,
      simbolos: r.simbolos,
      imports: r.imports,
      chamadas: r.chamadas,
      herancas: r.herancas,
      entradas: r.entradas,
      dados: r.dados,
      padroes: r.padroes,
      dinamicos: r.dinamicos,
    };
  } finally {
    arvore.delete();
  }
}
