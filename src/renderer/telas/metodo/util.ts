import type { CorSinaleira, StatusTask, StatusTrabalho, Task, TipoViolacao, Trabalho, VereditoTexto } from "../../../nucleo/metodo/tipos";

const ESTAGIOS: Record<string, string> = {
  f1: "F1 · Base de conhecimento", f2: "F2 · Descoberta", f3: "F3 · Plano de sprints", f4: "F4 · Orquestrador", f5: "F5 · Auditoria", f6: "F6 · Execução",
  e1: "E1 · Investigação", e2: "E2 · Plano", e3: "E3 · Correção", e4: "E4 · QA", e5: "E5 · Relatório",
  p0: "P0 · Triagem", p1: "P1 · Produto", p2: "P2 · Avaliação", p3: "P3 · Existência", p4: "P4 · Avaliação", p5: "P5 · Veredito",
  b1: "B1 · Escopo", b2: "B2 · Stack", b3: "B3 · Features", b4: "B4 · Construção", b5: "B5 · Validação", b6: "B6 · Fechamento",
};
export const rotuloEstagio = (e: string): string => ESTAGIOS[e.toLowerCase()] ?? e.toUpperCase();

export const ROTULO_STATUS_TRABALHO: Record<StatusTrabalho, string> = {
  nao_iniciado: "Não iniciado", em_andamento: "Em andamento", bloqueado: "Bloqueado", concluido: "Concluído",
};
export const ROTULO_STATUS_TASK: Record<StatusTask, string> = {
  pendente: "Pendente", em_andamento: "Em andamento", concluida: "Concluída", bloqueada: "Bloqueada",
};

export const TEXTO_VIOLACAO: Record<TipoViolacao, string> = {
  teste_ausente: "Task sem os testes exigidos (integração e funcional)",
  regressao_ausente: "Correção sem teste de regressão",
  concluida_sem_verde: "Task concluída sem a suíte verde",
  paralela_com_dependencia: "Task paralela que depende de outra",
  sem_criterio_saida: "Fase ou sprint sem critério de saída",
  dependencia_inexistente: "Depende de uma task que não existe",
  ciclo_dependencia: "Ciclo de dependências no plano",
  estagio_incoerente: "Estágio declarado não bate com o que está no disco",
  bloqueio_antigo: "Bloqueio aberto há muito tempo",
};
export const textoViolacao = (t: string): string => (TEXTO_VIOLACAO as Record<string, string>)[t] ?? t;

export const ROTULO_COR: Record<CorSinaleira, { rotulo: string; glifo: string }> = {
  verde: { rotulo: "Em dia", glifo: "✓" },
  amarelo: { rotulo: "Atenção", glifo: "!" },
  vermelho: { rotulo: "Parado", glifo: "✕" },
  cinza: { rotulo: "Sem sinal", glifo: "–" },
};

export const rotuloVeredito = (v: VereditoTexto | null): string =>
  v === "sim" || v === "aprovado" ? "Aprovado" : v === "nao" || v === "reprovado" ? "Reprovado" : "Sem veredito";

/** Tempo de parede observado no rastro; nunca "esforço". */
export function formatarDuracao(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function tasksDe(t: Trabalho): Task[] {
  const r: Task[] = [];
  for (const s of t.sprints) for (const f of s.fases) for (const k of f.tasks) r.push(k);
  return r;
}

export interface CardQuadro {
  task: Task;
  pronta: boolean;
  /** descrição do bloqueio aberto da task, quando existe. */
  bloqueio: string | null;
}

export const COLUNAS_QUADRO: readonly StatusTask[] = ["pendente", "em_andamento", "concluida", "bloqueada"];

/** Distribui as tasks em colunas por status; "pronta" = pendente com todas as dependências concluídas. */
export function montarQuadro(t: Trabalho): Record<StatusTask, CardQuadro[]> {
  const tasks = tasksDe(t);
  const status = new Map(tasks.map((k) => [k.id, k.status]));
  const prontas = new Set(t.grafo.prontas);
  const bloqueios = new Map<string, string>();
  for (const b of t.bloqueios) if (b.aberto && b.task) bloqueios.set(b.task, b.descricao);
  const col: Record<StatusTask, CardQuadro[]> = { pendente: [], em_andamento: [], concluida: [], bloqueada: [] };
  for (const k of tasks) {
    const pronta = k.status === "pendente" && (prontas.has(k.id) || k.depende_de.every((d) => status.get(d) === "concluida"));
    col[k.status].push({ task: k, pronta, bloqueio: bloqueios.get(k.id) ?? null });
  }
  return col;
}
