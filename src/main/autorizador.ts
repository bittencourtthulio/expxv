import { urlDocumentoPrincipalPermitida } from "./navegacao";

/**
 * Autorização por REMETENTE do IPC (não é autorização de comandos): recusa subframe, janela
 * diferente da esperada e origem fora do documento do app.
 */

export interface RemetenteIpc {
  /** URL do frame que enviou a mensagem. */
  url: string;
  /** o frame é o frame principal da janela? */
  frame_principal: boolean;
  /** id da janela (webContents) do remetente. */
  janela_id: number;
}

export function autorizarRemetente(remetente: RemetenteIpc, janelaEsperada: number | null): boolean {
  if (!remetente.frame_principal) return false;
  if (janelaEsperada === null || remetente.janela_id !== janelaEsperada) return false;
  return urlDocumentoPrincipalPermitida(remetente.url);
}
