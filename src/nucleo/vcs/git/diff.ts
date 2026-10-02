import { StringDecoder } from "node:string_decoder";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Diff, DiffArquivo, Hunk, LinhaDiff, OpcoesDiff, ParteLinha } from "../vcs";
import { executorPadrao, type ExecutorVcs } from "../executor";
import { GitErro, NomeInvalidoErro } from "../../git/erros";

// T-06.06 · Diff: parser tolerante e incremental de `git diff` (unified e `--word-diff=porcelain`) mais a
// orquestração em stream. O parser NUNCA lança: saída truncada, lixo ou formato inesperado só geram
// menos informação (o último hunk/arquivo fica marcado `incompleto`/`truncado`).

export const LIMITE_DIFF_BYTES = 8 * 1024 * 1024;
const RE_HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Desfaz o quoting C do git (`"a\tb\303\251"`). Sem aspas, devolve igual. */
export function desaspar(s: string): string {
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s;
  const bytes: number[] = [];
  const corpo = s.slice(1, -1);
  const enc = new TextEncoder();
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i] as string;
    if (c !== "\\") {
      for (const b of enc.encode(c)) bytes.push(b);
      continue;
    }
    const n = corpo[++i];
    if (n === undefined) break;
    if (n >= "0" && n <= "7") {
      let oct = n;
      while (oct.length < 3 && corpo[i + 1] !== undefined && (corpo[i + 1] as string) >= "0" && (corpo[i + 1] as string) <= "7") oct += corpo[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else {
      const m: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, "\\": 92 };
      bytes.push(m[n] ?? n.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

const semPrefixo = (c: string, p: "a/" | "b/"): string => (c.startsWith(p) ? c.slice(2) : c);

/** `a/X b/X` (ou renomeação ambígua) do cabeçalho `diff --git`. */
function caminhosDoCabecalho(rest: string): [string, string] {
  if (rest.startsWith('"')) {
    const fim = rest.indexOf('"', 1);
    let i = 1;
    let f = -1;
    for (; i < rest.length; i++) {
      if (rest[i] === "\\") i++;
      else if (rest[i] === '"') {
        f = i;
        break;
      }
    }
    if (f < 0) f = fim;
    const a = desaspar(rest.slice(0, f + 1));
    const b = desaspar(rest.slice(f + 2));
    return [semPrefixo(a, "a/"), semPrefixo(b, "b/")];
  }
  const n = (rest.length - 5) / 2;
  if (Number.isInteger(n) && n > 0 && rest.startsWith("a/") && rest.slice(2, 2 + n) === rest.slice(n + 5) && rest.slice(2 + n, 5 + n) === " b/") {
    const p = rest.slice(2, 2 + n);
    return [p, p];
  }
  const i = rest.indexOf(" b/");
  if (i > 0) return [semPrefixo(rest.slice(0, i), "a/"), rest.slice(i + 3)];
  return [rest, rest];
}

interface EstadoArquivo {
  d: DiffArquivo;
  crAdd: number;
  crDel: number;
  lfAdd: number;
  lfDel: number;
}

export class ParserDiff {
  private readonly palavra: boolean;
  private readonly decoder = new StringDecoder("utf8");
  private residuo = "";
  private readonly arquivos: DiffArquivo[] = [];
  private arq: EstadoArquivo | null = null;
  private hunk: Hunk | null = null;
  private restA = 0;
  private restN = 0;
  private numA = 0;
  private numN = 0;
  // modo palavra
  private partes: ParteLinha[] = [];

  constructor(opcoes: { palavra?: boolean } = {}) {
    this.palavra = opcoes.palavra === true;
  }

  escrever(pedaco: Buffer | string): void {
    const texto = this.residuo + (typeof pedaco === "string" ? pedaco : this.decoder.write(pedaco));
    let ini = 0;
    for (;;) {
      const fim = texto.indexOf("\n", ini);
      if (fim < 0) break;
      this.linha(texto.slice(ini, fim));
      ini = fim + 1;
    }
    this.residuo = texto.slice(ini);
  }

  /** Fecha o que estiver aberto. `truncado`: a saída foi cortada. Nunca lança. */
  finalizar(truncado = false): Diff {
    try {
      const resto = this.residuo + this.decoder.end();
      this.residuo = "";
      if (resto !== "") this.linha(resto);
      if (this.palavra && this.partes.length > 0) this.fecharLinhaPalavra();
      if (this.hunk && (truncado || (!this.palavra && (this.restA > 0 || this.restN > 0)))) this.hunk.incompleto = true;
      this.fecharArquivo();
    } catch {
      /* tolerância total */
    }
    return { arquivos: this.arquivos, truncado, grande: false };
  }

  private iniciarArquivo(l: string): void {
    this.fecharArquivo();
    const [a, b] = caminhosDoCabecalho(l.slice(11));
    this.arq = {
      d: { caminho: b, caminhoAntigo: a, estado: "modificado", binario: false, mudouModo: false, eol: null, soFimDeLinha: false, insercoes: 0, delecoes: 0, hunks: [] },
      crAdd: 0, crDel: 0, lfAdd: 0, lfDel: 0,
    };
  }

  private fecharArquivo(): void {
    const e = this.arq;
    if (!e) return;
    if (this.palavra && this.partes.length > 0) this.fecharLinhaPalavra();
    if (this.hunk && !this.palavra && (this.restA > 0 || this.restN > 0)) this.hunk.incompleto = true;
    const { d } = e;
    const cr = e.crAdd + e.crDel;
    const lf = e.lfAdd + e.lfDel;
    d.eol = cr + lf === 0 ? null : cr === 0 ? "lf" : lf === 0 ? "crlf" : "misto";
    if (!this.palavra && d.insercoes === d.delecoes && d.insercoes > 0 && e.crAdd !== e.crDel) {
      const dels: string[] = [];
      const adds: string[] = [];
      for (const h of d.hunks) for (const x of h.linhas) (x.tipo === "del" ? dels : x.tipo === "add" ? adds : []).push(x.texto);
      d.soFimDeLinha = dels.length === adds.length && dels.every((t, i) => t === adds[i]);
    }
    this.arquivos.push(d);
    this.arq = null;
    this.hunk = null;
    this.restA = 0;
    this.restN = 0;
  }

  private linha(l: string): void {
    if (l.startsWith("diff --git ")) {
      if (this.palavra && this.partes.length > 0) this.fecharLinhaPalavra();
      this.iniciarArquivo(l);
      return;
    }
    const e = this.arq;
    if (!e) return;
    if (l.startsWith("@@ ")) {
      this.novoHunk(l, e);
      return;
    }
    if (this.hunk !== null && (this.palavra ? true : this.restA > 0 || this.restN > 0 || l.charCodeAt(0) === 92)) {
      if (this.palavra) this.corpoPalavra(l, e);
      else this.corpo(l, e);
      return;
    }
    this.cabecalho(l, e.d);
  }

  private novoHunk(l: string, e: EstadoArquivo): void {
    if (this.palavra && this.partes.length > 0) this.fecharLinhaPalavra();
    if (this.hunk && !this.palavra && (this.restA > 0 || this.restN > 0)) this.hunk.incompleto = true;
    const m = RE_HUNK.exec(l);
    if (m === null) {
      this.hunk = null;
      return;
    }
    const aq = m[2] === undefined ? 1 : Number(m[2]);
    const nq = m[4] === undefined ? 1 : Number(m[4]);
    this.hunk = { cabecalho: l, antigaInicio: Number(m[1]), antigaQtd: aq, novaInicio: Number(m[3]), novaQtd: nq, secao: m[5] ?? "", linhas: [] };
    this.restA = aq;
    this.restN = nq;
    this.numA = Number(m[1]);
    this.numN = Number(m[3]);
    e.d.hunks.push(this.hunk);
  }

  private cabecalho(l: string, d: DiffArquivo): void {
    if (l.startsWith("--- ") || l.startsWith("+++ ")) {
      if (d.hunks.length > 0) return;
      const bruto = l.slice(4).replace(/\t.*$/, "");
      if (bruto === "/dev/null") return;
      if (l[0] === "-") d.caminhoAntigo = semPrefixo(desaspar(bruto), "a/");
      else d.caminho = semPrefixo(desaspar(bruto), "b/");
    } else if (l.startsWith("new file mode ")) {
      d.estado = "novo";
      d.modoNovo = l.slice(14).trim();
    } else if (l.startsWith("deleted file mode ")) {
      d.estado = "apagado";
      d.modoAntigo = l.slice(18).trim();
    } else if (l.startsWith("old mode ")) {
      d.modoAntigo = l.slice(9).trim();
      d.mudouModo = true;
    } else if (l.startsWith("new mode ")) {
      d.modoNovo = l.slice(9).trim();
      d.mudouModo = true;
    } else if (l.startsWith("similarity index ")) {
      d.similaridade = parseInt(l.slice(17), 10);
    } else if (l.startsWith("rename from ")) {
      d.estado = "renomeado";
      d.caminhoAntigo = desaspar(l.slice(12));
    } else if (l.startsWith("rename to ")) {
      d.estado = "renomeado";
      d.caminho = desaspar(l.slice(10));
    } else if (l.startsWith("copy from ")) {
      d.estado = "copiado";
      d.caminhoAntigo = desaspar(l.slice(10));
    } else if (l.startsWith("copy to ")) {
      d.estado = "copiado";
      d.caminho = desaspar(l.slice(8));
    } else if (l.startsWith("Binary files ") || l.startsWith("GIT binary patch")) {
      d.binario = true;
    } else if (l.startsWith("index ")) {
      const modo = /^index \S+ (\d{6})$/.exec(l)?.[1];
      if (modo !== undefined) {
        d.modoAntigo ??= modo;
        d.modoNovo ??= modo;
      }
    }
  }

  private submodulo(l: string, d: DiffArquivo): void {
    const m = /^([-+])Subproject commit (\S+)/.exec(l);
    if (m === null) return;
    d.submodulo ??= { de: null, para: null, sujo: false };
    const hash = m[2] as string;
    const sujo = hash.endsWith("-dirty");
    const h = sujo ? hash.slice(0, -6) : hash;
    if (m[1] === "-") d.submodulo.de = h;
    else {
      d.submodulo.para = h;
      if (sujo) d.submodulo.sujo = true;
    }
  }

  private corpo(l: string, e: EstadoArquivo): void {
    const h = this.hunk as Hunk;
    const c = l.charCodeAt(0);
    if (c === 92 /* \ */) {
      const ult = h.linhas[h.linhas.length - 1];
      if (ult) ult.semFim = true;
      return;
    }
    let tipo: LinhaDiff["tipo"];
    if (c === 43) tipo = "add";
    else if (c === 45) tipo = "del";
    else if (c === 32 || l === "") tipo = "ctx";
    else {
      // linha que não é de corpo: o hunk acabou antes do esperado (contagem errada ou diff adulterado)
      h.incompleto = true;
      this.restA = 0;
      this.restN = 0;
      this.cabecalho(l, e.d);
      return;
    }
    let texto = l.slice(1);
    const cr = texto.charCodeAt(texto.length - 1) === 13;
    if (cr) texto = texto.slice(0, -1);
    let linha: LinhaDiff;
    if (tipo === "ctx") {
      linha = { tipo, texto, antiga: this.numA++, nova: this.numN++ };
      this.restA--;
      this.restN--;
    } else if (tipo === "add") {
      linha = { tipo, texto, antiga: null, nova: this.numN++ };
      this.restN--;
      e.d.insercoes++;
      if (cr) e.crAdd++;
      else e.lfAdd++;
    } else {
      linha = { tipo, texto, antiga: this.numA++, nova: null };
      this.restA--;
      e.d.delecoes++;
      if (cr) e.crDel++;
      else e.lfDel++;
    }
    h.linhas.push(linha);
    if (c !== 32 && l.length > 15 && l.charCodeAt(1) === 83 /* S */) this.submodulo(l, e.d);
  }

  private corpoPalavra(l: string, e: EstadoArquivo): void {
    void e;
    if (l === "~") {
      this.fecharLinhaPalavra();
      return;
    }
    const c = l[0];
    if (c === "\\") return;
    if (c === " " || c === "+" || c === "-") this.partes.push({ tipo: c === " " ? "ctx" : c === "+" ? "add" : "del", texto: l.slice(1) });
    // outro: ignora (tolerante)
  }

  private fecharLinhaPalavra(): void {
    const h = this.hunk;
    const e = this.arq;
    const partes = this.partes;
    this.partes = [];
    if (!h || !e) return;
    const temAdd = partes.some((p) => p.tipo === "add");
    const temDel = partes.some((p) => p.tipo === "del");
    const temCtx = partes.length === 0 || partes.some((p) => p.tipo === "ctx");
    let tipo: LinhaDiff["tipo"] = "ctx";
    if (temAdd && temDel) tipo = "mod";
    else if (temAdd) tipo = temCtx ? "mod" : "add";
    else if (temDel) tipo = temCtx ? "mod" : "del";
    const texto = partes.filter((p) => p.tipo !== "add").map((p) => p.texto).join("");
    const novoTexto = partes.filter((p) => p.tipo !== "del").map((p) => p.texto).join("");
    const antiga = tipo === "add" ? null : this.numA++;
    const nova = tipo === "del" ? null : this.numN++;
    h.linhas.push({ tipo, texto: tipo === "add" ? novoTexto : texto, antiga, nova, partes });
    if (tipo === "add" || tipo === "mod") e.d.insercoes += temAdd ? 1 : 0;
    if (tipo === "del" || tipo === "mod") e.d.delecoes += temDel ? 1 : 0;
  }
}

/** Conveniência: parse de um texto inteiro. */
export function parseDiff(texto: string, opcoes: { palavra?: boolean; truncado?: boolean } = {}): Diff {
  const p = new ParserDiff(opcoes);
  p.escrever(texto);
  return p.finalizar(opcoes.truncado === true);
}

/** Aceita só caminho relativo, sem `..`, sem NUL. Devolve com `/`. */
export function caminhoRelativoSeguro(caminho: string): string {
  const c = caminho.replace(/\\/g, "/");
  if (c === "" || c.includes("\0") || isAbsolute(c) || /^[a-zA-Z]:/.test(c) || c.split("/").some((p) => p === "..")) throw new NomeInvalidoErro(caminho);
  return c;
}

export interface OpcoesDiffGit extends OpcoesDiff {
  executor?: ExecutorVcs;
  executavel?: string;
}

const ARGS_BASE = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", "--find-renames"];

/** Diff do repositório (ou de um arquivo), em stream, com limite de tamanho e marcação "grande". */
export async function diffGit(raiz: string, op: OpcoesDiffGit = {}): Promise<Diff> {
  const ex = op.executor ?? executorPadrao;
  const limite = op.limiteBytes ?? LIMITE_DIFF_BYTES;
  const contexto = Number.isInteger(op.contexto) && (op.contexto as number) >= 0 ? (op.contexto as number) : 3;
  const palavra = op.palavra === true;
  const caminho = op.caminho === undefined ? undefined : caminhoRelativoSeguro(op.caminho);
  if (op.base !== undefined && (op.base === "" || op.base.startsWith("-") || /[\s\0]/.test(op.base))) throw new NomeInvalidoErro(op.base);

  let args: string[];
  if (op.naoRastreado === true) {
    if (caminho === undefined) throw new GitErro("diff de arquivo não rastreado exige o caminho");
    const info = await stat(join(raiz, caminho)).catch(() => null);
    if (info === null) throw new GitErro(`Arquivo inexistente: ${caminho}`);
    if (info.size > limite) {
      return {
        arquivos: [{ caminho, caminhoAntigo: caminho, estado: "novo", binario: false, mudouModo: false, eol: null, soFimDeLinha: false, insercoes: 0, delecoes: 0, hunks: [] }],
        truncado: true,
        grande: true,
      };
    }
    args = [...ARGS_BASE, `-U${contexto}`, ...(palavra ? ["--word-diff=porcelain"] : []), "--no-index", "--", "/dev/null", caminho];
  } else {
    args = [
      ...ARGS_BASE,
      `-U${contexto}`,
      ...(palavra ? ["--word-diff=porcelain"] : []),
      ...(op.base !== undefined ? [`${op.base}...HEAD`] : op.staged === true ? ["--cached"] : []),
      ...(caminho === undefined ? [] : ["--", caminho]),
    ];
  }
  const parser = new ParserDiff({ palavra });
  const r = await ex.executar(args, {
    cwd: raiz,
    tipo: "leitura",
    maxBytes: limite,
    encerrarNoLimite: true,
    timeoutMs: 30_000,
    tolerar: op.naoRastreado === true ? [1] : [],
    aoStdout: (b) => parser.escrever(b),
    ...(op.signal ? { signal: op.signal } : {}),
    ...(op.executavel ? { executavel: op.executavel } : {}),
  });
  const diff = parser.finalizar(r.truncado);
  diff.grande = r.truncado;
  return diff;
}
