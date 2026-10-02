// Cliente tipado da Bot API (T-20.20) sobre `PortaRedeSegredo`. Regras: token só vem do cofre (função injetada) e só vai no caminho
// (template); consentimento checado ANTES de qualquer I/O; só JSON; `AbortSignal` por chamada; erros tipados com mensagem fixa;
// o código HTTP/`error_code` prevalece sobre o texto da descrição; nada recebe o token em argumento de log.
import { ErroTelegram, LimiteDeTaxa, sanitizarTexto } from "./erros";
import type { PortaRedeSegredo } from "./portas";
import { ALLOWED_UPDATES, type TgBotInfo, type TgTeclado, type TgUpdate, type TgWebhookInfo, type TgMessage } from "./tipos";

export const HOST_TELEGRAM = "api.telegram.org";
const MAX_RESPOSTA = 1024 * 1024;

export interface OpcoesClienteBot {
  rede: PortaRedeSegredo;
  /** token do cofre; `null` = ausente. Chamado a CADA requisição (nada fica em memória aqui). */
  token: () => Promise<string | null> | string | null;
  /** consentimento vigente para `api.telegram.org`? Sem ele nenhuma chamada abre socket. */
  consentimentoValido: () => boolean;
  host?: string;
  /** só testes (servidor falso em loopback). */
  porta?: number;
}

export interface ParamsSendMessage {
  chat_id: number;
  text: string;
  parse_mode?: "HTML";
  reply_markup?: { inline_keyboard: TgTeclado };
  disable_notification?: boolean;
  protect_content?: boolean;
  link_preview_options?: { is_disabled: boolean };
  reply_to_message_id?: number;
}

export interface ClienteBotApi {
  getMe(sinal?: AbortSignal): Promise<TgBotInfo>;
  getUpdates(p: { offset?: number | null; limit?: number; timeout?: number }, sinal?: AbortSignal): Promise<TgUpdate[]>;
  sendMessage(p: ParamsSendMessage, sinal?: AbortSignal): Promise<{ message_id: number }>;
  editMessageText(p: { chat_id: number; message_id: number; text: string; parse_mode?: "HTML"; reply_markup?: { inline_keyboard: TgTeclado } }, sinal?: AbortSignal): Promise<void>;
  editMessageReplyMarkup(p: { chat_id: number; message_id: number; reply_markup?: { inline_keyboard: TgTeclado } }, sinal?: AbortSignal): Promise<void>;
  answerCallbackQuery(p: { callback_query_id: string; text?: string; show_alert?: boolean }, sinal?: AbortSignal): Promise<void>;
  deleteWebhook(p?: { drop_pending_updates?: boolean }, sinal?: AbortSignal): Promise<void>;
  getWebhookInfo(sinal?: AbortSignal): Promise<TgWebhookInfo>;
  setMyCommands(comandos: Array<{ command: string; description: string }>, sinal?: AbortSignal): Promise<void>;
}

interface Envelope<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const abortou = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";

