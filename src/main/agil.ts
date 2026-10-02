// Ligação da gestão ágil (Fase 18, onda 2) no main: repositórios SQLite, portas (método, IA, harness), sincronização em LOTES, ganchos periódicos (atraso, WIP,
// sprint em risco, ação vencida) que viram eventos de domínio no barramento (a Fase 20 os consome), painel com cache, previsão e a porta do MCP.
//
// REGRAS DESTA CAMADA
//  - NADA RODA NO BOOT: `ligarAgil` só cria objetos; `iniciar()` (onda 2) liga o gatilho por `metodo:mudou` e o ciclo; a primeira sincronização é sob demanda.
//  - O main nunca passa de ~50 ms: a sincronização e a estimativa heurística rodam em lotes (≤ 25 trabalhos / ≤ 400 tasks; ≤ 25 itens) com `setImmediate` entre eles.
//  - TODO id citado (item, sprint, épico, cerimônia, ação, membro) é conferido contra o `workspace_id` do pedido: vazamento entre workspaces é falha, não opção.
//  - Ação humana (iniciar/cancelar/fechar sprint, marcar retrabalho, demo, consentimento da IA, decisões de estimativa) só entra pelos canais `agil:*` (renderer) com `ator: "humano"`;
//    a porta do MCP (agente) nunca passa `humano`: o agente propõe, o humano decide.
//  - A IA nunca é chamada sem consentimento explícito do workspace; nada de código/segredo/caminho absoluto no prompt (núcleo + auditoria); escrita só em userData e banco, nunca em docs/**.
import type {
  ConfigAgil, EpicoAgil, EventoAgil, FatorRisco, SituacaoRetrabalho, EventoAgilIpc, FiltrosAgil, FiltrosBacklog, ItemAgil, MembroAgil, PainelAgil, PrevisaoEstado, ResumoFechamento, SprintAgil, SprintItemAgil,
} from "../compartilhado/agil";
import type {
  CapacidadeSprintAgil, DailyAgil, EstadoAgilApp, ItemDetalheAgil, ItemReviewAgil, MembroAgilPedido, PaginaBacklogAgil, PraticasAgil, ResultadoEstimarAgil, ResultadoExportarAgil, ResultadoFecharSprintAgil,
  ResultadoPrevisaoAgil, RetroAgil, RetrabalhoListaAgil, SprintComResumoAgil, SugestaoPlanejamentoAgil, TipoExportacaoAgil, FormatoExportacaoAgil, PedidoMarcarRetrabalhoAgil, OrdenacaoBacklogAgil,
  NovoItemAgilPedido, EdicaoItemAgilPedido, PedidoEstimativaAgil, PedidoClassificacaoAgil, NovaSprintAgilPedido, DestinoPendentesAgil, EstadoChecklist as EstadoChecklistT,
} from "../compartilhado/agil";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Barramento } from "./barramento";
import type { Banco } from "../nucleo/banco";
import { criarBancoAgilSqlite, criarExtrasAgilMemoria, type BancoAgilSqlite, type ExtrasAgil } from "../nucleo/banco/repos/agil";
import { criarAgil, type Agil } from "../nucleo/agil/agil";
import { apagarEpico, atualizarItem, criarItem, descartarItem, gravarEpico } from "../nucleo/agil/backlog/itens";
import { comandoDePromocao, sugerirVinculos, vincularItem } from "../nucleo/agil/backlog/promover";
import { avaliarDoD } from "../nucleo/agil/backlog/dod";
import { reordenar } from "../nucleo/agil/backlog/priorizar";
import { gerarDaily, type Daily } from "../nucleo/agil/cerimonias/daily";
import { calcularInsights, type Insights } from "../nucleo/agil/cerimonias/insights";
import { adicionarItemRetro, atualizarAcao, acaoParaItem, criarAcao, criarRetro, publicarAcoesVencidas, votarRetro } from "../nucleo/agil/cerimonias/retro";
import { devolverAoBacklog, montarReview, registrarDemo } from "../nucleo/agil/cerimonias/review";
import { ErroAgil, invalido, naoEncontrado, regraViolada } from "../nucleo/agil/erros";
import { criarPublicador, detectarAtrasadas, eventosDeAtraso, novoEvento, type Publicador } from "../nucleo/agil/eventos";
import { COLUNAS_BACKLOG, exportar as exportarArquivo } from "../nucleo/agil/exportar";
import { horasPorPontoCalibrado } from "../nucleo/agil/estimativa/calibracao";
import { estimarItens } from "../nucleo/agil/estimativa/estimar";
import { calcularRazoes, registrarErro } from "../nucleo/agil/estimativa/erro";
import { ajustarAEscala, escalaDe } from "../nucleo/agil/estimativa/escala";
import { estimarPorIa } from "../nucleo/agil/estimativa/estimar";
import { iniciarJobEstimativa, chamadasHoje } from "../nucleo/agil/estimativa/ia";
import { aceitarEmLote, classificacaoAtiva, estimativaAtiva, gravarClassificacaoHumana, gravarEstimativaHumana, historicoEstimativas, proporClassificacao, proporEstimativa } from "../nucleo/agil/estimativa/revisao";
import { sincronizar, varrerOrfaos, type ResultadoSincronizacao } from "../nucleo/agil/fatos/sincronizar";
import { listarBacklog, listarRetrabalho, metricaPorNome, METRICAS_NOMEADAS, statusDaSprint, type MetricaNomeada } from "../nucleo/agil/consultas";
import { montarItensMetrica, type ItemMetrica } from "../nucleo/agil/metricas/dados";
import { escolherSprint, filtrarItens, FILTROS_VAZIOS, montarPainel, versaoDados } from "../nucleo/agil/metricas/painel";
import { amostraDiasUteis, preverTermino } from "../nucleo/agil/metricas/previsao";
import { throughput } from "../nucleo/agil/metricas/fluxo";
import { gravarSnapshots, serieSnapshots, snapshotsDoPainel } from "../nucleo/agil/metricas/snapshots";
import { sprintEmRisco } from "../nucleo/agil/metricas/saude";
import { portasIndisponiveis, type FonteTrabalho, type OcorrenciaRunx, type PortasAgil } from "../nucleo/agil/portas";
import { avaliarChecklist, CHECKLIST_LEAN, CHECKLIST_XP } from "../nucleo/agil/praticas/checklists";
import { contarPorColuna, limitesWip, verificarWip } from "../nucleo/agil/praticas/kanban";
import { desperdiciosLean } from "../nucleo/agil/praticas/lean";
import { metricasXp } from "../nucleo/agil/praticas/xp";
import type { BancoAgil } from "../nucleo/agil/repos";
import { chaveTask } from "../nucleo/agil/repos";
import { marcarRetrabalho } from "../nucleo/agil/retrabalho/marcar";
import { processarRetrabalho } from "../nucleo/agil/retrabalho/processar";
import { resumirRetrabalho } from "../nucleo/agil/retrabalho/agregar";
import { capacidadeMembro, capacidadeTotal } from "../nucleo/agil/sprint/capacidade";
import { adicionarItem, atualizarSprint, cancelarSprint, criarSprint, iniciarSprint, itensDaSprint, removerItem } from "../nucleo/agil/sprint/ciclo";
import { fecharSprint, sugerirFechar } from "../nucleo/agil/sprint/fechar";
import { indexarMembros } from "../nucleo/agil/sprint/membros";
import { candidatosDoBacklog, sugerirCompromisso } from "../nucleo/agil/sprint/planejamento";
import { lerConfig, mesclarConfig } from "../nucleo/agil/config/validar";
import { diasUteis, diaDe, hash, isoDe, ms, redigirSegredos, somarDias, truncar } from "../nucleo/agil/util";
import type { PortaMetodoMain } from "./agil-metodo";
import type { RepoConfigMin } from "./agil-ia";
import { criarPortaConsentimento } from "./agil-ia";
import type { PortaAgilMcp, ClaimsDeAgil, NomeToolAgil } from "../nucleo/mcp/portas";
import { ErroMcp } from "../nucleo/mcp/erros";

const LOTE_TRABALHOS = 25;
const LOTE_TASKS = 400;
const LOTE_ITENS = 25;
const MAX_ITER_PREVISAO = 20_000;
const ITER_PADRAO = 10_000;
const DIA_MS = 86_400_000;
const LIMITE_PROPOSTAS_HORA = 30;
const LIMITE_PROPOSTAS_ABERTAS = 300;
const LIMITE_VERSOES_AGENTE = 30;
const CORES: Record<string, number> = { verde: 0, amarelo: 1, vermelho: 2 };
const COR_DE = ["verde", "amarelo", "vermelho"] as const;

const ceder = (): Promise<void> => new Promise((r) => setImmediate(r));
const semUndef = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export interface DepsAgilMain {
  banco: Banco;
  /** existe o workspace? (o `ServicoWorkspaces`/repo real). */
  workspaceExiste(id: string): boolean;
  repoConfig: RepoConfigMin;
  metodo: PortaMetodoMain;
  portas?: Partial<PortasAgil>;
  barramento: Pick<Barramento, "emitir" | "emitirCoalescido" | "assinar">;
  /** grava `<userData>/agil/exportacoes/<nome>` e devolve a referência RELATIVA; nunca fora do diretório. */
  escreverExportacao: (nome: string, conteudo: string) => Promise<string>;
  /** só para teste: banco ágil pronto (ex.: memória). */
  bancoAgil?: BancoAgil;
  extras?: ExtrasAgil;
  relogio?: () => number;
  aviso?: (m: string) => void;
  /** intervalo do ciclo dos ganchos periódicos (padrão 10 min). */
  cicloMs?: number;
}

