// Fonte Git em Node (T-15.16, ligação): implementa `PortaGit` com `git log` por `execFile` (executável e argumentos SEPARADOS, nunca shell),
// somente leitura, sem pager, com teto de saída e de tempo. O que o git devolve é tratado como DADO. Caminho de arquivo proibido
// (env, chaves) é descartado aqui mesmo; o chunker de commit ainda aplica a denylist.
import { execFile } from "node:child_process";
import { caminhoProibido } from "../seguranca";
import type { CommitInfo, PortaGit } from "./git";

const SEP_REG = "\u001e";
const SEP_CAMPO = "\u001f";

function git(raiz: string, args: string[]): Promise<string | null> {
  return new Promise((resolver) => {
    execFile("git", ["--no-pager", ...args], { cwd: raiz, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 32 * 1024 * 1024, timeout: 20_000, windowsHide: true }, (erro, stdout) => {
      resolver(erro ? null : String(stdout));
    });
  });
}

const SHA = /^[0-9a-f]{7,64}$/;

export function criarGitNode(raiz: string): PortaGit {
  return {
    async head() {
      const s = await git(raiz, ["rev-parse", "HEAD"]);
      const sha = s?.trim() ?? "";
      return SHA.test(sha) ? sha : null;
    },
    async commitsDesde(ultimoSha, limite) {
      const n = Math.max(1, Math.min(Math.floor(limite), 5000));
      const intervalo = ultimoSha !== null && SHA.test(ultimoSha) ? [`${ultimoSha}..HEAD`] : [];
      const saida = await git(raiz, ["log", "--reverse", `--max-count=${n}`, "--name-status", `--format=${SEP_REG}%H${SEP_CAMPO}%an${SEP_CAMPO}%aI${SEP_CAMPO}%s`, ...intervalo]);
      if (saida === null) return [];
      const commits: CommitInfo[] = [];
      for (const reg of saida.split(SEP_REG)) {
        if (reg.trim() === "") continue;
        const linhas = reg.split("\n");
        const [sha, autor, em, mensagem] = (linhas[0] ?? "").split(SEP_CAMPO);
        if (sha === undefined || !SHA.test(sha) || em === undefined) continue;
        const arquivos: CommitInfo["arquivos"] = [];
        for (const l of linhas.slice(1)) {
          const partes = l.split("\t");
          if (partes.length < 2) continue;
          const status = (partes[0] ?? "").slice(0, 1);
          const caminho = partes[partes.length - 1] as string;
          if (caminhoProibido(caminho)) continue;
          arquivos.push({ caminho, status });
          if (arquivos.length >= 60) break;
        }
        commits.push({ sha, mensagem: mensagem ?? "", autor: autor === undefined || autor === "" ? null : autor, em, arquivos });
      }
      return commits;
    },
  };
}
