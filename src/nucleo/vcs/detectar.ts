import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { executorPadrao } from "./executor";
import { capabilitiesDe, type Capabilities, type TipoVcs } from "./vcs";

// Detecção (T-06.01): git | svn | git-svn | nenhum. Tudo por leitura de arquivos (`stat`/`readFile`) —
// NENHUM processo é executado para detectar git, e o `svn info --xml` só roda se o binário existir e
// sempre com cwd dentro da própria cópia de trabalho. Nada fora do workspace é escrito ou executado.

export interface Deteccao {
  tipo: TipoVcs;
  /** Raiz da árvore de trabalho (caminho real); null em `nenhum`. */
  raiz: string | null;
  capabilities: Capabilities;
  /** Diretório de metadados desta árvore (`.git`, ou `<comum>/worktrees/<n>` em worktree vinculado). */
  gitDir: string | null;
  /** Diretório comum (refs, objects): igual a gitDir fora de worktree vinculado. */
  commonDir: string | null;
  /** A árvore é um worktree vinculado (criado por `git worktree add`). */
  worktreeVinculado: boolean;
  /** A árvore é um submódulo de outro repositório. */
  submodulo: boolean;
  /** Raiz de um repositório PAI que contém este (dentro do `limite`), se houver. */
  aninhadoEm: string | null;
  /** Caminhos de todas as árvores de trabalho do repositório (inclui esta). */
  worktrees: string[];
  /** Caminhos (relativos) declarados em `.gitmodules`. */
  submodulos: string[];
  svn: { binario: boolean; indisponivel: boolean; url: string | null; revisao: number | null; raizRepositorio: string | null } | null;
  avisos: string[];
}

export interface OpcoesDetectar {
  /** Limite superior da busca (raiz do workspace). Padrão: sobe até a raiz do disco, só com `stat`. */
  limite?: string;
  /** PATH usado para procurar o `svn` (injeção em teste). Padrão: process.env.PATH. */
  path?: string;
  /** Não executa `svn info` (só `.svn` + binário). */
  semInfoSvn?: boolean;
}

async function existe(p: string): Promise<"dir" | "arquivo" | null> {
  try {
    const s = await stat(p);
    return s.isDirectory() ? "dir" : "arquivo";
  } catch {
    return null;
  }
}

const real = (p: string): Promise<string> => realpath(p).catch(() => resolve(p));

function dentroDe(p: string, limite: string | undefined): boolean {
  if (limite === undefined) return true;
  const l = limite.endsWith(sep) ? limite : limite + sep;
  return p === limite || (p + sep).startsWith(l);
}

/** Sobe a partir de `dir` procurando uma entrada `nome`; devolve a pasta que a contém. */
async function subirAte(dir: string, nome: string, limite?: string): Promise<string | null> {
  let atual = dir;
  for (;;) {
    if (!dentroDe(atual, limite)) return null;
    if ((await existe(join(atual, nome))) !== null) return atual;
    const pai = dirname(atual);
    if (pai === atual) return null;
    atual = pai;
  }
}

async function lerTexto(p: string): Promise<string | null> {
  try {
    return (await readFile(p, "utf8")).trim();
  } catch {
    return null;
  }
}

async function listarWorktrees(commonDir: string, raizAtual: string): Promise<string[]> {
  const out = new Set<string>([raizAtual]);
  // a árvore principal é a pasta que contém o commonDir (quando ele se chama `.git`)
  if (commonDir.endsWith(`${sep}.git`)) out.add(dirname(commonDir));
  try {
    for (const nome of await readdir(join(commonDir, "worktrees"))) {
      const apontador = await lerTexto(join(commonDir, "worktrees", nome, "gitdir"));
      if (apontador) out.add(await real(dirname(apontador)));
    }
  } catch {
    /* sem worktrees vinculados */
  }
  return [...out];
}

async function lerSubmodulos(raiz: string): Promise<string[]> {
  const txt = await lerTexto(join(raiz, ".gitmodules"));
  if (txt === null) return [];
  const lista: string[] = [];
  for (const m of txt.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) lista.push((m[1] as string).replace(/\\/g, "/"));
  return lista;
}

/** Procura `svn` no PATH informado. Sem executar nada. */
export async function acharBinarioSvn(path: string | undefined = process.env.PATH): Promise<string | null> {
  if (!path) return null;
  const nomes = process.platform === "win32" ? ["svn.exe", "svn.cmd", "svn.bat"] : ["svn"];
  for (const pasta of path.split(delimiter)) {
    if (pasta === "") continue;
    for (const n of nomes) {
      const c = join(pasta, n);
      if ((await existe(c)) === "arquivo") return c;
    }
  }
  return null;
}

