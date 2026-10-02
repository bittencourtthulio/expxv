// Contrato `AdaptadorHeadless` (T-12.08): como UMA CLI roda uma tarefa sem pedir nada à pessoa. Todas as flags de uma CLI vivem em UM arquivo (as reais são [LAC]: confirmadas em runtime por
// `verificarFlags` contra o `--help` e na pendência P-37). O esforço NUNCA entra no texto do prompt: vai como flag/env. Prompt por stdin quando a CLI aceita (não aparece em `ps`).
// Nunca o bypass total de sandbox do Codex (D-14).
import { spawn } from "node:child_process";
import type { UsoMedido } from "../precos";
import type { CliBench } from "../tipos";

export interface CapacidadesAdaptador {
  esforco: "flag" | "env" | "nenhum";
  /** `externo`: o Bench envolve com sandbox-exec; `nativo`: a própria CLI isola (não se aninha). */
  sandbox: "externo" | "nativo";
  sem_mcp: boolean;
  sem_skills: boolean;
  harness_zero: "garantido" | "parcial";
}
export interface PedidoMontagem {
  modelo: string | null;
  esforco: string | null;
  /** pasta de trabalho (execução) ou pasta do pacote cego (juiz). */
  workdir: string;
  prompt: string;
  /** juiz: sem escrita, sem aprovação automática, só leitura. */
  somente_leitura?: boolean;
}
export interface ComandoAdaptador { executavel: string; args: string[]; stdin: string | null }
export type UsoInterpretado = UsoMedido & { turnos: number | null };

export interface AdaptadorHeadless {
  readonly cli: CliBench;
  readonly executavel: string;
  readonly capacidades: CapacidadesAdaptador;
  /** flags que ESTE adaptador pretende usar (conferidas no `--help`). */
  readonly flagsExigidas: readonly string[];
  /** variável que aponta a CLI para a pasta de config da conta dedicada. */
  readonly variavelConfig: string;
  esforcoValido(esforco: string | null): boolean;
  montar(p: PedidoMontagem, executavel?: string): ComandoAdaptador;
  /** tolerante: saída truncada ou inesperada NUNCA lança (devolve tudo `null`). */
  interpretarUso(saida: string): UsoInterpretado;
  /** texto da resposta do modelo (juiz): tolerante, `""` quando não acha. */
  extrairTexto(saida: string): string;
  /** o adaptador pretende o modo de sandbox pedido? (Codex: `workspace-write` da CLI.) */
  flagsSandboxDaCli?(somenteLeitura: boolean): readonly string[];
}

export const SEGURO = /^[A-Za-z0-9._:/@+-]{1,80}$/;
export const USO_VAZIO: UsoInterpretado = { tokens_in: null, tokens_out: null, tokens_cache: null, custo_relatado_usd: null, turnos: null };

export interface ResultadoVerificacao { ok: boolean; faltam: string[]; motivo: string | null }

/** Confere se a ajuda cita cada flag que o adaptador usa. Flag ausente → alvo `indisponivel` com o motivo. */
export function verificarFlags(a: AdaptadorHeadless, ajuda: string): ResultadoVerificacao {
  // fronteira de token: `-s` não pode casar dentro de `--skip-git-repo-check`
  const cita = (f: string): boolean => new RegExp(`(?:^|[\\s,|\\[(])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9-])`, "m").test(ajuda);
  const faltam = a.flagsExigidas.filter((f) => !cita(f));
  return faltam.length === 0 ? { ok: true, faltam: [], motivo: null } : { ok: false, faltam, motivo: `a CLI não oferece: ${faltam.join(", ")}` };
}

/** Roda `<exe> --help` com timeout (5 s) e teto de saída; nunca lança (erro → texto vazio). Ambiente mínimo recebido do chamador. */
export function lerAjudaDaCli(exe: string, env: Record<string, string>, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    let saida = "";
    let fim = false;
    const terminar = (): void => { if (!fim) { fim = true; resolve(saida); } };
    try {
      const f = spawn(exe, ["--help"], { env, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
      const t = setTimeout(() => { try { f.kill("SIGKILL"); } catch { /* já saiu */ } terminar(); }, timeoutMs);
      const coletar = (d: Buffer): void => { if (saida.length < 200_000) saida += d.toString("utf8"); };
      f.stdout.on("data", coletar);
      f.stderr.on("data", coletar);
      f.on("error", () => { clearTimeout(t); terminar(); });
      f.on("close", () => { clearTimeout(t); terminar(); });
    } catch { terminar(); }
  });
}

/** Varre as linhas JSON da saída (da última para a primeira) e devolve o primeiro objeto aceito por `escolher`. */
export function ultimoObjetoJson<T>(saida: string, escolher: (o: Record<string, unknown>) => T | null): T | null {
  const linhas = saida.split(/\r?\n/);
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = (linhas[i] as string).trim();
    if (l === "" || l[0] !== "{") continue;
    try {
      const o = JSON.parse(l) as unknown;
      if (typeof o === "object" && o !== null && !Array.isArray(o)) {
        const r = escolher(o as Record<string, unknown>);
        if (r !== null) return r;
      }
    } catch { /* linha truncada: segue */ }
  }
  // saída `--output-format json` pode vir indentada em várias linhas
  const ini = saida.indexOf("{");
  if (ini >= 0) {
    try {
      const o = JSON.parse(saida.slice(ini)) as unknown;
      if (typeof o === "object" && o !== null && !Array.isArray(o)) return escolher(o as Record<string, unknown>);
    } catch { /* truncado */ }
  }
  return null;
}

export const numero = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
