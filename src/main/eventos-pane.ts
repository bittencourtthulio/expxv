// Ponte sessão → barramento (Fase 9, T-09.20): publica `pane.state_changed {pane_id, estado}` e `pane.closed {pane_id, reason}` para quem
// decide por consumo (troca) e para o checkpoint por turno. Não muda nada no banco: só LÊ o estado que o serviço de Panes já gravou
// (por isso assina DEPOIS de `ServicoPanes.ligar()`) e publica quando o estado de fato muda. Barato: um Map e uma leitura por evento.
import type { EventoTerminal } from "../compartilhado/terminais";
import type { Pane } from "../nucleo/dominio/tipos";
import type { Barramento } from "./barramento";

export interface DepsEventosPane {
  sessoes: { assinar(fn: (evento: EventoTerminal) => void): () => void };
  /** Pane da sessão (qualquer estado; o mais recente). */
  paneDaSessao(sessaoId: string): string | null;
  obterPane(paneId: string): Pane | undefined;
  barramento: Pick<Barramento, "emitir">;
}

export function ligarEventosDePane(d: DepsEventosPane): () => void {
  const ultimo = new Map<string, string>();
  const aoEvento = (ev: EventoTerminal): void => {
    if (ev.tipo !== "atividade" && ev.tipo !== "estado" && ev.tipo !== "encerramento") return;
    const id = d.paneDaSessao(ev.sessao_id);
    if (id === null) return;
    const pane = d.obterPane(id);
    if (pane === undefined || ultimo.get(id) === pane.estado) return;
    ultimo.set(id, pane.estado);
    d.barramento.emitir("pane.state_changed", { pane_id: id, estado: pane.estado });
    if (pane.estado === "encerrado") {
      ultimo.delete(id);
      d.barramento.emitir("pane.closed", { pane_id: id, reason: pane.encerrado_motivo ?? "encerrado" });
    }
  };
  return d.sessoes.assinar(aoEvento);
}
