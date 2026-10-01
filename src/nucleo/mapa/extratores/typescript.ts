import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { AcessoDadoBruto, Confianca, EntradaBruta, ImportBruto, NomeImportado, OperacaoDado, SimboloBruto, SubtipoEntrada, Visibilidade } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator TypeScript/JavaScript/TSX/JSX (T-17.07). Percurso único da árvore Tree-sitter, sem executar nada.
// Extrai imports/exports, símbolos, chamadas candidatas, herança, entradas (rotas e afins), acesso a dados,
// pontos dinâmicos e padrões, com confiança por aresta (`exata` quando há prova sintática local; `heuristica`
// quando só o nome/convenção sugere). O mapa guarda nomes e posições; nunca o código.

const VERBOS_HTTP = new Set(["get", "post", "put", "patch", "delete", "del", "options", "head", "all"]);
const NOME_ROTEADOR = /^(app|router|server|api|routes?|fastify|\w*Router|\w*App)$/;
const FABRICAS_ROTEADOR: Readonly<Record<string, string>> = {
  express: "express",
  Router: "express",
  "express.Router": "express",
  fastify: "fastify",
  Fastify: "fastify",
  Koa: "koa",
  KoaRouter: "koa",
  Hono: "hono",
};
const NEST_VERBOS: Readonly<Record<string, string>> = { Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE", Options: "OPTIONS", Head: "HEAD", All: "ALL" };
const PRISMA_LEITURA = new Set(["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const PRISMA_ESCRITA = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
/** `receptor` de uma chamada cujo objeto é uma expressão não simples (`a().b()`): o tipo do receptor é desconhecido. */
export const RECEPTOR_EXPRESSAO = "?";
const VALORES_LITERAIS = new Set(["string", "number", "true", "false", "null", "template_string", "regex", "array", "object", "unary_expression", "as_expression", "satisfies_expression"]);
function ehValorLiteral(valor: Node): boolean {
  return VALORES_LITERAIS.has(valor.type);
}
const MODULOS_CLI = ["commander", "yargs", "cac", "clipanion"];
const MODULOS_CRON = ["node-cron", "cron", "node-schedule", "croner"];
const VERBOS_NEXT = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

interface ClasseCtx {
  qualificado: string;
  exportada: boolean;
  controller: boolean;
  prefixoRota: string;
}

interface Quadro {
  /** Símbolo contenedor (`de` das chamadas); `null` = topo do arquivo. */
  de: string | null;
  /** Prefixo dos nomes qualificados de novos símbolos. */
  prefixo: string;
  classe: ClasseCtx | null;
  contador: { n: number };
  dentroFuncao: boolean;
}

interface InfoDecorador {
  nome: string;
  texto: string;
  argTexto: string | null;
  arg0: Node | null;
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private readonly roteadores = new Map<string, string>();
  private readonly modulos = new Set<string>();
  private readonly exportadosLocais = new Set<string>();
  private temDefault = false;

  constructor(private readonly ctx: ContextoExtracao) {}

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    const quadro: Quadro = { de: null, prefixo: "", classe: null, contador: this.topo, dentroFuncao: false };
    // 1ª passada: imports (para saber quais módulos o arquivo usa antes de classificar chamadas)
    for (let i = 0; i < raiz.namedChildCount; i++) {
      const f = raiz.namedChild(i);
      if (f !== null && f.type === "import_statement") this.tratarImport(f);
    }
    this.visitarFilhos(raiz, quadro);
    this.finalizar();
    this.r.decisoes_topo = this.topo.n;
    this.r.erros_parse = raiz.hasError ? this.contarErros(raiz) : 0;
    return this.r;
  }

  // ---------------------------------------------------------------------------------------------
  // utilidades

  private texto(no: Node): string {
    return trecho(this.ctx.texto, no);
  }

  private empurrar<T>(lista: T[], item: T, limite: number): void {
    if (lista.length >= limite) this.r.truncado = true;
    else lista.push(item);
  }

  private contarErros(raiz: Node): number {
    let n = 0;
    const pilha: Node[] = [raiz];
    for (;;) {
      const no = pilha.pop();
      if (no === undefined) break;
      if (!no.hasError && !no.isMissing) continue;
      if (no.isError || no.isMissing) n++;
      for (let i = 0; i < no.childCount; i++) {
        const f = no.child(i);
        if (f !== null) pilha.push(f);
      }
    }
    return n;
  }

  private valorString(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "string") return this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    if (no.type === "template_string") {
      const t = this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
      return t.includes("${") ? null : t;
    }
    return null;
  }

  private receptorTexto(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "identifier":
      case "this":
      case "super":
        return this.texto(no);
      case "member_expression": {
        const o = this.receptorTexto(no.childForFieldName("object"));
        const p = no.childForFieldName("property");
        if (o === null || p === null) return null;
        const t = `${o}.${this.texto(p)}`;
        return t.length > 120 ? null : t;
      }
      default:
        return null;
    }
  }

  private nomeBase(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "identifier":
      case "type_identifier":
      case "member_expression":
      case "nested_type_identifier": {
        const t = this.texto(no);
        return t.length > 200 ? null : t;
      }
      case "generic_type":
        return this.nomeBase(no.childForFieldName("name"));
      case "call_expression":
        return this.nomeBase(no.childForFieldName("function"));
      default:
        return null;
    }
  }

  private nomeHandler(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "identifier" || no.type === "member_expression") {
      const t = this.texto(no);
      return t.length > 120 ? null : t;
    }
    return null;
  }

  private doc(no: Node): string | null {
    const partes: string[] = [];
    let linhaAlvo = no.startPosition.row;
    for (let p = no.previousSibling; p !== null && p.type === "comment" && p.endPosition.row >= linhaAlvo - 1 && this.linhaPropria(p); p = p.previousSibling) {
      partes.unshift(this.texto(p));
      linhaAlvo = p.startPosition.row;
    }
    return partes.length === 0 ? null : primeiraLinhaDoc(partes.join("\n"));
  }

  /** O comentário começa a própria linha (não é comentário no fim de outro código). */
  private linhaPropria(c: Node): boolean {
    const t = this.ctx.texto;
    const ini = t.lastIndexOf("\n", c.startIndex - 1) + 1;
    return t.slice(ini, c.startIndex).trim() === "";
  }

  private infoDecorador(dec: Node): InfoDecorador {
    const expr = dec.namedChild(0);
    let nome = "";
    let args: Node | null = null;
    if (expr !== null) {
      if (expr.type === "call_expression") {
        const fn = expr.childForFieldName("function");
        if (fn !== null) nome = fn.type === "member_expression" ? this.texto(fn.childForFieldName("property") ?? fn) : this.texto(fn);
        args = expr.childForFieldName("arguments");
      } else if (expr.type === "identifier") nome = this.texto(expr);
      else nome = this.texto(expr);
    }
    const arg0 = args !== null ? args.namedChild(0) : null;
    return { nome, texto: sanitizarAssinatura(this.texto(dec), 120), argTexto: this.valorString(arg0), arg0 };
  }

  private propriedadeString(objeto: Node | null, chaves: readonly string[]): string | null {
    if (objeto === null || objeto.type !== "object") return null;
    for (let i = 0; i < objeto.namedChildCount; i++) {
      const par = objeto.namedChild(i);
      if (par === null || par.type !== "pair") continue;
      const chave = par.childForFieldName("key");
      if (chave !== null && chaves.includes(this.texto(chave).replace(/^["']|["']$/g, ""))) return this.valorString(par.childForFieldName("value"));
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // imports e exports

  private novoImport(i: ImportBruto): void {
    this.modulos.add(i.especificador);
    this.empurrar(this.r.imports, i, LIMITES_EXTRACAO.imports);
  }

  private tratarImport(no: Node): void {
    const fonte = no.childForFieldName("source");
    if (fonte === null) {
      // `import x = require("m")`
      for (let i = 0; i < no.namedChildCount; i++) {
        const c = no.namedChild(i);
        if (c !== null && c.type === "import_require_clause") {
          const id = c.namedChild(0);
          const esp = this.valorString(c.childForFieldName("source") ?? c.namedChild(1));
          if (esp !== null) this.novoImport({ especificador: esp, tipo: "require", linha: linhaIni(no), so_tipo: false, nomes: [{ nome: "*", alias: id !== null ? this.texto(id) : null }] });
        }
      }
      return;
    }
    const especificador = this.valorString(fonte);
    if (especificador === null) return;
    const nomes: NomeImportado[] = [];
    for (let i = 0; i < no.namedChildCount; i++) {
      const c = no.namedChild(i);
      if (c === null || c.type !== "import_clause") continue;
      for (let j = 0; j < c.namedChildCount; j++) {
        const k = c.namedChild(j);
        if (k === null) continue;
        if (k.type === "identifier") nomes.push({ nome: "default", alias: this.texto(k) });
        else if (k.type === "namespace_import") {
          const id = k.namedChild(0);
          nomes.push({ nome: "*", alias: id !== null ? this.texto(id) : null });
        } else if (k.type === "named_imports") {
          for (let m = 0; m < k.namedChildCount; m++) {
            const e = k.namedChild(m);
            if (e === null || e.type !== "import_specifier") continue;
            const n = e.childForFieldName("name");
            const a = e.childForFieldName("alias");
            if (n !== null) nomes.push({ nome: this.texto(n).replace(/^["']|["']$/g, ""), alias: a !== null ? this.texto(a) : null });
          }
        }
      }
    }
    this.novoImport({ especificador, tipo: "estatico", linha: linhaIni(no), so_tipo: no.child(1)?.type === "type", nomes });
  }

  private tratarExport(no: Node, q: Quadro): void {
    const fonte = no.childForFieldName("source");
    if (fonte !== null) {
      const especificador = this.valorString(fonte);
      if (especificador === null) return;
      const nomes: NomeImportado[] = [];
      for (let i = 0; i < no.childCount; i++) {
        const c = no.child(i);
        if (c === null) continue;
        if (c.type === "*") nomes.push({ nome: "*", alias: null });
        else if (c.type === "namespace_export") {
          const id = c.namedChild(0);
          nomes.push({ nome: "*", alias: id !== null ? this.texto(id) : null });
        } else if (c.type === "export_clause") {
          for (let m = 0; m < c.namedChildCount; m++) {
            const e = c.namedChild(m);
            if (e === null || e.type !== "export_specifier") continue;
            const n = e.childForFieldName("name");
            const a = e.childForFieldName("alias");
            if (n !== null) nomes.push({ nome: this.texto(n), alias: a !== null ? this.texto(a) : null });
          }
        }
      }
      this.novoImport({ especificador, tipo: "reexport", linha: linhaIni(no), so_tipo: no.child(1)?.type === "type", nomes });
      return;
    }
    const decl = no.childForFieldName("declaration");
    if (decl !== null) {
      for (let i = 0; i < no.childCount; i++) {
        if (no.child(i)?.type === "default") this.temDefault = true;
      }
      this.visitar(decl, q);
      return;
    }
    // export { a, b as c }   (sem origem): marca símbolos locais como exportados
    let tratouClause = false;
    for (let i = 0; i < no.namedChildCount; i++) {
      const c = no.namedChild(i);
      if (c !== null && c.type === "export_clause") {
        tratouClause = true;
        for (let m = 0; m < c.namedChildCount; m++) {
          const e = c.namedChild(m);
          const n = e?.childForFieldName("name") ?? null;
          if (n !== null) this.exportadosLocais.add(this.texto(n));
        }
      }
    }
    if (tratouClause) return;
    // export default <expressão>
    const valor = no.childForFieldName("value");
    if (valor !== null) {
      this.temDefault = true;
      if (valor.type === "identifier") this.exportadosLocais.add(this.texto(valor));
      else if (valor.type === "function_expression" || valor.type === "arrow_function" || valor.type === "function") this.simboloFuncaoAnonima(valor, "default", no, q, true);
      else if (valor.type === "class") this.classe(valor, q, "default", no);
      else this.visitar(valor, q);
      return;
    }
    // `export default class {}`/`export default function () {}` que o parser expõe como declaração sem nome
    this.visitarFilhos(no, q);
  }

  // ---------------------------------------------------------------------------------------------
  // percurso

  private visitarFilhos(no: Node, q: Quadro): void {
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f !== null) this.visitar(f, q);
    }
  }

  private visitar(no: Node, q: Quadro): void {
    const tipo = no.type;
    if (ehDecisao(this.ctx.linguagem, no)) q.contador.n++;
    switch (tipo) {
      case "import_statement":
        return; // 1ª passada
      case "export_statement":
        this.tratarExport(no, q);
        return;
      case "function_declaration":
      case "generator_function_declaration":
        this.declaracaoFuncao(no, q);
        return;
      case "class_declaration":
      case "abstract_class_declaration":
        this.classe(no, q, null, null);
        return;
      case "interface_declaration":
        this.interface_(no, q);
        return;
      case "type_alias_declaration":
        this.simboloSimples(no, q, "tipo");
        return;
      case "enum_declaration":
        this.simboloSimples(no, q, "enum");
        this.visitarFilhos(no, q);
        return;
      case "lexical_declaration":
      case "variable_declaration":
        this.declaracaoVariaveis(no, q);
        return;
      case "internal_module":
      case "module":
        this.namespace(no, q);
        return;
      case "call_expression":
        this.chamada(no, q);
        return;
      case "new_expression":
        this.novo(no, q);
        return;
      case "member_expression":
        this.membro(no, q);
        return;
      case "subscript_expression":
        this.subscrito(no, q);
        return;
      case "jsx_opening_element":
      case "jsx_self_closing_element":
        this.jsx(no, q);
        return;
      case "string":
        this.verificarSql(no, q, "string");
        return;
      case "template_string":
        this.verificarSql(no, q, "template");
        this.visitarFilhos(no, q);
        return;
      case "throw_statement":
        this.empurrar(this.r.padroes, { tipo: "throw", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
        this.visitarFilhos(no, q);
        return;
      case "catch_clause": {
        const corpo = no.childForFieldName("body");
        if (corpo !== null && corpo.namedChildCount === 0) this.empurrar(this.r.padroes, { tipo: "catch_vazio", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
        this.visitarFilhos(no, q);
        return;
      }
      case "if_statement": {
        const cond = no.childForFieldName("condition");
        if (cond !== null && cond.endIndex - cond.startIndex < 60 && /require\.main\s*===?\s*module/.test(this.texto(cond))) {
          this.empurrar(this.r.entradas, { tipo: "main", chave: "main", framework: "node", handler: null, linha: linhaIni(no), confianca: "exata" }, LIMITES_EXTRACAO.entradas);
        }
        this.visitarFilhos(no, q);
        return;
      }
      case "assignment_expression":
        this.atribuicao(no, q);
        return;
      default:
        this.visitarFilhos(no, q);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // símbolos

  private quadroDe(q: Quadro, qualificado: string, funcao: boolean): Quadro {
    return {
      de: qualificado,
      prefixo: qualificado,
      classe: null,
      contador: funcao ? { n: 0 } : q.contador,
      dentroFuncao: funcao ? true : q.dentroFuncao,
    };
  }

  private criarSimbolo(parcial: Omit<SimboloBruto, "qualificado" | "complexidade"> & { prefixo: string }): SimboloBruto | null {
    if (this.r.simbolos.length >= MAX_SIMBOLOS) {
      this.r.truncado = true;
      return null;
    }
    const { prefixo, ...resto } = parcial;
    const qualificado = this.unicos.unico(prefixo === "" ? resto.nome : `${prefixo}.${resto.nome}`);
    const s: SimboloBruto = { ...resto, qualificado, complexidade: 0 };
    this.r.simbolos.push(s);
    return s;
  }

  private ehExportada(no: Node): Node | null {
    const p = no.parent;
    return p !== null && p.type === "export_statement" ? p : null;
  }

  private decoradoresDe(no: Node, extras: readonly Node[] = []): InfoDecorador[] {
    const lista: InfoDecorador[] = extras.map((d) => this.infoDecorador(d));
    for (let i = 0; i < no.namedChildCount; i++) {
      const c = no.namedChild(i);
      if (c !== null && c.type === "decorator") lista.push(this.infoDecorador(c));
    }
    return lista;
  }

  private decoradoresDoExport(exp: Node | null): Node[] {
    const lista: Node[] = [];
    if (exp === null) return lista;
    for (let i = 0; i < exp.namedChildCount; i++) {
      const c = exp.namedChild(i);
      if (c !== null && c.type === "decorator") lista.push(c);
    }
    return lista;
  }

  private declaracaoFuncao(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    const corpo = no.childForFieldName("body");
    if (nomeNo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const exp = this.ehExportada(no);
    const s = this.criarSimbolo({
      prefixo: q.prefixo,
      nome: this.texto(nomeNo),
      tipo: "funcao",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: exp !== null && !q.dentroFuncao,
      visibilidade: null,
      assinatura: sanitizarAssinatura(this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex)),
      doc: this.doc(exp ?? no),
      decoradores: [],
    });
    if (s === null) {
      this.visitarFilhos(no, q);
      return;
    }
    if (exp !== null && q.prefixo === "" && s.nome === "handler") {
      this.empurrar(this.r.entradas, { tipo: "handler", chave: "handler", framework: "lambda", handler: s.qualificado, linha: s.linha, confianca: "heuristica" }, LIMITES_EXTRACAO.entradas);
    }
    const nq = this.quadroDe(q, s.qualificado, true);
    this.visitarFilhos(no, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private simboloFuncaoAnonima(fn: Node, nome: string, docDe: Node, q: Quadro, exportado: boolean): void {
    const corpo = fn.childForFieldName("body");
    const s = this.criarSimbolo({
      prefixo: q.prefixo,
      nome,
      tipo: "funcao",
      linha: linhaIni(fn),
      linha_fim: linhaFim(fn),
      exportado,
      visibilidade: null,
      assinatura: sanitizarAssinatura(this.ctx.texto.slice(fn.startIndex, corpo !== null ? corpo.startIndex : fn.endIndex)),
      doc: this.doc(docDe),
      decoradores: [],
    });
    if (s === null) {
      this.visitarFilhos(fn, q);
      return;
    }
    const nq = this.quadroDe(q, s.qualificado, true);
    this.visitarFilhos(fn, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private simboloSimples(no: Node, q: Quadro, tipo: "tipo" | "enum"): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) return;
    const exp = this.ehExportada(no);
    const corpo = no.childForFieldName("body");
    this.criarSimbolo({
      prefixo: q.prefixo,
      nome: this.texto(nomeNo),
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: exp !== null && !q.dentroFuncao,
      visibilidade: null,
      assinatura: sanitizarAssinatura(this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex)),
      doc: this.doc(exp ?? no),
      decoradores: [],
    });
  }

  private interface_(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) return;
    const exp = this.ehExportada(no);
    const corpo = no.childForFieldName("body");
    const s = this.criarSimbolo({
      prefixo: q.prefixo,
      nome: this.texto(nomeNo),
      tipo: "interface",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: exp !== null && !q.dentroFuncao,
      visibilidade: null,
      assinatura: sanitizarAssinatura(this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex)),
      doc: this.doc(exp ?? no),
      decoradores: [],
    });
    if (s === null) return;
    for (let i = 0; i < no.namedChildCount; i++) {
      const c = no.namedChild(i);
      if (c === null || c.type !== "extends_type_clause") continue;
      for (let j = 0; j < c.namedChildCount; j++) {
        const base = this.nomeBase(c.namedChild(j));
        if (base !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base, tipo: "herda", linha: linhaIni(c) }, LIMITES_EXTRACAO.herancas);
      }
    }
  }

  private namespace(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    const corpo = no.childForFieldName("body");
    if (nomeNo === null || corpo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = this.texto(nomeNo).replace(/^["']|["']$/g, "");
    const prefixo = q.prefixo === "" ? nome : `${q.prefixo}.${nome}`;
    this.visitarFilhos(corpo, { ...q, prefixo });
  }

  private classe(no: Node, q: Quadro, nomeFixo: string | null, docDe: Node | null): void {
    const nomeNo = no.childForFieldName("name");
    const nome = nomeFixo ?? (nomeNo !== null ? this.texto(nomeNo) : null);
    const corpo = no.childForFieldName("body");
    if (nome === null || corpo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const exp = docDe ?? this.ehExportada(no);
    const exportada = exp !== null && !q.dentroFuncao;
    const decs = this.decoradoresDe(no, this.decoradoresDoExport(exp));
    const controller = decs.find((d) => d.nome === "Controller");
    const s = this.criarSimbolo({
      prefixo: q.prefixo,
      nome,
      tipo: "classe",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: exportada,
      visibilidade: null,
      assinatura: sanitizarAssinatura(this.ctx.texto.slice(no.startIndex, corpo.startIndex)),
      doc: this.doc(exp ?? no),
      decoradores: decs.map((d) => d.texto).slice(0, LIMITES_EXTRACAO.decoradores),
    });
    if (s === null) {
      this.visitarFilhos(corpo, q);
      return;
    }
    // herança: TS (`extends_clause`/`implements_clause`) e JS (expressão direta)
    for (let i = 0; i < no.namedChildCount; i++) {
      const h = no.namedChild(i);
      if (h === null || h.type !== "class_heritage") continue;
      for (let j = 0; j < h.namedChildCount; j++) {
        const c = h.namedChild(j);
        if (c === null) continue;
        if (c.type === "extends_clause") {
          const base = this.nomeBase(c.childForFieldName("value") ?? c.namedChild(0));
          if (base !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base, tipo: "herda", linha: linhaIni(c) }, LIMITES_EXTRACAO.herancas);
        } else if (c.type === "implements_clause") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const base = this.nomeBase(c.namedChild(k));
            if (base !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base, tipo: "implementa", linha: linhaIni(c) }, LIMITES_EXTRACAO.herancas);
          }
        } else {
          const base = this.nomeBase(c);
          if (base !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base, tipo: "herda", linha: linhaIni(c) }, LIMITES_EXTRACAO.herancas);
        }
      }
    }
    // decoradores de nível de classe com dados (TypeORM/Sequelize)
    for (const d of decs) {
      if ((d.nome === "Entity" || d.nome === "Table") && this.r.dados.length < LIMITES_EXTRACAO.dados) {
        const nomeTabela = d.argTexto ?? this.propriedadeString(d.arg0, ["name", "tableName"]);
        this.r.dados.push({
          tabela: (nomeTabela ?? nome).toLowerCase(),
          operacao: "define",
          de: s.qualificado,
          linha: s.linha,
          confianca: nomeTabela !== null ? "exata" : "heuristica",
          fonte: d.nome === "Entity" ? "typeorm" : "sequelize",
        });
      }
    }
    const ctxClasse: ClasseCtx = {
      qualificado: s.qualificado,
      exportada,
      controller: controller !== undefined,
      prefixoRota: controller?.argTexto ?? "",
    };
    const nq: Quadro = { de: s.qualificado, prefixo: s.qualificado, classe: ctxClasse, contador: q.contador, dentroFuncao: q.dentroFuncao };
    this.corpoClasse(corpo, nq, ctxClasse);
  }

  private corpoClasse(corpo: Node, q: Quadro, cls: ClasseCtx): void {
    let pendentes: Node[] = [];
    for (let i = 0; i < corpo.namedChildCount; i++) {
      const m = corpo.namedChild(i);
      if (m === null) continue;
      switch (m.type) {
        case "decorator":
          pendentes.push(m);
          continue;
        case "comment":
          continue;
        case "method_definition":
          this.metodo(m, q, cls, pendentes);
          break;
        case "public_field_definition":
          this.campo(m, q, cls, pendentes);
          break;
        default:
          this.visitar(m, q);
      }
      pendentes = [];
    }
  }

  private visibilidade(no: Node, nome: string): Visibilidade {
    if (nome.startsWith("#")) return "privada";
    for (let i = 0; i < no.childCount; i++) {
      const c = no.child(i);
      if (c !== null && c.type === "accessibility_modifier") {
        const t = this.texto(c);
        return t === "private" ? "privada" : t === "protected" ? "protegida" : "publica";
      }
    }
    return "publica";
  }

  private metodo(no: Node, q: Quadro, cls: ClasseCtx, pendentes: readonly Node[]): void {
    const nomeNo = no.childForFieldName("name");
    const corpo = no.childForFieldName("body");
    const nome = nomeNo === null ? "[…]" : nomeNo.type === "computed_property_name" ? "[…]" : this.texto(nomeNo).replace(/^["']|["']$/g, "");
    const decs = pendentes.map((d) => this.infoDecorador(d));
    const vis = this.visibilidade(no, nome);
    const s = this.criarSimbolo({
      prefixo: q.prefixo,
      nome,
      tipo: "metodo",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: cls.exportada && vis !== "privada",
      visibilidade: vis,
      assinatura: sanitizarAssinatura(this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex)),
      doc: this.doc(pendentes[0] ?? no),
      decoradores: decs.map((d) => d.texto),
    });
    if (s === null) {
      this.visitarFilhos(no, { ...q, classe: null });
      return;
    }
    this.entradasDeDecoradores(s, decs, cls);
    const nq = this.quadroDe(q, s.qualificado, true);
    this.visitarFilhos(no, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private campo(no: Node, q: Quadro, cls: ClasseCtx, pendentes: readonly Node[]): void {
    const nomeNo = no.childForFieldName("name");
    const valor = no.childForFieldName("value");
    if (nomeNo === null || valor === null || (valor.type !== "arrow_function" && valor.type !== "function_expression" && valor.type !== "function")) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = this.texto(nomeNo).replace(/^["']|["']$/g, "");
    const decs = pendentes.map((d) => this.infoDecorador(d));
    const vis = this.visibilidade(no, nome);
    const corpo = valor.childForFieldName("body");
    const s = this.criarSimbolo({
      prefixo: q.prefixo,
      nome,
      tipo: "metodo",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: cls.exportada && vis !== "privada",
      visibilidade: vis,
      assinatura: sanitizarAssinatura(this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex)),
      doc: this.doc(pendentes[0] ?? no),
      decoradores: decs.map((d) => d.texto),
    });
    if (s === null) {
      this.visitarFilhos(valor, q);
      return;
    }
    this.entradasDeDecoradores(s, decs, cls);
    const nq = this.quadroDe(q, s.qualificado, true);
    this.visitarFilhos(valor, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private entradasDeDecoradores(s: SimboloBruto, decs: readonly InfoDecorador[], cls: ClasseCtx): void {
    for (const d of decs) {
      let tipo: SubtipoEntrada | null = null;
      let chave = "";
      let framework = "nestjs";
      const verbo = NEST_VERBOS[d.nome];
      if (verbo !== undefined && cls.controller) {
        tipo = "rota";
        chave = `${verbo} ${juntarRota(cls.prefixoRota, d.argTexto ?? "")}`;
      } else if (d.nome === "Cron" && d.argTexto !== null) {
        tipo = "job";
        chave = `cron:${d.argTexto}`;
      } else if (d.nome === "OnEvent" && d.argTexto !== null) {
        tipo = "evento";
        chave = `evento:${d.argTexto}`;
      } else if ((d.nome === "MessagePattern" || d.nome === "EventPattern") && d.argTexto !== null) {
        tipo = "fila";
        chave = `msg:${d.argTexto}`;
      }
      if (tipo !== null) {
        this.empurrar(this.r.entradas, { tipo, chave, framework, handler: s.qualificado, linha: s.linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
        framework = "nestjs";
      }
    }
  }

  private declaracaoVariaveis(no: Node, q: Quadro): void {
    const exp = this.ehExportada(no);
    const ehConst = no.child(0)?.type === "const";
    for (let i = 0; i < no.namedChildCount; i++) {
      const d = no.namedChild(i);
      if (d === null || d.type !== "variable_declarator") continue;
      const nomeNo = d.childForFieldName("name");
      const valor = d.childForFieldName("value");
      if (nomeNo === null) continue;
      if (nomeNo.type !== "identifier") {
        // desestruturação: `const { a } = require("m")` etc.
        if (valor !== null) this.visitar(valor, q);
        continue;
      }
      const nome = this.texto(nomeNo);
      if (valor !== null) {
        const fabrica = this.fabricaRoteador(valor);
        if (fabrica !== null) this.roteadores.set(nome, fabrica);
      }
      if (valor !== null && (valor.type === "arrow_function" || valor.type === "function_expression" || valor.type === "function" || valor.type === "generator_function")) {
        const corpo = valor.childForFieldName("body");
        const s = this.criarSimbolo({
          prefixo: q.prefixo,
          nome,
          tipo: "funcao",
          linha: linhaIni(d),
          linha_fim: linhaFim(d),
          exportado: exp !== null && !q.dentroFuncao,
          visibilidade: null,
          assinatura: sanitizarAssinatura(this.ctx.texto.slice(d.startIndex, corpo !== null ? corpo.startIndex : d.endIndex)),
          doc: this.doc(exp ?? no),
          decoradores: [],
        });
        if (s === null) {
          this.visitar(valor, q);
          continue;
        }
        if (exp !== null && q.prefixo === "" && nome === "handler") {
          this.empurrar(this.r.entradas, { tipo: "handler", chave: "handler", framework: "lambda", handler: s.qualificado, linha: s.linha, confianca: "heuristica" }, LIMITES_EXTRACAO.entradas);
        }
        const nq = this.quadroDe(q, s.qualificado, true);
        this.visitarFilhos(valor, nq);
        s.complexidade = 1 + nq.contador.n;
        continue;
      }
      if (ehConst && !q.dentroFuncao && q.classe === null && valor !== null && (exp !== null || ehValorLiteral(valor))) {
        this.criarSimbolo({
          prefixo: q.prefixo,
          nome,
          tipo: "constante",
          linha: linhaIni(d),
          linha_fim: linhaFim(d),
          exportado: exp !== null,
          visibilidade: null,
          assinatura: `const ${nome}`,
          doc: this.doc(exp ?? no),
          decoradores: [],
        });
      }
      if (valor !== null) this.visitar(valor, q);
    }
  }

  private fabricaRoteador(valor: Node): string | null {
    if (valor.type === "call_expression") {
      const fn = valor.childForFieldName("function");
      if (fn !== null) {
        const t = this.texto(fn);
        if (t.length < 40) return FABRICAS_ROTEADOR[t] ?? null;
      }
    } else if (valor.type === "new_expression") {
      const c = valor.childForFieldName("constructor");
      if (c !== null) {
        const t = this.texto(c);
        if (t.length < 40) return FABRICAS_ROTEADOR[t] ?? null;
      }
    }
    return null;
  }

  private atribuicao(no: Node, q: Quadro): void {
    const esq = no.childForFieldName("left");
    const dir = no.childForFieldName("right");
    if (esq !== null && dir !== null && esq.type === "member_expression") {
      const t = this.texto(esq);
      if (t === "module.exports") {
        this.temDefault = true;
        if (dir.type === "identifier") this.exportadosLocais.add(this.texto(dir));
        else if (dir.type === "object") {
          for (let i = 0; i < dir.namedChildCount; i++) {
            const c = dir.namedChild(i);
            if (c === null) continue;
            if (c.type === "shorthand_property_identifier") this.exportadosLocais.add(this.texto(c));
            else if (c.type === "pair") {
              const v = c.childForFieldName("value");
              if (v !== null && v.type === "identifier") this.exportadosLocais.add(this.texto(v));
            }
          }
        }
      } else if (/^(module\.)?exports\.[A-Za-z_$][\w$]*$/.test(t)) {
        const nome = t.slice(t.lastIndexOf(".") + 1);
        if (dir.type === "arrow_function" || dir.type === "function_expression" || dir.type === "function") {
          this.simboloFuncaoAnonima(dir, nome, no.parent ?? no, q, true);
          return;
        }
        if (dir.type === "identifier") this.exportadosLocais.add(this.texto(dir));
      }
    }
    this.visitarFilhos(no, q);
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas, entradas, dados

  private registrarChamada(q: Quadro, alvo: string, receptor: string | null, tipo: "chamada" | "instancia" | "referencia", linha: number): void {
    this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor, tipo, linha }, LIMITES_EXTRACAO.chamadas);
  }

  private visitarArgumentos(args: Node | null, q: Quadro): void {
    if (args !== null) this.visitarFilhos(args, q);
  }

  private chamada(no: Node, q: Quadro): void {
    const fn = no.childForFieldName("function");
    const args = no.childForFieldName("arguments");
    const linha = linhaIni(no);
    if (fn === null) {
      this.visitarFilhos(no, q);
      return;
    }
    switch (fn.type) {
      case "import": {
        const esp = this.valorString(args?.namedChild(0) ?? null);
        if (esp !== null) this.novoImport({ especificador: esp, tipo: "dinamico", linha, so_tipo: false, nomes: [] });
        else this.empurrar(this.r.dinamicos, { tipo: "import_dinamico", linha }, LIMITES_EXTRACAO.dinamicos);
        this.visitarArgumentos(args, q);
        return;
      }
      case "identifier": {
        const nome = this.texto(fn);
        if (nome === "require") {
          const esp = this.valorString(args?.namedChild(0) ?? null);
          if (esp !== null) this.novoImport({ especificador: esp, tipo: "require", linha, so_tipo: false, nomes: this.nomesDoRequire(no) });
          else if (args !== null && args.namedChildCount > 0) this.empurrar(this.r.dinamicos, { tipo: "require_dinamico", linha }, LIMITES_EXTRACAO.dinamicos);
          this.visitarArgumentos(args, q);
          return;
        }
        if (nome === "eval") {
          this.empurrar(this.r.dinamicos, { tipo: "eval", linha }, LIMITES_EXTRACAO.dinamicos);
          this.visitarArgumentos(args, q);
          return;
        }
        this.registrarChamada(q, nome, null, "chamada", linha);
        this.dadosPorIdentificador(no, nome, args, q);
        this.visitarArgumentos(args, q);
        return;
      }
      case "member_expression": {
        const obj = fn.childForFieldName("object");
        const prop = fn.childForFieldName("property");
        if (prop !== null) {
          const alvo = this.texto(prop);
          const receptor = this.receptorTexto(obj);
          this.registrarChamada(q, alvo, receptor ?? RECEPTOR_EXPRESSAO, "chamada", linha);
          this.entradasPorMembro(no, alvo, receptor, args, q, linha);
          this.dadosPorMembro(no, alvo, receptor, obj, args, q, linha);
        }
        if (obj !== null) this.visitar(obj, q);
        this.visitarArgumentos(args, q);
        return;
      }
      case "subscript_expression": {
        const idx = fn.childForFieldName("index");
        if (idx !== null && idx.type !== "string" && idx.type !== "number") this.empurrar(this.r.dinamicos, { tipo: "chamada_computada", linha }, LIMITES_EXTRACAO.dinamicos);
        this.visitarFilhos(fn, q);
        this.visitarArgumentos(args, q);
        return;
      }
      default:
        this.visitar(fn, q);
        this.visitarArgumentos(args, q);
    }
  }

  private nomesDoRequire(chamada: Node): NomeImportado[] {
    const p = chamada.parent;
    if (p === null || p.type !== "variable_declarator") return [];
    const nome = p.childForFieldName("name");
    if (nome === null) return [];
    if (nome.type === "identifier") return [{ nome: "*", alias: this.texto(nome) }];
    if (nome.type === "object_pattern") {
      const lista: NomeImportado[] = [];
      for (let i = 0; i < nome.namedChildCount; i++) {
        const c = nome.namedChild(i);
        if (c === null) continue;
        if (c.type === "shorthand_property_identifier_pattern") lista.push({ nome: this.texto(c), alias: null });
        else if (c.type === "pair_pattern") {
          const k = c.childForFieldName("key");
          const v = c.childForFieldName("value");
          if (k !== null) lista.push({ nome: this.texto(k), alias: v !== null ? this.texto(v) : null });
        }
      }
      return lista;
    }
    return [];
  }

  private novo(no: Node, q: Quadro): void {
    const ctor = no.childForFieldName("constructor");
    const args = no.childForFieldName("arguments");
    const linha = linhaIni(no);
    if (ctor !== null) {
      if (ctor.type === "identifier") {
        const nome = this.texto(ctor);
        if (nome === "Function") this.empurrar(this.r.dinamicos, { tipo: "new_function", linha }, LIMITES_EXTRACAO.dinamicos);
        else {
          this.registrarChamada(q, nome, null, "instancia", linha);
          if (nome === "CronJob" && MODULOS_CRON.some((m) => this.modulos.has(m))) this.entradaCron(args, linha, q);
        }
      } else if (ctor.type === "member_expression") {
        const prop = ctor.childForFieldName("property");
        if (prop !== null) this.registrarChamada(q, this.texto(prop), this.receptorTexto(ctor.childForFieldName("object")) ?? RECEPTOR_EXPRESSAO, "instancia", linha);
      }
    }
    this.visitarArgumentos(args, q);
  }

  private entradaCron(args: Node | null, linha: number, q: Quadro): void {
    const expr = this.valorString(args?.namedChild(0) ?? null);
    if (expr === null) return;
    const handler = this.nomeHandler(args?.namedChild(1) ?? null);
    this.empurrar(this.r.entradas, { tipo: "job", chave: `cron:${expr}`, framework: "cron", handler, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    void q;
  }

  private entradasPorMembro(no: Node, alvo: string, receptor: string | null, args: Node | null, q: Quadro, linha: number): void {
    if (receptor === null || args === null) return;
    const ultimo = receptor.slice(receptor.lastIndexOf(".") + 1);
    // Electron: ipcMain.handle/on/once
    if (ultimo === "ipcMain" && (alvo === "handle" || alvo === "handleOnce" || alvo === "on" || alvo === "once")) {
      const canal = this.valorString(args.namedChild(0));
      if (canal !== null) {
        this.empurrar(this.r.entradas, { tipo: "handler", chave: `ipc:${canal}`, framework: "electron", handler: this.nomeHandler(args.namedChild(1)), linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      }
      return;
    }
    // rotas HTTP (Express/Koa/Fastify/Hono): verbo + caminho literal + handler
    if (VERBOS_HTTP.has(alvo) && args.namedChildCount >= 2) {
      const caminho = this.valorString(args.namedChild(0));
      if (caminho !== null && (caminho.startsWith("/") || caminho === "*")) {
        const fabrica = this.roteadores.get(receptor);
        if (fabrica !== undefined || NOME_ROTEADOR.test(ultimo)) {
          const confianca: Confianca = fabrica !== undefined ? "exata" : "heuristica";
          const verbo = alvo === "del" ? "DELETE" : alvo.toUpperCase();
          this.empurrar(
            this.r.entradas,
            { tipo: "rota", chave: `${verbo} ${caminho}`, framework: fabrica ?? "express", handler: this.nomeHandler(args.namedChild(args.namedChildCount - 1)), linha, confianca },
            LIMITES_EXTRACAO.entradas,
          );
        }
      }
      return;
    }
    // CLI: program.command("nome")
    if (alvo === "command" && MODULOS_CLI.some((m) => this.modulos.has(m))) {
      const nome = this.valorString(args.namedChild(0));
      if (nome !== null && nome.trim() !== "") {
        const modulo = MODULOS_CLI.find((m) => this.modulos.has(m)) ?? "cli";
        this.empurrar(this.r.entradas, { tipo: "cli", chave: `cli:${nome.trim().split(/\s+/)[0] as string}`, framework: modulo, handler: null, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      }
      return;
    }
    // cron: cron.schedule("* * * * *", fn)
    if (alvo === "schedule" && ultimo === "cron" && this.modulos.has("node-cron")) {
      this.entradaCron(args, linha, q);
    } else if (alvo === "scheduleJob" && this.modulos.has("node-schedule")) {
      const expr = this.valorString(args.namedChild(0));
      if (expr !== null) this.empurrar(this.r.entradas, { tipo: "job", chave: `cron:${expr}`, framework: "node-schedule", handler: this.nomeHandler(args.namedChild(args.namedChildCount - 1)), linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    }
    void no;
  }

  private novoDado(d: AcessoDadoBruto): void {
    this.empurrar(this.r.dados, d, LIMITES_EXTRACAO.dados);
  }

  private dadosPorMembro(no: Node, alvo: string, receptor: string | null, obj: Node | null, args: Node | null, q: Quadro, linha: number): void {
    // Prisma: prisma.<modelo>.<operação>(…)
    const leitura = PRISMA_LEITURA.has(alvo);
    if ((leitura || PRISMA_ESCRITA.has(alvo)) && obj !== null && obj.type === "member_expression") {
      const raizPrisma = this.receptorTexto(obj.childForFieldName("object"));
      const modelo = obj.childForFieldName("property");
      if (raizPrisma !== null && modelo !== null && raizPrisma.slice(raizPrisma.lastIndexOf(".") + 1) === "prisma") {
        const nome = this.texto(modelo);
        if (!nome.startsWith("$")) {
          this.novoDado({ tabela: nome.toLowerCase(), operacao: leitura ? "le" : "escreve", de: q.de, linha, confianca: "exata", fonte: "prisma" });
        }
      }
      return;
    }
    if (args === null) return;
    // Sequelize: sequelize.define("tabela", …)
    if (alvo === "define" && receptor !== null && /sequelize|^db$|orm/i.test(receptor)) {
      const t = this.valorString(args.namedChild(0));
      if (t !== null && t !== "") this.novoDado({ tabela: t.toLowerCase(), operacao: "define", de: q.de, linha, confianca: "exata", fonte: "sequelize" });
      return;
    }
    // Mongoose: mongoose.model("Nome", schema)
    if (alvo === "model" && receptor === "mongoose") {
      const t = this.valorString(args.namedChild(0));
      if (t !== null && t !== "") this.novoDado({ tabela: t.toLowerCase(), operacao: "define", de: q.de, linha, confianca: "exata", fonte: "mongoose" });
    }
    void no;
  }

  private dadosPorIdentificador(no: Node, nome: string, args: Node | null, q: Quadro): void {
    if (args === null) return;
    const linha = linhaIni(no);
    if (nome === "knex") {
      const t = this.valorString(args.namedChild(0));
      if (t === null || !/^[A-Za-z_][\w.]*$/.test(t)) return;
      let operacao: OperacaoDado = "le";
      let atual: Node = no;
      for (;;) {
        const p: Node | null = atual.parent;
        if (p === null || p.type !== "member_expression") break;
        const obj = p.childForFieldName("object");
        if (obj === null || !obj.equals(atual)) break;
        const prop = p.childForFieldName("property");
        if (prop !== null && ["insert", "update", "del", "delete", "truncate"].includes(this.texto(prop))) operacao = "escreve";
        const g: Node | null = p.parent;
        if (g === null || g.type !== "call_expression") break;
        atual = g;
      }
      const base = (t.split(".").pop() as string).toLowerCase();
      this.novoDado({ tabela: base, operacao, de: q.de, linha, confianca: this.modulos.has("knex") ? "exata" : "heuristica", fonte: "knex" });
    } else if (nome === "model" && this.modulos.has("mongoose")) {
      const t = this.valorString(args.namedChild(0));
      if (t !== null && t !== "") this.novoDado({ tabela: t.toLowerCase(), operacao: "define", de: q.de, linha, confianca: "exata", fonte: "mongoose" });
    }
  }

  private verificarSql(no: Node, q: Quadro, tipo: "string" | "template"): void {
    if (no.endIndex - no.startIndex < 14) return;
    let conteudo = this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    let confianca: Confianca = "exata";
    if (tipo === "template" && conteudo.includes("${")) {
      conteudo = conteudo.replace(/\$\{[^}]*\}/g, "?");
      confianca = "heuristica";
    }
    const tabelas = extrairTabelasSql(conteudo);
    if (tabelas.length === 0) return;
    const linha = linhaIni(no);
    for (const t of tabelas) this.novoDado({ tabela: t.tabela, operacao: t.operacao, de: q.de, linha, confianca, fonte: "sql" });
  }

  private membro(no: Node, q: Quadro): void {
    const obj = no.childForFieldName("object");
    const prop = no.childForFieldName("property");
    if (obj !== null && prop !== null && obj.type === "member_expression") {
      const raiz = obj.childForFieldName("object");
      const meio = obj.childForFieldName("property");
      if (raiz !== null && meio !== null && this.texto(meio) === "env") {
        const r = this.texto(raiz);
        if (r === "process" || r === "import.meta") this.empurrar(this.r.padroes, { tipo: "env", nome: this.texto(prop), linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
      }
    }
    if (obj !== null) this.visitar(obj, q);
  }

  private subscrito(no: Node, q: Quadro): void {
    const obj = no.childForFieldName("object");
    const idx = no.childForFieldName("index");
    if (obj !== null && idx !== null && obj.type === "member_expression") {
      const raiz = obj.childForFieldName("object");
      const meio = obj.childForFieldName("property");
      const nome = this.valorString(idx);
      if (raiz !== null && meio !== null && nome !== null && this.texto(meio) === "env" && this.texto(raiz) === "process") {
        this.empurrar(this.r.padroes, { tipo: "env", nome, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
      }
    }
    this.visitarFilhos(no, q);
  }

  private jsx(no: Node, q: Quadro): void {
    const nome = no.childForFieldName("name");
    if (nome !== null) {
      if (nome.type === "identifier") {
        const t = this.texto(nome);
        if (/^[A-Z]/.test(t)) this.registrarChamada(q, t, null, "referencia", linhaIni(no));
      } else if (nome.type === "member_expression" || nome.type === "nested_identifier") {
        const t = this.texto(nome);
        const ponto = t.lastIndexOf(".");
        if (ponto > 0 && /^[A-Z]/.test(t)) this.registrarChamada(q, t.slice(ponto + 1), t.slice(0, ponto), "referencia", linhaIni(no));
      }
    }
    this.visitarFilhos(no, q);
  }

  // ---------------------------------------------------------------------------------------------
  // pós-processamento

  private finalizar(): void {
    for (const s of this.r.simbolos) {
      if (!s.exportado && !s.qualificado.includes(".") && this.exportadosLocais.has(s.nome)) s.exportado = true;
    }
    const texto = this.ctx.texto;
    const linguagem = this.ctx.linguagem;
    if (texto.startsWith("#!") && (linguagem === "javascript" || linguagem === "typescript")) {
      const base = this.ctx.caminho.slice(this.ctx.caminho.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
      this.empurrar(this.r.entradas, { tipo: "cli", chave: `cli:${base}`, framework: "node", handler: null, linha: 1, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    }
    for (const e of entradasNext(this.ctx.caminho, this.r.simbolos, this.temDefault, [...this.modulos].some((m) => m === "next" || m.startsWith("next/")))) {
      this.empurrar(this.r.entradas, e, LIMITES_EXTRACAO.entradas);
    }
  }
}

function juntarRota(prefixo: string, caminho: string): string {
  const partes = [prefixo, caminho].map((p) => p.replace(/^\/+|\/+$/g, "")).filter((p) => p !== "");
  return `/${partes.join("/")}`;
}

function segmentoNext(seg: string): string | null {
  if (/^\(.*\)$/.test(seg) || seg.startsWith("@")) return null; // grupos e slots paralelos não entram na URL
  const opcional = /^\[\[\.\.\.(\w+)\]\]$/.exec(seg);
  if (opcional) return `*${opcional[1] as string}`;
  const catchAll = /^\[\.\.\.(\w+)\]$/.exec(seg);
  if (catchAll) return `*${catchAll[1] as string}`;
  const dinamico = /^\[(\w+)\]$/.exec(seg);
  if (dinamico) return `:${dinamico[1] as string}`;
  return seg;
}

/** Entradas do Next.js por convenção de arquivo (`pages/**`, `app/**\/page|route`). */
export function entradasNext(caminho: string, simbolos: readonly SimboloBruto[], temDefault: boolean, importaNext: boolean): EntradaBruta[] {
  const m = /(?:^|\/)(pages|app)\/(.+)\.(?:tsx|ts|jsx|js|mjs)$/.exec(caminho);
  if (m === null) return [];
  const raizTipo = m[1] as string;
  const segmentos = (m[2] as string).split("/");
  const arquivo = segmentos.pop() as string;
  const confianca: Confianca = importaNext ? "exata" : "heuristica";
  const url = (partes: string[]): string => `/${partes.map(segmentoNext).filter((s): s is string => s !== null).join("/")}`;
  if (raizTipo === "app") {
    if (arquivo === "page" && temDefault) return [{ tipo: "rota", chave: `GET ${url(segmentos)}`, framework: "nextjs", handler: null, linha: 1, confianca }];
    if (arquivo === "route") {
      return simbolos
        .filter((s) => s.exportado && s.qualificado === s.nome && VERBOS_NEXT.has(s.nome))
        .map((s) => ({ tipo: "rota" as const, chave: `${s.nome} ${url(segmentos)}`, framework: "nextjs", handler: s.qualificado, linha: s.linha, confianca }));
    }
    return [];
  }
  if (!temDefault || arquivo.startsWith("_")) return [];
  const partes = arquivo === "index" ? segmentos : [...segmentos, arquivo];
  const ehApi = segmentos[0] === "api";
  return [{ tipo: "rota", chave: `${ehApi ? "ALL" : "GET"} ${url(partes)}`, framework: "nextjs", handler: null, linha: 1, confianca }];
}

export const extratorTypescript: Extrator = {
  extrair(ctx) {
    return new Visitante(ctx).executar();
  },
};
