import { descobrirRepo, estadoCli, type OpcoesDetectarRepo } from "./detectar";
import { validarRepo, type ConfigCli } from "./comum";
import { criarForgeAzure } from "./azure";
import { criarForgeBitbucket } from "./bitbucket";
import { criarForgeGithub } from "./github";
import { criarForgeGitlab } from "./gitlab";
import type { ConfigRest, CredencialRest } from "./rest";
import type { Forge, ProvedorForge, RepoRef } from "./forge";

// Porta única do forge (T-06.22). O resto do app (main, UI, Missões) importa SÓ daqui; adaptadores concretos são privados
// de `forge/` (garantido por `arquitetura.test.ts`). Credenciais: `gh`/`glab` guardam as suas; para Bitbucket/Azure a
// credencial vem do cofre do SO por `credencial()` injetada — nunca lida de env/arquivo, nunca em log/erro/evento.

export * from "./forge";
export * from "./erros";
export { semSegredos, parseRemoto, provedorPorHost, lerCorpoArquivo } from "./comum";
export { descobrirRepo, estadoCli, parseAuthStatus, parseVersao } from "./detectar";
export type { OpcoesDetectarRepo } from "./detectar";
export { AtualizadorPrs, agendadorPadrao, INTERVALO_MINIMO_MS } from "./atualizacao";
export type { Agendador, EventoAtualizacao, OpcoesAtualizador, ResultadoTick } from "./atualizacao";
export { issueParaPedido, issuesFechadasPorPr } from "./ponte";
export type { PedidoDeIssue, OpcoesIssueParaPedido, TipoPedido } from "./ponte";
export { ArmazemLog } from "./log";
export type { CredencialRest } from "./rest";

export interface OpcoesForge extends Pick<ConfigCli, "executor" | "env"> {
  cwd: string;
  /** Caminhos dos executáveis (padrão `gh`/`glab` do PATH). */
  executaveis?: { gh?: string; glab?: string };
  /** Cofre do SO (só Bitbucket/Azure). Recebe o host; devolve a credencial ou undefined. */
  credencial?: (host: string) => Promise<CredencialRest | undefined>;
  /** Testes: servidor REST local falso. */
  rest?: { baseUrl?: string; permitirLoopback?: boolean; fetch?: typeof fetch };
}

/** Forge de um provedor e repositório conhecidos. */
export function criarForge(provedor: ProvedorForge, repo: RepoRef, op: OpcoesForge): Forge {
  const r = validarRepo(repo);
  if (provedor === "github" || provedor === "gitlab") {
    const cfg: Omit<ConfigCli, "provedor"> & { repo: RepoRef } = { cwd: op.cwd, repo: r };
    if (op.executor) cfg.executor = op.executor;
    if (op.env) cfg.env = op.env;
    const exe = provedor === "github" ? op.executaveis?.gh : op.executaveis?.glab;
    if (exe) cfg.executavel = exe;
    return provedor === "github" ? criarForgeGithub(cfg) : criarForgeGitlab(cfg);
  }
  const cfg: ConfigRest = { repo: r, credencial: async () => op.credencial?.(r.host) };
  if (op.rest?.baseUrl) cfg.baseUrl = op.rest.baseUrl;
  if (op.rest?.permitirLoopback) cfg.permitirLoopback = true;
  if (op.rest?.fetch) cfg.fetch = op.rest.fetch;
  return provedor === "bitbucket" ? criarForgeBitbucket(cfg) : criarForgeAzure(cfg);
}

/**
 * Detecta o provedor pelo remoto (hostname; Enterprise/self-hosted por `hostsExtras` ou por conta já logada na CLI) e abre o forge.
 * `null` = sem remoto reconhecível: o app segue só com git (funcionamento degradado).
 */
export async function abrirForge(op: OpcoesForge & Omit<OpcoesDetectarRepo, keyof OpcoesForge>): Promise<Forge | null> {
  const det: OpcoesDetectarRepo = { ...(op.executor ? { executor: op.executor } : {}), ...(op.env ? { env: op.env } : {}), ...(op.hostsExtras ? { hostsExtras: op.hostsExtras } : {}), ...(op.remoto ? { remoto: op.remoto } : {}) };
  const d = await descobrirRepo(op.cwd, det);
  if (d.repo === null) return null;
  let provedor = d.provedor;
  if (provedor === null) {
    // hostname desconhecido: se a conta logada em `gh`/`glab` tem esse host, é Enterprise/self-hosted.
    for (const p of ["github", "gitlab"] as const) {
      const exe = p === "github" ? op.executaveis?.gh : op.executaveis?.glab;
      const e = await estadoCli(p, d.repo, op.cwd, { ...det, ...(exe ? { executavel: exe } : {}) }).catch(() => null);
      if (e?.contas.some((c) => c.host === d.repo!.host)) {
        provedor = p;
        break;
      }
    }
  }
  return provedor === null ? null : criarForge(provedor, d.repo, op);
}
