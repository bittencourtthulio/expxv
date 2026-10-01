import { watch as watchReal } from "node:fs";
import type { FSWatcher } from "node:fs";

/**
 * Recarga automática do renderer em modo dev: quando o `vite build --watch` regrava arquivos em
 * `dist/renderer`, a janela recarrega (com debounce). Só é ligada com a variável DEV do produto e
 * app não empacotado (ver main.ts). As sessões de terminal sobrevivem (daemon) e são recuperadas.
 */

export interface OpcoesRecargaDev {
  /** pasta observada (dist/renderer). */
  pasta: string;
  recarregar: () => void;
  debounceMs?: number;
  watch?: (pasta: string, opcoes: { recursive: boolean }, cb: (evento: string, arquivo: string | null) => void) => Pick<FSWatcher, "close">;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
}

/** Ignora o que não muda a página (mapas de depuração, temporários do vite). */
export function mudancaRelevanteRenderer(arquivo: string | null): boolean {
  if (arquivo === null) return true;
  return !/\.map$|\.tmp$|~$/.test(arquivo);
}

export function ligarRecargaDev(op: OpcoesRecargaDev): () => void {
  const agendar = op.agendar ?? ((fn, ms) => setTimeout(fn, ms));
  const cancelar = op.cancelar ?? ((id) => clearTimeout(id as NodeJS.Timeout));
  let pendente: unknown = null;
  const vigia = (op.watch ?? ((p, o, cb) => watchReal(p, o, cb)))(op.pasta, { recursive: true }, (_evento, arquivo) => {
    if (!mudancaRelevanteRenderer(arquivo)) return;
    if (pendente !== null) cancelar(pendente);
    pendente = agendar(() => {
      pendente = null;
      op.recarregar();
    }, op.debounceMs ?? 150);
  });
  return () => {
    if (pendente !== null) cancelar(pendente);
    pendente = null;
    vigia.close();
  };
}
