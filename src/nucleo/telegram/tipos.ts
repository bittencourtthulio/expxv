// Subconjunto da Bot API usado pelo núcleo (fonte: core.telegram.org/bots/api). Só o que o código lê; campos extras são ignorados.
export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}
export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel" | string;
}
export interface TgMessage {
  message_id: number;
  /** segundos desde a época (UTC). */
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  reply_to_message?: TgMessage;
  forward_origin?: unknown;
  forward_date?: number;
  via_bot?: TgUser;
  sender_chat?: TgChat;
  [extra: string]: unknown;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
  chat_instance?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  [extra: string]: unknown;
}
export interface TgBotInfo {
  id: number;
  username: string;
  nome: string;
}
export interface TgWebhookInfo {
  url: string;
  pending_update_count: number;
}
export interface TgBotao {
  text: string;
  callback_data: string;
}
export type TgTeclado = TgBotao[][];

export const ALLOWED_UPDATES = ["message", "callback_query"] as const;
