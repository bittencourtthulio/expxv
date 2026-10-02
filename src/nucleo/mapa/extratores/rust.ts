import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { Confianca, NomeImportado, OperacaoDado, SimboloBruto, SubtipoSimbolo, Visibilidade } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator Rust (T-17.12). Percurso único da árvore Tree-sitter, sem executar nada.
// Formato dos imports (para `resolucao/rust.ts`): um `ImportBruto` por FOLHA de `use`; `especificador` = caminho do
// módulo com `::` (`crate::a::b`, `super::x`, `std::collections`); `nomes` = o item importado (`[{nome:"c",alias}]`,
// `self` e `*` são valores reservados; `use a::b::c` => especificador `a::b`, nome `c`). `pub use` => `tipo:"reexport"`.
// `mod x;` (arquivo) => `especificador:"mod:x"`, `tipo:"estatico"`, `nomes:[]`; `mod x { … }` inline não gera import.
// Herança: `impl Trait for T` => `{classe:"T", base:"Trait", tipo:"implementa"}`; `trait A: B` => `herda`.
// Nomes qualificados usam `.` (`Tipo.metodo`, `modulo.funcao`).

const MACROS_IGNORADAS = new Set([
  "println", "print", "eprintln", "eprint", "format", "vec", "assert", "assert_eq", "assert_ne", "debug_assert", "debug_assert_eq", "debug_assert_ne", "write", "writeln", "dbg", "matches",
  "include_str", "include_bytes", "include", "concat", "stringify", "line", "file", "column", "cfg", "env", "option_env", "format_args", "thread_local", "vec_deque", "todo", "unimplemented", "unreachable", "panic",
]);
const MACROS_PANICA = new Set(["panic", "todo", "unimplemented", "unreachable"]);
const VERBOS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "any", "trace", "connect"]);
const FRAMEWORKS_WEB: ReadonlyArray<[string, string]> = [
  ["axum", "axum"],
  ["actix_web", "actix"],
  ["rocket", "rocket"],
  ["warp", "warp"],
];

interface Quadro {
  de: string | null;
  prefixo: string;
  contador: { n: number };
  /** Dentro de `impl`/`trait`: `function_item` vira método. */
  emTipo: boolean;
  /** Dentro de função (itens aninhados não são exportados). */
  dentroFuncao: boolean;
}

