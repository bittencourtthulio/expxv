import * as fsp from "node:fs/promises";
import { join, sep } from "node:path";
import { PRODUTO } from "../produto";
import { executorPadrao, type ExecutorVcs } from "../vcs/executor";
import { AvaliadorGitignore, parseGitignore } from "./gitignore";
import { hashConteudo } from "./hash";
import { detectarLinguagem, linguagemPorExtensao } from "./linguagens";
import { ehArquivoSensivel } from "./sensiveis";
import type { Linguagem } from "./tipos";

// Varredura de arquivos do projeto analisado (T-17.03). Só LÊ: nunca executa nada do projeto. Respeita o
// `.gitignore` (via `git ls-files -co --exclude-standard` quando há git; analisador próprio caso contrário),
// ignora dependências/saídas de build/binários/minificados, nunca abre arquivo de ambiente nem chave, não segue
// symlink para fora da raiz e calcula o hash de conteúdo (cache por mtime+tamanho) usado pelo incremental.

export const TAMANHO_MAX_PADRAO = 1_000_000;
export const TAMANHO_MAX_LIMITE = 5_000_000;
export const TOTAL_MAX_PADRAO = 150_000;
export const AVISO_TOTAL = 20_000;
export const TAMANHO_LOTE = 500;
const BYTES_BINARIO = 8192;
const SHEBANG_TAMANHO_MAX = 256 * 1024;

export type MotivoIgnorado =
  | "gitignore"
  | "padrao"
  | "sensivel"
  | "grande"
  | "binario"
  | "minificado"
  | "symlink_fora"
  | "symlink_dir"
  | "submodulo"
  | "linguagem_desconhecida"
  | "ilegivel"
  | "fora_do_limite";

export type CategoriaArquivo = "codigo" | "manifesto" | "lock";

export interface ArquivoVarrido {
  /** Relativo à raiz, com `/`. */
  caminho: string;
  linguagem: Linguagem;
  tamanho: number;
  mtime_ms: number;
  /** SHA-1 do conteúdo normalizado (BOM/CRLF não alteram). Para `lock`: `stat:<mtime>:<tamanho>`. */
  hash: string;
  categoria: CategoriaArquivo;
}

export interface Ignorado {
  caminho: string;
  motivo: MotivoIgnorado;
}

export interface LoteArquivos {
  arquivos: ArquivoVarrido[];
  ignorados: Ignorado[];
}

export interface EntradaCacheVarredura {
  mtime_ms: number;
  tamanho: number;
  hash: string;
  linguagem: Linguagem;
  categoria: CategoriaArquivo;
  /** Arquivo já classificado como ignorado (binário/minificado) com este mtime+tamanho. */
  ignorado?: MotivoIgnorado;
}

export interface ResumoVarredura {
  total: number;
  truncado: boolean;
  avisos: string[];
  ignorados_por_motivo: Partial<Record<MotivoIgnorado, number>>;
  origem: "git" | "caminhada";
  cache: { acertos: number; falhas: number };
}

