// Utilitários dos testes SVN (6D): fixtures gravadas do svn 1.14, o `svn` FALSO e repositórios REAIS temporários
// (`svnadmin create` em os.tmpdir + `file://`; nunca rede, nunca um repositório do usuário).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BIN_FALSO, pastaTmp } from "./repos";

export const FIXTURES_SVN = resolve(__dirname, "svn");
export const lerFixtureSvn = (nome: string): string => readFileSync(join(FIXTURES_SVN, nome), "utf8");

export const SVN_FALSO = join(BIN_FALSO, "svn");

/** Opções para apontar o executor ao `svn` falso com as saídas gravadas; `log` recebe o argv de cada chamada. */
export function falso(extra: Record<string, string> = {}): { executavel: string; env: Record<string, string>; log: string } {
  const pasta = pastaTmp("svn-falso-");
  const log = join(pasta, "argv.log");
  writeFileSync(log, "");
  return { executavel: SVN_FALSO, env: { SVN_FALSO_DIR: FIXTURES_SVN, SVN_FALSO_LOG: log, ...extra }, log };
}

/** Chamadas registradas pelo `svn` falso: uma lista de argumentos por chamada. */
export function chamadas(log: string): string[][] {
  return readFileSync(log, "utf8").split("---\n").filter((b) => b.trim() !== "").map((b) => b.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")));
}

export const mensagemGravada = (log: string): string => readFileSync(`${log}.msg`, "utf8");

export function arquivoDeErro(texto: string): string {
  const p = join(pastaTmp("svn-erro-"), "erro.txt");
  writeFileSync(p, texto);
  return p;
}

export const temSvnReal = (): boolean => spawnSync("svnadmin", ["--version", "--quiet"], { stdio: "ignore" }).status === 0 && spawnSync("svn", ["--version", "--quiet"], { stdio: "ignore" }).status === 0;

export function svn(cwd: string, ...args: string[]): string {
  return execFileSync("svn", ["--non-interactive", ...args], { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C.UTF-8" }, maxBuffer: 256 * 1024 * 1024 });
}

export interface RepoSvn {
  /** Pasta temporária que contém tudo. */
  base: string;
  repo: string;
  url: string;
  /** Cópia de trabalho do trunk (em `base/wc`). */
  wc: string;
}

/** Repositório real com trunk/branches/tags e uma cópia de trabalho do trunk, com um arquivo comitado. */
export function criarRepoSvn(opcoes: { arquivos?: Record<string, string> } = {}): RepoSvn {
  const base = pastaTmp("svn-real-");
  const repo = join(base, "repo");
  execFileSync("svnadmin", ["create", repo]);
  const url = `file://${repo}`;
  svn(base, "mkdir", "-q", "-m", "estrutura", `${url}/trunk`, `${url}/branches`, `${url}/tags`);
  const wc = join(base, "wc");
  svn(base, "checkout", "-q", `${url}/trunk`, wc);
  for (const [nome, conteudo] of Object.entries(opcoes.arquivos ?? { "a.txt": "um\ndois\ntres\n" })) {
    mkdirSync(join(wc, nome, ".."), { recursive: true });
    writeFileSync(join(wc, nome), conteudo);
  }
  svn(wc, "add", "-q", "--force", ".");
  svn(wc, "commit", "-q", "-m", "inicial");
  svn(wc, "update", "-q");
  return { base, repo, url, wc };
}

/** Cópia de trabalho SVN sintética (`svnadmin create` + `svn import` único + checkout) com `arquivos` arquivos. */
export function gerarCopiaSvn(arquivos: number, porPasta = 100): { base: string; wc: string; caminhos: string[] } {
  const base = pastaTmp("svn-perf-");
  const repo = join(base, "repo");
  execFileSync("svnadmin", ["create", repo]);
  const arvore = join(base, "arvore");
  const caminhos: string[] = [];
  for (let i = 0; i < arquivos; i++) {
    const dir = `d${Math.floor(i / porPasta)}`;
    if (i % porPasta === 0) mkdirSync(join(arvore, dir), { recursive: true });
    const c = `${dir}/f${i}.txt`;
    writeFileSync(join(arvore, c), `arquivo ${i}\nlinha 2\nlinha 3\n`);
    caminhos.push(c);
  }
  const url = `file://${repo}`;
  svn(base, "mkdir", "-q", "-m", "estrutura", `${url}/trunk`, `${url}/branches`, `${url}/tags`);
  svn(base, "import", "-q", "-m", "importa", arvore, `${url}/trunk`);
  const wc = join(base, "wc");
  svn(base, "checkout", "-q", `${url}/trunk`, wc);
  return { base, wc, caminhos };
}
