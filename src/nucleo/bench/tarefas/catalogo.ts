// Catálogo de tarefas (T-12.02/T-12.03): normaliza a semente, valida e expõe as fixtures por slug. A persistência é do repositório; aqui só regra pura.
import { SEMENTE_TAREFAS, type TarefaSemente } from "./semente";
import { validarTarefa } from "./validacao";

export type SementeNormalizada = TarefaSemente;

export const sementes = (): readonly SementeNormalizada[] => SEMENTE_TAREFAS;

/** Fixtures (caminho relativo → conteúdo) de uma tarefa da semente; `{}` para as que não têm. Tarefa criada pelo usuário não tem fixture. */
export function fixturesDaTarefa(slug: string): Readonly<Record<string, string>> {
  return SEMENTE_TAREFAS.find((t) => t.slug === slug)?.fixtures ?? {};
}

/** Ativas da semente que NÃO passam na validação (deve ser vazio). */
export function sementesInvalidas(): string[] {
  return SEMENTE_TAREFAS.filter((t) => validarTarefa({ slug: t.slug, titulo: t.titulo, atividade: t.atividade, tipo: t.tipo, prompt: t.prompt, escopo: t.escopo, checagens: t.checagens, estado: t.estado }) !== null).map((t) => t.slug);
}
