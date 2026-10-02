import { hashConteudo } from "../hash";
import { contarLinhas, ehArquivoDeTeste, ehArquivoGerado, type Intervalo } from "../metricas";
import { VERSAO_EXTRATOR, type AcessoDadoBruto, type Extracao, type ImportBruto } from "../tipos";
import { extrairTabelasSql } from "./sql";
import { resultadoVazio, type Extrator, type ResultadoExtrator } from "./comum";

// Modo degradado (T-17.15): linguagens SEM gramática embarcada (Kotlin, Swift, Scala, Dart, Perl, Delphi, VB, COBOL,
// SQL…). Arquivo + LOC próprio (tabela de comentários por extensão) + imports por regex padrão por extensão +
// DDL de `.sql`. Tudo `heuristica` (o resolvedor trata linguagem `outra` como heurística; o armazém marca
// `degradado = 1`). Símbolos só virão de ctags quando existir (outra task). Puro e estático.

interface RegraComentario {
  linha: readonly string[];
  bloco: ReadonlyArray<readonly [string, string]>;
  /** `'` abre string (e não comentário) nesta família. */
  aspaSimples: boolean;
  /** COBOL: `*` na coluna 7 comenta a linha. */
  cobol?: boolean;
}

const C_LIKE: RegraComentario = { linha: ["//"], bloco: [["/*", "*/"]], aspaSimples: true };
const HASH: RegraComentario = { linha: ["#"], bloco: [], aspaSimples: true };
const PASCAL: RegraComentario = { linha: ["//"], bloco: [["{", "}"], ["(*", "*)"]], aspaSimples: false };

export const COMENTARIOS_POR_EXTENSAO: Readonly<Record<string, RegraComentario>> = {
  ".kt": C_LIKE, ".kts": C_LIKE, ".swift": C_LIKE, ".scala": C_LIKE, ".sc": C_LIKE, ".dart": C_LIKE, ".groovy": C_LIKE, ".gradle": C_LIKE,
  ".m": C_LIKE, ".mm": C_LIKE, ".fs": { linha: ["//"], bloco: [["(*", "*)"]], aspaSimples: true },
  ".vue": { linha: ["//"], bloco: [["/*", "*/"], ["<!--", "-->"]], aspaSimples: true },
  ".svelte": { linha: ["//"], bloco: [["/*", "*/"], ["<!--", "-->"]], aspaSimples: true },
  ".pl": { linha: ["#"], bloco: [["=pod", "=cut"]], aspaSimples: true }, ".pm": { linha: ["#"], bloco: [["=pod", "=cut"]], aspaSimples: true },
  ".sh": HASH, ".bash": HASH, ".r": HASH, ".ex": HASH, ".exs": HASH,
  ".ps1": { linha: ["#"], bloco: [["<#", "#>"]], aspaSimples: true },
  ".sql": { linha: ["--"], bloco: [["/*", "*/"]], aspaSimples: true },
  ".hs": { linha: ["--"], bloco: [["{-", "-}"]], aspaSimples: true },
  ".lua": { linha: ["--"], bloco: [["--[[", "]]"]], aspaSimples: true },
  ".erl": { linha: ["%"], bloco: [], aspaSimples: false },
  ".clj": { linha: [";"], bloco: [], aspaSimples: false },
  ".pas": PASCAL, ".dpr": PASCAL,
  ".vb": { linha: ["'", "REM "], bloco: [], aspaSimples: false },
  ".cbl": { linha: [], bloco: [], aspaSimples: false, cobol: true }, ".cob": { linha: [], bloco: [], aspaSimples: false, cobol: true }, ".cpy": { linha: [], bloco: [], aspaSimples: false, cobol: true },
};

function extensao(caminho: string): string {
  const b = caminho.slice(caminho.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i).toLowerCase();
}

