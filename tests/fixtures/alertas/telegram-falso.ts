// Servidor Telegram FALSO (Fase 20, T-20.19): HTTP em 127.0.0.1:porta efêmera. NUNCA rede real, NUNCA bot real; recusa ouvir fora de loopback.
// Implementa de verdade (só o documentado): getMe, getUpdates (long polling real, offset que CONFIRMA e descarta, limit 1-100, allowed_updates lembrada e
// aplicada só a updates criados depois), sendMessage (4096 visíveis após o parse, parse_mode HTML com validação de entidades, callback_data <= 64 bytes),
// editMessageText, editMessageReplyMarkup, answerCallbackQuery (texto <= 200), deleteWebhook, getWebhookInfo, setMyCommands.
// Falhas injetáveis: token inválido (401), 409 (2º getUpdates concorrente derruba o 1º; e webhook ativo — texto marcado `forma_presumida`), 429 com
// retry_after, 5xx, latência, corte de conexão. Registra TODAS as chamadas e prova ONDE o token apareceu (só no caminho).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export interface MensagemFalsa {
  chat_id: number;
  message_id: number;
  texto: string;
  html: string | null;
  teclado: Array<Array<{ text: string; callback_data: string }>> | null;
  silenciosa: boolean;
  editada: boolean;
  enviada_em: number;
}
export interface ChamadaFalsa {
  metodo: string;
  caminho: string;
  corpo: Record<string, unknown>;
  cabecalhos: Record<string, string | string[] | undefined>;
  em: number;
}
export interface FalhaInjetada {
  status?: number;
  corpo?: unknown;
  atrasoMs?: number;
  cortar?: boolean;
  vezes?: number;
}
export interface OpcoesTelegramFalso {
  token?: string;
  botId?: number;
  botUsername?: string;
  /** divide o timeout do long polling (ex.: 100 => 30 s viram 300 ms) para testes rápidos. */
  escalaTempo?: number;
  /** 429 quando um chat recebe mais de N mensagens em 1 s (0 = desligado). */
  limitePorSegundo?: number;
  agora?: () => number;
}
export interface UsuarioFalso {
  id: number;
  chat_id: number;
  enviar(texto: string, o?: { date?: number; chat_id?: number; tipo_chat?: string }): number;
  /** toca o botão de uma mensagem do bot (por texto do botão, `callback_data` ou índice 0). */
  tocar(m: MensagemFalsa | { message_id: number; chat_id: number }, botao?: string, o?: { data?: string; from_id?: number; message_id?: number; chat_id?: number }): void;
  responderA(m: { message_id: number }, texto: string): number;
  enviarMidia(): number;
  encaminhar(texto: string): number;
  editar(message_id: number, texto: string): number;
  viaBot(texto: string): number;
  doCanal(texto: string): number;
}

export interface TelegramFalso {
  porta: number;
  host: "127.0.0.1";
  token: string;
  chamadas: ChamadaFalsa[];
  mensagens: MensagemFalsa[];
  callbacksRespondidos: Array<{ id: string; texto: string }>;
  comandos: Array<{ command: string; description: string }>;
  usuario(id: number, o?: { nome?: string; username?: string }): UsuarioFalso;
  falhar(metodo: string, f: FalhaInjetada): void;
  invalidarToken(): void;
  definirWebhook(url: string | null): void;
  /** emite um update arbitrário (já com `update_id`), ignorando allowed_updates (updates "indesejados"). */
  injetarUpdate(u: Record<string, unknown>): number;
  chamadasDe(metodo: string): ChamadaFalsa[];
  getUpdatesAbertos(): number;
  socketsAbertos(): number;
  conexoesTotais(): number;
  ondeTokenApareceu(): { caminho: number; corpo: number; cabecalhos: number };
  pendentes(): number;
  /** erro de validação (como a API real) ou null. */
  validarMensagem(html: string, opcoes?: { parse_mode?: "HTML" }): string | null;
  fechar(): Promise<void>;
}

const TAGS_OK = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "a", "tg-spoiler"]);

