// Delegar card a um worker (T-10.19; D-107). O ADE NÃO escreve em `docs/**`: gera o briefing (na pasta do produto, pela porta), cria a linha de `task` do banco e abre o Pane pelo
// roteador. Só para card `a_fazer` + `pronta` de Missão squad/agêntico (nunca cria Missão); sem `confirmar:true` não há efeito. As decisões de infraestrutura entram por porta.
import type { CardBoard, ColunaBoard, InfoWip, PedidoDelegarCard, RespostaDelegarCard } from "../../compartilhado/custo";
import { gerarBriefing } from "../orquestracao/briefing";
import { ErroBoard } from "./erros";
import { wipAtingido } from "./movimento";
import type { TaskDoMetodo } from "./portas";

export interface MissaoParaDelegar {
  id: string;
  workspace_id: string;
  modo: "livre" | "squad" | "agentico";
  estado: string;
  trabalho_id: string | null;
  /** a Missão tem worktree do trabalho (sem ele não se delega). */
  tem_worktree: boolean;
}
export interface PortaDelegar {
  missao(missionId: string): MissaoParaDelegar | null;
  /** cria a linha de `task` (papel executor). Já existir lança `DuplicadoErro` do domínio (índice `ux_task_ref`) — o núcleo converte em `conflict`. */
  criarTask(d: { mission_id: string; task_ref: string; titulo: string; briefing_path: string }): { id: string };
  /** grava o briefing na pasta do produto da Missão e devolve o caminho RELATIVO. Nunca em `docs/**`. */
  gravarBriefing(d: { mission_id: string; task_ref: string; markdown: string }): Promise<string>;
  /** abre o Pane do worker pelo roteador (`task_type: implementar`, `origem: usuario`). */
  abrirWorker(d: { workspace_id: string; mission_id: string; task_ref: string; titulo: string; briefing_path: string }): Promise<{ pane_id: string; recibo: string }>;
  /** desfaz a task criada quando o Pane não abriu (sem deixar card "delegado" fantasma). */
  descartarTask(taskId: string): void;
}
export interface EntradaDelegar {
  pedido: PedidoDelegarCard;
  card: CardBoard | null;
  task: TaskDoMetodo | null;
  wip: Record<ColunaBoard, InfoWip>;
  /** P-80: bloqueio opt-in por workspace. `bloquear` = o workspace ligou a opção; `estourado` = o custo conhecido da Missão passou do teto. */
  teto?: { bloquear: boolean; estourado: boolean };
  /** estimativa histórica devolvida no recibo (nunca como custo do card). */
  estimativa?: RespostaDelegarCard["estimativa"];
}

/** Contrato do briefing a partir dos campos da task do método (objetivo, critério, testes). */
export function contratoDoBriefing(t: TaskDoMetodo): string {
  const linha = (rot: string, v: string | null): string | null => (v && v.trim() !== "" ? `**${rot}:** ${v.trim()}` : null);
  return [
    linha("Objetivo", t.objetivo),
    linha("Critério de aceite", t.criterio_aceite),
    linha("Teste de integração", t.teste_integracao),
    linha("Teste funcional", t.teste_funcional),
    linha("Teste de regressão", t.teste_regressao),
    `Task do método: ${t.id}. O estado da task é do método: não edite arquivos de estado; entregue pelo handoff.`,
  ]
    .filter((x): x is string => x !== null)
    .join("\n\n");
}

export async function delegarCard(e: EntradaDelegar, portas: PortaDelegar): Promise<RespostaDelegarCard> {
  if (e.pedido.confirmar !== true) throw new ErroBoard("invalid", "a delegação exige confirmação explícita", "confirm_required");
  if (e.card === null || e.task === null) throw new ErroBoard("not_found", "card não encontrado", "card_not_found");
  const { card, task } = e;
  const missao = portas.missao(e.pedido.mission_id);
  if (missao === null) throw new ErroBoard("not_found", "Missão não encontrada", "mission_not_found");
  if (missao.workspace_id !== card.workspace_id || missao.trabalho_id !== card.trabalho_id || missao.modo === "livre" || !missao.tem_worktree) {
    throw new ErroBoard("rule_violation", "o card não pertence a uma Missão squad/agêntico com worktree deste trabalho", "not_in_mission");
  }
  if (["concluida", "falhou", "abortada"].includes(missao.estado)) throw new ErroBoard("rule_violation", "a Missão já terminou", "mission_closed");
  if (card.selos.includes("delegada")) throw new ErroBoard("conflict", "o card já foi delegado", "already_delegated");
  if (card.coluna !== "a_fazer" || !card.selos.includes("pronta")) throw new ErroBoard("rule_violation", motivoNaoPronto(card), "not_ready");
  // no limite (total >= limite) um card A MAIS já estoura: `excedido` (total > limite) deixaria passar o último
  if (e.wip.em_andamento.excedido || wipAtingido(e.wip.em_andamento)) throw new ErroBoard("rule_violation", `limite de trabalho em andamento atingido (${e.wip.em_andamento.total}/${e.wip.em_andamento.limite})`, "wip_exceeded");

  if (e.teto?.bloquear === true && e.teto.estourado) throw new ErroBoard("rule_violation", "o teto de custo da Missão foi atingido e este workspace bloqueia novos cards; nada em andamento foi interrompido", "ceiling_reached");

  const markdown = gerarBriefing({ mission_id: missao.id, task_ref: task.id, titulo: task.titulo, papel: "executor", contrato: contratoDoBriefing(task) });
  const briefing_path = await portas.gravarBriefing({ mission_id: missao.id, task_ref: task.id, markdown });
  let criada: { id: string };
  try {
    criada = portas.criarTask({ mission_id: missao.id, task_ref: task.id, titulo: task.titulo, briefing_path });
  } catch (err) {
    if (err instanceof Error && err.name === "DuplicadoErro") throw new ErroBoard("conflict", "o card já foi delegado", "already_delegated");
    throw err;
  }
  try {
    const r = await portas.abrirWorker({ workspace_id: missao.workspace_id, mission_id: missao.id, task_ref: task.id, titulo: task.titulo, briefing_path });
    return { pane_id: r.pane_id, task_ref: task.id, recibo: r.recibo, ...(e.estimativa === undefined ? {} : { estimativa: e.estimativa }) };
  } catch (err) {
    try {
      portas.descartarTask(criada.id);
    } catch {
      /* a task fica `aberta`; o piloto/usuário a vê e pode descartá-la */
    }
    if (err instanceof ErroBoard) throw err;
    throw new ErroBoard("unavailable", "não foi possível abrir o worker", "spawn_failed");
  }
}

function motivoNaoPronto(card: CardBoard): string {
  if (card.selos.includes("bloqueada")) return "a task está bloqueada no método";
  if (card.coluna === "backlog") return "há dependência aberta";
  return `o card está em "${card.coluna}", não em "a_fazer"`;
}
