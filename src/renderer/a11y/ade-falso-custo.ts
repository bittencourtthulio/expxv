// `window.ade.custo` e `window.ade.board` falsos para varrer as telas de custo e do board em jsdom (só teste). Aditivo: não altera as demais APIs.
import type { ApiAde } from "../../compartilhado/ipc";
import { cardFalso, detalheFalso, estimativaFalsa, modeloFalso, resumoCusto } from "../telas/board/fabrica-teste";
import type { CustoMissao } from "../../compartilhado/custo";

export function custoFalso(): Pick<ApiAde, "custo" | "board"> {
  const cards = [
    cardFalso(1, { coluna: "validado", custo: { usd: 2.4, incompleto: false, aproximado: false } }),
    cardFalso(2, { coluna: "concluido", custo: { usd: 1.8, incompleto: true, aproximado: false } }),
    cardFalso(3, { coluna: "em_andamento", executor: { pane_id: "p1", cli: "claude", modelo: "claude-sonnet", conta_rotulo: "pessoal" }, custo: { usd: 0.42, incompleto: false, aproximado: true } }),
    cardFalso(4, { coluna: "a_fazer", selos: ["pronta"] }),
    cardFalso(5, { coluna: "backlog", depende_de: ["T-04"] }),
  ];
  const missao: CustoMissao = { ...resumoCusto(4.62, { incompleto: true }), orquestracao: resumoCusto(0.5), cards: resumoCusto(4.12), sem_card: resumoCusto(null), ambiguo: resumoCusto(null) };
  const api = {
    custo: {
      resumo: async ({ escopo }: { escopo: string }) => (escopo === "missao" ? missao : resumoCusto(4.62, { incompleto: true })),
      relatorio: async () => ({ linhas: [{ chave: "claude-sonnet", rotulo: "claude-sonnet", custo: resumoCusto(4.12) }, { chave: "", rotulo: "", custo: resumoCusto(null, { registros: 2 }) }], total: resumoCusto(4.12, { incompleto: true }), proximo: null }),
      estimativa: async () => estimativaFalsa(1),
      previsaoMissao: async () => ({ custo_atual_usd: 4.62, restante_estimado_usd: null, total_projetado_usd: null, base: "sem_base" as const, cards_restantes: 2, amostras: 1, incompleto: true }),
      previsaoPeriodo: async () => ({ gasto_usd: 4.62, media_diaria_usd: 1.2, projecao_fim_periodo_usd: 36, dias_decorridos: 4, dias_restantes: 26, base: "ritmo" as const }),
      sprint: async () => ({ sprint_id: "s1", custo: resumoCusto(3), itens: 3, itens_sem_custo: 1 }),
      fontes: async () => [{ pane_id: "p1", cli: "claude", estado: "lendo" as const, erro_codigo: null, atraso_s: 2, linhas_puladas: 0 }, { pane_id: "p2", cli: "gemini", estado: "sem_fonte" as const, erro_codigo: null, atraso_s: null, linhas_puladas: 0 }],
      precosListar: async () => [{ id: "pr1", padrao: "claude-sonnet-*", familia: "claude", entrada_por_mtok: 3, saida_por_mtok: 15, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null, origem: "embutido" as const, confirmado: false, valido_desde: "2026-01-01", fonte: "tabela pública", coletado_em: "2026-09-01" }],
      precoGravar: async (p: { padrao: string }) => ({ id: "pr2", padrao: p.padrao, familia: null, entrada_por_mtok: 1, saida_por_mtok: 2, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null, origem: "usuario" as const, confirmado: true, valido_desde: "2026-10-01", fonte: null, coletado_em: null }),
      precoApagar: async () => ({ ok: true }),
      reprecificar: async () => ({ registros_reprecificados: 12 }),
      configLer: async () => ({ cambio_brl: null, alertar_preco_ausente: true, teto_padrao_missao_usd: null, ler_transcripts: true, retencao_bruta_dias: 90, aviso_teto_pct: 80 }),
      configGravar: async (c: unknown) => c,
      tetoGravar: async () => ({ ok: true as const }),
      reindexar: async () => ({ iniciado: true, registros: 3 }),
      diagnostico: async () => ({ texto: "fontes: 2\nregistros: 3" }),
      assinar: () => () => undefined,
    },
    board: {
      snapshot: async () => modeloFalso(cards),
      cardDetalhe: async (p: { task_id: string }) => detalheFalso(cards.find((c) => c.task_id === p.task_id) ?? cards[0]!),
      abrirArquivo: async () => ({ ok: true }),
      delegarCard: async (p: { task_id: string }) => ({ pane_id: "p9", task_ref: p.task_id, recibo: "rota: claude · conta pessoal" }),
      configLer: async () => ({ wip: {} }),
      configGravar: async (_w: string, c: unknown) => c,
      assinar: () => () => undefined,
    },
  };
  return api as unknown as Pick<ApiAde, "custo" | "board">;
}