async function infoSvn(bin: string, cwd: string, path: string | undefined): Promise<{ url: string | null; revisao: number | null; raizRepositorio: string | null } | null> {
  try {
    const r = await executorPadrao.executar(["info", "--xml", "--non-interactive"], {
      cwd,
      executavel: bin,
      timeoutMs: 5000,
      maxBytes: 1024 * 1024,
      ...(path === undefined ? {} : { env: { PATH: path } }),
    });
    const pega = (re: RegExp): string | null => re.exec(r.stdout)?.[1] ?? null;
    const rev = pega(/<entry[^>]*\srevision="(\d+)"/);
    return { url: pega(/<url>([^<]*)<\/url>/), revisao: rev === null ? null : Number(rev), raizRepositorio: pega(/<repository>\s*<root>([^<]*)<\/root>/) };
  } catch {
    return null;
  }
}

/**
 * Detecta o versionamento de `dir`. Git por `.git` (pasta ou arquivo `gitdir:`), SVN por `.svn`
 * (só consulta `svn` se o binário existir), git-svn por `.git/svn`, nada por `nenhum`.
 */
export async function detectar(dir: string, op: OpcoesDetectar = {}): Promise<Deteccao> {
  const inicio = await real(dir);
  const limite = op.limite === undefined ? undefined : await real(op.limite);
  const vazio: Deteccao = {
    tipo: "nenhum", raiz: null, capabilities: capabilitiesDe("nenhum"), gitDir: null, commonDir: null, worktreeVinculado: false,
    submodulo: false, aninhadoEm: null, worktrees: [], submodulos: [], svn: null, avisos: [],
  };

  const raizGit = await subirAte(inicio, ".git", limite);
  if (raizGit !== null) {
    const raiz = await real(raizGit);
    const ponto = join(raiz, ".git");
    let gitDir = ponto;
    let commonDir = ponto;
    let worktreeVinculado = false;
    let submodulo = false;
    if ((await existe(ponto)) === "arquivo") {
      const txt = await lerTexto(ponto);
      const m = txt === null ? null : /^gitdir:\s*(.+)$/m.exec(txt);
      if (m === null) return { ...vazio, avisos: [`.git ilegível em ${raiz}`] };
      const alvo = m[1] as string;
      gitDir = await real(isAbsolute(alvo) ? alvo : resolve(raiz, alvo));
      const comum = await lerTexto(join(gitDir, "commondir"));
      commonDir = comum === null ? gitDir : await real(isAbsolute(comum) ? comum : resolve(gitDir, comum));
      const norm = gitDir.replace(/\\/g, "/");
      if (norm.includes("/worktrees/")) worktreeVinculado = true;
      if (norm.includes("/modules/")) submodulo = true;
    }
    const gitSvn = (await existe(join(commonDir, "svn"))) === "dir";
    const pai = dirname(raiz);
    const aninhadoEm = pai !== raiz && dentroDe(pai, limite) ? await subirAte(pai, ".git", limite) : null;
    const tipo: TipoVcs = gitSvn ? "git-svn" : "git";
    return {
      ...vazio,
      tipo,
      raiz,
      capabilities: capabilitiesDe(tipo),
      gitDir,
      commonDir,
      worktreeVinculado,
      submodulo,
      aninhadoEm: aninhadoEm === null ? null : await real(aninhadoEm),
      worktrees: await listarWorktrees(commonDir, raiz),
      submodulos: await lerSubmodulos(raiz),
    };
  }

  // SVN: `.svn` na pasta ou acima (formato antigo tem um por pasta; vale o mais alto consecutivo)
  const baseSvn = await subirAte(inicio, ".svn", limite);
  if (baseSvn !== null) {
    let raiz = baseSvn;
    for (;;) {
      const pai = dirname(raiz);
      if (pai === raiz || !dentroDe(pai, limite) || (await existe(join(pai, ".svn"))) === null) break;
      raiz = pai;
    }
    raiz = await real(raiz);
    const path = op.path ?? process.env.PATH;
    const bin = await acharBinarioSvn(path);
    if (bin === null) {
      return { ...vazio, tipo: "svn", raiz, capabilities: capabilitiesDe("svn", false), svn: { binario: false, indisponivel: true, url: null, revisao: null, raizRepositorio: null }, avisos: ["svn indisponível: instale o Subversion (ex.: brew install subversion)"] };
    }
    const info = op.semInfoSvn === true ? null : await infoSvn(bin, raiz, path);
    return {
      ...vazio,
      tipo: "svn",
      raiz,
      capabilities: capabilitiesDe("svn"),
      svn: { binario: true, indisponivel: false, url: info?.url ?? null, revisao: info?.revisao ?? null, raizRepositorio: info?.raizRepositorio ?? null },
      avisos: info === null && op.semInfoSvn !== true ? ["svn info falhou: cópia de trabalho possivelmente corrompida"] : [],
    };
  }
  return vazio;
}
