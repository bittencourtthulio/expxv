// montarBoard (T-10.12): função PURA e determinística — colunas (D-107), selos, progresso, WIP, ordenação, agrupamento e custo leve por card.
// Sem I/O. Permutar a ordem de entrada não muda a saída. Descartado some das colunas (aparece só com `mostrar_descartados`) mas seu CUSTO fica nos totais.
import { COLUNAS_BOARD, type BoardModelo, type CardBoard, type ColunaBoard, type ConfigBoard, type CustoLeve, type CustoResumo, type FiltrosBoard, type InfoWip, type ProgressoBoard, type TrabalhoDoBoard } from "../../compartilhado/custo";
import { resumoVazio, somarResumos } from "../custo/agregar";
import { chaveCard } from "../custo/atribuicao";
import { colunaDoCard } from "./coluna";
import { comparadorDeCards, type ExtraOrdem } from "./ordenar";
import type { CustosPorCard, PaneParaBoard, TaskDoBanco, TaskDoMetodo, TrabalhoDoMetodo } from "./portas";

export interface EntradaBoard {
  trabalhos: readonly TrabalhoDoMetodo[];
  tasksBanco: readonly TaskDoBanco[];
  panes: ReadonlyMap<string, PaneParaBoard>;
  custos: CustosPorCard;
  filtros: FiltrosBoard;
  config?: ConfigBoard;
  /** instante ISO do snapshot (injetado: o núcleo não lê relógio). */
  agora: string;
  versao: number;
}

const LEVE_VAZIO: CustoLeve = { usd: null, incompleto: false, aproximado: false };
const leve = (c: CustoResumo | undefined): CustoLeve => (c === undefined ? LEVE_VAZIO : { usd: c.usd, incompleto: c.incompleto, aproximado: c.aproximado });

export function progressoDe(cards: ReadonlyArray<{ coluna: ColunaBoard; oculta: boolean }>): ProgressoBoard {
  let descartado = 0;
  let total = 0;
  let concluido = 0;
  let validado = 0;
  for (const c of cards) {
    if (c.oculta) {
      descartado++;
      continue;
    }
    total++;
    if (c.coluna === "concluido") concluido++;
    else if (c.coluna === "validado") validado++;
  }
  const pct = (n: number): number => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return { total, descartado, concluido, validado, pct_concluido: pct(concluido), pct_validado: pct(validado) };
}

const colunasVazias = (): Record<ColunaBoard, CardBoard[]> => ({ backlog: [], a_fazer: [], em_andamento: [], em_revisao: [], concluido: [], validado: [] });

interface CardInterno {
  card: CardBoard;
  oculta: boolean;
  resumo: CustoResumo | undefined;
  modelos: readonly string[];
  extra: ExtraOrdem;
}