interface InfoStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mtimeMs: number;
}
interface EntradaDir {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** Operações de sistema de arquivos injetáveis (testes espiam `readFile`). */
export interface FsVarredura {
  lstat(p: string): Promise<InfoStat>;
  stat(p: string): Promise<InfoStat>;
  realpath(p: string): Promise<string>;
  readdir(p: string): Promise<EntradaDir[]>;
  readFile(p: string): Promise<Buffer>;
}

export const fsReal: FsVarredura = {
  lstat: (p) => fsp.lstat(p),
  stat: (p) => fsp.stat(p),
  realpath: (p) => fsp.realpath(p),
  readdir: (p) => fsp.readdir(p, { withFileTypes: true }),
  readFile: (p) => fsp.readFile(p),
};

export interface OpcoesVarredura {
  /** Padrão 1 000 000; no máximo 5 000 000. */
  tamanhoMaxBytes?: number;
  /** Padrão 150 000. `null`/`Infinity` = sem teto (P-274). */
  totalMax?: number | null;
  /** Padrão 20 000: acima disto emite aviso. */
  avisoEm?: number;
  /** Globs extras no formato do `.gitignore` (`mapa.ignorar`). */
  ignorar?: readonly string[];
  /** Cache por mtime+tamanho; é ATUALIZADO no lugar. */
  cache?: Map<string, EntradaCacheVarredura>;
  tamanhoLote?: number;
  sinal?: AbortSignal;
  fs?: FsVarredura;
  executor?: ExecutorVcs;
  /** `false` força a caminhada própria. */
  usarGit?: boolean;
  concorrencia?: number;
  /** Média de caracteres por linha acima da qual o arquivo é "minificado". Padrão 500. */
  minificadoMediaLinha?: number;
}

const PASTAS_PADRAO = new Set(["node_modules", "vendor", ".git", "dist", "build", "target", "__pycache__", ".venv", "venv", PRODUTO.pastaNoProjeto]);
const NOMES_LOCK = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "composer.lock", "Cargo.lock", "go.sum", "Gemfile.lock", "poetry.lock", "Pipfile.lock"]);
const NOMES_MANIFESTO = new Set([
  "package.json", "tsconfig.json", "jsconfig.json", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
  "go.mod", "Cargo.toml", "pyproject.toml", "setup.cfg", "Gemfile", "Makefile", "compile_commands.json", ".importlinter", "deptrac.yaml", "deptrac.yml",
  ".dependency-cruiser.json", "packwerk.yml", "pnpm-workspace.yaml", "lerna.json", "nx.json",
]);

const nomeBase = (c: string): string => c.slice(c.lastIndexOf("/") + 1);

export function categoriaPorNome(caminho: string): CategoriaArquivo | null {
  const nome = nomeBase(caminho);
  if (NOMES_LOCK.has(nome)) return "lock";
  if (NOMES_MANIFESTO.has(nome) || /^tsconfig\..+\.json$/.test(nome) || /^requirements.*\.txt$/.test(nome) || /\.(csproj|fsproj|vbproj|sln)$/i.test(nome)) return "manifesto";
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(caminho)) return "manifesto";
  return null;
}

const espera = (): Promise<void> => new Promise((r) => setImmediate(r));

async function mapearConcorrente<I, R>(itens: readonly I[], limite: number, fn: (i: I) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    for (;;) {
      const i = proximo++;
      if (i >= itens.length) return;
      saida[i] = await fn(itens[i] as I);
    }
  });
  await Promise.all(trabalhadores);
  return saida;
}

type Resultado = { ok: ArquivoVarrido } | { ignorado: MotivoIgnorado } | { omitir: true };

