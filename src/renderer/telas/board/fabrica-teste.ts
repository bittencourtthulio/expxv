// Fábrica de dados do Board para testes (jsdom): cards, modelo completo e API `custo`/`board` falsas. Só teste.
import { COLUNAS_BOARD, type BoardModelo, type CardBoard, type CardDetalhe, type ColunaBoard, type CustoResumo, type EstimativaCusto } from "../../../compartilhado/custo";

export const resumoCusto = (usd: number | null, extra: Partial<CustoResumo> = {}): CustoResumo => ({
  usd, incompleto: false, aproximado: false, tokens: { entrada: 1000, cache_escrita: 0, cache_leitura: 0, saida: 500 }, registros: usd === null ? 0 : 3, modelos: ["claude-sonnet"], fontes_ausentes: [], atualizado_em: "2026-10-01T10:00:00.000Z", ...extra,
});
export const cardFalso = (n: number, extra: Partial<CardBoard> = {}): CardBoard => ({
  chave: `w1|t1|T-${String(n).padStart(2, "0")}`, task_id: `T-${String(n).padStart(2, "0")}`, trabalho_id: "t1", trabalho_titulo: "Login", workspace_id: "w1", fase: "F1", titulo: `Tarefa ${n}`, coluna: "a_fazer", selos: [], depende_de: [], suite: "nao_executada",
  mission_id: "m1", executor: null, handoff_status: null, duracao_observada_ms: null, custo: { usd: null, incompleto: false, aproximado: false }, ...extra,
});
export function modeloFalso(cards: readonly CardBoard[], extra: Partial<BoardModelo> = {}): BoardModelo {
  const colunas = Object.fromEntries(COLUNAS_BOARD.map((c) => [c, [] as CardBoard[]])) as Record<ColunaBoard, CardBoard[]>;
  for (const c of cards) colunas[c.coluna].push(c);
  const wip = Object.fromEntries(COLUNAS_BOARD.map((c) => [c, { total: colunas[c].length, limite: null, excedido: false }])) as BoardModelo["wip"];
  const n = cards.length;
  const conc = colunas.concluido.length;
  const val = colunas.validado.length;
  return {
    versao: 1, gerado_em: "2026-10-01T10:00:00.000Z", colunas, wip, descartados: [],
    progresso: { total: n, descartado: 0, concluido: conc, validado: val, pct_concluido: n === 0 ? 0 : Math.round((conc / n) * 1000) / 10, pct_validado: n === 0 ? 0 : Math.round((val / n) * 1000) / 10 },
    trabalhos: n === 0 ? [] : [{ trabalho_id: "t1", titulo: "Login", mission_id: "m1", progresso: { total: n, descartado: 0, concluido: conc, validado: val, pct_concluido: 0, pct_validado: 0 }, custo: resumoCusto(null) }],
    custo: resumoCusto(null, { modelos: ["claude-sonnet"] }), ...extra,
  };
}
export const detalheFalso = (card: CardBoard): CardDetalhe => ({
  card,
  contrato: { objetivo: "Fazer o login", criterio_aceite: "Entra com e-mail", teste_integracao: "it-1", teste_funcional: null, teste_regressao: "reg-1" },
  janela: { inicio: "2026-10-01T09:00:00.000Z", fim: null, origem: "banco" },
  violacoes: [],
  custo: card.custo.usd === null ? resumoCusto(null) : resumoCusto(card.custo.usd, { incompleto: card.custo.incompleto, aproximado: card.custo.aproximado }),
  custo_por_modelo: [{ modelo: "claude-sonnet", tokens: { entrada: 1000, cache_escrita: 0, cache_leitura: 0, saida: 500 }, usd: card.custo.usd, origem: card.custo.usd === null ? "desconhecido" : "tabela", aproximado: card.custo.aproximado }],
  panes: [{ pane_id: "p1", cli: "claude", modelo: "claude-sonnet", conta_rotulo: "pessoal", papel: "executor" }],
  handoffs: [{ id: "h1", status: "ok", resumo: "Pronto", criado_em: "2026-10-01T09:30:00.000Z" }],
  rastro: [{ ts: "2026-10-01T09:00:00.000Z", evento: "task_iniciada", detalhe: "" }],
  arquivo_task: "docs/sprintx/x/T-01.md", movimentos: [],
});
export const estimativaFalsa = (amostras: number): EstimativaCusto => amostras < 3
  ? { mediana_usd: null, p25_usd: null, p75_usd: null, amostras, confianca: "sem_historico" }
  : { mediana_usd: 1.5, p25_usd: 1, p75_usd: 2, amostras, confianca: "baixa" };
