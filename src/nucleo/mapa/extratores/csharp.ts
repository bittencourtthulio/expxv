import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { AcessoDadoBruto, Confianca, EntradaBruta, NomeImportado, SimboloBruto, SubtipoSimbolo, Visibilidade } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator C# (T-17.11). Percurso único da árvore Tree-sitter, sem executar nada.
//
// Convenções que os resolvedores (resolucao/csharp.ts) devem esperar:
//  - `qualificado` é o FQN com `.`: `Loja.Web.PedidosController`, `Loja.Web.PedidosController.Get`; tipos aninhados
//    `Ns.Externa.Aninhada`; construtor `Tipo.ctor`; função local `Tipo.Metodo.Local`; sobrecarga `~2`.
//    Record => `classe`; struct => `struct`.
//  - `imports`: um por `using`. `especificador` = namespace (ou tipo, no `using static` e no alias). `using static X`
//    => nomes [{nome:"static"}]; `using A = X.Y` => especificador `X.Y`, nomes [{nome:"*", alias:"A"}];
//    `global using` é igual ao comum.
//  - `herancas`: a base list é ambígua em C#; usamos a convenção `I` + maiúscula => `implementa`, senão `herda`
//    (interface estendendo interface => `implementa`). O resolvedor refina com o índice de tipos.
//  - DI (`services.AddScoped<IFoo, Foo>()` ou `AddX(typeof(IFoo), typeof(Foo))`): `HerancaBruta{classe:"Foo",
//    base:"IFoo", tipo:"implementa"}` com nomes COMO ESCRITOS. A `classe` pode não ser símbolo deste arquivo: é assim
//    que o resolvedor reconhece que é ligação de DI (e não declaração). A chamada `AddScoped` também é registrada.
//    `AddX<T>()` de um tipo só => chamada `referencia` a T.
//  - `chamadas.receptor`: `this`, `base`, identificador, `a.b` (cadeia), `?` (expressão/acesso condicional encadeado).
//  - `entradas.handler`: FQN do método quando é do mesmo arquivo; `Classe.Metodo` como escrito nas Minimal APIs.

const VERBOS_HTTP: Readonly<Record<string, string>> = { HttpGet: "GET", HttpPost: "POST", HttpPut: "PUT", HttpDelete: "DELETE", HttpPatch: "PATCH", HttpHead: "HEAD", HttpOptions: "OPTIONS" };
const VERBOS_MAP: Readonly<Record<string, string>> = { MapGet: "GET", MapPost: "POST", MapPut: "PUT", MapDelete: "DELETE", MapPatch: "PATCH" };
const DI_REGISTRO = /^(Try)?Add(Scoped|Singleton|Transient|KeyedScoped|KeyedSingleton|KeyedTransient|HostedService)$/;
const REFLEXAO = new Set(["CreateInstance", "GetMethod", "GetMethods", "GetProperty", "GetProperties", "GetField", "GetConstructor", "InvokeMember", "CreateInstanceFrom"]);
const TIPOS_DECLARADOS: Readonly<Record<string, SubtipoSimbolo>> = {
  class_declaration: "classe",
  record_declaration: "classe",
  record_struct_declaration: "struct",
  struct_declaration: "struct",
  interface_declaration: "interface",
  enum_declaration: "enum",
};

interface ClasseCtx {
  qualificado: string;
  simples: string;
  ehInterface: boolean;
  prefixoRota: string;
  controller: boolean;
  bases: string[];
}

interface Quadro {
  de: string | null;
  classe: ClasseCtx | null;
  contador: { n: number };
}

interface Atributo {
  nome: string;
  texto: string;
  valores: Node[];
}

