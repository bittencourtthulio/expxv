// Adaptador Telegram (SAÍDA) como `CanalComunicacao` (T-20.22): HTML com escape por valor, divide acima de 3 500 visíveis, teclado com nonce, desliga
// preview de link, `disable_notification` por severidade, 429 => `tentar_em_ms = retry_after*1000 + 1000`, 400 de parse => reenvia texto PURO uma vez
// (nunca em laço), 403/401 => erro permanente. O token nunca entra em `MensagemSaida`, em log nem em erro. Fila e espaçamento (1 msg/s por chat, 20/min)
// são do entregador; aqui só se respeita o espaçamento entre as partes de UMA mensagem.
import type { CanalComunicacao, CapacidadesCanal, MensagemSaida, ResultadoEnvio } from "../alertas/canal";
import type { EstadoCanal } from "../../compartilhado/alertas";
import { ErroTelegram, LimiteDeTaxa } from "./erros";
import { dividir, escaparHtml, htmlParaTexto, LIMITE_DIVISAO, teclado } from "./formato";
import type { ClienteBotApi } from "./api";
import { dormirReal, type DormirPorta, type RelogioTg } from "./portas";
import type { RepoTelegram } from "./repo";
import type { Poller } from "./poller";
import { truncarVisivel } from "../alertas/texto";

export const CAPACIDADES_TELEGRAM: CapacidadesCanal = { entrada: true, botoes: true, formato: "html", limite_visivel: 4096, edita_mensagem: true, precisa_consentimento: true, min_intervalo_ms: 1100, max_por_min: 20 };
const ESPACO_PARTES_MS = 1100;

export interface DepsCanalTelegram {
  api: ClienteBotApi;
  repo: RepoTelegram;
  canal_id: string;
  relogio: RelogioTg;
  consentimentoValido(): boolean;
  estadoCanal(): EstadoCanal;
  poller?: Pick<Poller, "iniciar" | "parar" | "ativo">;
  dormir?: DormirPorta;
}

const ehParse = (e: ErroTelegram): boolean => e.codigo === "requisicao" && /parse|entit/i.test(e.descricao ?? "");

export function criarCanalTelegram(deps: DepsCanalTelegram): CanalComunicacao {
  const dormir = deps.dormir ?? dormirReal;

  function destinatarios(msg: MensagemSaida): number[] {
    const ativos = deps.repo.listarAutorizados(deps.canal_id).filter((a) => a.revogado_em === null && Date.parse(a.expira_em) > deps.relogio.agora());
    if (msg.destino !== undefined) {
      const m = /^chat:(-?\d{1,20})$/.exec(msg.destino.chat_ref);
      const id = m === null ? NaN : Number(m[1]);
      return ativos.filter((a) => a.chat_id === id).map((a) => a.chat_id);
    }
    return ativos.map((a) => a.chat_id);
  }

  async function enviarParte(chat_id: number, html: string, ultima: boolean, msg: MensagemSaida, sinal: AbortSignal): Promise<number> {
    const base = { chat_id, disable_notification: msg.silenciosa, ...(ultima && msg.botoes !== undefined ? { reply_markup: { inline_keyboard: teclado(msg.botoes) } } : {}) };
    try {
      return (await deps.api.sendMessage({ ...base, text: html, parse_mode: "HTML" }, sinal)).message_id;
    } catch (e) {
      if (e instanceof ErroTelegram && ehParse(e)) {
        // UMA volta de texto puro; se falhar de novo, o erro sobe (nada de laço)
        return (await deps.api.sendMessage({ ...base, text: truncarVisivel(htmlParaTexto(html), 4096) }, sinal)).message_id;
      }
      throw e;
    }
  }

  async function enviar(msg: MensagemSaida, sinal: AbortSignal): Promise<ResultadoEnvio> {
    if (!deps.consentimentoValido()) return { ok: false, permanente: true, erro: "consentimento_ausente" };
    if (deps.estadoCanal() === "desligado") return { ok: false, permanente: true, erro: "desligado" };
    const chats = destinatarios(msg);
    if (chats.length === 0) return { ok: false, permanente: true, erro: "chat_inalcancavel" };
    const html = msg.html ?? escaparHtml(msg.texto);
    const partes = dividir(html, LIMITE_DIVISAO);
    let primeiroId: number | null = null;
    let sucessos = 0;
    let ultimoErro: ResultadoEnvio | null = null;
    for (const chat of chats) {
      try {
        for (let i = 0; i < partes.length; i++) {
          if (i > 0) await dormir.dormir(ESPACO_PARTES_MS, sinal);
          const id = await enviarParte(chat, partes[i] as string, i === partes.length - 1, msg, sinal);
          primeiroId ??= id;
        }
        sucessos++;
      } catch (e) {
        if (sinal.aborted) return { ok: false, permanente: false, erro: "rede" };
        if (e instanceof LimiteDeTaxa) return { ok: false, permanente: false, erro: "rate_limited", tentar_em_ms: e.retry_after_s * 1000 + 1000 };
        if (e instanceof ErroTelegram) {
          if (e.codigo === "token_invalido") return { ok: false, permanente: true, erro: "token_invalido" };
          if (e.codigo === "consentimento_ausente") return { ok: false, permanente: true, erro: "consentimento_ausente" };
          if (e.codigo === "chat_inalcancavel") ultimoErro = { ok: false, permanente: true, erro: "chat_inalcancavel" };
          else if (e.codigo === "requisicao") ultimoErro = { ok: false, permanente: true, erro: "conteudo_invalido" };
          else ultimoErro = { ok: false, permanente: false, erro: "rede" };
        } else ultimoErro = { ok: false, permanente: false, erro: "rede" };
      }
    }
    if (sucessos > 0) return { ok: true, ...(primeiroId === null ? {} : { mensagem_externa_id: String(primeiroId) }) };
    return ultimoErro ?? { ok: false, permanente: false, erro: "rede" };
  }

  return {
    tipo: "telegram",
    capacidades: CAPACIDADES_TELEGRAM,
    estado: deps.estadoCanal,
    enviar,
    async testar(sinal) {
      if (!deps.consentimentoValido()) return { ok: false, detalhe: "consentimento ausente" };
      try {
        const bot = await deps.api.getMe(sinal);
        const chats = deps.repo.listarAutorizados(deps.canal_id).filter((a) => a.revogado_em === null);
        const alvo = chats[0];
        if (alvo === undefined) return { ok: true, detalhe: `bot @${bot.username} respondeu; nenhuma conta pareada para a mensagem de teste` };
        await deps.api.sendMessage({ chat_id: alvo.chat_id, text: "Mensagem de teste dos alertas.", disable_notification: true }, sinal);
        return { ok: true, detalhe: `bot @${bot.username} respondeu e a mensagem de teste foi enviada` };
      } catch (e) {
        return { ok: false, detalhe: e instanceof ErroTelegram ? e.codigo : "falha" };
      }
    },
    async iniciar() {
      if (deps.poller !== undefined && !deps.poller.ativo()) deps.poller.iniciar();
    },
    async parar() {
      await deps.poller?.parar();
    },
  };
}
