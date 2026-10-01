import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { GitErro, NomeInvalidoErro, WorktreeInvalidoErro } from "../../git/erros";
import { diffStat, statusResumo, type DiffStat } from "../../git/status";
import { parseWorktreeList, worktreeAdd, worktreeRemove, type ResultadoWorktreeAdd, type Worktree } from "../../git/worktree";
import { campos, escrita, resolverRev, rodarGit, validarNomeRef, type OpcoesBase } from "./comum";
import { ramoPadrao } from "./ramos";

// T-06.16 · Worktrees avançado, em cima de `src/nucleo/git/worktree.ts` (criar/remover do MVP são reaproveitados).
// Toda operação sobre um worktree existente só aceita caminhos que o próprio `git worktree list` conhece.

export interface WorktreeEstado extends Worktree {
  existe: boolean;
  /** Órfão: a pasta sumiu ou o git a marca como podável (ligação quebrada). Reparável/podável. */
  orfao: boolean;
  motivoOrfao: string | null;
  motivoTravamento: string | null;
  /** Sujo = qualquer alteração (inclui não rastreados). null quando não dá para saber (pasta ausente). */
  sujo: boolean | null;
  arquivosAlterados: number;
}

async function real(p: string): Promise<string> {
  return realpath(p).catch(() => resolve(p));
}

/** Lista com motivos de trava/órfão (do porcelain) e estado sujo/limpo de cada worktree existente. */
export async function listarWorktrees(raiz: string, opcoes: OpcoesBase & { comEstado?: boolean } = {}): Promise<WorktreeEstado[]> {
  const { comEstado = true, ...op } = opcoes;
  const r = await rodarGit(raiz, ["worktree", "list", "--porcelain"], op);
  const base = parseWorktreeList(r.stdout);
  const motivos = new Map<string, { trava: string | null; orfao: string | null }>();
  for (const bloco of r.stdout.split(/\r?\n\r?\n/)) {
    let caminho = "";
    let trava: string | null = null;
    let orfao: string | null = null;
    for (const l of bloco.split(/\r?\n/)) {
      if (l.startsWith("worktree ")) caminho = l.slice(9);
      else if (l.startsWith("locked ")) trava = l.slice(7);
      else if (l.startsWith("prunable ")) orfao = l.slice(9);
    }
    if (caminho) motivos.set(caminho, { trava, orfao });
  }
  return Promise.all(
    base.map(async (w): Promise<WorktreeEstado> => {
      const existe = existsSync(w.caminho);
      const m = motivos.get(w.caminho);
      let sujo: boolean | null = null;
      let n = 0;
      if (comEstado && existe && !w.bare) {
        const s = await statusResumo(w.caminho, { ...(op.signal ? { signal: op.signal } : {}) }).catch(() => null);
        if (s) {
          sujo = s.sujo;
          n = s.staged + s.modificados + s.nao_rastreados + s.conflitos;
        }
      }
      return { ...w, existe, orfao: !existe || w.prunable, motivoOrfao: m?.orfao ?? (existe ? null : "a pasta do worktree não existe mais"), motivoTravamento: m?.trava ?? null, sujo, arquivosAlterados: n };
    }),
  );
}

export async function worktreesOrfaos(raiz: string, op: OpcoesBase = {}): Promise<WorktreeEstado[]> {
  return (await listarWorktrees(raiz, { ...op, comEstado: false })).filter((w) => w.orfao && !w.principal);
}

async function achar(raiz: string, caminho: string, op: OpcoesBase): Promise<WorktreeEstado> {
  const alvo = await real(isAbsolute(caminho) ? caminho : resolve(raiz, caminho));
  const lista = await listarWorktrees(raiz, { ...op, comEstado: false });
  for (const w of lista) if ((await real(w.caminho)) === alvo || resolve(w.caminho) === resolve(alvo)) return w;
  throw new WorktreeInvalidoErro(`Não é um worktree deste repositório: ${alvo}`);
}

export interface OpcoesCriarWorktree extends OpcoesBase {
  /** Branch nova (criada com `-b`, com sufixo numérico em colisão) OU, com `ramoExistente`, a branch já existente. */
  branch: string;
  ramoExistente?: boolean;
  caminho?: string;
  base?: string;
  exigirArvoreLimpa?: boolean;
}

/** Cria o worktree (branch nova pelo serviço do MVP; ou branch existente que não esteja em uso em outro worktree). */
export async function criarWorktree(raiz: string, opcoes: OpcoesCriarWorktree): Promise<ResultadoWorktreeAdd> {
  const { branch, ramoExistente = false, caminho, base, exigirArvoreLimpa, signal } = opcoes;
  const op = signal ? { signal } : {};
  if (!ramoExistente) return worktreeAdd({ repo: raiz, branch, ...(caminho ? { caminho } : {}), ...(base ? { base } : {}), ...(exigirArvoreLimpa ? { exigirArvoreLimpa } : {}), ...op });
  await validarNomeRef(raiz, branch, "heads", opcoes);
  const existe = await rodarGit(raiz, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { ...opcoes, tolerar: [1] });
  if (existe.codigo !== 0) throw new GitErro(`Branch inexistente: ${branch}`);
  if (caminho === undefined) throw new WorktreeInvalidoErro("Informe o caminho do worktree para uma branch existente.");
  const destino = isAbsolute(caminho) ? caminho : resolve(raiz, caminho);
  if (existsSync(destino)) throw new WorktreeInvalidoErro(`O caminho já existe: ${destino}`);
  await escrita(raiz, ["worktree", "add", "--", destino, branch], opcoes);
  return { caminho: await real(destino), branch, slug: branch, tentativa: 1 };
}

