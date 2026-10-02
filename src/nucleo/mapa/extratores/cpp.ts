import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { Confianca, OperacaoDado, SimboloBruto, SubtipoSimbolo, Visibilidade } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator C/C++ (T-17.14). C usa a gramática `cpp` (parseia quase todo o C; `erros_parse` é tolerado nesses arquivos e
// macro pesada nunca derruba a extração). Percurso único da árvore Tree-sitter, sem executar nada, sem pré-processador.
// Formato (para `resolucao/cpp.ts`):
//  - imports: `#include "a/b.h"` => `especificador:"a/b.h"`; `#include <x>` => `especificador:"<x>"` (colchetes preservados:
//    é assim que o resolvedor distingue sistema de projeto). `tipo:"estatico"`, `nomes:[]`.
//  - qualificados usam `.` (`ns.Classe.metodo`); definição fora da classe `D::g` => `D.g` (prefixada pelo namespace envolvente).
//  - herança: toda base de `base_class_clause` vira `herda` (o texto da base sem argumentos de template, `a::B` preservado).
//  - macros: `#define X v` => constante; `#define F(x)` => função com assinatura `#define F(…)` + dinâmico `reflexao`.
//  - `.h`: protótipos livres também viram símbolos (exportados); em `.c/.cpp` só definições e membros declarados em classe.

const IGNORADAS = new Set(["sizeof", "alignof", "defined", "static_assert", "decltype", "typeof", "offsetof", "va_start", "va_end", "va_arg"]);
const DINAMICAS = new Set(["dlopen", "dlsym", "LoadLibrary", "LoadLibraryA", "LoadLibraryW", "GetProcAddress"]);
const MAIN = new Set(["main", "wmain", "WinMain", "wWinMain", "_tmain"]);

interface Quadro {
  de: string | null;
  prefixo: string;
  contador: { n: number };
  /** Dentro de classe/struct: acesso corrente. */
  classe: { nome: string; acesso: Visibilidade; qualificado: string } | null;
  global: boolean;
  dentroFuncao: boolean;
  anonimo: boolean;
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private readonly cabecalho: boolean;

  constructor(private readonly ctx: ContextoExtracao) {
    this.cabecalho = /\.(h|hh|hpp|hxx|h\+\+|inl|ipp)$/i.test(ctx.caminho);
  }

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    this.visitarFilhos(raiz, { de: null, prefixo: "", contador: this.topo, classe: null, global: true, dentroFuncao: false, anonimo: false });
    this.embutidoSql();
    this.r.decisoes_topo = this.topo.n;
    this.r.erros_parse = raiz.hasError ? this.contarErros(raiz) : 0;
    return this.r;
  }

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

  /** `EXEC SQL …;` do Pro*C/ECPG: o parser não o entende (vira erro tolerado); lemos por texto, só a tabela. */
  private embutidoSql(): void {
    if (!this.ctx.texto.includes("EXEC SQL")) return;
    for (const m of this.ctx.texto.matchAll(/EXEC\s+SQL\s+([^;]{8,2000});/gi)) {
      const linha = this.ctx.texto.slice(0, m.index).split("\n").length;
      const sql = (m[1] as string).replace(/:[A-Za-z_]\w*/g, "?");
      for (const t of extrairTabelasSql(sql)) this.dado(null, t.tabela, t.operacao, linha, "exata", "proc");
    }
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
    if (ehDecisao(this.ctx.linguagem, no)) {
      if (no.type !== "case_statement" || !/^default\b/.test(this.texto(no))) q.contador.n++;
    }
    switch (no.type) {
      case "comment":
        return;
      case "preproc_include":
        this.incluir(no);
        return;
      case "preproc_def":
        this.macroConstante(no, q);
        return;
      case "preproc_function_def":
        this.macroFuncao(no, q);
        return;
      case "namespace_definition":
        this.namespace(no, q);
        return;
      case "linkage_specification":
      case "preproc_if":
      case "preproc_ifdef":
      case "preproc_else":
      case "preproc_elif":
        this.visitarFilhos(no, q);
        return;
      case "template_declaration":
        this.visitarFilhos(no, q);
        return;
      case "class_specifier":
        this.classe(no, q, "classe");
        return;
      case "struct_specifier":
        this.classe(no, q, "struct");
        return;
      case "union_specifier":
        this.classe(no, q, "struct");
        return;
      case "enum_specifier":
        this.enumeracao(no, q);
        return;
      case "type_definition":
        this.typedef(no, q);
        return;
      case "alias_declaration":
        this.alias(no, q);
        return;
      case "function_definition":
        this.funcao(no, q);
        return;
      case "declaration":
      case "field_declaration":
        this.declaracao(no, q);
        return;
      case "call_expression":
        this.chamada(no, q);
        return;
      case "new_expression":
        this.novo(no, q);
        return;
      case "string_literal":
      case "raw_string_literal":
        this.verificarSql(no, q);
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
      default:
        this.visitarFilhos(no, q);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // includes e macros

  private incluir(no: Node): void {
    const p = no.childForFieldName("path");
    if (p === null) return;
    const bruto = this.texto(p);
    const especificador = p.type === "string_literal" ? bruto.slice(1, -1) : bruto;
    this.empurrar(this.r.imports, { especificador, tipo: "estatico", linha: linhaIni(no), so_tipo: false, nomes: [] }, LIMITES_EXTRACAO.imports);
  }

  private macroConstante(no: Node, q: Quadro): void {
    const n = no.childForFieldName("name");
    if (n === null) return;
    const nome = this.texto(n);
    // guarda de inclusão (`#define X_H` sem valor) não é símbolo do projeto
    if (no.childForFieldName("value") === null && /^_*[A-Z0-9_]+_(H|HPP|HH|HXX|INCLUDED)_*$/.test(nome)) return;
    this.criar(q, nome, "constante", no, `#define ${nome}`, "publica", true, no);
  }

  private macroFuncao(no: Node, q: Quadro): void {
    const n = no.childForFieldName("name");
    if (n === null) return;
    const nome = this.texto(n);
    const s = this.criar(q, nome, "funcao", no, `#define ${nome}(…)`, "publica", true, no);
    if (s !== null) {
      s.complexidade = 1;
      this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha: s.linha }, LIMITES_EXTRACAO.dinamicos);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // símbolos

  private doc(no: Node): string | null {
    let alvo = no;
    if (alvo.parent !== null && alvo.parent.type === "template_declaration") alvo = alvo.parent;
    const partes: string[] = [];
    let linha = alvo.startPosition.row;
    for (let p = alvo.previousSibling; p !== null && p.type === "comment" && p.endPosition.row >= linha - 1; p = p.previousSibling) {
      partes.unshift(this.texto(p));
      linha = p.startPosition.row;
    }
    return partes.length === 0 ? null : primeiraLinhaDoc(partes.join("\n"));
  }

  private criar(q: Quadro, nome: string, tipo: SubtipoSimbolo, no: Node, assinatura: string, visibilidade: Visibilidade, exportado: boolean, docDe: Node, prefixoForcado?: string): SimboloBruto | null {
    if (this.r.simbolos.length >= MAX_SIMBOLOS) {
      this.r.truncado = true;
      return null;
    }
    const prefixo = prefixoForcado ?? q.prefixo;
    const s: SimboloBruto = {
      nome,
      qualificado: this.unicos.unico(prefixo === "" ? nome : `${prefixo}.${nome}`),
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: exportado && !q.dentroFuncao && !q.anonimo,
      visibilidade,
      complexidade: 0,
      assinatura: sanitizarAssinatura(assinatura),
      doc: this.doc(docDe),
      decoradores: no.parent !== null && no.parent.type === "template_declaration" ? ["template"] : [],
    };
    this.r.simbolos.push(s);
    return s;
  }

  private namespace(no: Node, q: Quadro): void {
    const n = no.childForFieldName("name");
    const corpo = no.childForFieldName("body");
    if (corpo === null) return;
    const nome = n === null ? null : this.texto(n).replace(/::/g, ".");
    const prefixo = nome === null ? q.prefixo : q.prefixo === "" ? nome : `${q.prefixo}.${nome}`;
    this.visitarFilhos(corpo, { ...q, prefixo, anonimo: q.anonimo || nome === null, classe: null });
  }

  /** Desce por ponteiros/referências/arrays até o declarador de função (ou `null`). */
  private declaradorDeFuncao(d: Node | null): Node | null {
    let atual = d;
    for (let i = 0; i < 12 && atual !== null; i++) {
      if (atual.type === "function_declarator") {
        const interno = atual.childForFieldName("declarator");
        if (interno !== null && interno.type === "parenthesized_declarator") return null; // ponteiro de função
        return atual;
      }
      if (["pointer_declarator", "reference_declarator", "array_declarator", "parenthesized_declarator", "attributed_declarator", "init_declarator"].includes(atual.type)) {
        atual = atual.childForFieldName("declarator") ?? atual.namedChild(0);
      } else return null;
    }
    return null;
  }

  private nomeDoDeclarador(fd: Node): { nome: string; escopo: string | null } | null {
    const d = fd.childForFieldName("declarator");
    if (d === null) return null;
    switch (d.type) {
      case "identifier":
      case "field_identifier":
      case "operator_name":
      case "destructor_name":
        return { nome: this.texto(d), escopo: null };
      case "qualified_identifier": {
        const t = this.texto(d).replace(/\s+/g, "");
        const i = t.lastIndexOf("::");
        return i < 0 ? { nome: t, escopo: null } : { nome: t.slice(i + 2), escopo: t.slice(0, i).replace(/<[^<>]*>/g, "").replace(/::/g, ".") };
      }
      case "template_function":
      case "template_method": {
        const n = d.childForFieldName("name");
        return n === null ? null : { nome: this.texto(n), escopo: null };
      }
      default:
        return null;
    }
  }

  private funcao(no: Node, q: Quadro): void {
    const fd = this.declaradorDeFuncao(no.childForFieldName("declarator"));
    const corpo = no.childForFieldName("body");
    const nm = fd === null ? null : this.nomeDoDeclarador(fd);
    if (fd === null || nm === null) {
      if (corpo !== null) this.visitarFilhos(corpo, q);
      return;
    }
    const estatica = no.namedChildren.some((c) => c !== null && c.type === "storage_class_specifier" && this.texto(c) === "static");
    const emClasse = q.classe !== null;
    const metodo = emClasse || nm.escopo !== null;
    const prefixo = nm.escopo !== null ? (q.prefixo === "" ? nm.escopo : `${q.prefixo}.${nm.escopo}`) : q.prefixo;
    const vis: Visibilidade = emClasse ? (q.classe as NonNullable<Quadro["classe"]>).acesso : estatica ? "privada" : "publica";
    const cab = this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex);
    const s = this.criar(q, nm.nome, metodo ? "metodo" : "funcao", no, cab, vis, !estatica && vis === "publica", no, prefixo);
    if (s === null) {
      if (corpo !== null) this.visitarFilhos(corpo, q);
      return;
    }
    if (!metodo && q.global && MAIN.has(nm.nome)) {
      this.empurrar(this.r.entradas, { tipo: "main", chave: "main", framework: "c", handler: s.qualificado, linha: s.linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    }
    if (/\bvirtual\b/.test(cab)) this.empurrar(this.r.dinamicos, { tipo: "chamada_computada", linha: s.linha }, LIMITES_EXTRACAO.dinamicos);
    const nq: Quadro = { de: s.qualificado, prefixo: s.qualificado, contador: { n: 0 }, classe: null, global: false, dentroFuncao: true, anonimo: q.anonimo };
    if (corpo !== null) this.visitarFilhos(corpo, nq);
    const init = no.namedChildren.find((c) => c !== null && c.type === "field_initializer_list");
    if (init !== undefined && init !== null) this.visitarFilhos(init, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  /** `declaration`/`field_declaration`: protótipos de função e membros; o resto só é percorrido. */
  private declaracao(no: Node, q: Quadro): void {
    const d = no.childForFieldName("declarator");
    const fd = this.declaradorDeFuncao(d);
    const nm = fd === null ? null : this.nomeDoDeclarador(fd);
    if (fd !== null && nm !== null && !q.dentroFuncao) {
      const emClasse = q.classe !== null;
      if (emClasse || this.cabecalho) {
        const vis: Visibilidade = emClasse ? (q.classe as NonNullable<Quadro["classe"]>).acesso : "publica";
        const metodo = emClasse || nm.escopo !== null;
        const prefixo = nm.escopo !== null ? (q.prefixo === "" ? nm.escopo : `${q.prefixo}.${nm.escopo}`) : q.prefixo;
        const s = this.criar(q, nm.nome, metodo ? "metodo" : "funcao", no, this.texto(no).replace(/;\s*$/, ""), vis, vis === "publica", no, prefixo);
        if (s !== null) {
          s.complexidade = 1;
          if (/\bvirtual\b/.test(this.texto(no))) this.empurrar(this.r.dinamicos, { tipo: "chamada_computada", linha: s.linha }, LIMITES_EXTRACAO.dinamicos);
        }
      }
      return;
    }
    // tipos definidos na própria declaração (`struct S {…} v;`) e inicializadores com chamadas
    this.visitarFilhos(no, q);
  }

  private classe(no: Node, q: Quadro, tipo: "classe" | "struct"): void {
    const n = no.childForFieldName("name");
    const corpo = no.childForFieldName("body");
    if (corpo === null) return; // declaração antecipada ou uso do tipo
    const nomeBruto = n === null ? null : this.texto(n).replace(/\s+/g, "");
    if (nomeBruto === null) {
      this.visitarFilhos(corpo, { ...q, classe: null });
      return;
    }
    const nome = nomeBruto.replace(/<[^<>]*>/g, "").replace(/::/g, ".");
    const palavra = no.type === "union_specifier" ? "union" : tipo === "classe" ? "class" : "struct";
    const s = this.criar(q, nome, tipo, no, `${palavra} ${nomeBruto}`, "publica", true, no);
    if (s === null) return;
    const bases = no.namedChildren.find((c) => c !== null && c.type === "base_class_clause");
    if (bases !== undefined && bases !== null) {
      for (let i = 0; i < bases.namedChildCount; i++) {
        const b = bases.namedChild(i);
        if (b === null || b.type === "access_specifier" || b.type === "virtual") continue;
        const base = this.nomeBase(b);
        if (base !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base, tipo: "herda", linha: linhaIni(no) }, LIMITES_EXTRACAO.herancas);
      }
    }
    const nq: Quadro = {
      de: q.de,
      prefixo: s.qualificado,
      contador: { n: 0 },
      classe: { nome, acesso: tipo === "classe" ? "privada" : "publica", qualificado: s.qualificado },
      global: false,
      dentroFuncao: q.dentroFuncao,
      anonimo: q.anonimo,
    };
    for (let i = 0; i < corpo.namedChildCount; i++) {
      const f = corpo.namedChild(i);
      if (f === null) continue;
      if (f.type === "access_specifier") {
        const t = this.texto(f);
        (nq.classe as NonNullable<Quadro["classe"]>).acesso = t === "public" ? "publica" : t === "protected" ? "protegida" : "privada";
        continue;
      }
      this.visitar(f, nq);
    }
  }

  private nomeBase(no: Node): string | null {
    switch (no.type) {
      case "type_identifier":
      case "qualified_identifier":
        return this.texto(no).replace(/\s+/g, "").replace(/<[^<>]*>/g, "");
      case "template_type": {
        const n = no.childForFieldName("name");
        return n === null ? null : this.texto(n);
      }
      default:
        return null;
    }
  }

  private enumeracao(no: Node, q: Quadro): void {
    const n = no.childForFieldName("name");
    const corpo = no.childForFieldName("body");
    if (n === null || corpo === null) return;
    const nome = this.texto(n);
    this.criar(q, nome, "enum", no, `enum ${nome}`, q.classe?.acesso ?? "publica", (q.classe?.acesso ?? "publica") === "publica", no);
  }

  private typedef(no: Node, q: Quadro): void {
    const t = no.childForFieldName("type");
    const d = no.childForFieldName("declarator");
    if (t !== null) this.visitar(t, q);
    if (d === null || this.declaradorDeFuncao(d) !== null) return;
    const alvo = d.type === "type_identifier" || d.type === "primitive_type" ? d : d.descendantsOfType("type_identifier")[0];
    if (alvo === undefined || alvo === null) return;
    const nome = this.texto(alvo);
    this.criar(q, nome, "tipo", no, `typedef … ${nome}`, q.classe?.acesso ?? "publica", true, no);
  }

  private alias(no: Node, q: Quadro): void {
    const n = no.childForFieldName("name");
    if (n === null) return;
    const nome = this.texto(n);
    this.criar(q, nome, "tipo", no, `using ${nome} = …`, "publica", true, no);
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas, dados e padrões

  private chamadaBruta(q: Quadro, alvo: string, receptor: string | null, tipo: "chamada" | "instancia", linha: number): void {
    this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor, tipo, linha }, LIMITES_EXTRACAO.chamadas);
  }

  private receptorTexto(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "identifier":
      case "this":
      case "namespace_identifier":
        return this.texto(no);
      case "field_expression": {
        const a = this.receptorTexto(no.childForFieldName("argument"));
        const f = no.childForFieldName("field");
        if (a === null || f === null) return null;
        return `${a}.${this.texto(f)}`;
      }
      case "qualified_identifier":
        return this.texto(no).replace(/\s+/g, "");
      default:
        return null;
    }
  }

  private partirQualificado(t: string): [string, string | null] {
    const limpo = t.replace(/\s+/g, "").replace(/<[^<>]*>/g, "");
    const i = limpo.lastIndexOf("::");
    return i < 0 ? [limpo, null] : [limpo.slice(i + 2), limpo.slice(0, i).replace(/^::/, "")];
  }

  private chamada(no: Node, q: Quadro): void {
    let fn = no.childForFieldName("function");
    const args = no.childForFieldName("arguments");
    const linha = linhaIni(no);
    if (fn !== null && fn.type === "template_function") fn = fn.childForFieldName("name") ?? fn;
    if (fn !== null) {
      switch (fn.type) {
        case "identifier": {
          const alvo = this.texto(fn);
          if (DINAMICAS.has(alvo)) this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha }, LIMITES_EXTRACAO.dinamicos);
          else if (alvo === "getenv" || alvo === "secure_getenv") {
            const a0 = args?.namedChild(0) ?? null;
            this.empurrar(this.r.padroes, { tipo: "env", nome: a0 !== null && a0.type === "string_literal" ? this.ctx.texto.slice(a0.startIndex + 1, a0.endIndex - 1) : null, linha }, LIMITES_EXTRACAO.padroes);
          }
          if (!IGNORADAS.has(alvo)) this.chamadaBruta(q, alvo, null, "chamada", linha);
          break;
        }
        case "field_expression": {
          const campo = fn.childForFieldName("field");
          if (campo !== null) this.chamadaBruta(q, this.texto(campo), this.receptorTexto(fn.childForFieldName("argument")) ?? "?", "chamada", linha);
          const a = fn.childForFieldName("argument");
          if (a !== null && this.receptorTexto(a) === null) this.visitar(a, q);
          break;
        }
        case "qualified_identifier": {
          const [alvo, escopo] = this.partirQualificado(this.texto(fn));
          this.chamadaBruta(q, alvo, escopo, "chamada", linha);
          break;
        }
        case "parenthesized_expression":
        case "pointer_expression":
          this.empurrar(this.r.dinamicos, { tipo: "chamada_computada", linha }, LIMITES_EXTRACAO.dinamicos);
          this.visitar(fn, q);
          break;
        default:
          this.visitar(fn, q);
      }
    }
    if (args !== null) this.visitarFilhos(args, q);
  }

  private novo(no: Node, q: Quadro): void {
    const t = no.childForFieldName("type");
    if (t !== null) {
      const bruto = t.type === "template_type" ? (t.childForFieldName("name")?.text ?? "") : this.texto(t);
      if (bruto !== "") {
        const [alvo, escopo] = this.partirQualificado(bruto);
        if (/^[A-Za-z_]\w*$/.test(alvo)) this.chamadaBruta(q, alvo, escopo, "instancia", linhaIni(no));
      }
    }
    const args = no.childForFieldName("arguments");
    if (args !== null) this.visitarFilhos(args, q);
  }

  private verificarSql(no: Node, q: Quadro): void {
    if (no.endIndex - no.startIndex < 14) return;
    const partes: string[] = [];
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f !== null && f.type === "string_content") partes.push(this.texto(f));
    }
    let conteudo = partes.length === 0 ? this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1) : partes.join("");
    let confianca: Confianca = "exata";
    if (/%[-+# 0-9.]*(?:hh|h|ll|l|z|j|t|L)?[sdiuoxXfeEgGcp]/.test(conteudo)) {
      conteudo = conteudo.replace(/%[-+# 0-9.]*(?:hh|h|ll|l|z|j|t|L)?[sdiuoxXfeEgGcp]/g, "?");
      confianca = "heuristica";
    }
    for (const t of extrairTabelasSql(conteudo)) this.dado(q.de, t.tabela, t.operacao, linhaIni(no), confianca, "sql");
  }

  private dado(de: string | null, tabela: string, operacao: OperacaoDado, linha: number, confianca: Confianca, fonte: string): void {
    this.empurrar(this.r.dados, { tabela, operacao, de, linha, confianca, fonte }, LIMITES_EXTRACAO.dados);
  }
}

export const extratorCpp: Extrator = {
  extrair(ctx: ContextoExtracao) {
    return new Visitante(ctx).executar();
  },
};
