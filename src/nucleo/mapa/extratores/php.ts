import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { AcessoDadoBruto, Confianca, EntradaBruta, NomeImportado, SimboloBruto, SubtipoSimbolo, Visibilidade } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator PHP (T-17.10). Percurso único da árvore Tree-sitter, sem executar nada.
//
// Convenções que os resolvedores (resolucao/php.ts) devem esperar:
//  - `qualificado` dos símbolos é o FQN com `\` entre namespaces e `.` entre tipo e membro:
//    `App\Models\Cliente`, `App\Models\Cliente.total`, função `App\Support\moeda`. O FQN já traz o namespace.
//  - `imports`: UM por cláusula de `use`. `especificador` = FQN absoluto (sem `\` inicial); `nomes` = [{nome: último
//    segmento, alias}]. `use function X\f` => nome `function f`; `use const X\C` => nome `const C`.
//  - `require/include` com literal => tipo `require`; `__DIR__ . '/x'` e `dirname(__FILE__) . '/x'` => `./x` (relativo
//    ao arquivo). Variável/concatenação com variável => só `dinamicos.require_dinamico`.
//  - `herancas.base`, `chamadas.alvo` e `chamadas.receptor` ficam COMO ESCRITOS (inclusive `\` inicial = absoluto);
//    quem resolve aplica o mapa de `use` e o namespace do arquivo. `use Trait` na classe => `herda`.
//  - receptor: `this`, `self`/`static`/`parent`, nome de classe como escrito, `$var` para variável, `a.b` para
//    cadeias de propriedades, `?` para expressão.
//  - `entradas.handler`: `Classe.metodo` (FQN quando a classe é do mesmo arquivo; como escrito nas rotas).

const VERBOS_LARAVEL: Readonly<Record<string, string>> = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE", options: "OPTIONS", any: "ALL" };
const ACOES_RESOURCE: ReadonlyArray<readonly [string, string, string]> = [
  ["index", "GET", ""],
  ["create", "GET", "/create"],
  ["store", "POST", ""],
  ["show", "GET", "/:p"],
  ["edit", "GET", "/:p/edit"],
  ["update", "PUT", "/:p"],
  ["destroy", "DELETE", "/:p"],
];
const ACOES_API = new Set(["index", "store", "show", "update", "destroy"]);
const ESCRITA_QUERY = new Set(["insert", "insertGetId", "insertOrIgnore", "insertUsing", "update", "updateOrInsert", "upsert", "delete", "truncate", "increment", "decrement"]);
const CHAMADAS_DINAMICAS = new Set(["call_user_func", "call_user_func_array", "forward_static_call", "forward_static_call_array", "call_user_method", "func_get_args_dyn"]);
const TIPOS_NATIVOS = new Set(["self", "static", "parent", "array", "callable", "iterable", "object", "mixed", "void", "null", "never", "bool", "int", "float", "string", "false", "true"]);
const RELATIVOS = new Set(["self", "static", "parent"]);

interface ClasseCtx {
  qualificado: string;
  prefixoRota: string;
  base: string | null;
}

interface Quadro {
  de: string | null;
  prefixo: string;
  classe: ClasseCtx | null;
  contador: { n: number };
  rotaPrefixo: string;
  controller: string | null;
  metodo: string | null;
}

interface Atributo {
  nome: string;
  texto: string;
  args: Node | null;
}

function semBarraFinal(t: string): string {
  return t.replace(/\/+$/, "");
}

