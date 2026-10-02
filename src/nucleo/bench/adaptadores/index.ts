import type { CliBench } from "../tipos";
import type { AdaptadorHeadless } from "./adaptador";
import { criarAdaptadorClaude } from "./claude";
import { criarAdaptadorCodex } from "./codex";

export type { AdaptadorHeadless } from "./adaptador";
export { verificarFlags, lerAjudaDaCli } from "./adaptador";

/** Adaptadores existentes; Gemini/OpenCode ficam `nao_suportado` até haver adaptador. */
export function adaptadorDaCli(cli: string): AdaptadorHeadless | null {
  return cli === "claude" ? criarAdaptadorClaude() : cli === "codex" ? criarAdaptadorCodex() : null;
}
export const CLIS_SUPORTADAS: readonly CliBench[] = ["claude", "codex"];