/** validação mínima do parse_mode HTML como a API real: tags balanceadas e `<`/`&` crus são erro. */
export function validarHtmlTelegram(html: string): { erro: string | null; visiveis: number } {
  const pilha: string[] = [];
  let visiveis = 0;
  for (let i = 0; i < html.length; ) {
    const c = html[i] as string;
    if (c === "<") {
      const f = html.indexOf(">", i);
      if (f < 0) return { erro: "Bad Request: can't parse entities: Unclosed start tag", visiveis };
      const t = html.slice(i + 1, f);
      const m = /^(\/?)([a-z-]+)(\s[^>]*)?$/.exec(t);
      if (m === null || !TAGS_OK.has(m[2] as string)) return { erro: `Bad Request: can't parse entities: Unsupported start tag "${t.slice(0, 20)}"`, visiveis };
      if (m[1] === "/") {
        if (pilha.pop() !== m[2]) return { erro: "Bad Request: can't parse entities: Unmatched end tag", visiveis };
      } else pilha.push(m[2] as string);
      i = f + 1;
    } else if (c === "&") {
      const f = html.indexOf(";", i);
      const e = f < 0 ? "" : html.slice(i, f + 1);
      if (!/^&(?:amp|lt|gt|quot|#\d{1,6}|#x[0-9a-fA-F]{1,6});$/.test(e)) return { erro: "Bad Request: can't parse entities: Unsupported entity", visiveis };
      visiveis++;
      i = f + 1;
    } else {
      const cp = html.codePointAt(i) as number;
      i += cp > 0xffff ? 2 : 1;
      visiveis++;
    }
  }
  if (pilha.length > 0) return { erro: "Bad Request: can't parse entities: Can't find end tag", visiveis };
  return { erro: null, visiveis };
}

export async function subirTelegramFalso(op: OpcoesTelegramFalso = {}): Promise<TelegramFalso> {
  const agora = op.agora ?? ((): number => Date.now());
  const escala = op.escalaTempo ?? 1;
  let token = op.token ?? "123456789:AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s";
  const tokenOriginal = token;
  const botId = op.botId ?? 777000111;
  const botUsername = op.botUsername ?? "expx_teste_bot";
  const chamadas: ChamadaFalsa[] = [];
  const mensagens: MensagemFalsa[] = [];
  const callbacksRespondidos: Array<{ id: string; texto: string }> = [];
  let comandos: Array<{ command: string; description: string }> = [];
  const chatsConhecidos = new Set<number>();
  const falhas = new Map<string, FalhaInjetada[]>();
  let webhook: string | null = null;
  let proxMsgId = 100;
  let proxUpdate = 1000;
  let proxCallback = 1;
  let allowed: string[] | null = null;
  let fila: Array<Record<string, unknown> & { update_id: number }> = [];
  let ofensasToken = { caminho: 0, corpo: 0, cabecalhos: 0 };
  const getUpdatesAbertos: Array<{ id: number; fim: (r: { status: number; corpo: unknown }) => void }> = [];
  const sockets = new Set<Socket>();
  let conexoes = 0;
  const envios = new Map<number, number[]>();
  const esperas = new Set<() => void>();

  const novoUpdate = (u: Record<string, unknown>, forcar = false): number => {
    const tipo = Object.keys(u).find((k) => k !== "update_id") ?? "message";
    if (!forcar && allowed !== null && !allowed.includes(tipo)) return -1;
    const id = proxUpdate++;
    fila.push({ ...u, update_id: id });
    for (const e of [...esperas]) e();
    return id;
  };

  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    const partes: Buffer[] = [];
    req.on("data", (d: Buffer) => partes.push(d));
    req.on("end", () => void tratar(req, res, Buffer.concat(partes).toString("utf8")));
  });
  servidor.on("connection", (s) => {
    conexoes++;
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  const responder = (res: ServerResponse, status: number, corpo: unknown): void => {
    if (res.writableEnded || res.destroyed) return;
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(corpo));
  };
  const erroApi = (res: ServerResponse, code: number, description: string, extra: Record<string, unknown> = {}): void => responder(res, code, { ok: false, error_code: code, description, ...extra });
  const ok = (res: ServerResponse, result: unknown): void => responder(res, 200, { ok: true, result });

  async function tratar(req: IncomingMessage, res: ServerResponse, texto: string): Promise<void> {
    const caminho = req.url ?? "";
    const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(caminho.split("?")[0] as string);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = texto.trim() === "" ? {} : (JSON.parse(texto) as Record<string, unknown>);
    } catch {
      corpo = {};
    }
    const metodo = m?.[2] ?? "?";
    chamadas.push({ metodo, caminho, corpo, cabecalhos: { ...req.headers }, em: agora() });
    // prova de onde o token apareceu
    if (caminho.includes(tokenOriginal)) ofensasToken.caminho++;
    if (texto.includes(tokenOriginal)) ofensasToken.corpo++;
    if (JSON.stringify(req.headers).includes(tokenOriginal)) ofensasToken.cabecalhos++;

    const lista = falhas.get(metodo);
    const falha = lista?.[0];
    if (falha !== undefined) {
      falha.vezes = (falha.vezes ?? 1) - 1;
      if (falha.vezes <= 0) lista?.shift();
      if (falha.atrasoMs !== undefined) await new Promise((r) => setTimeout(r, falha.atrasoMs));
      if (falha.cortar === true) return void req.socket.destroy();
      if (falha.status !== undefined) return responder(res, falha.status, falha.corpo ?? { ok: false, error_code: falha.status, description: "falha injetada" });
    }
    if (m === null) return erroApi(res, 404, "Not Found");
    if (m[1] !== token) return erroApi(res, 401, "Unauthorized");

    switch (metodo) {
      case "getMe":
        return ok(res, { id: botId, is_bot: true, first_name: "Bot de Teste", username: botUsername });
      case "getWebhookInfo":
        return ok(res, { url: webhook ?? "", pending_update_count: fila.length });
      case "deleteWebhook":
        webhook = null;
        if (corpo.drop_pending_updates === true) fila = [];
        return ok(res, true);
      case "setMyCommands":
        comandos = (corpo.commands as typeof comandos) ?? [];
        return ok(res, true);
      case "getUpdates":
        return getUpdates(res, corpo);
      case "sendMessage":
        return enviar(res, corpo);
      case "editMessageText":
      case "editMessageReplyMarkup":
        return editar(res, metodo, corpo);
      case "answerCallbackQuery": {
        const t = typeof corpo.text === "string" ? corpo.text : "";
        if (t.length > 200) return erroApi(res, 400, "Bad Request: MESSAGE_TOO_LONG");
        callbacksRespondidos.push({ id: String(corpo.callback_query_id ?? ""), texto: t });
        return ok(res, true);
      }
      default:
        return erroApi(res, 404, "Not Found");
    }
  }

  function getUpdates(res: ServerResponse, p: Record<string, unknown>): void {
    if (webhook !== null) return erroApi(res, 409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first"); // forma_presumida
    if (Array.isArray(p.allowed_updates)) allowed = p.allowed_updates as string[];
    const offset = typeof p.offset === "number" ? p.offset : null;
    if (offset !== null) fila = fila.filter((u) => u.update_id >= offset); // confirmação: descarta os anteriores
    const limit = Math.max(1, Math.min(typeof p.limit === "number" ? p.limit : 100, 100));
    const timeout = Math.max(0, typeof p.timeout === "number" ? p.timeout : 0);
    // outro getUpdates em curso: o ANTERIOR termina com 409
    for (const a of getUpdatesAbertos.splice(0)) a.fim({ status: 409, corpo: { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running" } });
    const pronto = (): boolean => fila.length > 0;
    const entregar = (): void => ok(res, fila.slice(0, limit));
    if (pronto() || timeout === 0) return entregar();
    const id = Math.random();
    let encerrado = false;
    const t = setTimeout(() => terminar(), (timeout * 1000) / escala);
    const acordar = (): void => {
      if (pronto()) terminar();
    };
    const terminar = (r?: { status: number; corpo: unknown }): void => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(t);
      esperas.delete(acordar);
      const i = getUpdatesAbertos.findIndex((a) => a.id === id);
      if (i >= 0) getUpdatesAbertos.splice(i, 1);
      if (r !== undefined) responder(res, r.status, r.corpo);
      else entregar();
    };
    esperas.add(acordar);
    getUpdatesAbertos.push({ id, fim: (r) => terminar(r) });
    res.on("close", () => {
      if (!encerrado) {
        encerrado = true;
        clearTimeout(t);
        esperas.delete(acordar);
        const i = getUpdatesAbertos.findIndex((a) => a.id === id);
        if (i >= 0) getUpdatesAbertos.splice(i, 1);
      }
    });
  }

  function validarTeclado(rm: unknown): string | null {
    if (rm === undefined) return null;
    const linhas = (rm as { inline_keyboard?: unknown }).inline_keyboard;
    if (!Array.isArray(linhas)) return "Bad Request: reply markup is invalid";
    for (const l of linhas as Array<Array<{ text?: unknown; callback_data?: unknown }>>)
      for (const b of l) {
        if (typeof b.callback_data === "string" && Buffer.byteLength(b.callback_data, "utf8") > 64) return "Bad Request: BUTTON_DATA_INVALID";
        if (typeof b.callback_data === "string" && b.callback_data.length < 1) return "Bad Request: BUTTON_DATA_INVALID";
      }
    return null;
  }
  function validarTexto(texto: unknown, parse: unknown): { erro: string | null; visivel: string } {
    if (typeof texto !== "string" || texto.length === 0) return { erro: "Bad Request: message text is empty", visivel: "" };
    if (parse === "HTML") {
      const v = validarHtmlTelegram(texto);
      if (v.erro !== null) return { erro: v.erro, visivel: "" };
      if (v.visiveis > 4096) return { erro: "Bad Request: message is too long", visivel: "" };
      return { erro: null, visivel: texto.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"') };
    }
    if (Array.from(texto).length > 4096) return { erro: "Bad Request: message is too long", visivel: "" };
    return { erro: null, visivel: texto };
  }

  function enviar(res: ServerResponse, p: Record<string, unknown>): void {
    const chat = p.chat_id as number;
    if (!chatsConhecidos.has(chat)) return erroApi(res, 400, "Bad Request: chat not found");
    const v = validarTexto(p.text, p.parse_mode);
    if (v.erro !== null) return erroApi(res, 400, v.erro);
    const e = validarTeclado(p.reply_markup);
    if (e !== null) return erroApi(res, 400, e);
    if ((op.limitePorSegundo ?? 0) > 0) {
      const t = agora();
      const janela = (envios.get(chat) ?? []).filter((x) => t - x < 1000);
      if (janela.length >= (op.limitePorSegundo as number)) return erroApi(res, 429, "Too Many Requests: retry after 2", { parameters: { retry_after: 2 } });
      janela.push(t);
      envios.set(chat, janela);
    }
    const msg: MensagemFalsa = { chat_id: chat, message_id: proxMsgId++, texto: v.visivel, html: p.parse_mode === "HTML" ? (p.text as string) : null, teclado: p.reply_markup === undefined ? null : ((p.reply_markup as { inline_keyboard: MensagemFalsa["teclado"] & object }).inline_keyboard as MensagemFalsa["teclado"]), silenciosa: p.disable_notification === true, editada: false, enviada_em: agora() };
    mensagens.push(msg);
    ok(res, { message_id: msg.message_id, chat: { id: chat, type: "private" }, date: Math.floor(agora() / 1000), text: v.visivel });
  }

  function editar(res: ServerResponse, metodo: string, p: Record<string, unknown>): void {
    const msg = mensagens.find((m) => m.chat_id === p.chat_id && m.message_id === p.message_id);
    if (msg === undefined) return erroApi(res, 400, "Bad Request: message to edit not found");
    if (metodo === "editMessageText") {
      const v = validarTexto(p.text, p.parse_mode);
      if (v.erro !== null) return erroApi(res, 400, v.erro);
      msg.texto = v.visivel;
      msg.html = p.parse_mode === "HTML" ? (p.text as string) : null;
      msg.editada = true;
    }
    if (p.reply_markup !== undefined) {
      const e = validarTeclado(p.reply_markup);
      if (e !== null) return erroApi(res, 400, e);
      const linhas = (p.reply_markup as { inline_keyboard: NonNullable<MensagemFalsa["teclado"]> }).inline_keyboard;
      msg.teclado = linhas.length === 0 ? null : linhas;
    }
    ok(res, { message_id: msg.message_id });
  }

  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const porta = (servidor.address() as { port: number }).port;

  const falso: TelegramFalso = {
    porta,
    host: "127.0.0.1",
    get token() {
      return tokenOriginal;
    },
    chamadas,
    mensagens,
    callbacksRespondidos,
    get comandos() {
      return comandos;
    },
    usuario(id, o = {}) {
      const from = { id, is_bot: false, first_name: o.nome ?? `Pessoa ${id}`, ...(o.username === undefined ? {} : { username: o.username }) };
      const mkMsg = (extra: Record<string, unknown>, chat_id = id, tipo = "private", date?: number): Record<string, unknown> => {
        chatsConhecidos.add(chat_id);
        return { message_id: proxMsgId++, date: date ?? Math.floor(agora() / 1000), chat: { id: chat_id, type: tipo }, from, ...extra };
      };
      return {
        id,
        chat_id: id,
        enviar(texto, e = {}) {
          const msg = mkMsg({ text: texto }, e.chat_id ?? id, e.tipo_chat ?? "private", e.date);
          novoUpdate({ message: msg });
          return msg.message_id as number;
        },
        tocar(m, botao, e = {}) {
          const real = mensagens.find((x) => x.message_id === m.message_id && x.chat_id === m.chat_id);
          const b = real?.teclado?.flat().find((x) => botao === undefined || x.text === botao || x.callback_data === botao);
          const data = e.data ?? b?.callback_data ?? "";
          novoUpdate({ callback_query: { id: `cb${proxCallback++}`, from: { ...from, id: e.from_id ?? id }, message: { message_id: e.message_id ?? m.message_id, date: Math.floor(agora() / 1000), chat: { id: e.chat_id ?? m.chat_id, type: "private" } }, data, chat_instance: "ci" } });
        },
        responderA(m, texto) {
          const msg = mkMsg({ text: texto, reply_to_message: { message_id: m.message_id, date: Math.floor(agora() / 1000), chat: { id, type: "private" } } });
          novoUpdate({ message: msg });
          return msg.message_id as number;
        },
        enviarMidia() {
          const msg = mkMsg({ photo: [{ file_id: "x", width: 1, height: 1 }] });
          novoUpdate({ message: msg });
          return msg.message_id as number;
        },
        encaminhar(texto) {
          const msg = mkMsg({ text: texto, forward_origin: { type: "user", date: 1 }, forward_date: 1 });
          novoUpdate({ message: msg });
          return msg.message_id as number;
        },
        editar(message_id, texto) {
          novoUpdate({ edited_message: mkMsg({ message_id, text: texto, edit_date: 1 }) }, true);
          return message_id;
        },
        viaBot(texto) {
          const msg = mkMsg({ text: texto, via_bot: { id: 9, is_bot: true, first_name: "outro" } });
          novoUpdate({ message: msg });
          return msg.message_id as number;
        },
        doCanal(texto) {
          const msg = mkMsg({ text: texto, sender_chat: { id: -100123, type: "channel" } });
          novoUpdate({ message: msg });
          return msg.message_id as number;
        },
      };
    },
    falhar(metodo, f) {
      falhas.set(metodo, [...(falhas.get(metodo) ?? []), { vezes: 1, ...f }]);
    },
    invalidarToken() {
      token = `${token}-revogado`;
    },
    definirWebhook(url) {
      webhook = url;
    },
    injetarUpdate(u) {
      return novoUpdate(u, true);
    },
    chamadasDe: (metodo) => chamadas.filter((c) => c.metodo === metodo),
    getUpdatesAbertos: () => getUpdatesAbertos.length,
    socketsAbertos: () => sockets.size,
    conexoesTotais: () => conexoes,
    ondeTokenApareceu: () => ({ ...ofensasToken }),
    pendentes: () => fila.length,
    validarMensagem(html) {
      const v = validarHtmlTelegram(html);
      if (v.erro !== null) return v.erro;
      return v.visiveis > 4096 ? "Bad Request: message is too long" : null;
    },
    async fechar() {
      for (const a of getUpdatesAbertos.splice(0)) a.fim({ status: 500, corpo: { ok: false, error_code: 500, description: "encerrando" } });
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  };
  ofensasToken = { caminho: 0, corpo: 0, cabecalhos: 0 };
  return falso;
}