/** Normaliza o caminho de rota: `{id}` -> `:id`, barra inicial, sem barra final. */
function normalizarRota(prefixo: string, caminho: string): string {
  const junto = `${semBarraFinal(prefixo)}/${caminho.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  const sem = junto.length > 1 ? semBarraFinal(junto) : junto;
  return (sem.startsWith("/") ? sem : `/${sem}`).replace(/\{(\w+)(\?)?\}/g, (_m, n: string, o: string | undefined) => `:${n}${o ?? ""}`);
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private ns = "";

  constructor(private readonly ctx: ContextoExtracao) {}

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    const q: Quadro = { de: null, prefixo: "", classe: null, contador: this.topo, rotaPrefixo: "", controller: null, metodo: null };
    this.visitarFilhos(raiz, q);
    if (/(^|\/)(public|web|www|htdocs|public_html)\/index\.php$|^index\.php$/.test(this.ctx.caminho)) {
      this.empurrar(this.r.entradas, { tipo: "main", chave: "web:index", framework: "php", handler: null, linha: 1, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    }
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

  /** Nome como escrito (`Foo`, `\Foo\Bar`, `Foo\Bar`); `null` se o nó não é um nome. */
  private nome(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "name" || no.type === "qualified_name" || no.type === "namespace_name" || no.type === "relative_scope") return this.texto(no).replace(/\s+/g, "");
    if (no.type === "named_type") return this.nome(no.namedChild(0));
    return null;
  }

  private fqn(simples: string): string {
    return this.ns === "" ? simples : `${this.ns}\\${simples}`;
  }

  /** Valor de um literal de texto sem interpolação; `null` se não for literal puro. */
  private valorString(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "string") return this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    if (no.type === "encapsed_string") {
      for (let i = 0; i < no.namedChildCount; i++) if (no.namedChild(i)?.type !== "string_content") return null;
      return this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    }
    return null;
  }

  private argumentos(chamada: Node): Node[] {
    const args = chamada.childForFieldName("arguments");
    const saida: Node[] = [];
    if (args === null) return saida;
    for (let i = 0; i < args.namedChildCount; i++) {
      const a = args.namedChild(i);
      if (a !== null && a.type === "argument") saida.push(a);
    }
    return saida;
  }

  /** Valor do argumento (descarta o nome em argumentos nomeados). */
  private valorArg(arg: Node | undefined): Node | null {
    if (arg === undefined) return null;
    const nomeCampo = arg.childForFieldName("name");
    for (let i = 0; i < arg.namedChildCount; i++) {
      const f = arg.namedChild(i);
      if (f !== null && (nomeCampo === null || f.id !== nomeCampo.id)) return f;
    }
    return null;
  }

  private argNomeado(args: Node[], chave: string): Node | null {
    for (const a of args) {
      const n = a.childForFieldName("name");
      if (n !== null && this.texto(n) === chave) return this.valorArg(a);
    }
    return null;
  }

  private posicional(args: Node[], i: number): Node | null {
    const pos = args.filter((a) => a.childForFieldName("name") === null);
    return this.valorArg(pos[i]);
  }

  private strings(array: Node | null): string[] {
    const out: string[] = [];
    if (array === null || array.type !== "array_creation_expression") return out;
    for (let i = 0; i < array.namedChildCount; i++) {
      const el = array.namedChild(i);
      const v = el === null ? null : this.valorString(el.namedChild(el.namedChildCount - 1));
      if (v !== null) out.push(v);
    }
    return out;
  }

  private receptorTexto(no: Node | null): string {
    if (no === null) return "?";
    switch (no.type) {
      case "variable_name": {
        const n = this.texto(no).replace(/^\$/, "");
        return n === "this" ? "this" : `$${n}`;
      }
      case "name":
      case "qualified_name":
      case "relative_scope":
        return this.nome(no) ?? "?";
      case "member_access_expression":
      case "nullsafe_member_access_expression": {
        const o = this.receptorTexto(no.childForFieldName("object"));
        const p = no.childForFieldName("name");
        if (o === "?" || p === null || p.type !== "name") return "?";
        return `${o}.${this.texto(p)}`;
      }
      default:
        return "?";
    }
  }

  private docAnterior(no: Node): string | null {
    const ant = no.previousNamedSibling;
    if (ant === null || ant.type !== "comment") return null;
    const t = this.texto(ant);
    if (!t.startsWith("/**")) return null;
    if (no.startPosition.row - ant.endPosition.row > 1) return null;
    return t;
  }

  private atributos(no: Node): Atributo[] {
    const lista = no.childForFieldName("attributes");
    const out: Atributo[] = [];
    if (lista === null) return out;
    for (const grupo of lista.namedChildren) {
      if (grupo === null) continue;
      for (const at of grupo.namedChildren) {
        if (at === null || at.type !== "attribute") continue;
        const nome = this.nome(at.namedChild(0));
        if (nome === null) continue;
        out.push({ nome, texto: sanitizarAssinatura(`#[${this.texto(at)}]`), args: at.childForFieldName("parameters") });
      }
    }
    return out;
  }

  private argsDeAtributo(a: Atributo): Node[] {
    const out: Node[] = [];
    if (a.args === null) return out;
    for (const f of a.args.namedChildren) if (f !== null && f.type === "argument") out.push(f);
    return out;
  }

  private novoDado(d: AcessoDadoBruto): void {
    this.empurrar(this.r.dados, d, LIMITES_EXTRACAO.dados);
  }

  private novaEntrada(e: EntradaBruta): void {
    this.empurrar(this.r.entradas, e, LIMITES_EXTRACAO.entradas);
  }

  private dinamico(tipo: "eval" | "require_dinamico" | "chamada_computada" | "reflexao", no: Node): void {
    this.empurrar(this.r.dinamicos, { tipo, linha: linhaIni(no) }, LIMITES_EXTRACAO.dinamicos);
  }

  // ---------------------------------------------------------------------------------------------
  // percurso

  private visitarFilhos(no: Node, q: Quadro): void {
    for (let i = 0; i < no.childCount; i++) {
      const f = no.child(i);
      if (f !== null && f.isNamed) this.visitar(f, q);
    }
  }

  private visitar(no: Node, q: Quadro): void {
    if (ehDecisao("php", no)) q.contador.n++;
    switch (no.type) {
      case "namespace_definition":
        this.namespace(no, q);
        return;
      case "namespace_use_declaration":
        this.use(no);
        return;
      case "class_declaration":
        this.tipoDeclarado(no, q, "classe");
        return;
      case "interface_declaration":
        this.tipoDeclarado(no, q, "interface");
        return;
      case "trait_declaration":
        this.tipoDeclarado(no, q, "trait");
        return;
      case "enum_declaration":
        this.tipoDeclarado(no, q, "enum");
        return;
      case "function_definition":
        this.funcao(no, q, "funcao");
        return;
      case "method_declaration":
        this.funcao(no, q, "metodo");
        return;
      case "const_declaration":
        this.constante(no, q);
        return;
      case "require_expression":
      case "require_once_expression":
      case "include_expression":
      case "include_once_expression":
        this.incluir(no, q);
        return;
      case "function_call_expression":
        this.chamadaFuncao(no, q);
        return;
      case "member_call_expression":
      case "nullsafe_member_call_expression":
        this.chamadaMembro(no, q);
        return;
      case "scoped_call_expression":
        this.chamadaEstatica(no, q);
        return;
      case "object_creation_expression":
        this.criacao(no, q);
        return;
      case "class_constant_access_expression": {
        const a = no.namedChild(0);
        const b = no.namedChild(1);
        const nome = this.nome(a);
        if (nome !== null && b !== null && this.texto(b) === "class" && !RELATIVOS.has(nome)) {
          this.empurrar(this.r.chamadas, { de: q.de, alvo: nome, receptor: null, tipo: "referencia", linha: linhaIni(no) }, LIMITES_EXTRACAO.chamadas);
        }
        return;
      }
      case "string":
        this.verificarSql(no, q, false);
        return;
      case "encapsed_string":
        this.verificarSql(no, q, true);
        this.visitarFilhos(no, q);
        return;
      case "throw_expression":
        this.empurrar(this.r.padroes, { tipo: "throw", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
        this.visitarFilhos(no, q);
        return;
      case "catch_clause": {
        const corpo = no.childForFieldName("body");
        if (corpo !== null && corpo.namedChildCount === 0) this.empurrar(this.r.padroes, { tipo: "catch_vazio", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
        this.visitarFilhos(no, q);
        return;
      }
      case "dynamic_variable_name":
        this.dinamico("chamada_computada", no);
        this.visitarFilhos(no, q);
        return;
      case "subscript_expression": {
        const base = no.namedChild(0);
        const chave = this.valorString(no.namedChild(1));
        if (base !== null && base.type === "variable_name" && this.texto(base) === "$_ENV" && chave !== null) {
          this.empurrar(this.r.padroes, { tipo: "env", nome: chave, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
        }
        this.visitarFilhos(no, q);
        return;
      }
      default:
        this.visitarFilhos(no, q);
    }
  }

  private namespace(no: Node, q: Quadro): void {
    const nome = this.nome(no.childForFieldName("name")) ?? "";
    const corpo = no.childForFieldName("body");
    if (corpo === null) {
      this.ns = nome;
      return;
    }
    const anterior = this.ns;
    this.ns = nome;
    this.visitarFilhos(corpo, q);
    this.ns = anterior;
  }

  // ---------------------------------------------------------------------------------------------
  // imports

  private use(no: Node): void {
    const cabeca = this.texto(no).slice(0, 20);
    const kindGlobal = /^use\s+(function|const)\s/.exec(cabeca)?.[1] ?? null;
    let prefixoGrupo: string | null = null;
    const clausulas: Node[] = [];
    for (const f of no.namedChildren) {
      if (f === null) continue;
      if (f.type === "namespace_name") prefixoGrupo = this.nome(f);
      else if (f.type === "namespace_use_clause") clausulas.push(f);
      else if (f.type === "namespace_use_group") for (const c of f.namedChildren) if (c !== null && c.type === "namespace_use_clause") clausulas.push(c);
    }
    for (const c of clausulas) {
      const alvo = c.namedChild(0);
      const alias = c.childForFieldName("alias");
      const base = this.nome(alvo);
      if (base === null) continue;
      const kind = /^(function|const)\s/.exec(this.texto(c))?.[1] ?? kindGlobal;
      const completo = (prefixoGrupo !== null ? `${prefixoGrupo}\\${base}` : base).replace(/^\\/, "");
      const ultimo = completo.split("\\").pop() as string;
      const nomeImp = kind === null ? ultimo : `${kind} ${ultimo}`;
      const nomes: NomeImportado[] = [{ nome: nomeImp, alias: alias === null ? null : this.texto(alias) }];
      this.empurrar(this.r.imports, { especificador: completo, tipo: "estatico", linha: linhaIni(c), so_tipo: false, nomes }, LIMITES_EXTRACAO.imports);
    }
  }

  private incluir(no: Node, q: Quadro): void {
    const arg = no.namedChild(0);
    const esp = this.especificadorInclude(arg);
    if (esp === null) this.dinamico("require_dinamico", no);
    else this.empurrar(this.r.imports, { especificador: esp, tipo: "require", linha: linhaIni(no), so_tipo: false, nomes: [] }, LIMITES_EXTRACAO.imports);
    if (arg !== null) this.visitar(arg, q);
  }

  private ehDirAtual(no: Node | null): boolean {
    if (no === null) return false;
    if (no.type === "name") return this.texto(no) === "__DIR__";
    if (no.type === "function_call_expression") {
      const f = this.nome(no.childForFieldName("function"));
      const a = this.argumentos(no);
      const v = this.valorArg(a[0]);
      return f === "dirname" && a.length === 1 && v !== null && v.type === "name" && this.texto(v) === "__FILE__";
    }
    return false;
  }

  private especificadorInclude(arg: Node | null): string | null {
    if (arg === null) return null;
    let n = arg;
    while (n.type === "parenthesized_expression" && n.namedChild(0) !== null) n = n.namedChild(0) as Node;
    const lit = this.valorString(n);
    if (lit !== null) return lit;
    if (n.type === "binary_expression") {
      const op = n.childForFieldName("operator");
      const e = n.childForFieldName("left");
      const d = n.childForFieldName("right");
      const dir = d === null ? null : this.valorString(d);
      if (op !== null && op.type === "." && this.ehDirAtual(e) && dir !== null) return dir.startsWith("/") ? `.${dir}` : `./${dir}`;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // símbolos

  private criarSimbolo(parcial: Omit<SimboloBruto, "qualificado" | "complexidade"> & { bruto: string }): SimboloBruto | null {
    if (this.r.simbolos.length >= MAX_SIMBOLOS) {
      this.r.truncado = true;
      return null;
    }
    const { bruto, ...resto } = parcial;
    const s: SimboloBruto = { ...resto, qualificado: this.unicos.unico(bruto), complexidade: 0 };
    this.r.simbolos.push(s);
    return s;
  }

  private visibilidade(no: Node): Visibilidade | null {
    for (const f of no.namedChildren) if (f !== null && f.type === "visibility_modifier") return this.texto(f) === "private" ? "privada" : this.texto(f) === "protected" ? "protegida" : "publica";
    return null;
  }

  private assinatura(no: Node): string {
    const attrs = no.childForFieldName("attributes");
    const ini = attrs === null ? no.startIndex : attrs.endIndex;
    const corpo = no.childForFieldName("body");
    const fim = corpo === null ? no.endIndex : corpo.startIndex;
    return sanitizarAssinatura(this.ctx.texto.slice(ini, fim));
  }

  private tiposDeParametros(no: Node, q: Quadro): void {
    const alvos: Node[] = [];
    const params = no.childForFieldName("parameters");
    if (params !== null) {
      for (const p of params.namedChildren) {
        const t = p?.childForFieldName("type");
        if (t !== null && t !== undefined) alvos.push(t);
      }
    }
    const ret = no.childForFieldName("return_type");
    if (ret !== null) alvos.push(ret);
    for (const t of alvos) {
      for (const n of t.descendantsOfType(["name", "qualified_name"])) {
        if (n.parent !== null && n.parent.type === "qualified_name") continue;
        const nome = this.nome(n);
        if (nome === null || TIPOS_NATIVOS.has(nome.toLowerCase())) continue;
        this.empurrar(this.r.chamadas, { de: q.de, alvo: nome, receptor: null, tipo: "referencia", linha: linhaIni(n) }, LIMITES_EXTRACAO.chamadas);
      }
    }
  }

  private funcao(no: Node, q: Quadro, tipo: "funcao" | "metodo"): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = this.texto(nomeNo);
    const vis = tipo === "metodo" ? (this.visibilidade(no) ?? "publica") : null;
    const bruto = tipo === "metodo" && q.classe !== null ? `${q.classe.qualificado}.${nome}` : this.fqn(nome);
    const doc = this.docAnterior(no);
    const attrs = this.atributos(no);
    const s = this.criarSimbolo({
      bruto,
      nome,
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: tipo === "metodo" ? vis === "publica" : true,
      visibilidade: vis,
      assinatura: this.assinatura(no),
      doc: doc === null ? null : primeiraLinhaDoc(doc),
      decoradores: attrs.slice(0, LIMITES_EXTRACAO.decoradores).map((a) => a.texto),
    });
    if (s === null) return;
    const nq: Quadro = { ...q, de: s.qualificado, prefixo: s.qualificado, contador: { n: 0 }, metodo: nome };
    if (tipo === "metodo" && q.classe !== null) this.entradasDeMetodo(no, nq, q.classe, attrs, doc, s.qualificado);
    this.tiposDeParametros(no, nq);
    const corpo = no.childForFieldName("body");
    if (corpo !== null) this.visitar(corpo, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private constante(no: Node, q: Quadro): void {
    const vis = q.classe !== null ? (this.visibilidade(no) ?? "publica") : null;
    for (const el of no.namedChildren) {
      if (el === null || el.type !== "const_element") continue;
      const nomeNo = el.namedChild(0);
      if (nomeNo === null) continue;
      const nome = this.texto(nomeNo);
      this.criarSimbolo({
        bruto: q.classe !== null ? `${q.classe.qualificado}.${nome}` : this.fqn(nome),
        nome,
        tipo: "constante",
        linha: linhaIni(el),
        linha_fim: linhaFim(el),
        exportado: vis === null || vis === "publica",
        visibilidade: vis,
        assinatura: sanitizarAssinatura(`const ${nome}`),
        doc: null,
        decoradores: [],
      });
      const valor = el.namedChild(1);
      if (valor !== null) this.visitar(valor, q);
    }
  }

  private tipoDeclarado(no: Node, q: Quadro, tipo: SubtipoSimbolo): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = this.texto(nomeNo);
    const doc = this.docAnterior(no);
    const attrs = this.atributos(no);
    const s = this.criarSimbolo({
      bruto: this.fqn(nome),
      nome,
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: true,
      visibilidade: null,
      assinatura: this.assinatura(no),
      doc: doc === null ? null : primeiraLinhaDoc(doc),
      decoradores: attrs.slice(0, LIMITES_EXTRACAO.decoradores).map((a) => a.texto),
    });
    if (s === null) return;
    const base = this.nomeDaBase(no);
    const ctx: ClasseCtx = { qualificado: s.qualificado, prefixoRota: this.prefixoSymfony(attrs, doc), base };
    this.herancasDe(no, s.qualificado);
    this.dadosDeClasse(no, s.qualificado, attrs, doc);
    this.entradasDeClasse(no, ctx, attrs, tipo);
    const nq: Quadro = { ...q, de: s.qualificado, prefixo: s.qualificado, classe: ctx, contador: { n: 0 }, metodo: null };
    const corpo = no.childForFieldName("body");
    if (corpo !== null) {
      for (const f of corpo.namedChildren) {
        if (f === null) continue;
        if (f.type === "use_declaration") this.useTrait(f, s.qualificado);
        else if (f.type === "property_declaration") this.propriedade(f, nq);
        else this.visitar(f, nq);
      }
    }
  }

  private nomeDaBase(no: Node): string | null {
    for (const f of no.namedChildren) if (f !== null && f.type === "base_clause") return this.nome(f.namedChild(0));
    return null;
  }

  private herancasDe(no: Node, classe: string): void {
    for (const f of no.namedChildren) {
      if (f === null) continue;
      if (f.type !== "base_clause" && f.type !== "class_interface_clause") continue;
      const tipo = f.type === "base_clause" ? "herda" : "implementa";
      for (const n of f.namedChildren) {
        const base = this.nome(n);
        if (base !== null) this.empurrar(this.r.herancas, { classe, base, tipo, linha: linhaIni(n) }, LIMITES_EXTRACAO.herancas);
      }
    }
  }

  private useTrait(no: Node, classe: string): void {
    for (const n of no.namedChildren) {
      if (n === null) continue;
      const base = this.nome(n);
      if (base !== null) this.empurrar(this.r.herancas, { classe, base, tipo: "herda", linha: linhaIni(n) }, LIMITES_EXTRACAO.herancas);
    }
  }

  private propriedade(no: Node, q: Quadro): void {
    for (const el of no.namedChildren) {
      if (el === null || el.type !== "property_element") continue;
      const v = el.childForFieldName("name");
      const padrao = el.childForFieldName("default_value");
      if (v === null || padrao === null) continue;
      const nome = this.texto(v).replace(/^\$/, "");
      const lit = this.valorString(padrao);
      if (nome === "table" && lit !== null && q.classe !== null) {
        this.novoDado({ tabela: lit.toLowerCase(), operacao: "define", de: q.classe.qualificado, linha: linhaIni(el), confianca: "exata", fonte: "eloquent" });
      } else if (nome === "signature" && lit !== null && q.classe !== null && /Command$/.test(q.classe.base ?? "")) {
        const cmd = lit.trim().split(/\s+/)[0] ?? "";
        if (cmd !== "") this.novaEntrada({ tipo: "cli", chave: `artisan:${cmd}`, framework: "laravel", handler: `${q.classe.qualificado}.handle`, linha: linhaIni(el), confianca: "exata" });
      }
      this.visitar(padrao, q);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // entradas e dados vindos de atributos/anotações

  private rotaDeAtributo(a: Atributo): { caminho: string | null; metodos: string[] } | null {
    if (a.nome !== "Route" && !a.nome.endsWith("\\Route")) return null;
    const args = this.argsDeAtributo(a);
    const cam = this.valorString(this.argNomeado(args, "path") ?? this.posicional(args, 0));
    const metodos = this.strings(this.argNomeado(args, "methods")).map((m) => m.toUpperCase());
    return { caminho: cam, metodos };
  }

  private rotaDeDoc(doc: string | null): { caminho: string; metodos: string[] } | null {
    if (doc === null) return null;
    const m = /@Route\(\s*"([^"]*)"([^)]*)\)/.exec(doc);
    if (m === null) return null;
    const ms = /methods\s*=\s*\{([^}]*)\}/.exec(m[2] ?? "");
    const metodos = ms === null ? [] : [...(ms[1] as string).matchAll(/"(\w+)"/g)].map((x) => (x[1] as string).toUpperCase());
    return { caminho: m[1] as string, metodos };
  }

  private prefixoSymfony(attrs: Atributo[], doc: string | null): string {
    for (const a of attrs) {
      const r = this.rotaDeAtributo(a);
      if (r !== null && r.caminho !== null) return r.caminho;
    }
    return this.rotaDeDoc(doc)?.caminho ?? "";
  }

  private entradasDeMetodo(no: Node, q: Quadro, classe: ClasseCtx, attrs: Atributo[], doc: string | null, handler: string): void {
    const rotas: Array<{ caminho: string; metodos: string[] }> = [];
    for (const a of attrs) {
      const r = this.rotaDeAtributo(a);
      if (r !== null) rotas.push({ caminho: r.caminho ?? "", metodos: r.metodos });
    }
    const d = this.rotaDeDoc(doc);
    if (d !== null) rotas.push(d);
    for (const r of rotas) {
      const caminho = normalizarRota(classe.prefixoRota, r.caminho);
      for (const m of r.metodos.length === 0 ? ["ALL"] : r.metodos) {
        this.novaEntrada({ tipo: "rota", chave: `${m} ${caminho}`, framework: "symfony", handler, linha: linhaIni(no), confianca: "exata" });
      }
    }
    void q;
  }

  private entradasDeClasse(no: Node, ctx: ClasseCtx, attrs: Atributo[], tipo: SubtipoSimbolo): void {
    if (tipo !== "classe") return;
    for (const a of attrs) {
      if (a.nome !== "AsCommand" && !a.nome.endsWith("\\AsCommand")) continue;
      const args = this.argsDeAtributo(a);
      const nome = this.valorString(this.argNomeado(args, "name") ?? this.posicional(args, 0));
      if (nome !== null && nome !== "") {
        this.novaEntrada({ tipo: "cli", chave: `console:${nome}`, framework: "symfony", handler: `${ctx.qualificado}.execute`, linha: linhaIni(no), confianca: "exata" });
      }
    }
  }

  private dadosDeClasse(no: Node, classe: string, attrs: Atributo[], doc: string | null): void {
    for (const a of attrs) {
      if (!/(^|\\)(ORM\\)?Table$/.test(a.nome)) continue;
      const args = this.argsDeAtributo(a);
      const t = this.valorString(this.argNomeado(args, "name") ?? this.posicional(args, 0));
      if (t !== null && t !== "") this.novoDado({ tabela: t.toLowerCase(), operacao: "define", de: classe, linha: linhaIni(no), confianca: "exata", fonte: "doctrine" });
    }
    if (doc !== null) {
      const m = /@ORM\\Table\([^)]*name\s*=\s*"([^"]+)"/.exec(doc);
      if (m !== null) this.novoDado({ tabela: (m[1] as string).toLowerCase(), operacao: "define", de: classe, linha: linhaIni(no), confianca: "exata", fonte: "doctrine" });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas

  private chamar(q: Quadro, alvo: string, receptor: string | null, tipo: "chamada" | "instancia", no: Node): void {
    this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor, tipo, linha: linhaIni(no) }, LIMITES_EXTRACAO.chamadas);
  }

  private chamadaFuncao(no: Node, q: Quadro): void {
    const f = no.childForFieldName("function");
    const args = this.argumentos(no);
    const nome = this.nome(f);
    if (nome === null) {
      this.dinamico("chamada_computada", no);
    } else {
      const simples = nome.replace(/^\\/, "");
      if (simples === "eval" || simples === "create_function" || simples === "assert") {
        if (simples !== "assert") this.dinamico("eval", no);
      } else if (CHAMADAS_DINAMICAS.has(simples)) {
        const alvo = this.valorString(this.valorArg(args[0]));
        if (alvo !== null && /^[A-Za-z_][\w\\]*$/.test(alvo)) this.chamar(q, alvo, null, "chamada", no);
        else this.dinamico("chamada_computada", no);
      } else {
        this.chamar(q, nome, null, "chamada", no);
      }
      this.funcaoEspecial(simples, args, no, q);
    }
    for (const a of args) {
      const v = this.valorArg(a);
      if (v !== null) this.visitar(v, q);
    }
    if (f !== null && nome === null) this.visitar(f, q);
  }

  private funcaoEspecial(nome: string, args: Node[], no: Node, q: Quadro): void {
    if (nome === "getenv" || nome === "env") {
      const v = this.valorString(this.valorArg(args[0]));
      if (v !== null) this.empurrar(this.r.padroes, { tipo: "env", nome: v, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
    } else if (nome === "add_action" || nome === "add_filter") {
      const gancho = this.valorString(this.valorArg(args[0]));
      if (gancho === null) return;
      this.novaEntrada({
        tipo: "evento",
        chave: `${nome === "add_action" ? "action" : "filter"}:${gancho}`,
        framework: "wordpress",
        handler: this.handlerDe(this.valorArg(args[1]), q, null),
        linha: linhaIni(no),
        confianca: "exata",
      });
    } else if (/^(mysqli_query|mysql_query|pg_query|sqlsrv_query)$/.test(nome)) {
      // o SQL literal é tratado em `verificarSql`
    }
  }

  /** Handler de rota/gancho: `[X::class, 'm']`, `'X@m'`, `'func'`, closure (`null`). */
  private handlerDe(no: Node | null, q: Quadro, controller: string | null): string | null {
    if (no === null) return null;
    const lit = this.valorString(no);
    if (lit !== null) {
      if (lit.includes("@")) return lit.replace("@", ".");
      return controller !== null ? `${controller}.${lit}` : lit;
    }
    if (no.type === "array_creation_expression" && no.namedChildCount === 2) {
      const a = no.namedChild(0)?.namedChild(0) ?? null;
      const b = this.valorString(no.namedChild(1)?.namedChild(0) ?? null);
      if (b === null || a === null) return null;
      if (a.type === "class_constant_access_expression") {
        const c = this.nome(a.namedChild(0));
        if (c !== null && !RELATIVOS.has(c)) return `${c}.${b}`;
      }
      if (a.type === "variable_name" && this.texto(a) === "$this" && q.classe !== null) return `${q.classe.qualificado}.${b}`;
      return b;
    }
    if (no.type === "class_constant_access_expression") {
      const c = this.nome(no.namedChild(0));
      if (c !== null) return `${c}.__invoke`;
    }
    return null;
  }

  private chamadaMembro(no: Node, q: Quadro): void {
    const obj = no.childForFieldName("object");
    const nomeNo = no.childForFieldName("name");
    const args = this.argumentos(no);
    if (nomeNo !== null) {
      if (nomeNo.type === "name") {
        const alvo = this.texto(nomeNo);
        this.chamar(q, alvo, this.receptorTexto(obj), "chamada", no);
        this.agendador(alvo, obj, args, no, q);
        if (alvo === "group") {
          this.grupoDeRotas(no, obj, args, q);
          return;
        }
      } else {
        this.dinamico("chamada_computada", no);
      }
    }
    if (obj !== null) this.visitar(obj, q);
    for (const a of args) {
      const v = this.valorArg(a);
      if (v !== null) this.visitar(v, q);
    }
  }

  private agendador(alvo: string, obj: Node | null, args: Node[], no: Node, q: Quadro): void {
    if (q.metodo !== "schedule" || obj === null || obj.type !== "variable_name" || this.texto(obj) !== "$schedule") return;
    if (alvo !== "command" && alvo !== "call" && alvo !== "job" && alvo !== "exec") return;
    const v = this.valorArg(args[0]);
    let chave: string | null = null;
    if (alvo === "command" || alvo === "exec") chave = this.valorString(v);
    else if (alvo === "job" && v !== null && v.type === "object_creation_expression") chave = this.nome(v.namedChild(0));
    else if (alvo === "call") chave = "call";
    if (chave === null) return;
    this.novaEntrada({ tipo: "job", chave: `schedule:${chave}`, framework: "laravel", handler: q.de, linha: linhaIni(no), confianca: "exata" });
  }

  private ehRoute(escopo: Node | null): boolean {
    const n = this.nome(escopo);
    return n !== null && (n === "Route" || n.endsWith("\\Route"));
  }

  /** Prefixo e controller acumulados pela cadeia `Route::prefix('x')->controller(X::class)->group(...)`. */
  private contextoDaCadeia(obj: Node | null): { prefixo: string; controller: string | null } {
    let prefixo = "";
    let controller: string | null = null;
    let n = obj;
    while (n !== null) {
      let nome: string | null = null;
      let args: Node[] = [];
      if (n.type === "member_call_expression") {
        nome = this.nome(n.childForFieldName("name"));
        args = this.argumentos(n);
        const prox = n.childForFieldName("object");
        if (nome === "prefix") prefixo = `${this.valorString(this.valorArg(args[0])) ?? ""}/${prefixo}`;
        else if (nome === "controller") controller = this.nome(this.valorArg(args[0])?.namedChild(0) ?? null) ?? controller;
        n = prox;
      } else if (n.type === "scoped_call_expression") {
        nome = this.nome(n.childForFieldName("name"));
        args = this.argumentos(n);
        if (this.ehRoute(n.childForFieldName("scope"))) {
          if (nome === "prefix") prefixo = `${this.valorString(this.valorArg(args[0])) ?? ""}/${prefixo}`;
          else if (nome === "controller") controller = this.nome(this.valorArg(args[0])?.namedChild(0) ?? null) ?? controller;
        }
        break;
      } else break;
    }
    return { prefixo, controller };
  }

  private grupoDeRotas(no: Node, obj: Node | null, args: Node[], q: Quadro): void {
    const ctxCadeia = this.contextoDaCadeia(obj);
    this.finalizarGrupo(no, obj, args, q, ctxCadeia.prefixo, ctxCadeia.controller, 0);
  }

  private finalizarGrupo(no: Node, obj: Node | null, args: Node[], q: Quadro, prefixo: string, controller: string | null, indiceFechamento: number): void {
    void no;
    if (obj !== null) this.visitar(obj, q);
    const nq: Quadro = { ...q, rotaPrefixo: `${q.rotaPrefixo}/${prefixo}`, controller: controller ?? q.controller };
    args.forEach((a, i) => {
      const v = this.valorArg(a);
      if (v !== null) this.visitar(v, i === args.length - 1 - indiceFechamento ? nq : q);
    });
  }

  private chamadaEstatica(no: Node, q: Quadro): void {
    const escopo = no.childForFieldName("scope");
    const nomeNo = no.childForFieldName("name");
    const args = this.argumentos(no);
    const alvo = nomeNo !== null && nomeNo.type === "name" ? this.texto(nomeNo) : null;
    if (alvo === null) this.dinamico("chamada_computada", no);
    else this.chamar(q, alvo, this.receptorTexto(escopo), "chamada", no);
    if (alvo !== null && escopo !== null) {
      const sc = this.nome(escopo);
      if (this.ehRoute(escopo)) {
        if (this.rotaLaravel(alvo, args, no, q)) return;
        if (alvo === "group") {
          const arr = this.valorArg(args[0]);
          let prefixo = "";
          if (arr !== null && arr.type === "array_creation_expression") {
            for (const el of arr.namedChildren) {
              if (el !== null && el.namedChildCount === 2 && this.valorString(el.namedChild(0)) === "prefix") prefixo = this.valorString(el.namedChild(1)) ?? "";
            }
          }
          this.finalizarGrupo(no, null, args, q, prefixo, null, 0);
          return;
        }
      } else if (sc !== null && /(^|\\)Artisan$/.test(sc) && alvo === "command") {
        const c = this.valorString(this.valorArg(args[0]));
        if (c !== null) this.novaEntrada({ tipo: "cli", chave: `artisan:${c.trim().split(/\s+/)[0] ?? c}`, framework: "laravel", handler: null, linha: linhaIni(no), confianca: "exata" });
      } else if (sc !== null && /(^|\\)DB$/.test(sc) && alvo === "table") {
        this.dadoQueryBuilder(no, args, q);
      }
    }
    for (const a of args) {
      const v = this.valorArg(a);
      if (v !== null) this.visitar(v, q);
    }
  }

  private dadoQueryBuilder(no: Node, args: Node[], q: Quadro): void {
    const t = this.valorString(this.valorArg(args[0]));
    if (t === null || t === "") return;
    let operacao: "le" | "escreve" = "le";
    let atual: Node = no;
    for (;;) {
      const pai: Node | null = atual.parent;
      if (pai === null || pai.type !== "member_call_expression") break;
      const o = pai.childForFieldName("object");
      if (o === null || o.id !== atual.id) break;
      const n = this.nome(pai.childForFieldName("name"));
      if (n !== null && ESCRITA_QUERY.has(n)) operacao = "escreve";
      atual = pai;
    }
    const base = (t.split(".").pop() as string).toLowerCase();
    this.novoDado({ tabela: base, operacao, de: q.de, linha: linhaIni(no), confianca: "exata", fonte: "laravel" });
  }

  private rotaLaravel(verbo: string, args: Node[], no: Node, q: Quadro): boolean {
    const prefixo = q.rotaPrefixo;
    const mk = (metodo: string, caminho: string, handler: string | null): void => {
      this.novaEntrada({ tipo: "rota", chave: `${metodo} ${normalizarRota(prefixo, caminho)}`, framework: "laravel", handler, linha: linhaIni(no), confianca: "exata" });
    };
    const lit0 = this.valorString(this.valorArg(args[0]));
    if (verbo in VERBOS_LARAVEL && lit0 !== null) {
      mk(VERBOS_LARAVEL[verbo] as string, lit0, this.handlerDe(this.valorArg(args[1]), q, q.controller));
      return false;
    }
    if (verbo === "match") {
      const metodos = this.strings(this.valorArg(args[0]));
      const cam = this.valorString(this.valorArg(args[1]));
      if (cam !== null) for (const m of metodos) mk(m.toUpperCase(), cam, this.handlerDe(this.valorArg(args[2]), q, q.controller));
      return false;
    }
    if ((verbo === "resource" || verbo === "apiResource") && lit0 !== null) {
      const ctrlNo = this.valorArg(args[1]);
      const ctrl = ctrlNo !== null && ctrlNo.type === "class_constant_access_expression" ? this.nome(ctrlNo.namedChild(0)) : this.valorString(ctrlNo);
      const recurso = lit0.split(".").pop() as string;
      const singular = recurso.replace(/ies$/, "y").replace(/s$/, "");
      for (const [acao, metodo, sufixo] of ACOES_RESOURCE) {
        if (verbo === "apiResource" && !ACOES_API.has(acao)) continue;
        mk(metodo, `${lit0.replace(/\./g, "/")}${sufixo.replace(":p", `:${singular}`)}`, ctrl === null ? null : `${ctrl}.${acao}`);
      }
      return false;
    }
    return false;
  }

  private criacao(no: Node, q: Quadro): void {
    const alvo = no.namedChild(0);
    if (alvo !== null && alvo.type === "anonymous_class") {
      this.visitarFilhos(alvo, q);
      return;
    }
    const nome = this.nome(alvo);
    if (nome !== null) {
      this.chamar(q, nome, null, "instancia", no);
      if (/^\\?Reflection(Class|Method|Object|Function|Property|NamedType)$/.test(nome)) this.dinamico("reflexao", no);
    } else if (alvo !== null && (alvo.type === "variable_name" || alvo.type === "member_access_expression" || alvo.type === "subscript_expression")) {
      this.dinamico("chamada_computada", no);
    }
    this.visitarFilhos(no, q);
  }

  // ---------------------------------------------------------------------------------------------
  // SQL literal

  private verificarSql(no: Node, q: Quadro, encapsulada: boolean): void {
    if (no.endIndex - no.startIndex < 14) return;
    let conteudo = this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    let confianca: Confianca = "exata";
    if (encapsulada) {
      const interpolada = no.namedChildren.some((c) => c !== null && c.type !== "string_content");
      if (interpolada) {
        conteudo = conteudo.replace(/\{\$[^}]*\}|\$\w+(?:->\w+|\[[^\]]*\])*/g, "?");
        confianca = "heuristica";
      }
    }
    const tabelas = extrairTabelasSql(conteudo);
    if (tabelas.length === 0) return;
    const linha = linhaIni(no);
    for (const t of tabelas) this.novoDado({ tabela: t.tabela, operacao: t.operacao, de: q.de, linha, confianca, fonte: "sql" });
  }
}

export const extratorPhp: Extrator = {
  extrair(ctx: ContextoExtracao) {
    return new Visitante(ctx).executar();
  },
};
