import type { Manifesto } from "../manifestos";
import type { Confianca, Extracao, ImportBruto, Linguagem, SubtipoExterno } from "../tipos";

// Núcleo dos resolvedores de import (T-17.16..18). PURO: recebe um índice de arquivos em memória (já extraídos);
// só lê arquivos auxiliares (tsconfig etc.) por função INJETADA (`lerTexto`), nunca executa nada do projeto e
// nunca abre arquivos de ambiente nem chaves. Caminhos são relativos à raiz do workspace, com `/`; `..` que
// escapa da raiz é recusado.

/** O que um resolvedor precisa saber de um arquivo já extraído. */
export interface ArquivoParaResolver {
  caminho: string;
  linguagem: Linguagem;
  extracao: Pick<Extracao, "imports" | "simbolos"> & Partial<Extracao>;
}

export interface ContextoResolucao {
  /** Todos os arquivos analisados, por caminho relativo. */
  arquivos: ReadonlyMap<string, ArquivoParaResolver>;
  manifestos: readonly Manifesto[];
  /** Raiz ABSOLUTA do workspace (só para tirar o prefixo de caminhos absolutos, como em `compile_commands.json`). */
  raiz?: string;
  /** Leitura somente-texto de arquivo auxiliar (tsconfig, compile_commands.json…); `null` se não existir/recusado. */
  lerTexto?: (caminho: string) => string | null;
  /** Existência de arquivo NÃO indexado (ativos, `.d.ts`…). */
  existe?: (caminho: string) => boolean;
}

export type TipoArestaImport = "importa" | "reexporta";

export interface ArestaBruta {
  /** `arq:<caminho>` */
  de: string;
  /** `arq:<caminho>` ou `ext:<eco>:<nome>`. */
  para: string;
  tipo: TipoArestaImport;
  confianca: Confianca;
  /** Linha da primeira ocorrência. */
  linha: number;
  /** Ocorrências agregadas. */
  peso: number;
}

/** Uma ligação por import (alimenta `chamadas.ts`: binding de import -> arquivo-alvo). */
export interface LigacaoImport {
  /** Caminho do arquivo que importa. */
  arquivo: string;
  especificador: string;
  linha: number;
  /** `arq:<caminho>`, `ext:<eco>:<nome>` ou `null` (não resolvido). */
  para: string | null;
  confianca: Confianca;
  nomes: ImportBruto["nomes"];
  /** Import de pacote/namespace/módulo com VÁRIOS arquivos (Go, Java curinga, C# `using`): todos os `arq:` alcançáveis. */
  alvos?: string[];
}

export interface NaoResolvido {
  arquivo: string;
  especificador: string;
  linha: number;
  motivo: "nao_encontrado" | "fora_da_raiz" | "ambiguo" | "dinamico";
}

export interface ResultadoResolucao {
  arestas: ArestaBruta[];
  ligacoes: LigacaoImport[];
  /** Listados, nunca omitidos. */
  nao_resolvidos: NaoResolvido[];
  /** Imports de ativos (css, json, imagens…) que não entram no grafo. */
  ignorados: number;
}

export interface Resolvedor {
  readonly linguagens: readonly Linguagem[];
  resolver(ctx: ContextoResolucao): ResultadoResolucao;
}

export const idArquivo = (caminho: string): string => `arq:${caminho}`;
export const idExterno = (eco: SubtipoExterno, nome: string): string => `ext:${eco}:${nome}`;

// ---------------------------------------------------------------- caminhos

export function dirnameRel(caminho: string): string {
  const i = caminho.lastIndexOf("/");
  return i < 0 ? "" : caminho.slice(0, i);
}

/** Junta e normaliza (`.`, `..`, `//`); `null` se escapar da raiz. Aceita `\` como separador. */
export function normalizarRel(...partes: string[]): string | null {
  const saida: string[] = [];
  for (const parte of partes) {
    for (const p of parte.replace(/\\/g, "/").split("/")) {
      if (p === "" || p === ".") continue;
      if (p === "..") {
        if (saida.length === 0) return null;
        saida.pop();
      } else saida.push(p);
    }
  }
  return saida.join("/");
}

/** Pasta + relativo, normalizado; caminho absoluto (`/x`, `C:\x`) ou escape da raiz vira `null`. */
export function relativoA(pasta: string, rel: string): string | null {
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel)) return null;
  return normalizarRel(pasta, rel);
}

export function extensaoDe(caminho: string): string {
  const b = caminho.slice(caminho.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}

export function semExtensao(caminho: string): string {
  const e = extensaoDe(caminho);
  return e === "" ? caminho : caminho.slice(0, -e.length);
}

/** JSON com comentários e vírgula sobrando (tsconfig). Respeita strings. `null` se ainda assim inválido. */
export function lerJsonc(texto: string): unknown {
  let saida = "";
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < n && texto[j] !== '"') j += texto[j] === "\\" ? 2 : 1;
      saida += texto.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && texto[i + 1] === "/") {
      while (i < n && texto[i] !== "\n") i++;
    } else if (c === "/" && texto[i + 1] === "*") {
      const k = texto.indexOf("*/", i + 2);
      i = k === -1 ? n : k + 2;
    } else {
      saida += c;
      i++;
    }
  }
  saida = saida.replace(/^\uFEFF/, "").replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(saida);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- acumulador