export function montarBoard(e: EntradaBoard): BoardModelo {
  const f = e.filtros;
  const bancoPor = new Map<string, TaskDoBanco>();
  for (const t of e.tasksBanco) bancoPor.set(chaveCard(t.workspace_id, t.trabalho_id, t.task_ref), t);

  // ---- 1) todos os cards do ESCOPO (workspace / trabalho / Missão), sem os filtros de visão
  const internos: CardInterno[] = [];
  const trabalhosEscopo: TrabalhoDoMetodo[] = [];
  for (const t of e.trabalhos) {
    if (f.workspace_id !== null && t.workspace_id !== f.workspace_id) continue;
    if (f.trabalho_ids !== undefined && f.trabalho_ids.length > 0 && !f.trabalho_ids.includes(t.id)) continue;
    if (f.mission_id !== undefined && t.mission_id !== f.mission_id) continue;
    trabalhosEscopo.push(t);
    const status = new Map<string, TaskDoMetodo["status"]>(t.tasks.map((k) => [k.id, k.status]));
    const comViolacao = new Set(t.violacoes.map((v) => v.alvo));
    for (const k of t.tasks) {
      const chave = chaveCard(t.workspace_id, t.id, k.id);
      const banco = bancoPor.get(chave);
      const r = colunaDoCard({ task: k, banco: banco?.estado ?? null, statusPorTask: status, vereditoQa: t.veredito_qa, temViolacao: comViolacao.has(k.id) });
      const pane = banco?.pane_id ? e.panes.get(banco.pane_id) : undefined;
      const resumo = e.custos.get(chave);
      internos.push({
        oculta: r.oculta,
        resumo,
        modelos: resumo?.modelos ?? [],
        extra: { concluida_em: k.concluida_em },
        card: {
          chave,
          task_id: k.id,
          trabalho_id: t.id,
          trabalho_titulo: t.titulo,
          workspace_id: t.workspace_id,
          fase: k.fase,
          titulo: k.titulo,
          coluna: r.coluna,
          selos: r.selos,
          depende_de: [...k.depende_de],
          suite: k.suite,
          mission_id: t.mission_id,
          executor: banco?.pane_id && pane ? { pane_id: banco.pane_id, cli: pane.cli, modelo: pane.modelo, conta_rotulo: pane.conta_rotulo } : null,
          handoff_status: banco?.handoff_status ?? null,
          duracao_observada_ms: k.duracao_observada_ms,
          custo: leve(resumo),
        },
      });
    }
  }

  // ---- 2) progresso, WIP e totais (escopo; independentes dos filtros de visão)
  const wipCfg = e.config?.wip ?? {};
  const wip = {} as Record<ColunaBoard, InfoWip>;
  for (const c of COLUNAS_BOARD) {
    const total = internos.filter((i) => !i.oculta && i.card.coluna === c).length;
    const limite = wipCfg[c] ?? null;
    wip[c] = { total, limite, excedido: limite !== null && total > limite };
  }
  const progresso = progressoDe(internos.map((i) => ({ coluna: i.card.coluna, oculta: i.oculta })));
  const custoTotal = somarResumos(internos.map((i) => i.resumo).filter((r): r is CustoResumo => r !== undefined));
  const trabalhos: TrabalhoDoBoard[] = [...trabalhosEscopo]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.workspace_id < b.workspace_id ? -1 : 1))
    .map((t) => {
      const doTrab = internos.filter((i) => i.card.workspace_id === t.workspace_id && i.card.trabalho_id === t.id);
      const partes = doTrab.map((i) => i.resumo).filter((r): r is CustoResumo => r !== undefined);
      return { trabalho_id: t.id, titulo: t.titulo, mission_id: t.mission_id, progresso: progressoDe(doTrab.map((i) => ({ coluna: i.card.coluna, oculta: i.oculta }))), custo: partes.length === 0 ? resumoVazio() : somarResumos(partes) };
    });

  // ---- 3) filtros de VISÃO e ordenação
  const busca = f.busca?.trim().toLowerCase() ?? "";
  const visiveis = internos.filter((i) => {
    const c = i.card;
    if (f.colunas !== undefined && f.colunas.length > 0 && !f.colunas.includes(c.coluna)) return false;
    if (f.selos !== undefined && f.selos.length > 0 && !f.selos.some((s) => c.selos.includes(s))) return false;
    if (f.modelo !== undefined && !i.modelos.includes(f.modelo)) return false;
    if (f.com_custo === true && c.custo.usd === null) return false;
    if (f.com_custo === false && c.custo.usd !== null) return false;
    if (busca !== "" && !c.task_id.toLowerCase().includes(busca) && !c.titulo.toLowerCase().includes(busca)) return false;
    return true;
  });
  const extra = new Map(internos.map((i) => [i.card.chave, i.extra] as const));
  const cmp = comparadorDeCards(f.ordenar ?? "plano", f.agrupar ?? "nenhum", extra);
  const colunas = colunasVazias();
  const descartados: CardBoard[] = [];
  for (const i of visiveis) (i.oculta ? descartados : colunas[i.card.coluna]).push(i.card);
  for (const c of COLUNAS_BOARD) colunas[c].sort(cmp);
  descartados.sort(cmp);

  return { versao: e.versao, gerado_em: e.agora, colunas, progresso, trabalhos, custo: custoTotal, wip, descartados: f.mostrar_descartados === true ? descartados : [] };
}
