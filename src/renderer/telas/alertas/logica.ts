// Lógica pura da tela Alertas: abas, regras, modelos, filtros e CSV. Sem React.
import type { MetaTipoVisao, ModeloVisao, NivelTemplate, Regra, TipoAlerta, TipoCanal } from "../../../compartilhado/alertas";
import type { ItemSubNav } from "../../componentes/subnavegacao-logica";
import type { AbaAlertas } from "../../estado/alertas-acoes";

export const ABAS_ALERTAS: ReadonlyArray<ItemSubNav<AbaAlertas>> = [
  { id: "alertas", rotulo: "Alertas", icone: "alerta" }, { id: "regras", rotulo: "Regras", icone: "harness" }, { id: "canais", rotulo: "Canais", icone: "chat" },
  { id: "modelos", rotulo: "Modelos", icone: "catalogo" }, { id: "auditoria", rotulo: "Auditoria", icone: "relatorios" },
];

export const ALVO_CARACTERES = 1500;
export const TETO_CARACTERES = 3500;
export type SituacaoTamanho = "ok" | "acima_do_alvo" | "acima_do_teto";
export const situacaoTamanho = (n: number): SituacaoTamanho => (n > TETO_CARACTERES ? "acima_do_teto" : n > ALVO_CARACTERES ? "acima_do_alvo" : "ok");
export const rotuloTamanho = (n: number): string => {
  const s = situacaoTamanho(n);
  return `${n} caracteres${s === "ok" ? "" : s === "acima_do_alvo" ? " (acima do alvo de 1 500)" : " (acima do teto de 3 500: será dividida)"}`;
};

export const NIVEIS: ReadonlyArray<{ id: NivelTemplate; rotulo: string }> = [{ id: "minimo", rotulo: "Mínimo" }, { id: "padrao", rotulo: "Padrão" }, { id: "completo", rotulo: "Completo" }];
export const CANAIS_MODELO: ReadonlyArray<TipoCanal> = ["so", "telegram"];

export const chaveModelo = (m: Pick<ModeloVisao, "tipo" | "canal_tipo" | "nivel">): string => `${m.tipo}|${m.canal_tipo}|${m.nivel}`;
export function ordenarModelos(ms: readonly ModeloVisao[], catalogo: readonly MetaTipoVisao[]): ModeloVisao[] {
  const ordem = new Map(catalogo.map((c, i) => [c.tipo, i]));
  const nv = { minimo: 0, padrao: 1, completo: 2 } as const;
  return [...ms].sort((a, b) => (ordem.get(a.tipo) ?? 99) - (ordem.get(b.tipo) ?? 99) || a.canal_tipo.localeCompare(b.canal_tipo) || nv[a.nivel] - nv[b.nivel]);
}

export type RegraEditavel = Omit<Regra, "id"> & { id?: string };
export const regraNova = (canal_id: string): RegraEditavel => ({ nome: "", ativa: true, tipos: [], canal_id, filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "minimo", efemera_ate: null, origem: "usuario" });

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validarRegra(r: RegraEditavel): string[] {
  const erros: string[] = [];
  if (r.nome.trim() === "") erros.push("Dê um nome à regra.");
  if (r.tipos.length === 0) erros.push("Escolha ao menos um tipo de alerta.");
  if (r.canal_id === "") erros.push("Escolha o canal.");
  const s = r.silencio;
  if ((s.inicio !== undefined) !== (s.fim !== undefined)) erros.push("O silêncio precisa de início e fim.");
  if (s.inicio !== undefined && !HHMM.test(s.inicio)) erros.push("Hora de início inválida (use HH:MM).");
  if (s.fim !== undefined && !HHMM.test(s.fim)) erros.push("Hora de fim inválida (use HH:MM).");
  if (r.agrupamento.modo === "digest" && (r.agrupamento.hora_digest === undefined || !HHMM.test(r.agrupamento.hora_digest))) erros.push("O resumo precisa de uma hora (HH:MM).");
  if (r.agrupamento.modo === "lote" && (r.agrupamento.janela_s === undefined || r.agrupamento.janela_s < 5)) erros.push("O lote precisa de uma janela de pelo menos 5 s.");
  return erros;
}
export const ehCuringa = (r: Pick<Regra, "tipos">): boolean => r.tipos.includes("*");
/** `agente_mensagem` nunca vai a canal externo por curinga: só marcando o tipo explicitamente. */
export const avisoAgente = (tipos: ReadonlyArray<TipoAlerta | "*">, canalExterno: boolean): string | null =>
  canalExterno && tipos.includes("*") && !tipos.includes("agente_mensagem") ? "Mensagens de agentes nunca vão a canal externo pelo curinga; marque \"Mensagem de agente\" para enviar de propósito." : null;

export function resumoRegra(r: Regra, rotulos: ReadonlyMap<string, string>): string {
  if (r.tipos.includes("*")) return "todos os tipos";
  const nomes = r.tipos.map((t) => rotulos.get(t) ?? t);
  return nomes.length <= 3 ? nomes.join(", ") : `${nomes.slice(0, 3).join(", ")} e mais ${nomes.length - 3}`;
}
export const resumoAgrupamento = (r: Regra): string => (r.agrupamento.modo === "imediato" ? "imediato" : r.agrupamento.modo === "lote" ? `lote de ${r.agrupamento.janela_s ?? 5} s` : `resumo às ${r.agrupamento.hora_digest ?? "18:00"}`);
export const resumoSilencio = (r: Regra): string => (r.silencio.inicio !== undefined && r.silencio.fim !== undefined ? `${r.silencio.inicio}–${r.silencio.fim}${r.silencio.excecao_critico === true ? " (exceto críticos)" : ""}` : "sem silêncio");

export const PRESETS: ReadonlyArray<{ id: "tudo_no_app" | "atrasadas_e_erros_no_telegram" | "resumo_diario"; rotulo: string; canal: "so" | "telegram" }> = [
  { id: "tudo_no_app", rotulo: "Tudo no app", canal: "so" },
  { id: "atrasadas_e_erros_no_telegram", rotulo: "Só atrasadas e erros no Telegram", canal: "telegram" },
  { id: "resumo_diario", rotulo: "Resumo diário", canal: "telegram" },
];

export const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