export function criarClienteBotApi(op: OpcoesClienteBot): ClienteBotApi {
  const host = op.host ?? HOST_TELEGRAM;

  async function chamar<T>(metodo: string, corpo: Record<string, unknown> | null, sinal: AbortSignal | undefined, timeout_ms: number): Promise<T> {
    if (!op.consentimentoValido()) throw new ErroTelegram("consentimento_ausente");
    const abortado = (): boolean => sinal?.aborted === true;
    if (abortado()) throw new ErroTelegram("abortado");
    const token = await op.token();
    if (token === null || token === "") throw new ErroTelegram("token_ausente");
    let resp;
    try {
      resp = await op.rede.requisitar({
        host,
        ...(op.porta === undefined ? {} : { porta: op.porta }),
        metodo: "POST",
        caminho_template: `/bot{token}/${metodo}`,
        segredos: { token },
        corpo: JSON.stringify(corpo ?? {}),
        cabecalhos: { "content-type": "application/json" },
        timeout_ms,
        max_bytes: MAX_RESPOSTA,
        ...(sinal === undefined ? {} : { sinal }),
      });
    } catch (e) {
      // NUNCA propaga a mensagem/stack original: ela pode conter o caminho com o token
      if (abortou(e) || abortado()) throw new ErroTelegram("abortado");
      throw new ErroTelegram("rede");
    }
    let env: Envelope<T> | null = null;
    try {
      env = JSON.parse(resp.texto) as Envelope<T>;
    } catch {
      env = null;
    }
    const codigo = env?.error_code ?? resp.status;
    const descricao = typeof env?.description === "string" ? sanitizarTexto(env.description, token).slice(0, 200) : undefined;
    if (resp.status === 200 && env !== null && env.ok === true) return env.result as T;
    // o código prevalece sobre o texto
    if (codigo === 401) throw new ErroTelegram("token_invalido", 401);
    if (codigo === 403) throw new ErroTelegram("chat_inalcancavel", 403, descricao);
    if (codigo === 409) throw new ErroTelegram("conflito", 409, descricao);
    if (codigo === 429) {
      const ra = env?.parameters?.retry_after ?? Number(resp.cabecalhos?.["retry-after"] ?? 1);
      throw new LimiteDeTaxa(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 3600) : 1);
    }
    if (codigo >= 500) throw new ErroTelegram("servidor", codigo);
    if (codigo >= 400) throw new ErroTelegram("requisicao", codigo, descricao);
    throw new ErroTelegram("resposta_invalida", resp.status);
  }

  return {
    async getMe(sinal) {
      const u = await chamar<{ id: number; username?: string; first_name?: string }>("getMe", null, sinal, 15_000);
      if (typeof u?.id !== "number") throw new ErroTelegram("resposta_invalida");
      return { id: u.id, username: u.username ?? "", nome: u.first_name ?? "" };
    },
    async getUpdates(p, sinal) {
      const timeout = Math.max(0, Math.min(p.timeout ?? 0, 50));
      const r = await chamar<TgUpdate[]>(
        "getUpdates",
        { ...(p.offset === null || p.offset === undefined ? {} : { offset: p.offset }), limit: Math.max(1, Math.min(p.limit ?? 20, 100)), timeout, allowed_updates: [...ALLOWED_UPDATES] },
        sinal,
        (timeout + 10) * 1000,
      );
      if (!Array.isArray(r)) throw new ErroTelegram("resposta_invalida");
      return r;
    },
    async sendMessage(p, sinal) {
      const m = await chamar<TgMessage>("sendMessage", { ...p, link_preview_options: p.link_preview_options ?? { is_disabled: true } }, sinal, 15_000);
      if (typeof m?.message_id !== "number") throw new ErroTelegram("resposta_invalida");
      return { message_id: m.message_id };
    },
    async editMessageText(p, sinal) {
      await chamar<unknown>("editMessageText", { ...p, link_preview_options: { is_disabled: true } }, sinal, 15_000);
    },
    async editMessageReplyMarkup(p, sinal) {
      await chamar<unknown>("editMessageReplyMarkup", { ...p, reply_markup: p.reply_markup ?? { inline_keyboard: [] } }, sinal, 15_000);
    },
    async answerCallbackQuery(p, sinal) {
      await chamar<unknown>("answerCallbackQuery", { ...p, ...(p.text === undefined ? {} : { text: p.text.slice(0, 200) }) }, sinal, 10_000);
    },
    async deleteWebhook(p, sinal) {
      await chamar<unknown>("deleteWebhook", { drop_pending_updates: p?.drop_pending_updates === true }, sinal, 15_000);
    },
    async getWebhookInfo(sinal) {
      const r = await chamar<{ url?: string; pending_update_count?: number }>("getWebhookInfo", null, sinal, 15_000);
      return { url: r?.url ?? "", pending_update_count: r?.pending_update_count ?? 0 };
    },
    async setMyCommands(comandos, sinal) {
      await chamar<unknown>("setMyCommands", { commands: comandos }, sinal, 15_000);
    },
  };
}