/** Varre `raiz` em lotes. O valor de retorno do gerador é o resumo (use `varrerTudo` para só coletar). */
export async function* varrer(raiz: string, op: OpcoesVarredura = {}): AsyncGenerator<LoteArquivos, ResumoVarredura> {
  const fs = op.fs ?? fsReal;
  const tamanhoMax = Math.min(Math.max(1, op.tamanhoMaxBytes ?? TAMANHO_MAX_PADRAO), TAMANHO_MAX_LIMITE);
  const totalMax = op.totalMax === null ? Infinity : (op.totalMax ?? TOTAL_MAX_PADRAO);
  const avisoEm = op.avisoEm ?? AVISO_TOTAL;
  const tamanhoLote = Math.max(1, op.tamanhoLote ?? TAMANHO_LOTE);
  const mediaMinificado = op.minificadoMediaLinha ?? 500;
  const concorrencia = Math.max(1, op.concorrencia ?? 32);
  const cache = op.cache;
  const resumo: ResumoVarredura = { total: 0, truncado: false, avisos: [], ignorados_por_motivo: {}, origem: "caminhada", cache: { acertos: 0, falhas: 0 } };
  const raizReal = await fs.realpath(raiz);
  const extras = new AvaliadorGitignore(parseGitignore((op.ignorar ?? []).join("\n"), ""));
  const temExtras = (op.ignorar ?? []).length > 0;
  const cacheBinObj = new Map<string, boolean>();

  const contar = (motivo: MotivoIgnorado): void => {
    resumo.ignorados_por_motivo[motivo] = (resumo.ignorados_por_motivo[motivo] ?? 0) + 1;
  };

  // --- candidatos
  let candidatos: string[] | null = null;
  if (op.usarGit !== false) {
    candidatos = await listarComGit(raiz, op, resumo);
  }
  let walker: AsyncGenerator<{ caminho: string; ignorado?: MotivoIgnorado }> | null = null;
  if (candidatos === null) {
    walker = caminhar(raiz, fs, extras, temExtras, op.sinal);
  }

  const temBinObj = async (pastaRel: string): Promise<boolean> => {
    const c = cacheBinObj.get(pastaRel);
    if (c !== undefined) return c;
    let tem = false;
    try {
      const itens = await fs.readdir(pastaRel === "" ? raiz : join(raiz, pastaRel));
      tem = itens.some((i) => /\.(csproj|fsproj|vbproj)$/i.test(i.name));
    } catch {
      tem = false;
    }
    cacheBinObj.set(pastaRel, tem);
    return tem;
  };

  const classificarPorCaminho = async (caminho: string): Promise<MotivoIgnorado | null> => {
    const partes = caminho.split("/");
    for (let i = 0; i < partes.length - 1; i++) {
      const p = partes[i] as string;
      if (PASTAS_PADRAO.has(p)) return "padrao";
      if (p === "bin" || p === "obj") {
        if (await temBinObj(partes.slice(0, i).join("/"))) return "padrao";
      }
    }
    if (ehArquivoSensivel(caminho)) return "sensivel";
    if (temExtras && extras.ignorado(caminho, false)) return "gitignore";
    return null;
  };

  const processar = async (caminho: string): Promise<Resultado> => {
    const motivoCaminho = await classificarPorCaminho(caminho);
    if (motivoCaminho !== null) return { ignorado: motivoCaminho };
    const categoriaNome = categoriaPorNome(caminho);
    let ling: Linguagem | null = linguagemPorExtensao(caminho);
    const abs = join(raiz, caminho);
    let st: InfoStat;
    try {
      st = await fs.lstat(abs);
    } catch {
      return { omitir: true }; // listado pelo git mas removido do disco
    }
    let tamanho = st.size;
    let mtime = st.mtimeMs;
    if (st.isSymbolicLink()) {
      try {
        const real = await fs.realpath(abs);
        if (real !== raizReal && !real.startsWith(raizReal + sep)) return { ignorado: "symlink_fora" };
        const alvo = await fs.stat(abs);
        if (alvo.isDirectory()) return { ignorado: "symlink_dir" };
        if (!alvo.isFile()) return { omitir: true };
        tamanho = alvo.size;
        mtime = alvo.mtimeMs;
      } catch {
        return { ignorado: "ilegivel" };
      }
    } else if (st.isDirectory()) {
      return { ignorado: "submodulo" };
    } else if (!st.isFile()) {
      return { omitir: true };
    }
    const categoria: CategoriaArquivo = categoriaNome ?? "codigo";
    if (categoria === "lock") {
      return { ok: { caminho, linguagem: "outra", tamanho, mtime_ms: mtime, hash: `stat:${Math.trunc(mtime)}:${tamanho}`, categoria } };
    }
    if (ling === null && categoria === "codigo") {
      // sem extensão conhecida: shebang só para arquivo pequeno e sem extensão; extensões degradadas viram `outra`
      const base = nomeBase(caminho);
      if (!base.includes(".") && tamanho <= SHEBANG_TAMANHO_MAX && tamanho > 2) {
        try {
          const buf = await fs.readFile(abs);
          const primeira = buf.toString("utf8", 0, Math.min(buf.length, 200)).split("\n")[0] as string;
          ling = detectarLinguagem(caminho, primeira);
        } catch {
          return { ignorado: "ilegivel" };
        }
      } else {
        ling = detectarLinguagem(caminho);
      }
      if (ling === null) return { ignorado: "linguagem_desconhecida" };
    }
    if (tamanho > tamanhoMax) return { ignorado: "grande" };
    const linguagem: Linguagem = ling ?? "outra";
    const emCache = cache?.get(caminho);
    if (emCache !== undefined && emCache.mtime_ms === mtime && emCache.tamanho === tamanho) {
      resumo.cache.acertos++;
      if (emCache.ignorado !== undefined) return { ignorado: emCache.ignorado };
      return { ok: { caminho, linguagem: emCache.linguagem, tamanho, mtime_ms: mtime, hash: emCache.hash, categoria: emCache.categoria } };
    }
    resumo.cache.falhas++;
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch {
      return { ignorado: "ilegivel" };
    }
    const cabeca = buf.subarray(0, Math.min(buf.length, BYTES_BINARIO));
    if (cabeca.includes(0)) {
      cache?.set(caminho, { mtime_ms: mtime, tamanho, hash: "", linguagem, categoria, ignorado: "binario" });
      return { ignorado: "binario" };
    }
    if (categoria === "codigo" && buf.length >= 2048) {
      let linhas = 1;
      let i = -1;
      while ((i = buf.indexOf(10, i + 1)) !== -1) linhas++;
      if (buf.length / linhas > mediaMinificado) {
        cache?.set(caminho, { mtime_ms: mtime, tamanho, hash: "", linguagem, categoria, ignorado: "minificado" });
        return { ignorado: "minificado" };
      }
    }
    const hash = hashConteudo(buf);
    cache?.set(caminho, { mtime_ms: mtime, tamanho, hash, linguagem, categoria });
    return { ok: { caminho, linguagem, tamanho, mtime_ms: mtime, hash, categoria } };
  };

  let loteArquivos: ArquivoVarrido[] = [];
  let loteIgnorados: Ignorado[] = [];
  const vistos = new Set<string>();

  const proximosCandidatos = async function* (): AsyncGenerator<string[]> {
    if (candidatos !== null) {
      for (let i = 0; i < candidatos.length; i += 200) yield candidatos.slice(i, i + 200);
      return;
    }
    let bloco: string[] = [];
    for await (const item of walker as AsyncGenerator<{ caminho: string; ignorado?: MotivoIgnorado }>) {
      if (item.ignorado !== undefined) {
        loteIgnorados.push({ caminho: item.caminho, motivo: item.ignorado });
        contar(item.ignorado);
        continue;
      }
      bloco.push(item.caminho);
      if (bloco.length >= 200) {
        yield bloco;
        bloco = [];
      }
    }
    if (bloco.length > 0) yield bloco;
  };

  for await (const bloco of proximosCandidatos()) {
    if (op.sinal?.aborted === true) break;
    const unicos = bloco.filter((c) => (vistos.has(c) ? false : (vistos.add(c), true)));
    const resultados = await mapearConcorrente(unicos, concorrencia, processar);
    for (let i = 0; i < unicos.length; i++) {
      const r = resultados[i] as Resultado;
      const caminho = unicos[i] as string;
      if ("ok" in r) {
        if (resumo.total >= totalMax) {
          if (!resumo.truncado) {
            resumo.truncado = true;
            resumo.avisos.push(`Teto de ${totalMax} arquivos atingido: o restante não entra no mapa. Aumente \`mapa.total_max\` ou analise por subpasta.`);
          }
          loteIgnorados.push({ caminho, motivo: "fora_do_limite" });
          contar("fora_do_limite");
          continue;
        }
        resumo.total++;
        if (resumo.total === avisoEm + 1) resumo.avisos.push(`Mais de ${avisoEm} arquivos: a análise pode demorar. Considere analisar por subpasta ou por pacote.`);
        loteArquivos.push(r.ok);
        if (loteArquivos.length >= tamanhoLote) {
          yield { arquivos: loteArquivos, ignorados: loteIgnorados };
          loteArquivos = [];
          loteIgnorados = [];
        }
      } else if ("ignorado" in r) {
        loteIgnorados.push({ caminho, motivo: r.ignorado });
        contar(r.ignorado);
      }
    }
    await espera();
  }
  if (loteArquivos.length > 0 || loteIgnorados.length > 0) yield { arquivos: loteArquivos, ignorados: loteIgnorados };
  return resumo;
}

