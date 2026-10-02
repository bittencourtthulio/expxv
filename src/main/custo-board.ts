// Serviço do board (T-10.13) no main: monta o `BoardModelo` com função PURA (`montarBoard`) a partir do método (índices por raiz, lidos do disco pelo gerenciador),
// do banco local e do custo materializado. Cache por `versao` (snapshot repetido sem mudança devolve o MESMO objeto, sem recomputar); invalida em `metodo:mudou`,
// `cost.updated`, `handoff.submitted`, `pane.*` e `task.updated`; `board:evento` coalescido (≤ 1 / 300 ms). NÃO escreve em `docs/**` (D-04): abrir arquivo e delegar são as únicas ações.
import { realpath as realpathFs } from "node:fs/promises";
import type { Banco } from "../nucleo/banco/banco";
import { criarRepoConfig } from "../nucleo/banco/repos/config";
import { ValorInvalidoErro } from "../nucleo/dominio";
import {
  CONFIG_BOARD_PADRAO,
  COLUNAS_BOARD,
  type BoardModelo,
  type CardBoard,
  type CardDetalhe,
  type ColunaBoard,
  type ConfigBoard,
  type CustoResumo,
  type FiltrosBoard,
  type PedidoDelegarCard,
  type PedidoDetalheCard,
  type PrevisaoMissao,
  type RespostaDelegarCard,
} from "../compartilhado/custo";
import { chaveCard } from "../nucleo/custo/atribuicao";
import { amostrasCompletas, estimar, preverCustoMissao, resumir } from "../nucleo/custo/agregar";
import type { ServicoCusto } from "../nucleo/custo/servico";
import { comandoSugerido } from "../nucleo/metodo/comandos";
import type { IndiceProjeto, EventoRastro } from "../nucleo/metodo/tipos";
import { resolverArquivoAbrivel, delegarCard, ErroBoard, montarBoard, montarDetalhe, movimentosDoCard, type PaneParaBoard, type PortaBoardAgil, type PortaDelegar, type TaskDoBanco, type TaskDoMetodo, type TrabalhoDoMetodo } from "../nucleo/board";
import type { Barramento } from "./barramento";

export interface DepsBoard {
  banco: Banco;
  custo: () => ServicoCusto;
  metodo: {
    /** garante o índice/observador do workspace (idempotente) antes de ler os índices. */
    garantir?(workspaceId: string): Promise<void>;
    indices(workspaceId: string): Promise<ReadonlyMap<string, IndiceProjeto>>;
    rastro(workspaceId: string, trabalhoId: string, depois: number): Promise<{ eventos: EventoRastro[]; proximo: number }>;
  };
  /** valida que o workspace existe (lança `NaoEncontradoErro`) e devolve o essencial; o renderer nunca vê a raiz. */
  workspace: (id: string) => { id: string; raiz: string };
  barramento: Pick<Barramento, "emitir" | "emitirCoalescido" | "assinar">;
  emitirRenderer: (canal: "board:evento", payload: { versao: number }) => void;
  /** abre o arquivo no aplicativo padrão (`shell.openPath`); devolve `false` se o SO recusou. */
  abrirCaminho?: (absoluto: string) => Promise<boolean>;
  realpath?: (p: string) => Promise<string>;
  relogio?: () => Date;
  /** porta de delegação (roteador + spawn); ausente ⇒ `unavailable`. */
  delegar?: () => PortaDelegar | null;
}

interface Carga {
  trabalhos: TrabalhoDoMetodo[];
  raizPorTrabalho: Map<string, string>;
  tipoPorTrabalho: Map<string, string>;
  tasksBanco: TaskDoBanco[];
  panes: Map<string, PaneParaBoard>;
  modoPorMissao: Map<string, "livre" | "squad" | "agentico">;
}

const EVENTOS_QUE_INVALIDAM = ["metodo:mudou", "cost.updated", "handoff.submitted", "pane.spawned", "pane.closed", "task.updated"] as const;
const TAMANHO_CACHE = 8;

