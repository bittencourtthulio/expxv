// T-16.03 · Catálogo das etapas e pipelines do método (Fase 16 §c). PURO: dados + `comandoDaEtapa`.
// O Maestro nunca "pula por dentro" de uma skill (D-226): o catálogo só diz QUAL comando abre cada etapa; o nível decide
// o que é despachado (rigidez/matriz). Comando é sempre `/expx:<skill-etapa> <argumento>` (D-20), com argumento normalizado.
import type { ComandoSugerido } from "../../../compartilhado/dominio";
import type { EtapaId, PipelineId, TipoEtapa } from "../../../compartilhado/maestro";
import { comandoDeSkill, SKILLS_SOMENTE_HUMANO } from "../../metodo/comandos";

export type TipoArgumento = "texto" | "id" | "alvo" | null;
/** Condição de EVIDÊNCIA do disco para a etapa entrar no plano. */
export type CondicaoEtapa = "legado" | "legado_raio_medio" | "convencoes" | "design_system" | "sem_produto" | "sem_perfil_legado";

export interface EtapaDef {
  id: EtapaId;
  /** grupo/skill para a tela (sprintx, runx, prodx…). */
  skill: string;
  nome: string;
  /** nome da skill sem prefixo (ex.: `runx-causa`); `null` = sem comando (consulta/rápido/humano). */
  comando: string | null;
  argumento: TipoArgumento;
  tipo: TipoEtapa;
  /** a skill PERGUNTA: o terminal fica `aguardando`; o Maestro nunca reenvia nem responde sozinho. */
  interativa: boolean;
  humano: boolean;
  /** etapa de piso em todo pipeline em que aparece (nunca omitida quando aplicável; I10). */
  piso: boolean;
  condicao: CondicaoEtapa | null;
  /** TaskType do harness (faixa padrão/avaliador). */
  task_type: string;
}

const d = (id: EtapaId, skill: string, nome: string, comando: string | null, argumento: TipoArgumento, tipo: TipoEtapa, task_type: string, extra: Partial<Pick<EtapaDef, "interativa" | "humano" | "piso" | "condicao">> = {}): EtapaDef => ({
  id, skill, nome, comando, argumento, tipo, task_type, interativa: extra.interativa ?? false, humano: extra.humano ?? false, piso: extra.piso ?? false, condicao: extra.condicao ?? null,
});