/** Coleta tudo (para testes e análises pequenas). */
export async function varrerTudo(raiz: string, op: OpcoesVarredura = {}): Promise<{ arquivos: ArquivoVarrido[]; ignorados: Ignorado[]; resumo: ResumoVarredura }> {
  const arquivos: ArquivoVarrido[] = [];
  const ignorados: Ignorado[] = [];
  const gen = varrer(raiz, op);
  for (;;) {
    const r = await gen.next();
    if (r.done === true) return { arquivos, ignorados, resumo: r.value };
    arquivos.push(...r.value.arquivos);
    ignorados.push(...r.value.ignorados);
  }
}

async function listarComGit(raiz: string, op: OpcoesVarredura, resumo: ResumoVarredura): Promise<string[] | null> {
  const executor = op.executor ?? executorPadrao;
  try {
    const r = await executor.executar(["ls-files", "-z", "-co", "--exclude-standard"], {
      cwd: raiz,
      tipo: "leitura",
      confianca: "nao_confiavel",
      maxBytes: 512 * 1024 * 1024,
      timeoutMs: 120_000,
      ...(op.sinal !== undefined ? { signal: op.sinal } : {}),
    });
    if (r.truncado) return null;
    resumo.origem = "git";
    return r.stdout.split("\0").filter((c) => c !== "");
  } catch {
    return null; // sem git, não é repositório ou git indisponível: caminhada própria
  }
}

