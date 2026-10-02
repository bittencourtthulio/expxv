import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { Confianca, EntradaBruta, ImportBruto, NomeImportado, OperacaoDado, SimboloBruto, Visibilidade } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator Python (T-17.08). Percurso único da árvore Tree-sitter; nada é executado.
//
// Formato dos imports (para o resolvedor):
//  - `import a.b.c`            -> especificador "a.b.c", nomes [] (liga `a`)
//  - `import a.b as x`         -> especificador "a.b", nomes [{nome:"*", alias:"x"}]
//  - `from . import x`         -> especificador ".", nomes [{x}]
//  - `from ..pkg.m import y as z` -> especificador "..pkg.m" (pontos de nível preservados), nomes [{y, z}]
//  - `from m import *`         -> nomes [{nome:"*"}]
//  - `importlib.import_module("x")` / `__import__("x")` literais -> tipo "dinamico"; não literais viram `dinamicos`.
//  - imports sob `if TYPE_CHECKING:` têm `so_tipo = true`.
// Herança: `herancas[].base` é o texto do nome como escrito (`Base`, `mod.Outra`); sempre `herda` (Python não tem
// `implements`); `Generic[T]` vira `Generic`; argumentos nomeados (`metaclass=`) são ignorados.

const VERBOS_HTTP = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
const MODULOS_WEB = ["flask", "fastapi", "starlette", "quart", "sanic", "bottle", "aiohttp"];
const TAREFAS = new Set(["task", "shared_task", "periodic_task"]);
const FRAMEWORKS_CLI = ["click", "typer"];
const VARIAVEL_CONSTANTE = /^[A-Z][A-Z0-9_]*$/;

interface Quadro {
  de: string | null;
  prefixo: string;
  classe: string | null;
  contador: { n: number };
  dentroFuncao: boolean;
  tipoApenas: boolean;
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private readonly modulos = new Set<string>();
  private readonly prefixos = new Map<string, string>();
  private readonly roteadores = new Set<string>();
  private readonly typers = new Set<string>();
  private readonly app: string;
  private readonly arquivo: string;

  constructor(private readonly ctx: ContextoExtracao) {
    const partes = ctx.caminho.split("/");
    this.arquivo = partes[partes.length - 1] ?? "";
    this.app = partes.length >= 2 ? (partes[partes.length - 2] as string) : "";
  }

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    const quadro: Quadro = { de: null, prefixo: "", classe: null, contador: this.topo, dentroFuncao: false, tipoApenas: false };
    this.prepassada(raiz);
    this.visitarFilhos(raiz, quadro);
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

