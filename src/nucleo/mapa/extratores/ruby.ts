import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { Confianca, EntradaBruta, OperacaoDado, SimboloBruto, SubtipoSimbolo, TipoDinamico, Visibilidade } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator Ruby (T-17.13). Percurso único da árvore Tree-sitter, sem executar nada (nada de `eval` do projeto).
// Formato (para `resolucao/ruby.ts`):
//  - imports: `require 'x'`/`load`/`autoload` => `tipo:"require"`, `especificador:"x"` (load path => heurística no resolvedor);
//    `require_relative 'x'` => `tipo:"estatico"` e `especificador` SEMPRE com prefixo `./` ou `../` (relativo ao arquivo);
//    `autoload :Foo, 'foo'` => `nomes:[{nome:"Foo"}]`; argumento não literal => dinâmico `require_dinamico`.
//  - nomes qualificados usam `.` (`Admin.Pedido.total`); `class A::B` vira `A.B`. Módulo = `tipo:"classe"` com assinatura `module …`.
//  - herança: `class C < P` => `herda`; `include|extend|prepend M` => `herda` (classe -> `M`, texto completo `A::B`).
//  - entradas de rota: `handler` = `Namespaces.NomeController.acao` (ex.: `Admin.UsersController.index`).

const DSL_IGNORADA = new Set([
  "require", "require_relative", "load", "autoload", "include", "extend", "prepend", "attr_accessor", "attr_reader", "attr_writer", "puts", "print", "p", "pp", "raise", "fail", "private", "public", "protected",
  "module_function", "private_constant", "loop", "lambda", "proc", "format", "sprintf", "printf", "block_given?", "binding", "catch", "throw", "private_class_method", "public_class_method",
  "alias_method", "using", "refine", "yield", "return", "puts_with", "warn", "exit", "abort", "gets",
]);
const SEND = new Set(["send", "public_send", "__send__", "instance_exec", "method", "public_method"]);
const EVAL = new Set(["eval", "instance_eval", "class_eval", "module_eval", "binding_eval"]);
const REFLEXAO = new Set(["const_get", "constantize", "safe_constantize", "define_method", "instance_variable_get", "instance_variable_set", "const_set", "method_missing", "respond_to_missing?"]);
const SCHEMA_DEFINE = new Set(["create_table", "drop_table", "change_table", "add_column", "remove_column", "rename_column", "add_index", "remove_index", "add_foreign_key", "rename_table", "add_reference"]);
const VERBOS_ROTA = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
const BASES_MODELO = /^(ApplicationRecord|ActiveRecord::Base)$/;
const BASES_JOB = /^(ApplicationJob|ActiveJob::Base)$/;
const PALAVRAS_IDENT = new Set(["private", "public", "protected", "module_function", "super", "binding", "__method__", "__FILE__", "__dir__", "self", "nil", "true", "false", "block_given?", "yield", "raise", "loop", "puts"]);

interface EscopoClasse {
  qualificado: string;
  visibilidade: Visibilidade;
  /** Métodos tornados privados/protegidos por `private :nome` depois da definição. */
  marcas: Map<string, Visibilidade>;
  baseModelo: boolean;
  tabelaDeclarada: boolean;
}

interface Quadro {
  de: string | null;
  prefixo: string;
  contador: { n: number };
  classe: EscopoClasse | null;
  /** Nomes locais (parâmetros e variáveis atribuídas) do método atual: identificador "solto" fora daqui é chamada. */
  locais: Set<string> | null;
  rotas: RotaCtx | null;
}

interface RotaCtx {
  prefixoUrl: string;
  namespaces: string[];
  /** Recurso aberto (`resources :users do … end`) para `member`/`collection` e aninhamento. */
  recurso: { nome: string; singular: boolean; url: string } | null;
}

function camelizar(s: string): string {
  return s
    .split(/[_/]/)
    .filter((x) => x !== "")
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join("");
}

