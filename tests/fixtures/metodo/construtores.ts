// Construtores de Trabalho/Task/Fase para testes de regras, sinaleira e grafo (sem tocar disco).
import type { EventoRastro, Fase, Task, Trabalho } from "../../../src/nucleo/metodo/tipos";

export function tk(id: string, o: Partial<Task> = {}): Task {
  return {
    id,
    titulo: `Task ${id}`,
    fase: "F-01.1",
    status: "pendente",
    depende_de: [],
    paralelizavel: false,
    suite: "nao_executada",
    concluida_em: null,
    objetivo: "obj",
    criterio_aceite: "ok",
    teste_integracao: "integra",
    teste_funcional: "funciona",
    teste_regressao: null,
    arquivo: "docs/x/sprint-01/tasks.md",
    duracao_observada_ms: null,
    ...o,
  };
}

export function fs(id: string, tasks: Task[], o: Partial<Fase> = {}): Fase {
  return {
    id,
    titulo: id,
    status: "em_andamento",
    criterio_saida: "a suite passa",
    paralelizavel: false,
    paralela_com: [],
    tasks,
    arquivo: "docs/x/sprint-01/fases.md",
    declarada: true,
    ...o,
  };
}

export function trab(o: Partial<Trabalho> = {}, tasks: Task[] = [tk("T-01.01")]): Trabalho {
  const base: Trabalho = {
    id: "x",
    tipo: "feature",
    ferramenta: "sprintx",
    layout: "sprintx_features",
    origem_buildx: null,
    feature_id: null,
    titulo: "x",
    tipo_ocorrencia: null,
    estagio: "f6",
    estagio_declarado: "f6",
    status: "em_andamento",
    pasta: "docs/sprintx/features/x",
    worktree: null,
    sprints: [{ id: "sprint-01", titulo: "s", status: "em_andamento", criterio_saida: "suite passa", fases: [fs("F-01.1", tasks)], arquivo: "docs/x/sprint-01/sprint.md" }],
    bloqueios: [],
    veredito_auditoria: "sim",
    veredito_qa: null,
    entrega: null,
    caminho_critico_declarado: [],
    grafo: { nos: [], arestas: [], ciclos: [], dependencias_inexistentes: [], caminho_critico: [], prontas: [] },
    features: [],
    prodx: null,
    raio: null,
    decisoes_pendentes: 0,
    divergencias: [],
    ultima_atividade: null,
    eventos_total: 0,
    sinaleira: { cor: "cinza", motivo: "", motivos: [] },
    violacoes: [],
  };
  return { ...base, ...o };
}

export function ev(o: Partial<EventoRastro>): EventoRastro {
  return {
    ts: "2026-09-29T11:00:00Z",
    expx_eventos: 1,
    trabalho_id: "x",
    ferramenta: "sprintx",
    origem: "skill",
    evento: "task_iniciada",
    fase: "f6",
    task: null,
    agente: "principal",
    resultado: "ok",
    detalhe: "",
    arquivos: [],
    ...o,
  };
}
