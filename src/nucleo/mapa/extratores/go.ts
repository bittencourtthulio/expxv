import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { Confianca, EntradaBruta, SimboloBruto, SubtipoSimbolo } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator Go (T-17.12). Percurso único da árvore Tree-sitter, sem executar nada.
// Formato dos imports (para `resolucao/go.ts`): `especificador` = caminho do pacote (`net/http`); `nomes` vazio quando
// sem apelido; com apelido `[{nome:"*", alias}]`, sendo `.` (import ponto) e `_` (import em branco) valores de alias.
// Embedding de struct/interface vira `herancas` (`tipo:"herda"`, `base` sem `*` nem genéricos, `pkg.Tipo` preservado).

const VERBOS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "ANY", "CONNECT", "TRACE"]);
const BUILTINS = new Set(["len", "cap", "make", "append", "delete", "copy", "close", "print", "println", "recover", "complex", "real", "imag", "min", "max", "clear", "panic"]);
const METODOS_SQL = new Set(["Query", "QueryRow", "Exec", "QueryContext", "QueryRowContext", "ExecContext", "Get", "Select", "NamedExec", "NamedQuery", "Prepare", "PrepareContext", "Raw", "MustExec"]);
const FRAMEWORKS: ReadonlyArray<[string, string]> = [
  ["github.com/gin-gonic/gin", "gin"],
  ["github.com/labstack/echo", "echo"],
  ["github.com/go-chi/chi", "chi"],
  ["github.com/gorilla/mux", "gorilla"],
  ["github.com/gofiber/fiber", "fiber"],
];

interface Quadro {
  de: string | null;
  prefixo: string;
  contador: { n: number };
}

