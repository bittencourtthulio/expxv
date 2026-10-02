// Novo projeto (D-607): cria a pasta, os arquivos do template (locais, sem rede, sem instalar nada) e, se pedido, `git init` (ramo `main`) com commit inicial
// SÓ quando o dono já tem identidade git configurada (senão não commita e avisa). Recusa pasta existente e não vazia; nunca escreve fora da pasta alvo.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TemplateProjeto } from "../../../compartilhado/workspaces-adicionar";
import type { ExecutorVcs } from "../../vcs/executor";
import { avaliarDestino, dentroDe } from "./destino";
import { ErroAdicionarNucleo } from "./erros";
import { caminhoRelativoSeguro, gerarTemplate } from "./templates";

export interface OpcoesNovoProjeto {
  executor: ExecutorVcs;
  pai: string;
  nome: string;
  git: boolean;
  gitignore: boolean;
  commit_inicial: boolean;
  readme: boolean;
  template: TemplateProjeto;
  executavelGit?: string;
}

export interface ResultadoNovoProjeto {
  caminho: string;
  arquivos: string[];
  git: boolean;
  commitFeito: boolean;
  avisos: string[];
}

export const AVISO_SEM_IDENTIDADE = "O git deste computador ainda não tem nome e e-mail: o commit inicial não foi feito. Configure com `git config --global user.name \"Seu Nome\"` e `git config --global user.email voce@exemplo.com`.";

export async function criarNovoProjeto(op: OpcoesNovoProjeto): Promise<ResultadoNovoProjeto> {
  const av = await avaliarDestino(op.pai, op.nome);
  if (av.situacao === "ocupado") throw new ErroAdicionarNucleo("colisao", "Já existe uma pasta com esse nome e ela não está vazia. Escolha outro nome: nada é sobrescrito.", av.sugestao, "escolher_outro_nome");
  if (!av.ok || av.caminho === null) throw new ErroAdicionarNucleo(/permissão/i.test(av.motivo ?? "") ? "sem_permissao" : "destino_invalido", av.motivo ?? "Destino inválido.");
  const destino = av.caminho;
  const criouPasta = av.situacao === "livre";
  const arquivos = gerarTemplate({ nome: op.nome.trim(), template: op.template, readme: op.readme, gitignore: op.git && op.gitignore });
  const escritos: string[] = [];
  const avisos: string[] = [];
  try {
    if (criouPasta) await mkdir(destino);
    for (const a of arquivos) {
      const alvo = join(destino, a.caminho);
      if (!caminhoRelativoSeguro(a.caminho) || !dentroDe(destino, alvo)) throw new ErroAdicionarNucleo("interno", "Template inválido: caminho fora da pasta do projeto.");
      await mkdir(dirname(alvo), { recursive: true });
      await writeFile(alvo, a.conteudo, { flag: "wx" }); // nunca sobrescreve
      escritos.push(a.caminho);
    }
    let commitFeito = false;
    if (op.git) {
      const exec = op.executor.comConfianca("nao_confiavel");
      const base = { cwd: destino, executavel: op.executavelGit ?? "git" } as const;
      await exec.executar(["init"], { ...base, tipo: "escrita" });
      await exec.executar(["symbolic-ref", "HEAD", "refs/heads/main"], { ...base, tipo: "escrita" });
      if (op.commit_inicial) {
        const ler = async (chave: string): Promise<string> => (await exec.executar(["config", "--get", chave], { ...base, tolerar: [1] })).stdout.trim();
        const temIdentidade = (await ler("user.name")) !== "" && (await ler("user.email")) !== "";
        if (!temIdentidade) avisos.push(AVISO_SEM_IDENTIDADE);
        else {
          await exec.executar(["add", "-A"], { ...base, tipo: "escrita" });
          await exec.executar(["-c", "commit.gpgsign=false", "commit", "--allow-empty", "--no-verify", "-m", "Commit inicial"], { ...base, tipo: "escrita" });
          commitFeito = true;
        }
      }
    }
    return { caminho: destino, arquivos: escritos, git: op.git, commitFeito, avisos };
  } catch (e) {
    // desfaz só o que criamos
    if (criouPasta) await rm(destino, { recursive: true, force: true }).catch(() => undefined);
    else {
      for (const rel of [...escritos.map((c) => c.split("/")[0] as string), ".git"]) {
        const alvo = join(destino, rel);
        if (dentroDe(destino, alvo) && (await readdir(destino).catch(() => [] as string[])).includes(rel)) await rm(alvo, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    if (e instanceof ErroAdicionarNucleo) throw e;
    const codigo = (e as NodeJS.ErrnoException).code;
    if (codigo === "ENOSPC") throw new ErroAdicionarNucleo("disco_cheio", "O disco está cheio. Libere espaço e tente de novo.");
    if (codigo === "EACCES" || codigo === "EPERM") throw new ErroAdicionarNucleo("sem_permissao", "Sem permissão para criar o projeto nessa pasta.");
    throw new ErroAdicionarNucleo("interno", e instanceof Error && e.name.startsWith("Git") ? "Não foi possível iniciar o repositório git. O projeto não foi criado." : "Não foi possível criar o projeto.");
  }
}
