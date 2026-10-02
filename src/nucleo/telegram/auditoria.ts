// Auditoria completa (T-20.31): quem (`user_id`), o quê (resumo REDIGIDO), plano, `args_hash`, aprovação e resultado. Nunca segredo, nunca texto
// integral. Cada passo do fluxo grava EXATAMENTE 1 linha. Agregado `nao_autorizado_resumo` por hora. Export CSV só por ação explícita do usuário.
import { randomBytes } from "node:crypto";
import { redigirParaCanal, truncarVisivel } from "../alertas/texto";
import type { RelogioTg } from "./portas";
import type { AuditoriaRow, RepoTelegram } from "./repo";

export const EVENTOS_AUDITORIA = [
  "pareamento_aberto",
  "pareamento_pedido",
  "pareamento_negado",
  "pareamento_concluido",
  "pedido_recebido",
  "plano_enviado",
  "aprovado",
  "cancelado",
  "bloqueado",
  "execucao_iniciada",
  "concluida",
  "falhou",
  "revogado",
  "panico",
  "conflito",
  "token_invalido",
  "nao_autorizado_resumo",
  "expirado",
  "edicao",
  "parada_solicitada",
] as const;
export type EventoAuditoria = (typeof EVENTOS_AUDITORIA)[number];

export interface CamposAuditoria {
  user_id?: number | null;
  workspace_id?: string | null;
  plano_id?: string | null;
  mensagem_entrada_id?: string | null;
  args_hash?: string | null;
  resultado?: string | null;
  /** valores string são redigidos e cortados em 160; objetos aninhados são descartados. */
  detalhe?: Record<string, string | number | boolean | null | undefined>;
}

export interface Auditoria {
  registrar(evento: EventoAuditoria, c?: CamposAuditoria): AuditoriaRow;
  listar(depois_ts: string | null, limite: number): { itens: AuditoriaRow[]; proximo: string | null };
  /** agrega os não autorizados da última hora numa linha (sem texto). */
  resumoNaoAutorizados(): AuditoriaRow | null;
  exportarCsv(linhas: AuditoriaRow[]): string;
}

export interface DepsAuditoria {
  repo: RepoTelegram;
  canal_id: string;
  relogio: RelogioTg;
  scrub?: (t: string) => string;
  novoId?: () => string;
}

const COLUNAS = ["ts", "evento", "user_id", "workspace_id", "plano_id", "mensagem_entrada_id", "args_hash", "resultado", "detalhe"] as const;
/** neutraliza injeção de fórmula em planilhas e escapa aspas/quebras. */
export function celulaCsv(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function criarAuditoria(deps: DepsAuditoria): Auditoria {
  const novoId = deps.novoId ?? ((): string => `aud_${randomBytes(9).toString("base64url")}`);
  const iso = (): string => new Date(deps.relogio.agora()).toISOString();
  let ultimoResumo = deps.relogio.agora();
  let contagemAnterior = 0;

  const limpar = (d: CamposAuditoria["detalhe"]): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d ?? {})) {
      if (typeof v === "string") o[k] = truncarVisivel(redigirParaCanal(v, deps.scrub === undefined ? {} : { scrub: deps.scrub }), 160);
      else if (typeof v === "number" || typeof v === "boolean" || v === null) o[k] = v;
    }
    return o;
  };

  return {
    registrar(evento, c = {}) {
      const r: AuditoriaRow = {
        id: novoId(),
        ts: iso(),
        canal_id: deps.canal_id,
        evento,
        user_id: c.user_id ?? null,
        workspace_id: c.workspace_id ?? null,
        plano_id: c.plano_id ?? null,
        mensagem_entrada_id: c.mensagem_entrada_id ?? null,
        args_hash: c.args_hash ?? null,
        resultado: c.resultado === undefined || c.resultado === null ? null : truncarVisivel(redigirParaCanal(c.resultado, deps.scrub === undefined ? {} : { scrub: deps.scrub }), 120),
        detalhe: limpar(c.detalhe),
      };
      deps.repo.inserirAuditoria(r);
      return r;
    },
    listar(depois, limite) {
      const n = Math.min(Math.max(limite, 1), 100);
      const itens = deps.repo.listarAuditoria(deps.canal_id, depois, n + 1);
      const pagina = itens.slice(0, n);
      return { itens: pagina, proximo: itens.length > n ? ((pagina[pagina.length - 1] as AuditoriaRow).ts) : null };
    },
    resumoNaoAutorizados() {
      const t = deps.relogio.agora();
      if (t - ultimoResumo < 3_600_000) return null;
      ultimoResumo = t;
      const total = deps.repo.listarNaoAutorizados().reduce((n, x) => n + x.contagem, 0);
      const novos = total - contagemAnterior;
      contagemAnterior = total;
      if (novos <= 0) return null;
      return this.registrar("nao_autorizado_resumo", { resultado: `${novos} tentativas na última hora`, detalhe: { tentativas: novos } });
    },
    exportarCsv(linhas) {
      const corpo = linhas.map((l) => COLUNAS.map((c) => celulaCsv(c === "detalhe" ? l.detalhe : (l as unknown as Record<string, unknown>)[c])).join(","));
      return [COLUNAS.join(","), ...corpo].join("\n") + "\n";
    },
  };
}

/** o destino do export NÃO pode ficar dentro de `docs/**` (D-04): confere por segmento de caminho. */
export function destinoDeExportPermitido(caminho: string): boolean {
  const seg = caminho.replace(/\\/g, "/").split("/");
  return caminho !== "" && !seg.includes("docs") && !seg.includes("..");
}
