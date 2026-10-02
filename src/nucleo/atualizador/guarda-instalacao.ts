// Guarda de instalação (Fase 21, T-21.16, AU-11): instalar reinicia o app. Com terminal trabalhando ou protocolo do daemon incompatível,
// só com confirmação explícita na UI. O daemon de PTY (D-12) sobrevive ao app: as CLIs continuam, mas a pessoa precisa saber.
import type { MotivoAtualizacao } from "../../compartilhado/atualizacao";

export interface EntradaGuarda {
  panesTrabalhando: number;
  confirmarPanes: boolean;
  protocoloDaemonAtual: number;
  /** protocolo que o app novo espera (do manifesto/artefato); `null` = igual ao atual. */
  protocoloDaemonNovo: number | null;
}
export type ResultadoGuarda = { ok: true; avisos: Array<"panes_trabalhando" | "protocolo_do_daemon"> } | { ok: false; motivo: Extract<MotivoAtualizacao, "panes_trabalhando" | "protocolo_do_daemon"> };

export function avaliarInstalacao(e: EntradaGuarda): ResultadoGuarda {
  const protocoloMudou = e.protocoloDaemonNovo !== null && e.protocoloDaemonNovo !== e.protocoloDaemonAtual;
  const avisos: Array<"panes_trabalhando" | "protocolo_do_daemon"> = [];
  if (e.panesTrabalhando > 0) avisos.push("panes_trabalhando");
  if (protocoloMudou) avisos.push("protocolo_do_daemon");
  if (avisos.length === 0) return { ok: true, avisos };
  if (e.confirmarPanes) return { ok: true, avisos };
  return { ok: false, motivo: avisos[0] as "panes_trabalhando" | "protocolo_do_daemon" };
}
