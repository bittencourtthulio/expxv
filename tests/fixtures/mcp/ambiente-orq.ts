// Ambiente dos testes de orquestração no Electron real (e2e e perf): projeto git temporário, CLIs falsas de
// orquestração como ÚNICA detecção (gancho de teste) e utilitários para criar Missões agênticas, ler o log
// da CLI falsa e contar processos de worker. Tudo em pastas temporárias.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUTO, variavelDeAmbiente } from "../../../src/nucleo/produto";
import { abrirApp, RAIZ } from "../../fixture";
import type { AppAberto } from "../../fixture";
import { matarArvoreDaPasta } from "../../limpeza";

export interface Linha { t: number; quem: "piloto" | "worker"; pane: string; evento: string; [k: string]: unknown }

interface Detalhe {
  mission: { estado: string };
  panes: Array<{ id: string; papel: string; cli: string; estado: string; display_id: number; eh_piloto: boolean; encerrado_motivo: string | null; sessao_pty_id: string | null }>;
  tasks: Array<{ id: string; estado: string; task_ref: string; pane_id: string | null; handoff_id: string | null }>;
  handoffs: Array<{ status: string; resumo: string; para_pane_id: string | null; de_pane_id: string | null; relatorio_path: string | null }>;
}

export interface JanelaOrq {
  ade: {
    missoes: {
      criar(p: unknown): Promise<{ id: string; piloto_pane_id: string | null }>;
      detalhe(id: string): Promise<Detalhe | null>;
      abortar(id: string): Promise<unknown>;
      assinar(cb: () => void): () => void;
    };
    workspaces: { abrir(c: string): Promise<{ id: string }> };
    provedores: { criarConta(p: string, r: string): Promise<{ id: string }>; habilitarConta(id: string, h: boolean): Promise<unknown> };
    terminais: { listarSessoes(): Promise<Array<{ estado: string; sessao_id: string }>>; descartar(id: string): Promise<boolean> };
  };
  __mudancas?: number;
}

export const TODOS_OS_PORTOES = ["direction", "content", "build", "qa"];

export async function esperar<T>(fn: () => T | Promise<T>, ms = 20_000, passo = 40): Promise<NonNullable<T>> {
  const t0 = Date.now();
  let ultimo: unknown;
  for (;;) {
    const v = await fn();
    ultimo = v;
    if (v !== undefined && v !== null && v !== false) return v as NonNullable<T>;
    if (Date.now() - t0 > ms) throw new Error(`tempo esgotado esperando a condição (${fn.toString().slice(0, 120)}); último valor: ${String(ultimo)}`);
    await new Promise((r) => setTimeout(r, passo));
  }
}