function normalizarRota(rota: string): string {
  return rota.replace(/\{\*?([A-Za-z_]\w*)[^}]*\}/g, ":$1").replace(/<(?:\.\.\.)?([A-Za-z_]\w*)[^>]*>/g, ":$1");
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private readonly usados = new Set<string>();
  private framework: string | null = null;

  constructor(private readonly ctx: ContextoExtracao) {}

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    for (let i = 0; i < raiz.namedChildCount; i++) {
      const f = raiz.namedChild(i);
      if (f !== null && f.type === "use_declaration") this.tratarUse(f);
    }
    for (const u of this.usados) {
      const base = u.split("::")[0] ?? "";
      const fw = FRAMEWORKS_WEB.find(([c]) => c === base);
      if (fw !== undefined) {
        this.framework = fw[1];
        break;
      }
    }
    this.visitarFilhos(raiz, { de: null, prefixo: "", contador: this.topo, emTipo: false, dentroFuncao: false });
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

  private literal(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "string_literal") {
      const c = no.namedChild(0);
      return c !== null && c.type === "string_content" ? this.texto(c) : this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    }
    if (no.type === "raw_string_literal") return this.ctx.texto.slice(no.startIndex, no.endIndex).replace(/^r#*"/, "").replace(/"#*$/, "");
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // use / mod

  private tratarUse(no: Node): void {
    const arg = no.childForFieldName("argument");
    if (arg === null) return;
    const publico = no.namedChildren.some((c) => c !== null && c.type === "visibility_modifier");
    this.folhasUse(arg, "", publico, linhaIni(no));
  }

  private caminhoDe(no: Node): string {
    return this.texto(no).replace(/\s+/g, "");
  }

  private folhasUse(no: Node, prefixo: string, publico: boolean, linha: number): void {
    const junta = (p: string, s: string): string => (p === "" ? s : `${p}::${s}`);
    switch (no.type) {
      case "scoped_use_list": {
        const caminho = no.childForFieldName("path");
        const novo = caminho === null ? prefixo : junta(prefixo, this.caminhoDe(caminho));
        const lista = no.childForFieldName("list");
        for (let i = 0; lista !== null && i < lista.namedChildCount; i++) {
          const f = lista.namedChild(i);
          if (f !== null) this.folhasUse(f, novo, publico, linha);
        }
        return;
      }
      case "use_list": {
        for (let i = 0; i < no.namedChildCount; i++) {
          const f = no.namedChild(i);
          if (f !== null) this.folhasUse(f, prefixo, publico, linha);
        }
        return;
      }
      case "use_wildcard": {
        const c = no.namedChild(0);
        this.emitirUse(c === null ? prefixo : junta(prefixo, this.caminhoDe(c)), { nome: "*", alias: null }, publico, linha);
        return;
      }
      case "use_as_clause": {
        const caminho = no.childForFieldName("path");
        const alias = no.childForFieldName("alias");
        if (caminho === null) return;
        const completo = junta(prefixo, this.caminhoDe(caminho));
        this.emitirFolha(completo, alias === null ? null : this.texto(alias), publico, linha);
        return;
      }
      default:
        this.emitirFolha(junta(prefixo, this.caminhoDe(no)), null, publico, linha);
    }
  }

  private emitirFolha(completo: string, alias: string | null, publico: boolean, linha: number): void {
    const i = completo.lastIndexOf("::");
    if (i < 0) {
      this.emitirUse(completo, null, publico, linha);
      return;
    }
    const nome = completo.slice(i + 2);
    this.emitirUse(completo.slice(0, i), { nome, alias }, publico, linha);
  }

  private emitirUse(especificador: string, nome: NomeImportado | null, publico: boolean, linha: number): void {
    this.usados.add(especificador);
    this.empurrar(
      this.r.imports,
      { especificador, tipo: publico ? "reexport" : "estatico", linha, so_tipo: false, nomes: nome === null ? [] : [nome] },
      LIMITES_EXTRACAO.imports,
    );
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
    if (ehDecisao("rust", no)) q.contador.n++;
    switch (no.type) {
      case "use_declaration":
      case "attribute_item":
      case "inner_attribute_item":
      case "line_comment":
      case "block_comment":
        return;
      case "mod_item":
        this.modulo(no, q);
        return;
      case "function_item":
      case "function_signature_item":
        this.funcao(no, q);
        return;
      case "struct_item":
        this.simboloTipo(no, q, "struct");
        return;
      case "enum_item":
        this.simboloTipo(no, q, "enum");
        return;
      case "trait_item":
        this.trait(no, q);
        return;
      case "type_item":
        this.simboloTipo(no, q, "tipo");
        return;
      case "const_item":
      case "static_item":
        this.simboloTipo(no, q, "constante");
        return;
      case "impl_item":
        this.impl(no, q);
        return;
      case "macro_definition":
        this.macroDefinicao(no, q);
        return;
      case "call_expression":
        this.chamada(no, q);
        return;
      case "macro_invocation":
        this.macro(no, q);
        return;
      case "struct_expression":
        this.estruturaExpr(no, q);
        return;
      case "dynamic_type":
        this.empurrar(this.r.dinamicos, { tipo: "chamada_computada", linha: linhaIni(no) }, LIMITES_EXTRACAO.dinamicos);
        this.visitarFilhos(no, q);
        return;
      case "string_literal":
      case "raw_string_literal":
        this.verificarSql(no, q, "sql");
        return;
      case "match_arm":
        this.braco(no, q);
        return;
      default:
        this.visitarFilhos(no, q);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // símbolos

  /** Atributos (`#[…]`) e comentários que antecedem um item, na ordem do arquivo. */
  private anexos(no: Node): { atributos: Node[]; comentarios: string[] } {
    const atributos: Node[] = [];
    const comentarios: string[] = [];
    let alvo = no.startPosition.row;
    for (let p = no.previousSibling; p !== null; p = p.previousSibling) {
      if (p.type === "attribute_item") {
        atributos.unshift(p);
        alvo = p.startPosition.row;
      } else if ((p.type === "line_comment" || p.type === "block_comment") && p.endPosition.row >= alvo - 1) {
        if (p.childForFieldName("inner") !== null) break;
        comentarios.unshift(this.texto(p));
        alvo = p.startPosition.row;
      } else break;
    }
    return { atributos, comentarios };
  }

  private visibilidade(no: Node): { exportado: boolean; visibilidade: Visibilidade } {
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f !== null && f.type === "visibility_modifier") {
        const t = this.texto(f).replace(/\s+/g, "");
        return t === "pub" ? { exportado: true, visibilidade: "publica" } : { exportado: false, visibilidade: t.includes("super") ? "protegida" : "pacote" };
      }
    }
    return { exportado: false, visibilidade: "privada" };
  }

  private criar(q: Quadro, nome: string, tipo: SubtipoSimbolo, no: Node, assinatura: string, forcarPublico = false): SimboloBruto | null {
    if (this.r.simbolos.length >= MAX_SIMBOLOS) {
      this.r.truncado = true;
      return null;
    }
    const { atributos, comentarios } = this.anexos(no);
    const v = this.visibilidade(no);
    const s: SimboloBruto = {
      nome,
      qualificado: this.unicos.unico(q.prefixo === "" ? nome : `${q.prefixo}.${nome}`),
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: forcarPublico ? true : v.exportado && !q.dentroFuncao,
      visibilidade: forcarPublico ? "publica" : v.visibilidade,
      complexidade: 0,
      assinatura: sanitizarAssinatura(assinatura),
      doc: comentarios.length === 0 ? null : primeiraLinhaDoc(comentarios.join("\n")),
      decoradores: atributos.slice(0, LIMITES_EXTRACAO.decoradores).map((a) => sanitizarAssinatura(this.texto(a))),
    };
    this.r.simbolos.push(s);
    this.atributosDe(atributos, s, no);
    return s;
  }

  /** Efeitos dos atributos: rotas (actix/rocket), clap, tabela do diesel. */
  private atributosDe(atributos: Node[], s: SimboloBruto, no: Node): void {
    for (const a of atributos) {
      const attr = a.namedChild(0);
      if (attr === null) continue;
      const nomeNo = attr.namedChild(0);
      const args = attr.childForFieldName("arguments");
      if (nomeNo === null) continue;
      const nome = this.texto(nomeNo).replace(/\s+/g, "");
      const ultimo = nome.split("::").pop() ?? nome;
      if (VERBOS.has(ultimo) && args !== null && s.tipo === "funcao") {
        const rota = this.literal(args.namedChild(0));
        if (rota !== null && rota.startsWith("/")) {
          const fw = nome.includes("rocket") ? "rocket" : (this.framework ?? (nome.includes("::") ? nome.split("::")[0] : null));
          const exata: Confianca = this.framework === "actix" || this.framework === "rocket" || nome.startsWith("rocket") ? "exata" : "heuristica";
          this.empurrar(this.r.entradas, { tipo: "rota", chave: `${ultimo.toUpperCase()} ${normalizarRota(rota)}`, framework: fw ?? "rust-web", handler: s.qualificado, linha: s.linha, confianca: exata }, LIMITES_EXTRACAO.entradas);
        }
      }
      if (nome === "derive" && args !== null && s.tipo === "struct" && /\bParser\b/.test(this.texto(args))) {
        this.empurrar(this.r.entradas, { tipo: "cli", chave: `clap:${s.nome}`, framework: "clap", handler: null, linha: s.linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      }
      if ((nome === "diesel" || nome === "table_name") && args !== null) {
        const m = /table_name\s*=\s*([A-Za-z_][\w:]*)/.exec(this.texto(args));
        if (m !== null) this.dado({ de: s.qualificado } as Quadro, (m[1] as string).split("::").pop()!.toLowerCase(), "desconhecida", s.linha, "exata", "diesel");
      }
      if (nome === "table_name") {
        const lit = this.literal(args?.namedChild(0) ?? null);
        if (lit !== null && /^[A-Za-z_]\w*$/.test(lit)) this.dado({ de: s.qualificado } as Quadro, lit.toLowerCase(), "desconhecida", s.linha, "exata", "diesel");
      }
    }
    void no;
  }

  private nomeDe(no: Node): string | null {
    const n = no.childForFieldName("name");
    return n === null ? null : this.texto(n);
  }

  private cabecalho(no: Node): string {
    const corpo = no.childForFieldName("body");
    return this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex);
  }

  private modulo(no: Node, q: Quadro): void {
    const nome = this.nomeDe(no);
    if (nome === null) return;
    const corpo = no.childForFieldName("body");
    if (corpo === null) {
      this.empurrar(this.r.imports, { especificador: `mod:${nome}`, tipo: "estatico", linha: linhaIni(no), so_tipo: false, nomes: [] }, LIMITES_EXTRACAO.imports);
      return;
    }
    const prefixo = q.prefixo === "" ? nome : `${q.prefixo}.${nome}`;
    this.visitarFilhos(corpo, { ...q, prefixo });
  }

  private funcao(no: Node, q: Quadro): void {
    const nome = this.nomeDe(no);
    const corpo = no.childForFieldName("body");
    if (nome === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const s = this.criar(q, nome, q.emTipo ? "metodo" : "funcao", no, this.cabecalho(no), q.emTipo && q.de === "__trait_impl__");
    if (s === null) {
      this.visitarFilhos(no, q);
      return;
    }
    if (!q.emTipo && !q.dentroFuncao && q.prefixo === "" && nome === "main") {
      const tokio = s.decoradores.some((d) => /tokio::main|actix(_web)?::main|async_std::main/.test(d));
      this.empurrar(this.r.entradas, { tipo: "main", chave: "main", framework: tokio ? "tokio" : "rust", handler: s.qualificado, linha: s.linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    }
    const nq: Quadro = { de: s.qualificado, prefixo: s.qualificado, contador: { n: 0 }, emTipo: false, dentroFuncao: true };
    if (corpo !== null) this.visitarFilhos(corpo, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private simboloTipo(no: Node, q: Quadro, tipo: SubtipoSimbolo): void {
    const nome = this.nomeDe(no);
    if (nome === null) return;
    const corpo = no.childForFieldName("body");
    const assinatura = tipo === "constante" ? `${no.type === "static_item" ? "static" : "const"} ${nome}` : this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex);
    this.criar(q, nome, tipo, no, assinatura);
    if (tipo === "tipo" || tipo === "constante") {
      const v = no.childForFieldName("value");
      if (v !== null) this.visitar(v, { ...q, de: q.de });
    }
  }

  private trait(no: Node, q: Quadro): void {
    const nome = this.nomeDe(no);
    if (nome === null) return;
    const s = this.criar(q, nome, "trait", no, this.cabecalho(no));
    if (s === null) return;
    const bounds = no.childForFieldName("bounds");
    for (let i = 0; bounds !== null && i < bounds.namedChildCount; i++) {
      const base = this.nomeTipo(bounds.namedChild(i), true);
      if (base !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base, tipo: "herda", linha: s.linha }, LIMITES_EXTRACAO.herancas);
    }
    const corpo = no.childForFieldName("body");
    if (corpo !== null) this.visitarFilhos(corpo, { de: q.de, prefixo: s.qualificado, contador: q.contador, emTipo: true, dentroFuncao: q.dentroFuncao });
  }

  /** Nome de tipo sem genéricos/referências. `completo` mantém o caminho (`a::B`). */
  private nomeTipo(no: Node | null, completo = false): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "type_identifier":
        return this.texto(no);
      case "scoped_type_identifier": {
        const t = this.caminhoDe(no);
        return completo ? t : (t.split("::").pop() ?? t);
      }
      case "generic_type":
        return this.nomeTipo(no.childForFieldName("type"), completo);
      case "reference_type":
        return this.nomeTipo(no.childForFieldName("type"), completo);
      default:
        return null;
    }
  }

  private impl(no: Node, q: Quadro): void {
    const alvoNome = this.nomeTipo(no.childForFieldName("type"));
    const traco = no.childForFieldName("trait");
    const corpo = no.childForFieldName("body");
    if (alvoNome === null) {
      if (corpo !== null) this.visitarFilhos(corpo, q);
      return;
    }
    if (traco !== null) {
      const base = this.nomeTipo(traco, true);
      if (base !== null) this.empurrar(this.r.herancas, { classe: alvoNome, base, tipo: "implementa", linha: linhaIni(no) }, LIMITES_EXTRACAO.herancas);
    }
    if (corpo !== null) {
      this.visitarFilhos(corpo, { de: traco !== null ? "__trait_impl__" : null, prefixo: alvoNome, contador: q.contador, emTipo: true, dentroFuncao: q.dentroFuncao });
    }
  }

  private macroDefinicao(no: Node, q: Quadro): void {
    const nome = this.nomeDe(no);
    if (nome === null) return;
    this.criar(q, nome, "funcao", no, `macro_rules! ${nome}`);
    this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha: linhaIni(no) }, LIMITES_EXTRACAO.dinamicos);
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas, entradas e dados

  private caminhoCurto(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "identifier":
      case "self":
      case "crate":
      case "super":
      case "type_identifier":
        return this.texto(no);
      case "scoped_identifier":
      case "scoped_type_identifier": {
        const t = this.caminhoDe(no);
        return t.length > 120 ? null : t;
      }
      case "field_expression": {
        const v = this.caminhoCurto(no.childForFieldName("value"));
        const f = no.childForFieldName("field");
        if (v === null || f === null) return null;
        return `${v}.${this.texto(f)}`;
      }
      default:
        return null;
    }
  }

  private chamadaBruta(q: Quadro, alvo: string, receptor: string | null, tipo: "chamada" | "instancia", linha: number): void {
    this.empurrar(this.r.chamadas, { de: q.de === "__trait_impl__" ? null : q.de, alvo, receptor, tipo, linha }, LIMITES_EXTRACAO.chamadas);
  }

  private chamada(no: Node, q: Quadro): void {
    let fn = no.childForFieldName("function");
    const args = no.childForFieldName("arguments");
    const linha = linhaIni(no);
    if (fn !== null && fn.type === "generic_function") fn = fn.childForFieldName("function");
    if (fn !== null) {
      if (fn.type === "identifier") {
        this.chamadaBruta(q, this.texto(fn), null, "chamada", linha);
      } else if (fn.type === "scoped_identifier") {
        const nome = fn.childForFieldName("name");
        const caminho = fn.childForFieldName("path");
        if (nome !== null) {
          const alvo = this.texto(nome);
          const receptor = caminho === null ? null : this.caminhoDe(caminho);
          this.chamadaBruta(q, alvo, receptor, "chamada", linha);
          this.efeitos(no, alvo, receptor, args, q);
        }
      } else if (fn.type === "field_expression") {
        const campo = fn.childForFieldName("field");
        if (campo !== null) {
          const alvo = this.texto(campo);
          const receptor = this.caminhoCurto(fn.childForFieldName("value")) ?? "?";
          this.chamadaBruta(q, alvo, receptor, "chamada", linha);
          this.efeitos(no, alvo, receptor, args, q);
        }
        const v = fn.childForFieldName("value");
        if (v !== null) this.visitar(v, q);
      } else this.visitar(fn, q);
    }
    if (args !== null) this.visitarFilhos(args, q);
  }

  private efeitos(no: Node, alvo: string, receptor: string | null, args: Node | null, q: Quadro): void {
    const linha = linhaIni(no);
    if ((alvo === "unwrap" || alvo === "expect" || alvo === "unwrap_err") && receptor !== null) {
      this.empurrar(this.r.padroes, { tipo: "throw", nome: null, linha }, LIMITES_EXTRACAO.padroes);
    }
    if ((alvo === "var" || alvo === "var_os") && receptor !== null && /(^|::)env$/.test(receptor)) {
      this.empurrar(this.r.padroes, { tipo: "env", nome: this.literal(args?.namedChild(0) ?? null), linha }, LIMITES_EXTRACAO.padroes);
    }
    if (alvo === "route" && args !== null && args.namedChildCount >= 2) {
      const rota = this.literal(args.namedChild(0));
      if (rota === null || !rota.startsWith("/")) return;
      const resto = this.texto(args.namedChild(1) as Node).slice(0, 400);
      const achados = [...resto.matchAll(/(?:\bweb::)?\b(get|post|put|patch|delete|head|options|any)\s*\(\s*(?:\)\s*\.to\s*\(\s*)?([A-Za-z_][\w:]*)?/g)];
      const fw = this.framework ?? "rust-web";
      const exata: Confianca = this.framework === "axum" || this.framework === "actix" ? "exata" : "heuristica";
      for (const m of achados) {
        const verbo = (m[1] as string).toUpperCase();
        const h = m[2] === undefined || VERBOS.has(m[2]) ? null : (m[2].split("::").pop() as string);
        this.empurrar(this.r.entradas, { tipo: "rota", chave: `${verbo === "ANY" ? "ALL" : verbo} ${normalizarRota(rota)}`, framework: fw, handler: h, linha, confianca: exata }, LIMITES_EXTRACAO.entradas);
      }
      void q;
    }
  }

  private macro(no: Node, q: Quadro): void {
    const m = no.childForFieldName("macro");
    const linha = linhaIni(no);
    if (m !== null) {
      const completo = this.caminhoCurto(m);
      const ultimo = (completo ?? this.texto(m)).split("::").pop() as string;
      const fonteSql = /^(query|query_as|query_scalar|query_file)(_unchecked)?$/.test(ultimo) ? "sqlx" : "sql";
      if (MACROS_PANICA.has(ultimo)) this.empurrar(this.r.padroes, { tipo: "throw", nome: null, linha }, LIMITES_EXTRACAO.padroes);
      else if (ultimo === "env" || ultimo === "option_env") {
        const lit = this.literal(this.primeiroLiteral(no));
        this.empurrar(this.r.padroes, { tipo: "env", nome: lit, linha }, LIMITES_EXTRACAO.padroes);
      } else if (ultimo === "table" && completo === "table") this.tabelaDiesel(no, q);
      else if (!MACROS_IGNORADAS.has(ultimo)) this.chamadaBruta(q, ultimo, completo !== null && completo.includes("::") ? completo.slice(0, completo.lastIndexOf("::")) : null, "chamada", linha);
      for (let i = 0; i < no.namedChildCount; i++) {
        const f = no.namedChild(i);
        if (f !== null && f.type === "token_tree") this.varrerTokens(f, q, fonteSql, ultimo === "format" || ultimo === "format_args");
      }
    }
  }

  private primeiroLiteral(no: Node): Node | null {
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f !== null && f.type === "token_tree") return f.namedChild(0);
    }
    return null;
  }

  private varrerTokens(arvore: Node, q: Quadro, fonte: string, formato: boolean): void {
    for (let i = 0; i < arvore.namedChildCount; i++) {
      const f = arvore.namedChild(i);
      if (f === null) continue;
      if (f.type === "string_literal" || f.type === "raw_string_literal") this.verificarSql(f, q, fonte, formato);
      else if (f.type === "token_tree") this.varrerTokens(f, q, fonte, formato);
    }
  }

  private tabelaDiesel(no: Node, q: Quadro): void {
    const tt = this.primeiroLiteral(no);
    if (tt !== null && tt.type === "identifier") this.dado(q, this.texto(tt).toLowerCase(), "define", linhaIni(no), "exata", "diesel");
  }

  private estruturaExpr(no: Node, q: Quadro): void {
    const n = no.childForFieldName("name");
    if (n !== null) {
      const t = this.caminhoCurto(n);
      if (t !== null) {
        const i = t.lastIndexOf("::");
        this.chamadaBruta(q, i < 0 ? t : t.slice(i + 2), i < 0 ? null : t.slice(0, i), "instancia", linhaIni(no));
      }
    }
    const corpo = no.childForFieldName("body");
    if (corpo !== null) this.visitarFilhos(corpo, q);
  }

  private braco(no: Node, q: Quadro): void {
    const padrao = no.childForFieldName("pattern");
    const valor = no.childForFieldName("value");
    if (padrao !== null && valor !== null && /^Err\s*\(/.test(this.texto(padrao))) {
      const vazio = (valor.type === "block" && valor.namedChildCount === 0) || valor.type === "unit_expression";
      if (vazio) this.empurrar(this.r.padroes, { tipo: "catch_vazio", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
    }
    this.visitarFilhos(no, q);
  }

  private verificarSql(no: Node, q: Quadro, fonte: string, formato = false): void {
    if (no.endIndex - no.startIndex < 14) return;
    let conteudo = this.literal(no) ?? "";
    let confianca: Confianca = "exata";
    if (formato || /\{[A-Za-z_0-9:.]*\}/.test(conteudo)) {
      if (/\{[A-Za-z_0-9:.]*\}/.test(conteudo)) {
        conteudo = conteudo.replace(/\{[A-Za-z_0-9:.]*\}/g, "?");
        confianca = "heuristica";
      }
    }
    for (const t of extrairTabelasSql(conteudo)) this.dado(q, t.tabela, t.operacao, linhaIni(no), confianca, fonte);
  }

  private dado(q: Pick<Quadro, "de">, tabela: string, operacao: OperacaoDado, linha: number, confianca: Confianca, fonte: string): void {
    this.empurrar(this.r.dados, { tabela, operacao, de: q.de === "__trait_impl__" ? null : q.de, linha, confianca, fonte }, LIMITES_EXTRACAO.dados);
  }
}

export const extratorRust: Extrator = {
  extrair(ctx: ContextoExtracao) {
    return new Visitante(ctx).executar();
  },
};