export interface ServicoAgil {
  estado(ws: string): Promise<EstadoAgilApp>;
  configLer(ws: string): ConfigAgil;
  configGravar(ws: string, parcial: unknown): ConfigAgil;
  consentimentoIa(ws: string, consentido: boolean): { consentimento: boolean };
  sincronizar(ws: string, forcar?: boolean): { iniciado: boolean };
  /** espera a sincronização em curso (teste e `agil:estado`). */
  aguardarSincronizacao(ws: string): Promise<void>;
  /** espera os jobs de estimativa por IA em andamento (teste e encerramento). */
  aguardarJobs(): Promise<void>;
  membroListar(ws: string): MembroAgil[];
  membroGravar(ws: string, m: MembroAgilPedido): MembroAgil;
  backlogListar(ws: string, p: { filtros?: Partial<FiltrosBacklog>; ordenar?: OrdenacaoBacklogAgil; cursor?: string | null; limite?: number }): PaginaBacklogAgil;
  itemLer(ws: string, itemId: string): Promise<ItemDetalheAgil>;
  itemCriar(ws: string, n: NovoItemAgilPedido): ItemAgil;
  itemAtualizar(ws: string, itemId: string, campos: EdicaoItemAgilPedido): ItemAgil;
  itemDescartar(ws: string, itemId: string, motivo: string): ItemAgil;
  itemReordenar(ws: string, itemId: string, antesId: string | null): { ordem: number };
  itemPromover(ws: string, itemId: string, destino: "prodx" | "sprintx" | "runx"): { comando: string };
  itemVincular(ws: string, itemId: string, trabalhoId: string | null, taskRef: string | null): ItemAgil;
  epicoListar(ws: string): EpicoAgil[];
  epicoGravar(ws: string, e: { id?: string; titulo: string; descricao?: string | null; estado?: EpicoAgil["estado"] }): EpicoAgil;
  epicoApagar(ws: string, epicoId: string): { ok: true };
  estimar(ws: string, itemIds: string[] | "sem_estimativa"): Promise<ResultadoEstimarAgil>;
  estimativaGravar(ws: string, p: PedidoEstimativaAgil): ReturnType<typeof gravarEstimativaHumana>;
  classificacaoGravar(ws: string, p: PedidoClassificacaoAgil): ReturnType<typeof gravarClassificacaoHumana>;
  estimativaAceitarLote(ws: string, itemIds: string[], confiancaMin?: number): ReturnType<typeof aceitarEmLote>;
  sprintListar(ws: string): SprintComResumoAgil[];
  sprintCriar(ws: string, s: NovaSprintAgilPedido): SprintAgil;
  sprintAtualizar(ws: string, sprintId: string, campos: Partial<Pick<SprintAgil, "nome" | "meta" | "inicio" | "fim" | "capacidade_pontos">>): SprintAgil;
  sprintIniciar(ws: string, sprintId: string): SprintAgil;
  sprintCancelar(ws: string, sprintId: string): SprintAgil;
  sprintItemMover(ws: string, sprintId: string, itemId: string, acao: "adicionar" | "remover", motivo: string | null): SprintItemAgil;
  sprintFechar(ws: string, sprintId: string, destino: DestinoPendentesAgil, versao: string | null): ResultadoFecharSprintAgil;
  capacidadeLer(ws: string, sprintId: string): CapacidadeSprintAgil;
  capacidadeGravar(ws: string, sprintId: string, membroId: string, ausenciasDias: number): CapacidadeSprintAgil;
  planejamentoSugerir(ws: string, sprintId: string | null, buffer?: number): SugestaoPlanejamentoAgil;
  dailyGerar(ws: string, sprintId: string | null): DailyAgil;
  dailySalvar(ws: string, cerimoniaId: string, observacoes: { ref: string; observacao: string }[]): { ok: true };
  reviewLer(ws: string, sprintId: string): ItemReviewAgil[];
  reviewGravar(ws: string, sprintId: string, itemId: string, resultado: "aceito" | "ajustar" | "rejeitado", nota: string | null, devolver: boolean): { devolvido_item_id: string | null };
  retroLer(ws: string, sprintId: string): RetroAgil;
  retroItemGravar(ws: string, cerimoniaId: string, p: { coluna?: string; texto?: string; item_id?: string; voto?: 1 | -1 }): RetroAgil;
  retroAcaoGravar(ws: string, cerimoniaId: string, p: { texto?: string; dono_membro_id?: string | null; prazo?: string | null; acao_id?: string; estado?: "aberta" | "feita" | "cancelada" }): RetroAgil;
  retroAcaoParaItem(ws: string, acaoId: string): ItemAgil;
  retrabalhoListar(ws: string, limite: number): RetrabalhoListaAgil;
  retrabalhoMarcar(ws: string, p: PedidoMarcarRetrabalhoAgil): ReturnType<typeof marcarRetrabalho>;
  painel(ws: string, filtros?: Partial<FiltrosAgil>): PainelAgil;
  previsao(ws: string, filtros?: Partial<FiltrosAgil>, iteracoes?: number): ResultadoPrevisaoAgil;
  praticas(ws: string, sprintId: string | null): PraticasAgil;
  checklistGravar(ws: string, sprintId: string, codigo: string, estado: EstadoChecklistT["estado"], nota: string | null): { ok: true };
  exportar(ws: string, tipo: TipoExportacaoAgil, formato: FormatoExportacaoAgil, sprintId: string | null): Promise<ResultadoExportarAgil>;
  /** gancho periódico (atraso, WIP, em risco, ação vencida); chamado após cada sincronização e pelo ciclo. */
  rodarGanchos(ws: string): Promise<void>;
  /** a porta do MCP (`backlog_*`, `estimate_*`, `sprint_status`, `rework_list`, `metrics_get`). */
  portaMcp: PortaAgilMcp;
  /** Onda 2: gatilho por `metodo:mudou` e ciclo. Idempotente. */
  iniciar(): void;
  encerrar(): void;
  /** metadados de diagnóstico (contadores; nunca conteúdo). */
  metricas(): Record<string, number>;
}

