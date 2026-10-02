// Lista de processos do SO para o popover (SÓ com ele aberto). Pede ao SO apenas pid, ppid, memória, CPU e o NOME do executável
// (`comm`): a coluna de argumentos (`args`/`command`/`CommandLine`) NUNCA é pedida, então não há linha de comando para vazar; e
// mesmo o nome passa por `nomeBase` (sem caminho, sem controle, ≤ 40 caracteres). Argumentos fixos, sem shell.
import type { OrigemProcesso, ProcessoVisto, SessaoVista } from "../../compartilhado/sistema";

export interface ProcessoSO { pid: number; ppid: number; rssKb: number; cpu: number; nome: string }

/** macOS/Linux: `ps -axo pid=,ppid=,rss=,pcpu=,comm=` (sem cabeçalho). */
export const ARGUMENTOS_PS: readonly string[] = ["-axo", "pid=,ppid=,rss=,pcpu=,comm="];
/** Windows: só ProcessId, ParentProcessId, WorkingSetSize, tempo de CPU e Name (nunca CommandLine). */
export const ARGUMENTOS_POWERSHELL: readonly string[] = [
  "-NoProfile", "-NonInteractive", "-NoLogo", "-Command",
  "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1},{2},{3},{4}' -f $_.ProcessId,$_.ParentProcessId,$_.WorkingSetSize,($_.KernelModeTime+$_.UserModeTime),$_.Name }",
];

/** Só o nome-base do executável: sem diretórios (`/` ou `\`), sem controle, sem `.exe`, no máximo 40 caracteres. */
export function nomeBase(bruto: string): string {
  // eslint-disable-next-line no-control-regex
  const limpo = bruto.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  // defesa em profundidade: o `comm` do SO não traz argumentos, mas se uma linha trouxer (`tool --token=x`, `tool KEY=v`), eles são cortados
  const semArgs = limpo.replace(/\s+-{1,2}[^\s].*$/, "").replace(/\s+[^\s/\\]*=.*$/, "");
  const base = semArgs.split(/[\\/]/).pop() ?? "";
  const semExe = base.replace(/\.exe$/i, "");
  return (semExe === "" ? "?" : semExe).slice(0, 40);
}

const numero = (s: string): number => { const n = Number(s.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : 0; };

export function parsearPs(texto: string): ProcessoSO[] {
  const r: ProcessoSO[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(.+?)\s*$/.exec(linha);
    if (m === null) continue;
    r.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), cpu: numero(m[4]!), nome: nomeBase(m[5]!) });
  }
  return r;
}

export interface ProcessoWindows { pid: number; ppid: number; memBytes: number; tempo100ns: number; nome: string }

export function parsearListaWindows(texto: string): ProcessoWindows[] {
  const r: ProcessoWindows[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*(\d+),(\d+),(\d*),(\d*),(.+?)\s*$/.exec(linha);
    if (m !== null) r.push({ pid: Number(m[1]), ppid: Number(m[2]), memBytes: Number(m[3] || 0), tempo100ns: Number(m[4] || 0), nome: nomeBase(m[5]!) });
  }
  return r;
}

/** CPU% (de um núcleo) por delta do tempo acumulado do processo (100 ns) entre duas listagens. Primeira listagem = 0. */
export function converterCpuWindows(anterior: ReadonlyMap<number, number> | null, atual: readonly ProcessoWindows[], dtMs: number): ProcessoSO[] {
  return atual.map((p) => {
    const antes = anterior?.get(p.pid);
    const cpu = antes === undefined || dtMs <= 0 || p.tempo100ns < antes ? 0 : ((p.tempo100ns - antes) / (dtMs * 10_000)) * 100;
    return { pid: p.pid, ppid: p.ppid, rssKb: Math.round(p.memBytes / 1024), cpu, nome: p.nome };
  });
}

/** raízes + todos os descendentes (por ppid), sem laço mesmo com ppid cíclico. */
export function arvoreDe(lista: readonly ProcessoSO[], raizes: readonly number[]): Map<number, number> {
  const filhos = new Map<number, number[]>();
  for (const p of lista) { const l = filhos.get(p.ppid); if (l === undefined) filhos.set(p.ppid, [p.pid]); else l.push(p.pid); }
  const dono = new Map<number, number>();
  for (const raiz of raizes) {
    const pilha = [raiz];
    while (pilha.length > 0) {
      const pid = pilha.pop()!;
      if (dono.has(pid)) continue;
      dono.set(pid, raiz);
      for (const f of filhos.get(pid) ?? []) pilha.push(f);
    }
  }
  return dono;
}

const MB = 1024;
const ordenar = <T,>(l: T[], chave: (x: T) => number): T[] => l.sort((a, b) => chave(b) - chave(a));

export interface SessaoEntrada { rotulo: string; pid: number }

export interface ResumoAgentes {
  agentes: { cpu: number; mem_mb: number; sessoes: SessaoVista[] };
  processos: ProcessoVisto[];
  /** pid do pai das raízes (o daemon de PTY) quando não é o app nem o init; senão nulo. */
  paiComum: number | null;
}

/** Agrega as árvores das sessões de terminal (CLIs de IA) por sessão. */
export function resumirAgentes(lista: readonly ProcessoSO[], sessoes: readonly SessaoEntrada[]): ResumoAgentes {
  const dono = arvoreDe(lista, sessoes.filter((s) => s.pid > 0).map((s) => s.pid));
  const rotuloDe = new Map(sessoes.map((s) => [s.pid, s.rotulo]));
  const porSessao = new Map<number, SessaoVista>();
  const processos: ProcessoVisto[] = [];
  for (const p of lista) {
    const raiz = dono.get(p.pid);
    if (raiz === undefined) continue;
    const rotulo = rotuloDe.get(raiz) ?? "sessão";
    const s = porSessao.get(raiz) ?? { rotulo, processos: 0, cpu: 0, mem_mb: 0 };
    s.processos += 1; s.cpu += p.cpu; s.mem_mb += p.rssKb / MB;
    porSessao.set(raiz, s);
    processos.push({ nome: p.nome, origem: "agente" as OrigemProcesso, sessao: rotulo, cpu: Math.round(p.cpu), mem_mb: Math.round(p.rssKb / MB) });
  }
  const sessoesVistas = ordenar([...porSessao.values()].map((s) => ({ rotulo: s.rotulo, processos: s.processos, cpu: Math.round(s.cpu), mem_mb: Math.round(s.mem_mb) })), (s) => s.cpu);
  const cpu = sessoesVistas.reduce((a, s) => a + s.cpu, 0);
  const mem = sessoesVistas.reduce((a, s) => a + s.mem_mb, 0);
  const pais = new Set(sessoes.map((s) => lista.find((p) => p.pid === s.pid)?.ppid).filter((x): x is number => x !== undefined));
  return { agentes: { cpu, mem_mb: mem, sessoes: sessoesVistas }, processos, paiComum: pais.size === 1 ? [...pais][0]! : null };
}

export const topPor = (l: readonly ProcessoVisto[], campo: "cpu" | "mem_mb", n = 5): ProcessoVisto[] => ordenar([...l], (p) => p[campo]).slice(0, n);
