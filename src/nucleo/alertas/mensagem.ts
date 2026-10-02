// Montagem da mensagem de saída: render por template (nível, ocultar títulos), redação NA SAÍDA e escape por valor (T-20.12/T-20.14).
// Lote/digest: resumo por tipo + linhas curtas; nada se perde (contagem completa mesmo quando as linhas são cortadas).
import type { AlertaVisao, NivelTemplate } from "../../compartilhado/alertas";
import { CATALOGO } from "./catalogo";
import type { CapacidadesCanal, MensagemSaida } from "./canal";
import { tituloDoLote } from "./agrupar";
import { escaparHtml, renderizar } from "./templates";
import { redigirParaCanal, truncarVisivel } from "./texto";
import type { TipoCanal } from "../../compartilhado/alertas";

export interface OpcoesMensagem {
  nivel: NivelTemplate;
  scrub?: (t: string) => string;
  ocultarTitulos?: boolean;
  /** corpos editados pelo usuário: chave `${tipo}|${canal}|${nivel}`. */
  corpos?: ReadonlyMap<string, string>;
  chat_ref?: string | null;
}

const SEV: Record<string, string> = { info: "Info", sucesso: "Ok", aviso: "Aviso", critico: "Crítico" };

export function montarMensagemAlerta(a: AlertaVisao, canal: TipoCanal, cap: CapacidadesCanal, entrega_id: string, op: OpcoesMensagem): MensagemSaida {
  const corpo = op.corpos?.get(`${a.tipo}|${canal}|${op.nivel}`);
  const comum = { ...(op.scrub === undefined ? {} : { scrub: op.scrub }), ...(op.ocultarTitulos === undefined ? {} : { ocultarTitulos: op.ocultarTitulos }), ...(corpo === undefined ? {} : { corpo }) };
  const html = cap.formato === "html" ? renderizar(a.tipo, "telegram", op.nivel, a.dados, a.titulo, { ...comum, escapar: escaparHtml }) : null;
  const plano = renderizar(a.tipo, "so", op.nivel, a.dados, a.titulo, comum);
  // corpo editado inválido (não deve ocorrer: validado ao salvar) => cai no padrão, nunca no vazio
  const { corpo: _descartado, ...semCorpo } = comum;
  const padrao = plano.erros.length > 0 ? renderizar(a.tipo, "so", op.nivel, a.dados, a.titulo, semCorpo) : plano;
  const sufixo = a.contagem > 1 ? ` (x${a.contagem})` : "";
  const texto = redigirParaCanal(`${padrao.texto}${sufixo}`, op.scrub === undefined ? {} : { scrub: op.scrub });
  const msg: MensagemSaida = {
    entrega_id,
    alerta_ids: [a.id],
    titulo: truncarVisivel(redigirParaCanal(op.ocultarTitulos === true ? CATALOGO[a.tipo].rotulo : a.titulo, op.scrub === undefined ? {} : { scrub: op.scrub }), 80),
    texto: truncarVisivel(texto, cap.limite_visivel),
    severidade: a.severidade,
    silenciosa: a.severidade === "info" || a.severidade === "sucesso",
  };
  if (html !== null && html.erros.length === 0) msg.html = `${html.texto}${sufixo}`;
  if (op.chat_ref !== undefined && op.chat_ref !== null) msg.destino = { chat_ref: op.chat_ref };
  return msg;
}

const MAX_LINHAS_LOTE = 15;

export function montarMensagemLote(alertas: AlertaVisao[], cap: CapacidadesCanal, entrega_id: string, op: OpcoesMensagem): MensagemSaida {
  const total = alertas.reduce((n, a) => n + Math.max(1, a.contagem), 0);
  const titulo = alertas.length === 1 ? (alertas[0] as AlertaVisao).titulo : tituloDoLote(alertas);
  const pior = alertas.reduce<AlertaVisao["severidade"]>((p, a) => (a.severidade === "critico" || (a.severidade === "aviso" && p !== "critico") ? a.severidade : p), "info");
  const lin = alertas.slice(0, MAX_LINHAS_LOTE).map((a) => {
    const t = op.ocultarTitulos === true ? CATALOGO[a.tipo].rotulo : a.titulo;
    return `[${SEV[a.severidade] ?? a.severidade}] ${truncarVisivel(redigirParaCanal(t, op.scrub === undefined ? {} : { scrub: op.scrub }), 60)}`;
  });
  const resto = alertas.length > MAX_LINHAS_LOTE ? `… e mais ${alertas.length - MAX_LINHAS_LOTE}` : "";
  const cabeca = `${total} alertas: ${titulo}`;
  const texto = truncarVisivel([cabeca, ...lin, resto].filter((x) => x !== "").join("\n"), cap.limite_visivel);
  const msg: MensagemSaida = { entrega_id, alerta_ids: alertas.map((a) => a.id), titulo: truncarVisivel(cabeca, 80), texto, severidade: pior, silenciosa: pior === "info" || pior === "sucesso" };
  if (cap.formato === "html") msg.html = [`<b>${escaparHtml(cabeca)}</b>`, ...lin.map(escaparHtml), escaparHtml(resto)].filter((x) => x !== "").join("\n");
  if (op.chat_ref !== undefined && op.chat_ref !== null) msg.destino = { chat_ref: op.chat_ref };
  return msg;
}
