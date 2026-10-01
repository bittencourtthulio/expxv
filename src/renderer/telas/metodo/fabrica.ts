// Construtores de dados para os testes da tela (objetos puros; nada de disco).
import type { GrafoPlano, IndiceProjeto, Task, Trabalho } from "../../../nucleo/metodo/tipos";

export function tk(id: string, o: Partial<Task> = {}): Task {
  return {
    id, titulo: `Task ${id}`, fase: "F-01.1", status: "pendente", depende_de: [], paralelizavel: false, suite: "nao_executada",
    concluida_em: null, objetivo: null, criterio_aceite: null, teste_integracao: null, teste_funcional: null, teste_regressao: null,
    arquivo: "docs/sprintx/features/x/sprint-01/tasks.md", duracao_observada_ms: null, ...o,
  };
}

export function grafoDe(tasks: Task[], extra: Partial<GrafoPlano> = {}): GrafoPlano {
  const ids = new Set(tasks.map((t) => t.id));
  const st = new Map(tasks.map((t) => [t.id, t.status]));
  return {
    nos: tasks.map((t) => ({ id: t.id, depende_de: t.depende_de, fase: t.fase, status: t.status })),
    arestas: tasks.flatMap((t) => t.depende_de.filter((d) => ids.has(d)).map((d) => ({ de: d, para: t.id }))),
    ciclos: [], dependencias_inexistentes: tasks.flatMap((t) => t.depende_de.filter((d) => !ids.has(d)).map((d) => ({ de: t.id, ate: d }))),
    caminho_critico: [],
    prontas: tasks.filter((t) => t.status === "pendente" && t.depende_de.every((d) => st.get(d) === "concluida")).map((t) => t.id),
    ...extra,
  };
}

export function trabalho(tasks: Task[] = [tk("T-01.01")], o: Partial<Trabalho> = {}, grafo: Partial<GrafoPlano> = {}): Trabalho {
  const fases = new Map<string, Task[]>();
  for (const t of tasks) fases.set(t.fase ?? "F-01.1", [...(fases.get(t.fase ?? "F-01.1") ?? []), t]);
  return {
    id: "minha-feature", tipo: "feature", ferramenta: "sprintx", layout: "sprintx_features", origem_buildx: null, feature_id: null,
    titulo: "Minha feature", tipo_ocorrencia: null, estagio: "f6", estagio_declarado: "f6", status: "em_andamento",
    pasta: "docs/sprintx/features/minha-feature", worktree: null,
    sprints: [{
      id: "sprint-01", titulo: "Sprint 1", status: "em_andamento", criterio_saida: "suíte passa", arquivo: "docs/sprintx/features/minha-feature/sprint-01/sprint.md",
      fases: [...fases].map(([id, ts]) => ({ id, titulo: `Fase ${id}`, status: "em_andamento" as const, criterio_saida: "ok", paralelizavel: false, paralela_com: [], tasks: ts, arquivo: "docs/x/fases.md", declarada: true })),
    }],
    bloqueios: [], veredito_auditoria: null, veredito_qa: null, entrega: null, caminho_critico_declarado: [], grafo: grafoDe(tasks, grafo), features: [],
    prodx: null, raio: null, decisoes_pendentes: 0, divergencias: [], ultima_atividade: null, eventos_total: 0,
    sinaleira: { cor: "verde", motivo: "Tudo em dia", motivos: ["Tudo em dia"] }, violacoes: [], ...o,
  };
}

export function indice(trabalhos: Trabalho[] = [], o: Partial<IndiceProjeto> = {}): IndiceProjeto {
  return {
    raiz: "/tmp/proj", gerado_em: "2026-01-01T00:00:00Z", duracao_ms: 5, trabalhos, violacoes: trabalhos.flatMap((t) => t.violacoes), rejeicoes: [], avisos: [],
    camadas: { convencoes: true, perfil_legado: false, design_system: false, produto: false, hooks: false, lock: true, memoria: false },
    artefatos_lidos: 10, ...o,
  };
}
