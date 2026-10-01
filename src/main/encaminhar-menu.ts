// Liga os eventos do menu nativo/bandeja ao renderer (canal `app:menu`). Puro: o envio e a troca de tema entram injetados.
import type { CanaisEvento, TemaPreferencia } from "../compartilhado/ipc";
import type { EventoMenu } from "./menu";

export interface DepsEncaminhar {
  /** só envia se a janela existe (quem injeta confere). */
  enviar: (canal: "app:menu", payload: CanaisEvento["app:menu"]) => void;
  /** tema explícito (claro/escuro/sistema): aplicado e persistido no main, sem passar pelo renderer. */
  definirTema: (preferencia: TemaPreferencia) => void;
}

export function encaminharEventoMenu(evento: EventoMenu, d: DepsEncaminhar): void {
  if (evento.tipo === "tema") {
    if (evento.valor === "alternar") d.enviar("app:menu", { acao: "tema" });
    else d.definirTema(evento.valor);
    return;
  }
  d.enviar("app:menu", { acao: evento.tipo });
}
