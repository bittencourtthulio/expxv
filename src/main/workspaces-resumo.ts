// Painel de workspaces no main (D-450…): visão agregada SOMENTE LEITURA de todos os workspaces (agentes, Missões, execução, ramo).
// Leveza: nada acontece até o painel pedir `ativar(true)` (só montado quando fixado); ativo, assina os eventos de sessão e do domínio,
// junta rajadas num único recálculo (≥ `atrasoMs`) e só emite se algo mudou. Sem polling, sem processo, sem varredura de git.
// Encerrar um agente reusa o encerramento existente (Pane → `encerrarPane`; avulso → `encerrar` da sessão) depois de provar que a
// sessão pertence àquele workspace conhecido: nunca mexe em processo que o app não abriu.
import { homedir } from "node:os";
import type { EventoTerminal, MetadadosSessao } from "../compartilhado/terminais";
import type { PedidoEncerrarAgente, ResultadoEncerrarAgente, ResumoWorkspaces } from "../compartilhado/workspaces-resumo";
import type { Mission, Pane, Pagina } from "../nucleo/dominio";
import { agregarResumo, limparLinhaSaida, type EstadoExecucaoMinimo, type TempoSessao, type WorkspaceMinimoResumo } from "../nucleo/workspaces/resumo";
import { ramoAtual } from "../nucleo/workspaces/ramo-git";

export const ATRASO_RESUMO_MS = 300;
export const VALIDADE_CACHE_MS = 200;
const CAUDA_BYTES = 2_048;
const EVENTOS_DOMINIO = ["missoes:mudou", "workspaces:mudou", "run.started", "run.failed", "run.stopped", "pane.spawned", "pane.closed"] as const;

export interface SessoesDoResumo {
  listarMetadados(): MetadadosSessao[];
  assinar(fn: (evento: EventoTerminal) => void): () => void;
  encerrar(id: string): boolean;
}

export interface DependenciasResumo {
  workspaces: {
    atual(): WorkspaceMinimoResumo | null;
    /** TODOS os workspaces abertos (não só os recentes do seletor), em ordem estável de criação. */
    todos(): readonly WorkspaceMinimoResumo[];
    obter(id: string): WorkspaceMinimoResumo | undefined;
  };
  sessoes: () => Promise<SessoesDoResumo>;
  panes: { encerrarPane(paneId: string, motivo: string): Promise<unknown> };
  repos: {
    pane: { listarPorWorkspace(id: string, op?: { limite?: number; somenteAtivos?: boolean }): Pagina<Pane> };
    mission: { listarPorWorkspace(id: string, op?: { limite?: number }): Pagina<Mission> };
  };
  /** execuções do botão Executar por workspace (vazio quando o serviço ainda não nasceu). */
  execucoes: (workspaceId: string) => readonly EstadoExecucaoMinimo[];
  barramento: { assinar<T = unknown>(tipo: string, ouvinte: (payload: T) => void): () => void };
  emitir: (resumo: ResumoWorkspaces) => void;
  /** `shell.showItemInFolder`. */
  revelar?: (caminho: string) => void;
  /** `clipboard.writeText`. */
  copiar?: (texto: string) => void;
  scrub?: () => Promise<(texto: string) => string>;
  ramoDe?: (raiz: string) => Promise<string | null>;
  nomeFerramenta?: (id: string) => string;
  home?: string;
  agora?: () => number;
  atrasoMs?: number;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
}

export interface ServicoResumoWorkspaces {
  resumo(): Promise<ResumoWorkspaces>;
  /** Liga/desliga a assinatura de eventos. Devolve o estado efetivo. Desligado: nenhum custo e nenhum evento emitido. */
  ativar(ativo: boolean): Promise<boolean>;
  encerrarAgente(pedido: PedidoEncerrarAgente): Promise<ResultadoEncerrarAgente>;
  revelar(workspaceId: string): boolean;
  copiarCaminho(workspaceId: string): boolean;
  ativo(): boolean;
  encerrar(): void;
}