export const ETAPAS: readonly EtapaDef[] = [
  d("memox.consultar", "memox", "Consultar memória", null, "texto", "consulta", "descobrir"),
  d("prodx.p1", "prodx", "Contexto de produto", "prodx-produto", "texto", "utilitario", "planejar", { interativa: true, piso: true, condicao: "sem_produto" }),
  d("prodx.p0", "prodx", "Triagem do pedido", "prodx-triar", "texto", "utilitario", "triar"),
  d("prodx.p25", "prodx", "Avaliação do pedido", "prodx-avaliar", "id", "investigador", "descobrir", { interativa: true }),
  d("prodx.assinatura", "prodx", "Assinatura do veredito (humano)", null, null, "humano", "geral", { humano: true }),
  d("prodx.briefing", "prodx", "Briefing", "prodx-briefing", "id", "utilitario", "docs"),
  d("legadox.perfil", "legadox", "Perfil do legado", "legadox-perfil", "alvo", "investigador", "descobrir"),
  d("legadox.raio", "legadox", "Raio de impacto", "legadox-raio", "id", "investigador", "descobrir", { piso: true, condicao: "legado" }),
  d("legadox.caracterizar", "legadox", "Testes de caracterização", "legadox-caracterizar", "id", "implementador", "implementar", { condicao: "legado_raio_medio" }),
  d("legadox.divida", "legadox", "Dívida técnica", "legadox-divida", "id", "utilitario", "docs"),
  d("legadox.manual", "legadox", "Manual do legado", "legadox-manual", "id", "utilitario", "docs"),
  d("runx.e1", "runx", "Causa raiz", "runx-causa", "texto", "investigador", "bug-profundo", { interativa: true }),
  d("runx.e2", "runx", "Plano da correção", "runx-plano", "id", "planejador", "planejar"),
  d("runx.e3", "runx", "Correção (TDD)", "runx-fix", "id", "implementador", "bug-fix"),
  d("runx.e4", "runx", "QA", "runx-qa", "id", "avaliador", "qa"),
  d("runx.e5", "runx", "Relatórios e fechamento", "runx-relatar", "id", "utilitario", "docs"),
  d("sprintx.f1", "sprintx", "Base de conhecimento", "sprintx-base", "texto", "planejador", "planejar"),
  d("sprintx.f2", "sprintx", "Descoberta", "sprintx-descoberta", "id", "planejador", "planejar", { interativa: true }),
  d("sprintx.f3", "sprintx", "Sprints, fases e tasks", "sprintx-sprints", "id", "planejador", "planejar"),
  d("sprintx.f35", "sprintx", "Estimativa", "sprintx-estimar", "id", "utilitario", "triar"),
  d("sprintx.f4", "sprintx", "Orquestrador", "sprintx-orquestrador", "id", "planejador", "docs"),
  d("sprintx.f5", "sprintx", "Auditoria do plano", "sprintx-auditoria", "id", "avaliador", "auditar"),
  d("sprintx.f6", "sprintx", "Execução", "sprintx-executar", "id", "implementador", "implementar"),
  d("stackx.detectar", "stackx", "Detectar convenções", "stackx-detectar", "alvo", "investigador", "descobrir"),
  d("stackx.check", "stackx", "Conferir convenções", "stackx-check", "alvo", "avaliador", "auditar", { condicao: "convencoes" }),
  d("stackx.atualizar", "stackx", "Atualizar convenções", "stackx-atualizar", "alvo", "utilitario", "docs"),
  d("designx.cartography", "designx", "Cartografia do design", "designx-cartography", "alvo", "investigador", "descobrir"),
  d("designx.audit", "designx", "Auditoria do design", "designx-audit", "alvo", "avaliador", "auditar", { condicao: "design_system" }),
  d("mergex.check", "mergex", "Portão de prontidão", "mergex-check", "id", "utilitario", "triar"),
  d("mergex.atencao", "mergex", "Atenção humana no diff", "mergex-atencao", "id", "avaliador", "revisar-pr"),
  d("mergex.qa", "mergex", "Pacote do QA", "mergex-qa", "id", "utilitario", "triar"),
  d("mergex.pr", "mergex", "Push e pull request", "mergex-pr", "id", "utilitario", "triar"),
  d("mergex.revisar", "mergex", "Revisão e merge (humano)", "mergex-revisar", null, "humano", "geral", { humano: true }),
  d("buildx.condutor", "buildx", "Condutor do projeto", "buildx", "texto", "planejador", "planejar", { interativa: true }),
  d("onboarding.executar", "onboarding", "Preparar o repositório", "onboarding", "alvo", "utilitario", "docs"),
  d("rapido.executar", "rapido", "Alteração rápida", null, "texto", "implementador", "bug-fix", { piso: true }),
  d("consulta.rag", "consulta", "Consulta ao conhecimento", null, "texto", "consulta", "descobrir"),
];

const POR_ID = new Map<string, EtapaDef>(ETAPAS.map((e) => [e.id, e]));
export const etapaDef = (id: string): EtapaDef | null => POR_ID.get(id) ?? null;
export const ehEtapaId = (id: string): id is EtapaId => POR_ID.has(id);

// ---------------------------------------------------------------- pipelines
export interface PassoPipeline {
  etapa: EtapaId;
  /** piso neste pipeline (ex.: `prodx.p0` no prodx), além do flag da etapa. */
  piso?: boolean;
  /** a condição da etapa é atendida pelo passo anterior do próprio pipeline (ex.: `stackx.check` depois de `stackx.detectar`). */
  condicao_satisfeita?: boolean;
  /** laço de reprovação: etapa a que se volta (e último passo do laço = esta). */
  laco?: EtapaId;
}
export interface PipelineDef {
  id: PipelineId;
  nome: string;
  passos: PassoPipeline[];
}
const p = (...ids: Array<EtapaId | PassoPipeline>): PassoPipeline[] => ids.map((i) => (typeof i === "string" ? { etapa: i } : i));