  /** Valor literal de uma string simples (sem interpolação); `null` se não for literal. */
  private literal(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "concatenated_string") {
      let s = "";
      for (let i = 0; i < no.namedChildCount; i++) {
        const p = this.literal(no.namedChild(i));
        if (p === null) return null;
        s += p;
      }
      return s;
    }
    if (no.type !== "string") return null;
    let s = "";
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f === null) continue;
      if (f.type === "interpolation") return null;
      if (f.type === "string_content") s += this.texto(f);
    }
    return s;
  }

  /** Texto do SQL com interpolações trocadas por `?` e se havia interpolação. */
  private textoSql(no: Node): { sql: string; interpolado: boolean } | null {
    if (no.type === "concatenated_string") {
      let sql = "";
      let interp = false;
      for (let i = 0; i < no.namedChildCount; i++) {
        const p = this.textoSql(no.namedChild(i) as Node);
        if (p === null) return null;
        sql += p.sql;
        interp ||= p.interpolado;
      }
      return { sql, interpolado: interp };
    }
    if (no.type !== "string") return null;
    let sql = "";
    let interp = false;
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f === null) continue;
      if (f.type === "interpolation") {
        interp = true;
        sql += "?";
      } else if (f.type === "string_content") sql += this.texto(f);
    }
    return { sql, interpolado: interp };
  }

  private nomeSimples(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "identifier" || no.type === "attribute") {
      const t = this.texto(no);
      return t.length > 200 ? null : t;
    }
    return null;
  }

  private receptorTexto(no: Node | null): string | null {
    if (no === null) return null;
    if (no.type === "identifier") return this.texto(no);
    if (no.type === "attribute") {
      const o = this.receptorTexto(no.childForFieldName("object"));
      const a = no.childForFieldName("attribute");
      if (o === null || a === null || o === "?") return "?";
      return `${o}.${this.texto(a)}`;
    }
    return "?";
  }

  private doc(corpo: Node | null): string | null {
    if (corpo === null) return null;
    const primeiro = corpo.namedChild(0);
    if (primeiro === null || primeiro.type !== "expression_statement") return null;
    const s = primeiro.namedChild(0);
    if (s === null || s.type !== "string") return null;
    const v = this.literal(s);
    return v === null ? null : primeiraLinhaDoc(v);
  }

  private visibilidade(nome: string): Visibilidade {
    if (nome.startsWith("__") && nome.endsWith("__")) return "publica";
    if (nome.startsWith("__")) return "privada";
    if (nome.startsWith("_")) return "protegida";
    return "publica";
  }

  private prepassada(raiz: Node): void {
    const pilha: Node[] = [raiz];
    for (;;) {
      const no = pilha.pop();
      if (no === undefined) break;
      if (no.type === "import_statement" || no.type === "import_from_statement") {
        const m = no.type === "import_statement" ? this.texto(no).replace(/^import\s+/, "") : (this.texto(no).match(/^from\s+(\.*[\w.]*)/)?.[1] ?? "");
        for (const parte of m.split(",")) this.modulos.add((parte.trim().split(/[\s.]/)[0] ?? "").toLowerCase());
      }
      // roteadores com prefixo: x = Blueprint(..., url_prefix="/p") | APIRouter(prefix="/p")
      if (no.type === "assignment") {
        const esq = no.childForFieldName("left");
        const dir = no.childForFieldName("right");
        if (esq !== null && esq.type === "identifier" && dir !== null && dir.type === "call") {
          const fn = this.nomeSimples(dir.childForFieldName("function"));
          if (fn !== null && /(^|\.)(Flask|FastAPI|Starlette|Quart|Sanic|Bottle|Blueprint|APIRouter|Router)$/.test(fn)) this.roteadores.add(this.texto(esq));
          if (fn !== null && /(^|\.)Typer$/.test(fn)) this.typers.add(this.texto(esq));
          if (fn !== null && /(^|\.)(Blueprint|APIRouter|Router)$/.test(fn)) {
            const args = dir.childForFieldName("arguments");
            for (let i = 0; args !== null && i < args.namedChildCount; i++) {
              const a = args.namedChild(i);
              if (a?.type !== "keyword_argument") continue;
              const k = this.texto(a.childForFieldName("name") as Node);
              if (k === "url_prefix" || k === "prefix") {
                const v = this.literal(a.childForFieldName("value"));
                if (v !== null) this.prefixos.set(this.texto(esq), v);
              }
            }
          }
        }
      }
      for (let i = no.namedChildCount - 1; i >= 0; i--) {
        const f = no.namedChild(i);
        if (f !== null && f.type !== "function_definition") pilha.push(f);
      }
    }
  }

  private usaFrameworkWeb(): string | null {
    for (const m of MODULOS_WEB) if (this.modulos.has(m)) return m;
    return null;
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
    if (ehDecisao("python", no)) q.contador.n++;
    switch (no.type) {
      case "import_statement":
        this.importSimples(no, q);
        return;
      case "import_from_statement":
        this.importDe(no, q);
        return;
      case "decorated_definition":
        this.definicaoDecorada(no, q);
        return;
      case "function_definition":
        this.funcao(no, q, []);
        return;
      case "class_definition":
        this.classe(no, q, []);
        return;
      case "if_statement": {
        const cond = no.childForFieldName("condition");
        if (cond !== null && q.dentroFuncao === false && /^(typing\.)?TYPE_CHECKING$/.test(this.texto(cond))) {
          this.tratarCondicaoPrincipal(no);
          const corpo = no.childForFieldName("consequence");
          const q2 = { ...q, tipoApenas: true };
          if (corpo !== null) this.visitarFilhos(corpo, q2);
          for (let i = 0; i < no.namedChildCount; i++) {
            const f = no.namedChild(i);
            if (f !== null && f !== cond && f.id !== corpo?.id) this.visitar(f, q);
          }
          return;
        }
        this.tratarCondicaoPrincipal(no);
        this.visitarFilhos(no, q);
        return;
      }
      case "assignment":
        this.atribuicao(no, q);
        this.visitarFilhos(no, q);
        return;
      case "call":
        this.chamada(no, q);
        this.visitarFilhos(no, q);
        return;
      case "subscript":
        this.subscript(no);
        this.visitarFilhos(no, q);
        return;
      case "raise_statement":
        this.empurrar(this.r.padroes, { tipo: "throw", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
        this.visitarFilhos(no, q);
        return;
      case "except_clause":
        this.excecao(no);
        this.visitarFilhos(no, q);
        return;
      case "string":
      case "concatenated_string":
        this.tratarString(no, q);
        return;
      default:
        this.visitarFilhos(no, q);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // imports

  private nomePonto(no: Node): string {
    return this.texto(no).replace(/\s+/g, "");
  }

  private importSimples(no: Node, q: Quadro): void {
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f === null) continue;
      let espec: string;
      const nomes: NomeImportado[] = [];
      if (f.type === "aliased_import") {
        espec = this.nomePonto(f.childForFieldName("name") as Node);
        nomes.push({ nome: "*", alias: this.texto(f.childForFieldName("alias") as Node) });
      } else if (f.type === "dotted_name") espec = this.nomePonto(f);
      else continue;
      this.empurrar(this.r.imports, { especificador: espec, tipo: "estatico", linha: linhaIni(no), so_tipo: q.tipoApenas, nomes } satisfies ImportBruto, LIMITES_EXTRACAO.imports);
    }
  }

  private importDe(no: Node, q: Quadro): void {
    const modulo = no.childForFieldName("module_name");
    if (modulo === null) return;
    const espec = this.nomePonto(modulo);
    const nomes: NomeImportado[] = [];
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f === null || f.id === modulo.id) continue;
      if (f.type === "wildcard_import") nomes.push({ nome: "*", alias: null });
      else if (f.type === "dotted_name") nomes.push({ nome: this.nomePonto(f), alias: null });
      else if (f.type === "aliased_import") nomes.push({ nome: this.nomePonto(f.childForFieldName("name") as Node), alias: this.texto(f.childForFieldName("alias") as Node) });
    }
    this.empurrar(this.r.imports, { especificador: espec, tipo: "estatico", linha: linhaIni(no), so_tipo: q.tipoApenas, nomes }, LIMITES_EXTRACAO.imports);
  }

  // ---------------------------------------------------------------------------------------------
  // símbolos

  private definicaoDecorada(no: Node, q: Quadro): void {
    const def = no.childForFieldName("definition");
    const decs: Node[] = [];
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f !== null && f.type === "decorator") decs.push(f);
    }
    if (def === null) return;
    if (def.type === "function_definition") this.funcao(def, q, decs);
    else if (def.type === "class_definition") this.classe(def, q, decs);
    else this.visitar(def, q);
  }

  private decoradoresTexto(decs: Node[]): string[] {
    return decs.slice(0, LIMITES_EXTRACAO.decoradores).map((d) => sanitizarAssinatura(this.texto(d), 120));
  }

  private assinatura(no: Node, corpo: Node | null): string {
    let s = this.ctx.texto.slice(no.startIndex, corpo !== null ? corpo.startIndex : no.endIndex);
    s = s.replace(/\s+$/, "").replace(/:$/, "");
    return sanitizarAssinatura(s);
  }

  private funcao(no: Node, q: Quadro, decs: Node[]): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) return;
    const nome = this.texto(nomeNo);
    const emClasse = q.classe !== null && !q.dentroFuncao && q.prefixo === q.classe;
    const qualificado = this.unicos.unico(q.prefixo === "" ? nome : `${q.prefixo}.${nome}`);
    const corpo = no.childForFieldName("body");
    const topo = q.prefixo === "" && !q.dentroFuncao;
    const s: SimboloBruto = {
      nome,
      qualificado,
      tipo: emClasse ? "metodo" : "funcao",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: (topo || emClasse) && (!nome.startsWith("_") || (nome.startsWith("__") && nome.endsWith("__"))) && (emClasse ? q.classe !== null && !(q.classe.split(".").pop() as string).startsWith("_") : true),
      visibilidade: emClasse ? this.visibilidade(nome) : null,
      complexidade: 1,
      assinatura: this.assinatura(no, corpo),
      doc: this.doc(corpo),
      decoradores: this.decoradoresTexto(decs),
    };
    this.empurrar(this.r.simbolos, s, MAX_SIMBOLOS);
    if (emClasse && nome === "__getattr__") this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha: linhaIni(no) }, LIMITES_EXTRACAO.dinamicos);
    for (const d of decs) this.decorador(d, s, q, emClasse);
    const nq: Quadro = { de: qualificado, prefixo: qualificado, classe: q.classe, contador: { n: 0 }, dentroFuncao: true, tipoApenas: false };
    // parâmetros (valores padrão podem conter chamadas) e corpo
    const params = no.childForFieldName("parameters");
    if (params !== null) this.visitarFilhos(params, { ...q, contador: nq.contador });
    if (corpo !== null) this.visitarFilhos(corpo, nq);
    s.complexidade = 1 + nq.contador.n;
    if (emClasse && q.classe !== null && q.classe.split(".").pop() === "Command" && nome === "handle") this.entradaComando(q.classe, linhaIni(no), qualificado);
  }

  private classe(no: Node, q: Quadro, decs: Node[]): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) return;
    const nome = this.texto(nomeNo);
    const qualificado = this.unicos.unico(q.prefixo === "" ? nome : `${q.prefixo}.${nome}`);
    const corpo = no.childForFieldName("body");
    const topo = q.prefixo === "" && !q.dentroFuncao;
    const s: SimboloBruto = {
      nome,
      qualificado,
      tipo: "classe",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: topo && !nome.startsWith("_"),
      visibilidade: null,
      complexidade: 1,
      assinatura: this.assinatura(no, corpo),
      doc: this.doc(corpo),
      decoradores: this.decoradoresTexto(decs),
    };
    this.empurrar(this.r.simbolos, s, MAX_SIMBOLOS);
    const bases: string[] = [];
    const sup = no.childForFieldName("superclasses");
    for (let i = 0; sup !== null && i < sup.namedChildCount; i++) {
      const b = sup.namedChild(i);
      if (b === null) continue;
      let base: string | null = null;
      if (b.type === "identifier" || b.type === "attribute") base = this.texto(b);
      else if (b.type === "subscript") base = this.nomeSimples(b.childForFieldName("value"));
      if (base === null) continue;
      bases.push(base);
      this.empurrar(this.r.herancas, { classe: qualificado, base, tipo: "herda", linha: linhaIni(b) }, LIMITES_EXTRACAO.herancas);
    }
    for (const d of decs) this.decorador(d, s, q, false);
    this.dadosDaClasse(no, nome, qualificado, bases, corpo);
    const nq: Quadro = { de: qualificado, prefixo: qualificado, classe: qualificado, contador: q.contador, dentroFuncao: q.dentroFuncao, tipoApenas: false };
    if (sup !== null) this.visitarFilhos(sup, q);
    if (corpo !== null) this.visitarFilhos(corpo, nq);
  }

  private atribuicao(no: Node, q: Quadro): void {
    const esq = no.childForFieldName("left");
    if (esq === null || esq.type !== "identifier" || q.dentroFuncao || q.prefixo !== "") return;
    const nome = this.texto(esq);
    if (!VARIAVEL_CONSTANTE.test(nome)) return;
    const s: SimboloBruto = {
      nome,
      qualificado: this.unicos.unico(nome),
      tipo: "constante",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: true,
      visibilidade: null,
      complexidade: 1,
      assinatura: sanitizarAssinatura(nome),
      doc: null,
      decoradores: [],
    };
    this.empurrar(this.r.simbolos, s, MAX_SIMBOLOS);
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas

  private chamada(no: Node, q: Quadro): void {
    const fn = no.childForFieldName("function");
    if (fn === null) return;
    const linha = linhaIni(no);
    this.entradaChamada(no, q);
    this.migracao(no, q);
    if (fn.type === "identifier") {
      const alvo = this.texto(fn);
      this.dinamicoNu(alvo, no, linha);
      this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor: null, tipo: /^[A-Z]/.test(alvo) ? "instancia" : "chamada", linha }, LIMITES_EXTRACAO.chamadas);
      return;
    }
    if (fn.type === "attribute") {
      const alvo = this.texto(fn.childForFieldName("attribute") as Node);
      const receptor = this.receptorTexto(fn.childForFieldName("object"));
      this.dinamicoMembro(alvo, receptor, no, linha);
      this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor, tipo: /^[A-Z]/.test(alvo) ? "instancia" : "chamada", linha }, LIMITES_EXTRACAO.chamadas);
      this.ambiente(alvo, receptor, no);
    }
  }

  private argLiteral0(no: Node): { literal: string | null; existe: boolean } {
    const args = no.childForFieldName("arguments");
    const a0 = args !== null ? args.namedChild(0) : null;
    return { literal: this.literal(a0), existe: a0 !== null };
  }

  private dinamicoNu(alvo: string, no: Node, linha: number): void {
    if (alvo === "eval" || alvo === "exec") this.empurrar(this.r.dinamicos, { tipo: "eval", linha }, LIMITES_EXTRACAO.dinamicos);
    else if (alvo === "getattr" || alvo === "setattr" || alvo === "delattr") {
      const args = no.childForFieldName("arguments");
      const nome = args !== null ? args.namedChild(1) : null;
      if (nome !== null && this.literal(nome) === null) this.empurrar(this.r.dinamicos, { tipo: "chamada_computada", linha }, LIMITES_EXTRACAO.dinamicos);
    } else if (alvo === "__import__") this.importDinamico(no, linha);
    else if (alvo === "getenv") {
      const { literal } = this.argLiteral0(no);
      if (literal !== null) this.empurrar(this.r.padroes, { tipo: "env", nome: literal, linha }, LIMITES_EXTRACAO.padroes);
    }
  }

  private dinamicoMembro(alvo: string, receptor: string | null, no: Node, linha: number): void {
    if (alvo === "import_module" && (receptor === "importlib" || receptor === "importlib.util")) this.importDinamico(no, linha);
  }

  private importDinamico(no: Node, linha: number): void {
    const { literal } = this.argLiteral0(no);
    if (literal !== null) this.empurrar(this.r.imports, { especificador: literal, tipo: "dinamico", linha, so_tipo: false, nomes: [] }, LIMITES_EXTRACAO.imports);
    else this.empurrar(this.r.dinamicos, { tipo: "import_dinamico", linha }, LIMITES_EXTRACAO.dinamicos);
  }

  private ambiente(alvo: string, receptor: string | null, no: Node): void {
    const linha = linhaIni(no);
    if ((alvo === "getenv" && receptor === "os") || (alvo === "get" && (receptor === "os.environ" || receptor === "environ")) || (alvo === "pop" && receptor === "os.environ")) {
      const { literal } = this.argLiteral0(no);
      if (literal !== null) this.empurrar(this.r.padroes, { tipo: "env", nome: literal, linha }, LIMITES_EXTRACAO.padroes);
    }
  }

  private subscript(no: Node): void {
    const v = this.nomeSimples(no.childForFieldName("value"));
    if (v !== "os.environ" && v !== "environ") return;
    const nome = this.literal(no.childForFieldName("subscript"));
    if (nome !== null) this.empurrar(this.r.padroes, { tipo: "env", nome, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
  }

  private excecao(no: Node): void {
    // `except:` (ou qualquer except) cujo corpo só tem pass/`...`/docstring
    let bloco: Node | null = null;
    for (let i = no.namedChildCount - 1; i >= 0; i--) {
      const f = no.namedChild(i);
      if (f !== null && f.type === "block") {
        bloco = f;
        break;
      }
    }
    if (bloco === null) return;
    for (let i = 0; i < bloco.namedChildCount; i++) {
      const f = bloco.namedChild(i);
      if (f === null || f.type === "comment" || f.type === "pass_statement") continue;
      if (f.type === "expression_statement" && f.namedChildCount === 1 && ["ellipsis", "string"].includes((f.namedChild(0) as Node).type)) continue;
      return;
    }
    this.empurrar(this.r.padroes, { tipo: "catch_vazio", nome: null, linha: linhaIni(no) }, LIMITES_EXTRACAO.padroes);
  }

  // ---------------------------------------------------------------------------------------------
  // entradas

  private tratarCondicaoPrincipal(no: Node): void {
    const cond = no.childForFieldName("condition");
    if (cond === null || cond.type !== "comparison_operator") return;
    const t = this.texto(cond).replace(/\s+/g, "");
    if (/^__name__==["']__main__["']$/.test(t) || /^["']__main__["']==__name__$/.test(t))
      this.empurrar(this.r.entradas, { tipo: "main", chave: "main", framework: "python", handler: null, linha: linhaIni(no), confianca: "exata" }, LIMITES_EXTRACAO.entradas);
  }

  private normalizarRota(p: string): string {
    return p.replace(/<(?:[a-zA-Z_]+:)?([a-zA-Z_][\w]*)>/g, ":$1").replace(/\{([a-zA-Z_][\w]*)(?::[^}]*)?\}/g, ":$1");
  }

  private juntar(prefixo: string, caminho: string): string {
    const p = `${prefixo.replace(/\/+$/, "")}/${caminho.replace(/^\/+/, "")}`;
    return p === "/" ? "/" : p.replace(/\/+$/, "") || "/";
  }

  private decorador(dec: Node, s: SimboloBruto, q: Quadro, emClasse: boolean): void {
    const expr = dec.namedChild(0);
    if (expr === null) return;
    const linha = linhaIni(dec);
    let fn: Node | null = expr;
    let args: Node | null = null;
    if (expr.type === "call") {
      fn = expr.childForFieldName("function");
      args = expr.childForFieldName("arguments");
    }
    // o decorador executa no escopo que contém a definição
    this.empurrar(this.r.chamadas, { de: q.de, alvo: this.nomeFinal(fn), receptor: fn?.type === "attribute" ? this.receptorTexto(fn.childForFieldName("object")) : null, tipo: expr.type === "call" ? "chamada" : "referencia", linha }, LIMITES_EXTRACAO.chamadas);
    if (fn === null) return;
    const handler = s.qualificado;
    if (fn.type === "attribute") {
      const obj = this.texto(fn.childForFieldName("object") as Node);
      const attr = this.texto(fn.childForFieldName("attribute") as Node);
      const web = this.usaFrameworkWeb();
      const ehRoteador = this.roteadores.has(obj) || /^(app|router|bp|api|blueprint)$/.test(obj);
      if ((attr === "route" || VERBOS_HTTP.has(attr)) && args !== null && web !== null && !emClasse && ehRoteador) {
        const caminho = this.literal(args.namedChild(0));
        if (caminho !== null) {
          const framework = attr === "route" ? (this.modulos.has("flask") ? "flask" : web) : this.modulos.has("fastapi") ? "fastapi" : web;
          const prefixo = this.prefixos.get(obj) ?? "";
          const chave = this.normalizarRota(this.juntar(prefixo, caminho));
          let verbos = [attr.toUpperCase()];
          if (attr === "route") {
            verbos = ["GET"];
            for (let i = 0; i < args.namedChildCount; i++) {
              const a = args.namedChild(i);
              if (a?.type === "keyword_argument" && this.texto(a.childForFieldName("name") as Node) === "methods") {
                const lista = a.childForFieldName("value");
                const ms: string[] = [];
                for (let k = 0; lista !== null && k < lista.namedChildCount; k++) {
                  const v = this.literal(lista.namedChild(k));
                  if (v !== null) ms.push(v.toUpperCase());
                }
                if (ms.length > 0) verbos = ms;
              }
            }
          }
          for (const v of verbos) this.empurrar(this.r.entradas, { tipo: "rota", chave: `${v} ${chave}`, framework, handler, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
          return;
        }
      }
      if (TAREFAS.has(attr) && (this.modulos.has("celery") || /celery|app/.test(obj))) {
        this.empurrar(this.r.entradas, { tipo: "job", chave: `celery:${handler}`, framework: "celery", handler, linha, confianca: this.modulos.has("celery") ? "exata" : "heuristica" }, LIMITES_EXTRACAO.entradas);
        return;
      }
      if (attr === "command" || attr === "group") {
        const cli = this.typers.has(obj) ? "typer" : this.modulos.has("click") && /click|^cli$|group/.test(obj) ? "click" : FRAMEWORKS_CLI.find((m) => this.modulos.has(m));
        if (cli !== undefined) {
          const nome = args !== null ? this.literal(args.namedChild(0)) : null;
          this.empurrar(this.r.entradas, { tipo: "cli", chave: `cli:${nome ?? s.nome}`, framework: cli, handler, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
        }
      }
    } else if (fn.type === "identifier") {
      const nome = this.texto(fn);
      if (TAREFAS.has(nome)) {
        this.empurrar(this.r.entradas, { tipo: "job", chave: `celery:${handler}`, framework: "celery", handler, linha, confianca: this.modulos.has("celery") ? "exata" : "heuristica" }, LIMITES_EXTRACAO.entradas);
      } else if ((nome === "command" || nome === "group") && this.modulos.has("click")) {
        this.empurrar(this.r.entradas, { tipo: "cli", chave: `cli:${s.nome}`, framework: "click", handler, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      }
    }
  }

  private nomeFinal(fn: Node | null): string {
    if (fn === null) return "?";
    if (fn.type === "attribute") return this.texto(fn.childForFieldName("attribute") as Node);
    return this.texto(fn).slice(0, 120);
  }

  private entradaComando(classe: string, linha: number, handler: string): void {
    if (!/(^|\/)management\/commands\/[^/]+\.py$/.test(this.ctx.caminho)) return;
    const nome = this.arquivo.replace(/\.py$/, "");
    if (nome.startsWith("_")) return;
    this.empurrar(this.r.entradas, { tipo: "cli", chave: `cli:${nome}`, framework: "django", handler, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    void classe;
  }

  /** `urlpatterns`: path()/re_path()/url() em `urls.py`; e `argparse.ArgumentParser`. */
  private entradaChamada(no: Node, q: Quadro): void {
    void q;
    const fn = no.childForFieldName("function");
    if (fn === null) return;
    const nome = this.nomeSimples(fn);
    if (nome === null) return;
    const linha = linhaIni(no);
    if (/^(argparse\.)?ArgumentParser$/.test(nome) && this.modulos.has("argparse"))
      this.empurrar(this.r.entradas, { tipo: "cli", chave: "cli:argparse", framework: "argparse", handler: null, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    if (this.arquivo === "urls.py" && /^(path|re_path|url)$/.test(nome.split(".").pop() as string)) {
      const args = no.childForFieldName("arguments");
      if (args === null) return;
      const rota = this.literal(args.namedChild(0));
      const alvoNo = args.namedChild(1);
      if (rota === null || alvoNo === null) return;
      if (alvoNo.type === "call" && /(^|\.)include$/.test(this.nomeSimples(alvoNo.childForFieldName("function")) ?? "")) return;
      let handler: string | null = null;
      if (alvoNo.type === "call") {
        const f = alvoNo.childForFieldName("function");
        if (f !== null && f.type === "attribute" && this.texto(f.childForFieldName("attribute") as Node) === "as_view") handler = this.nomeSimples(f.childForFieldName("object"));
      } else handler = this.nomeSimples(alvoNo);
      const limpa = rota.replace(/^\^/, "").replace(/\$$/, "");
      const chave = this.normalizarRota(`/${limpa.replace(/^\/+/, "")}`);
      this.empurrar(this.r.entradas, { tipo: "rota", chave: `ALL ${chave}`, framework: "django", handler, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // dados

  private tratarString(no: Node, q: Quadro): void {
    const pai = no.parent;
    const docstring = pai !== null && pai.type === "expression_statement";
    if (!docstring) {
      const t = this.textoSql(no);
      if (t !== null) {
        const confianca: Confianca = t.interpolado ? "heuristica" : "exata";
        for (const tab of extrairTabelasSql(t.sql)) this.acessoSql(tab.tabela, tab.operacao, q.de, linhaIni(no), confianca);
      }
    }
    // chamadas dentro de f-strings
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f !== null && f.type === "interpolation") this.visitarFilhos(f, q);
    }
  }

  private acessoSql(tabela: string, operacao: OperacaoDado, de: string | null, linha: number, confianca: Confianca): void {
    this.empurrar(this.r.dados, { tabela, operacao, de, linha, confianca, fonte: "sql" }, LIMITES_EXTRACAO.dados);
  }

  private dadosDaClasse(no: Node, nome: string, qualificado: string, bases: string[], corpo: Node | null): void {
    if (corpo === null) return;
    const linha = linhaIni(no);
    let tablename: string | null = null;
    let dbTable: string | null = null;
    for (let i = 0; i < corpo.namedChildCount; i++) {
      const st = corpo.namedChild(i);
      if (st === null) continue;
      if (st.type === "expression_statement") {
        const a = st.namedChild(0);
        if (a?.type === "assignment" && this.texto(a.childForFieldName("left") as Node) === "__tablename__") tablename = this.literal(a.childForFieldName("right"));
      } else if (st.type === "class_definition" && this.texto(st.childForFieldName("name") as Node) === "Meta") {
        const mc = st.childForFieldName("body");
        for (let k = 0; mc !== null && k < mc.namedChildCount; k++) {
          const e = mc.namedChild(k)?.namedChild(0);
          if (e?.type === "assignment" && this.texto(e.childForFieldName("left") as Node) === "db_table") dbTable = this.literal(e.childForFieldName("right"));
        }
      }
    }
    if (tablename !== null) {
      this.empurrar(this.r.dados, { tabela: tablename.toLowerCase(), operacao: "define", de: qualificado, linha, confianca: "exata", fonte: "sqlalchemy" }, LIMITES_EXTRACAO.dados);
      return;
    }
    if (bases.some((b) => b === "Model" || b.endsWith(".Model"))) {
      if (dbTable !== null) this.empurrar(this.r.dados, { tabela: dbTable.toLowerCase(), operacao: "define", de: qualificado, linha, confianca: "exata", fonte: "django" }, LIMITES_EXTRACAO.dados);
      else if (this.app !== "") this.empurrar(this.r.dados, { tabela: `${this.app}_${nome}`.toLowerCase(), operacao: "define", de: qualificado, linha, confianca: "heuristica", fonte: "django" }, LIMITES_EXTRACAO.dados);
    }
  }

  /** `migrations.CreateModel(name="X", options={"db_table": "t"})` (chamado do visitor de chamadas). */
  private migracao(no: Node, q: Quadro): void {
    const fn = this.nomeSimples(no.childForFieldName("function"));
    if (fn === null || !/(^|\.)CreateModel$/.test(fn)) return;
    const args = no.childForFieldName("arguments");
    let nome: string | null = null;
    let tabela: string | null = null;
    for (let i = 0; args !== null && i < args.namedChildCount; i++) {
      const a = args.namedChild(i);
      if (a?.type !== "keyword_argument") continue;
      const k = this.texto(a.childForFieldName("name") as Node);
      const v = a.childForFieldName("value");
      if (k === "name") nome = this.literal(v);
      else if (k === "options" && v?.type === "dictionary") {
        for (let j = 0; j < v.namedChildCount; j++) {
          const p = v.namedChild(j);
          if (p?.type === "pair" && this.literal(p.childForFieldName("key")) === "db_table") tabela = this.literal(p.childForFieldName("value"));
        }
      }
    }
    // app/migrations/0001.py -> app é a pasta acima de `migrations`
    const partes = this.ctx.caminho.split("/");
    const app = partes.length >= 3 ? (partes[partes.length - 3] as string) : "";
    const linha = linhaIni(no);
    if (tabela !== null) this.empurrar(this.r.dados, { tabela: tabela.toLowerCase(), operacao: "define", de: q.de, linha, confianca: "exata", fonte: "django" }, LIMITES_EXTRACAO.dados);
    else if (nome !== null && app !== "") this.empurrar(this.r.dados, { tabela: `${app}_${nome}`.toLowerCase(), operacao: "define", de: q.de, linha, confianca: "heuristica", fonte: "django" }, LIMITES_EXTRACAO.dados);
  }
}

export const extratorPython: Extrator = {
  extrair(ctx: ContextoExtracao) {
    return new Visitante(ctx).executar();
  },
};