const semHora = (r: ResumoWorkspaces): string => JSON.stringify(r.itens);

export function criarServicoResumoWorkspaces(d: DependenciasResumo): ServicoResumoWorkspaces {
  const agora = d.agora ?? Date.now;
  const atraso = Math.max(250, d.atrasoMs ?? ATRASO_RESUMO_MS);
  const agendar = d.agendar ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref(); return t; });
  const cancelar = d.cancelar ?? ((id: unknown) => clearTimeout(id as NodeJS.Timeout));
  const ramoDe = d.ramoDe ?? ramoAtual;
  const nome = d.nomeFerramenta ?? ((id: string) => id);
  const home = d.home ?? homedir();

  const tempo = new Map<string, TempoSessao>();
  const caudas = new Map<string, string>();
  const sujos: Record<string, boolean> = {};
  let desligar: Array<() => void> = [];
  let ligado = false;
  let ligando: Promise<void> | null = null;
  let timer: unknown = null;
  let ultimoEmitido = "";
  let cache: { em: number; valor: ResumoWorkspaces } | null = null;
  let sujoCache = true;
  let encerrado = false;

  const tempoDe = (id: string): TempoSessao => {
    let t = tempo.get(id);
    if (t === undefined) { t = { atividade: null, atividade_em: null, linha: null, subagentes: null }; tempo.set(id, t); }
    return t;
  };

  async function calcular(): Promise<ResumoWorkspaces> {
    const atual = d.workspaces.atual();
    const lista = [...d.workspaces.todos()];
    if (atual !== null && !lista.some((w) => w.id === atual.id)) lista.push(atual);
    const sessoes = (await d.sessoes()).listarMetadados();
    const panes: Pane[] = [];
    const missoes: Mission[] = [];
    const execucoes: EstadoExecucaoMinimo[] = [];
    const ramos: Record<string, string | null> = {};
    await Promise.all(lista.map(async (w) => {
      try { panes.push(...d.repos.pane.listarPorWorkspace(w.id, { somenteAtivos: true, limite: 200 }).itens); } catch { /* workspace sem Panes legíveis */ }
      try { missoes.push(...d.repos.mission.listarPorWorkspace(w.id, { limite: 30 }).itens); } catch { /* idem */ }
      try { execucoes.push(...d.execucoes(w.id)); } catch { /* serviço de execução indisponível */ }
      ramos[w.id] = await ramoDe(w.raiz).catch(() => null);
    }));
    // esquece o que a sessão deixou para trás
    const vivas = new Set(sessoes.map((s) => s.sessao_id));
    for (const id of [...tempo.keys()]) if (!vivas.has(id)) { tempo.delete(id); caudas.delete(id); }
    return agregarResumo({
      workspaces: lista, atualId: atual?.id ?? null, home, sessoes, panes, missoes, execucoes, ramos, sujos, tempo: Object.fromEntries(tempo), nomeFerramenta: nome, agora: agora(),
    });
  }

  async function obter(forcar: boolean): Promise<ResumoWorkspaces> {
    if (!forcar && !sujoCache && cache !== null && agora() - cache.em < VALIDADE_CACHE_MS) return cache.valor;
    const valor = await calcular();
    cache = { em: agora(), valor };
    sujoCache = false;
    return valor;
  }

  async function descarregar(): Promise<void> {
    timer = null;
    if (!ligado || encerrado) return;
    let scrub: ((t: string) => string) | undefined;
    try { scrub = await d.scrub?.(); } catch { scrub = (): string => ""; }
    for (const [id, cauda] of caudas) {
      const linha = limparLinhaSaida(cauda, scrub);
      if (linha !== null) tempoDe(id).linha = linha;
    }
    caudas.clear();
    sujoCache = true;
    try {
      const r = await obter(true);
      const chave = semHora(r);
      if (chave === ultimoEmitido) return;
      ultimoEmitido = chave;
      d.emitir(r);
    } catch { /* o próximo evento tenta de novo */ }
  }

  function marcar(): void {
    sujoCache = true;
    if (!ligado || encerrado || timer !== null) return;
    timer = agendar(() => void descarregar(), atraso);
  }

  function aoEvento(e: EventoTerminal): void {
    if (e.tipo === "saida") {
      caudas.set(e.sessao_id, ((caudas.get(e.sessao_id) ?? "") + e.dados).slice(-CAUDA_BYTES));
      marcar();
      return;
    }
    if (e.tipo === "atividade") { const t = tempoDe(e.sessao_id); t.atividade = e.atividade; t.atividade_em = agora(); }
    else if (e.tipo === "subagente_iniciado" || e.tipo === "subagente_concluido") {
      const t = tempoDe(e.sessao_id);
      const atual = t.subagentes ?? { total: 0, ativos: 0 };
      t.subagentes = e.tipo === "subagente_iniciado" ? { total: atual.total + 1, ativos: atual.ativos + 1 } : { total: atual.total, ativos: Math.max(0, atual.ativos - 1) };
    } else if (e.tipo === "encerramento") { const t = tempoDe(e.sessao_id); t.atividade = null; }
    else if (e.tipo !== "estado") return;
    marcar();
  }

  async function ativar(ativo: boolean): Promise<boolean> {
    if (!ativo) {
      ligado = false;
      desligar.splice(0).forEach((f) => f());
      desligar = [];
      if (timer !== null) { cancelar(timer); timer = null; }
      caudas.clear();
      tempo.clear();
      ultimoEmitido = "";
      return false;
    }
    if (encerrado) return false;
    if (ligado) return true;
    if (ligando !== null) { await ligando; return ligado; }
    ligando = (async () => {
      const s = await d.sessoes();
      if (encerrado) return;
      desligar.push(s.assinar(aoEvento));
      for (const topico of EVENTOS_DOMINIO) desligar.push(d.barramento.assinar(topico, () => marcar()));
      desligar.push(d.barramento.assinar<{ workspace_id?: string; resumo?: { sujo?: boolean } }>("vcs:mudou", (p) => {
        if (typeof p?.workspace_id === "string" && typeof p.resumo?.sujo === "boolean") { sujos[p.workspace_id] = p.resumo.sujo; marcar(); }
      }));
      ligado = true;
    })().finally(() => { ligando = null; });
    await ligando;
    return ligado;
  }

  async function encerrarAgente({ workspace_id, sessao_id }: PedidoEncerrarAgente): Promise<ResultadoEncerrarAgente> {
    const r = await obter(true);
    const item = r.itens.find((i) => i.id === workspace_id);
    if (item === undefined) return { ok: false, motivo: "desconhecido" };
    const agente = item.agentes.find((a) => a.sessao_id === sessao_id);
    if (agente === undefined) {
      const outro = r.itens.some((i) => i.id !== workspace_id && i.agentes.some((a) => a.sessao_id === sessao_id));
      return { ok: false, motivo: outro ? "outro_workspace" : "desconhecido" };
    }
    try {
      if (agente.pane_id !== null) await d.panes.encerrarPane(agente.pane_id, "encerrado_no_painel");
      else (await d.sessoes()).encerrar(sessao_id);
      sujoCache = true;
      marcar();
      return { ok: true, motivo: "encerrado" };
    } catch {
      try { (await d.sessoes()).encerrar(sessao_id); sujoCache = true; marcar(); return { ok: true, motivo: "encerrado" }; } catch { return { ok: false, motivo: "falhou" }; }
    }
  }

  return {
    resumo: () => obter(false),
    ativar,
    encerrarAgente,
    revelar(workspaceId) {
      const w = d.workspaces.obter(workspaceId);
      if (w === undefined || d.revelar === undefined) return false;
      d.revelar(w.raiz);
      return true;
    },
    copiarCaminho(workspaceId) {
      const w = d.workspaces.obter(workspaceId);
      if (w === undefined || d.copiar === undefined) return false;
      d.copiar(w.raiz);
      return true;
    },
    ativo: () => ligado,
    encerrar() {
      encerrado = true;
      void ativar(false);
    },
  };
}
