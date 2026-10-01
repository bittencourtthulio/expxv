// Lista de kinds gravados pelas skills (F-… §2.1 e §1). Fora daqui vira 'desconhecido'.

export const KINDS_CONTRATO = [
  "orquestrador", "sprint", "fases", "tasks", "plano", "bloqueios", "ocorrencia", "causa_raiz", "qa",
  "base_indice", "relatorio_tecnico", "relatorio_uso", "relatorios_indice",
  // buildx
  "projeto", "premissas", "mapa", "recursao", "validacao", "relatorio",
] as const;

/** Kinds que as skills gravam e o contrato do painel oficial não lista. */
export const KINDS_EXTRAS = [
  "decisoes", "estimativa", "estimativa_historico", "fechamento", "entrega",
  // prodx
  "produto", "pedido", "existencia", "avaliacao", "veredito", "briefing", "produto_indice",
  // designx
  "design_system", "design_audit", "design_log", "design_debt",
] as const;

export const KINDS_CONHECIDOS: ReadonlySet<string> = new Set<string>([...KINDS_CONTRATO, ...KINDS_EXTRAS]);

export const KIND_DESCONHECIDO = "desconhecido";

export function normalizarKind(valor: unknown): string {
  if (typeof valor !== "string") return KIND_DESCONHECIDO;
  const k = valor.trim().toLowerCase();
  return KINDS_CONHECIDOS.has(k) ? k : KIND_DESCONHECIDO;
}
