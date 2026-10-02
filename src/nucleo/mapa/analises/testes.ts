import type { CoberturaCasada } from "../cobertura";
import type { Aresta, Confianca } from "../tipos";
import { idArquivo, pastaDe, type ArquivoMapa } from "./tipos";

// Testes por convenção, cobertura importada e "sem teste" (T-17.26). Tudo ESTIMADO por convenção e rotulado `estimada`;
// `medida` só quando há relatório de cobertura importado. O ADE não executa a suíte (D-162).

export type EstadoTeste = "existente" | "parcial" | "ausente" | "nao_aplicavel";

function partes(caminho: string): { nome: string; ext: string } {
  const arq = caminho.slice(caminho.lastIndexOf("/") + 1);
  const ponto = arq.lastIndexOf(".");
  return { nome: ponto < 0 ? arq : arq.slice(0, ponto), ext: ponto < 0 ? "" : arq.slice(ponto) };
}

/** Convenção de nome → nome-base do alvo (`foo.test.ts` → `foo`), por linguagem. `null` se o nome não parece teste. */
export function baseDoAlvoPorConvencao(caminho: string): { base: string; ext: string } | null {
  const { nome, ext } = partes(caminho);
  let m: RegExpExecArray | null;
  if ((m = /^(.+)\.(test|spec)$/.exec(nome))) return { base: m[1] as string, ext };
  if (ext === ".py" && (m = /^test_(.+)$/.exec(nome))) return { base: m[1] as string, ext };
  if ([".go", ".py", ".rb"].includes(ext) && (m = /^(.+)_test$/.exec(nome))) return { base: m[1] as string, ext };
  if (ext === ".rb" && (m = /^(.+)_spec$/.exec(nome))) return { base: m[1] as string, ext };
  if ([".java", ".cs", ".php", ".kt"].includes(ext) && (m = /^(.+)Tests?$/.exec(nome))) return { base: m[1] as string, ext };
  return null;
}

const PASTAS_DE_TESTE = /(^|\/)(__tests__|tests?|spec|specs|src\/test|testing)(\/|$)/;

export function ehCaminhoDeTeste(caminho: string): boolean {
  return PASTAS_DE_TESTE.test(caminho) || baseDoAlvoPorConvencao(caminho) !== null;
}

const RUNNERS: ReadonlyArray<[RegExp, string]> = [
  [/^vitest\b/, "vitest"],
  [/^(@jest\/|jest\b)/, "jest"],
  [/^mocha\b/, "mocha"],
  [/^node:test$/, "node:test"],
  [/^pytest\b/, "pytest"],
  [/^unittest\b/, "unittest"],
  [/^org\.junit/, "junit"],
  [/^[Xx]unit/, "xunit"],
  [/^NUnit/, "nunit"],
  [/^Microsoft\.VisualStudio\.TestTools/, "mstest"],
  [/^(rspec|minitest)/, "rspec/minitest"],
  [/^PHPUnit/i, "phpunit"],
  [/^testing$/, "go testing"],
];

function formaDeNome(caminho: string): string | null {
  const { nome } = partes(caminho);
  if (/\.test$/.test(nome)) return ".test.";
  if (/\.spec$/.test(nome)) return ".spec.";
  if (/^test_/.test(nome)) return "test_";
  if (/_test$/.test(nome)) return "_test";
  if (/_spec$/.test(nome)) return "_spec";
  if (/Tests$/.test(nome)) return "Tests";
  if (/Test$/.test(nome)) return "Test";
  return null;
}

export interface EstatisticaTestes {
  total_testes: number;
  /** Teste na mesma pasta do alvo (co-localizado) × em pasta própria de testes. */
  colocalizado: number;
  pasta_propria: number;
  /** Formas de nome: `.test.`, `.spec.`, `test_`, `_test`, `Test`, `Tests`, `_spec`. */
  formas_de_nome: Record<string, number>;
  /** Arquivos de teste por runner (inferido pelos imports). */
  runners: Record<string, number>;
}

export interface ArquivoTestado {
  caminho: string;
  estado: EstadoTeste;
  /** `estimada` (convenção) ou `medida` (relatório importado). */
  fonte: "estimada" | "medida";
  testes: string[];
  pct: number | null;
}

export interface ResultadoTestes {
  arestas: Aresta[];
  arquivos: ArquivoTestado[];
  estatisticas: EstatisticaTestes;
}

export interface ArestaImportaEntrada {
  de: string;
  para: string;
  confianca: Confianca;
  linha?: number | null;
}

export interface OpcoesTestes {
  /** Arestas `importa` entre arquivos, com ids `arq:`. */
  importa: readonly ArestaImportaEntrada[];
  cobertura?: readonly CoberturaCasada[];
}

const normPasta = (p: string): string =>
  p
    .replace(/(^|\/)(__tests__|tests?|spec|specs|src\/test|src\/main)(\/|$)/g, "$1")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");

/**
 * Liga testes a arquivos: import do teste = `exata`; convenção de nome (mesma pasta, pasta de testes espelhada) = `heuristica`.
 * Estado: `existente` = teste `exata` E referência a símbolo exportado do alvo; `parcial` = há teste sem essa prova;
 * `ausente` = nenhum; `nao_aplicavel` = arquivo sem função/classe (config, tipos). Com cobertura medida, ela decide.
 */
