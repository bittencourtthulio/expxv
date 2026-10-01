// Gerador de repositórios sintéticos GRANDES para os orçamentos P-16..P-21 (T-06.38).
// Usa `git fast-import` (histórico inteiro em um stream) + `git reset --hard` (escreve a árvore e o índice
// já com stat atualizado, como num clone). Nada fora de `dir` é tocado; sem rede; config global desligada.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./repos";

export interface OpcoesRepoSintetico {
  /** Arquivos rastreados no primeiro commit. */
  arquivos: number;
  /** Commits na `main` (mínimo 1). Cada commit depois do primeiro altera `alteracoesPorCommit` arquivos. */
  commits?: number;
  alteracoesPorCommit?: number;
  /** Ramos `feature-N` saindo de pontos distintos da main, com um commit cada. */
  ramos?: number;
  /** Renomeia N arquivos em commits finais da main (conteúdo preservado, para detecção de rename). */
  renomes?: number;
  /** Cria `conflito-a` e `conflito-b` a partir do mesmo ponto, editando a MESMA linha de `conflito.txt`. */
  conflito?: boolean;
  /** Arquivos por pasta (padrão 100). */
  porPasta?: number;
  /** Linhas por arquivo (padrão 8). */
  linhas?: number;
}

export interface RepoSintetico {
  dir: string;
  arquivos: string[];
  commits: number;
  /** caminho de um arquivo rastreado qualquer, para tocar nos testes. */
  exemplo: string;
}

const caminhoDe = (i: number, porPasta: number): string => `d${String(Math.floor(i / porPasta)).padStart(3, "0")}/s${i % 7}/arq${i}.txt`;

function conteudo(i: number, versao: number, linhas: number): string {
  const l: string[] = [];
  for (let k = 0; k < linhas; k++) l.push(`arquivo ${i} linha ${k} v${versao} ${"x".repeat((i + k) % 23)}`);
  return l.join("\n") + "\n";
}

function alimentar(dir: string, stream: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
    const f = spawn("git", ["fast-import", "--quiet", "--done"], { cwd: dir, env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdio: ["pipe", "ignore", "pipe"] });
    let erro = "";
    f.stderr.on("data", (b: Buffer) => (erro += b.toString()));
    f.on("error", reject);
    f.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`fast-import falhou (${c}): ${erro.slice(0, 300)}`))));
    f.stdin.end(stream);
  });
}

export async function gerarRepo(dir: string, op: OpcoesRepoSintetico): Promise<RepoSintetico> {
  const porPasta = op.porPasta ?? 100;
  const linhas = op.linhas ?? 8;
  const commits = Math.max(1, op.commits ?? 1);
  const alter = op.alteracoesPorCommit ?? 3;
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Gerador");
  git(dir, "config", "user.email", "gerador@example.invalid");
  git(dir, "config", "commit.gpgsign", "false");

  const caminhos = Array.from({ length: op.arquivos }, (_, i) => caminhoDe(i, porPasta));
  const versoes = new Array<number>(op.arquivos).fill(0);
  let marca = 0;
  let t = 1_700_000_000;
  const out: string[] = [];
  const dado = (s: string): string => `data ${Buffer.byteLength(s)}\n${s}\n`;
  const cabecalhoCommit = (ref: string, msg: string, de?: string): void => {
    out.push(`commit ${ref}\nmark :${++marca}\ncommitter Gerador <gerador@example.invalid> ${t++} +0000\n${dado(msg).trimEnd()}\n${de ? `from ${de}\n` : ""}`);
  };
  const marcaCommit: number[] = [];

  // commit 1: todos os arquivos
  cabecalhoCommit("refs/heads/main", "inicial");
  for (let i = 0; i < op.arquivos; i++) out.push(`M 100644 inline ${caminhos[i]}\n${dado(conteudo(i, 0, linhas))}`);
  out.push("conflito" in op && op.conflito ? `M 100644 inline conflito.txt\n${dado("a\nb\nc\n")}` : "");
  marcaCommit.push(marca);

  for (let c = 1; c < commits; c++) {
    cabecalhoCommit("refs/heads/main", `commit ${c}`);
    for (let k = 0; k < alter; k++) {
      const i = (c * 7919 + k * 104729) % op.arquivos;
      versoes[i]!++;
      out.push(`M 100644 inline ${caminhos[i]}\n${dado(conteudo(i, versoes[i]!, linhas))}`);
    }
    marcaCommit.push(marca);
  }
  const renomes = Math.min(op.renomes ?? 0, op.arquivos);
  if (renomes > 0) {
    cabecalhoCommit("refs/heads/main", "renomes");
    for (let r = 0; r < renomes; r++) {
      const de = caminhos[r] as string;
      const para = `renomeados/arq${r}.txt`;
      out.push(`R ${de} ${para}\n`);
      caminhos[r] = para;
    }
    marcaCommit.push(marca);
  }
  const ramos = op.ramos ?? 0;
  for (let b = 0; b < ramos; b++) {
    const de = marcaCommit[Math.floor(((b + 1) * marcaCommit.length) / (ramos + 1))] as number;
    cabecalhoCommit(`refs/heads/feature-${b}`, `feature ${b}`, `:${de}`);
    out.push(`M 100644 inline feature-${b}.txt\n${dado(`ramo ${b}\n`)}`);
  }
  if (op.conflito === true) {
    const base = marcaCommit[0] as number;
    for (const lado of ["a", "b"]) {
      cabecalhoCommit(`refs/heads/conflito-${lado}`, `conflito ${lado}`, `:${base}`);
      out.push(`M 100644 inline conflito.txt\n${dado(`a\n${lado.toUpperCase()}\nc\n`)}`);
    }
  }
  out.push("done\n");
  await alimentar(dir, out.join(""));
  git(dir, "reset", "-q", "--hard", "main");
  return { dir, arquivos: caminhos, commits: commits + (renomes > 0 ? 1 : 0), exemplo: caminhos[op.arquivos - 1] as string };
}

/** Cria N arquivos não rastreados na raiz (o git agrupa pastas inteiras; na raiz cada um vira uma entrada `?`). */
export function criarNaoRastreados(dir: string, n: number): void {
  for (let i = 0; i < n; i++) writeFileSync(join(dir, `solto${i}.txt`), `x${i}\n`);
}
