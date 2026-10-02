// Derivador (b): as tasks do plano ativo do sprintx -> `Progresso`. PURO. Ordem: fases na ordem declarada; dentro da fase, ordem topológica estável
// pelas dependências (`depende_de`); ciclo ou dependência inexistente nunca trava (a ordem declarada decide). Itens agrupados por fase (cabeçalho curto).
import { cortarRotulo, JANELA_ATIVIDADE_MS, LIMITE_ITENS_PROGRESSO, type EstadoItemProgresso, type ItemProgresso, type Progresso, type ResultadoProgresso } from "../../compartilhado/progresso";
import type { Sprint, StatusTask, Task } from "../metodo/tipos";

export interface TrabalhoParaProgresso {
  id: string;
  titulo: string;
  status: string;
  ultima_atividade: string | null;
  sprints: ReadonlyArray<Pick<Sprint, "id" | "titulo"> & { fases: ReadonlyArray<{ id: string; titulo: string; tasks: ReadonlyArray<Pick<Task, "id" | "titulo" | "status" | "depende_de" | "concluida_em" | "duracao_observada_ms">> }> }>;
}

const ESTADO: Readonly<Record<StatusTask, EstadoItemProgresso>> = { pendente: "pendente", em_andamento: "em_andamento", concluida: "concluido", bloqueada: "aguardando" };

type TaskLida = TrabalhoParaProgresso["sprints"][number]["fases"][number]["tasks"][number];

/** Ordem topológica estável (Kahn) só entre as tasks da MESMA fase; o que sobra de um ciclo entra na ordem declarada. */
export function ordenarPorDependencia<T extends { id: string; depende_de: readonly string[] }>(tasks: readonly T[]): T[] {
  const ids = new Set(tasks.map((t) => t.id));
  const pendentes = tasks.map((t) => ({ t, deps: new Set(t.depende_de.filter((d) => ids.has(d) && d !== t.id)) }));
  const saida: T[] = [];
  const feitos = new Set<string>();
  while (pendentes.length > 0) {
    const i = pendentes.findIndex((p) => [...p.deps].every((d) => feitos.has(d)));
    const [escolhido] = pendentes.splice(i === -1 ? 0 : i, 1);
    if (escolhido === undefined) break;
    saida.push(escolhido.t);
    feitos.add(escolhido.t.id);
  }
  return saida;
}

const ms = (iso: string | null): number | undefined => {
  if (iso === null) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
};

export function totalDeTasks(t: TrabalhoParaProgresso): number {
  return t.sprints.reduce((a, s) => a + s.fases.reduce((b, f) => b + f.tasks.length, 0), 0);
}

/**
 * O sprintx está em execução? Uma task reivindicada (em andamento) OU trabalho começado e não terminado, com atividade recente. Plano inteiro concluído NÃO é
 * "em execução" (o serviço só publica o fim de um progresso que viu ativo), e uma task "em andamento" esquecida há horas também não.
 */
export function sprintxAtivo(t: TrabalhoParaProgresso, agora: number, janelaMs: number = JANELA_ATIVIDADE_MS): boolean {
  const todas = t.sprints.flatMap((s) => s.fases.flatMap((f) => f.tasks));
  if (todas.length === 0) return false;
  const ultima = ms(t.ultima_atividade);
  if (ultima === undefined || agora - ultima > janelaMs) return false;
  const feitas = todas.filter((x) => x.status === "concluida").length;
  return todas.some((x) => x.status === "em_andamento") || (feitas > 0 && feitas < todas.length && t.status === "em_andamento");
}

export function derivarDoSprintx(t: TrabalhoParaProgresso, workspaceId: string, opcoes: { iniciadoEm?: number; agora?: number } = {}): Progresso | null {
  const fases = t.sprints.flatMap((s) => s.fases.map((f) => ({ sprint: s, fase: f })));
  const todas: TaskLida[] = fases.flatMap(({ fase }) => [...fase.tasks]);
  if (todas.length === 0) return null;
  const porId = new Map(todas.map((x) => [x.id, x]));
  const comCabecalho = fases.filter(({ fase }) => fase.tasks.length > 0).length > 1;
  const itens: ItemProgresso[] = [];
  for (const { fase } of fases) {
    for (const task of ordenarPorDependencia(fase.tasks)) {
      const estado = ESTADO[task.status] ?? "pendente";
      const item: ItemProgresso = { id: task.id, rotulo: cortarRotulo(`${task.id} ${task.titulo}`), estado };
      if (comCabecalho) item.grupo = cortarRotulo(`${fase.id} · ${fase.titulo}`, 38);
      if (estado === "pendente") {
        const faltam = task.depende_de.filter((d) => porId.get(d)?.status !== undefined && porId.get(d)?.status !== "concluida");
        if (faltam.length > 0) item.detalhe = `depende de ${faltam.slice(0, 2).join(", ")}${faltam.length > 2 ? "…" : ""}`;
      } else if (estado === "aguardando") item.detalhe = "bloqueada";
      const fim = ms(task.concluida_em);
      if (estado === "concluido" && fim !== undefined) {
        item.fim_em = fim;
        if (task.duracao_observada_ms !== null && task.duracao_observada_ms > 0) item.desde = fim - task.duracao_observada_ms;
      }
      itens.push(item);
    }
  }
  const lidos = itens.slice(0, LIMITE_ITENS_PROGRESSO);
  const feitos = lidos.filter((i) => i.estado === "concluido").length;
  const resultado: ResultadoProgresso = feitos === lidos.length ? "concluido" : lidos.some((i) => i.estado === "em_andamento") ? "em_andamento" : lidos.some((i) => i.estado === "aguardando") ? "aguardando" : "em_andamento";
  const agora = opcoes.agora ?? Date.now();
  return {
    id: `sx:${t.id}`,
    origem: "sprintx",
    titulo: `Sprint: ${cortarRotulo(t.titulo, 42)}`,
    itens: lidos,
    concluido: resultado === "concluido",
    workspace_id: workspaceId,
    resultado,
    previsto: false,
    iniciado_em: opcoes.iniciadoEm ?? ms(t.ultima_atividade) ?? agora,
    fim_em: resultado === "concluido" ? (ms(t.ultima_atividade) ?? agora) : null,
  };
}