/** Intervalos de comentário pela tabela da extensão. Extensão desconhecida: sem comentários. */
export function comentariosDeTexto(texto: string, caminho: string): Intervalo[] {
  const regra = COMENTARIOS_POR_EXTENSAO[extensao(caminho)];
  const saida: Intervalo[] = [];
  if (regra === undefined) return saida;
  if (regra.cobol === true) {
    let ini = 0;
    while (ini < texto.length) {
      let fim = texto.indexOf("\n", ini);
      if (fim === -1) fim = texto.length;
      if (texto[ini + 6] === "*" || texto[ini + 6] === "/") saida.push({ ini, fim });
      ini = fim + 1;
    }
    return saida;
  }
  const n = texto.length;
  let i = 0;
  let aspa: string | null = null;
  while (i < n) {
    const c = texto[i] as string;
    if (aspa !== null) {
      if (c === "\\" && aspa === '"') i += 2;
      else {
        if (c === aspa || c === "\n") aspa = null;
        i++;
      }
      continue;
    }
    // bloco primeiro (`--[[` antes de `--`)
    let tratado = false;
    for (const [a, f] of regra.bloco) {
      if (texto.startsWith(a, i)) {
        const k = texto.indexOf(f, i + a.length);
        const fim = k === -1 ? n : k + f.length;
        saida.push({ ini: i, fim });
        i = fim;
        tratado = true;
        break;
      }
    }
    if (tratado) continue;
    const pref = regra.linha.find((p) => texto.startsWith(p, i) && (p !== "REM " || i === 0 || texto[i - 1] === "\n"));
    if (pref !== undefined) {
      let k = texto.indexOf("\n", i);
      if (k === -1) k = n;
      saida.push({ ini: i, fim: k });
      i = k;
      continue;
    }
    if (c === '"' || (c === "'" && regra.aspaSimples)) aspa = c;
    i++;
  }
  return saida;
}

