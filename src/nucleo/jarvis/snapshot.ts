// Síntese de situação (T-13.05, PURA): por painel `{display_id, label, estado, ultima_mensagem ≤ 300, pergunta_pendente, atualizado_em}`, no máximo 10 painéis
// (os que aguardam primeiro), sem cauda bruta, sem ANSI/OSC/controle, com segredo redigido. Tudo o que vem de terminal é `nao_confiavel`: só é MOSTRADO como texto,
// nunca interpretado como comando nem como "sim".
import { redigirParaCanal, sanitizar, truncarVisivel } from "../alertas/texto";

export const PANES_MAX = 10;
export const MENSAGEM_MAX = 300;

export interface LinhaPane {
  pane_id: string;
  display_id: string;
  label: string;
  estado: "aguardando" | "trabalhando" | "ocioso" | "bloqueado" | "encerrado" | string;
  ultima_mensagem: string | null;
  pergunta_pendente: string | null;
  atualizado_em: string;
}
export interface PaineSintese {
  display_id: string;
  label: string;
  estado: string;
  last_message: string;
  pending_question: string | null;
  updated_at: string;
  untrusted: true;
}

export function limparTexto(t: string | null | undefined, max: number, scrub?: (x: string) => string): string {
  if (t === null || t === undefined) return "";
  const base = sanitizar(t.length > max * 8 ? t.slice(-max * 8) : t).replace(/\s+/g, " ").trim();
  return truncarVisivel(redigirParaCanal(base, { max, ...(scrub === undefined ? {} : { scrub }) }), max);
}

const PESO: Record<string, number> = { aguardando: 0, bloqueado: 1, trabalhando: 2, ocioso: 3 };

export function montarSnapshot(panes: readonly LinhaPane[], op: { max?: number; scrub?: (x: string) => string } = {}): PaineSintese[] {
  const max = Math.min(op.max ?? PANES_MAX, PANES_MAX);
  return [...panes]
    .filter((p) => p.estado !== "encerrado")
    .sort((a, b) => (PESO[a.estado] ?? 9) - (PESO[b.estado] ?? 9) || b.atualizado_em.localeCompare(a.atualizado_em))
    .slice(0, max)
    .map((p) => ({
      display_id: limparTexto(p.display_id, 12, op.scrub),
      label: limparTexto(p.label, 60, op.scrub),
      estado: limparTexto(p.estado, 20),
      last_message: limparTexto(p.ultima_mensagem, MENSAGEM_MAX, op.scrub),
      pending_question: p.estado === "aguardando" && p.pergunta_pendente !== null ? limparTexto(p.pergunta_pendente, MENSAGEM_MAX, op.scrub) : null,
      updated_at: p.atualizado_em,
      untrusted: true as const,
    }));
}

/** diferença entre dois snapshots (só o que mudou), para não reenviar contexto inteiro. */
export function diferencaSnapshot(antes: readonly PaineSintese[], depois: readonly PaineSintese[]): PaineSintese[] {
  const a = new Map(antes.map((p) => [p.display_id, JSON.stringify([p.estado, p.last_message, p.pending_question])]));
  return depois.filter((p) => a.get(p.display_id) !== JSON.stringify([p.estado, p.last_message, p.pending_question]));
}