function maiuscula(nome: string): boolean {
  const c = nome.charAt(0);
  return c !== "" && c === c.toUpperCase() && c !== c.toLowerCase();
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private readonly importados = new Set<string>();
  private framework: string | null = null;

  constructor(private readonly ctx: ContextoExtracao) {}

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    this.coletarImports(raiz);
    this.visitarFilhos(raiz, { de: null, prefixo: "", contador: this.topo });
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

  /** Conteúdo de literal de texto (`"…"` ou crase) sem os delimitadores; `null` se não for literal. */
  private literal(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "interpreted_string_literal" || no.type === "raw_string_literal") return this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // imports

  private coletarImports(raiz: Node): void {
    for (let i = 0; i < raiz.namedChildCount; i++) {
      const d = raiz.namedChild(i);
      if (d === null || d.type !== "import_declaration") continue;
      const pilha: Node[] = [d];
      while (pilha.length > 0) {
        const n = pilha.pop() as Node;
        if (n.type === "import_spec") {
          this.importSpec(n);
          continue;
        }
        for (let k = n.namedChildCount - 1; k >= 0; k--) {
          const f = n.namedChild(k);
          if (f !== null) pilha.push(f);
        }
      }
    }
    this.r.imports.sort((a, b) => a.linha - b.linha);
  }

  /** Nome local do pacote -> caminho (apelido explícito ou último segmento do caminho). */
  private readonly nomesLocais = new Map<string, string>();

  private importSpec(spec: Node): void {
    const caminho = this.literal(spec.childForFieldName("path"));
    if (caminho === null) return;
    const nome = spec.childForFieldName("name");
    this.importados.add(caminho);
    if (nome === null) this.nomesLocais.set((caminho.split("/").pop() ?? caminho).replace(/^v\d+$/, "").replace(/\.go$/, "") || caminho, caminho);
    else this.nomesLocais.set(this.texto(nome), caminho);
    if (this.framework === null) {
      const f = FRAMEWORKS.find(([prefixo]) => caminho === prefixo || caminho.startsWith(`${prefixo}/`) || caminho.startsWith(`${prefixo}.`));
      if (f !== undefined) this.framework = f[1];
    }
    this.empurrar(
      this.r.imports,
      { especificador: caminho, tipo: "estatico", linha: linhaIni(spec), so_tipo: false, nomes: nome === null ? [] : [{ nome: "*", alias: this.texto(nome) }] },
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
    if (ehDecisao("go", no)) q.contador.n++;
    switch (no.type) {
      case "import_declaration":
        return;
      case "function_declaration":
        this.funcao(no, q);
        return;
      case "method_declaration":
        this.metodo(no, q);
        return;
      case "type_spec":
      case "type_alias":
        this.tipo(no, q);
        return;
      case "const_spec":
        this.constante(no, q);
        return;
      case "call_expression":
        this.chamada(no, q);
        return;
      case "composite_literal":
        this.literalComposto(no, q);
        return;
      case "type_conversion_expression": {
        // `F[int](x)`: chamada genérica que o parser lê como conversão
        const alvo = this.nomeTipo(no.childForFieldName("type"));
        if (alvo !== null && !alvo.includes(".")) this.chamadaBruta(q, alvo, null, "chamada", linhaIni(no));
        const op = no.childForFieldName("operand");
        if (op !== null) this.visitar(op, q);
        return;
      }
      case "interpreted_string_literal":
      case "raw_string_literal":
        this.verificarSql(no, q);
        return;
      case "if_statement": {
        const cond = no.childForFieldName("condition");
        const corpo = no.childForFieldName("consequence");
        if (cond !== null && corpo !== null && corpo.namedChildCount === 0 && /\berr\w*\s*!=\s*nil\b/.test(this.texto(cond))) {
          this.empurrar(this.r.padroes, { tipo: "catch_vazio", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
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
    for (let p = no.previousSibling; p !== null && p.type === "comment" && p.endPosition.row >= alvo - 1; p = p.previousSibling) {
      partes.unshift(this.texto(p));
      alvo = p.startPosition.row;
    }
    return partes.length === 0 ? null : primeiraLinhaDoc(partes.join("\n"));
  }

  /** Para `type_spec` dentro de `type_declaration` o comentário precede a declaração, não o spec. */
  private docDeclaracao(no: Node): string | null {
    const p = no.parent;
    if (p !== null && p.type === "type_declaration" && p.namedChildCount === 1) return this.doc(p);
    if (p !== null && p.type === "const_declaration" && p.namedChildCount === 1) return this.doc(p);
    return this.doc(no);
  }

  private criarSimbolo(prefixo: string, nome: string, tipo: SubtipoSimbolo, no: Node, assinatura: string, doc: string | null): SimboloBruto | null {
    if (this.r.simbolos.length >= MAX_SIMBOLOS) {
      this.r.truncado = true;
      return null;
    }
    const exportado = maiuscula(nome);
    const s: SimboloBruto = {
      nome,
      qualificado: this.unicos.unico(prefixo === "" ? nome : `${prefixo}.${nome}`),
      tipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado,
      visibilidade: exportado ? "publica" : "pacote",
      complexidade: 0,
      assinatura: sanitizarAssinatura(assinatura),
      doc,
      decoradores: [],
    };
    this.r.simbolos.push(s);
    return s;
  }

  private funcao(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    const corpo = no.childForFieldName("body");
    if (nomeNo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const nome = this.texto(nomeNo);
    const s = this.criarSimbolo("", nome, "funcao", no, this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex), this.doc(no));
    if (s === null) {
      this.visitarFilhos(no, q);
      return;
    }
    if (nome === "main" && this.pacoteMain()) {
      this.empurrar(this.r.entradas, { tipo: "main", chave: "main", framework: "go", handler: s.qualificado, linha: s.linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    }
    this.corpo(corpo, s);
  }

  private metodo(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    const corpo = no.childForFieldName("body");
    if (nomeNo === null) {
      this.visitarFilhos(no, q);
      return;
    }
    const recv = this.nomeDoReceptor(no.childForFieldName("receiver"));
    const s = this.criarSimbolo(recv, this.texto(nomeNo), "metodo", no, this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex), this.doc(no));
    if (s === null) {
      this.visitarFilhos(no, q);
      return;
    }
    s.exportado = maiuscula(s.nome) && (recv === "" || maiuscula(recv));
    this.corpo(corpo, s);
  }

  private pacoteMain(): boolean {
    for (let i = 0; i < this.ctx.raiz.namedChildCount; i++) {
      const f = this.ctx.raiz.namedChild(i);
      if (f !== null && f.type === "package_clause") return this.texto(f).replace(/\s+/g, " ") === "package main";
    }
    return false;
  }

  private corpo(corpo: Node | null, s: SimboloBruto): void {
    const nq: Quadro = { de: s.qualificado, prefixo: s.qualificado, contador: { n: 0 } };
    if (corpo !== null) this.visitarFilhos(corpo, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private nomeDoReceptor(lista: Node | null): string {
    if (lista === null) return "";
    const t = lista.descendantsOfType("type_identifier")[0];
    return t === undefined ? "" : this.texto(t);
  }

  private tipo(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    const def = no.childForFieldName("type");
    if (nomeNo === null) return;
    const nome = this.texto(nomeNo);
    const sub: SubtipoSimbolo = def?.type === "struct_type" ? "struct" : def?.type === "interface_type" ? "interface" : "tipo";
    const cab = def !== null && (sub === "struct" || sub === "interface") ? `type ${nome} ${sub}` : this.ctx.texto.slice(no.startIndex, no.endIndex);
    const s = this.criarSimbolo(q.prefixo, nome, sub, no, cab, this.docDeclaracao(no));
    if (s === null || def === null) return;
    if (sub === "struct") {
      const lista = def.namedChild(0);
      for (let i = 0; lista !== null && i < lista.namedChildCount; i++) {
        const campo = lista.namedChild(i);
        if (campo === null || campo.type !== "field_declaration") continue;
        if (campo.childForFieldName("name") !== null) continue;
        const base = this.nomeTipo(campo.childForFieldName("type"));
        if (base !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base, tipo: "herda", linha: linhaIni(campo) }, LIMITES_EXTRACAO.herancas);
      }
    } else if (sub === "interface") {
      for (let i = 0; i < def.namedChildCount; i++) {
        const el = def.namedChild(i);
        if (el === null || el.type !== "type_elem") continue;
        for (let k = 0; k < el.namedChildCount; k++) {
          const base = this.nomeTipo(el.namedChild(k));
          if (base !== null) this.empurrar(this.r.herancas, { classe: s.qualificado, base, tipo: "herda", linha: linhaIni(el) }, LIMITES_EXTRACAO.herancas);
        }
      }
    }
  }

  /** Nome de tipo sem `*` e sem genéricos; restrições `~int | string` e tipos compostos retornam `null`. */
  private nomeTipo(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "type_identifier":
        return this.texto(no);
      case "qualified_type":
        return this.texto(no);
      case "pointer_type":
        return this.nomeTipo(no.namedChild(0));
      case "generic_type":
        return this.nomeTipo(no.childForFieldName("type"));
      default:
        return null;
    }
  }

  private constante(no: Node, q: Quadro): void {
    if (q.de !== null) return;
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) return;
    const nome = this.texto(nomeNo);
    this.criarSimbolo(q.prefixo, nome, "constante", no, `const ${nome}`, this.docDeclaracao(no));
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas, entradas e dados

  private operando(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "identifier" || no.type === "package_identifier") return this.texto(no);
    if (no.type === "selector_expression") {
      const o = this.operando(no.childForFieldName("operand"));
      const f = no.childForFieldName("field");
      if (o === null || f === null) return null;
      const t = `${o}.${this.texto(f)}`;
      return t.length > 120 ? null : t;
    }
    return null;
  }

  private chamada(no: Node, q: Quadro): void {
    const fn = no.childForFieldName("function");
    const args = no.childForFieldName("arguments");
    const linha = linhaIni(no);
    if (fn !== null) {
      if (fn.type === "identifier") {
        const alvo = this.texto(fn);
        if (alvo === "panic") this.empurrar(this.r.padroes, { tipo: "throw", nome: null, linha }, LIMITES_EXTRACAO.padroes);
        else if (alvo === "new") {
          const t = this.nomeTipo(args?.namedChild(0) ?? null);
          if (t !== null) this.chamadaBruta(q, t, null, "instancia", linha);
        } else if (!BUILTINS.has(alvo)) this.chamadaBruta(q, alvo, null, "chamada", linha);
      } else if (fn.type === "selector_expression") {
        const campo = fn.childForFieldName("field");
        const operandoNo = fn.childForFieldName("operand");
        if (campo !== null) {
          const alvo = this.texto(campo);
          const receptor = this.operando(operandoNo) ?? "?";
          this.chamadaBruta(q, alvo, receptor, "chamada", linha);
          this.efeitosDaChamada(no, alvo, receptor, args, q);
        }
      } else if (fn.type === "generic_type" || fn.type === "index_expression") {
        const alvo = this.operando(fn.childForFieldName("operand") ?? fn.childForFieldName("type") ?? fn.namedChild(0));
        if (alvo !== null && !alvo.includes(".")) this.chamadaBruta(q, alvo, null, "chamada", linha);
      }
      if (fn.type !== "identifier") this.visitar(fn, q);
    }
    if (args !== null) this.visitarFilhos(args, q);
  }

  private chamadaBruta(q: Quadro, alvo: string, receptor: string | null, tipo: "chamada" | "instancia", linha: number): void {
    this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor, tipo, linha }, LIMITES_EXTRACAO.chamadas);
  }

  private efeitosDaChamada(no: Node, alvo: string, receptor: string, args: Node | null, q: Quadro): void {
    const a0 = args?.namedChild(0) ?? null;
    const linha = linhaIni(no);
    if ((this.nomesLocais.get(receptor) ?? receptor) === "reflect") this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha }, LIMITES_EXTRACAO.dinamicos);
    if ((this.nomesLocais.get(receptor) ?? receptor) === "os" && (alvo === "Getenv" || alvo === "LookupEnv")) {
      this.empurrar(this.r.padroes, { tipo: "env", nome: this.literal(a0), linha }, LIMITES_EXTRACAO.padroes);
    }
    if (alvo === "Table" && a0 !== null) {
      const t = this.literal(a0);
      if (t !== null && /^[A-Za-z_][\w.]*$/.test(t)) this.dado(q, t.split(".").pop()!.toLowerCase(), "desconhecida", linha, "exata", "gorm");
    }
    if (METODOS_SQL.has(alvo)) return; // o literal é capturado pelo percurso (verificarSql)
    if ((alvo === "HandleFunc" || alvo === "Handle") && a0 !== null) {
      const padrao = this.literal(a0);
      if (padrao !== null && /^(?:[A-Z]+\s+)?(?:[\w.-]*\/|\/)/.test(padrao)) {
        const ehMetodo = /^[A-Z]+\s/.test(padrao);
        const chave = ehMetodo ? padrao.trim().replace(/\s+/g, " ") : `ALL ${padrao}`;
        const fw = receptor === "http" ? "net/http" : (this.framework ?? "net/http");
        this.entrada(q, "rota", chave, fw, args, receptor === "http" || this.importados.has("net/http") ? "exata" : "heuristica", linha);
      }
      return;
    }
    const verbo = alvo.toUpperCase();
    if (VERBOS.has(verbo) && (alvo === verbo || alvo === alvo.charAt(0).toUpperCase() + alvo.slice(1).toLowerCase()) && a0 !== null) {
      const caminho = this.literal(a0);
      if (caminho !== null && caminho.startsWith("/")) {
        this.entrada(q, "rota", `${verbo === "ANY" ? "ALL" : verbo} ${caminho}`, this.framework ?? "go-http", args, this.framework !== null ? "exata" : "heuristica", linha);
      }
    }
  }

  private entrada(q: Quadro, tipo: EntradaBruta["tipo"], chave: string, framework: string, args: Node | null, confianca: Confianca, linha: number): void {
    let handler: string | null = null;
    const ultimo = args !== null && args.namedChildCount > 1 ? args.namedChild(args.namedChildCount - 1) : null;
    if (ultimo !== null) {
      if (ultimo.type === "identifier") handler = this.texto(ultimo);
      else if (ultimo.type === "selector_expression") handler = this.texto(ultimo.childForFieldName("field") ?? ultimo);
    }
    void q;
    this.empurrar(this.r.entradas, { tipo, chave, framework, handler, linha, confianca }, LIMITES_EXTRACAO.entradas);
  }

  private literalComposto(no: Node, q: Quadro): void {
    const t = no.childForFieldName("type");
    const linha = linhaIni(no);
    if (t !== null && (t.type === "type_identifier" || t.type === "qualified_type" || t.type === "generic_type")) {
      const nome = this.nomeTipo(t);
      if (nome !== null) {
        const [recv, alvo] = nome.includes(".") ? [nome.slice(0, nome.lastIndexOf(".")), nome.slice(nome.lastIndexOf(".") + 1)] : [null, nome];
        this.chamadaBruta(q, alvo, recv, "instancia", linha);
        if (nome === "cobra.Command") this.comandoCobra(no, q);
      }
    }
    const corpo = no.childForFieldName("body");
    if (corpo !== null) this.visitarFilhos(corpo, q);
  }

  private comandoCobra(no: Node, q: Quadro): void {
    const corpo = no.childForFieldName("body");
    if (corpo === null) return;
    let uso: string | null = null;
    let handler: string | null = null;
    for (let i = 0; i < corpo.namedChildCount; i++) {
      const el = corpo.namedChild(i);
      if (el === null || el.type !== "keyed_element") continue;
      const chave = el.childForFieldName("key")?.text ?? "";
      const valorNo = el.childForFieldName("value")?.namedChild(0) ?? null;
      if (chave === "Use") uso = this.literal(valorNo);
      else if ((chave === "Run" || chave === "RunE") && valorNo?.type === "identifier") handler = this.texto(valorNo);
    }
    if (uso === null) return;
    const cmd = uso.trim().split(/\s+/)[0] ?? "";
    if (cmd === "") return;
    this.empurrar(this.r.entradas, { tipo: "cli", chave: `cobra:${cmd}`, framework: "cobra", handler, linha: linhaIni(no), confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    void q;
  }

  private verificarSql(no: Node, q: Quadro): void {
    if (no.endIndex - no.startIndex < 14) return;
    let conteudo = this.ctx.texto.slice(no.startIndex + 1, no.endIndex - 1);
    let confianca: Confianca = "exata";
    if (/%[-+# 0-9.]*[sdvqxfgtTeEXbc]/.test(conteudo)) {
      conteudo = conteudo.replace(/%[-+# 0-9.]*[sdvqxfgtTeEXbc]/g, "?");
      confianca = "heuristica";
    }
    for (const t of extrairTabelasSql(conteudo)) this.dado(q, t.tabela, t.operacao, linhaIni(no), confianca, "sql");
  }

  private dado(q: Quadro, tabela: string, operacao: "le" | "escreve" | "define" | "desconhecida", linha: number, confianca: Confianca, fonte: string): void {
    this.empurrar(this.r.dados, { tabela, operacao, de: q.de, linha, confianca, fonte }, LIMITES_EXTRACAO.dados);
  }
}

export const extratorGo: Extrator = {
  extrair(ctx) {
    return new Visitante(ctx).executar();
  },
};