export function criarServicoBoard(d: DepsBoard) {
  const config = criarRepoConfig(d.banco);
  const relogio = d.relogio ?? ((): Date => new Date());
  const versoes = new Map<string, number>();
  const cache = new Map<string, BoardModelo>();
  let ligado = false;
  const versaoDe = (ws: string): number => versoes.get(ws) ?? 1;

  function invalidar(ws: string | null): void {
    const alvos = ws === null ? [...versoes.keys()] : [ws];
    for (const w of alvos) {
      versoes.set(w, versaoDe(w) + 1);
      for (const k of [...cache.keys()]) if (k.startsWith(`${w}|`)) cache.delete(k);
      d.barramento.emitirCoalescido("board:flush", w, w, 300);
    }
  }
  /** Assina os gatilhos de invalidação. Só depois do primeiro uso do board (nada no boot). */
  function ligar(): void {
    if (ligado) return;
    ligado = true;
    for (const t of EVENTOS_QUE_INVALIDAM) d.barramento.assinar<{ workspace_id?: string } | undefined>(t, (p) => invalidar(typeof p?.workspace_id === "string" ? p.workspace_id : null));
    d.barramento.assinar<string>("board:flush", (ws) => {
      d.emitirRenderer("board:evento", { versao: versaoDe(ws) });
      d.barramento.emitir("board.changed", { versao: versaoDe(ws) });
    });
  }

  // ---------------------------------------------------------------- leitura (método + banco)
  async function carregar(wsId: string): Promise<Carga> {
    const ws = d.workspace(wsId);
    await d.metodo.garantir?.(ws.id);
    const indices = await d.metodo.indices(ws.id);
    const porId = new Map<string, { t: TrabalhoDoMetodo; raiz: string; atividade: string; tipo: string }>();
    const missoes = d.banco.consultar<{ id: string; trabalho_id: string; modo: "livre" | "squad" | "agentico"; criado_em: string; estado: string }>(
      "SELECT id, trabalho_id, modo, criado_em, estado FROM mission WHERE workspace_id = ? AND trabalho_id IS NOT NULL ORDER BY criado_em, id",
      [ws.id],
    );
    const missaoDoTrabalho = new Map<string, string>();
    const modoPorMissao = new Map<string, "livre" | "squad" | "agentico">();
    for (const m of missoes) {
      modoPorMissao.set(m.id, m.modo);
      if (m.estado !== "abortada") missaoDoTrabalho.set(m.trabalho_id, m.id); // a mais recente não abortada
    }
    for (const [raiz, indice] of indices) {
      for (const tr of indice.trabalhos) {
        const atividade = tr.ultima_atividade ?? "";
        const antes = porId.get(tr.id);
        if (antes !== undefined && antes.atividade > atividade) continue; // fica a cópia com atividade mais recente (o worktree tende a ganhar)
        porId.set(tr.id, { raiz, atividade, tipo: tr.tipo, t: paraBoard(ws.id, tr, missaoDoTrabalho.get(tr.id) ?? null) });
      }
    }
    const tasksBanco = d.banco
      .consultar<{ trabalho_id: string; task_ref: string; estado: TaskDoBanco["estado"]; pane_id: string | null; hs: TaskDoBanco["handoff_status"] }>(
        `SELECT m.trabalho_id AS trabalho_id, t.task_ref AS task_ref, t.estado AS estado, t.pane_id AS pane_id,
                (SELECT h.status FROM handoff h WHERE h.task_id = t.id ORDER BY h.criado_em DESC, h.id DESC LIMIT 1) AS hs
         FROM task t JOIN mission m ON m.id = t.mission_id WHERE m.workspace_id = ? AND m.trabalho_id IS NOT NULL`,
        [ws.id],
      )
      .map((l) => ({ workspace_id: ws.id, trabalho_id: l.trabalho_id, task_ref: l.task_ref, estado: l.estado, pane_id: l.pane_id, handoff_status: l.hs }));
    const panes = new Map<string, PaneParaBoard>();
    for (const p of d.banco.consultar<{ id: string; cli: string | null; modelo: string | null; rotulo: string | null; papel: string }>(
      "SELECT p.id AS id, p.cli AS cli, p.modelo AS modelo, c.rotulo AS rotulo, p.papel AS papel FROM pane p LEFT JOIN conta c ON c.id = p.conta_id WHERE p.workspace_id = ? AND p.id IN (SELECT t.pane_id FROM task t JOIN mission m ON m.id = t.mission_id WHERE m.workspace_id = ? AND t.pane_id IS NOT NULL)",
      [ws.id, ws.id],
    )) panes.set(p.id, { cli: p.cli ?? "shell", modelo: p.modelo, conta_rotulo: p.rotulo, papel: p.papel });
    return {
      trabalhos: [...porId.values()].map((x) => x.t),
      raizPorTrabalho: new Map([...porId].map(([id, x]) => [id, x.raiz])),
      tipoPorTrabalho: new Map([...porId].map(([id, x]) => [id, x.tipo])),
      tasksBanco,
      panes,
      modoPorMissao,
    };
  }
  const configDo = (wsId: string): ConfigBoard => ({ ...CONFIG_BOARD_PADRAO, ...(config.obter<ConfigBoard>(`board.${wsId}`) ?? {}) });

  async function snapshot(filtros: FiltrosBoard): Promise<BoardModelo> {
    if (filtros.workspace_id === null) throw new ErroBoard("invalid", "workspace_id é obrigatório", "workspace_required");
    ligar();
    const ws = d.workspace(filtros.workspace_id).id;
    if (!versoes.has(ws)) versoes.set(ws, 1); // só workspaces já usados entram na invalidação por evento sem workspace (`cost.updated`)
    const chave = `${ws}|${versaoDe(ws)}|${JSON.stringify(filtros)}`;
    const quente = cache.get(chave);
    if (quente !== undefined) return quente;
    const v = versaoDe(ws);
    const c = await carregar(ws);
    const modelo = montarBoard({ trabalhos: c.trabalhos, tasksBanco: c.tasksBanco, panes: c.panes, custos: d.custo().resumosDeCards(ws), filtros: { ...filtros, workspace_id: ws }, config: configDo(ws), agora: relogio().toISOString(), versao: v });
    if (versaoDe(ws) === v) {
      if (cache.size >= TAMANHO_CACHE) cache.delete(cache.keys().next().value as string);
      cache.set(chave, modelo);
    }
    return modelo;
  }

  async function cardDetalhe(p: PedidoDetalheCard): Promise<CardDetalhe> {
    ligar();
    const ws = d.workspace(p.workspace_id).id;
    const c = await carregar(ws);
    const trabalho = c.trabalhos.find((t) => t.id === p.trabalho_id);
    const task = trabalho?.tasks.find((t) => t.id === p.task_id);
    if (trabalho === undefined || task === undefined) throw new ErroBoard("not_found", "card não encontrado", "card_not_found");
    const custos = d.custo().resumosDeCards(ws);
    const modelo = montarBoard({ trabalhos: [trabalho], tasksBanco: c.tasksBanco, panes: c.panes, custos, filtros: { workspace_id: ws, mostrar_descartados: true }, config: configDo(ws), agora: relogio().toISOString(), versao: versaoDe(ws) });
    const card = [...Object.values(modelo.colunas).flat(), ...modelo.descartados].find((x) => x.task_id === p.task_id);
    if (card === undefined) throw new ErroBoard("not_found", "card não encontrado", "card_not_found");
    const svc = d.custo();
    const resumo = custos.get(card.chave) ?? resumir([]);
    const janela = svc.repo.janelas.doCard(ws, p.trabalho_id, p.task_id).map((j) => ({ inicio: j.inicio, fim: j.fim, origem: j.origem }))[0] ?? null;
    const panesIds = new Set<string>();
    if (card.executor) panesIds.add(card.executor.pane_id);
    for (const l of d.banco.consultar<{ pane_id: string | null }>("SELECT DISTINCT pane_id FROM uso_registro WHERE workspace_id = ? AND trabalho_id = ? AND task_id = ? AND pane_id IS NOT NULL", [ws, p.trabalho_id, p.task_id])) if (l.pane_id) panesIds.add(l.pane_id);
    const panes = [...panesIds].sort().flatMap((id) => {
      const l = d.banco.consultarUm<{ cli: string | null; modelo: string | null; rotulo: string | null; papel: string }>("SELECT p.cli AS cli, p.modelo AS modelo, c.rotulo AS rotulo, p.papel AS papel FROM pane p LEFT JOIN conta c ON c.id = p.conta_id WHERE p.id = ?", [id]);
      return l ? [{ pane_id: id, cli: l.cli ?? "shell", modelo: l.modelo, conta_rotulo: l.rotulo, papel: l.papel }] : [];
    });
    const handoffs = d.banco.consultar<{ id: string; status: string; resumo: string; criado_em: string }>(
      "SELECT h.id AS id, h.status AS status, h.resumo AS resumo, h.criado_em AS criado_em FROM handoff h JOIN task t ON t.id = h.task_id JOIN mission m ON m.id = t.mission_id WHERE m.workspace_id = ? AND m.trabalho_id = ? AND t.task_ref = ? ORDER BY h.criado_em, h.id",
      [ws, p.trabalho_id, p.task_id],
    );
    let rastro: Array<{ ts: string; evento: string; detalhe: string; task: string | null }> = [];
    try {
      rastro = (await d.metodo.rastro(ws, p.trabalho_id, 0)).eventos.map((e) => ({ ts: e.ts, evento: e.evento, detalhe: e.detalhe, task: e.task }));
    } catch {
      rastro = []; // rastro ausente não derruba o detalhe
    }
    return montarDetalhe({
      card,
      task,
      janela,
      violacoes: trabalho.violacoes,
      custo: resumo,
      custo_por_modelo: svc.custoPorModelo(ws, p.trabalho_id, p.task_id),
      panes,
      handoffs,
      rastro,
      movimentos: movimentosDoCard(card, contextoMovimento(card, modelo, c)),
    });
  }

  function contextoMovimento(card: CardBoard, modelo: BoardModelo, c: Carga) {
    const modo = card.mission_id === null ? null : (c.modoPorMissao.get(card.mission_id) ?? null);
    const tipo = (c.tipoPorTrabalho.get(card.trabalho_id) ?? "feature") as "feature" | "ocorrencia" | "pedido" | "projeto";
    return {
      wip: modelo.wip,
      modo_missao: modo,
      comandoDe: (_g: "executar" | "retomar" | "corrigir", k: CardBoard): string | null => {
        const r = comandoSugerido("retomar", { id: k.trabalho_id, tipo }, "claude", null);
        return r.comando === "" ? null : r.comando;
      },
    };
  }

  async function abrirArquivo(p: PedidoDetalheCard): Promise<{ ok: boolean }> {
    const ws = d.workspace(p.workspace_id).id;
    const c = await carregar(ws);
    const task = c.trabalhos.find((t) => t.id === p.trabalho_id)?.tasks.find((t) => t.id === p.task_id);
    const raiz = c.raizPorTrabalho.get(p.trabalho_id);
    if (task === undefined || raiz === undefined) throw new ErroBoard("not_found", "card não encontrado", "card_not_found");
    const abs = await resolverArquivoAbrivel(raiz, task.arquivo, d.realpath ?? realpathFs);
    return { ok: d.abrirCaminho ? await d.abrirCaminho(abs) : false };
  }

  async function delegar(p: PedidoDelegarCard): Promise<RespostaDelegarCard> {
    const porta = d.delegar?.() ?? null;
    if (porta === null) throw new ErroBoard("unavailable", "a delegação de cards ainda não está disponível neste build", "no_router");
    const ws = d.workspace(p.workspace_id).id;
    const c = await carregar(ws);
    const trabalho = c.trabalhos.find((t) => t.id === p.trabalho_id);
    const task = trabalho?.tasks.find((t) => t.id === p.task_id) ?? null;
    const modelo = montarBoard({ trabalhos: trabalho === undefined ? [] : [trabalho], tasksBanco: c.tasksBanco, panes: c.panes, custos: new Map(), filtros: { workspace_id: ws }, config: configDo(ws), agora: relogio().toISOString(), versao: versaoDe(ws) });
    const card = Object.values(modelo.colunas).flat().find((x) => x.task_id === p.task_id) ?? null;
    const bloquear = configDo(ws).bloquear_ao_estourar_teto === true;
    // só consulta o teto quando o workspace optou por bloquear (padrão: só alerta, sem custo extra)
    const estourado = bloquear && d.custo().verificarTeto(p.mission_id).estado === "estourado";
    const estimativaHist = await estimativa({ workspace_id: ws, trabalho_id: p.trabalho_id });
    const r = await delegarCard({ pedido: p, card, task, wip: modelo.wip, teto: { bloquear, estourado }, estimativa: estimativaHist }, porta);
    invalidar(ws);
    return r;
  }

  // ---------------------------------------------------------------- configuração (WIP) e previsão da Missão
  function validarConfig(cfg: ConfigBoard): ConfigBoard {
    const wip: ConfigBoard["wip"] = {};
    for (const [k, v] of Object.entries(cfg.wip ?? {})) {
      if (!(COLUNAS_BOARD as readonly string[]).includes(k)) throw new ValorInvalidoErro("wip", k);
      if (v === null || v === undefined) continue;
      if (!Number.isInteger(v) || v < 1 || v > 999) throw new ValorInvalidoErro("wip", v);
      wip[k as ColunaBoard] = v;
    }
    return cfg.bloquear_ao_estourar_teto === true ? { wip, bloquear_ao_estourar_teto: true } : { wip };
  }
  function gravarConfig(wsId: string, cfg: ConfigBoard): ConfigBoard {
    const ws = d.workspace(wsId).id;
    const v = validarConfig(cfg);
    config.definir(`board.${ws}`, v);
    invalidar(ws);
    return v;
  }

  /** Previsão do custo total de uma Missão: cards restantes × mediana (≥ 3 amostras) ou ritmo; nunca chuta. */
  async function previsaoMissao(missionId: string): Promise<PrevisaoMissao> {
    const m = d.banco.consultarUm<{ workspace_id: string; trabalho_id: string | null }>("SELECT workspace_id, trabalho_id FROM mission WHERE id = ?", [missionId]);
    if (m === undefined) throw new ErroBoard("not_found", "Missão não encontrada", "mission_not_found");
    const svc = d.custo();
    const atual = svc.resumoMissao(missionId);
    if (m.trabalho_id === null) return preverCustoMissao({ custo_atual: atual, cards_restantes: 0, cards_concluidos: 0, estimativa: estimar([]) });
    const b = await snapshot({ workspace_id: m.workspace_id, trabalho_ids: [m.trabalho_id] });
    const concluidos = [...b.colunas.concluido, ...b.colunas.validado, ...b.colunas.em_revisao];
    const restantes = b.colunas.backlog.length + b.colunas.a_fazer.length + b.colunas.em_andamento.length;
    const todos = svc.resumosDeCards(m.workspace_id);
    const amostras = amostrasCompletas(concluidos.map((c) => todos.get(c.chave) ?? { ...resumir([]) } as CustoResumo));
    return preverCustoMissao({ custo_atual: atual, cards_restantes: restantes, cards_concluidos: concluidos.length, estimativa: estimar(amostras) });
  }
  /** Estimativa histórica: cards concluídos e COMPLETOS do workspace (ou do trabalho dado). Sem workspace ⇒ sem histórico. */
  async function estimativa(p: { workspace_id?: string; trabalho_id?: string }) {
    if (p.workspace_id === undefined) return estimar([]);
    const b = await snapshot({ workspace_id: p.workspace_id, ...(p.trabalho_id === undefined ? {} : { trabalho_ids: [p.trabalho_id] }) });
    const todos = d.custo().resumosDeCards(p.workspace_id);
    const concluidos = [...b.colunas.concluido, ...b.colunas.validado];
    return estimar(amostrasCompletas(concluidos.map((c) => todos.get(chaveCard(c.workspace_id, c.trabalho_id, c.task_id)) ?? resumir([]))));
  }

  /** Porta que a Fase 18 consome: colunas do board e limite de WIP por coluna do workspace. */
  const portaAgil: PortaBoardAgil = {
    colunas: async (ws) => (d.workspace(ws), [...COLUNAS_BOARD]),
    limiteWip: async (ws, coluna) => configDo(d.workspace(ws).id).wip[coluna as ColunaBoard] ?? null,
  };

  return { portaAgil, snapshot, cardDetalhe, abrirArquivo, delegar, configLer: (ws: string): ConfigBoard => configDo(d.workspace(ws).id), configGravar: gravarConfig, previsaoMissao, estimativa, invalidar, versaoDe };
}
export type ServicoBoard = ReturnType<typeof criarServicoBoard>;

