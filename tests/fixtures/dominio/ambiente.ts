// Ambiente de teste do domínio (workspaces, provedores, missões, método): banco em memória com
// migrações, repositório git TEMPORÁRIO, sessões falsas e detector falso. Nada sai de dentro de /tmp.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco, migrar, type Banco } from "../../../src/nucleo/banco";
import { criarRepositorios, type Repositorios } from "../../../src/nucleo/banco/repos";
import type { FerramentaDetectada } from "../../../src/compartilhado/terminais";
import type { EventoTerminal } from "../../../src/compartilhado/terminais";

const tmps: string[] = [];
const bancos: Banco[] = [];

export function criarTmp(prefixo = "dom-"): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefixo)));
  tmps.push(d);
  return d;
}

export function limpar(): void {
  while (bancos.length) bancos.pop()?.fechar();
  while (tmps.length) rmSync(tmps.pop() as string, { recursive: true, force: true });
}

export function novoBanco(): { banco: Banco; repos: Repositorios } {
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  return { banco, repos: criarRepositorios(banco) };
}

const ENV_GIT = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: ENV_GIT, encoding: "utf8" });
}

/** Repositório git temporário com um commit. `pai` é a pasta que conterá o repo (e os worktrees irmãos). */
export function criarRepoGit(nome = "repo"): { pai: string; raiz: string } {
  const pai = criarTmp("dom-git-");
  const raiz = join(pai, nome);
  mkdirSync(raiz, { recursive: true });
  git(raiz, "init", "-q", "-b", "main");
  git(raiz, "config", "user.name", "Teste");
  git(raiz, "config", "user.email", "teste@example.invalid");
  git(raiz, "config", "commit.gpgsign", "false");
  writeFileSync(join(raiz, "README.md"), "# teste\n");
  git(raiz, "add", ".");
  git(raiz, "commit", "-q", "-m", "inicial");
  return { pai, raiz };
}

export function ferramenta(id: FerramentaDetectada["id"], instalado = true, versao: string | null = "1.0.0"): FerramentaDetectada {
  return {
    id,
    nome: id === "claude" ? "Claude Code" : id === "opencode" ? "OpenCode" : id === "codex" ? "Codex" : id,
    descricao: "",
    instalado,
    executavel_id: instalado ? `exe_${id}` : null,
    modo_lancamento: instalado ? "direto" : null,
    erro_codigo: instalado ? null : "ausente",
    versao: instalado ? versao : null,
    recursos: { prompt_inicial: id === "claude" || id === "codex" || id === "opencode", retomar: false, mcp: false, hook: false },
  };
}

export function detectorFalso(ferramentas: FerramentaDetectada[] = [ferramenta("claude"), ferramenta("codex"), ferramenta("opencode"), ferramenta("terminal")]) {
  let invalidacoes = 0;
  return {
    detectar: async () => ferramentas,
    invalidar: () => void invalidacoes++,
    get invalidacoes() { return invalidacoes; },
  };
}

export interface SessaoFalsa { id: string; cwd: string; pedido: Record<string, unknown>; ambiente: Record<string, string>; escritas: string[]; estado: "iniciando" | "executando" | "encerrada" }

/** Gerenciador de sessões falso: registra cwd/ambiente de cada `abrir` e deixa o teste emitir eventos. */
export function sessoesFalsas(opcoes: { vivasNaRecuperacao?: string[] } = {}) {
  const sessoes = new Map<string, SessaoFalsa>();
  const assinantes = new Set<(e: EventoTerminal) => void>();
  let n = 0;
  const api = {
    sessoes,
    abrir: (pedido: unknown, o?: { cwd?: string; ambiente?: Record<string, string> }) => {
      const id = `sessao_${++n}`;
      sessoes.set(id, { id, cwd: o?.cwd ?? "/sem-cwd", pedido: pedido as Record<string, unknown>, ambiente: o?.ambiente ?? {}, escritas: [], estado: "executando" });
      return { versao: 1 as const, sessao_id: id, estado: "iniciando" as const };
    },
    escrever: (id: string, dados: string) => { const s = sessoes.get(id); if (!s || s.estado !== "executando") return false; s.escritas.push(dados); return true; },
    encerrar: (id: string) => { const s = sessoes.get(id); if (s) s.estado = "encerrada"; return s !== undefined; },
    descartar: (id: string) => sessoes.delete(id),
    obter: (id: string) => { const s = sessoes.get(id); return s ? { sessao_id: id, ferramenta_id: "claude", executavel_id: "exe", estado: s.estado, atividade: null, workspace_id: null, cwd: s.cwd } : undefined; },
    recuperar: async () => {
      for (const id of opcoes.vivasNaRecuperacao ?? []) if (!sessoes.has(id)) sessoes.set(id, { id, cwd: "/recuperada", pedido: {}, ambiente: {}, escritas: [], estado: "executando" });
      return [];
    },
    assinar: (fn: (e: EventoTerminal) => void) => { assinantes.add(fn); return () => assinantes.delete(fn); },
    emitir: (sessao_id: string, dados: Record<string, unknown>) => { for (const fn of assinantes) fn({ versao: 1, sequencia: 1, sessao_id, ...dados } as EventoTerminal); },
  };
  return api;
}
