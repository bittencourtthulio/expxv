import { lstat, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ConfirmacaoServidor, OpcoesBaseSvn } from "./comum";
import { caminhoRepo, rodarSvnEscrita, rodarSvn, SvnRecusadoErro, validarUrl } from "./comum";
import { infoSvn, localAtual } from "./info";
import { criarRamoSvn, trocarSvn, type OpcoesCriarRamoSvn, type PlanoRamoSvn } from "./ramos";
import { parseStatusXml } from "./status";

// T-06.27: Missão de SVN SEM worktree = cópia de trabalho IRMÃ `../<repo>--<slug>` (checkout do tronco/branch).
// Sem branch no servidor por padrão; remover a cópia nunca fala com o servidor; duas Missões não se tocam
// (pastas e bancos `.svn` separados).

const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,48}$/;

export interface MissaoSvn {
  slug: string;
  raiz: string;
  principal: string;
  /** URL do checkout. */
  url: string;
  /** Caminho no repositório (`trunk`, `branches/x`). */
  alvo: string;
}

export function slugMissaoValido(slug: string): boolean {
  return typeof slug === "string" && SLUG.test(slug);
}

/** Pasta irmã da Missão (não cria nada). */
export function pastaMissaoSvn(principal: string, slug: string): string {
  if (!slugMissaoValido(slug)) throw new SvnRecusadoErro(`Slug de Missão inválido: ${String(slug)}`, "proibido");
  return join(dirname(principal), `${basename(principal)}--${slug}`);
}

const existe = (p: string): Promise<boolean> => stat(p).then(() => true, () => false);

export async function criarMissaoSvn(principal: string, op: OpcoesBaseSvn & { slug: string; alvo?: string }): Promise<MissaoSvn> {
  const raiz = await realpath(principal);
  const destino = pastaMissaoSvn(raiz, op.slug);
  if (await existe(destino)) throw new SvnRecusadoErro(`A pasta da Missão já existe: ${destino}`, "destino-existe", [destino]);
  const info = await infoSvn(raiz, op);
  const alvo = op.alvo !== undefined ? caminhoRepo(op.alvo) : info.urlRelativa.replace(/^\^\//, "");
  const url = validarUrl(`${info.raizRepositorio}/${alvo}`, op.permitirFile === true);
  await rodarSvnEscrita(dirname(raiz), "checkout", ["-q", "--ignore-externals"], [url, destino], { ...op, timeoutMs: 600_000 });
  return { slug: op.slug, raiz: await realpath(destino), principal: raiz, url, alvo };
}

/** Missões (cópias irmãs com `.svn`) de uma cópia principal. */
export async function listarMissoesSvn(principal: string): Promise<Array<{ slug: string; raiz: string }>> {
  const raiz = await realpath(principal);
  const prefixo = `${basename(raiz)}--`;
  const out: Array<{ slug: string; raiz: string }> = [];
  for (const n of await readdir(dirname(raiz)).catch(() => [] as string[])) {
    if (!n.startsWith(prefixo)) continue;
    const slug = n.slice(prefixo.length);
    if (slugMissaoValido(slug) && (await existe(join(dirname(raiz), n, ".svn")))) out.push({ slug, raiz: join(dirname(raiz), n) });
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/**
 * Remove a cópia da Missão (só o diretório local; NUNCA toca o repositório). Recusa quando há mudanças
 * locais, salvo `descartarAlteracoes`. Só apaga pasta irmã com o nome esperado, com `.svn`, que não seja link.
 */
export async function removerMissaoSvn(principal: string, slug: string, op: OpcoesBaseSvn & { descartarAlteracoes?: boolean } = {}): Promise<void> {
  const raiz = await realpath(principal);
  const pasta = pastaMissaoSvn(raiz, slug);
  const l = await lstat(pasta).catch(() => null);
  if (l === null) return;
  if (l.isSymbolicLink() || !l.isDirectory() || !(await existe(join(pasta, ".svn"))) || dirname(await realpath(pasta)) !== dirname(raiz) || (await realpath(pasta)) === raiz) {
    throw new SvnRecusadoErro(`Não é a cópia de uma Missão: ${pasta}`, "proibido");
  }
  if (op.descartarAlteracoes !== true) {
    const st = await rodarSvn(pasta, "status", ["--xml", "-q"], [], op);
    const sujos = parseStatusXml(st.stdout).arquivos.filter((m) => m.tipo !== "ignorado" && m.tipo !== "naorastreado");
    if (sujos.length > 0) throw new SvnRecusadoErro("A cópia da Missão tem alterações não enviadas.", "arvore-suja", sujos.slice(0, 10).map((m) => m.caminho));
  }
  await rm(pasta, { recursive: true, force: true });
}

/**
 * Ação EXPLÍCITA "criar branch no servidor" para a Missão: `svn copy` (grava no servidor, exige confirmação)
 * e depois `switch` da cópia da Missão para o novo branch. `simular: true` só devolve o plano.
 */
export async function criarRamoDaMissaoSvn(raizMissao: string, op: Omit<OpcoesCriarRamoSvn, "tipo"> & Partial<ConfirmacaoServidor>): Promise<PlanoRamoSvn> {
  const info = await infoSvn(raizMissao, op);
  const plano = await criarRamoSvn(raizMissao, { ...op, tipo: "branch", info });
  if (plano.simulado) return plano;
  await trocarSvn(raizMissao, plano.destino.replace(/^\^\//, ""), op);
  return plano;
}

export const ehLocalDeTronco = (urlRelativa: string): boolean => localAtual(urlRelativa).tipo === "trunk";
