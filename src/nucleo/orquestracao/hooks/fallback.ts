/**
 * Fallback para CLIs sem hook (T-03.04): o prompt inicial vai por argv e este vigia de ociosidade
 * reenvia UM lembrete de handoff. Só age quando passou o `handoff_timeout` desde o início E o Pane
 * está ocioso há tempo suficiente E, numa checagem feita na hora, ainda não há handoff registrado
 * (nunca por falso negativo). Depois de lembrar, nunca lembra de novo.
 */
import type { EstadoPane } from "../../dominio";
import { relogioReal, type PortaRelogio } from "../../mcp/portas";

/** `handoff_timeout` é [LAC] nas specs: padrão conservador de 5 minutos. */
export const HANDOFF_TIMEOUT_PADRAO_MS = 5 * 60 * 1000;
export const OCIOSIDADE_MINIMA_PADRAO_MS = 15 * 1000;

export const MENSAGEM_LEMBRETE =
  "Lembrete: você ainda não chamou handoff_submit. Grave o relatório e chame handoff_submit com o resumo do trabalho (status ok, partial, blocked ou failed) antes de encerrar.";

export interface DepsVigia {
  relogio?: PortaRelogio;
  /** checagem fresca no banco: o Pane já registrou handoff? */
  handoffRegistrado(pane_id: string): Promise<boolean>;
  /** digita o lembrete no Pane; false = não aceitou */
  enviarLembrete(pane_id: string, texto: string): Promise<boolean>;
  handoffTimeoutMs?: number;
  ociosidadeMinimaMs?: number;
  emitir?(tipo: string, payload: unknown): void;
}

export interface VigiaFallback {
  iniciar(pane_id: string): void;
  aoMudarEstado(pane_id: string, estado: EstadoPane): void;
  avaliar(pane_id?: string): Promise<void>;
  parar(pane_id: string): void;
  lembretesEnviados(pane_id: string): number;
  /** Avalia periodicamente; devolve a função que cancela. */
  iniciarSondagem(intervaloMs: number): () => void;
}

interface Acompanhamento {
  iniciado_em: number;
  ocioso_desde: number | null;
  lembrou: boolean;
  avaliando: boolean;
  enviados: number;
}

export function criarVigiaFallback(deps: DepsVigia): VigiaFallback {
  const relogio = deps.relogio ?? relogioReal;
  const timeout = deps.handoffTimeoutMs ?? HANDOFF_TIMEOUT_PADRAO_MS;
  const ocioso = deps.ociosidadeMinimaMs ?? OCIOSIDADE_MINIMA_PADRAO_MS;
  const panes = new Map<string, Acompanhamento>();

  async function avaliarUm(pane_id: string): Promise<void> {
    const a = panes.get(pane_id);
    if (a === undefined || a.lembrou || a.avaliando) return;
    const agora = relogio.agora();
    if (agora - a.iniciado_em < timeout) return;
    if (a.ocioso_desde === null || agora - a.ocioso_desde < ocioso) return;
    a.avaliando = true;
    try {
      if (await deps.handoffRegistrado(pane_id)) {
        panes.delete(pane_id); // entregou: nada a lembrar
        return;
      }
      let aceito = false;
      try {
        aceito = await deps.enviarLembrete(pane_id, MENSAGEM_LEMBRETE);
      } catch {
        aceito = false;
      }
      if (aceito) {
        a.lembrou = true;
        a.enviados += 1;
        deps.emitir?.("handoff.reminder_sent", { pane_id });
      }
    } finally {
      a.avaliando = false;
    }
  }

  return {
    iniciar(pane_id) {
      panes.set(pane_id, { iniciado_em: relogio.agora(), ocioso_desde: null, lembrou: false, avaliando: false, enviados: 0 });
    },
    aoMudarEstado(pane_id, estado) {
      const a = panes.get(pane_id);
      if (a === undefined) return;
      if (estado === "encerrado") {
        panes.delete(pane_id);
        return;
      }
      if (estado === "pronto") a.ocioso_desde ??= relogio.agora();
      else a.ocioso_desde = null;
    },
    async avaliar(pane_id) {
      if (pane_id !== undefined) return avaliarUm(pane_id);
      await Promise.all([...panes.keys()].map((p) => avaliarUm(p)));
    },
    parar(pane_id) {
      panes.delete(pane_id);
    },
    lembretesEnviados: (pane_id) => panes.get(pane_id)?.enviados ?? 0,
    iniciarSondagem(intervaloMs) {
      const t = setInterval(() => void this.avaliar().catch(() => undefined), intervaloMs);
      t.unref();
      return () => clearInterval(t);
    },
  };
}
