import type { Node } from "web-tree-sitter";
import { ehDecisao } from "../metricas";
import { primeiraLinhaDoc, sanitizarAssinatura } from "../redacao";
import type { Confianca, NomeImportado, OperacaoDado, SimboloBruto, SubtipoSimbolo, Visibilidade } from "../tipos";
import { LIMITES_EXTRACAO } from "../validacao";
import { linhaFim, linhaIni, MAX_SIMBOLOS, NomesUnicos, resultadoVazio, trecho, type ContextoExtracao, type Extrator, type ResultadoExtrator } from "./comum";
import { extrairTabelasSql } from "./sql";

// Extrator Java (T-17.09). Percurso único da árvore Tree-sitter; nada é compilado nem executado.
//
// Formato dos imports (para o resolvedor):
//  - `import a.b.C;`            -> especificador "a.b.C" (FQN da classe), nomes []
//  - `import a.b.*;`            -> especificador "a.b" (pacote), nomes [{nome:"*"}]
//  - `import static a.b.C.m;`   -> especificador "a.b.C", nomes [{nome:"m"}]
//  - `import static a.b.C.*;`   -> especificador "a.b.C", nomes [{nome:"*"}]   (o resolvedor tenta FQN de classe antes de pacote)
// O pacote do arquivo (`package x.y;`) NÃO tem campo em `Extracao` (ver docs/ade/pedidos/17-pedidos.md): o resolvedor
// o deriva do caminho (`src/main/java/<pacote>/`) enquanto o contrato não ganha `pacote`.
// Herança: `herancas[].base` é o nome do tipo como escrito, sem argumentos genéricos (`JpaRepository`, `a.b.Base`);
// `extends` de classe = herda; `implements` = implementa; `extends` de interface = herda.
// Repositórios Spring Data (`extends JpaRepository<E, ID>`) geram `dados` com `fonte: "jpa-repository"`,
// `tabela` = NOME DA ENTIDADE em minúsculas (a análise de dados troca pela tabela do `@Table` da entidade).
// Construtores: nome `<init>` (`Classe.<init>`).

const MAPEAMENTOS_SPRING: Readonly<Record<string, string>> = { GetMapping: "GET", PostMapping: "POST", PutMapping: "PUT", PatchMapping: "PATCH", DeleteMapping: "DELETE", RequestMapping: "ALL" };
const VERBOS_JAXRS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);
const FILAS: Readonly<Record<string, { prefixo: string; chaves: string[] }>> = {
  KafkaListener: { prefixo: "kafka", chaves: ["topics", "value", "topicPattern"] },
  RabbitListener: { prefixo: "rabbit", chaves: ["queues", "value", "bindings"] },
  JmsListener: { prefixo: "jms", chaves: ["destination", "value"] },
  SqsListener: { prefixo: "sqs", chaves: ["value", "queueNames"] },
};
const REPOSITORIOS = new Set(["JpaRepository", "CrudRepository", "PagingAndSortingRepository", "ListCrudRepository", "MongoRepository", "ReactiveCrudRepository", "JpaRepositoryImplementation"]);
const DI = new Set(["Autowired", "Inject", "Resource"]);
const REFLEXAO = new Set(["forName", "getMethod", "getDeclaredMethod", "getDeclaredField", "getDeclaredConstructor", "loadClass"]);
const METODOS_SERVLET: Readonly<Record<string, string>> = { doGet: "GET", doPost: "POST", doPut: "PUT", doDelete: "DELETE", doHead: "HEAD", doOptions: "OPTIONS", doPatch: "PATCH" };
const MAX_LIT = 20_000;

interface Anotacao {
  nome: string;
  texto: string;
  no: Node;
  args: Node | null;
}

interface ClasseCtx {
  qualificado: string;
  controller: boolean;
  prefixoRota: string;
  jaxrsPath: string;
  servlet: boolean;
  interface_: boolean;
  exportada: boolean;
  diMarcado: boolean;
  entidade: string | null;
}

interface Quadro {
  de: string | null;
  prefixo: string;
  classe: ClasseCtx | null;
  contador: { n: number };
}

class Visitante {
  private readonly r: ResultadoExtrator = resultadoVazio();
  private readonly unicos = new NomesUnicos();
  private readonly topo = { n: 0 };
  private readonly tratadas = new Set<number>();

