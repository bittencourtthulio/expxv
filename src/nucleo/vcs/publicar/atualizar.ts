// "Atualizar" (pull) (D-693): peças puras. O main roda `git pull --ff-only` pelo executor do VCS (nunca por agente de CLI, nunca merge/rebase/force, D-36); quando o
// branch divergiu, o dono pode pedir ao agente que faça o MERGE com uma instrução montada aqui (mesmo molde e mesma entrega do Commit e push, D-634/D-635).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUTO } from "../../produto";
import { analisarModelo, bloco, neutralizar, PASTA_PROMPTS_PUBLICAR, type ModeloPrompt } from "./prompt";
import { validarNomeRamo } from "./ramo";

export const TEXTO_DIVERGIU = "O branch divergiu do remoto: peça ao agente para fazer o merge.";

export type TipoFalhaPull = "divergiu" | "arvore_suja" | "sem_rede" | "autenticacao" | "outro";

/** Traduz a mensagem (já saneada pelo main) numa categoria e num texto PT-BR sem caminho nem credencial. */
export function classificarFalhaPull(mensagem: string): { tipo: TipoFalhaPull; texto: string } {
  const m = mensagem;
  if (/pull-divergente|diverg|fast-forward|--ff-only/i.test(m)) return { tipo: "divergiu", texto: TEXTO_DIVERGIU };
  if (/arvore-suja|would be overwritten|local changes|uncommitted|altera[cç][oõ]es locais/i.test(m)) return { tipo: "arvore_suja", texto: "Há alterações locais que o pull sobrescreveria: faça o commit (ou guarde com stash) e tente de novo." };
  if (/autentica/i.test(m)) return { tipo: "autenticacao", texto: "Falha de autenticação no GitHub: rode `gh auth login` ou configure o credential helper; o app nunca guarda senha nem token." };
  if (/sem-rede|sem conex|resolve host|network|timed out/i.test(m)) return { tipo: "sem_rede", texto: "Sem conexão com o GitHub. Verifique a rede e tente de novo." };
  return { tipo: "outro", texto: m.replace(/^\[[^\]]+\]\s*/, "").slice(0, 300) || "Não foi possível atualizar." };
}

/** Arquivos que o dono alterou localmente E que o upstream também mudou: o pull recusaria. Só NOMES. */
export function arquivosEmConflito(locais: readonly string[], doUpstream: readonly string[]): string[] {
  const alvo = new Set(doUpstream);
  return locais.filter((l) => alvo.has(l));
}

export interface ContextoMerge { repo: string; remoto: string; ramo: string; upstream: string; a_frente: number; atras: number; arquivos_do_upstream: readonly string[] }

const REPO_OK = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const UPSTREAM_OK = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9._/-]{1,100}$/;

export async function carregarModeloMerge(pasta: string = PASTA_PROMPTS_PUBLICAR): Promise<ModeloPrompt> {
  return analisarModelo(await readFile(join(pasta, "merge.md"), "utf8"));
}

export type InstrucaoMerge = { ok: true; texto: string; versao: number } | { ok: false; motivo: string };

export function montarInstrucaoMerge(modelo: ModeloPrompt, ctx: ContextoMerge): InstrucaoMerge {
  if (!REPO_OK.test(ctx.repo)) return { ok: false, motivo: "Repositório do GitHub inválido." };
  const ramo = validarNomeRamo(ctx.ramo);
  if (!ramo.ok) return { ok: false, motivo: "O branch atual tem um nome fora do padrão seguro." };
  if (!UPSTREAM_OK.test(ctx.upstream) || ctx.upstream.includes("..")) return { ok: false, motivo: "Upstream inválido." };
  const dados = [
    bloco("repositorio", { repo: ctx.repo, remoto: ctx.remoto, ramo_atual: ramo.nome, upstream: ctx.upstream, commits_locais_a_frente: ctx.a_frente, commits_do_remoto_que_faltam: ctx.atras }),
    bloco("arquivos_alterados_no_remoto", { total: ctx.arquivos_do_upstream.length, primeiros: ctx.arquivos_do_upstream.slice(0, 100).map((a) => neutralizar(a).slice(0, 300)) }),
  ].join("\n\n");
  const valores: Record<string, string> = { REPO: ctx.repo, RAMO: ramo.nome, UPSTREAM: ctx.upstream, PASTA_PRODUTO: PRODUTO.pastaNoProjeto, DADOS: dados };
  const texto = modelo.texto.replace(/\{\{([A-Z_]+)\}\}/g, (inteiro, chave: string) => valores[chave] ?? inteiro).replace(/\n{3,}/g, "\n\n");
  return { ok: true, texto: `${texto}\n`, versao: modelo.versao };
}
