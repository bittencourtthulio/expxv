import type { EstadoMissao, ModoMissao, OrigemMissao, Pane, Papel, PortaoMissao } from "../../../compartilhado/dominio";

export const ESTADOS: readonly EstadoMissao[] = ["intake", "planejando", "executando", "revisando", "concluida", "falhou", "abortada"];
export const ROTULO_ESTADO: Record<EstadoMissao, string> = {
  intake: "Recebida", planejando: "Planejando", executando: "Executando", revisando: "Revisando", concluida: "Concluída", falhou: "Falhou", abortada: "Abortada",
};
export const ROTULO_MODO: Record<ModoMissao, string> = { livre: "Livre", squad: "Squad", agentico: "Agêntico" };
export const DESCRICAO_MODO: Record<ModoMissao, string> = {
  livre: "Uma CLI, sem orquestração.",
  squad: "Um piloto coordena executor, explorador e revisor.",
  agentico: "O piloto delega sozinho e você acompanha os handoffs.",
};
export const ORIGENS_WIZARD: readonly OrigemMissao[] = ["livre", "feature", "ocorrencia", "pedido"];
export const ROTULO_ORIGEM: Record<OrigemMissao, string> = { livre: "Livre", feature: "Feature", ocorrencia: "Ocorrência", pedido: "Pedido", projeto: "Projeto" };
export const ROTULO_PAPEL: Record<Papel, string> = { piloto: "Piloto", executor: "Executor", explorador: "Explorador", revisor: "Revisor", nenhum: "CLI" };

export function tomDoEstado(e: EstadoMissao): "neutro" | "destaque" | "sucesso" | "aviso" | "alerta" {
  if (e === "concluida") return "sucesso";
  if (e === "falhou") return "alerta";
  if (e === "abortada") return "aviso";
  if (e === "intake") return "neutro";
  return "destaque";
}

/** `#<n> · <CLI> · <papel> · <missão>` (T-02.06). */
export function rotuloPane(p: Pick<Pane, "display_id" | "cli" | "papel">, titulo: string): string {
  return `#${p.display_id} · ${p.cli ?? "shell"} · ${p.papel} · ${titulo}`;
}

export const ROTULO_PORTAO: Record<PortaoMissao, string> = { direction: "Direção", content: "Conteúdo", build: "Construção", qa: "Qualidade" };
/** Papel de worker que cada portão destrava (`null` = não destrava worker). */
export const PAPEL_DO_PORTAO: Record<PortaoMissao, string | null> = { direction: "explorador", content: null, build: "executor", qa: "revisor" };