function sublinhado(nome: string): string {
  return nome.replace(/([a-z\d])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();
}

function pluralizar(nome: string): string {
  if (/(s|x|z|ch|sh)$/.test(nome)) return `${nome}es`;
  if (/[^aeiou]y$/.test(nome)) return `${nome.slice(0, -1)}ies`;
  return `${nome}s`;
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private temSinatra = false;

  constructor(private readonly ctx: ContextoExtracao) {}

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    this.temSinatra = /\brequire\s*\(?\s*['"]sinatra(\/base)?['"]/.test(this.ctx.texto);
    this.visitarFilhos(raiz, { de: null, prefixo: "", contador: this.topo, classe: null, locais: null, rotas: null });
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

  /** Conteúdo de string/símbolo SEM interpolação; `null` se for outra coisa ou tiver `#{}`. */
  private literal(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "string") {
      if (no.namedChildren.some((c) => c !== null && c.type === "interpolation")) return null;
      return this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    }
    if (no.type === "simple_symbol") return this.texto(no).slice(1);
    return null;
  }

  private argumentos(no: Node): Node[] {
    const a = no.childForFieldName("arguments");
    if (a === null) return [];
    const lista: Node[] = [];
    for (let i = 0; i < a.namedChildCount; i++) {
      const f = a.namedChild(i);
      if (f !== null) lista.push(f);
    }
    return lista;
  }

  private pares(args: Node[]): Map<string, Node> {
    const m = new Map<string, Node>();
    for (const a of args) {
      const lista = a.type === "pair" ? [a] : a.type === "hash" ? a.namedChildren.filter((x): x is Node => x !== null && x.type === "pair") : [];
      for (const p of lista) {
        const k = p.childForFieldName("key");
        const v = p.childForFieldName("value");
        if (k !== null && v !== null) m.set(this.texto(k).replace(/^:|:$|"/g, ""), v);
      }
    }
    return m;
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
    if (ehDecisao("ruby", no)) q.contador.n++;
    switch (no.type) {
      case "comment":
        return;
      case "class":
        this.classe(no, q, false);
        return;
      case "module":
        this.classe(no, q, true);
        return;
      case "method":
      case "singleton_method":
        this.metodo(no, q);
        return;
      case "assignment":
        this.atribuicao(no, q);
        return;
      case "call":
        this.chamada(no, q);
        return;
      case "identifier":
        this.identificadorSolto(no, q);
        return;
      case "string":
        this.verificarSql(no, q);
        return;
      case "element_reference": {
        const o = no.childForFieldName("object");
        if (o !== null && this.texto(o) === "ENV") {
          const chave = no.namedChild(1);
          this.empurrar(this.r.padroes, { tipo: "env", nome: this.literal(chave), linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
          return;
        }
        this.visitarFilhos(no, q);
        return;
      }
      case "heredoc_body":
        this.verificarHeredoc(no, q);
        return;
      case "rescue": {
        const vazio = no.namedChildren.every((c) => c === null || c.type === "exceptions" || c.type === "exception_variable");
        if (vazio) this.empurrar(this.r.padroes, { tipo: "catch_vazio", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
        this.visitarFilhos(no, q);
        return;
      }
      case "if": {
        const cond = no.childForFieldName("condition");
        if (cond !== null && q.de === null && /__FILE__\s*==\s*(\$0|\$PROGRAM_NAME)|\$0\s*==\s*__FILE__/.test(this.texto(cond))) {
          this.empurrar(this.r.entradas, { tipo: "main", chave: "main", framework: "ruby", handler: null, linha: linhaIni(no), confianca: "exata" }, LIMITES_EXTRACAO.entradas);
        }
        this.visitarFilhos(no, q);
        return;
      }
      default:
        this.visitarFilhos(no, q);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // símbolos

  private doc(no: Node): string | null {
    const partes: string[] = [];
    let alvo = no.startPosition.row;
    // o 1º comentário dentro de `module X`/`class X` é irmão do corpo, não do item
    let inicio = no.previousSibling;
    if (inicio === null && no.parent !== null && no.parent.type === "body_statement") inicio = no.parent.previousSibling;
    for (let p = inicio; p !== null && p.type === "comment" && p.endPosition.row >= alvo - 1; p = p.previousSibling) {
      partes.unshift(this.texto(p));
      alvo = p.startPosition.row;
    }
    return partes.length === 0 ? null : primeiraLinhaDoc(partes.join("\n"));
  }

  private criar(q: Quadro, nome: string, tipo: SubtipoSimbolo, no: Node, assinatura: string, visibilidade: Visibilidade, docDe: Node = no): SimboloBruto | null {
    if (this.r.simbolos.length >= MAX_SIMBOLOS) {
      this.r.truncado = true;
      return null;
    }
    const s: SimboloBruto = {
      nome,
      qualificado: this.unicos.unico(q.prefixo === "" ? nome : `${q.prefixo}.${nome}`),
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: visibilidade === "publica",
      visibilidade,
      complexidade: 0,
      assinatura: sanitizarAssinatura(assinatura),
      doc: this.doc(docDe),
      decoradores: [],
    };
    this.r.simbolos.push(s);
    return s;
  }

  private nomeConstante(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "constant" || no.type === "scope_resolution") return this.texto(no).replace(/\s+/g, "");
    return null;
  }

  private classe(no: Node, q: Quadro, ehModulo: boolean): void {
    const nomeBruto = this.nomeConstante(no.childForFieldName("name"));
    const corpo = no.childForFieldName("body");
    if (nomeBruto === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = nomeBruto.replace(/^::/, "").replace(/::/g, ".");
    const super_ = no.childForFieldName("superclass");
    const baseTxt = super_ === null ? null : this.nomeConstante(super_.namedChild(0));
    const s = this.criar(q, nome, "classe", no, `${ehModulo ? "module" : "class"} ${nomeBruto}${baseTxt !== null ? ` < ${baseTxt}` : ""}`, "publica");
    if (s === null) {
      if (corpo !== null) this.visitarFilhos(corpo, q);
      return;
    }
    if (baseTxt !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base: baseTxt, tipo: "herda", linha: linhaIni(no) }, LIMITES_EXTRACAO.herancas);
    const escopo: EscopoClasse = { qualificado: s.qualificado, visibilidade: "publica", marcas: new Map(), baseModelo: baseTxt !== null && BASES_MODELO.test(baseTxt), tabelaDeclarada: false };
    const nq: Quadro = { de: s.qualificado, prefixo: s.qualificado, contador: { n: 0 }, classe: escopo, locais: null, rotas: null };
    if (baseTxt !== null) this.entradasDaClasse(s, baseTxt);
    if (corpo !== null) this.visitarFilhos(corpo, nq);
    s.complexidade = 1 + nq.contador.n;
    for (const [m, v] of escopo.marcas) {
      const alvo = this.r.simbolos.find((x) => x.qualificado === `${s.qualificado}.${m}`);
      if (alvo !== undefined) {
        alvo.visibilidade = v;
        alvo.exportado = false;
      }
    }
    if (escopo.baseModelo && !escopo.tabelaDeclarada) {
      const ultimo = nome.split(".").pop() as string;
      this.dado(nq, pluralizar(sublinhado(ultimo)), "desconhecida", s.linha, "heuristica", "activerecord");
    }
    // `complexidade` de classe não entra na soma do arquivo (só funcao/metodo entram), então não afeta a métrica.
  }

  private entradasDaClasse(s: SimboloBruto, base: string): void {
    if (BASES_JOB.test(base)) this.empurrar(this.r.entradas, { tipo: "job", chave: `activejob:${s.nome}`, framework: "activejob", handler: `${s.qualificado}.perform`, linha: s.linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    else if (base === "Thor") this.empurrar(this.r.entradas, { tipo: "cli", chave: `thor:${s.nome}`, framework: "thor", handler: null, linha: s.linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
  }

  private metodo(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = this.texto(nomeNo);
    const singleton = no.type === "singleton_method";
    const emClasse = q.classe !== null;
    const vis: Visibilidade = singleton ? "publica" : (q.classe?.visibilidade ?? "publica");
    const params = no.childForFieldName("parameters");
    const cab = `def ${singleton ? "self." : ""}${nome}${params !== null ? this.texto(params) : ""}`;
    const s = this.criar(q, nome, emClasse || singleton ? "metodo" : "funcao", no, cab, vis);
    if (s === null) {
      this.visitarFilhos(no, q);
      return;
    }
    if (nome === "method_missing" || nome === "respond_to_missing?") this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha: s.linha }, LIMITES_EXTRACAO.dinamicos);
    const locais = this.locaisDe(no);
    const nq: Quadro = { de: s.qualificado, prefixo: s.qualificado, contador: { n: 0 }, classe: null, locais, rotas: null };
    const corpo = no.childForFieldName("body");
    if (corpo !== null) this.visitarFilhos(corpo, nq);
    s.complexidade = 1 + nq.contador.n;
    const dono = q.classe;
    if (dono !== null && (nome === "perform" || nome === "call")) this.entradaDeJob(dono, s, nome);
  }

  private entradaDeJob(escopo: EscopoClasse, s: SimboloBruto, nome: string): void {
    if (nome !== "perform") return;
    const classe = this.r.simbolos.find((x) => x.qualificado === escopo.qualificado);
    if (classe === undefined) return;
    const incl = this.r.herancas.some((h) => h.classe === escopo.qualificado && /^Sidekiq::(Worker|Job)$/.test(h.base));
    if (incl && !this.r.entradas.some((e) => e.chave === `sidekiq:${classe.nome}`)) {
      this.empurrar(this.r.entradas, { tipo: "job", chave: `sidekiq:${classe.nome}`, framework: "sidekiq", handler: s.qualificado, linha: s.linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    }
  }

  private locaisDe(metodo: Node): Set<string> {
    const nomes = new Set<string>();
    const params = metodo.childForFieldName("parameters");
    if (params !== null) for (const id of params.descendantsOfType("identifier")) if (id !== null) nomes.add(this.texto(id));
    const corpo = metodo.childForFieldName("body");
    if (corpo !== null) {
      for (const t of ["assignment", "operator_assignment"]) {
        for (const a of corpo.descendantsOfType(t)) {
          const l = a?.childForFieldName("left") ?? null;
          if (l !== null && l.type === "identifier") nomes.add(this.texto(l));
        }
      }
      for (const lista of corpo.descendantsOfType(["left_assignment_list", "block_parameters", "lambda_parameters"])) {
        if (lista !== null) for (const id of lista.descendantsOfType("identifier")) if (id !== null) nomes.add(this.texto(id));
      }
    }
    return nomes;
  }

  private identificadorSolto(no: Node, q: Quadro): void {
    const p = no.parent;
    if (q.classe !== null && p !== null && p.type === "body_statement") {
      const t = this.texto(no);
      if (t === "private" || t === "protected" || t === "public") {
        q.classe.visibilidade = t === "private" ? "privada" : t === "protected" ? "protegida" : "publica";
        return;
      }
    }
    if (q.locais === null || p === null) return;
    if (!["body_statement", "then", "else", "begin", "do_block", "block_body"].includes(p.type)) return;
    const nome = this.texto(no);
    if (q.locais.has(nome) || PALAVRAS_IDENT.has(nome) || DSL_IGNORADA.has(nome)) return;
    this.chamadaBruta(q, nome, null, "chamada", linhaIni(no));
  }

  private atribuicao(no: Node, q: Quadro): void {
    const l = no.childForFieldName("left");
    const r = no.childForFieldName("right");
    if (l !== null && l.type === "constant" && q.locais === null) {
      const nome = this.texto(l);
      this.criar(q, nome, "constante", no, `${nome} = …`, "publica");
    }
    if (l !== null && l.type === "call" && q.classe !== null) {
      const m = l.childForFieldName("method");
      if (m !== null && this.texto(m) === "table_name") {
        const t = this.literal(r);
        if (t !== null && /^[A-Za-z_][\w.]*$/.test(t)) {
          q.classe.tabelaDeclarada = true;
          this.dado(q, (t.split(".").pop() as string).toLowerCase(), "desconhecida", linhaIni(no), "exata", "activerecord");
        }
      }
    }
    if (r !== null) this.visitar(r, q);
    if (l !== null && l.type === "call") this.visitar(l, q);
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas

  private receptorTexto(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "constant":
      case "identifier":
      case "self":
      case "instance_variable":
      case "class_variable":
      case "global_variable":
        return this.texto(no);
      case "scope_resolution": {
        const t = this.texto(no).replace(/\s+/g, "");
        return t.length > 120 ? null : t;
      }
      default:
        return null;
    }
  }

  private chamadaBruta(q: Quadro, alvo: string, receptor: string | null, tipo: "chamada" | "instancia", linha: number): void {
    this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor, tipo, linha }, LIMITES_EXTRACAO.chamadas);
  }

  private dinamico(tipo: TipoDinamico, linha: number): void {
    this.empurrar(this.r.dinamicos, { tipo, linha }, LIMITES_EXTRACAO.dinamicos);
  }

  private chamada(no: Node, q: Quadro): void {
    const m = no.childForFieldName("method");
    const recv = no.childForFieldName("receiver");
    const bloco = no.childForFieldName("block");
    const linha = linhaIni(no);
    if (m === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = this.texto(m);
    const args = this.argumentos(no);
    const semReceptor = recv === null;

    // rotas (Rails): a chamada `routes.draw do … end` abre o contexto de rotas
    if (nome === "draw" && recv !== null && /routes$/.test(this.texto(recv).replace(/\s+/g, ""))) {
      if (bloco !== null) this.visitarFilhos(bloco, { ...q, rotas: { prefixoUrl: "", namespaces: [], recurso: null } });
      return;
    }
    if (q.rotas !== null && semReceptor) {
      this.chamadaDeRota(no, nome, args, bloco, q);
      return;
    }

    if (semReceptor) {
      if (this.chamadaDsl(no, nome, args, bloco, q)) return;
    } else {
      if (nome === "new") {
        const rt = this.receptorTexto(recv);
        if (rt !== null && /^[A-Z]/.test(rt.split("::").pop() as string)) {
          const i = rt.lastIndexOf("::");
          this.chamadaBruta(q, i < 0 ? rt : rt.slice(i + 2), i < 0 ? null : rt.slice(0, i), "instancia", linha);
        } else this.chamadaBruta(q, nome, rt ?? "?", "chamada", linha);
      } else if (SEND.has(nome)) this.dinamico("chamada_computada", linha);
      else if (EVAL.has(nome)) this.dinamico("eval", linha);
      else if (REFLEXAO.has(nome)) this.dinamico("reflexao", linha);
      else {
        const rt = this.receptorTexto(recv);
        this.chamadaBruta(q, nome, rt ?? "?", "chamada", linha);
        this.efeitosComReceptor(no, nome, rt, args, q);
      }
      if (recv !== null && !["constant", "identifier", "self", "scope_resolution"].includes(recv.type)) this.visitar(recv, q);
    }
    for (const a of args) this.visitar(a, q);
    if (bloco !== null) this.visitarFilhos(bloco, q);
  }

  private efeitosComReceptor(no: Node, nome: string, receptor: string | null, args: Node[], q: Quadro): void {
    if (receptor === "ENV" && (nome === "fetch" || nome === "dig")) {
      this.empurrar(this.r.padroes, { tipo: "env", nome: this.literal(args[0] ?? null), linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
    }
    void q;
  }

  /** DSL sem receptor. Devolve `true` se já tratou os filhos. */
  private chamadaDsl(no: Node, nome: string, args: Node[], bloco: Node | null, q: Quadro): boolean {
    const linha = linhaIni(no);
    switch (nome) {
      case "require":
      case "load":
      case "require_relative":
      case "autoload": {
        const idx = nome === "autoload" ? 1 : 0;
        const lit = this.literal(args[idx] ?? null);
        if (lit === null) {
          if (args.length > 0) this.dinamico("require_dinamico", linha);
          return true;
        }
        const relativo = nome === "require_relative" ? (lit.startsWith(".") ? lit : `./${lit}`) : lit;
        const nomes = nome === "autoload" && args[0] !== undefined ? [{ nome: this.literal(args[0]) ?? this.texto(args[0]), alias: null }] : [];
        this.empurrar(this.r.imports, { especificador: relativo, tipo: nome === "require_relative" ? "estatico" : "require", linha, so_tipo: false, nomes }, LIMITES_EXTRACAO.imports);
        return true;
      }
      case "include":
      case "extend":
      case "prepend": {
        if (q.classe !== null) {
          for (const a of args) {
            const base = this.nomeConstante(a);
            if (base !== null) this.empurrar(this.r.herancas, { classe: q.classe.qualificado, base, tipo: "herda", linha }, LIMITES_EXTRACAO.herancas);
          }
        }
        return true;
      }
      case "private":
      case "protected":
      case "public": {
        const v: Visibilidade = nome === "private" ? "privada" : nome === "protected" ? "protegida" : "publica";
        if (q.classe === null) return true;
        for (const a of args) {
          if (a.type === "method" || a.type === "singleton_method") {
            this.visitar(a, { ...q, classe: { ...q.classe, visibilidade: v } });
            const n = a.childForFieldName("name");
            const s = n === null ? undefined : this.r.simbolos.find((x) => x.qualificado === `${q.classe?.qualificado}.${this.texto(n)}`);
            if (s !== undefined) s.exportado = v === "publica";
          } else {
            const lit = this.literal(a);
            if (lit !== null) q.classe.marcas.set(lit, v);
          }
        }
        return true;
      }
      case "raise":
      case "fail":
        this.empurrar(this.r.padroes, { tipo: "throw", nome: null, linha }, LIMITES_EXTRACAO.padroes);
        for (const a of args) this.visitar(a, q);
        return true;
      case "task":
        if (q.de === null && bloco !== null) {
          const a0 = args[0];
          let nomeTask: string | null = this.literal(a0 ?? null);
          if (nomeTask === null && a0 !== undefined) {
            const p = this.pares([a0]);
            nomeTask = [...p.keys()][0] ?? null;
          }
          if (nomeTask !== null) this.empurrar(this.r.entradas, { tipo: "cli", chave: `rake:${nomeTask}`, framework: "rake", handler: null, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
        }
        if (bloco !== null) this.visitarFilhos(bloco, q);
        return true;
      default:
    }
    if (SCHEMA_DEFINE.has(nome) && args.length > 0) {
      const t = this.literal(args[0] as Node);
      if (t !== null && /^[A-Za-z_]\w*$/.test(t)) this.dado(q, t.toLowerCase(), "define", linha, "exata", "migracao");
      if (bloco !== null) this.visitarFilhos(bloco, q);
      return true;
    }
    if (SEND.has(nome)) {
      this.dinamico("chamada_computada", linha);
      return true;
    }
    if (EVAL.has(nome)) {
      this.dinamico("eval", linha);
      return true;
    }
    if (REFLEXAO.has(nome)) {
      this.dinamico("reflexao", linha);
      for (const a of args) this.visitar(a, q);
      if (bloco !== null) this.visitarFilhos(bloco, q);
      return true;
    }
    // Sinatra: `get '/x' do … end` no topo, em arquivo que requer o sinatra
    if (VERBOS_ROTA.has(nome) && q.de === null && bloco !== null && this.temSinatra) {
      const rota = this.literal(args[0] ?? null);
      if (rota !== null && rota.startsWith("/")) {
        this.empurrar(this.r.entradas, { tipo: "rota", chave: `${nome.toUpperCase()} ${rota}`, framework: "sinatra", handler: null, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      }
    }
    if (!DSL_IGNORADA.has(nome)) this.chamadaBruta(q, nome, null, "chamada", linha);
    for (const a of args) this.visitar(a, q);
    if (bloco !== null) this.visitarFilhos(bloco, q);
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // rotas do Rails

  private urlJunta(prefixo: string, trecho_: string): string {
    const t = trecho_.replace(/^\/+|\/+$/g, "");
    if (t === "") return prefixo === "" ? "/" : prefixo;
    return `${prefixo}/${t}`;
  }

  private handlerRota(ctx: RotaCtx, destino: string | null): string | null {
    if (destino === null) return null;
    const m = /^([\w/]+)#(\w+)$/.exec(destino);
    if (m === null) return null;
    const ns = [...ctx.namespaces.map(camelizar), ...(m[1] as string).split("/").map(camelizar)];
    const ultimo = ns.pop() as string;
    return [...ns, `${ultimo}Controller`, m[2]].join(".");
  }

  private rota(q: Quadro, chave: string, handler: string | null, linha: number, confianca: Confianca = "exata"): void {
    this.empurrar(this.r.entradas, { tipo: "rota", chave, framework: "rails", handler, linha, confianca } satisfies EntradaBruta, LIMITES_EXTRACAO.entradas);
    void q;
  }

  private chamadaDeRota(no: Node, nome: string, args: Node[], bloco: Node | null, q: Quadro): void {
    const ctx = q.rotas as RotaCtx;
    const linha = linhaIni(no);
    const opcoes = this.pares(args);
    const filhos = (novo: RotaCtx): void => {
      if (bloco !== null) this.visitarFilhos(bloco, { ...q, rotas: novo });
    };
    if (nome === "namespace" || nome === "scope") {
      const a0 = this.literal(args[0] ?? null);
      const caminho = nome === "namespace" ? a0 : (opcoes.get("path") !== undefined ? this.literal(opcoes.get("path") as Node) : a0);
      const modulo = nome === "namespace" ? a0 : (opcoes.get("module") !== undefined ? this.literal(opcoes.get("module") as Node) : null);
      filhos({ prefixoUrl: caminho === null ? ctx.prefixoUrl : this.urlJunta(ctx.prefixoUrl, caminho), namespaces: modulo === null ? ctx.namespaces : [...ctx.namespaces, modulo], recurso: ctx.recurso });
      return;
    }
    if (nome === "resources" || nome === "resource") {
      const singular = nome === "resource";
      const nomes = args.map((a) => this.literal(a)).filter((x): x is string => x !== null);
      for (const rec of nomes) this.recursoRest(q, ctx, rec, singular, opcoes, linha, filhos);
      return;
    }
    if (nome === "member" || nome === "collection") {
      if (ctx.recurso !== null) {
        const base = ctx.recurso.url;
        filhos({ ...ctx, prefixoUrl: nome === "member" && !ctx.recurso.singular ? `${base}/:id` : base });
      }
      return;
    }
    if (nome === "root") {
      const destino = this.literal(args[0] ?? null) ?? (opcoes.get("to") !== undefined ? this.literal(opcoes.get("to") as Node) : null);
      this.rota(q, "GET /", this.handlerRota(ctx, destino), linha);
      return;
    }
    if (VERBOS_ROTA.has(nome) || nome === "match") {
      const a0 = args[0];
      const l0 = this.literal(a0 ?? null);
      const para = opcoes.get("to") !== undefined ? this.literal(opcoes.get("to") as Node) : null;
      const acao = a0?.type === "simple_symbol" ? (l0 as string) : null;
      const caminho = l0 ?? (a0 !== undefined && a0.type === "pair" ? null : null);
      if (caminho === null) return;
      const url = this.urlJunta(ctx.prefixoUrl, caminho);
      let handler = this.handlerRota(ctx, para);
      if (handler === null && acao !== null && ctx.recurso !== null) handler = this.handlerRota(ctx, `${ctx.recurso.nome}#${acao}`);
      this.rota(q, `${nome === "match" ? "ALL" : nome.toUpperCase()} ${url}`, handler, linha, "exata");
      return;
    }
    this.chamadaDsl(no, nome, args, bloco, { ...q, rotas: null });
  }

  private recursoRest(q: Quadro, ctx: RotaCtx, rec: string, singular: boolean, opcoes: Map<string, Node>, linha: number, filhos: (n: RotaCtx) => void): void {
    const base = this.urlJunta(ctx.prefixoUrl, rec);
    const idParam = `:${singular ? rec : rec.replace(/s$/, "")}_id`;
    const lista = (n: Node | undefined): string[] | null => (n === undefined ? null : n.namedChildren.map((c) => (c === null ? null : this.literal(c))).filter((x): x is string => x !== null));
    const only = lista(opcoes.get("only"));
    const except = lista(opcoes.get("except")) ?? [];
    const todas: Array<[string, string, string]> = singular
      ? [["show", "GET", base], ["new", "GET", `${base}/new`], ["create", "POST", base], ["edit", "GET", `${base}/edit`], ["update", "PATCH", base], ["destroy", "DELETE", base]]
      : [["index", "GET", base], ["create", "POST", base], ["new", "GET", `${base}/new`], ["edit", "GET", `${base}/:id/edit`], ["show", "GET", `${base}/:id`], ["update", "PATCH", `${base}/:id`], ["destroy", "DELETE", `${base}/:id`]];
    for (const [acao, verbo, url] of todas) {
      if (only !== null && !only.includes(acao)) continue;
      if (except.includes(acao)) continue;
      this.rota(q, `${verbo} ${url}`, this.handlerRota(ctx, `${rec}#${acao}`), linha);
    }
    filhos({ prefixoUrl: singular ? base : `${base}/${idParam}`, namespaces: ctx.namespaces, recurso: { nome: rec, singular, url: base } });
  }

  // ---------------------------------------------------------------------------------------------
  // dados

  private verificarSql(no: Node, q: Quadro): void {
    if (no.endIndex - no.startIndex < 14) return;
    let heuristica = false;
    let conteudo = "";
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f === null) continue;
      if (f.type === "interpolation") {
        conteudo += "?";
        heuristica = true;
      } else conteudo += this.texto(f);
    }
    this.sql(conteudo, q, linhaIni(no), heuristica);
  }

  private verificarHeredoc(no: Node, q: Quadro): void {
    let heuristica = false;
    let conteudo = "";
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f === null) continue;
      if (f.type === "interpolation") {
        conteudo += "?";
        heuristica = true;
      } else if (f.type === "heredoc_content") conteudo += this.texto(f);
    }
    this.sql(conteudo.trim(), q, linhaIni(no), heuristica);
  }

  private sql(conteudo: string, q: Quadro, linha: number, heuristica: boolean): void {
    const confianca: Confianca = heuristica ? "heuristica" : "exata";
    for (const t of extrairTabelasSql(conteudo)) this.dado(q, t.tabela, t.operacao, linha, confianca, "sql");
  }

  private dado(q: Pick<Quadro, "de">, tabela: string, operacao: OperacaoDado, linha: number, confianca: Confianca, fonte: string): void {
    this.empurrar(this.r.dados, { tabela, operacao, de: q.de, linha, confianca, fonte }, LIMITES_EXTRACAO.dados);
  }
}

export const extratorRuby: Extrator = {
  extrair(ctx: ContextoExtracao) {
    return new Visitante(ctx).executar();
  },
};