export function criarServicoAgil(d: DepsAgilMain): ServicoAgil {
  const relogio = d.relogio ?? ((): number => Date.now());
  const bancoAgil: BancoAgil = d.bancoAgil ?? criarBancoAgilSqlite(d.banco);
  const extras: ExtrasAgil = d.extras ?? ((bancoAgil as Partial<BancoAgilSqlite>).checklists && (bancoAgil as Partial<BancoAgilSqlite>).capacidades
    ? { checklists: (bancoAgil as BancoAgilSqlite).checklists, capacidades: (bancoAgil as BancoAgilSqlite).capacidades }
    : criarExtrasAgilMemoria());
  const consent = criarPortaConsentimento(d.repoConfig);
  const alertas = { publicar: (ev: EventoAgil): void => { d.barramento.emitir(ev.tipo, ev); } };
  const portas: PortasAgil = { ...portasIndisponiveis(), ...(d.portas ?? {}), metodo: d.metodo, consentimento: consent, alertas };
  const a: Agil = criarAgil({ portas, banco: bancoAgil, relogio });
  const pub: Publicador = criarPublicador(bancoAgil, alertas);
  const aviso = (m: string): void => d.aviso?.(m);

  // ---------------------------------------------------------------- estado em memória (descartável)
  const sincronizando = new Set<string>();
  const pendenteResync = new Map<string, boolean>();
  const esperas = new Map<string, Promise<void>>();
  const ultimaSync = new Map<string, string>();
  const erroSync = new Map<string, string | null>();
  const ultimasFontes = new Map<string, FonteTrabalho[]>();
  const ultimasOcorrencias = new Map<string, OcorrenciaRunx[]>();
  const atrasoAbertos = new Map<string, Set<string>>();
  const wipAbertos = new Map<string, Set<string>>();
  const riscoAberto = new Set<string>();
  const semeado = new Set<string>();
  const jobs = new Set<string>();
  const jobsP = new Set<Promise<unknown>>();
  const cachePainel = new Map<string, { chave: string; painel: PainelAgil }>();
  const contadores = { sincronizacoes: 0, lotes: 0, maior_lote_ms: 0, estimativas_ia: 0 };
  let ciclo: ReturnType<typeof setInterval> | null = null;
  let desassinar: (() => void) | null = null;
  let encerrado = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const config = (ws: string): ConfigAgil => a.config.ler(ws);
  const agora = (): number => relogio();
  const hojeDia = (): string => diaDe(isoDe(agora()));
  const emitir = (e: EventoAgilIpc): void => {
    try { d.barramento.emitirCoalescido("agil:evento", `${e.tipo}|${e.workspace_id}`, e, 300); } catch { /* o app segue */ }
  };
  const dep = (ws: string) => ({ banco: bancoAgil, relogio, id: a.id, config: config(ws), pub });

  // ---------------------------------------------------------------- conferência de dono (workspace)
  const exigirWs = (ws: string): void => { if (!d.workspaceExiste(ws)) throw naoEncontrado("workspace não encontrado"); };
  function item(ws: string, id: string): ItemAgil {
    const it = bancoAgil.itens.get(id);
    if (!it || it.workspace_id !== ws) throw naoEncontrado("item não encontrado");
    return it;
  }
  function sprint(ws: string, id: string): SprintAgil {
    const s = bancoAgil.sprints.get(id);
    if (!s || s.workspace_id !== ws) throw naoEncontrado("sprint não encontrada");
    return s;
  }
  function epico(ws: string, id: string): EpicoAgil {
    const e = bancoAgil.epicos.get(id);
    if (!e || e.workspace_id !== ws) throw naoEncontrado("épico não encontrado");
    return e;
  }
  function membro(ws: string, id: string): MembroAgil {
    const m = bancoAgil.membros.get(id);
    if (!m || m.workspace_id !== ws) throw naoEncontrado("membro não encontrado");
    return m;
  }
  function cerimonia(ws: string, id: string) {
    const c = bancoAgil.cerimonias.get(id);
    if (!c || c.workspace_id !== ws) throw naoEncontrado("cerimônia não encontrada");
    return c;
  }
  const acao = (ws: string, id: string) => {
    const x = bancoAgil.retroAcoes.get(id);
    if (!x) throw naoEncontrado("ação não encontrada");
    cerimonia(ws, x.cerimonia_id);
    return x;
  };
  /** ids de membro/épico citados em campos do item pertencem ao mesmo workspace. */
  function conferirReferencias(ws: string, c: { epico_id?: string | null; dono_membro_id?: string | null; par_membro_id?: string | null }): void {
    if (c.epico_id) epico(ws, c.epico_id);
    if (c.dono_membro_id) membro(ws, c.dono_membro_id);
    if (c.par_membro_id) membro(ws, c.par_membro_id);
  }

  // ---------------------------------------------------------------- sincronização em lotes
  function lotesDe(fontes: readonly FonteTrabalho[]): FonteTrabalho[][] {
    const lotes: FonteTrabalho[][] = [];
    let atual: FonteTrabalho[] = [];
    let tasks = 0;
    for (const f of fontes) {
      const n = f.trabalho.sprints.reduce((s, sp) => s + sp.fases.reduce((x, fa) => x + fa.tasks.length, 0), 0);
      if (atual.length > 0 && (atual.length >= LOTE_TRABALHOS || tasks + n > LOTE_TASKS)) { lotes.push(atual); atual = []; tasks = 0; }
      atual.push(f);
      tasks += n;
    }
    if (atual.length > 0) lotes.push(atual);
    return lotes;
  }
  /** mede o maior trecho contínuo por etapa (diagnóstico copiável: só números). */
  const trechos: Record<string, number> = {};
  const trecho = <T>(nome: string, fn: () => T): T => {
    const t0 = performance.now();
    try { return fn(); } finally { const dt = Math.round((performance.now() - t0) * 10) / 10; if (dt > (trechos[nome] ?? 0)) trechos[nome] = dt; }
  };
  const trechoAsync = async <T>(nome: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    try { return await fn(); } finally { const dt = Math.round((performance.now() - t0) * 10) / 10; if (dt > (trechos[nome] ?? 0)) trechos[nome] = dt; }
  };
  const registrarLote = (t0: number): void => {
    const dt = performance.now() - t0;
    contadores.lotes++;
    if (dt > contadores.maior_lote_ms) contadores.maior_lote_ms = Math.round(dt * 10) / 10;
  };

  async function sincronizarAgora(ws: string, forcar: boolean): Promise<void> {
    if (forcar) d.metodo.esquecer(ws);
    // o dono do dado é SEMPRE o workspace do pedido, qualquer que seja o que a porta devolveu (defesa contra atribuição errada)
    const fontes = (await d.metodo.fontes(ws)).map((f) => (f.workspace_id === ws ? f : { ...f, workspace_id: ws }));
    const ocorrencias = await d.metodo.ocorrencias(ws);
    ultimasFontes.set(ws, fontes);
    ultimasOcorrencias.set(ws, ocorrencias);
    const cfg = config(ws);
    const alterados = forcar ? fontes : fontes.filter((f) => bancoAgil.versoes.get(`${ws}|${f.trabalho.id}`) !== f.versao_origem);
    const total: Pick<ResultadoSincronizacao, "itens_criados" | "fatos_atualizados" | "orfaos"> = { itens_criados: 0, fatos_atualizados: 0, orfaos: 0 };
    const novos: ReturnType<typeof processarRetrabalho>["novos"] = [];
    for (const lote of lotesDe(alterados)) {
      const t0 = performance.now();
      // com `fontes` dadas, `sincronizar` não espera nada: o trabalho do lote roda inteiro antes de devolver o controle
      const r = await trechoAsync("sync_lote", () => sincronizar({ banco: bancoAgil, metodo: d.metodo, relogio, id: a.id, config: cfg }, ws, { fontes: lote, forcar, parcial: true }));
      total.itens_criados += r.itens_criados; total.fatos_atualizados += r.fatos_atualizados;
      const pr = trecho("retrabalho_lote", () => processarRetrabalho({ banco: bancoAgil, relogio, id: a.id, config: cfg }, ws, lote, ocorrencias));
      novos.push(...pr.novos);
      registrarLote(t0);
      await ceder();
    }
    total.orfaos += trecho("orfaos", () => varrerOrfaos({ banco: bancoAgil, relogio }, ws, new Set(fontes.map((f) => f.trabalho.id))));
    publicarRetrabalhoNovo(ws, novos);
    if (alterados.length > 0 || forcar) cachePainel.clear();
    // estimativa heurística imediata dos itens sem estimativa (IA em segundo plano, se consentida)
    if (total.itens_criados > 0 || forcar) await estimarSemEstimativa(ws).catch((e) => aviso(`estimativa automática: ${e instanceof Error ? e.message : String(e)}`));
    await atualizarErrosDeEstimativa(ws).catch((e) => aviso(`erro de estimativa: ${e instanceof Error ? e.message : String(e)}`));
    ultimaSync.set(ws, isoDe(agora()));
    erroSync.set(ws, null);
    contadores.sincronizacoes++;
    emitir({ tipo: "sincronizado", workspace_id: ws, trabalhos: fontes.length, itens_criados: total.itens_criados, quando: isoDe(agora()) });
    emitir({ tipo: "metricas_atualizadas", workspace_id: ws, quando: isoDe(agora()) });
    await rodarGanchos(ws);
  }

  function publicarRetrabalhoNovo(ws: string, novos: readonly { trabalho_id: string; task_ref: string | null; fonte: string; forca: string; natureza: string; ocorrido_em: string | null }[]): void {
    const limite = agora() - 3 * DIA_MS;
    let n = 0;
    for (const e of novos) {
      if (n >= 50) break;
      if (e.forca !== "forte" || e.natureza === "ruido") continue;
      const t = ms(e.ocorrido_em);
      if (t !== null && t < limite) continue;
      pub.publicar(novoEvento("retrabalho.detectado", ws, relogio, { trabalho_id: e.trabalho_id, task_ref: e.task_ref, dados: { fonte: e.fonte, natureza: e.natureza, forca: e.forca } }));
      n++;
    }
    if (n > 0) emitir({ tipo: "retrabalho_detectado", workspace_id: ws, novos: n, quando: isoDe(agora()) });
  }

  function sincronizarFila(ws: string, forcar: boolean): { iniciado: boolean } {
    exigirWs(ws);
    if (encerrado) return { iniciado: false };
    if (sincronizando.has(ws)) { pendenteResync.set(ws, (pendenteResync.get(ws) ?? false) || forcar); return { iniciado: true }; }
    sincronizando.add(ws);
    const rodar = async (f: boolean): Promise<void> => {
      try {
        await sincronizarAgora(ws, f);
      } catch (e) {
        const motivo = e instanceof Error ? truncar(redigirSegredos(e.message), 160) : "falha";
        erroSync.set(ws, motivo);
        aviso(`sincronização ágil de ${ws}: ${motivo}`);
        emitir({ tipo: "sincronizacao_falhou", workspace_id: ws, motivo, quando: isoDe(agora()) });
      }
    };
    const execucao = (async (): Promise<void> => {
      await rodar(forcar);
      while (pendenteResync.has(ws) && !encerrado) {
        const f = pendenteResync.get(ws) === true;
        pendenteResync.delete(ws);
        await rodar(f);
      }
    })().finally(() => { sincronizando.delete(ws); esperas.delete(ws); });
    esperas.set(ws, execucao);
    return { iniciado: true };
  }

  // ---------------------------------------------------------------- estimativa
  const depEstimar = (ws: string, cfg: ConfigAgil = config(ws)) => ({ banco: bancoAgil, portas, relogio, id: a.id, config: cfg });
  const semEstimativaIds = (ws: string): string[] => bancoAgil.itens.valores().filter((i) => i.workspace_id === ws && i.estado_ade !== "descartado" && !i.orfao && estimativaAtiva(bancoAgil, i.id) === null).map((i) => i.id);

  async function estimarLotes(ws: string, ids: readonly string[]): Promise<{ entradas: Awaited<ReturnType<typeof estimarItens>>["entradas"]; heuristicas: Awaited<ReturnType<typeof estimarItens>>["heuristicas"]; aplicadas: number; preservados: number }> {
    const cfg = { ...config(ws), estimativa_modo: "so_heuristica" as const };
    const entradas: Awaited<ReturnType<typeof estimarItens>>["entradas"] = [];
    const heuristicas: Awaited<ReturnType<typeof estimarItens>>["heuristicas"] = new Map();
    let aplicadas = 0; let preservados = 0;
    for (let i = 0; i < ids.length; i += LOTE_ITENS) {
      const r = await trechoAsync("estimativa_lote", () => estimarItens(depEstimar(ws, cfg), ws, ids.slice(i, i + LOTE_ITENS)));
      entradas.push(...r.entradas);
      for (const [k, v] of r.heuristicas) heuristicas.set(k, v);
      aplicadas += r.heuristicas_aplicadas; preservados += r.preservados_humano;
      await ceder();
    }
    return { entradas, heuristicas, aplicadas, preservados };
  }

  async function motivoSemIa(ws: string): Promise<string | null> {
    const cfg = config(ws);
    if (cfg.estimativa_modo !== "ia_sugere") return "modo";
    if (!consent.lerSync(ws)) return "sem_consentimento";
    if (chamadasHoje(bancoAgil, ws, relogio) >= cfg.estimativa_max_chamadas_dia) return "teto_diario";
    if ((await portas.perfil.resolver(ws, "agil", "estimativa")) === null) return "sem_perfil";
    return null;
  }

  async function estimarCom(ws: string, ids: readonly string[]): Promise<ResultadoEstimarAgil> {
    const r = await estimarLotes(ws, ids);
    const pend = r.entradas.filter((e) => { const x = estimativaAtiva(bancoAgil, e.ref); return !x || x.estado === "sugerida"; });
    const motivo = await motivoSemIa(ws);
    let jobId: string | null = null;
    if (motivo === null && pend.length > 0) {
      const job = iniciarJobEstimativa(() => estimarPorIa(depEstimar(ws), ws, pend, r.heuristicas));
      jobId = job.job_id;
      jobs.add(job.job_id);
      const p = job.concluido.then((res) => {
        contadores.estimativas_ia += res.sugestoes.size;
        cachePainel.clear();
        pub.publicar(novoEvento("agil.estimativa_pronta", ws, relogio, { tokens: res.tokens, dados: { itens: res.sugestoes.size, job_id: job.job_id } }));
        emitir({ tipo: "estimativa_pronta", workspace_id: ws, job_id: job.job_id, itens: res.sugestoes.size, quando: isoDe(agora()) });
      }, (e: unknown) => aviso(`estimativa por IA: ${e instanceof Error ? e.message : String(e)}`)).finally(() => { jobs.delete(job.job_id); jobsP.delete(p); });
      jobsP.add(p);
    }
    cachePainel.clear();
    return { heuristicas_aplicadas: r.aplicadas, preservados_humano: r.preservados, job_id: jobId, ia: { consentimento: consent.lerSync(ws), motivo_sem_ia: pend.length === 0 && motivo === null ? "nada_a_estimar" : motivo } };
  }
  /** erro de estimativa (T-18.18): grava a linha de cada task concluída que ainda não tem e recalcula razão/viés SÓ com amostras do próprio workspace, em fatias curtas. */
  async function atualizarErrosDeEstimativa(ws: string): Promise<void> {
    const cfg = config(ws);
    const meus = bancoAgil.itens.valores().filter((i) => i.workspace_id === ws);
    const ids = new Set(meus.map((i) => i.id));
    let n = 0;
    for (const it of meus) {
      if (!it.trabalho_id || !it.task_ref || bancoAgil.erros.get(it.id)) continue;
      const f = bancoAgil.fatos.get(chaveTask(ws, it.trabalho_id, it.task_ref));
      if (!f || f.status_visto !== "concluida") continue;
      const e = estimativaAtiva(bancoAgil, it.id);
      if (!e || e.pontos === null || e.pontos <= 0) continue;
      registrarErro(bancoAgil, { item_id: it.id, estimativa_id: e.id, pontos: e.pontos, categoria: classificacaoAtiva(bancoAgil, it.id)?.categoria ?? null, observado_ms: f.duracao_obs_ms, real_h: null }, relogio);
      if (++n % 100 === 0) await ceder();
    }
    const linhas = bancoAgil.erros.valores().filter((l) => ids.has(l.item_id));
    const novas = calcularRazoes(linhas.map((l) => ({ item_id: l.item_id, estimativa_id: l.estimativa_id, pontos: l.pontos_previstos, categoria: l.categoria, observado_ms: l.observado_ms, real_h: l.real_h })), cfg.amostra_minima);
    const mudadas = novas.flatMap((nv, i) => { const a = linhas[i]; return a && (a.razao !== nv.razao || a.ref_ms_por_ponto !== nv.ref_ms_por_ponto) ? [{ ...nv, registrado_em: a.registrado_em }] : []; });
    for (let i = 0; i < mudadas.length; i += 200) {
      bancoAgil.transacao(() => { for (const l of mudadas.slice(i, i + 200)) bancoAgil.erros.set(l.item_id, l); });
      await ceder();
    }
    if (n > 0 || mudadas.length > 0) cachePainel.clear();
  }

  async function estimarSemEstimativa(ws: string): Promise<void> {
    const ids = semEstimativaIds(ws);
    if (ids.length > 0) await estimarCom(ws, ids);
  }

  // ---------------------------------------------------------------- painel e previsão
  const ocorrenciasDe = (ws: string): OcorrenciaRunx[] => ultimasOcorrencias.get(ws) ?? [];
  const bloqueios = (ws: string): number | null => d.metodo.bloqueiosAbertos(ws);

  function entradaPrevisao(ws: string, f: FiltrosAgil, iteracoes: number) {
    const cfg = config(ws);
    const todos = montarItensMetrica(bancoAgil, ws);
    const itens = filtrarItens(todos, f);
    const sprints = bancoAgil.sprints.valores().filter((s) => s.workspace_id === ws);
    const s = escolherSprint(sprints, f);
    const hoje = hojeDia();
    const doSprint = s ? itens.filter((i) => i.participacoes.some((p) => p.sprint_id === s.id && !p.removido_em)) : [];
    const restante = s ? doSprint.filter((i) => !i.concluida_em).length : 0;
    const amostra = amostraDiasUteis(throughput(itens, somarDias(hoje, -29), hoje, "dia"), cfg);
    const restam = s && s.fim >= hoje ? diasUteis(somarDias(hoje, 1), s.fim, cfg).length : s ? 0 : null;
    const semente = Number.parseInt(hash(`${ws}|${hoje}|${restante}`), 16) || 1;
    return { amostra, restante, iteracoes, semente, dias_uteis_restantes: restam, hoje, config: cfg };
  }
  const chaveFiltros = (f: FiltrosAgil): string => JSON.stringify([f.sprint_id, f.membro_id, f.agente, f.squad_id, f.de, f.ate]);
  const normalizarFiltros = (f?: Partial<FiltrosAgil>): FiltrosAgil => ({ ...FILTROS_VAZIOS, ...semUndef(f ?? {}) });

  function painel(ws: string, filtros?: Partial<FiltrosAgil>): PainelAgil {
    exigirWs(ws);
    const f = normalizarFiltros(filtros);
    if (f.sprint_id) sprint(ws, f.sprint_id);
    const cfg = config(ws);
    const chave = `${versaoDados(bancoAgil, ws)}|${hash(JSON.stringify(cfg))}|${ocorrenciasDe(ws).length}|${bloqueios(ws) ?? "x"}|${hojeDia()}|${Math.floor(agora() / 60_000)}`;
    const k = `${ws}|${chaveFiltros(f)}`;
    const c = cachePainel.get(k);
    if (c && c.chave === chave) return c.painel;
    const entrada = entradaPrevisao(ws, f, ITER_PADRAO);
    const previsao: PrevisaoEstado = entrada.restante > 0 ? preverTermino(entrada) : { estado: "dados_insuficientes" };
    const p = montarPainel({ banco: bancoAgil, config: cfg, relogio, ocorrencias: ocorrenciasDe(ws), bloqueios_abertos: bloqueios(ws), previsao }, ws, f);
    cachePainel.set(k, { chave, painel: p });
    return p;
  }

  // ---------------------------------------------------------------- ganchos periódicos
  async function rodarGanchos(ws: string): Promise<void> {
    if (!d.workspaceExiste(ws)) return;
    const cfg = config(ws);
    const itens = trecho("gancho_itens", () => montarItensMetrica(bancoAgil, ws));
    const t = agora();
    // (1) tarefa atrasada: uma vez por episódio. Depois de reiniciar, o que já estava atrasado não dispara de novo (semeia sem publicar).
    const atr = trecho("gancho_atrasos", () => detectarAtrasadas(itens, t));
    const antes = atrasoAbertos.get(ws) ?? new Set<string>();
    const jaHouve = bancoAgil.eventos.valores().some((e) => e.workspace_id === ws && e.tipo === "tarefa.atrasada");
    const r1 = eventosDeAtraso(ws, relogio, atr, antes);
    if (!semeado.has(`atraso|${ws}`) && jaHouve && antes.size === 0) { /* reinício: só semeia */ } else for (const ev of r1.eventos) pub.publicar(ev);
    semeado.add(`atraso|${ws}`);
    atrasoAbertos.set(ws, r1.abertos);
    // (2) WIP excedido: uma vez por episódio
    const limites = await limitesWip(ws, cfg, portas.board);
    const r2 = verificarWip(ws, relogio, contarPorColuna(itens), limites, wipAbertos.get(ws) ?? new Set());
    for (const ev of r2.eventos) pub.publicar(ev);
    wipAbertos.set(ws, r2.abertos);
    await ceder();
    // (3) sprint em risco: indicador de progresso vermelho em dias úteis seguidos (a série vem dos snapshots diários)
    const ativa = bancoAgil.sprints.valores().find((s) => s.workspace_id === ws && s.estado === "ativa");
    if (ativa) {
      const p = trecho("painel", () => painel(ws, { sprint_id: ativa.id }));
      const cor = p.saude.find((x) => x.id === "progresso")?.cor ?? null;
      if (cor !== null) {
        gravarSnapshots(bancoAgil, [{ workspace_id: ws, escopo: "sprint", chave: ativa.id, dia: hojeDia(), metrica: "progresso_cor", valor: CORES[cor] ?? 0 }]);
        const serie = serieSnapshots(bancoAgil, ws, "sprint", ativa.id, "progresso_cor").map((x) => COR_DE[x.valor ?? 0] ?? "verde");
        const risco = sprintEmRisco(serie, 1);
        const chave = `${ws}|${ativa.id}`;
        if (risco && !riscoAberto.has(chave)) { riscoAberto.add(chave); pub.publicar(novoEvento("sprint.em_risco", ws, relogio, { sprint_id: ativa.id, pontos: ativa.compromisso_pontos, dados: { indicador: "progresso" } })); }
        else if (!risco) riscoAberto.delete(chave);
      }
    } else for (const k of [...riscoAberto]) if (k.startsWith(`${ws}|`)) riscoAberto.delete(k);
    await ceder();
    // snapshot diário geral (idempotente por dia)
    if (itens.length > 0) trecho("snapshot_dia", () => gravarSnapshots(bancoAgil, snapshotsDoPainel(ws, hojeDia(), trecho("painel", () => painel(ws)))));
    // (4) ação de retro vencida: uma vez cada
    publicarAcoesVencidas({ banco: bancoAgil, relogio, id: a.id, pub }, ws, hojeDia());
  }

  // ---------------------------------------------------------------- consultas de item
  const ITEM_STATUS = (i: { estado_fluxo: string }): string => ({ backlog: "backlog", pronto: "ready", em_andamento: "in_progress", concluida: "done", validada: "validated", orfao: "orphan" } as Record<string, string>)[i.estado_fluxo] ?? "backlog";

  async function itemLerImpl(ws: string, itemId: string): Promise<ItemDetalheAgil> {
    const it = item(ws, itemId);
    const metricas = montarItensMetrica(bancoAgil, ws).find((m) => m.item_id === itemId) as ItemMetrica;
    const membrosRot = new Map(bancoAgil.membros.valores().filter((m) => m.workspace_id === ws).map((m) => [m.id, m.rotulo]));
    const est = estimativaAtiva(bancoAgil, itemId);
    const resumo = {
      id: it.id, origem: it.origem, trabalho_id: it.trabalho_id, task_ref: it.task_ref, titulo: it.titulo, epico_id: it.epico_id, estado_ade: it.estado_ade, estado_fluxo: metricas.estado_fluxo,
      pontos: metricas.pontos, categoria: metricas.categoria, risco: metricas.risco, criticidade: metricas.criticidade, ordem: it.ordem, wsjf: null as number | null, situacao_retrabalho: metricas.situacao,
      duracao_obs_ms: metricas.duracao_obs_ms, sprint_id: metricas.participacoes.find((p) => !p.removido_em)?.sprint_id ?? null,
      dono: metricas.membro_id ? membrosRot.get(metricas.membro_id) ?? metricas.membro_id : null, estimativa_origem: metricas.estimativa_origem, estimativa_confianca: est?.confianca ?? null,
    };
    const fato = it.trabalho_id && it.task_ref ? bancoAgil.fatos.get(chaveTask(ws, it.trabalho_id, it.task_ref)) ?? null : null;
    const eventos = bancoAgil.eventosRetrabalho.valores().filter((e) => e.workspace_id === ws && ((it.trabalho_id !== null && e.trabalho_id === it.trabalho_id && e.task_ref === it.task_ref) || e.item_id === it.id));
    const manuais = new Map(bancoAgil.dodResultados.valores().filter((r) => r.item_id === itemId).map((r) => [r.criterio, r]));
    const f = fontesDoWs(ws).find((x) => x.trabalho.id === it.trabalho_id);
    const dod = avaliarDoD({ fato, categoria: metricas.categoria, qa_aprovado: qaAprovado(f), regras_violadas_abertas: null }, config(ws), manuais);
    const erro = bancoAgil.erros.get(itemId);
    const jaVinculados = new Set(bancoAgil.itens.valores().filter((x) => x.workspace_id === ws && x.trabalho_id).map((x) => x.trabalho_id as string));
    const vinculos = it.origem === "metodo" ? [] : sugerirVinculos(it, fontesDoWs(ws).map((x) => ({ id: x.trabalho.id, titulo: x.trabalho.titulo })), jaVinculados);
    return {
      item: it, resumo, estimativas: historicoEstimativas(bancoAgil, itemId), classificacoes: bancoAgil.classificacoes.valores().filter((c) => c.item_id === itemId).sort((x, y) => x.versao - y.versao),
      dod, fato, retrabalho: { situacao: metricas.situacao, eventos }, erro_estimativa: erro ? { razao: erro.razao, observado_ms: erro.observado_ms, previsto: erro.pontos_previstos } : null,
      vinculos_sugeridos: vinculos.slice(0, 5), sprint_id: resumo.sprint_id,
    };
  }
  const fontesDoWs = (ws: string): FonteTrabalho[] => ultimasFontes.get(ws) ?? [];
  const qaAprovado = (f: FonteTrabalho | undefined): boolean | null => (f === undefined || f.qa === null || f.qa.veredito === null ? null : f.qa.veredito === "aprovado");

  // ---------------------------------------------------------------- capacidade e planejamento
  function capacidade(ws: string, s: SprintAgil): CapacidadeSprintAgil {
    const cfg = config(ws);
    const ms_ = bancoAgil.membros.valores().filter((m) => m.workspace_id === ws && m.ativo);
    const dias = diasUteis(s.inicio, s.fim, cfg).length;
    const itens = montarItensMetrica(bancoAgil, ws);
    const fechadas = bancoAgil.sprints.valores().filter((x) => x.workspace_id === ws && x.estado === "fechada").sort((x, y) => x.fim.localeCompare(y.fim));
    const noWs = new Set(itens.map((i) => i.item_id));
    const hpp = horasPorPontoCalibrado(bancoAgil.erros.valores().filter((e) => noWs.has(e.item_id)), cfg.amostra_minima);
    const aus = extras.capacidades.listar(s.id);
    const linhas = ms_.map((m) => {
      const vel = fechadas.map((f) => itens.filter((i) => i.membro_id === m.id && i.participacoes.some((p) => p.sprint_id === f.id && p.resultado === "concluido")).reduce((x, i) => x + (i.pontos ?? 0), 0)).filter((v) => v > 0);
      const c = capacidadeMembro(m, { dias_uteis: dias, ausencias_dias: aus.get(m.id) ?? 0, horas_por_ponto: hpp, ultimas_velocidades: vel, config: cfg });
      return { membro_id: m.id, rotulo: m.rotulo, tipo: m.tipo, dias_uteis: c.dias_uteis, ausencias_dias: c.ausencias_dias, pontos: c.pontos, base: c.base, aviso: c.aviso };
    });
    const tot = capacidadeTotal(linhas.map((l) => ({ membro_id: l.membro_id, dias_uteis: l.dias_uteis, ausencias_dias: l.ausencias_dias, pontos: l.pontos, base: l.base, aviso: l.aviso })));
    return { sprint_id: s.id, linhas, total: tot.pontos, sem_base: tot.sem_base };
  }

  // ---------------------------------------------------------------- retro (insights)
  function insightsDa(ws: string, s: SprintAgil | null): Insights {
    const cfg = config(ws);
    const itens = montarItensMetrica(bancoAgil, ws);
    const doSprint = s ? itens.filter((i) => i.participacoes.some((p) => p.sprint_id === s.id)) : itens;
    const ev = new Map<string, number>();
    for (const e of bancoAgil.eventosRetrabalho.valores()) if (e.workspace_id === ws && e.ativo && e.forca === "forte" && e.natureza === "defeito" && e.task_ref) ev.set(`${e.trabalho_id}/${e.task_ref}`, (ev.get(`${e.trabalho_id}/${e.task_ref}`) ?? 0) + 1);
    const p = painel(ws, s ? { sprint_id: s.id } : undefined);
    const wipVals = p.wip.dias.map((x) => x.valor);
    const t = agora();
    const bl: { ref: string; dias: number }[] = [];
    for (const f of fontesDoWs(ws)) for (const b of f.trabalho.bloqueios) if (b.aberto) { const t0 = ms(b.aberto_em); bl.push({ ref: `${f.trabalho.id}/${b.task ?? "-"}`, dias: t0 === null ? 0 : Math.max(0, Math.round((t - t0) / DIA_MS)) }); }
    const ids = new Set(itens.map((i) => i.item_id));
    const anteriores = p.retrabalho.por_sprint.filter((x) => !s || x.sprint_id !== s.id).slice(-3).map((x) => x.resumo.first_time_right).filter((x): x is number => x !== null);
    const ftrSprint = s ? p.retrabalho.por_sprint.find((x) => x.sprint_id === s.id)?.resumo.first_time_right ?? resumirRetrabalho(doSprint.filter((i) => i.situacao !== null || i.concluida_em).map((i) => ({ chave: i.ref, situacao: i.situacao, eventos_pendentes: i.eventos_pendentes, pontos: i.pontos, categoria: i.categoria, sprint_id: s.id, membro_id: i.membro_id, agente: i.agente, squad_id: i.squad_id, retrabalho_ms: i.retrabalho_ms }))).first_time_right : null;
    void cfg;
    return calcularInsights({
      itens: doSprint, eventos_por_ref: ev, erros: bancoAgil.erros.valores().filter((e) => ids.has(e.item_id)), titulos: new Map(itens.map((i) => [i.ref, i.titulo])),
      wip_medio: wipVals.length ? wipVals.reduce((x, y) => x + y, 0) / wipVals.length : null, wip_limite: p.wip.limite, bloqueios: bl, ftr_sprint: ftrSprint ?? null,
      ftr_media_movel: anteriores.length ? anteriores.reduce((x, y) => x + y, 0) / anteriores.length : null,
      acoes_anteriores: bancoAgil.retroAcoes.valores().filter((x) => bancoAgil.cerimonias.get(x.cerimonia_id)?.workspace_id === ws), hoje: hojeDia(), agora: t,
    });
  }
  function retroDe(ws: string, cerimoniaId: string): RetroAgil {
    const c = cerimonia(ws, cerimoniaId);
    if (c.tipo !== "retro") throw naoEncontrado("retro não encontrada");
    const conteudo = c.conteudo as { colunas: string[]; insights: Insights | null };
    const hoje = hojeDia();
    return {
      cerimonia: { id: c.id, sprint_id: c.sprint_id, formato: c.formato, data: c.data, insights: conteudo.insights ?? null },
      itens: bancoAgil.retroItens.valores().filter((x) => x.cerimonia_id === c.id).sort((x, y) => y.votos - x.votos || x.criado_em.localeCompare(y.criado_em)).map((x) => ({ id: x.id, coluna: x.coluna, texto: x.texto, votos: x.votos, dado: x.dado, autor_membro_id: x.autor_membro_id })),
      acoes: bancoAgil.retroAcoes.valores().filter((x) => x.cerimonia_id === c.id).map((x) => ({ id: x.id, texto: x.texto, dono_membro_id: x.dono_membro_id, prazo: x.prazo, estado: x.estado, item_id: x.item_id, vencida: x.estado === "aberta" && x.prazo !== null && x.prazo < hoje })),
      colunas: conteudo.colunas,
    };
  }

  // ---------------------------------------------------------------- exportação
  function linhasDeMetricas(p: PainelAgil): Record<string, unknown>[] {
    const L: Record<string, unknown>[] = [];
    for (const v of p.velocidade) L.push({ metrica: "velocidade", chave: v.nome, valor: v.concluido, extra: v.compromisso });
    for (const t of p.throughput) L.push({ metrica: "throughput", chave: t.dia, valor: t.valor, extra: null });
    for (const [n, x] of [["cycle_p50_ms", p.cycle.p50], ["cycle_p85_ms", p.cycle.p85], ["lead_p85_ms", p.lead.p85], ["ir", p.retrabalho.ir], ["ir_max", p.retrabalho.ir_max], ["ftr", p.retrabalho.first_time_right]] as const) L.push({ metrica: n, chave: "geral", valor: x, extra: null });
    for (const s of p.saude) L.push({ metrica: "saude", chave: s.id, valor: s.cor, extra: s.frase });
    return L;
  }

  // ---------------------------------------------------------------- porta do MCP
  const erroMcp = (e: unknown): never => {
    if (e instanceof ErroMcp) throw e;
    if (e instanceof ErroAgil) {
      if (e.code === "rule_violation") throw new ErroMcp("rule_violation", e.message, e.subcode === "human_only" ? ("human_only" as never) : undefined);
      throw new ErroMcp(e.code, e.message);
    }
    aviso(`mcp ágil: ${e instanceof Error ? e.message : String(e)}`);
    throw new ErroMcp("unavailable", "Falha interna ao executar a tool.");
  };
  const cabe = (n: number, max: number): number => Math.max(1, Math.min(max, n));

  const portaMcp: PortaAgilMcp = {
    async chamar(tool: NomeToolAgil, claims: ClaimsDeAgil, args: Record<string, unknown>): Promise<unknown> {
      try {
        const ws = claims.workspace_id;
        exigirWs(ws);
        const propoe = tool === "backlog_propose" || tool === "estimate_propose";
        if (propoe && (claims.role !== "piloto" || claims.mode === "livre")) throw new ErroMcp("rule_violation", "Só o piloto de uma Missão em modo squad ou agêntico pode propor.", "forbidden_role");
        switch (tool) {
          case "backlog_list": {
            const status = typeof args["status"] === "string" ? args["status"] : null;
            const fluxo = status === null ? null : ({ backlog: "backlog", ready: "pronto", in_progress: "em_andamento", done: "concluida", validated: "validada", orphan: "orfao" } as Record<string, string>)[status];
            if (status !== null && fluxo === undefined) throw new ErroMcp("invalid_argument", "status inválido.");
            const epic = typeof args["epic_id"] === "string" ? args["epic_id"] : null;
            if (epic) epico(ws, epic);
            const limit = cabe(typeof args["limit"] === "number" ? args["limit"] : 25, 100);
            const cursor = typeof args["cursor"] === "string" ? args["cursor"] : null;
            const pg = listarBacklog(bancoAgil, ws, { texto: null, epico_id: epic, estado_fluxo: (fluxo ?? null) as FiltrosBacklog["estado_fluxo"], categoria: null, risco: null, criticidade: null, sprint_id: null, sem_estimativa: null }, "ordem", cursor, limit);
            const base = cursor ? Number(cursor) || 0 : 0;
            return { items: pg.itens.map((i, k) => ({ id: i.id, title: truncar(i.titulo, 120), status: ITEM_STATUS(i), points: i.pontos, category: i.categoria, risk: i.risco, criticality: i.criticidade, priority_rank: base + k + 1 })), next: pg.proximo };
          }
          case "backlog_get": {
            const id = String(args["item_id"] ?? "");
            const det = await itemLerImpl(ws, id);
            return {
              id: det.item.id, title: det.item.titulo, description: det.item.descricao === null ? null : truncar(det.item.descricao, 600), criteria: det.item.criterios, status: ITEM_STATUS(det.resumo), origin: det.item.origem,
              proposed_by_agent: (det.item.origem_ref as { proposto_por?: string } | null)?.proposto_por === "agente", points: det.resumo.pontos, category: det.resumo.categoria, risk: det.resumo.risco, criticality: det.resumo.criticidade,
              rework: det.resumo.situacao_retrabalho, sprint_id: det.resumo.sprint_id,
              estimates: det.estimativas.slice(-10).map((e) => ({ version: e.versao, points: e.pontos, origin: e.origem, engine: e.motor, confidence: e.confianca, state: e.estado, active: e.ativa })),
            };
          }
          case "backlog_propose": {
            const propostos = bancoAgil.itens.valores().filter((i) => i.workspace_id === ws && (i.origem_ref as { proposto_por?: string } | null)?.proposto_por === "agente");
            const naHora = propostos.filter((i) => (ms(i.criado_em) ?? 0) > agora() - 3_600_000).length;
            if (naHora >= LIMITE_PROPOSTAS_HORA) throw new ErroMcp("rule_violation", "Limite de propostas de agente por hora atingido; peça ao humano para revisar o backlog.", "limit_reached");
            if (propostos.filter((i) => i.estado_ade !== "descartado").length >= LIMITE_PROPOSTAS_ABERTAS) throw new ErroMcp("rule_violation", "Há propostas de agente demais aguardando revisão humana.", "limit_reached");
            const title = String(args["title"] ?? "").trim();
            if (!title || title.length > 300) throw new ErroMcp("invalid_argument", "título inválido (1 a 300 caracteres).");
            const description = typeof args["description"] === "string" ? truncar(args["description"], 2000) : null;
            const criteria = Array.isArray(args["criteria"]) ? (args["criteria"] as unknown[]).filter((c): c is string => typeof c === "string" && c.trim() !== "").slice(0, 10) : [];
            const epic = typeof args["epic_id"] === "string" ? args["epic_id"] : null;
            if (epic) epico(ws, epic);
            const it = criarItem(dep(ws), { workspace_id: ws, origem: "ade", titulo: title, descricao: description, criterios: criteria, epico_id: epic, origem_ref: { proposto_por: "agente" } });
            cachePainel.clear();
            emitir({ tipo: "metricas_atualizadas", workspace_id: ws, quando: isoDe(agora()) });
            return { item_id: it.id, state: "backlog" };
          }
          case "estimate_get": {
            const it = resolverRef(ws, String(args["item_ref"] ?? ""));
            const e = estimativaAtiva(bancoAgil, it.id);
            const c = classificacaoAtiva(bancoAgil, it.id);
            return {
              item_id: it.id,
              estimate: e && { points: e.pontos, label: e.rotulo, origin: e.origem, engine: e.motor, confidence: e.confianca, state: e.estado, factors: e.fatores.slice(0, 5).map((f) => ({ factor: f.fator, direction: f.direcao })) },
              classification: c && { category: c.categoria, risk: c.risco, criticality: c.criticidade, origin: c.origem, state: c.estado },
              history: historicoEstimativas(bancoAgil, it.id).slice(-10).map((x) => ({ version: x.versao, points: x.pontos, origin: x.origem, state: x.estado })),
            };
          }
          case "estimate_propose": {
            const estado = args["state"];
            if (estado !== undefined && estado !== "sugerida") throw new ErroAgil("rule_violation", "ação reservada a humano: decidir estimativa", "human_only");
            const it = resolverRef(ws, String(args["item_ref"] ?? ""));
            // o cálculo das métricas não é reescrito depois do fato: item concluído, em sprint já encerrada, órfão ou descartado só o humano reestima
            const met = montarItensMetrica(bancoAgil, ws).find((m) => m.item_id === it.id);
            if (it.estado_ade === "descartado" || it.orfao || met?.concluida_em || met?.participacoes.some((p) => p.resultado !== null || bancoAgil.sprints.get(p.sprint_id)?.estado === "fechada")) throw new ErroMcp("rule_violation", "Item concluído, descartado ou de sprint encerrada: só o humano reestima.", "forbidden_role");
            const versoes = historicoEstimativas(bancoAgil, it.id);
            if (versoes.length >= LIMITE_VERSOES_AGENTE) throw new ErroMcp("rule_violation", "Versões de estimativa demais para este item; peça ao humano para decidir.", "limit_reached");
            const points = args["points"];
            if (typeof points !== "number" || !Number.isFinite(points) || points <= 0 || points > 1000) throw new ErroMcp("invalid_argument", "points deve ser um número positivo.");
            const rationale = typeof args["rationale"] === "string" ? truncar(redigirSegredos(args["rationale"]), 400) : "";
            // valida TUDO antes de gravar qualquer coisa (nada de escrita pela metade)
            const cfg = config(ws);
            const cat = typeof args["category"] === "string" ? args["category"] : null;
            const risk = typeof args["risk"] === "string" ? args["risk"] : null;
            const crit = typeof args["criticality"] === "string" ? args["criticality"] : null;
            let classificacao: { categoria: string; risco: string; criticidade: string; tipo_task: string | null; risco_fatores: FatorRisco[] } | null = null;
            if (cat !== null || risk !== null || crit !== null) {
              const atual = classificacaoAtiva(bancoAgil, it.id);
              const categoria = cat ?? atual?.categoria;
              const risco = risk ?? atual?.risco;
              const criticidade = crit ?? atual?.criticidade;
              if (categoria === undefined || risco === undefined || criticidade === undefined) throw new ErroMcp("invalid_argument", "informe category, risk e criticality juntos (ainda não há classificação).");
              if (!cfg.categorias.includes(categoria)) throw new ErroMcp("invalid_argument", "category fora da configuração.");
              if (!["baixo", "medio", "alto", "critico"].includes(risco)) throw new ErroMcp("invalid_argument", "risk inválido.");
              if (!["baixa", "media", "alta", "critica"].includes(criticidade)) throw new ErroMcp("invalid_argument", "criticality inválida.");
              classificacao = { categoria, risco, criticidade, tipo_task: atual?.tipo_task ?? null, risco_fatores: atual?.risco_fatores ?? [] };
            }
            const atualAgente = estimativaAtiva(bancoAgil, it.id);
            if (classificacao === null && atualAgente && atualAgente.motor === "agente" && atualAgente.estado === "sugerida" && atualAgente.pontos === ajustarAEscala(points, escalaDe(cfg)).valor) return { applied: true, estimate_id: atualAgente.id, state: "sugerida", unchanged: true };
            const r = bancoAgil.transacao(() => {
              const e = proporEstimativa(dep(ws), { item_id: it.id, pontos: points, origem: "ia", motor: "agente", confianca: null, fatores: [{ fator: "proposta_do_agente", direcao: "sobe", evidencia: rationale }], min_h: null, max_h: null, nota: rationale || null });
              if (e.aplicada && classificacao !== null) proporClassificacao(dep(ws), { item_id: it.id, categoria: classificacao.categoria, risco: classificacao.risco as never, criticidade: classificacao.criticidade as never, tipo_task: classificacao.tipo_task, risco_fatores: classificacao.risco_fatores, motor: "agente", confianca: null });
              return e;
            });
            if (!r.aplicada) return { applied: false, reason: r.motivo, estimate_id: r.estimativa?.id ?? null, state: r.estimativa?.estado ?? null };
            cachePainel.clear();
            return { applied: true, estimate_id: r.estimativa?.id ?? null, state: "sugerida" };
          }
          case "sprint_status": {
            const sid = typeof args["sprint_id"] === "string" ? args["sprint_id"] : null;
            const s = sid ? sprint(ws, sid) : escolherSprint(bancoAgil.sprints.valores().filter((x) => x.workspace_id === ws), FILTROS_VAZIOS);
            if (!s) throw new ErroMcp("not_found", "Não há sprint.");
            const p = painel(ws, { sprint_id: s.id });
            const st = statusDaSprint(p, s.nome, s.id, s.estado);
            return { sprint: { id: s.id, name: s.nome, state: s.estado, start: s.inicio, end: s.fim }, committed: st.committed, done: st.done, remaining: st.remaining, health: st.health.map((h) => ({ id: h.id, color: h.cor, text: h.frase })) };
          }
          case "rework_list": {
            const limit = cabe(typeof args["limit"] === "number" ? args["limit"] : 50, 100);
            const sid = typeof args["sprint_id"] === "string" ? args["sprint_id"] : null;
            if (sid) sprint(ws, sid);
            const r = listarRetrabalho(bancoAgil, ws, limit);
            return r;
          }
          case "metrics_get": {
            const m = String(args["metric"] ?? "");
            if (!(METRICAS_NOMEADAS as readonly string[]).includes(m)) throw new ErroMcp("invalid_argument", `metric deve ser um de: ${METRICAS_NOMEADAS.join(", ")}.`);
            const sid = typeof args["sprint_id"] === "string" ? args["sprint_id"] : null;
            if (sid) sprint(ws, sid);
            return { metric: m, data: metricaPorNome(painel(ws, sid ? { sprint_id: sid } : undefined), m as MetricaNomeada) };
          }
        }
      } catch (e) {
        return erroMcp(e);
      }
    },
  };
  /** `item_ref` = id do item ou `trabalho/task`; sempre dentro do workspace do token. */
  function resolverRef(ws: string, ref: string): ItemAgil {
    if (ref.trim() === "" || ref.length > 200) throw invalido("item_ref inválido");
    const direto = bancoAgil.itens.get(ref);
    if (direto) { if (direto.workspace_id !== ws) throw naoEncontrado("item não encontrado"); return direto; }
    const [t, k] = ref.split("/");
    const it = bancoAgil.itens.valores().find((i) => i.workspace_id === ws && i.trabalho_id === t && i.task_ref === k);
    if (!it) throw naoEncontrado("item não encontrado");
    return it;
  }

  // ---------------------------------------------------------------- serviço
  const servico: ServicoAgil = {
    async estado(ws) {
      exigirWs(ws);
      const cfg = config(ws);
      const perfil = await portas.perfil.resolver(ws, "agil", "estimativa").catch(() => null);
      const ativa = bancoAgil.sprints.valores().find((s) => s.workspace_id === ws && s.estado === "ativa") ?? null;
      return {
        workspace_id: ws, sincronizando: sincronizando.has(ws), ultima_sincronizacao: ultimaSync.get(ws) ?? null, erro_sincronizacao: erroSync.get(ws) ?? null,
        base: { tasks: bancoAgil.fatos.valores().filter((f) => f.workspace_id === ws).length, itens: bancoAgil.itens.valores().filter((i) => i.workspace_id === ws).length, sprints: bancoAgil.sprints.valores().filter((s) => s.workspace_id === ws).length, membros: bancoAgil.membros.valores().filter((m) => m.workspace_id === ws).length },
        ia: { consentimento: consent.lerSync(ws), modo: cfg.estimativa_modo, chamadas_hoje: chamadasHoje(bancoAgil, ws, relogio), teto_dia: cfg.estimativa_max_chamadas_dia, perfil: perfil ? `${perfil.cli}${perfil.modelo ? `:${perfil.modelo}` : ""}` : null, disponivel: perfil !== null },
        sprint_ativa: ativa ? { id: ativa.id, nome: ativa.nome, inicio: ativa.inicio, fim: ativa.fim } : null,
      };
    },
    configLer(ws) { exigirWs(ws); return config(ws); },
    configGravar(ws, parcial) {
      exigirWs(ws);
      const r = a.config.gravar(ws, parcial);
      cachePainel.clear();
      return r;
    },
    consentimentoIa(ws, consentido) {
      exigirWs(ws);
      consent.definir(ws, consentido === true);
      try { bancoAgil.auditoria.set(String(bancoAgil.auditoria.valores().length + 1), { seq: bancoAgil.auditoria.valores().length + 1, acao: consentido ? "ia.consentir" : "ia.revogar", ator: "humano", workspace_id: ws, alvo: "estimativa_por_ia", motivo: null, quando: isoDe(agora()) }); } catch { /* auditoria nunca derruba */ }
      return { consentimento: consentido === true };
    },
    sincronizar(ws, forcar = false) { return sincronizarFila(ws, forcar); },
    async aguardarSincronizacao(ws) { await esperas.get(ws); },
    async aguardarJobs() { await Promise.all([...jobsP]); },
    membroListar(ws) { exigirWs(ws); return bancoAgil.membros.valores().filter((m) => m.workspace_id === ws); },
    membroGravar(ws, m) {
      exigirWs(ws);
      const ant = m.id ? membro(ws, m.id) : null;
      const rotulo = m.rotulo.trim();
      if (!rotulo || rotulo.length > 80) throw invalido("rótulo do membro (1 a 80 caracteres)");
      if (m.fator_foco !== undefined && (m.fator_foco <= 0 || m.fator_foco > 1)) throw invalido("fator_foco deve estar entre 0 e 1");
      if (m.horas_dia != null && (m.horas_dia <= 0 || m.horas_dia > 24)) throw invalido("horas_dia deve estar entre 0 e 24");
      if (m.pontos_sprint_fixo != null && (m.pontos_sprint_fixo < 0 || m.pontos_sprint_fixo > 1000)) throw invalido("pontos_sprint_fixo inválido");
      const aliases = (m.aliases ?? ant?.aliases ?? []).slice(0, 20).map((x) => ({ tipo: x.tipo, valor: x.valor.trim().slice(0, 120) })).filter((x) => x.valor !== "");
      const novo: MembroAgil = {
        id: ant?.id ?? a.id("mbr"), workspace_id: ws, tipo: m.tipo, rotulo, squad_id: m.squad_id ?? ant?.squad_id ?? null, horas_dia: m.horas_dia ?? ant?.horas_dia ?? null,
        fator_foco: m.fator_foco ?? ant?.fator_foco ?? config(ws).fator_foco_padrao, pontos_sprint_fixo: m.pontos_sprint_fixo ?? ant?.pontos_sprint_fixo ?? null, ativo: m.ativo ?? ant?.ativo ?? true, aliases,
      };
      bancoAgil.membros.set(novo.id, novo);
      cachePainel.clear();
      return novo;
    },
    backlogListar(ws, p) {
      exigirWs(ws);
      const f: FiltrosBacklog = { texto: null, epico_id: null, estado_fluxo: null, categoria: null, risco: null, criticidade: null, sprint_id: null, sem_estimativa: null, ...semUndef(p.filtros ?? {}) };
      if (f.sprint_id) sprint(ws, f.sprint_id);
      if (f.epico_id) epico(ws, f.epico_id);
      return listarBacklog(bancoAgil, ws, f, p.ordenar === "wsjf" ? "wsjf" : "ordem", p.cursor ?? null, p.limite ?? 100);
    },
    itemLer: (ws, id) => { exigirWs(ws); return itemLerImpl(ws, id); },
    itemCriar(ws, n) {
      exigirWs(ws);
      if (n.epico_id) epico(ws, n.epico_id);
      const it = criarItem(dep(ws), { workspace_id: ws, titulo: n.titulo, descricao: n.descricao === undefined ? null : n.descricao === null ? null : truncar(n.descricao, 4000), criterios: n.criterios ?? [], epico_id: n.epico_id ?? null, ...(n.origem ? { origem: n.origem } : {}) });
      cachePainel.clear();
      return it;
    },
    itemAtualizar(ws, id, campos) {
      exigirWs(ws);
      item(ws, id);
      conferirReferencias(ws, campos);
      const { estado_ade, ...resto } = campos;
      let r = atualizarItem(dep(ws), id, resto);
      if (estado_ade !== undefined) {
        if (r.origem === "metodo") throw regraViolada("item espelho do método: estado vem do disco");
        r = { ...r, estado_ade, atualizado_em: isoDe(agora()) };
        bancoAgil.itens.set(id, r);
      }
      cachePainel.clear();
      return r;
    },
    itemDescartar(ws, id, motivo) { exigirWs(ws); item(ws, id); const r = descartarItem(dep(ws), id, redigirSegredos(motivo)); cachePainel.clear(); return r; },
    itemReordenar(ws, id, antesId) {
      exigirWs(ws);
      item(ws, id);
      if (antesId !== null) item(ws, antesId);
      const ordenado = bancoAgil.itens.valores().filter((i) => i.workspace_id === ws && i.estado_ade !== "descartado").sort((x, y) => x.ordem - y.ordem).map((i) => ({ id: i.id, ordem: i.ordem }));
      const r = reordenar(ordenado, id, antesId);
      bancoAgil.transacao(() => {
        if (r.rebalanceados) for (const [k, v] of r.rebalanceados) { const i = bancoAgil.itens.get(k); if (i) bancoAgil.itens.set(k, { ...i, ordem: v }); }
        const it = bancoAgil.itens.get(id) as ItemAgil;
        bancoAgil.itens.set(id, { ...it, ordem: r.rebalanceados?.get(id) ?? r.ordem });
      });
      return { ordem: r.rebalanceados?.get(id) ?? r.ordem };
    },
    itemPromover(ws, id, destino) { exigirWs(ws); return { comando: comandoDePromocao(item(ws, id), destino) }; },
    itemVincular(ws, id, trabalhoId, taskRef) {
      exigirWs(ws);
      item(ws, id);
      if (trabalhoId !== null && !fontesDoWs(ws).some((f) => f.trabalho.id === trabalhoId)) throw naoEncontrado("trabalho do método não encontrado");
      const r = vincularItem(dep(ws), id, trabalhoId, taskRef);
      cachePainel.clear();
      return r;
    },
    epicoListar(ws) { exigirWs(ws); return bancoAgil.epicos.valores().filter((e) => e.workspace_id === ws).sort((x, y) => x.ordem - y.ordem); },
    epicoGravar(ws, e) { exigirWs(ws); if (e.id) epico(ws, e.id); return gravarEpico(dep(ws), { ...e, workspace_id: ws }); },
    epicoApagar(ws, id) { exigirWs(ws); epico(ws, id); apagarEpico(dep(ws), id); cachePainel.clear(); return { ok: true }; },
    async estimar(ws, itemIds) {
      exigirWs(ws);
      const ids = itemIds === "sem_estimativa" ? semEstimativaIds(ws) : itemIds.map((id) => item(ws, id).id);
      return estimarCom(ws, ids.slice(0, 500));
    },
    estimativaGravar(ws, p) {
      exigirWs(ws); item(ws, p.item_id);
      if (p.pontos !== undefined && (!Number.isFinite(p.pontos) || p.pontos <= 0 || p.pontos > 1000)) throw invalido("pontos deve ser um número positivo");
      const r = gravarEstimativaHumana(dep(ws), { ...p, ...(p.nota !== undefined && p.nota !== null ? { nota: redigirSegredos(p.nota) } : {}) });
      cachePainel.clear();
      return r;
    },
    classificacaoGravar(ws, p) { exigirWs(ws); item(ws, p.item_id); const r = gravarClassificacaoHumana(dep(ws), p); cachePainel.clear(); return r; },
    estimativaAceitarLote(ws, ids, min) { exigirWs(ws); const ok = ids.map((i) => item(ws, i).id); const r = aceitarEmLote(dep(ws), ok, min); cachePainel.clear(); return r; },
    sprintListar(ws) {
      exigirWs(ws);
      return bancoAgil.sprints.valores().filter((s) => s.workspace_id === ws).sort((x, y) => y.inicio.localeCompare(x.inicio)).map((s) => ({ ...s, itens: itensDaSprint(bancoAgil, s.id) }));
    },
    sprintCriar(ws, s) { exigirWs(ws); const r = criarSprint(dep(ws), { ...s, workspace_id: ws }); emitir({ tipo: "sprint_mudou", workspace_id: ws, sprint_id: r.id, quando: isoDe(agora()) }); return r; },
    sprintAtualizar(ws, id, c) { exigirWs(ws); sprint(ws, id); const r = atualizarSprint(dep(ws), id, c); cachePainel.clear(); return r; },
    sprintIniciar(ws, id) { exigirWs(ws); sprint(ws, id); const r = iniciarSprint(dep(ws), id, "humano"); cachePainel.clear(); emitir({ tipo: "sprint_mudou", workspace_id: ws, sprint_id: id, quando: isoDe(agora()) }); return r; },
    sprintCancelar(ws, id) { exigirWs(ws); sprint(ws, id); const r = cancelarSprint(dep(ws), id, "humano"); cachePainel.clear(); emitir({ tipo: "sprint_mudou", workspace_id: ws, sprint_id: id, quando: isoDe(agora()) }); return r; },
    sprintItemMover(ws, sid, iid, ac, motivo) {
      exigirWs(ws); sprint(ws, sid); item(ws, iid);
      const m = motivo === null ? null : redigirSegredos(motivo);
      const r = ac === "adicionar" ? adicionarItem(dep(ws), sid, iid, m) : removerItem(dep(ws), sid, iid, m);
      cachePainel.clear();
      emitir({ tipo: "sprint_mudou", workspace_id: ws, sprint_id: sid, quando: isoDe(agora()) });
      return r;
    },
    sprintFechar(ws, sid, destino, versao) {
      exigirWs(ws); sprint(ws, sid);
      const r = fecharSprint({ banco: bancoAgil, relogio, config: config(ws), pub }, { sprint_id: sid, destino_pendentes: destino, versao_lancamento: versao, ator: "humano" });
      cachePainel.clear();
      emitir({ tipo: "sprint_mudou", workspace_id: ws, sprint_id: sid, quando: isoDe(agora()) });
      return r as { resumo: ResumoFechamento; ja_fechada: boolean };
    },
    capacidadeLer(ws, sid) { exigirWs(ws); return capacidade(ws, sprint(ws, sid)); },
    capacidadeGravar(ws, sid, mid, aus) {
      exigirWs(ws);
      const s = sprint(ws, sid); membro(ws, mid);
      const dias = diasUteis(s.inicio, s.fim, config(ws)).length;
      if (!(aus >= 0 && aus <= dias)) throw invalido(`ausências devem estar entre 0 e ${dias} dias úteis`);
      extras.capacidades.gravar(sid, mid, dias, aus);
      return capacidade(ws, s);
    },
    planejamentoSugerir(ws, sid, buffer) {
      exigirWs(ws);
      const cfg = { ...config(ws), ...(buffer !== undefined ? { buffer_planejamento: Math.max(0, Math.min(0.9, buffer)) } : {}) };
      const s = sid ? sprint(ws, sid) : null;
      const itens = montarItensMetrica(bancoAgil, ws);
      const emOutra = new Set(bancoAgil.sprintItens.valores().filter((x) => !x.removido_em && bancoAgil.sprints.get(x.sprint_id)?.workspace_id === ws && x.sprint_id !== sid && ["planejada", "ativa"].includes(bancoAgil.sprints.get(x.sprint_id)?.estado ?? "")).map((x) => x.item_id));
      const cands = candidatosDoBacklog(itens.filter((i) => !emOutra.has(i.item_id)));
      const concl = new Set(itens.filter((i) => i.concluida_em).map((i) => i.item_id));
      const cap = s ? capacidade(ws, s).total : null;
      const r = sugerirCompromisso({ candidatos: cands, concluidos: concl, capacidade: cap, config: cfg });
      const porId = new Map(itens.map((i) => [i.item_id, i]));
      return { ...r, itens_detalhe: r.itens.map((id) => ({ item_id: id, titulo: porId.get(id)?.titulo ?? id, pontos: porId.get(id)?.pontos ?? null })) };
    },
    dailyGerar(ws, sid) {
      exigirWs(ws);
      const s = sid ? sprint(ws, sid) : bancoAgil.sprints.valores().find((x) => x.workspace_id === ws && x.estado === "ativa") ?? null;
      const cfg = config(ws);
      const itens = montarItensMetrica(bancoAgil, ws).filter((i) => (s ? i.participacoes.some((p) => p.sprint_id === s.id && !p.removido_em) : true));
      const membros = bancoAgil.membros.valores().filter((m) => m.workspace_id === ws);
      const idx = indexarMembros(membros);
      const hoje = hojeDia();
      const rastro = fontesDoWs(ws).flatMap((f) => f.rastro).filter((e) => e.ts >= somarDias(hoje, -7)).map((e) => ({ ...e, membro_id: idx.resolver({ agente: e.agente }).membro_id }));
      const bl = fontesDoWs(ws).flatMap((f) => f.trabalho.bloqueios.filter((b) => b.aberto).map((b) => ({ task: b.task, trabalho_id: f.trabalho.id, descricao: b.descricao })));
      const dly: Daily = gerarDaily({ itens, membros, rastro, bloqueios_abertos: bl, agora: agora(), config: cfg });
      const existente = bancoAgil.cerimonias.valores().find((c) => c.workspace_id === ws && c.tipo === "daily" && c.data === hoje && c.sprint_id === (s?.id ?? null));
      const id = existente?.id ?? a.id("cer");
      const t = isoDe(agora());
      // observações já escritas no mesmo dia sobrevivem à regeração
      const obs = new Map<string, string>();
      for (const m of ((existente?.conteudo as Daily | undefined)?.membros ?? [])) for (const k of ["ontem", "hoje", "bloqueios", "atrasos", "riscos"] as const) for (const l of m[k]) if (l.observacao) obs.set(l.ref, l.observacao);
      const completo: Daily = { ...dly, membros: dly.membros.map((m) => ({ ...m, ontem: m.ontem.map((l) => ({ ...l, observacao: obs.get(l.ref) ?? null })), hoje: m.hoje.map((l) => ({ ...l, observacao: obs.get(l.ref) ?? null })), bloqueios: m.bloqueios, atrasos: m.atrasos, riscos: m.riscos })) };
      bancoAgil.cerimonias.set(id, { id, workspace_id: ws, sprint_id: s?.id ?? null, tipo: "daily", data: hoje, formato: "texto", conteudo: completo, gerada_de_fatos_em: t, editada: existente?.editada ?? false, criado_em: existente?.criado_em ?? t, atualizado_em: t });
      return { ...completo, cerimonia_id: id };
    },
    dailySalvar(ws, cid, observacoes) {
      exigirWs(ws);
      const c = cerimonia(ws, cid);
      if (c.tipo !== "daily") throw naoEncontrado("daily não encontrada");
      const mapa = new Map(observacoes.slice(0, 200).map((o) => [o.ref, redigirSegredos(truncar(o.observacao, 400))]));
      const dly = c.conteudo as Daily;
      const aplicar = <L extends { ref: string; observacao: string | null }>(ls: L[]): L[] => ls.map((l) => (mapa.has(l.ref) ? { ...l, observacao: mapa.get(l.ref) || null } : l));
      const novo: Daily = { ...dly, membros: dly.membros.map((m) => ({ ...m, ontem: aplicar(m.ontem), hoje: aplicar(m.hoje), bloqueios: aplicar(m.bloqueios), atrasos: aplicar(m.atrasos), riscos: aplicar(m.riscos) })) };
      bancoAgil.cerimonias.set(cid, { ...c, conteudo: novo, editada: true, atualizado_em: isoDe(agora()) });
      return { ok: true };
    },
    reviewLer(ws, sid) {
      exigirWs(ws);
      sprint(ws, sid);
      const itens = montarItensMetrica(bancoAgil, ws);
      return montarReview(bancoAgil, config(ws), sid, itens, (i) => ({ qa_aprovado: qaAprovado(fontesDoWs(ws).find((f) => f.trabalho.id === i.trabalho_id)), regras_violadas_abertas: null })).map((r) => ({ ...r, demo: r.demo ? { resultado: r.demo.resultado, nota: r.demo.nota, em: r.demo.em } : null }));
    },
    reviewGravar(ws, sid, iid, resultado, nota, devolver) {
      exigirWs(ws); sprint(ws, sid); item(ws, iid);
      registrarDemo({ banco: bancoAgil, relogio }, sid, iid, resultado, nota === null ? null : redigirSegredos(truncar(nota, 400)), "humano");
      const devolvido = devolver && resultado !== "aceito" ? devolverAoBacklog({ banco: bancoAgil, relogio, id: a.id }, sid, iid) : null;
      if (devolvido) cachePainel.clear();
      return { devolvido_item_id: devolvido };
    },
    retroLer(ws, sid) {
      exigirWs(ws);
      const s = sprint(ws, sid);
      const existente = bancoAgil.cerimonias.valores().find((c) => c.workspace_id === ws && c.tipo === "retro" && c.sprint_id === sid);
      if (existente) return retroDe(ws, existente.id);
      const c = criarRetro({ banco: bancoAgil, relogio, id: a.id, pub }, { workspace_id: ws, sprint_id: sid, insights: insightsDa(ws, s), data: hojeDia() });
      return retroDe(ws, c.id);
    },
    retroItemGravar(ws, cid, p) {
      exigirWs(ws);
      cerimonia(ws, cid);
      const dr = { banco: bancoAgil, relogio, id: a.id, pub };
      if (p.item_id !== undefined) {
        const x = bancoAgil.retroItens.get(p.item_id);
        if (!x || x.cerimonia_id !== cid) throw naoEncontrado("item de retro não encontrado");
        votarRetro(dr, p.item_id, p.voto ?? 1);
      } else {
        if (p.coluna === undefined || p.texto === undefined) throw invalido("informe coluna e texto");
        adicionarItemRetro(dr, cid, p.coluna, redigirSegredos(p.texto));
      }
      return retroDe(ws, cid);
    },
    retroAcaoGravar(ws, cid, p) {
      exigirWs(ws);
      cerimonia(ws, cid);
      const dr = { banco: bancoAgil, relogio, id: a.id, pub };
      if (p.acao_id !== undefined) {
        const x = acao(ws, p.acao_id);
        if (x.cerimonia_id !== cid) throw naoEncontrado("ação não encontrada");
        atualizarAcao(dr, p.acao_id, p.estado ?? "aberta");
      } else {
        if (p.texto === undefined) throw invalido("texto da ação obrigatório");
        if (p.dono_membro_id) membro(ws, p.dono_membro_id);
        criarAcao(dr, cid, redigirSegredos(p.texto), p.dono_membro_id ?? null, p.prazo ?? null);
      }
      return retroDe(ws, cid);
    },
    retroAcaoParaItem(ws, aid) {
      exigirWs(ws);
      acao(ws, aid);
      const r = acaoParaItem({ banco: bancoAgil, relogio, id: a.id, pub }, aid);
      cachePainel.clear();
      return r;
    },
    retrabalhoListar(ws, limite) {
      exigirWs(ws);
      const base = listarRetrabalho(bancoAgil, ws, limite);
      const eventos = bancoAgil.eventosRetrabalho.valores().filter((e) => e.workspace_id === ws).sort((x, y) => y.detectado_em.localeCompare(x.detectado_em)).slice(0, Math.max(1, Math.min(200, limite)));
      const itens = bancoAgil.itens.valores().filter((i) => i.workspace_id === ws && i.trabalho_id && i.task_ref);
      const porTask = new Map(itens.map((i) => [`${i.trabalho_id}|${i.task_ref}`, i]));
      return {
        eventos,
        situacoes: base.situacoes.map((s) => { const i = porTask.get(`${s.trabalho_id}|${s.task_ref}`); return { ...s, situacao: s.situacao as SituacaoRetrabalho | null, item_id: i?.id ?? null, titulo: i?.titulo ?? null }; }),
      };
    },
    retrabalhoMarcar(ws, p) {
      exigirWs(ws);
      const r = marcarRetrabalho({ banco: bancoAgil, relogio, id: a.id }, { ...p, workspace_id: ws, ator: "humano" });
      processarRetrabalho({ banco: bancoAgil, relogio, id: a.id, config: config(ws) }, ws, fontesDoWs(ws).filter((f) => f.trabalho.id === p.trabalho_id), ocorrenciasDe(ws));
      cachePainel.clear();
      emitir({ tipo: "metricas_atualizadas", workspace_id: ws, quando: isoDe(agora()) });
      return r;
    },
    painel,
    previsao(ws, filtros, iteracoes) {
      exigirWs(ws);
      const f = normalizarFiltros(filtros);
      if (f.sprint_id) sprint(ws, f.sprint_id);
      const n = Math.max(100, Math.min(MAX_ITER_PREVISAO, Math.floor(iteracoes ?? ITER_PADRAO)));
      const prev = preverTermino(entradaPrevisao(ws, f, n));
      const job = `job_${Math.random().toString(36).slice(2, 10)}`;
      emitir({ tipo: "previsao_pronta", workspace_id: ws, job_id: job, quando: isoDe(agora()) });
      return { job_id: job, previsao: prev };
    },
    praticas(ws, sid) {
      exigirWs(ws);
      const s = sid ? sprint(ws, sid) : null;
      const todos = montarItensMetrica(bancoAgil, ws);
      const itens = s ? todos.filter((i) => i.participacoes.some((p) => p.sprint_id === s.id)) : todos;
      const refs = new Set(itens.map((i) => i.ref));
      const fatos = bancoAgil.fatos.valores().filter((f) => f.workspace_id === ws && (!s || refs.has(`${f.trabalho_id}/${f.task_ref}`)));
      const cfg = config(ws);
      const comPar = new Set(bancoAgil.itens.valores().filter((i) => i.workspace_id === ws && i.par_membro_id).map((i) => i.id));
      const xp = metricasXp({ fatos, itens, com_par: comPar, ci_verde: new Map(), revisao_independente: new Map(), config: cfg });
      const p = painel(ws, s ? { sprint_id: s.id } : undefined);
      const lean = desperdiciosLean({ itens, retrabalho: p.retrabalho, defeitos_escapados: p.defeitos_escapados.total });
      const manuais = new Map(s ? extras.checklists.listar(s.id).map((m) => [m.codigo, { estado: m.estado, nota: m.nota }]) : []);
      return { xp, lean, checklists: avaliarChecklist([...CHECKLIST_XP, ...CHECKLIST_LEAN], xp, manuais), sprint_id: s?.id ?? null };
    },
    checklistGravar(ws, sid, codigo, estado, nota) {
      exigirWs(ws);
      sprint(ws, sid);
      const def = [...CHECKLIST_XP, ...CHECKLIST_LEAN].find((c) => c.codigo === codigo);
      if (!def) throw invalido("código de checklist desconhecido");
      if (def.auto) throw regraViolada("item automático não aceita marcação manual");
      extras.checklists.gravar({ sprint_id: sid, codigo, grupo: def.grupo, estado, nota: nota === null ? null : redigirSegredos(truncar(nota, 400)) });
      return { ok: true };
    },
    async exportar(ws, tipo, formato, sid) {
      exigirWs(ws);
      const s = sid ? sprint(ws, sid) : null;
      const quando = new Date(agora());
      const sufixo = hash(ws);
      let colunas: readonly string[]; let linhas: Record<string, unknown>[];
      if (tipo === "backlog") {
        colunas = COLUNAS_BACKLOG;
        linhas = listarBacklog(bancoAgil, ws, { texto: null, epico_id: null, estado_fluxo: null, categoria: null, risco: null, criticidade: null, sprint_id: s?.id ?? null, sem_estimativa: null }, "ordem", null, 200).itens as unknown as Record<string, unknown>[];
        let cursor: string | null = "200";
        while (cursor !== null && linhas.length < 5000) {
          const pg = listarBacklog(bancoAgil, ws, { texto: null, epico_id: null, estado_fluxo: null, categoria: null, risco: null, criticidade: null, sprint_id: s?.id ?? null, sem_estimativa: null }, "ordem", cursor, 200);
          linhas.push(...(pg.itens as unknown as Record<string, unknown>[]));
          cursor = pg.proximo;
        }
      } else if (tipo === "metricas") {
        colunas = ["metrica", "chave", "valor", "extra"];
        linhas = linhasDeMetricas(painel(ws, s ? { sprint_id: s.id } : undefined));
      } else if (tipo === "retro") {
        if (!s) throw invalido("informe a sprint da retro");
        const r = servico.retroLer(ws, s.id);
        colunas = ["tipo", "coluna", "texto", "votos", "estado", "prazo"];
        linhas = [...r.itens.map((i) => ({ tipo: "item", coluna: i.coluna, texto: i.texto, votos: i.votos, estado: null, prazo: null })), ...r.acoes.map((x) => ({ tipo: "acao", coluna: null, texto: x.texto, votos: null, estado: x.estado, prazo: x.prazo }))];
      } else {
        const dly = servico.dailyGerar(ws, s?.id ?? null);
        colunas = ["membro", "bloco", "ref", "texto", "observacao"];
        linhas = dly.membros.flatMap((m) => (["ontem", "hoje", "bloqueios", "atrasos", "riscos"] as const).flatMap((b) => m[b].map((l) => ({ membro: m.rotulo, bloco: b, ref: l.ref, texto: l.texto, observacao: l.observacao }))));
      }
      return exportarArquivo({ escrever: d.escreverExportacao }, { tipo, formato, colunas, linhas, quando, sufixo, bom: formato === "csv" });
    },
    rodarGanchos,
    portaMcp,
    iniciar() {
      if (encerrado || desassinar !== null) return;
      const gatilho = (p: unknown): void => {
        const ws = (p as { workspace_id?: unknown } | null)?.workspace_id;
        if (typeof ws !== "string" || !ultimaSync.has(ws)) return; // só quem já usou a gestão ágil nesta execução
        const t = setTimeout(() => { timers.delete(t); if (!encerrado) sincronizarFila(ws, false); }, 2_000);
        t.unref?.();
        timers.add(t);
      };
      desassinar = d.barramento.assinar("metodo:mudou", gatilho);
      ciclo = setInterval(() => {
        const wss = new Set(bancoAgil.itens.valores().map((i) => i.workspace_id));
        for (const ws of wss) void rodarGanchos(ws).catch((e) => aviso(`ganchos ágeis: ${e instanceof Error ? e.message : String(e)}`));
      }, d.cicloMs ?? 10 * 60_000);
      ciclo.unref?.();
    },
    encerrar() {
      encerrado = true;
      desassinar?.();
      desassinar = null;
      if (ciclo) clearInterval(ciclo);
      ciclo = null;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
    metricas: () => ({ ...contadores, jobs_ativos: jobs.size, workspaces_sincronizando: sincronizando.size, ...Object.fromEntries(Object.entries(trechos).map(([k, v]) => [`maior_${k}_ms`, v])) }),
  };
  return servico;
}

/** grava `<userData>/agil/exportacoes/<nome>` (atômico) e devolve a referência RELATIVA a `userData`; o nome já vem seguro do núcleo e é conferido de novo aqui. */
export function criarEscritorExportacao(userData: string): (nome: string, conteudo: string) => Promise<string> {
  const pasta = join(userData, "agil", "exportacoes");
  return async (nome, conteudo) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(nome) || nome.includes("..")) throw invalido("nome de arquivo inválido");
    await mkdir(pasta, { recursive: true });
    const destino = join(pasta, nome);
    const tmp = `${destino}.tmp-${process.pid}`;
    await writeFile(tmp, conteudo, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, destino);
    return `agil/exportacoes/${nome}`;
  };
}
