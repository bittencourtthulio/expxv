// Webhook genérico de SAÍDA (T-20.39, opcional, desligado por padrão): `POST` JSON assinado com HMAC-SHA-256, segredo no cofre (nunca no JSON),
// https obrigatório e host por consentimento (aplicados pela porta de rede injetada, que é a de `src/nucleo/rede`), sem redirecionamento,
// timeout de 10 s, 1 mensagem/s, SEM entrada. Este módulo NÃO abre conexão: usa a porta `postar`.
import { createHmac } from "node:crypto";
import { PRODUTO } from "../../produto";
import type { CanalComunicacao, CapacidadesCanal, MensagemSaida, ResultadoEnvio } from "../canal";
import { redigirParaCanal, truncarVisivel } from "../texto";

export const CABECALHO_ASSINATURA = `x-${PRODUTO.id}-assinatura`;
export const CAPACIDADES_WEBHOOK: CapacidadesCanal = { entrada: false, botoes: false, formato: "texto", limite_visivel: 3500, edita_mensagem: false, precisa_consentimento: true, min_intervalo_ms: 1000, max_por_min: 30 };

export interface PortaPostarJson {
  postar(p: { host: string; caminho: string; corpo: string; cabecalhos: Record<string, string>; timeout_ms: number; sinal: AbortSignal }): Promise<{ status: number }>;
}
export interface DepsWebhook {
  host: string;
  caminho: string;
  http: PortaPostarJson;
  /** segredo do cofre; `null` = ausente (canal não envia). */
  segredo(): Promise<string | null>;
  agora?(): number;
}

export const assinar = (segredo: string, corpo: string): string => `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;

export function criarCanalWebhook(deps: DepsWebhook): CanalComunicacao {
  const agora = deps.agora ?? Date.now;
  async function postar(corpoObj: Record<string, unknown>, sinal: AbortSignal): Promise<ResultadoEnvio> {
    const segredo = await deps.segredo();
    if (segredo === null) return { ok: false, permanente: true, erro: "desligado" };
    const corpo = JSON.stringify(corpoObj);
    try {
      const r = await deps.http.postar({ host: deps.host, caminho: deps.caminho, corpo, cabecalhos: { "content-type": "application/json", [CABECALHO_ASSINATURA]: assinar(segredo, corpo) }, timeout_ms: 10_000, sinal });
      if (r.status >= 200 && r.status < 300) return { ok: true };
      if (r.status === 429) return { ok: false, permanente: false, erro: "rate_limited", tentar_em_ms: 5000 };
      if (r.status >= 500) return { ok: false, permanente: false, erro: "rede" };
      return { ok: false, permanente: true, erro: "conteudo_invalido" };
    } catch {
      return { ok: false, permanente: false, erro: "rede" };
    }
  }
  return {
    tipo: "webhook",
    capacidades: CAPACIDADES_WEBHOOK,
    estado: () => "ativo",
    enviar: (msg: MensagemSaida, sinal) =>
      postar({ id: msg.entrega_id, tipo: "alerta", severidade: msg.severidade, titulo: truncarVisivel(redigirParaCanal(msg.titulo), 120), texto: truncarVisivel(redigirParaCanal(msg.texto), 3500), ts: new Date(agora()).toISOString() }, sinal),
    async testar(sinal) {
      const r = await postar({ id: "teste", tipo: "teste", severidade: "info", titulo: "Teste", texto: "Teste de webhook", ts: new Date(agora()).toISOString() }, sinal);
      return { ok: r.ok, detalhe: r.ok ? "webhook respondeu 2xx" : `falhou: ${r.erro}` };
    },
  };
}
