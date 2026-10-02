// Clone seguro (D-606). Quem baixa é o BINÁRIO `git` (ou `gh repo clone`) pelo executor de versionamento: sem shell, árvore morta ao cancelar, nenhum prompt.
// Nada do repositório clonado é executado: hooks neutros, fsmonitor desligado, protocolo `ext` negado, LFS sem smudge, só os protocolos da URL permitidos.
// Cancelar (ou falhar/estourar o silêncio) apaga SÓ a pasta parcial que nós criamos (ou o conteúdo dela, se o destino já existia vazio).
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { GitCanceladoErro, GitErro, GitIndisponivelErro } from "../../git/erros";
import type { ExecutorVcs } from "../../vcs/executor";
import { avaliarDestino, dentroDe } from "./destino";
import { ErroAdicionarNucleo, classificarErroClone } from "./erros";
import { ParserProgressoGit, type EventoProgressoGit } from "./progresso";
import type { OrigemGit } from "./url";

export const SILENCIO_PADRAO_MS = 120_000;
export const TOTAL_PADRAO_MS = 30 * 60_000;
const STDERR_MAX = 16 * 1024 * 1024;
const CAUDA_MAX = 16 * 1024;

export interface OpcoesClonar {
  executor: ExecutorVcs;
  origem: OrigemGit;
  /** pasta pai REAL (o main resolve do token). */
  pai: string;
  nome: string;
  branch: string | null;
  raso: boolean;
  submodulos: boolean;
  /** `gh` instalado e autenticado: GitHub vai por `gh repo clone`. */
  usarGh: boolean;
  sinal: AbortSignal;
  aoProgresso: (e: EventoProgressoGit) => void;
  silencioMs?: number;
  totalMs?: number;
  /** ambiente base só para decidir `GIT_SSH_COMMAND` (padrão process.env). */
  ambienteBase?: NodeJS.ProcessEnv;
  executavelGit?: string;
  executavelGh?: string;
}

export interface ResultadoClone {
  caminho: string;
  duracaoMs: number;
}

const DEV_NULL = process.platform === "win32" ? "NUL" : "/dev/null";

/** Protocolos que o git pode usar neste clone (inclui os dos submódulos). `file` só para origem local autorizada. */
export function protocolosPermitidos(origem: OrigemGit): string {
  if (origem.tipo === "local") return "file";
  return origem.tipo === "ssh" ? "ssh:https" : "https";
}

/** Config injetada por ambiente (vale para o git chamado pelo `gh` também). */
export function configPorAmbiente(): Record<string, string> {
  const itens: Array<[string, string]> = [
    ["core.hooksPath", DEV_NULL],
    ["core.fsmonitor", "false"],
    ["protocol.ext.allow", "never"],
    ["core.askPass", ""],
  ];
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(itens.length) };
  itens.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

export function ambienteDoClone(origem: OrigemGit, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    ...configPorAmbiente(),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ALLOW_PROTOCOL: protocolosPermitidos(origem),
    GIT_LFS_SKIP_SMUDGE: "1",
  };
  // sem terminal, o ssh nunca pode ficar esperando senha/confirmação; se o dono já definiu o próprio comando ssh, ele é respeitado
  if (origem.tipo === "ssh" && base.GIT_SSH_COMMAND === undefined && base.GIT_SSH === undefined) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  return env;
}

export function montarArgumentos(op: Pick<OpcoesClonar, "origem" | "branch" | "raso" | "submodulos" | "usarGh">, destino: string): { exe: "git" | "gh"; args: string[] } {
  const flags: string[] = ["--progress"];
  if (op.raso) flags.push("--depth", "1");
  if (op.branch !== null) flags.push("--branch", op.branch);
  if (op.submodulos) flags.push("--recurse-submodules", ...(op.raso ? ["--shallow-submodules"] : []));
  if (op.usarGh && op.origem.github_slug !== null) return { exe: "gh", args: ["repo", "clone", op.origem.github_slug, destino, "--", ...flags] };
  return { exe: "git", args: ["clone", ...flags, "--", op.origem.url_git, destino] };
}

