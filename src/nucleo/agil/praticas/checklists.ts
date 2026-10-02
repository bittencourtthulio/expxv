// T-18.35: checklists editáveis (XP, Lean, DoD da sprint). Itens `auto` vêm das métricas; `manual` ficam `indeterminado` até o humano marcar. Marca manual vence a automática.
import type { MetricaXp } from "./xp";

export interface ItemChecklist { codigo: string; grupo: "xp" | "lean" | "dod" | "dor"; descricao: string; auto: boolean; metrica: string | null }
export interface EstadoChecklist { codigo: string; grupo: ItemChecklist["grupo"]; descricao: string; estado: "ok" | "atencao" | "falha" | "na" | "indeterminado"; fonte: "auto" | "manual"; valor: number | null; nota: string | null }

export const CHECKLIST_XP: readonly ItemChecklist[] = [
  { codigo: "testes_primeiro", grupo: "xp", descricao: "Testes primeiro (TDD)", auto: true, metrica: "tdd_primeiro" },
  { codigo: "vermelho_antes_verde", grupo: "xp", descricao: "Teste vermelho antes do verde", auto: true, metrica: "vermelho_antes_do_verde" },
  { codigo: "integracao_continua", grupo: "xp", descricao: "Integração contínua verde", auto: true, metrica: "ci_verde" },
  { codigo: "commits_pequenos", grupo: "xp", descricao: "Commits pequenos", auto: true, metrica: "commits_pequenos" },
  { codigo: "refatoracao_continua", grupo: "xp", descricao: "Refatoração contínua", auto: true, metrica: "refatoracao" },
  { codigo: "par_revisao", grupo: "xp", descricao: "Par ou revisão independente", auto: true, metrica: "revisao_independente" },
  { codigo: "propriedade_coletiva", grupo: "xp", descricao: "Propriedade coletiva do código", auto: false, metrica: null },
  { codigo: "ritmo_sustentavel", grupo: "xp", descricao: "Ritmo sustentável", auto: false, metrica: null },
];
export const CHECKLIST_LEAN: readonly ItemChecklist[] = [
  { codigo: "limitar_wip", grupo: "lean", descricao: "WIP dentro do limite", auto: false, metrica: null },
  { codigo: "reduzir_espera", grupo: "lean", descricao: "Espera e bloqueios reduzidos", auto: false, metrica: null },
  { codigo: "qualidade_na_fonte", grupo: "lean", descricao: "Qualidade na fonte (retrabalho baixo)", auto: false, metrica: null },
  { codigo: "fluxo_continuo", grupo: "lean", descricao: "Fluxo contínuo de entrega", auto: false, metrica: null },
];

export function avaliarChecklist(itens: readonly ItemChecklist[], metricas: readonly MetricaXp[], manuais: ReadonlyMap<string, { estado: EstadoChecklist["estado"]; nota: string | null }> = new Map()): EstadoChecklist[] {
  const porCodigo = new Map(metricas.map((m) => [m.codigo, m]));
  return itens.map((it): EstadoChecklist => {
    const base = { codigo: it.codigo, grupo: it.grupo, descricao: it.descricao };
    const man = manuais.get(it.codigo);
    if (man) return { ...base, estado: man.estado, fonte: "manual", valor: null, nota: man.nota };
    if (!it.auto || !it.metrica) return { ...base, estado: "indeterminado", fonte: "manual", valor: null, nota: null };
    const m = porCodigo.get(it.metrica);
    if (!m) return { ...base, estado: "indeterminado", fonte: "auto", valor: null, nota: "métrica ausente" };
    return { ...base, estado: m.estado, fonte: "auto", valor: m.valor, nota: m.detalhe };
  });
}