async function* caminhar(raiz: string, fs: FsVarredura, extras: AvaliadorGitignore, temExtras: boolean, sinal?: AbortSignal): AsyncGenerator<{ caminho: string; ignorado?: MotivoIgnorado }> {
  const avaliador = new AvaliadorGitignore();
  const pilha: Array<{ rel: string; profundidade: number }> = [{ rel: "", profundidade: 0 }];
  while (pilha.length > 0) {
    if (sinal?.aborted === true) return;
    const { rel, profundidade } = pilha.pop() as { rel: string; profundidade: number };
    let itens: EntradaDir[];
    try {
      itens = await fs.readdir(rel === "" ? raiz : join(raiz, rel));
    } catch {
      continue;
    }
    itens.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (itens.some((i) => i.name === ".gitignore" && !i.isDirectory())) {
      try {
        avaliador.adicionar(parseGitignore((await fs.readFile(join(raiz, rel, ".gitignore"))).toString("utf8"), rel));
      } catch {
        /* .gitignore ilegível: segue sem ele */
      }
    }
    // pasta com `.git` (arquivo ou diretório) que não é a raiz = submódulo ou repositório aninhado
    if (rel !== "" && itens.some((i) => i.name === ".git")) {
      yield { caminho: rel, ignorado: "submodulo" };
      continue;
    }
    const subpastas: string[] = [];
    for (const item of itens) {
      const caminho = rel === "" ? item.name : `${rel}/${item.name}`;
      if (item.isDirectory()) {
        if (PASTAS_PADRAO.has(item.name)) continue;
        if (profundidade >= 64) continue;
        if (avaliador.ignorado(caminho, true) || (temExtras && extras.ignorado(caminho, true))) continue;
        subpastas.push(caminho);
        continue;
      }
      if (item.isSymbolicLink()) {
        // alvo (arquivo ou pasta) é decidido na etapa de processamento; pasta-symlink nunca é seguida
        if (avaliador.ignorado(caminho, false)) continue;
        yield { caminho };
        continue;
      }
      if (!item.isFile()) continue;
      if (item.name === ".gitignore" || avaliador.ignorado(caminho, false)) {
        if (item.name !== ".gitignore") yield { caminho, ignorado: "gitignore" };
        continue;
      }
      yield { caminho };
    }
    for (let i = subpastas.length - 1; i >= 0; i--) pilha.push({ rel: subpastas[i] as string, profundidade: profundidade + 1 });
  }
}