export const PIPELINES: Readonly<Record<PipelineId, PipelineDef>> = {
  runx: {
    id: "runx", nome: "Bug (runx)",
    passos: p("memox.consultar", "prodx.p0", "legadox.raio", "runx.e1", "runx.e2", "legadox.caracterizar", "runx.e3", "stackx.check", "designx.audit", { etapa: "runx.e4", laco: "runx.e3" }, "mergex.check", "mergex.atencao", "mergex.qa", "mergex.pr", "runx.e5"),
  },
  sprintx: {
    id: "sprintx", nome: "Feature (sprintx)",
    passos: p("memox.consultar", "prodx.p0", "sprintx.f1", "sprintx.f2", "legadox.raio", "sprintx.f3", "sprintx.f35", "sprintx.f4", { etapa: "sprintx.f5", laco: "sprintx.f3" }, "legadox.caracterizar", "sprintx.f6", "stackx.check", "designx.audit", "mergex.check", "mergex.atencao", "mergex.qa", "mergex.pr"),
  },
  sprintx_legadox: {
    id: "sprintx_legadox", nome: "Refatoração / legado (sprintx + legadox)",
    passos: p("legadox.perfil", "memox.consultar", "prodx.p0", "sprintx.f1", "sprintx.f2", { etapa: "legadox.raio", piso: true }, "sprintx.f3", "sprintx.f35", "sprintx.f4", { etapa: "sprintx.f5", laco: "sprintx.f3" }, "legadox.caracterizar", "sprintx.f6", "legadox.manual", "legadox.divida", "stackx.check", "designx.audit", "mergex.check", "mergex.atencao", "mergex.qa", "mergex.pr"),
  },
  prodx: {
    id: "prodx", nome: "Pedido cru (prodx)",
    passos: p("prodx.p1", { etapa: "prodx.p0", piso: true }, "prodx.p25", "prodx.assinatura", "prodx.briefing"),
  },
  buildx: { id: "buildx", nome: "Projeto inteiro (buildx)", passos: p("buildx.condutor") },
  mergex: { id: "mergex", nome: "Entrega (mergex)", passos: p("mergex.check", "mergex.atencao", "mergex.qa", "mergex.pr", "mergex.revisar") },
  stackx: { id: "stackx", nome: "Convenções (stackx)", passos: p("stackx.detectar", { etapa: "stackx.check", condicao_satisfeita: true }) },
  designx: { id: "designx", nome: "Design (designx)", passos: p("designx.cartography", { etapa: "designx.audit", condicao_satisfeita: true }) },
  onboarding: { id: "onboarding", nome: "Onboarding do método", passos: p("onboarding.executar") },
  rapido: { id: "rapido", nome: "Alteração rápida", passos: p("legadox.raio", "rapido.executar") },
  consulta: { id: "consulta", nome: "Consulta", passos: p("consulta.rag") },
  controle: { id: "controle", nome: "Controle do Maestro", passos: [] },
};

/** Intenção → pipeline base (nível 1 troca bug/feature/refatoracao por `rapido`; é o `planejar` que decide). */
export const PIPELINE_DA_INTENCAO: Readonly<Record<string, PipelineId | null>> = {
  bug: "runx", feature: "sprintx", refatoracao: "sprintx_legadox", pedido: "prodx", projeto: "buildx", entrega: "mergex",
  duvida: "consulta", historico: "consulta", convencoes: "stackx", design: "designx", onboarding: "onboarding", controle: "controle", desconhecida: null,
};
/** Pipelines que o nível 1 (Relâmpago) substitui por `rapido`. */
export const PIPELINES_SUBSTITUIVEIS_NO_NIVEL_1: readonly PipelineId[] = ["runx", "sprintx", "sprintx_legadox"];

// ---------------------------------------------------------------- comando
export interface OpcoesComandoEtapa {
  /** `buildx` → `buildx-retomar <projeto_id>`. */
  retomar?: boolean;
}
/**
 * Comando exato da etapa (reusa `comandoDeSkill`): `/expx:runx-causa <texto>` no Claude Code, `/runx-causa …` no OpenCode.
 * Etapa sem comando (consulta/rápido/humana) ou argumento vazio ⇒ `comando: ""` com `motivo_bloqueio`. Nunca lança.
 */
export function comandoDaEtapa(etapa: EtapaId, argumento: string | null | undefined, cli: string | null | undefined, opcoes: OpcoesComandoEtapa = {}): ComandoSugerido {
  const def = etapaDef(etapa);
  const base = { pane_separado: def?.tipo === "avaliador", somente_humano: false, motivo_bloqueio: null as string | null };
  if (def === null) return { ...base, comando: "", motivo_bloqueio: "Etapa desconhecida." };
  if (def.humano) {
    return { ...base, comando: "", somente_humano: true, motivo_bloqueio: "Ação humana: o ADE leva você ao arquivo, mas nunca dispara." };
  }
  if (def.comando === null) return { ...base, comando: "", motivo_bloqueio: "Esta etapa não usa comando do método." };
  const skill = etapa === "buildx.condutor" && opcoes.retomar === true ? "buildx-retomar" : def.comando;
  if (SKILLS_SOMENTE_HUMANO.includes(skill)) return { ...base, comando: "", somente_humano: true, motivo_bloqueio: "Ação humana: o ADE leva você ao arquivo, mas nunca dispara." };
  const r = comandoDeSkill(skill, argumento, cli);
  return { ...r, pane_separado: def.tipo === "avaliador" };
}

/** Etapas obrigatórias (piso/humano): não podem ter `modo_execucao: desligada` (V5). */
export const etapaObrigatoria = (id: string): boolean => {
  const e = etapaDef(id);
  return e !== null && (e.piso || e.humano);
};
