// Feedback append-only (união entre máquinas) e transições de estado SEM envenenamento: agente sozinho nunca arquiva nem rejeita.
// "errado" de agente só vale com 2 Panes distintos; de humano vale com 1. Arquiva com 2 votos efetivos; rejeitar é ação humana explícita.
import type { ValorFeedback } from "../../../compartilhado/conhecimento";
import type { Repos } from "../repos";

export interface PedidoFeedback {
  alvo_tipo: "chunk" | "documento" | "aprendizado";
  alvo_id: string;
  valor: ValorFeedback;
  por: "agente" | "humano";
  /** identidade de quem votou (pane_id ou "humano"); entra na chave de idempotência do dia. */
  autor_ref: string;
  pane_id?: string | null;
  consulta_id?: string | null;
  nota?: string | null;
}

export interface EfeitoFeedback {
  registrado: boolean;
  estado?: string;
}

export function votosEfetivosDeErrado(r: { humanos: number; panes: number }): number {
  return r.humanos + (r.panes >= 2 ? r.panes : 0);
}

export function registrarFeedback(repos: Repos, f: PedidoFeedback, agora: string): EfeitoFeedback {
  const registrado = repos.feedback.registrar({ ...f, pane_id: f.pane_id ?? (f.por === "agente" ? f.autor_ref : null) });
  if (f.alvo_tipo !== "aprendizado") return { registrado };
  const a = repos.aprendizado.obter(f.alvo_id);
  if (!a) return { registrado };
  const c = repos.feedback.contar(f.alvo_id);
  const campos: Parameters<Repos["aprendizado"]["atualizar"]>[1] = { util: c.util, inutil: c.inutil, errado: c.errado };
  let estado = a.estado;
  if (f.valor === "util") {
    if (estado === "candidato") estado = "ativo";
    campos.ultimo_uso_em = agora;
    if (a.documento_id) repos.documento.renovar(a.documento_id, agora);
  }
  if (f.valor === "errado" && (estado === "candidato" || estado === "ativo") && votosEfetivosDeErrado(repos.feedback.erradoPor(f.alvo_id)) >= 2) estado = "arquivado";
  campos.estado = estado as typeof a.estado as never;
  repos.aprendizado.atualizar(f.alvo_id, campos);
  return { registrado, estado };
}

/** Ação humana explícita sobre um aprendizado (ativar, arquivar, rejeitar, editar). */
export function acaoHumana(repos: Repos, id: string, acao: "ativar" | "arquivar" | "rejeitar" | "editar", texto?: string): boolean {
  const a = repos.aprendizado.obter(id);
  if (!a) return false;
  if (acao === "editar") {
    if (texto === undefined || texto.trim() === "") return false;
    repos.aprendizado.atualizar(id, { texto: texto.slice(0, 1000) });
  } else repos.aprendizado.atualizar(id, { estado: acao === "ativar" ? "ativo" : acao === "arquivar" ? "arquivado" : "rejeitado" });
  return true;
}
