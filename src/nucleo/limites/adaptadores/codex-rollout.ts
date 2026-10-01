// T-09.05 · Adaptador Codex: último `rate_limits` do evento `token_count` nos rollouts que a própria CLI grava em
// `<CODEX_HOME da conta>/sessions/AAAA/MM/DD/rollout-*.jsonl`. Lê SÓ o final (64 KB) dos 3 rollouts mais recentes.
// Nunca lê `auth.json` nem nada fora de `sessions/`. Formato (a verificar na CLI instalada; contrato por fixture):
//   {"timestamp":"…","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":45.0,"window_minutes":10080,"resets_at":<epoch s>},"secondary":null,…}}}
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LimitSnapshot } from "../../../compartilhado/limites";
import { normalizarSnapshot } from "../validar";
import { atendeProvedor, INTERVALO_PADRAO_S, type AdaptadorLimite, type ContaLimite, type ContextoLeitura } from "./adaptador";

export const BYTES_FINAL_ROLLOUT = 64 * 1024;
export const ROLLOUTS_LIDOS = 3;
const MAX_DIRETORIOS = 40;
const NOME_ROLLOUT = /^rollout-.+\.jsonl$/;

const ordemDesc = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);

async function listar(dir: string): Promise<{ dirs: string[]; arquivos: string[] }> {
  try {
    const entradas = await readdir(dir, { withFileTypes: true });
    return {
      dirs: entradas.filter((e) => e.isDirectory() && /^\d{1,4}$/.test(e.name)).map((e) => e.name).sort(ordemDesc),
      arquivos: entradas.filter((e) => e.isFile() && NOME_ROLLOUT.test(e.name)).map((e) => e.name).sort(ordemDesc),
    };
  } catch {
    return { dirs: [], arquivos: [] };
  }
}

/** Os `n` rollouts mais recentes, percorrendo ano/mês/dia em ordem decrescente e parando cedo. */
export async function rolloutsRecentes(raizSessions: string, n: number = ROLLOUTS_LIDOS, sinal?: AbortSignal): Promise<string[]> {
  const achados: string[] = [];
  let lidos = 0;
  const descer = async (dir: string, nivel: number): Promise<void> => {
    if (achados.length >= n || lidos >= MAX_DIRETORIOS || sinal?.aborted === true) return;
    lidos++;
    const { dirs, arquivos } = await listar(dir);
    for (const a of arquivos) {
      if (achados.length >= n) return;
      achados.push(join(dir, a));
    }
    if (nivel >= 3) return;
    for (const d of dirs) {
      if (achados.length >= n) return;
      await descer(join(dir, d), nivel + 1);
    }
  };
  await descer(raizSessions, 0);
  return achados;
}

/** Final do arquivo (≤ `bytes`), sem a primeira linha se ela estiver cortada. */
export async function lerFinal(caminho: string, bytes: number = BYTES_FINAL_ROLLOUT): Promise<string | null> {
  let h;
  try {
    h = await open(caminho, "r");
    const { size } = await h.stat();
    if (size === 0) return null;
    const inicio = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - inicio);
    const { bytesRead } = await h.read(buf, 0, buf.length, inicio);
    let texto = buf.subarray(0, bytesRead).toString("utf8");
    if (inicio > 0) {
      const nl = texto.indexOf("\n");
      texto = nl === -1 ? "" : texto.slice(nl + 1);
    }
    return texto;
  } catch {
    return null;
  } finally {
    await h?.close().catch(() => undefined);
  }
}

export interface RateLimitsDoRollout {
  rate_limits: unknown;
  /** ISO do evento (quando o dado foi observado). */
  ts: string | null;
}

/** Último `token_count` com `rate_limits` do texto (linha final truncada/lixo é ignorada). */
export function ultimoRateLimits(texto: string): RateLimitsDoRollout | null {
  const linhas = texto.split("\n");
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = linhas[i] as string;
    if (l.length < 20 || !l.includes("rate_limits")) continue;
    try {
      const o = JSON.parse(l) as { timestamp?: unknown; payload?: { type?: unknown; rate_limits?: unknown } };
      const p = o.payload;
      if (p?.type === "token_count" && typeof p.rate_limits === "object" && p.rate_limits !== null) {
        return { rate_limits: p.rate_limits, ts: typeof o.timestamp === "string" ? o.timestamp : null };
      }
    } catch {
      /* linha truncada ou lixo */
    }
  }
  return null;
}

export function criarAdaptadorCodexRollout(): AdaptadorLimite {
  return {
    id: "codex_rollout",
    fonte: "codex_rollout",
    provedores: ["codex"],
    intervalo_min_s: INTERVALO_PADRAO_S,
    rede: false,
    aplicavel(conta) {
      return atendeProvedor(this, conta) && conta.config_dir !== null;
    },
    async ler(conta: ContaLimite, ctx: ContextoLeitura): Promise<LimitSnapshot | null> {
      if (conta.config_dir === null) return null;
      const arquivos = await rolloutsRecentes(join(conta.config_dir, "sessions"), ROLLOUTS_LIDOS, ctx.sinal);
      let melhor: RateLimitsDoRollout | null = null;
      for (const a of arquivos) {
        if (ctx.sinal.aborted) break;
        const texto = await lerFinal(a);
        if (texto === null) continue;
        const r = ultimoRateLimits(texto);
        if (r === null) continue;
        if (melhor === null || (r.ts ?? "") > (melhor.ts ?? "")) melhor = r;
      }
      if (melhor === null) return null;
      const s = normalizarSnapshot({ rate_limits: melhor.rate_limits, ...(melhor.ts !== null ? { timestamp: melhor.ts } : {}) }, { id: conta.id, provedor: conta.provedor }, { agora: ctx.agora, fonte: "codex_rollout" });
      return s.status === "ok" ? s : null;
    },
  };
}