  constructor(private readonly ctx: ContextoExtracao) {}

  executar(): ResultadoExtrator {
    const raiz = this.ctx.raiz;
    const q: Quadro = { de: null, prefixo: "", classe: null, contador: this.topo };
    this.visitarFilhos(raiz, q);
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

  /** Conteúdo de um literal de texto (inclusive text block); `null` se não for literal. */
  private literal(no: Node | null): string | null {
    if (no === null || no.type !== "string_literal") return null;
    let s = "";
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f !== null && (f.type === "string_fragment" || f.type === "multiline_string_fragment")) s += this.texto(f);
    }
    return s.length > MAX_LIT ? s.slice(0, MAX_LIT) : s;
  }

  private nomeTipo(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "type_identifier":
      case "identifier":
      case "scoped_type_identifier":
      case "scoped_identifier": {
        const t = this.texto(no);
        return t.length > 200 ? null : t;
      }
      case "generic_type": {
        const f = no.namedChild(0);
        return this.nomeTipo(f);
      }
      default:
        return null;
    }
  }

  private doc(no: Node): string | null {
    const p = no.previousSibling;
    if (p === null || p.type !== "block_comment") return null;
    if (p.endPosition.row < no.startPosition.row - 1) return null;
    const t = this.texto(p);
    return t.startsWith("/**") ? primeiraLinhaDoc(t) : null;
  }

  private modificadores(no: Node): { palavras: Set<string>; anotacoes: Anotacao[] } {
    const palavras = new Set<string>();
    const anotacoes: Anotacao[] = [];
    for (let i = 0; i < no.namedChildCount; i++) {
      const m = no.namedChild(i);
      if (m === null || m.type !== "modifiers") continue;
      for (let k = 0; k < m.childCount; k++) {
        const f = m.child(k);
        if (f === null) continue;
        if (f.type === "marker_annotation" || f.type === "annotation") {
          const nomeNo = f.childForFieldName("name");
          const nome = nomeNo === null ? "" : (this.texto(nomeNo).split(".").pop() as string);
          anotacoes.push({ nome, texto: sanitizarAssinatura(this.texto(f), 120), no: f, args: f.childForFieldName("arguments") });
        } else if (!f.isNamed) palavras.add(f.type);
        else palavras.add(this.texto(f));
      }
    }
    return { palavras, anotacoes };
  }

  /** Valor de um argumento de anotação por chave (`value`/`path`…); o argumento posicional conta como `value`. */
  private valorAnotacao(a: Anotacao, chaves: readonly string[]): Node | null {
    if (a.args === null) return null;
    for (let i = 0; i < a.args.namedChildCount; i++) {
      const f = a.args.namedChild(i);
      if (f === null) continue;
      if (f.type === "element_value_pair") {
        const k = f.childForFieldName("key");
        if (k !== null && chaves.includes(this.texto(k))) return f.childForFieldName("value");
      } else if (chaves.includes("value")) return f;
    }
    return null;
  }

  private strings(no: Node | null): string[] {
    if (no === null) return [];
    if (no.type === "array_initializer" || no.type === "element_value_array_initializer") {
      const s: string[] = [];
      for (let i = 0; i < no.namedChildCount; i++) {
        const v = this.literal(no.namedChild(i));
        if (v !== null) s.push(v);
      }
      return s;
    }
    const v = this.literal(no);
    return v === null ? [] : [v];
  }

  private normalizarRota(p: string): string {
    return p.replace(/\{([a-zA-Z_][\w]*)(?::[^}]*)?\}/g, ":$1");
  }

  private juntar(prefixo: string, caminho: string): string {
    const a = prefixo.replace(/^\/+|\/+$/g, "");
    const b = caminho.replace(/^\/+|\/+$/g, "");
    const j = [a, b].filter((x) => x !== "").join("/");
    return this.normalizarRota(`/${j}`);
  }

  private visibilidade(palavras: Set<string>, emInterface: boolean): Visibilidade {
    if (palavras.has("public")) return "publica";
    if (palavras.has("private")) return "privada";
    if (palavras.has("protected")) return "protegida";
    return emInterface ? "publica" : "pacote";
  }

  private assinatura(no: Node, corpo: Node | null): string {
    // palavras-chave dos modificadores + do tipo/nome até o corpo (sem anotações)
    const partes: string[] = [];
    let inicio: number | null = null;
    for (let i = 0; i < no.childCount; i++) {
      const f = no.child(i);
      if (f === null) continue;
      if (f.type === "modifiers") {
        for (let k = 0; k < f.childCount; k++) {
          const m = f.child(k);
          if (m !== null && m.type !== "marker_annotation" && m.type !== "annotation") partes.push(this.texto(m));
        }
        continue;
      }
      inicio = f.startIndex;
      break;
    }
    const fim = corpo !== null ? corpo.startIndex : no.endIndex;
    if (inicio !== null) partes.push(this.ctx.texto.slice(inicio, fim));
    return sanitizarAssinatura(partes.join(" ").replace(/;\s*$/, ""));
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
    if (ehDecisao("java", no)) q.contador.n++;
    switch (no.type) {
      case "import_declaration":
        this.importacao(no);
        return;
      case "package_declaration":
        return;
      case "class_declaration":
      case "interface_declaration":
      case "enum_declaration":
      case "record_declaration":
      case "annotation_type_declaration":
        this.tipoDecl(no, q);
        return;
      case "method_declaration":
      case "constructor_declaration":
      case "compact_constructor_declaration":
        this.metodo(no, q);
        return;
      case "field_declaration":
        this.campo(no, q);
        this.visitarFilhos(no, q);
        return;
      case "method_invocation":
        this.invocacao(no, q);
        this.visitarFilhos(no, q);
        return;
      case "object_creation_expression":
        this.criacao(no, q);
        this.visitarFilhos(no, q);
        return;
      case "method_reference":
        this.referenciaMetodo(no, q);
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
      case "binary_expression":
        this.concatenacao(no, q);
        this.visitarFilhos(no, q);
        return;
      case "string_literal":
        this.sqlLiteral(no, q, this.literal(no));
        return;
      default:
        this.visitarFilhos(no, q);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // imports

  private importacao(no: Node): void {
    const estatico = no.children.some((c) => c !== null && c.type === "static");
    let nome: Node | null = null;
    let curinga = false;
    for (let i = 0; i < no.namedChildCount; i++) {
      const f = no.namedChild(i);
      if (f === null) continue;
      if (f.type === "asterisk") curinga = true;
      else if (f.type === "scoped_identifier" || f.type === "identifier") nome = f;
    }
    if (nome === null) return;
    const completo = this.texto(nome).replace(/\s+/g, "");
    let especificador = completo;
    const nomes: NomeImportado[] = [];
    if (estatico) {
      if (curinga) nomes.push({ nome: "*", alias: null });
      else {
        const i = completo.lastIndexOf(".");
        especificador = i < 0 ? completo : completo.slice(0, i);
        nomes.push({ nome: i < 0 ? completo : completo.slice(i + 1), alias: null });
      }
    } else if (curinga) nomes.push({ nome: "*", alias: null });
    this.empurrar(this.r.imports, { especificador, tipo: "estatico", linha: linhaIni(no), so_tipo: false, nomes }, LIMITES_EXTRACAO.imports);
  }

  // ---------------------------------------------------------------------------------------------
  // tipos e membros

  private tipoDecl(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) return;
    const nome = this.texto(nomeNo);
    const qualificado = this.unicos.unico(q.prefixo === "" ? nome : `${q.prefixo}.${nome}`);
    const corpo = no.childForFieldName("body");
    const { palavras, anotacoes } = this.modificadores(no);
    const emInterface = q.classe?.interface_ === true;
    const subtipo: SubtipoSimbolo = no.type === "interface_declaration" || no.type === "annotation_type_declaration" ? "interface" : no.type === "enum_declaration" ? "enum" : "classe";
    const exportada = (q.classe === null ? true : q.classe.exportada) && (palavras.has("public") || (emInterface && !palavras.has("private")));
    const topoNivel = q.classe === null && q.prefixo === "";
    const s: SimboloBruto = {
      nome,
      qualificado,
      tipo: subtipo,
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: topoNivel ? palavras.has("public") : exportada,
      visibilidade: this.visibilidade(palavras, emInterface),
      complexidade: 1,
      assinatura: this.assinatura(no, corpo),
      doc: this.doc(no),
      decoradores: anotacoes.slice(0, LIMITES_EXTRACAO.decoradores).map((a) => a.texto),
    };
    this.empurrar(this.r.simbolos, s, MAX_SIMBOLOS);

    // herança
    const ehInterface = subtipo === "interface";
    for (let i = 0; i < no.namedChildCount; i++) {
      const c = no.namedChild(i);
      if (c === null) continue;
      if (c.type === "superclass") {
        const base = this.nomeTipo(c.namedChild(0));
        if (base !== null) this.empurrar(this.r.herancas, { classe: qualificado, base, tipo: "herda", linha: linhaIni(c) }, LIMITES_EXTRACAO.herancas);
      } else if (c.type === "super_interfaces" || c.type === "extends_interfaces") {
        const lista = c.namedChild(0);
        for (let k = 0; lista !== null && k < lista.namedChildCount; k++) {
          const t = lista.namedChild(k);
          const base = this.nomeTipo(t);
          if (base === null) continue;
          this.empurrar(this.r.herancas, { classe: qualificado, base, tipo: c.type === "super_interfaces" ? "implementa" : "herda", linha: linhaIni(c) }, LIMITES_EXTRACAO.herancas);
          if (ehInterface && t !== null && t.type === "generic_type" && REPOSITORIOS.has((base.split(".").pop() as string))) this.repositorio(t, qualificado);
        }
      }
    }

    // contexto da classe: rotas, JAX-RS, servlet
    const ctxClasse: ClasseCtx = {
      qualificado,
      controller: anotacoes.some((a) => a.nome === "RestController" || a.nome === "Controller"),
      prefixoRota: "",
      jaxrsPath: "",
      servlet: no.type === "class_declaration" && this.herdaServlet(no),
      interface_: ehInterface,
      exportada: s.exportado || exportada,
      diMarcado: false,
      entidade: null,
    };
    for (const a of anotacoes) {
      if (a.nome === "RequestMapping") ctxClasse.prefixoRota = this.strings(this.valorAnotacao(a, ["value", "path"]))[0] ?? "";
      else if (a.nome === "Path") ctxClasse.jaxrsPath = this.strings(this.valorAnotacao(a, ["value"]))[0] ?? "";
      else if (a.nome === "WebServlet") {
        const p = this.strings(this.valorAnotacao(a, ["value", "urlPatterns"]))[0];
        if (p !== undefined) this.empurrar(this.r.entradas, { tipo: "rota", chave: `ALL ${p}`, framework: "servlet", handler: qualificado, linha: linhaIni(a.no), confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      }
    }
    this.dadosJpa(no, nome, qualificado, anotacoes, ctxClasse);

    const nq: Quadro = { de: qualificado, prefixo: qualificado, classe: ctxClasse, contador: q.contador };
    if (corpo !== null) this.corpoTipo(corpo, nq);
  }

  private corpoTipo(corpo: Node, q: Quadro): void {
    for (let i = 0; i < corpo.namedChildCount; i++) {
      const f = corpo.namedChild(i);
      if (f === null) continue;
      if (f.type === "enum_constant") {
        const c = f.childForFieldName("body");
        const n = f.childForFieldName("name");
        if (c !== null && n !== null) this.corpoTipo(c, { ...q, prefixo: `${q.prefixo}.${this.texto(n)}` });
        continue;
      }
      if (f.type === "enum_body_declarations") {
        this.corpoTipo(f, q);
        continue;
      }
      this.visitar(f, q);
    }
  }

  private herdaServlet(no: Node): boolean {
    const sup = no.childForFieldName("superclass");
    const base = sup === null ? null : this.nomeTipo(sup.namedChild(0));
    return base !== null && /(^|\.)(HttpServlet|GenericServlet)$/.test(base);
  }

  private repositorio(tipo: Node, de: string): void {
    const args = tipo.namedChildren.find((c) => c !== null && c.type === "type_arguments");
    const entidade = args?.namedChild(0);
    const nome = entidade === null || entidade === undefined ? null : this.nomeTipo(entidade);
    if (nome === null) return;
    this.empurrar(this.r.dados, { tabela: (nome.split(".").pop() as string).toLowerCase(), operacao: "desconhecida", de, linha: linhaIni(tipo), confianca: "heuristica", fonte: "jpa-repository" }, LIMITES_EXTRACAO.dados);
  }

  private dadosJpa(no: Node, nome: string, qualificado: string, anotacoes: Anotacao[], c: ClasseCtx): void {
    const entity = anotacoes.some((a) => a.nome === "Entity");
    const tabela = anotacoes.find((a) => a.nome === "Table");
    const linha = linhaIni(no);
    if (tabela !== undefined) {
      const t = this.strings(this.valorAnotacao(tabela, ["name"]))[0];
      if (t !== undefined) {
        this.empurrar(this.r.dados, { tabela: t.toLowerCase(), operacao: "define", de: qualificado, linha, confianca: "exata", fonte: "jpa" }, LIMITES_EXTRACAO.dados);
        c.entidade = t;
        return;
      }
    }
    if (entity) this.empurrar(this.r.dados, { tabela: nome.toLowerCase(), operacao: "define", de: qualificado, linha, confianca: "heuristica", fonte: "jpa" }, LIMITES_EXTRACAO.dados);
  }

  private campo(no: Node, q: Quadro): void {
    const { palavras, anotacoes } = this.modificadores(no);
    if (q.classe !== null && anotacoes.some((a) => DI.has(a.nome))) this.marcarDi(q.classe, no);
    const emInterface = q.classe?.interface_ === true;
    if (!((palavras.has("static") && palavras.has("final")) || emInterface)) return;
    for (let i = 0; i < no.namedChildCount; i++) {
      const d = no.namedChild(i);
      if (d === null || d.type !== "variable_declarator") continue;
      const n = d.childForFieldName("name");
      if (n === null) continue;
      const nome = this.texto(n);
      const s: SimboloBruto = {
        nome,
        qualificado: this.unicos.unico(q.prefixo === "" ? nome : `${q.prefixo}.${nome}`),
        tipo: "constante",
        linha: linhaIni(no),
        linha_fim: linhaFim(no),
        exportado: (q.classe?.exportada ?? false) && (palavras.has("public") || emInterface),
        visibilidade: this.visibilidade(palavras, emInterface),
        complexidade: 1,
        assinatura: sanitizarAssinatura(nome),
        doc: this.doc(no),
        decoradores: [],
      };
      this.empurrar(this.r.simbolos, s, MAX_SIMBOLOS);
    }
  }

  private marcarDi(c: ClasseCtx, no: Node): void {
    if (c.diMarcado) return;
    c.diMarcado = true;
    this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha: linhaIni(no) }, LIMITES_EXTRACAO.dinamicos);
  }

  private metodo(no: Node, q: Quadro): void {
    const ehConstrutor = no.type !== "method_declaration";
    const nomeNo = no.childForFieldName("name");
    const nome = ehConstrutor ? "<init>" : nomeNo === null ? "" : this.texto(nomeNo);
    if (nome === "") return;
    const qualificado = this.unicos.unico(q.prefixo === "" ? nome : `${q.prefixo}.${nome}`);
    const corpo = no.childForFieldName("body");
    const { palavras, anotacoes } = this.modificadores(no);
    const classe = q.classe;
    const emInterface = classe?.interface_ === true;
    const vis = this.visibilidade(palavras, emInterface);
    const s: SimboloBruto = {
      nome,
      qualificado,
      tipo: "metodo",
      linha: linhaIni(no),
      linha_fim: linhaFim(no),
      exportado: (classe?.exportada ?? false) && vis === "publica",
      visibilidade: vis,
      complexidade: 1,
      assinatura: this.assinatura(no, corpo),
      doc: this.doc(no),
      decoradores: anotacoes.slice(0, LIMITES_EXTRACAO.decoradores).map((a) => a.texto),
    };
    this.empurrar(this.r.simbolos, s, MAX_SIMBOLOS);
    if (classe !== null) {
      this.entradasDoMetodo(no, nome, qualificado, palavras, anotacoes, classe);
      if (anotacoes.some((a) => DI.has(a.nome))) this.marcarDi(classe, no);
      for (const a of anotacoes) if (a.nome === "Query") this.consultaAnotada(a, qualificado);
    }
    const nq: Quadro = { de: qualificado, prefixo: qualificado, classe, contador: { n: 0 } };
    if (corpo !== null) this.visitarFilhos(corpo, nq);
    s.complexidade = 1 + nq.contador.n;
  }

  private consultaAnotada(a: Anotacao, de: string): void {
    const nativa = a.args !== null && this.texto(a.args).replace(/\s+/g, "").includes("nativeQuery=true");
    const lit = this.valorAnotacao(a, ["value"]);
    const v = this.literal(lit);
    if (v === null) return;
    this.tabelasDoSql(v, de, linhaIni(a.no), nativa ? "exata" : "heuristica");
  }

  // ---------------------------------------------------------------------------------------------
  // entradas

  private entradasDoMetodo(no: Node, nome: string, qualificado: string, palavras: Set<string>, anotacoes: Anotacao[], c: ClasseCtx): void {
    const linha = linhaIni(no);
    // main
    if (nome === "main" && palavras.has("static") && palavras.has("public") && no.childForFieldName("type")?.type === "void_type")
      this.empurrar(this.r.entradas, { tipo: "main", chave: "main", framework: "java", handler: qualificado, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    // servlet
    if (c.servlet && METODOS_SERVLET[nome] !== undefined)
      this.empurrar(this.r.entradas, { tipo: "rota", chave: `${METODOS_SERVLET[nome] as string} servlet:${c.qualificado}`, framework: "servlet", handler: qualificado, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
    const confSpring: Confianca = c.controller ? "exata" : "heuristica";
    let verboJax: string | null = null;
    let caminhoJax: string | null = null;
    for (const a of anotacoes) {
      const spring = MAPEAMENTOS_SPRING[a.nome];
      if (spring !== undefined) {
        let verbos = [spring];
        if (a.nome === "RequestMapping") {
          const m = this.valorAnotacao(a, ["method"]);
          const lista = m === null ? [] : (m.type === "array_initializer" || m.type === "element_value_array_initializer") ? m.namedChildren.filter((x): x is Node => x !== null) : [m];
          const vs = lista.map((x) => (this.texto(x).split(".").pop() as string).toUpperCase());
          if (vs.length > 0) verbos = vs;
        }
        const caminhos = this.strings(this.valorAnotacao(a, ["value", "path"]));
        for (const p of caminhos.length === 0 ? [""] : caminhos)
          for (const v of verbos)
            this.empurrar(this.r.entradas, { tipo: "rota", chave: `${v} ${this.juntar(c.prefixoRota, p)}`, framework: "spring", handler: qualificado, linha, confianca: confSpring }, LIMITES_EXTRACAO.entradas);
      } else if (a.nome === "Scheduled") {
        const cron = this.strings(this.valorAnotacao(a, ["cron"]))[0];
        let chave: string | null = cron !== undefined ? `cron:${cron}` : null;
        if (chave === null) {
          const texto = a.args === null ? "" : this.texto(a.args);
          const m = /(fixedRate|fixedDelay)\s*=\s*([\w.]+)/.exec(texto);
          chave = m === null ? `cron:${qualificado}` : `${m[1] as string}:${m[2] as string}`;
        }
        this.empurrar(this.r.entradas, { tipo: "job", chave, framework: "spring", handler: qualificado, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      } else if (FILAS[a.nome] !== undefined) {
        const f = FILAS[a.nome] as { prefixo: string; chaves: string[] };
        const destino = this.strings(this.valorAnotacao(a, f.chaves));
        this.empurrar(this.r.entradas, { tipo: "fila", chave: `${f.prefixo}:${destino.join(",") || qualificado}`, framework: "spring", handler: qualificado, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      } else if (a.nome === "EventListener" || a.nome === "TransactionalEventListener") {
        const p = no.childForFieldName("parameters")?.namedChild(0)?.childForFieldName("type") ?? null;
        const tipoEvento = this.nomeTipo(p);
        this.empurrar(this.r.entradas, { tipo: "evento", chave: `event:${tipoEvento ?? qualificado}`, framework: "spring", handler: qualificado, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
      } else if (VERBOS_JAXRS.has(a.nome)) verboJax = a.nome;
      else if (a.nome === "Path") caminhoJax = this.strings(this.valorAnotacao(a, ["value"]))[0] ?? "";
    }
    if (verboJax !== null && (c.jaxrsPath !== "" || caminhoJax !== null))
      this.empurrar(this.r.entradas, { tipo: "rota", chave: `${verboJax} ${this.juntar(c.jaxrsPath, caminhoJax ?? "")}`, framework: "jaxrs", handler: qualificado, linha, confianca: "exata" }, LIMITES_EXTRACAO.entradas);
  }

  // ---------------------------------------------------------------------------------------------
  // chamadas

  private receptorTexto(no: Node | null): string | null {
    if (no === null) return null;
    switch (no.type) {
      case "identifier":
      case "this":
      case "super":
        return this.texto(no);
      case "field_access": {
        const o = this.receptorTexto(no.childForFieldName("object"));
        const f = no.childForFieldName("field");
        if (o === null || f === null || o === "?") return "?";
        return `${o}.${this.texto(f)}`;
      }
      default:
        return "?";
    }
  }

  private invocacao(no: Node, q: Quadro): void {
    const nomeNo = no.childForFieldName("name");
    if (nomeNo === null) return;
    const alvo = this.texto(nomeNo);
    const objeto = no.childForFieldName("object");
    const receptor = objeto === null ? null : this.receptorTexto(objeto);
    const linha = linhaIni(no);
    this.empurrar(this.r.chamadas, { de: q.de, alvo, receptor, tipo: "chamada", linha }, LIMITES_EXTRACAO.chamadas);
    if (REFLEXAO.has(alvo) || (alvo === "invoke" && (no.childForFieldName("arguments")?.namedChildCount ?? 0) >= 1))
      this.empurrar(this.r.dinamicos, { tipo: "reflexao", linha }, LIMITES_EXTRACAO.dinamicos);
    if (alvo === "getenv" && receptor === "System") {
      const nome = this.literal(no.childForFieldName("arguments")?.namedChild(0) ?? null);
      if (nome !== null) this.empurrar(this.r.padroes, { tipo: "env", nome, linha }, LIMITES_EXTRACAO.padroes);
    }
  }

  private criacao(no: Node, q: Quadro): void {
    const t = this.nomeTipo(no.childForFieldName("type"));
    if (t === null) return;
    this.empurrar(this.r.chamadas, { de: q.de, alvo: t, receptor: null, tipo: "instancia", linha: linhaIni(no) }, LIMITES_EXTRACAO.chamadas);
  }

  private referenciaMetodo(no: Node, q: Quadro): void {
    const a = no.namedChild(0);
    const b = no.namedChild(no.namedChildCount - 1);
    if (a === null || b === null || a.id === b.id) return;
    this.empurrar(this.r.chamadas, { de: q.de, alvo: this.texto(b), receptor: this.receptorTexto(a), tipo: "referencia", linha: linhaIni(no) }, LIMITES_EXTRACAO.chamadas);
  }

  // ---------------------------------------------------------------------------------------------
  // dados (SQL em literais)

  private concatenacao(no: Node, q: Quadro): void {
    const op = no.childForFieldName("operator");
    if (op === null || op.type !== "+") return;
    const pai = no.parent;
    if (pai !== null && pai.type === "binary_expression" && pai.childForFieldName("operator")?.type === "+") return; // só o mais externo
    const pecas: Array<{ t: string; lit: boolean; no: Node | null }> = [];
    const juntar = (n: Node): void => {
      if (n.type === "binary_expression" && n.childForFieldName("operator")?.type === "+") {
        juntar(n.childForFieldName("left") as Node);
        juntar(n.childForFieldName("right") as Node);
      } else if (n.type === "string_literal") pecas.push({ t: this.literal(n) ?? "", lit: true, no: n });
      else pecas.push({ t: "?", lit: false, no: null });
    };
    juntar(no);
    if (!pecas.some((p) => p.lit)) return;
    for (const p of pecas) if (p.no !== null) this.tratadas.add(p.no.id);
    this.tabelasDoSql(pecas.map((p) => p.t).join(""), q.de, linhaIni(no), pecas.every((p) => p.lit) ? "exata" : "heuristica");
  }

  private sqlLiteral(no: Node, q: Quadro, v: string | null): void {
    if (v === null || this.tratadas.has(no.id)) return;
    this.tabelasDoSql(v, q.de, linhaIni(no), "exata");
  }

  private tabelasDoSql(sql: string, de: string | null, linha: number, confianca: Confianca): void {
    for (const t of extrairTabelasSql(sql)) {
      const operacao: OperacaoDado = t.operacao;
      this.empurrar(this.r.dados, { tabela: t.tabela, operacao, de, linha, confianca, fonte: "sql" }, LIMITES_EXTRACAO.dados);
    }
  }
}

export const extratorJava: Extrator = {
  extrair(ctx: ContextoExtracao) {
    return new Visitante(ctx).executar();
  },
};