/** Adapta o `TrabalhoDoMetodo` a partir do `Trabalho` indexado (sem copiar conteúdo além do necessário). */
function paraBoard(workspaceId: string, tr: IndiceProjeto["trabalhos"][number], missionId: string | null): TrabalhoDoMetodo {
  const tasks: TaskDoMetodo[] = [];
  for (const s of tr.sprints) for (const f of s.fases) for (const t of f.tasks) tasks.push({ id: t.id, titulo: t.titulo, fase: t.fase ?? f.id, status: t.status, depende_de: t.depende_de, suite: t.suite, concluida_em: t.concluida_em, duracao_observada_ms: t.duracao_observada_ms, objetivo: t.objetivo, criterio_aceite: t.criterio_aceite, teste_integracao: t.teste_integracao, teste_funcional: t.teste_funcional, teste_regressao: t.teste_regressao, arquivo: t.arquivo });
  return {
    id: tr.id,
    titulo: tr.titulo,
    workspace_id: workspaceId,
    mission_id: missionId,
    tipo: tr.tipo,
    veredito_qa: tr.veredito_qa,
    veredito_auditoria: tr.veredito_auditoria,
    tasks,
    violacoes: tr.violacoes.map((v) => ({ alvo: v.alvo, detalhe: `${v.tipo}: ${v.detalhe}` })),
  };
}
