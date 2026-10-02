// Mapeamento task → coluna (D-107). PURO. A primeira regra que casa vence; o DISCO vence o banco quando divergem (CT-10.13), exceto onde a regra cita o banco.
import type { ColunaBoard, SeloCard } from "../../compartilhado/custo";
import type { EstadoTaskBanco, TaskDoMetodo, VereditoMetodo } from "./portas";

export interface EntradaColuna {
  task: TaskDoMetodo;
  banco: EstadoTaskBanco | null;
  /** todas as tasks do trabalho por id (para dependências). */
  statusPorTask: ReadonlyMap<string, TaskDoMetodo["status"]>;
  vereditoQa: VereditoMetodo;
  temViolacao: boolean;
}
export interface ResultadoColuna {
  coluna: ColunaBoard;
  selos: SeloCard[];
  /** regra 1: some do quadro (só no filtro "descartados"); o custo permanece. */
  oculta: boolean;
  regra: number;
}

const APROVADO = (v: VereditoMetodo): boolean => v === "aprovado" || v === "sim";
/** Dependência fechada = a task citada existe e está `concluida`; inexistente conta como ABERTA (nunca libera por engano). */
export const dependenciasFechadas = (deps: readonly string[], status: ReadonlyMap<string, TaskDoMetodo["status"]>): boolean => deps.every((d) => status.get(d) === "concluida");

export function colunaDoCard(e: EntradaColuna): ResultadoColuna {
  const selos: SeloCard[] = [];
  if (e.temViolacao) selos.push("violacao");
  if (e.banco === "aberta" || e.banco === "reivindicada") selos.push("delegada");
  const fim = (coluna: ColunaBoard, regra: number, extra: SeloCard[] = []): ResultadoColuna => ({ coluna, selos: ordenarSelos([...selos, ...extra]), oculta: false, regra });
  const s = e.task.status;
  if (e.banco === "descartada") return { coluna: "backlog", selos: ordenarSelos([...selos, "descartada"]), oculta: true, regra: 1 };
  if (e.banco === "validada" || (s === "concluida" && APROVADO(e.vereditoQa))) return fim("validado", 2);
  if (s === "concluida" && e.banco === "entregue") return fim("em_revisao", 3);
  if (s === "concluida") return fim("concluido", 4);
  if (s === "em_andamento" || e.banco === "reivindicada") return fim("em_andamento", 5);
  if (s === "bloqueada") return fim("backlog", 6, ["bloqueada"]);
  if (s === "pendente" && dependenciasFechadas(e.task.depende_de, e.statusPorTask)) return fim("a_fazer", 7, ["pronta"]);
  return fim("backlog", 8);
}

const ORDEM_SELOS: readonly SeloCard[] = ["pronta", "bloqueada", "violacao", "delegada", "descartada"];
const ordenarSelos = (l: SeloCard[]): SeloCard[] => ORDEM_SELOS.filter((x) => l.includes(x));
