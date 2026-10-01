// TaskTypes embutidos, gesto do método → TaskType (D-103) e faixa padrão por tipo (T-09.10). Tudo é DADO editável:
// nenhum nome de modelo aqui, só faixas. Os embutidos são gravados em `task_type` (embutido=1) pela camada de boot.
import type { Faixa, TaskTypeEntrada } from "../../compartilhado/harness";

export const TASK_TYPES_EMBUTIDOS: readonly TaskTypeEntrada[] = [
  { slug: "implementar", categoria: "desenvolvimento", rotulo: "Implementar", descricao: "Implementar uma task do plano" },
  { slug: "bug-fix", categoria: "desenvolvimento", rotulo: "Corrigir bug", descricao: "Correção localizada de defeito" },
  { slug: "bug-profundo", categoria: "desenvolvimento", rotulo: "Bug profundo", descricao: "Defeito sem causa óbvia, que exige investigação" },
  { slug: "refatorar", categoria: "desenvolvimento", rotulo: "Refatorar", descricao: "Reorganizar código sem mudar comportamento" },
  { slug: "front", categoria: "desenvolvimento", rotulo: "Interface", descricao: "Ajustes de tela e componentes" },
  { slug: "auditar", categoria: "revisao", rotulo: "Auditar", descricao: "Auditoria independente do plano ou da entrega" },
  { slug: "qa", categoria: "revisao", rotulo: "QA", descricao: "Validar a entrega contra o plano" },
  { slug: "revisar-pr", categoria: "revisao", rotulo: "Revisar PR", descricao: "Revisão de pull request" },
  { slug: "triar", categoria: "planejamento", rotulo: "Triar", descricao: "Triagem de pedido cru" },
  { slug: "planejar", categoria: "planejamento", rotulo: "Planejar", descricao: "Planejar feature, projeto ou sprint" },
  { slug: "descobrir", categoria: "planejamento", rotulo: "Descobrir", descricao: "Descoberta de requisitos" },
  { slug: "docs", categoria: "docs", rotulo: "Documentar", descricao: "Documentação e textos" },
  { slug: "pentest", categoria: "seguranca", rotulo: "Segurança", descricao: "Teste de segurança" },
  { slug: "geral", categoria: "geral", rotulo: "Geral", descricao: "Tarefa sem tipo reconhecido" },
];

/** Gesto do método → TaskType (D-103). */
export const GESTO_PARA_TASK_TYPE: Readonly<Record<string, string>> = {
  nova_feature: "planejar",
  executar_task: "implementar",
  "sprintx-auditoria": "auditar",
  "runx-qa": "qa",
  nova_ocorrencia: "bug-fix",
  pedido_cru: "triar",
  projeto: "planejar",
};
/** Gesto desconhecido ⇒ `geral`. */
export function taskTypeDoGesto(gesto: string): string {
  return GESTO_PARA_TASK_TYPE[gesto] ?? "geral";
}

/** Faixa padrão por tipo (ajustável em dado): planejar/auditar → topo; implementar/bug-profundo → alto; bug-fix/refatorar/front/qa → médio; triar/docs → rápido. */
export const FAIXA_PADRAO_POR_TASK_TYPE: Readonly<Record<string, Faixa>> = {
  planejar: "topo",
  auditar: "topo",
  pentest: "topo",
  implementar: "alto",
  "bug-profundo": "alto",
  descobrir: "alto",
  "revisar-pr": "alto",
  geral: "alto",
  "bug-fix": "medio",
  refatorar: "medio",
  front: "medio",
  qa: "medio",
  triar: "rapido",
  docs: "rapido",
};

/** Tipos que devem rodar em provedor DIFERENTE do que o tipo citado usa (D-21: avaliador independente do implementador). */
export const OUTRO_PROVEDOR_QUE: Readonly<Record<string, string>> = { auditar: "implementar" };
