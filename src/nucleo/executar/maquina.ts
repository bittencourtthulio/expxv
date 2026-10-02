// Máquina de estados play/stop/restart por workspace e a apresentação do botão. Pura: o serviço aplica eventos, a UI só lê.
import { ESTADO_OCIOSO, type EstadoExecucao, type TipoExecucao } from "./modelo";
import { formatarDuracao } from "./saida";

export type EventoMaquina =
  | { t: "iniciar"; execucao_id: string; config_id: string; nome: string; tipo: TipoExecucao; passos_total: number; agora: number }
  | { t: "passo"; passo: number; sessao_id: string }
  | { t: "porta"; porta: number; url: string }
  | { t: "parar" }
  | { t: "terminou"; agora: number; resultado: "sucesso" | "falha" | "parada"; codigo: number | null; sinal: number | null; mensagem: string }
  | { t: "falha_ao_iniciar"; agora: number; mensagem: string };

export const ATIVAS = ["preparando", "rodando", "parando"] as const;
export const estaAtiva = (e: Pick<EstadoExecucao, "fase">): boolean => (ATIVAS as readonly string[]).includes(e.fase);

export function reduzir(e: EstadoExecucao, ev: EventoMaquina): EstadoExecucao {
  switch (ev.t) {
    case "iniciar":
      if (estaAtiva(e)) return e;
      return {
        ...ESTADO_OCIOSO(e.workspace_id), fase: "preparando", execucao_id: ev.execucao_id, config_id: ev.config_id, nome: ev.nome, tipo: ev.tipo,
        passo: 1, passos_total: ev.passos_total, iniciado_em: ev.agora,
      };
    case "passo":
      if (!estaAtiva(e) || e.fase === "parando") return e;
      return { ...e, passo: ev.passo, sessao_id: ev.sessao_id, fase: ev.passo >= e.passos_total ? "rodando" : "preparando" };
    case "porta":
      return estaAtiva(e) && e.porta === null ? { ...e, porta: ev.porta, url: ev.url } : e;
    case "parar":
      return e.fase === "preparando" || e.fase === "rodando" ? { ...e, fase: "parando" } : e;
    case "terminou":
      if (!estaAtiva(e)) return e;
      return { ...e, fase: ev.resultado === "sucesso" ? "concluida" : ev.resultado === "parada" ? "parada" : "falhou", codigo: ev.codigo, sinal: ev.sinal, terminado_em: ev.agora, mensagem: ev.mensagem };
    case "falha_ao_iniciar":
      return { ...(estaAtiva(e) ? e : ESTADO_OCIOSO(e.workspace_id)), fase: "falhou", terminado_em: ev.agora, mensagem: ev.mensagem };
  }
}

export type TomBotao = "neutro" | "ativo" | "ok" | "erro";
export interface ApresentacaoBotao {
  acao: "executar" | "parar";
  desabilitado: boolean;
  rotulo: string;
  tooltip: string;
  /** anunciado por leitores de tela (aria-label) */
  aria: string;
  /** texto do chip discreto (estado atual); `null` = sem chip */
  chip: string | null;
  tom: TomBotao;
}

export interface AtalhosTexto { executar: string; parar: string; reiniciar: string }

/** O que o botão e o chip mostram agora. `agora` entra como parâmetro: o relógio é de quem chama (UI atualiza a cada segundo só se ativa). */
export function apresentarBotao(e: EstadoExecucao, padraoNome: string | null, agora: number, atalhos: AtalhosTexto): ApresentacaoBotao {
  const alvo = padraoNome ?? "projeto";
  if (e.fase === "parando") {
    return { acao: "parar", desabilitado: true, rotulo: "Parando…", tooltip: `Parando ${e.nome ?? alvo}…`, aria: `Parando ${e.nome ?? alvo}`, chip: "parando…", tom: "ativo" };
  }
  if (e.fase === "preparando" || e.fase === "rodando") {
    const tempo = e.iniciado_em === null ? "" : formatarDuracao(agora - e.iniciado_em);
    const passos = e.passos_total > 1 ? ` (passo ${e.passo}/${e.passos_total})` : "";
    const partes = [e.fase === "preparando" ? `preparando${passos}` : `rodando há ${tempo}`];
    if (e.porta !== null) partes.push(`porta ${e.porta}`);
    const texto = partes.join(" · ");
    return {
      acao: "parar", desabilitado: false, rotulo: "Parar", tom: "ativo", chip: texto,
      tooltip: `${e.nome ?? alvo}: ${texto}. Parar (${atalhos.parar}); reiniciar (${atalhos.reiniciar})`,
      aria: `Parar ${e.nome ?? alvo}. ${texto}`,
    };
  }
  const base = `Executar ${alvo} (${atalhos.executar})`;
  if (e.fase === "falhou" || e.fase === "concluida" || e.fase === "parada") {
    const tom: TomBotao = e.fase === "falhou" ? "erro" : e.fase === "concluida" ? "ok" : "neutro";
    const chip = e.fase === "falhou" ? (e.codigo !== null ? `saiu com código ${e.codigo}` : "falhou") : e.fase === "concluida" ? "concluído" : "parado";
    return { acao: "executar", desabilitado: false, rotulo: "Executar", tom, chip, tooltip: `${e.mensagem ?? chip}. ${base}`, aria: `Executar ${alvo}. Última execução: ${e.mensagem ?? chip}` };
  }
  return { acao: "executar", desabilitado: false, rotulo: "Executar", tom: "neutro", chip: null, tooltip: base, aria: `Executar ${alvo}` };
}

/** Grafia dos atalhos por sistema (F5 exige fn no macOS: há equivalentes com ⌘). */
export function atalhosDeExecucao(mac: boolean): AtalhosTexto & { alternativo: AtalhosTexto } {
  return mac
    ? { executar: "F5 ou ⌘R", parar: "⇧F5 ou ⌘.", reiniciar: "⌘⇧F5 ou ⌘⇧R", alternativo: { executar: "⌘R", parar: "⌘.", reiniciar: "⌘⇧R" } }
    : { executar: "F5", parar: "Shift+F5", reiniciar: "Ctrl+Shift+F5", alternativo: { executar: "F5", parar: "Shift+F5", reiniciar: "Ctrl+Shift+F5" } };
}

export type AcaoAtalhoExecutar = "alternar" | "parar" | "reiniciar";
/** O que o atalho lê de um evento de teclado (compatível com `KeyboardEvent`, sem depender do DOM no núcleo). */
export interface Tecla { type: string; key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

/**
 * F5 alterna (executa ou para conforme o estado); Shift+F5 para; Ctrl/Cmd+Shift+F5 reinicia.
 * No macOS, onde F5 exige fn: ⌘R alterna, ⌘. para e ⌘⇧R reinicia (o menu nativo do app não usa ⌘R).
 * Ctrl+letra puro nunca é interceptado (é do processo do terminal).
 */
export function interpretarAtalhoExecutar(e: Tecla, mac: boolean): AcaoAtalhoExecutar | null {
  if (e.type !== "keydown" || e.altKey) return null;
  if (e.key === "F5" || e.code === "F5") {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) return "reiniciar";
    if (e.ctrlKey || e.metaKey) return null;
    return e.shiftKey ? "parar" : "alternar";
  }
  if (mac && e.metaKey && !e.ctrlKey) {
    const t = e.key.toLowerCase();
    if (t === "r") return e.shiftKey ? "reiniciar" : "alternar";
    if (t === "." && !e.shiftKey) return "parar";
  }
  return null;
}
