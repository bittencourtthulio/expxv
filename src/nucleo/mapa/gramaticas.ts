import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Language, Parser, Query } from "web-tree-sitter";
import { arquivoWasm, GRAMATICA_DA_LINGUAGEM, GRAMATICAS_EMBARCADAS } from "./linguagens";
import type { Linguagem } from "./tipos";

// Carregador de gramáticas Tree-sitter em WASM (T-17.02, D-160).
// `web-tree-sitter` 0.27.0 + gramáticas de `@vscode/tree-sitter-wasm` 0.3.1: versões EXATAS e juntas (as
// gramáticas do pacote `tree-sitter-wasms` NÃO carregam neste runtime). Carga PREGUIÇOSA: nada é aberto até
// alguém pedir uma linguagem; cada gramática é carregada uma vez e fica em cache. Só roda dentro dos workers
// de extração e em testes; nunca no boot (P-248).

export const VERSAO_WEB_TREE_SITTER = "0.27.0";
export const VERSAO_GRAMATICAS_VSCODE = "0.3.1";

export interface OpcoesRuntime {
  /** Pasta com os `tree-sitter-*.wasm`. Padrão: `gramaticas/` ao lado deste módulo (pacote), senão `node_modules`. */
  pastaWasm?: string;
  /** Pasta com `web-tree-sitter.wasm`. Padrão: `node_modules/web-tree-sitter` mais próximo. */
  pastaRuntime?: string;
}

function subirAteAchar(inicio: string, relativo: string): string | null {
  let dir = resolve(inicio);
  for (;;) {
    const candidato = join(dir, relativo);
    if (existsSync(candidato)) return candidato;
    const pai = dirname(dir);
    if (pai === dir) return null;
    dir = pai;
  }
}

/** Pasta dos `.wasm` das gramáticas. Prioridade: opção explícita, cópia empacotada ao lado, `node_modules`. */
export function resolverPastaWasm(opcoes: OpcoesRuntime = {}): string {
  const candidatos: string[] = [];
  if (opcoes.pastaWasm !== undefined) candidatos.push(opcoes.pastaWasm);
  candidatos.push(join(__dirname, "gramaticas"));
  const nm = subirAteAchar(__dirname, join("node_modules", "@vscode", "tree-sitter-wasm", "wasm"));
  if (nm !== null) candidatos.push(nm);
  const achada = candidatos.find((c) => existsSync(join(c, arquivoWasm("typescript"))));
  if (achada === undefined) throw new Error("gramáticas do mapa não encontradas (pasta tree-sitter-wasm ausente)");
  return achada;
}

function resolverPastaRuntime(opcoes: OpcoesRuntime): string {
  if (opcoes.pastaRuntime !== undefined) return opcoes.pastaRuntime;
  const nm = subirAteAchar(__dirname, join("node_modules", "web-tree-sitter", "web-tree-sitter.wasm"));
  if (nm === null) throw new Error("runtime web-tree-sitter não encontrado");
  return dirname(nm);
}

let runtime: Promise<void> | undefined;
let pastaAtual: string | undefined;
const gramaticas = new Map<string, Promise<Language>>();
const parsers = new Map<string, Parser>();
const consultas = new Map<string, Query>();
const estat = { runtime_ms: 0, carregadas: new Map<string, number>() };

/** Inicia o runtime WASM (idempotente). Falha cacheada é descartada para permitir nova tentativa. */
export function iniciarRuntime(opcoes: OpcoesRuntime = {}): Promise<void> {
  if (runtime === undefined) {
    const pastaWasm = resolverPastaWasm(opcoes);
    const pastaRuntime = resolverPastaRuntime(opcoes);
    pastaAtual = pastaWasm;
    const t0 = performance.now();
    runtime = Parser.init({ locateFile: (nome: string) => join(pastaRuntime, nome) }).then(
      () => {
        estat.runtime_ms = performance.now() - t0;
      },
      (erro: unknown) => {
        runtime = undefined;
        throw erro;
      },
    );
  }
  return runtime;
}

/** Carrega (ou devolve do cache) a gramática pelo nome de arquivo (`typescript`, `c-sharp`…). */
export async function carregarGramaticaPorNome(gramatica: string, opcoes: OpcoesRuntime = {}): Promise<Language> {
  await iniciarRuntime(opcoes);
  let p = gramaticas.get(gramatica);
  if (p === undefined) {
    const t0 = performance.now();
    p = Language.load(join(pastaAtual as string, arquivoWasm(gramatica))).then((l) => {
      estat.carregadas.set(gramatica, performance.now() - t0);
      return l;
    });
    gramaticas.set(gramatica, p);
    p.catch(() => gramaticas.delete(gramatica));
  }
  return p;
}

/** Gramática de uma linguagem; `null` para linguagem sem gramática embarcada (modo degradado). */
export async function carregarGramatica(linguagem: Linguagem, opcoes: OpcoesRuntime = {}): Promise<Language | null> {
  const nome = GRAMATICA_DA_LINGUAGEM[linguagem];
  if (nome === undefined) return null;
  return carregarGramaticaPorNome(nome, opcoes);
}

/** Parser reutilizável (um por gramática). O chamador NÃO deve chamar `delete()` no parser. */
export async function obterParser(linguagem: Linguagem, opcoes: OpcoesRuntime = {}): Promise<Parser | null> {
  const nome = GRAMATICA_DA_LINGUAGEM[linguagem];
  if (nome === undefined) return null;
  let parser = parsers.get(nome);
  if (parser === undefined) {
    const lang = await carregarGramaticaPorNome(nome, opcoes);
    parser = parsers.get(nome);
    if (parser === undefined) {
      parser = new Parser();
      parser.setLanguage(lang);
      parsers.set(nome, parser);
    }
  }
  return parser;
}

/** Compila uma consulta S-expression com cache por (gramática, fonte). Compilar custa ~20 ms: faça uma vez. */
export async function compilarConsulta(linguagem: Linguagem, fonte: string, opcoes: OpcoesRuntime = {}): Promise<Query | null> {
  const nome = GRAMATICA_DA_LINGUAGEM[linguagem];
  if (nome === undefined) return null;
  const chave = `${nome}\u0000${fonte}`;
  let q = consultas.get(chave);
  if (q === undefined) {
    const lang = await carregarGramaticaPorNome(nome, opcoes);
    q = consultas.get(chave);
    if (q === undefined) {
      q = new Query(lang, fonte);
      consultas.set(chave, q);
    }
  }
  return q;
}

export function estatisticasGramaticas(): { runtime_ms: number; carregadas: Record<string, number> } {
  return { runtime_ms: estat.runtime_ms, carregadas: Object.fromEntries(estat.carregadas) };
}

export function gramaticasCarregadas(): string[] {
  return [...estat.carregadas.keys()].sort();
}

/** Libera parsers, consultas e gramáticas (memória WASM). Idempotente; o runtime continua iniciado. */
export function liberarGramaticas(): void {
  for (const q of consultas.values()) q.delete();
  consultas.clear();
  for (const p of parsers.values()) p.delete();
  parsers.clear();
  gramaticas.clear();
  estat.carregadas.clear();
}

export { GRAMATICAS_EMBARCADAS };