/** processos vivos de worker: a linha de comando da CLI falsa carrega o prompt "Execute o card" */
export function processosDeWorker(): number {
  const saida = execFileSync("ps", ["-axww", "-o", "command"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return saida.split("\n").filter((l) => /cli-(orq|agente)\.mjs/.test(l) && l.includes("Execute o card")).length;
}

/** Mata o que sobrou das CLIs falsas DESTE app (identificadas pela pasta de dados, única por execução). */
export function matarOrfaos(pastaDados: string): void {
  if (pastaDados.length < 8) return; // vazio/curto casaria com tudo (AUD-01: nunca matar o que não é deste app)
  const saida = execFileSync("ps", ["-axww", "-o", "pid,command"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  for (const linha of saida.split("\n")) {
    if (!/cli-(orq|agente)\.mjs/.test(linha) || !linha.includes(pastaDados)) continue;
    const pid = Number(linha.trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, "SIGKILL"); } catch { /* já saiu */ }
  }
}

export interface OpcoesAmbienteOrq {
  /** CLI falsa dos wrappers `claude`/`codex` (padrão `mcp/cli-orq.mjs`; `cli-agente.mjs` grava o que cada Pane recebeu). */
  cli?: "mcp/cli-orq.mjs" | "cli-agente.mjs";
  /** variáveis extras de ambiente do app (ex.: base do servidor Telegram falso). */
  envExtra?: Record<string, string>;
}

export async function criarAmbienteOrq(opcoes: OpcoesAmbienteOrq = {}) {
  const temporarias: string[] = [];
  const tmp = (p: string): string => {
    const d = mkdtempSync(join(tmpdir(), p));
    temporarias.push(d);
    return d;
  };
  const raiz = join(tmp("ade-orq-ws-"), "projeto");
  mkdirSync(raiz, { recursive: true });
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: raiz, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" } });
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(raiz, "README.md"), "# projeto\n");
  git("add", "-A");
  git("commit", "-q", "-m", "inicial");

  // CLIs falsas: `claude` e `codex` viram a CLI de orquestração de teste
  const pastaClis = tmp("ade-orq-clis-");
  for (const nome of ["claude", "codex"]) {
    const script = join(pastaClis, nome);
    writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${join(RAIZ, "tests", "fixtures", ...(opcoes.cli ?? "mcp/cli-orq.mjs").split("/"))}" "$@"\n`);
    chmodSync(script, 0o755);
  }
  const arquivoLog = join(tmp("ade-orq-log-"), "cli.log");
  writeFileSync(arquivoLog, "");
  // pasta de dados própria: o app pode ser REINICIADO (mesma pasta, daemon vivo) e a limpeza é nossa (fechar)
  const pastaDados = tmp("ade-e2e-");
  const pastaAgentes = tmp("ade-orq-agentes-");
  const env = { [variavelDeAmbiente("E2E_CLIS")]: pastaClis, CLI_ORQ_LOG: arquivoLog, CLI_AGENTE_DIR: pastaAgentes, ...(opcoes.envExtra ?? {}) };
  let app: AppAberto = await abrirApp({ pastaDados, env });
  await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15000 });
  const wsId = await app.pagina.evaluate((c) => (window as unknown as JanelaOrq).ade.workspaces.abrir(c).then((w) => w.id), raiz);

  let contador = 0;
  const criadas: string[] = [];

  const detalhe = (id: string) => app.pagina.evaluate((m) => (window as unknown as JanelaOrq).ade.missoes.detalhe(m), id);
  const linhasDoLog = (): Linha[] => readFileSync(arquivoLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Linha);

  return {
    get app(): AppAberto { return app; },
    raiz, wsId, arquivoLog, detalhe, linhasDoLog, pastaAgentes,

    /** O que a CLI falsa de agente registrou de um Pane (argv, ambiente, arquivos de instrução); `null` se ainda não abriu. */
    registroDoPane(paneId: string): { argv: string[]; ambiente: Record<string, string>; arquivos: Record<string, string>; cwd: string } | null {
      try {
        return JSON.parse(readFileSync(join(pastaAgentes, `${paneId}.json`), "utf8")) as { argv: string[]; ambiente: Record<string, string>; arquivos: Record<string, string>; cwd: string };
      } catch {
        return null;
      }
    },

    /** Fecha o app SEM descartar as sessões (o daemon e as CLIs seguem vivos) e o reabre na mesma pasta de dados. */
    async reiniciar(): Promise<AppAberto> {
      await app.fechar(); // pastaDados informada: preserva as sessões
      app = await abrirApp({ pastaDados, env });
      await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15000 });
      return app;
    },

    /** eventos do log dos Panes desta Missão (piloto e workers) */
    async eventos(missaoId: string): Promise<Linha[]> {
      const d = await detalhe(missaoId);
      const ids = new Set((d?.panes ?? []).map((p) => p.id));
      return linhasDoLog().filter((l) => ids.has(l.pane));
    },

    async chamadasDoPiloto(missaoId: string): Promise<Linha[]> {
      const d = await detalhe(missaoId);
      const ids = new Set((d?.panes ?? []).map((p) => p.id));
      return linhasDoLog().filter((l) => ids.has(l.pane) && l.quem === "piloto" && l.evento === "chamada");
    },

    liberarPortoes(missaoId: string, portoes: string[]): void {
      const banco = new DatabaseSync(join(app.pastaDados, `${PRODUTO.id}.db`));
      try {
        banco.exec("PRAGMA busy_timeout = 5000");
        const agora = new Date().toISOString();
        banco.prepare("INSERT INTO config (chave,valor_json,criado_em,atualizado_em) VALUES (?,?,?,?) ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json").run(`orquestracao.portoes.${missaoId}`, JSON.stringify(portoes), agora, agora);
      } finally {
        banco.close();
      }
    },

    /** Cria a Missão agêntica; o piloto falso espera o arquivo de largada (os portões são gravados antes). */
    async iniciarMissao(titulo: string, diretiva: Record<string, unknown>, portoes: string[] = TODOS_OS_PORTOES) {
      const largada = `.e2e-largada-${++contador}`;
      const pedido = `E2E:${JSON.stringify({ esperar: largada, ...diretiva })}`;
      const missao = await app.pagina.evaluate(
        ([ws, t, p]) => (window as unknown as JanelaOrq).ade.missoes.criar({ workspace_id: ws, modo: "agentico", origem: "livre", titulo: t, pedido: p, clis: { piloto: "claude" } }),
        [wsId, titulo, pedido] as const,
      );
      criadas.push(missao.id);
      if (portoes.length > 0) this.liberarPortoes(missao.id, portoes);
      writeFileSync(join(raiz, largada), "");
      return missao;
    },

    /** chamada `pane_spawn` de um worker com briefing próprio (o piloto falso grava o arquivo antes de chamar) */
    spawnWorker(worker: Record<string, unknown>, extra: Record<string, unknown> = {}) {
      const caminho = `${PRODUTO.pastaNoProjeto}/briefing-${++contador}.md`;
      return {
        tool: "pane_spawn",
        args: { provider: "claude", role: "executor", briefing_path: caminho, ...extra },
        briefing: { caminho, texto: `E2E:${JSON.stringify(worker)}` },
      };
    },

    async abortarCriadas(): Promise<void> {
      for (const id of criadas.splice(0)) await app.pagina.evaluate((m) => (window as unknown as JanelaOrq).ade.missoes.abortar(m), id).catch(() => undefined);
      await esperar(() => processosDeWorker() === 0, 10_000).catch(() => undefined);
    },

    async fechar(): Promise<void> {
      await this.abortarCriadas().catch(() => undefined);
      await app.pagina
        .evaluate(async () => {
          const t = (window as unknown as JanelaOrq).ade.terminais;
          for (const s of await t.listarSessoes()) await t.descartar(s.sessao_id);
        })
        .catch(() => undefined);
      await app.fechar();
      matarArvoreDaPasta(pastaDados);
      matarOrfaos(pastaDados);
      rmSync(pastaDados, { recursive: true, force: true });
      for (const p of temporarias) rmSync(p, { recursive: true, force: true });
    },
  };
}

export type AmbienteOrq = Awaited<ReturnType<typeof criarAmbienteOrq>>;
