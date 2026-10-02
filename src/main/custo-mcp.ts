// Porta das tools `task_list`, `task_get` e `cost_report` (Fase 10, T-10.20) no main: SOMENTE LEITURA sobre o `ServicoBoard`/`ServicoCusto`. O escopo é SEMPRE a Missão do token:
// o trabalho vem da linha da Missão (nunca do argumento) e um `project` que não seja o dela vira `not_found` (uma Missão não lê outra). Nada aqui recebe custo/tokens de fora (D-104).
import type { Banco } from "../nucleo/banco/banco";
import type { CardBoard, ColunaBoard, CustoResumo } from "../compartilhado/custo";
import { COLUNAS_BOARD } from "../compartilhado/custo";
import { ErroMcp } from "../nucleo/mcp/erros";
import type { CardLeveMcp, ClaimsDeCusto, DetalheTaskMcp, LinhaCustoMcp, PortaCustoMcp } from "../nucleo/mcp/portas";
import type { ServicoBoard } from "./custo-board";
import type { ServicoCusto } from "../nucleo/custo/servico";

export interface DepsPortaCustoMcp {
  banco: Banco;
  board: () => ServicoBoard;
  custo: () => ServicoCusto;
  relogio?: () => Date;
}

const DIA_MS = 86_400_000;
const linhaDe = (c: CustoResumo): Omit<LinhaCustoMcp, "chave"> => ({
  usd: c.usd,
  incompleto: c.incompleto,
  aproximado: c.aproximado,
  // entrada = tudo o que entrou no modelo (novo + cache); saída separada
  tokens_entrada: c.tokens.entrada + c.tokens.cache_escrita + c.tokens.cache_leitura,
  tokens_saida: c.tokens.saida,
});

export function criarPortaCustoMcp(d: DepsPortaCustoMcp): PortaCustoMcp {
  const relogio = d.relogio ?? ((): Date => new Date());

  /** A Missão do token: precisa existir e ser do workspace do token. O trabalho pedido, se vier, precisa ser o da Missão. */
  function escopo(c: ClaimsDeCusto, projeto: string | null): { workspace_id: string; mission_id: string; trabalho_id: string | null } {
    if (c.mission_id === null) throw new ErroMcp("not_found", "O token não tem Missão.");
    const m = d.banco.consultarUm<{ workspace_id: string; trabalho_id: string | null }>("SELECT workspace_id, trabalho_id FROM mission WHERE id = ?", [c.mission_id]);
    if (m === undefined || m.workspace_id !== c.workspace_id) throw new ErroMcp("not_found", "Missão não encontrada.");
    if (projeto !== null && projeto !== m.trabalho_id) throw new ErroMcp("not_found", "Trabalho fora da Missão.");
    return { workspace_id: m.workspace_id, mission_id: c.mission_id, trabalho_id: m.trabalho_id };
  }
  const leve = (c: CardBoard): CardLeveMcp => ({ task_id: c.task_id, titulo: c.titulo, coluna: c.coluna, pronta: c.selos.includes("pronta"), custo: { usd: c.custo.usd, incompleto: c.custo.incompleto } });

  return {
    async listarTasks(c, p) {
      const e = escopo(c, p.trabalho_id);
      if (e.trabalho_id === null) return { itens: [], proximo: null };
      const b = await d.board().snapshot({ workspace_id: e.workspace_id, trabalho_ids: [e.trabalho_id], ...(p.coluna === null ? {} : { colunas: [p.coluna as ColunaBoard] }) });
      const todos: CardBoard[] = COLUNAS_BOARD.flatMap((col) => b.colunas[col]);
      // cursor opaco = ordinal da próxima linha; ordem estável (coluna do quadro, depois a ordenação do `montarBoard`)
      const inicio = p.cursor === null ? 0 : Number(/^o(\d{1,6})$/.exec(p.cursor)?.[1] ?? Number.NaN);
      if (!Number.isInteger(inicio)) throw new ErroMcp("invalid_argument", 'O campo "cursor" é inválido.');
      const pagina = todos.slice(inicio, inicio + p.limite).map(leve);
      return { itens: pagina, proximo: inicio + p.limite < todos.length ? `o${inicio + p.limite}` : null };
    },

    async obterTask(c, p) {
      const e = escopo(c, p.trabalho_id);
      if (e.trabalho_id === null) throw new ErroMcp("not_found", "A Missão não tem trabalho do método.");
      let det;
      try {
        det = await d.board().cardDetalhe({ workspace_id: e.workspace_id, trabalho_id: e.trabalho_id, task_id: p.task_id });
      } catch (err) {
        if (err instanceof Error && err.name === "ErroBoard") throw new ErroMcp("not_found", "Task não encontrada.");
        throw err;
      }
      const r: DetalheTaskMcp = {
        task_id: det.card.task_id,
        titulo: det.card.titulo,
        coluna: det.card.coluna,
        depende_de: det.card.depende_de,
        contrato: det.contrato,
        janela: det.janela,
        custo: { usd: det.custo.usd, incompleto: det.custo.incompleto, aproximado: det.custo.aproximado },
        custo_por_modelo: det.custo_por_modelo.map((m) => ({ modelo: m.modelo, tokens_entrada: m.tokens.entrada + m.tokens.cache_escrita + m.tokens.cache_leitura, tokens_saida: m.tokens.saida, usd: m.usd, aproximado: m.aproximado })),
        panes: det.panes.map((x) => ({ pane_id: x.pane_id, cli: x.cli, modelo: x.modelo, papel: x.papel })),
        handoffs: det.handoffs,
      };
      return r;
    },

    async relatorio(c, p) {
      const e = escopo(c, null);
      const ate = p.ate ?? relogio().toISOString().slice(0, 10);
      const desde = p.desde ?? new Date(Date.parse(ate) - 30 * DIA_MS).toISOString().slice(0, 10);
      const agrupar = p.agrupar === "task" ? "card" : p.agrupar;
      const r = d.custo().relatorio({ agrupar, desde, ate, filtros: { mission_id: e.mission_id }, limite: 200 });
      return { linhas: r.linhas.map((l) => ({ chave: l.chave, ...linhaDe(l.custo) })), total: linhaDe(r.total) };
    },
  };
}