export function analisarTestes(arquivos: readonly ArquivoMapa[], opcoes: OpcoesTestes): ResultadoTestes {
  const porCaminho = new Map(arquivos.map((a) => [a.caminho, a]));
  const testes = arquivos.filter((a) => a.extracao.e_teste || ehCaminhoDeTeste(a.caminho));
  const ehTeste = new Set(testes.map((t) => t.caminho));
  const alvos = arquivos.filter((a) => !ehTeste.has(a.caminho));
  const porBase = new Map<string, ArquivoMapa[]>();
  for (const a of alvos) {
    const k = partes(a.caminho).nome.toLowerCase();
    let l = porBase.get(k);
    if (l === undefined) porBase.set(k, (l = []));
    l.push(a);
  }
  const ligacoes = new Map<string, Map<string, { confianca: Confianca; linha: number | null }>>(); // alvo → (teste → ligação)
  const ligar = (alvo: string, teste: string, confianca: Confianca, linha: number | null): void => {
    let m = ligacoes.get(alvo);
    if (m === undefined) ligacoes.set(alvo, (m = new Map()));
    const atual = m.get(teste);
    if (atual === undefined || (atual.confianca === "heuristica" && confianca === "exata")) m.set(teste, { confianca, linha });
  };
  for (const e of opcoes.importa) {
    if (!e.de.startsWith("arq:") || !e.para.startsWith("arq:")) continue;
    const de = e.de.slice(4);
    const para = e.para.slice(4);
    if (ehTeste.has(de) && !ehTeste.has(para) && porCaminho.has(para)) ligar(para, de, e.confianca, e.linha ?? null);
  }
  for (const t of testes) {
    const conv = baseDoAlvoPorConvencao(t.caminho);
    const base = (conv?.base ?? partes(t.caminho).nome).toLowerCase();
    const cands = porBase.get(base) ?? [];
    for (const a of cands) {
      const mesmaPasta = pastaDe(a.caminho) === pastaDe(t.caminho);
      const espelhada = normPasta(pastaDe(a.caminho)) === normPasta(pastaDe(t.caminho));
      if (conv !== null && (mesmaPasta || espelhada || cands.length === 1)) ligar(a.caminho, t.caminho, "heuristica", null);
      else if (conv === null && espelhada) ligar(a.caminho, t.caminho, "heuristica", null);
    }
  }
  const arestas: Aresta[] = [];
  for (const [alvo, m] of ligacoes) {
    for (const [teste, l] of m) {
      arestas.push({ tipo: "testa", de: idArquivo(teste), para: idArquivo(alvo), confianca: l.confianca, peso: 1, candidatos: null, fonte: "extracao", arquivo_id: null, linha: l.linha, evidencias: l.linha === null ? null : [`${teste}:${l.linha}`] });
    }
  }
  arestas.sort((a, b) => a.de.localeCompare(b.de) || a.para.localeCompare(b.para));

  const medida = new Map((opcoes.cobertura ?? []).map((c) => [c.arquivo, c]));
  const resultado: ArquivoTestado[] = alvos.map((a) => {
    const m = ligacoes.get(a.caminho);
    const med = medida.get(a.caminho);
    const temCodigo = a.extracao.simbolos.some((s) => s.tipo === "funcao" || s.tipo === "metodo" || s.tipo === "classe");
    const exportados = new Set(a.extracao.simbolos.filter((s) => s.exportado).map((s) => s.nome));
    let estado: EstadoTeste;
    if (!temCodigo && med === undefined) estado = "nao_aplicavel";
    else if (m === undefined) estado = "ausente";
    else {
      const prova = [...m].some(([teste, l]) => {
        if (l.confianca !== "exata") return false;
        const x = porCaminho.get(teste)?.extracao;
        if (x === undefined) return false;
        return x.chamadas.some((c) => exportados.has(c.alvo)) || x.imports.some((i) => i.nomes.some((n) => exportados.has(n.nome) || n.nome === "*" || n.nome === "default"));
      });
      estado = prova ? "existente" : "parcial";
    }
    if (med !== undefined) estado = med.pct === 0 ? "ausente" : med.pct >= 80 ? "existente" : "parcial";
    return { caminho: a.caminho, estado, fonte: med !== undefined ? "medida" : "estimada", testes: m === undefined ? [] : [...m.keys()].sort(), pct: med?.pct ?? null };
  });
  resultado.sort((a, b) => a.caminho.localeCompare(b.caminho));

  const formas: Record<string, number> = {};
  const runners: Record<string, number> = {};
  let colo = 0;
  let propria = 0;
  for (const t of testes) {
    const f = formaDeNome(t.caminho);
    if (f !== null) formas[f] = (formas[f] ?? 0) + 1;
    const vistos = new Set<string>();
    for (const i of t.extracao.imports) for (const [re, nome] of RUNNERS) if (re.test(i.especificador)) vistos.add(nome);
    for (const n of vistos) runners[n] = (runners[n] ?? 0) + 1;
    if (PASTAS_DE_TESTE.test(t.caminho)) propria++;
    else colo++;
  }
  return { arestas, arquivos: resultado, estatisticas: { total_testes: testes.length, colocalizado: colo, pasta_propria: propria, formas_de_nome: formas, runners } };
}

/** Contagem por estado (para a UI e o stackx). */
export function resumoPorEstado(arquivos: readonly ArquivoTestado[]): Record<EstadoTeste, number> {
  const r: Record<EstadoTeste, number> = { existente: 0, parcial: 0, ausente: 0, nao_aplicavel: 0 };
  for (const a of arquivos) r[a.estado]++;
  return r;
}