/** Apaga só o que criamos: a pasta (se não existia) ou o conteúdo dela (se existia vazia). Nunca segue link simbólico nem sai de `destino`. */
export async function limparParcial(destino: string, criouPasta: boolean): Promise<void> {
  let info;
  try {
    info = await lstat(destino);
  } catch {
    return;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return;
  if (criouPasta) {
    await rm(destino, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    return;
  }
  for (const item of await readdir(destino).catch(() => [] as string[])) {
    const alvo = join(destino, item);
    if (dentroDe(destino, alvo)) await rm(alvo, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

export async function clonarRepositorio(op: OpcoesClonar): Promise<ResultadoClone> {
  if (op.origem.tipo === "local" && op.submodulos) throw new ErroAdicionarNucleo("origem_invalida", "Submódulos não são aceitos junto com caminho local.");
  const av = await avaliarDestino(op.pai, op.nome);
  if (av.situacao === "ocupado") throw new ErroAdicionarNucleo("colisao", av.motivo ?? "O destino já existe.", av.sugestao, "escolher_outro_nome");
  if (!av.ok || av.caminho === null) {
    throw new ErroAdicionarNucleo(/permissão/i.test(av.motivo ?? "") ? "sem_permissao" : "destino_invalido", av.motivo ?? "Destino inválido.");
  }
  const destino = av.caminho;
  const criouPasta = av.situacao === "livre";
  const { exe, args } = montarArgumentos(op, destino);
  const silencioMs = op.silencioMs ?? SILENCIO_PADRAO_MS;
  const totalMs = op.totalMs ?? TOTAL_PADRAO_MS;

  const ctl = new AbortController();
  let motivo = "cancelado" as "cancelado" | "silencio" | "total";
  const abortar = (m: typeof motivo): void => {
    if (ctl.signal.aborted) return;
    motivo = m;
    ctl.abort();
  };
  const aoCancelarFora = (): void => abortar("cancelado");
  if (op.sinal.aborted) throw new ErroAdicionarNucleo("cancelado", "Clone cancelado.");
  op.sinal.addEventListener("abort", aoCancelarFora, { once: true });
  let relogioSilencio: ReturnType<typeof setTimeout> | undefined;
  const armar = (): void => {
    if (relogioSilencio !== undefined) clearTimeout(relogioSilencio);
    relogioSilencio = setTimeout(() => abortar("silencio"), silencioMs);
  };
  const relogioTotal = setTimeout(() => abortar("total"), totalMs);
  armar();

  const parser = new ParserProgressoGit();
  const decodificador = new TextDecoder("utf-8", { fatal: false });
  let cauda = "";
  const inicio = performance.now();
  try {
    await op.executor.comConfianca("nao_confiavel").executar(args, {
      cwd: op.pai,
      tipo: "rede",
      executavel: exe === "gh" ? (op.executavelGh ?? "gh") : (op.executavelGit ?? "git"),
      timeoutMs: totalMs + 15_000,
      maxBytes: STDERR_MAX,
      signal: ctl.signal,
      chaveFila: destino,
      env: ambienteDoClone(op.origem, op.ambienteBase),
      aoStdout: () => armar(),
      aoStderr: (b) => {
        armar();
        const texto = decodificador.decode(b, { stream: true });
        cauda = (cauda + texto).slice(-CAUDA_MAX);
        for (const e of parser.alimentar(texto)) {
          try {
            op.aoProgresso(e);
          } catch {
            /* consumidor com defeito não derruba o clone */
          }
        }
      },
    });
    for (const e of parser.encerrar()) op.aoProgresso(e);
    return { caminho: destino, duracaoMs: performance.now() - inicio };
  } catch (e) {
    await limparParcial(destino, criouPasta);
    if (e instanceof ErroAdicionarNucleo) throw e;
    if (e instanceof GitCanceladoErro || ctl.signal.aborted) {
      if (motivo === "silencio") throw new ErroAdicionarNucleo("timeout", `O clone ficou ${Math.round(silencioMs / 1000)} s sem progresso e foi interrompido. Verifique a conexão e tente de novo.`);
      if (motivo === "total") throw new ErroAdicionarNucleo("timeout", "O clone passou do tempo máximo e foi interrompido. Tente o clone raso (mais rápido) ou aumente o limite.");
      throw new ErroAdicionarNucleo("cancelado", "Clone cancelado. A pasta parcial foi apagada.");
    }
    if (e instanceof GitIndisponivelErro) throw new ErroAdicionarNucleo(exe === "gh" ? "gh_ausente" : "git_ausente", exe === "gh" ? "A CLI do GitHub (`gh`) não foi encontrada. Instale-a ou use a URL completa." : "O `git` não foi encontrado neste computador. Instale o git e tente de novo.");
    const stderr = e instanceof GitErro && e.stderr !== undefined && e.stderr !== "" ? e.stderr : cauda;
    const c = classificarErroClone(stderr === "" && e instanceof Error ? e.message : stderr);
    throw new ErroAdicionarNucleo(c.codigo, c.mensagem, null, c.acao);
  } finally {
    clearTimeout(relogioTotal);
    if (relogioSilencio !== undefined) clearTimeout(relogioSilencio);
    op.sinal.removeEventListener("abort", aoCancelarFora);
  }
}
