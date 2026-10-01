import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Limpeza de processos de teste. Daemons de PTY e CLIs falsas são destacados do app de propósito
// (as sessões sobrevivem ao app); quando um teste fecha o app sem descartá-los, eles ficariam
// vivos e esgotariam os PTYs do sistema. Duas redes de segurança:
//  1) `matarArvoreDaPasta`: ao fechar um app de teste, mata TODA a árvore cujo comando cita a pasta de dados dele.
//  2) `matarOrfaos`: ao fim da suíte, mata órfãos de testes antigos (nunca de um teste em andamento).

interface Proc { pid: number; ppid: number; idadeSeg: number; comando: string }

function idadeEmSegundos(etime: string): number {
  // formatos: [[dd-]hh:]mm:ss
  const [dias, resto] = etime.includes("-") ? (etime.split("-") as [string, string]) : ["0", etime];
  const partes = resto.split(":").map(Number);
  while (partes.length < 3) partes.unshift(0);
  const [h = 0, m = 0, s = 0] = partes;
  return Number(dias) * 86400 + h * 3600 + m * 60 + s;
}

export function listarProcessos(): Proc[] {
  if (process.platform === "win32") return [];
  const saida = execFileSync("ps", ["-axo", "pid=,ppid=,etime=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const procs: Proc[] = [];
  for (const linha of saida.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(linha);
    if (m === null) continue;
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), idadeSeg: idadeEmSegundos(m[3] as string), comando: m[4] as string });
  }
  return procs;
}

function descendentes(todos: Proc[], raizes: Proc[]): Proc[] {
  const pids = new Set(raizes.map((p) => p.pid));
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const p of todos) if (!pids.has(p.pid) && pids.has(p.ppid)) { pids.add(p.pid); cresceu = true; }
  }
  return todos.filter((p) => pids.has(p.pid));
}

function matar(procs: Proc[]): number {
  let n = 0;
  for (const p of procs) {
    if (p.pid === process.pid) continue;
    try { process.kill(p.pid, "SIGKILL"); n += 1; } catch { /* já saiu */ }
  }
  return n;
}

export function matarArvoreDaPasta(pasta: string): number {
  try {
    const todos = listarProcessos();
    const raizes = todos.filter((p) => p.pid !== process.pid && p.comando.includes(pasta));
    return matar(descendentes(todos, raizes));
  } catch { return 0; }
}

// AUD-01: SOMENTE diretórios temporários que os PRÓPRIOS testes criam. Nunca o prefixo de socket/pasta do
// daemon real do app (isso mataria o daemon — e as sessões — de um app em uso, ex.: o `npm run dev` do dono).
export const PREFIXOS_TMP = ["ade-e2e-", "ade-dom-"] as const;
export const PADRAO_FIXTURES = /ExpxDev\/tests\/fixtures\/cli-(pty|orq|mcp|interativa)/;

export function matarOrfaos(idadeMinimaSeg = 600): number {
  try {
    const todos = listarProcessos();
    const tmp = tmpdir();
    const alvos = todos.filter((p) => p.pid !== process.pid && p.idadeSeg >= idadeMinimaSeg
      && (PREFIXOS_TMP.some((pre) => p.comando.includes(`${tmp}/${pre}`) || p.comando.includes(`/T/${pre}`))
        || PADRAO_FIXTURES.test(p.comando)));
    return matar(descendentes(todos, alvos));
  } catch { return 0; }
}

// ---- registro por execução: o fim da suíte mata as árvores das pastas usadas por ESTA execução ----
const arquivoRegistro = (): string | null => {
  const id = process.env["ADE_RUN_ID"];
  return id === undefined ? null : join(tmpdir(), `ade-registro-${id}.txt`);
};

export function registrarPasta(pasta: string): void {
  const arq = arquivoRegistro();
  if (arq !== null) {
    try { appendFileSync(arq, `${pasta}\n`); } catch { /* sem registro, vale a limpeza de órfãos */ }
  }
}

export function limparPastasRegistradas(id: string): number {
  const arq = join(tmpdir(), `ade-registro-${id}.txt`);
  if (!existsSync(arq)) return 0;
  let n = 0;
  const pastas = new Set(readFileSync(arq, "utf8").split("\n").filter((l) => l !== ""));
  for (const pasta of pastas) n += matarArvoreDaPasta(pasta);
  rmSync(arq, { force: true });
  return n;
}
