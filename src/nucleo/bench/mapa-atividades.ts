// Tabela explícita atividade do Bench → TaskType do harness (Fase 9). Reconciliada com `TASK_TYPES_EMBUTIDOS`; atividade sem mapeamento sai com aviso (nunca adivinha).
export const MAPA_ATIVIDADES: Readonly<Record<string, string>> = {
  "web-interativa": "front",
  css: "front",
  bug: "bug-fix",
  "bug-profundo": "bug-profundo",
  review: "revisar-pr",
  refactor: "refatorar",
  dados: "implementar",
  feature: "implementar",
  docs: "docs",
  qa: "qa",
};

export function taskTypeDaAtividade(atividade: string): string | null {
  return MAPA_ATIVIDADES[atividade] ?? null;
}