function normalizarRota(prefixo: string, caminho: string, controller: string, acao: string): string {
  const absoluto = caminho.startsWith("/") || caminho.startsWith("~/");
  const base = absoluto ? caminho.replace(/^~?\//, "") : [prefixo, caminho].filter((x) => x !== "").join("/");
  const sub = base
    .replace(/\[controller\]/gi, controller.toLowerCase())
    .replace(/\[action\]/gi, acao.toLowerCase())
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\{\*?(\w+)(?::[^}?]*)?(\?)?\}/g, (_m, n: string, o: string | undefined) => `:${n}${o ?? ""}`);
  return `/${sub}`;
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private ns = "";

  constructor(private readonly ctx: ContextoExtracao) {}

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    this.visitarFilhos(raiz, { de: null, classe: null, contador: this.topo });
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

  /** Nome de tipo como escrito, sem argumentos genéricos; `null` para tipos predefinidos e formas não nomeadas. */
  private nomeTipo(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "identifier":
        return this.texto(no);
      case "generic_name":
        return this.nomeTipo(no.namedChild(0));
      case "qualified_name":
      case "alias_qualified_name":
        return this.texto(no).replace(/<[^<>]*(<[^<>]*>[^<>]*)*>/g, "").replace(/\s+/g, "");
      case "nullable_type":
        return this.nomeTipo(no.namedChild(0));
      case "array_type":
        return this.nomeTipo(no.childForFieldName("type"));
      default:
        return null;
    }
  }

  private argsGenericos(no: Node | null): string[] {
    if (no === null || no.type !== "generic_name") return [];
    const lista = no.namedChildren.find((c) => c !== null && c.type === "type_argument_list");
    if (lista === undefined || lista === null) return [];
    const out: string[] = [];
    for (const t of lista.namedChildren) {
      const n = this.nomeTipo(t);
      if (n !== null) out.push(n);
    }
    return out;
  }

  /** Conteúdo de um literal de texto sem interpolação; `null` se não for literal puro. */
  private valorString(no: Node | null): string | null {
    if (no === null) return null;
    const t = this.texto(no);
    switch (no.type) {
      case "string_literal":
        return t.startsWith('"""') ? t.slice(3, -3) : t.slice(1, -1);
      case "verbatim_string_literal":
        return t.slice(2, -1);
      case "raw_string_literal":
        return t.slice(3, -3);
      default:
        return null;
    }
  }

  private argumentos(inv: Node): Node[] {
    const lista = inv.childForFieldName("arguments");
    const out: Node[] = [];
    if (lista === null) return out;
    for (const a of lista.namedChildren) if (a !== null && a.type === "argument") out.push(a);
    return out;
  }

  private valorArg(a: Node | undefined): Node | null {
    if (a === undefined) return null;
    return a.namedChild(a.namedChildCount - 1);
  }

  private receptorTexto(no: Node | null): string {
    if (no === null) return "?";
    const t = this.texto(no);
    switch (no.type) {
      case "identifier":
        return t;
      case "this_expression":
      case "this":
        return "this";
      case "base_expression":
      case "base":
        return "base";
      case "generic_name":
        return this.nomeTipo(no) ?? "?";
      case "qualified_name":
        return this.nomeTipo(no) ?? "?";
      case "member_access_expression": {
        const e = no.childForFieldName("expression");
        const n = this.nomeTipo(no.childForFieldName("name"));
        const o = e === null ? (t.startsWith("this.") ? "this" : t.startsWith("base.") ? "base" : "?") : this.receptorTexto(e);
        if (o === "?" || n === null) return "?";
        return `${o}.${n}`;
      }
      default:
        return "?";
    }
  }

  private modificadores(no: Node): Set<string> {
    const s = new Set<string>();
    for (const f of no.namedChildren) if (f !== null && f.type === "modifier") s.add(this.texto(f));
    return s;
  }

  private visibilidade(mods: Set<string>, padrao: Visibilidade): Visibilidade {
    if (mods.has("public")) return "publica";
    if (mods.has("protected") && mods.has("private")) return "privada";
    if (mods.has("protected")) return "protegida";
    if (mods.has("internal")) return "pacote";
    if (mods.has("private")) return "privada";
    return padrao;
  }

  private docAnterior(no: Node): string | null {
    const partes: string[] = [];
    let ant = no.previousNamedSibling;
    let linha = no.startPosition.row;
    while (ant !== null && ant.type === "comment") {
      const t = this.texto(ant);
      if (!t.startsWith("///") || linha - ant.endPosition.row > 1) break;
      partes.unshift(t);
      linha = ant.startPosition.row;
      ant = ant.previousNamedSibling;
    }
    if (partes.length === 0) return null;
    return primeiraLinhaDoc(partes.join("\n").replace(/<[^>]+>/g, ""));
  }

  private atributos(no: Node): Atributo[] {
    const out: Atributo[] = [];
    for (const lista of no.namedChildren) {
      if (lista === null || lista.type !== "attribute_list") continue;
      for (const at of lista.namedChildren) {
        if (at === null || at.type !== "attribute") continue;
        const nomeNo = at.childForFieldName("name");
        if (nomeNo === null) continue;
        const valores: Node[] = [];
        for (const f of at.namedChildren) {
          if (f === null || f.type !== "attribute_argument_list") continue;
          for (const a of f.namedChildren) {
            if (a === null || a.type !== "attribute_argument") continue;
            if (a.namedChildren.some((c) => c !== null && (c.type === "name_equals" || c.type === "name_colon"))) continue;
            const v = a.namedChild(a.namedChildCount - 1);
            if (v !== null) valores.push(v);
          }
        }
        const nome = this.texto(nomeNo).replace(/Attribute$/, "");
        out.push({ nome, texto: sanitizarAssinatura(`[${this.texto(at)}]`), valores });
      }
    }
    return out;
  }

  private novoDado(d: AcessoDadoBruto): void {
    this.empurrar(this.r.dados, d, LIMITES_EXTRACAO.dados);
  }

  private novaEntrada(e: EntradaBruta): void {
    this.empurrar(this.r.entradas, e, LIMITES_EXTRACAO.entradas);
  }

  private ref(q: Quadro, alvo: string, no: Node): void {
    this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor: null, tipo: "referencia", linha: linhaIni(no) }, LIMITES_EXTRACAO.chamadas);
  }

  private referenciasDeTipo(tipo: Node | null, q: Quadro): void {
    if (tipo === null) return;
    const alvos = tipo.type === "identifier" || tipo.type === "qualified_name" ? [tipo] : tipo.descendantsOfType(["identifier", "qualified_name"]);
    for (const n of alvos) {
      if (n.parent !== null && (n.parent.type === "qualified_name" || n.parent.type === "alias_qualified_name")) continue;
      const nome = this.nomeTipo(n);
      if (nome !== null) this.ref(q, nome, n);
    }
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
    if (ehDecisao("csharp", no)) q.contador.n++;
    const subtipo = TIPOS_DECLARADOS[no.type];
    if (subtipo !== undefined) {
      this.tipoDeclarado(no, q, subtipo);
      return;
    }
    switch (no.type) {
      case "file_scoped_namespace_declaration":
        this.ns = this.nomeTipo(no.childForFieldName("name")) ?? "";
        return;
      case "namespace_declaration": {
        const anterior = this.ns;
        const nome = this.nomeTipo(no.childForFieldName("name")) ?? "";
        this.ns = anterior === "" ? nome : `${anterior}.${nome}`;
        const corpo = no.childForFieldName("body");
        if (corpo !== null) this.visitarFilhos(corpo, q);
        this.ns = anterior;
        return;
      }
      case "using_directive":
        this.using(no);
        return;
      case "method_declaration":
        this.metodo(no, q, "metodo");
        return;
      case "constructor_declaration":
        this.metodo(no, q, "ctor");
        return;
      case "local_function_statement":
        this.metodo(no, q, "local");
        return;
      case "property_declaration":
        this.propriedade(no, q);
        return;
      case "field_declaration": {
        const v = no.namedChildren.find((c) => c !== null && c.type === "variable_declaration");
        if (v !== undefined && v !== null) this.referenciasDeTipo(v.childForFieldName("type"), q);
        this.visitarFilhos(no, q);
        return;
      }
      case "invocation_expression":
        this.invocacao(no, q);
        return;
      case "object_creation_expression": {
        const t = this.nomeTipo(no.childForFieldName("type"));
        if (t !== null) this.empurrar(this.r.chamadas, { de: q.de, alvo: t, receptor: null, tipo: "instancia", linha: linhaIni(no) }, LIMITES_EXTRACAO.chamadas);
        this.visitarFilhos(no, q);
        return;
      }
      case "typeof_expression": {
        const t = this.nomeTipo(no.childForFieldName("type") ?? no.namedChild(0));
        if (t !== null) this.ref(q, t, no);
        return;
      }
      case "string_literal":
      case "verbatim_string_literal":
      case "raw_string_literal":
        this.sqlLiteral(no, q, this.valorString(no), "exata");
        return;
      case "interpolated_string_expression": {
        let t = "";
        for (const c of no.namedChildren) {
          if (c === null) continue;
          if (c.type === "string_content") t += this.texto(c);
          else if (c.type === "interpolation") t += "?";
        }
        this.sqlLiteral(no, q, t, "heuristica");
        this.visitarFilhos(no, q);
        return;
      }
      case "throw_statement":
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
      default:
        this.visitarFilhos(no, q);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // imports

  private using(no: Node): void {
    const cabeca = this.texto(no);
    const estatico = /^(global\s+)?using\s+static\s/.test(cabeca);
    const aliasNo = no.childForFieldName("name");
    const alvoNo = no.namedChildren.find((c) => c !== null && (aliasNo === null || c.id !== aliasNo.id) && (c.type === "identifier" || c.type === "qualified_name" || c.type === "generic_name" || c.type === "alias_qualified_name"));
    const alvo = alvoNo === undefined ? null : this.nomeTipo(alvoNo);
    if (alvo === null) return;
    const nomes: NomeImportado[] = [];
    if (aliasNo !== null) nomes.push({ nome: "*", alias: this.texto(aliasNo) });
    else if (estatico) nomes.push({ nome: "static", alias: null });
    this.empurrar(this.r.imports, { especificador: alvo, tipo: "estatico", linha: linhaIni(no), so_tipo: false, nomes }, LIMITES_EXTRACAO.imports);
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

  private assinatura(no: Node): string {
    let ini = no.startIndex;
    for (const f of no.namedChildren) {
      if (f !== null && f.type !== "attribute_list" && f.type !== "comment") {
        ini = f.startIndex;
        break;
      }
    }
    const corpo = no.childForFieldName("body") ?? no.childForFieldName("accessors");
    const fim = corpo === null ? no.endIndex : corpo.startIndex;
    return sanitizarAssinatura(this.ctx.texto.slice(ini, Math.max(ini, fim)));
  }

  private tipoDeclarado(no: Node, q: Quadro, tipo: SubtipoSimbolo): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const simples = this.texto(nomeNo);
    const mods = this.modificadores(no);
    const vis = this.visibilidade(mods, q.classe !== null ? "privada" : "pacote");
    const prefixo = q.classe !== null ? q.classe.qualificado : this.ns;
    const attrs = this.atributos(no);
    const s = this.criarSimbolo({
      bruto: prefixo === "" ? simples : `${prefixo}.${simples}`,
      nome: simples,
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: vis === "publica" || vis === "protegida",
      visibilidade: vis,
      assinatura: this.assinatura(no),
      doc: this.docAnterior(no),
      decoradores: attrs.slice(0, LIMITES_EXTRACAO.decoradores).map((a) => a.texto),
    });
    if (s === null) return;
    const ehInterface = tipo === "interface";
    const bases = this.herancasDe(no, s.qualificado, ehInterface);
    let prefixoRota = "";
    for (const a of attrs) if (a.nome === "Route" || a.nome.endsWith(".Route")) prefixoRota = this.valorString(a.valores[0] ?? null) ?? prefixoRota;
    const controller = attrs.some((a) => a.nome === "ApiController") || /Controller(Base)?$/.test(simples) || bases.some((b) => /Controller(Base)?$/.test(b));
    const ctx: ClasseCtx = { qualificado: s.qualificado, simples, ehInterface, prefixoRota, controller, bases };
    for (const a of attrs) {
      if (a.nome !== "Table" && !a.nome.endsWith(".Table")) continue;
      const t = this.valorString(a.valores[0] ?? null);
      if (t !== null && t !== "") this.novoDado({ tabela: t.toLowerCase(), operacao: "define", de: s.qualificado, linha: linhaIni(no), confianca: "exata", fonte: "efcore" });
    }
    this.entradasHospedadas(no, ctx);
    const nq: Quadro = { de: s.qualificado, classe: ctx, contador: { n: 0 } };
    const corpo = no.childForFieldName("body");
    if (corpo !== null) this.visitarFilhos(corpo, nq);
  }

  private herancasDe(no: Node, classe: string, ehInterface: boolean): string[] {
    const bases: string[] = [];
    const lista = no.namedChildren.find((c) => c !== null && c.type === "base_list");
    if (lista === undefined || lista === null) return bases;
    for (const b of lista.namedChildren) {
      if (b === null) continue;
      const alvo = b.type === "primary_constructor_base_type" ? b.childForFieldName("type") : b;
      const nome = this.nomeTipo(alvo);
      if (nome === null) continue;
      bases.push(nome);
      const ultimo = nome.split(".").pop() as string;
      const tipo = ehInterface || /^I[A-Z]/.test(ultimo) ? "implementa" : "herda";
      this.empurrar(this.r.herancas, { classe, base: nome, tipo, linha: linhaIni(b) }, LIMITES_EXTRACAO.herancas);
    }
    return bases;
  }

  private entradasHospedadas(no: Node, ctx: ClasseCtx): void {
    if (ctx.bases.some((b) => b.endsWith("BackgroundService"))) {
      this.novaEntrada({ tipo: "job", chave: `hosted:${ctx.qualificado}`, framework: "dotnet", handler: `${ctx.qualificado}.ExecuteAsync`, linha: linhaIni(no), confianca: "exata" });
    } else if (ctx.bases.some((b) => b.endsWith("IHostedService"))) {
      this.novaEntrada({ tipo: "job", chave: `hosted:${ctx.qualificado}`, framework: "dotnet", handler: `${ctx.qualificado}.StartAsync`, linha: linhaIni(no), confianca: "exata" });
    }
  }

  private metodo(no: Node, q: Quadro, forma: "metodo" | "ctor" | "local"): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = this.texto(nomeNo);
    const mods = this.modificadores(no);
    const ehIface = q.classe?.ehInterface === true;
    const vis = forma === "local" ? null : this.visibilidade(mods, ehIface ? "publica" : "privada");
    const tipo: SubtipoSimbolo = forma === "local" ? "funcao" : "metodo";
    const base = q.de !== null ? q.de : this.ns;
    const bruto = forma === "ctor" ? `${base}.ctor` : base === "" ? nome : `${base}.${nome}`;
    const attrs = this.atributos(no);
    const s = this.criarSimbolo({
      bruto,
      nome,
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: vis === "publica" || vis === "protegida",
      visibilidade: vis,
      assinatura: this.assinatura(no),
      doc: this.docAnterior(no),
      decoradores: attrs.slice(0, LIMITES_EXTRACAO.decoradores).map((a) => a.texto),
    });
    if (s === null) return;
    const nq: Quadro = { de: s.qualificado, classe: q.classe, contador: { n: 0 } };
    if (forma === "metodo" && q.classe !== null) this.entradasDeMetodo(no, q.classe, s, mods, vis, attrs);
    // tipos dos parâmetros e do retorno
    const params = no.childForFieldName("parameters");
    if (params !== null) for (const p of params.namedChildren) if (p !== null && p.type === "parameter") this.referenciasDeTipo(p.childForFieldName("type"), nq);
    this.referenciasDeTipo(no.childForFieldName("returns") ?? no.childForFieldName("type"), nq);
    const corpo = no.childForFieldName("body");
    if (corpo !== null) this.visitar(corpo, nq);
    const init = no.namedChildren.find((c) => c !== null && c.type === "constructor_initializer");
    if (init !== undefined && init !== null) this.visitarFilhos(init, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private entradasDeMetodo(no: Node, classe: ClasseCtx, s: SimboloBruto, mods: Set<string>, vis: Visibilidade | null, attrs: Atributo[]): void {
    const handler = s.qualificado;
    const linha = linhaIni(no);
    if (s.nome === "Main" && mods.has("static")) this.novaEntrada({ tipo: "main", chave: "main", framework: "dotnet", handler, linha, confianca: "exata" });
    for (const a of attrs) {
      if (a.nome === "FunctionName" || a.nome === "Function") {
        const n = this.valorString(a.valores[0] ?? null);
        if (n !== null) this.novaEntrada({ tipo: "handler", chave: `function:${n}`, framework: "azure-functions", handler, linha, confianca: "exata" });
      }
    }
    if (!classe.controller || vis !== "publica") return;
    const rotaMetodo = attrs.find((a) => a.nome === "Route");
    for (const a of attrs) {
      const verbo = VERBOS_HTTP[a.nome];
      if (verbo === undefined) continue;
      const tpl = this.valorString(a.valores[0] ?? null) ?? (rotaMetodo === undefined ? "" : (this.valorString(rotaMetodo.valores[0] ?? null) ?? ""));
      const controllerNome = classe.simples.replace(/Controller$/, "");
      this.novaEntrada({ tipo: "rota", chave: `${verbo} ${normalizarRota(classe.prefixoRota, tpl, controllerNome, s.nome)}`, framework: "aspnet", handler, linha, confianca: "exata" });
    }
  }

  private propriedade(no: Node, q: Quadro): void {
    const tipo = no.childForFieldName("type");
    this.referenciasDeTipo(tipo, q);
    const nomeNo = no.childForFieldName("name");
    if (tipo !== null && tipo.type === "generic_name" && this.nomeTipo(tipo) === "DbSet" && nomeNo !== null) {
      this.novoDado({ tabela: this.texto(nomeNo).toLowerCase(), operacao: "define", de: q.de, linha: linhaIni(no), confianca: "heuristica", fonte: "efcore" });
    }
    this.visitarFilhos(no, q);
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas

  private chamar(q: Quadro, alvo: string, receptor: string | null, no: Node): void {
    this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor, tipo: "chamada", linha: linhaIni(no) }, LIMITES_EXTRACAO.chamadas);
  }

  private invocacao(no: Node, q: Quadro): void {
    const f = no.childForFieldName("function");
    const args = this.argumentos(no);
    let alvo: string | null = null;
    let receptor: string | null = null;
    let genericos: string[] = [];
    if (f !== null) {
      if (f.type === "identifier" || f.type === "generic_name") {
        alvo = this.nomeTipo(f);
        genericos = this.argsGenericos(f);
      } else if (f.type === "member_access_expression") {
        const nomeNo = f.childForFieldName("name");
        alvo = this.nomeTipo(nomeNo);
        genericos = this.argsGenericos(nomeNo);
        const e = f.childForFieldName("expression");
        const t = this.texto(f);
        receptor = e !== null ? this.receptorTexto(e) : t.startsWith("this.") ? "this" : t.startsWith("base.") ? "base" : "?";
      } else if (f.type === "member_binding_expression") {
        const nomeNo = f.childForFieldName("name");
        alvo = this.nomeTipo(nomeNo);
        genericos = this.argsGenericos(nomeNo);
        const pai: Node | null = f.parent !== null && f.parent.type === "invocation_expression" ? f.parent.parent : null;
        receptor = pai !== null && pai.type === "conditional_access_expression" ? this.receptorTexto(pai.childForFieldName("condition")) : "?";
      } else if (f.type === "conditional_access_expression") {
        const ult = f.namedChild(f.namedChildCount - 1);
        if (ult !== null && ult.type === "member_binding_expression") {
          alvo = this.nomeTipo(ult.childForFieldName("name"));
          receptor = this.receptorTexto(f.childForFieldName("condition"));
        }
      }
    }
    if (alvo !== null) {
      this.chamar(q, alvo, receptor, no);
      this.invocacaoEspecial(no, q, alvo, receptor, genericos, args);
    }
    if (f !== null) this.visitar(f, q);
    for (const a of args) {
      const v = this.valorArg(a);
      if (v !== null) this.visitar(v, q);
    }
  }

  private invocacaoEspecial(no: Node, q: Quadro, alvo: string, receptor: string | null, genericos: string[], args: Node[]): void {
    const linha = linhaIni(no);
    const lit0 = this.valorString(this.valorArg(args[0]));
    if (alvo === "GetEnvironmentVariable" && receptor !== null && /(^|\.)Environment$/.test(receptor) && lit0 !== null) {
      this.empurrar(this.r.padroes, { tipo: "env", nome: lit0, linha }, LIMITES_EXTRACAO.padroes);
    }
    if (REFLEXAO.has(alvo) || (alvo === "GetType" && receptor === "Type") || (/^Load(From|File)?$/.test(alvo) && receptor === "Assembly")) {
      this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha }, LIMITES_EXTRACAO.dinamicos);
    }
    if (alvo === "ToTable" && lit0 !== null && lit0 !== "") {
      this.novoDado({ tabela: lit0.toLowerCase(), operacao: "define", de: q.de, linha, confianca: "exata", fonte: "efcore" });
    }
    const verbo = VERBOS_MAP[alvo];
    if (verbo !== undefined && lit0 !== null) {
      const h = this.valorArg(args[1]);
      let handler: string | null = null;
      if (h !== null && (h.type === "identifier" || h.type === "member_access_expression")) handler = this.texto(h).replace(/\s+/g, "");
      const e: EntradaBruta = { tipo: "rota", chave: `${verbo} ${normalizarRota("", lit0, "", "")}`, framework: "aspnet-minimal", handler, linha, confianca: "exata" };
      this.novaEntrada(e);
    }
    if (DI_REGISTRO.test(alvo)) this.registroDi(no, q, genericos, args);
  }

  private registroDi(no: Node, q: Quadro, genericos: string[], args: Node[]): void {
    let pares = genericos;
    if (pares.length === 0) {
      pares = [];
      for (const a of args) {
        const v = this.valorArg(a);
        if (v !== null && v.type === "typeof_expression") {
          const t = this.nomeTipo(v.childForFieldName("type") ?? v.namedChild(0));
          if (t !== null) pares.push(t);
        }
      }
    }
    const [primeiro, segundo] = pares;
    if (primeiro !== undefined && segundo !== undefined) {
      this.empurrar(this.r.herancas, { classe: segundo, base: primeiro, tipo: "implementa", linha: linhaIni(no) }, LIMITES_EXTRACAO.herancas);
    } else if (primeiro !== undefined) {
      this.ref(q, primeiro, no);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // SQL literal

  private sqlLiteral(no: Node, q: Quadro, conteudo: string | null, confianca: Confianca): void {
    if (conteudo === null || no.endIndex - no.startIndex < 14) return;
    const tabelas = extrairTabelasSql(conteudo);
    if (tabelas.length === 0) return;
    const linha = linhaIni(no);
    for (const t of tabelas) this.novoDado({ tabela: t.tabela, operacao: t.operacao, de: q.de, linha, confianca, fonte: "sql" });
  }
}

export const extratorCsharp: Extrator = {
  extrair(ctx: ContextoExtracao) {
    return new Visitante(ctx).executar();
  },
};