type ReImport = ReadonlyArray<RegExp>;
const KOTLIN_LIKE: ReImport = [/^\s*import\s+([\w.]+)/];
const IMPORTS_POR_EXTENSAO: Readonly<Record<string, ReImport>> = {
  ".kt": KOTLIN_LIKE, ".kts": KOTLIN_LIKE, ".scala": KOTLIN_LIKE, ".sc": KOTLIN_LIKE, ".groovy": KOTLIN_LIKE, ".gradle": KOTLIN_LIKE,
  ".swift": [/^\s*(?:@\w+\s+)?import\s+(?:(?:typealias|struct|class|enum|protocol|func|var|let)\s+)?([\w.]+)/],
  ".dart": [/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/],
  ".pl": [/^\s*(?:use|require)\s+([A-Za-z_][\w:]*)/], ".pm": [/^\s*(?:use|require)\s+([A-Za-z_][\w:]*)/],
  ".vb": [/^\s*Imports\s+(?:\w+\s*=\s*)?([\w.]+)/i],
  ".cbl": [/^.{6}\s+COPY\s+([\w-]+)/i, /^\s*COPY\s+([\w-]+)/i], ".cob": [/^\s*COPY\s+([\w-]+)/i], ".cpy": [/^\s*COPY\s+([\w-]+)/i],
  ".lua": [/\brequire\s*\(?\s*['"]([^'"]+)['"]/],
  ".ex": [/^\s*(?:import|alias|use|require)\s+([A-Z][\w.]*)/], ".exs": [/^\s*(?:import|alias|use|require)\s+([A-Z][\w.]*)/],
  ".erl": [/^-(?:include|include_lib)\(\s*"([^"]+)"/, /^-import\(\s*(\w+)/],
  ".hs": [/^import\s+(?:qualified\s+)?([\w.]+)/],
  ".sh": [/^\s*(?:source|\.)\s+['"]?([^\s'"]+)/], ".bash": [/^\s*(?:source|\.)\s+['"]?([^\s'"]+)/],
  ".ps1": [/^\s*\.\s+['"]?([^\s'"]+)/, /^\s*Import-Module\s+['"]?([^\s'"]+)/i],
  ".r": [/\b(?:library|require)\s*\(\s*['"]?([\w.]+)/],
  ".m": [/^\s*#(?:import|include)\s+["<]([^">]+)[">]/], ".mm": [/^\s*#(?:import|include)\s+["<]([^">]+)[">]/],
  ".fs": [/^\s*open\s+([\w.]+)/],
  ".vue": [/\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/], ".svelte": [/\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/],
};

function linhaDe(texto: string, indice: number): number {
  let n = 1;
  for (let i = 0; i < indice; i++) if (texto.charCodeAt(i) === 10) n++;
  return n;
}

function mascarar(texto: string, intervalos: readonly Intervalo[]): string {
  if (intervalos.length === 0) return texto;
  const partes: string[] = [];
  let cursor = 0;
  for (const { ini, fim } of [...intervalos].sort((a, b) => a.ini - b.ini)) {
    partes.push(texto.slice(cursor, ini), texto.slice(ini, fim).replace(/[^\n]/g, " "));
    cursor = fim;
  }
  partes.push(texto.slice(cursor));
  return partes.join("");
}

function importsDe(limpo: string, ext: string): ImportBruto[] {
  const out: ImportBruto[] = [];
  const visto = new Set<string>();
  const add = (spec: string, linha: number): void => {
    const k = `${spec}@${linha}`;
    if (spec === "" || visto.has(k)) return;
    visto.add(k);
    out.push({ especificador: spec, tipo: "estatico", linha, so_tipo: false, nomes: [] });
  };
  limpo.split("\n").forEach((l, i) => {
    for (const re of IMPORTS_POR_EXTENSAO[ext] ?? []) {
      const m = re.exec(l);
      if (m) add(m[1] as string, i + 1);
    }
  });
  if (ext === ".pas" || ext === ".dpr") {
    for (const m of limpo.matchAll(/\buses\s+([^;]+);/gi))
      for (const u of (m[1] as string).split(",")) add(u.trim().split(/\s+/)[0] ?? "", linhaDe(limpo, (m.index ?? 0) + 1));
  }
  return out;
}

function dadosSql(limpo: string): AcessoDadoBruto[] {
  const out: AcessoDadoBruto[] = [];
  let ini = 0;
  for (const parte of limpo.split(";")) {
    const lead = parte.length - parte.trimStart().length;
    const linha = linhaDe(limpo, ini + lead);
    const instrucao = parte.trim();
    ini += parte.length + 1;
    if (instrucao === "") continue;
    const ddl = /^(?:create|alter|drop)\b/i.test(instrucao);
    for (const t of extrairTabelasSql(instrucao))
      out.push({ tabela: t.tabela, operacao: t.operacao, de: null, linha, confianca: "heuristica", fonte: ddl ? "ddl" : "sql" });
  }
  return out;
}

/** Extração degradada de um arquivo (sem parser). */
export function extrairGenerico(texto: string, caminho: string): Extracao {
  const ext = extensao(caminho);
  const comentarios = comentariosDeTexto(texto, caminho);
  const limpo = mascarar(texto, comentarios);
  const loc = contarLinhas(texto, comentarios);
  return {
    versao_extrator: VERSAO_EXTRATOR,
    linguagem: "outra",
    hash: hashConteudo(Buffer.from(texto, "utf8")),
    loc: loc.loc,
    loc_codigo: loc.loc_codigo,
    loc_comentario: loc.loc_comentario,
    complexidade_total: 0,
    complexidade_max: 0,
    erros_parse: 0,
    e_teste: ehArquivoDeTeste(caminho, texto.slice(0, 600)),
    e_gerado: ehArquivoGerado(caminho, texto),
    truncado: false,
    simbolos: [],
    imports: importsDe(limpo, ext),
    chamadas: [],
    herancas: [],
    entradas: [],
    dados: ext === ".sql" ? dadosSql(limpo) : [],
    padroes: [],
    dinamicos: [],
  };
}

/**
 * Forma `Extrator` (sem parser): usa só `ctx.texto`/`ctx.caminho`. O registro hoje exige gramática para despachar;
 * enquanto `registro.ts` não chamar `extrairGenerico` direto para `linguagem === "outra"`, use `extrairGenerico`.
 */
export const extratorGenerico: Extrator = {
  extrair(ctx): ResultadoExtrator {
    const e = extrairGenerico(ctx.texto, ctx.caminho);
    return { ...resultadoVazio(), imports: e.imports, dados: e.dados };
  },
};
