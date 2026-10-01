// T-09.06 · Adaptador Claude: lê o arquivo `{v:1, recebido_em, rate_limits, model}` que o script de statusline do
// Pane grava em `<userData>/limites/claude/<conta_id>.json` (0600, atômico). Só esse arquivo; nenhum outro caminho.
// Mapeia `five_hour`, `seven_day`→weekly e `seven_day_<familia>`→`model_buckets[<familia>]` (formato a verificar).
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { LimitSnapshot } from "../../../compartilhado/limites";
import { normalizarSnapshot } from "../validar";
import { atendeProvedor, INTERVALO_PADRAO_S, type AdaptadorLimite, type ContaLimite, type ContextoLeitura } from "./adaptador";

export const TAMANHO_MAX_STATUSLINE = 64 * 1024;
const ID_CONTA = /^[A-Za-z0-9_-]{1,80}$/;

/** `<pastaDeDados>/limites/claude/<conta_id>.json`; id fora do padrão → null (sem path traversal). */
export function caminhoStatusline(pastaDeDados: string, contaId: string): string | null {
  return ID_CONTA.test(contaId) ? join(pastaDeDados, "limites", "claude", `${contaId}.json`) : null;
}

async function lerPequeno(caminho: string): Promise<string | null> {
  let h;
  try {
    h = await open(caminho, "r");
    const { size } = await h.stat();
    if (size === 0 || size > TAMANHO_MAX_STATUSLINE) return null;
    const buf = Buffer.alloc(size);
    const { bytesRead } = await h.read(buf, 0, size, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null; // sem arquivo = sem dado, não erro
  } finally {
    await h?.close().catch(() => undefined);
  }
}

export function criarAdaptadorClaudeStatusline(opcoes: { pastaDeDados: string; habilitado?: () => boolean }): AdaptadorLimite {
  return {
    id: "claude_statusline",
    fonte: "claude_statusline",
    provedores: ["claude"],
    intervalo_min_s: INTERVALO_PADRAO_S,
    rede: false,
    aplicavel(conta) {
      return atendeProvedor(this, conta) && (opcoes.habilitado?.() ?? true) && caminhoStatusline(opcoes.pastaDeDados, conta.id) !== null;
    },
    async ler(conta: ContaLimite, ctx: ContextoLeitura): Promise<LimitSnapshot | null> {
      const caminho = caminhoStatusline(opcoes.pastaDeDados, conta.id);
      if (caminho === null) return null;
      const texto = await lerPequeno(caminho);
      if (texto === null) return null;
      let obj: unknown;
      try {
        obj = JSON.parse(texto);
      } catch {
        return null; // arquivo corrompido: ignora (o próximo Pane reescreve)
      }
      if (typeof obj !== "object" || obj === null) return null;
      const o = obj as { rate_limits?: unknown; recebido_em?: unknown };
      if (typeof o.rate_limits !== "object" || o.rate_limits === null) return null;
      const s = normalizarSnapshot({ rate_limits: o.rate_limits, recebido_em: o.recebido_em }, { id: conta.id, provedor: conta.provedor }, { agora: ctx.agora, fonte: "claude_statusline" });
      return s.status === "ok" ? s : null;
    },
  };
}