/** Acumula ligações, deduplica arestas (mesmo de/para/tipo soma `peso`; confiança `exata` prevalece). */
export class Acumulador {
  private readonly arestas = new Map<string, ArestaBruta>();
  readonly ligacoes: LigacaoImport[] = [];
  readonly nao_resolvidos: NaoResolvido[] = [];
  ignorados = 0;

  ligar(arquivo: string, imp: ImportBruto, para: string | null, confianca: Confianca, tipo: TipoArestaImport = "importa"): void {
    this.ligacoes.push({ arquivo, especificador: imp.especificador, linha: imp.linha, para, confianca, nomes: imp.nomes });
    if (para === null) return;
    const de = idArquivo(arquivo);
    if (para === de) return;
    const chave = `${tipo}|${de}|${para}`;
    const atual = this.arestas.get(chave);
    if (atual === undefined) this.arestas.set(chave, { de, para, tipo, confianca, linha: imp.linha, peso: 1 });
    else {
      atual.peso++;
      if (confianca === "exata") atual.confianca = "exata";
      atual.linha = Math.min(atual.linha, imp.linha);
    }
  }

  /** Import que alcança vários arquivos (pacote Go, `using` C#, curinga Java): uma aresta por arquivo. */
  ligarMuitos(arquivo: string, imp: ImportBruto, alvos: readonly string[], confianca: Confianca, tipo: TipoArestaImport = "importa"): void {
    const unicos = [...new Set(alvos)];
    this.ligacoes.push({ arquivo, especificador: imp.especificador, linha: imp.linha, para: unicos[0] ?? null, confianca, nomes: imp.nomes, alvos: unicos });
    for (const para of unicos) this.aresta(arquivo, imp.linha, para, confianca, tipo);
  }

  /** Aresta extra (mesmo import, outro alvo — ex.: `from pkg import submodulo`). Não cria nova ligação. */
  aresta(arquivo: string, linha: number, para: string, confianca: Confianca, tipo: TipoArestaImport = "importa"): void {
    const de = idArquivo(arquivo);
    if (para === de) return;
    const chave = `${tipo}|${de}|${para}`;
    const atual = this.arestas.get(chave);
    if (atual === undefined) this.arestas.set(chave, { de, para, tipo, confianca, linha, peso: 1 });
    else {
      atual.peso++;
      if (confianca === "exata") atual.confianca = "exata";
    }
  }

  perdido(arquivo: string, imp: ImportBruto, motivo: NaoResolvido["motivo"]): void {
    this.ligacoes.push({ arquivo, especificador: imp.especificador, linha: imp.linha, para: null, confianca: "heuristica", nomes: imp.nomes });
    this.nao_resolvidos.push({ arquivo, especificador: imp.especificador, linha: imp.linha, motivo });
  }

  resultado(): ResultadoResolucao {
    return { arestas: [...this.arestas.values()], ligacoes: this.ligacoes, nao_resolvidos: this.nao_resolvidos, ignorados: this.ignorados };
  }
}

/** Arquivos (ordenados) de um conjunto de linguagens. */
export function arquivosDe(ctx: ContextoResolucao, linguagens: readonly Linguagem[]): ArquivoParaResolver[] {
  return [...ctx.arquivos.values()].filter((a) => linguagens.includes(a.linguagem)).sort((a, b) => (a.caminho < b.caminho ? -1 : 1));
}

/** Junta resultados de vários resolvedores. */
export function resolverTodos(resolvedores: readonly Resolvedor[], ctx: ContextoResolucao): ResultadoResolucao {
  const rs = resolvedores.map((r) => r.resolver(ctx));
  const chaves = new Map<string, ArestaBruta>();
  for (const r of rs)
    for (const a of r.arestas) {
      const k = `${a.tipo}|${a.de}|${a.para}`;
      const x = chaves.get(k);
      if (x === undefined) chaves.set(k, { ...a });
      else {
        x.peso += a.peso;
        if (a.confianca === "exata") x.confianca = "exata";
      }
    }
  return {
    arestas: [...chaves.values()],
    ligacoes: rs.flatMap((r) => r.ligacoes),
    nao_resolvidos: rs.flatMap((r) => r.nao_resolvidos),
    ignorados: rs.reduce((a, r) => a + r.ignorados, 0),
  };
}

/** Manifesto do tipo pedido mais próximo acima do arquivo. */
export function manifestoMaisProximo(manifestos: readonly Manifesto[], tipo: string, caminho: string): Manifesto | null {
  let melhor: Manifesto | null = null;
  for (const m of manifestos) {
    if (m.tipo !== tipo) continue;
    if (m.pasta !== "" && !caminho.startsWith(`${m.pasta}/`)) continue;
    if (melhor === null || m.pasta.length > melhor.pasta.length) melhor = m;
  }
  return melhor;
}