export interface ResultadoRemoverWorktree {
  removido: boolean;
  simulado: boolean;
  /** Por que não pode (ou não foi): `sujo`, `travado`, `principal`. */
  motivo: "sujo" | "travado" | "principal" | null;
  arquivosAlterados: number;
  branchApagada: boolean;
}

/**
 * Remove worktree secundário. Recusa a principal, a travada e a SUJA (nunca usa `--force`). `simular: true` só informa.
 * Worktree órfão (pasta ausente) não tem o que perder: use `podarWorktrees`.
 */
export async function removerWorktree(raiz: string, caminho: string, opcoes: OpcoesBase & { apagarBranch?: boolean; simular?: boolean } = {}): Promise<ResultadoRemoverWorktree> {
  const { apagarBranch = false, simular = false, ...op } = opcoes;
  const w = await achar(raiz, caminho, op);
  const r = (motivo: ResultadoRemoverWorktree["motivo"], n = 0): ResultadoRemoverWorktree => ({ removido: false, simulado: simular, motivo, arquivosAlterados: n, branchApagada: false });
  if (w.principal) return r("principal");
  if (w.locked) return r("travado");
  if (w.existe) {
    const s = await statusResumo(w.caminho, op);
    if (s.sujo) return r("sujo", s.staged + s.modificados + s.nao_rastreados + s.conflitos);
  }
  if (simular) return { removido: false, simulado: true, motivo: null, arquivosAlterados: 0, branchApagada: false };
  const x = await worktreeRemove({ repo: raiz, caminho: w.caminho, apagarBranch, ...(op.signal ? { signal: op.signal } : {}) });
  return { removido: true, simulado: false, motivo: null, arquivosAlterados: 0, branchApagada: x.branch_apagada };
}

/** `git worktree prune`: esquece worktrees cuja pasta sumiu. `simular` lista sem apagar. Não toca em pastas existentes. */
export async function podarWorktrees(raiz: string, opcoes: OpcoesBase & { simular?: boolean } = {}): Promise<{ podados: string[]; simulado: boolean }> {
  const { simular = false, ...op } = opcoes;
  const r = await escrita(raiz, ["worktree", "prune", "--verbose", ...(simular ? ["--dry-run"] : [])], op);
  const podados = `${r.stdout}\n${r.stderr}`
    .split("\n")
    .map((l) => /^Removing (\S+?):/.exec(l.trim())?.[1])
    .filter((x): x is string => x !== undefined);
  return { podados, simulado: simular };
}

/**
 * `git worktree repair`: reata a ligação de worktrees movidos. Sem `caminhos`, conserta o que o git consegue achar;
 * com `caminhos`, os novos locais (pastas movidas à mão).
 */
export async function repararWorktrees(raiz: string, opcoes: OpcoesBase & { caminhos?: readonly string[] } = {}): Promise<{ reparados: string[]; saida: string }> {
  const { caminhos = [], ...op } = opcoes;
  for (const c of caminhos) if (typeof c !== "string" || c === "" || c.includes("\0") || c.startsWith("-")) throw new NomeInvalidoErro(String(c));
  const abs = caminhos.map((c) => (isAbsolute(c) ? c : resolve(raiz, c)));
  const r = await escrita(raiz, ["worktree", "repair", ...(abs.length ? ["--", ...abs] : [])], op);
  const saida = `${r.stdout}${r.stderr}`.trim();
  const reparados = saida.split("\n").map((l) => /^repair: .*?: (.+)$/.exec(l.trim())?.[1]).filter((x): x is string => x !== undefined);
  return { reparados, saida };
}

export async function travarWorktree(raiz: string, caminho: string, motivo?: string, op: OpcoesBase = {}): Promise<void> {
  if (motivo !== undefined && (motivo.includes("\0") || motivo.length > 300)) throw new NomeInvalidoErro(motivo.slice(0, 30));
  const w = await achar(raiz, caminho, op);
  if (w.principal) throw new WorktreeInvalidoErro("A árvore principal não pode ser travada.");
  await escrita(raiz, ["worktree", "lock", ...(motivo ? ["--reason", motivo] : []), "--", w.caminho], op);
}

export async function destravarWorktree(raiz: string, caminho: string, op: OpcoesBase = {}): Promise<void> {
  const w = await achar(raiz, caminho, op);
  await escrita(raiz, ["worktree", "unlock", "--", w.caminho], op);
}

export interface ComparacaoBase {
  base: string;
  /** Commits do worktree que a base não tem. */
  ahead: number;
  /** Commits da base que o worktree não tem. */
  behind: number;
  /** O que a branch do worktree acrescentou desde o ancestral comum (`base...HEAD`). */
  diffStat: DiffStat;
}

/** Compara o worktree com a base (padrão: branch padrão do repositório). */
export async function compararComBase(raiz: string, caminho: string, opcoes: OpcoesBase & { base?: string } = {}): Promise<ComparacaoBase> {
  const { base: pedida, ...op } = opcoes;
  const w = await achar(raiz, caminho, op);
  if (!w.existe) throw new WorktreeInvalidoErro(`O worktree não existe mais: ${w.caminho}`);
  const base = pedida ?? (await ramoPadrao(raiz, op));
  if (base === null) throw new GitErro("Não há branch base para comparar (informe `base`).");
  await resolverRev(w.caminho, base, op);
  const r = await rodarGit(w.caminho, ["rev-list", "--left-right", "--count", `${base}...HEAD`], op);
  const [behind, ahead] = campos(r.stdout.replace(/\s+/g, "\0")).map(Number);
  return { base, ahead: ahead ?? 0, behind: behind ?? 0, diffStat: await diffStat(w.caminho, { base, ...(op.signal ? { signal: op.signal } : {}) }) };
}
