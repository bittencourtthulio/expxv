// Presets de regras da aba Regras (T-20.36): "Tudo no app", "Só atrasadas e erros no Telegram", "Resumo diário". Puros: devolvem `Regra` pronta
// para o repositório; o canal precisa existir (e, se externo, ter consentimento — senão a regra não casa, ver `regras.ts`).
import type { Regra } from "../../compartilhado/alertas";

export type PresetRegra = "tudo_no_app" | "atrasadas_e_erros_no_telegram" | "resumo_diario" | "tarefas_do_telegram";

export function criarRegraDePreset(preset: PresetRegra, canal_id: string, id: string, hora_digest = "18:00"): Regra {
  const base = { id, ativa: true, canal_id, filtros: {}, silencio: {}, efemera_ate: null, origem: "padrao" as const };
  switch (preset) {
    case "tudo_no_app":
      return { ...base, nome: "Tudo no app", tipos: ["*"], agrupamento: { modo: "imediato" }, nivel: "padrao" };
    case "atrasadas_e_erros_no_telegram":
      return { ...base, nome: "Só atrasadas e erros no Telegram", tipos: ["tarefa_atrasada", "erro_sistema", "canal_erro", "missao_falhou", "cota_atingida", "pane_aguardando"], agrupamento: { modo: "imediato" }, nivel: "minimo" };
    case "resumo_diario":
      return { ...base, nome: "Resumo diário", tipos: ["resumo_diario"], agrupamento: { modo: "digest", hora_digest }, nivel: "padrao" };
    case "tarefas_do_telegram":
      return { ...base, nome: "Tarefas, Missões e erros", tipos: ["tarefa_concluida", "tarefa_atrasada", "tarefa_bloqueada", "missao_concluida", "missao_falhou", "erro_sistema", "cota_atingida"], agrupamento: { modo: "imediato" }, nivel: "minimo" };
  }
}
