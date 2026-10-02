// Cola da troca por consumo no main (T-09.20, onda 4-C). Nada aqui importa Electron: foco, relógio, agendador, git, o
// movimento do Pane (T-09.18) e a notificação nativa entram por injeção. O núcleo (`harness/troca.ts`) decide; este módulo
// só lê o mundo (repositórios + limites), executa as portas, publica no barramento e expõe os manipuladores que o
// coordenador liga aos canais `harness:{trocas_listar,troca_decidir,mover_pane}` e à tool MCP `account_switch`.
// Nunca lê segredo: só ids, provedores, consumo e rótulos. O decisor externo não participa de nada daqui.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AcaoTroca, ConfigHarness, DecisaoEntrada, EntradaEquivalencia, EventoHarness, PaginaTrocas, PedidoListarTrocas, ResultadoMoverPane, Troca } from "../compartilhado/harness";
import type { AccountUsage } from "../compartilhado/limites";
import type { Barramento } from "./barramento";
import type { Conta, Pagina, Pane, Workspace } from "../nucleo/dominio/tipos";
import type { ContaRoteamento } from "../compartilhado/harness";
import type { PaneRota } from "../nucleo/banco/repos/pane-rota";
import type { NovaTroca, RegistroTroca } from "../nucleo/banco/repos/troca-log";
import { faixaDe } from "../nucleo/harness/equivalencia";
import {
  ErroTroca,
  criarExecutorTroca,
  type AvisoTroca,
  type EntradaAvaliacao,
  type ExecutorTroca,
  type PaneParaTroca,
  type PedidoMoverPane,
} from "../nucleo/harness/troca";
import { ErroMcp, argumentoInvalido, indisponivel, naoEncontrado, violacaoDeRegra } from "../nucleo/mcp/erros";
import type { Agendador } from "../nucleo/limites/servico";

// ---------------------------------------------------------------- operação git em curso
/** Arquivos/pastas de `.git` que indicam operação em andamento. */
export const MARCAS_GIT_EM_CURSO: readonly string[] = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD"];
/** `index.lock` só conta se for recente (um lock velho é resto de processo morto). */
export const IDADE_MAX_INDEX_LOCK_MS = 120_000;

export interface SistemaDeArquivosGit {
  existe(caminho: string): boolean;
  /** conteúdo de texto pequeno, ou `null` */
  ler(caminho: string): string | null;
  mtimeMs(caminho: string): number | null;
}
export const sistemaDeArquivosGitReal: SistemaDeArquivosGit = {
  existe: (c) => existsSync(c),
  ler: (c) => {
    try {
      return readFileSync(c, "utf8").slice(0, 4096);
    } catch {
      return null;
    }
  },
  mtimeMs: (c) => {
    try {
      return statSync(c).mtimeMs;
    } catch {
      return null;
    }
  },
};

/** Resolve o diretório git de um worktree (`.git` pasta ou arquivo `gitdir: ...`). `null` = não é repositório. */
export function resolverGitDir(cwd: string, fs: SistemaDeArquivosGit): string | null {
  const ponto = join(cwd, ".git");
  if (!fs.existe(ponto)) return null;
  const conteudo = fs.ler(ponto);
  if (conteudo === null) return ponto; // é pasta (ler falha em diretório)
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(conteudo);
  if (m === null) return ponto;
  return resolve(cwd, m[1] as string);
}

/** `true` quando há merge, rebase, cherry-pick, revert ou `index.lock` recente no worktree: a troca NUNCA interrompe isso. */
export function operacaoGitEmCurso(cwd: string | null, agora: number, fs: SistemaDeArquivosGit = sistemaDeArquivosGitReal): boolean {
  if (cwd === null || cwd === "") return false;
  try {
    const dir = resolverGitDir(cwd, fs);
    if (dir === null) return false;
    for (const marca of MARCAS_GIT_EM_CURSO) if (fs.existe(join(dir, marca))) return true;
    const lock = fs.mtimeMs(join(dir, "index.lock"));
    return lock !== null && agora - lock < IDADE_MAX_INDEX_LOCK_MS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- dependências
/** Superfície mínima dos repositórios reais (`criarRepositorios`): o tipo real satisfaz estruturalmente. */
export interface ReposHarnessTroca {
  workspace: { obter(id: string): Workspace | undefined; listar(op?: { limite?: number }): Pagina<Workspace> };
  pane: { listarPorWorkspace(workspaceId: string, op?: { somenteAtivos?: boolean; limite?: number }): Pagina<Pane> };
  paneRota: { obter(paneId: string): PaneRota | undefined; ignorarSugestaoAte(paneId: string, ate: string | null): PaneRota };
  harnessWorkspace: { obter(workspaceId: string): ConfigHarness };
  contaRoteamento: { listar(): ContaRoteamento[] };
  conta: { listar(op?: { limite?: number }): Pagina<Conta> };
  trocaLog: {
    inserir(d: NovaTroca): RegistroTroca;
    atualizarStatus(id: string, status: Troca["status"], extra?: { adiada_por?: string | null; pane_novo_id?: string | null; recibo?: string }): RegistroTroca;
    obter(id: string): RegistroTroca | undefined;
    listar(op?: { desde?: string; cursor?: string; limite?: number; workspace_id?: string }): { itens: RegistroTroca[]; proximo: string | null };
  };
}

export interface DependenciasHarnessTroca {
  repos: ReposHarnessTroca;
  barramento: Pick<Barramento, "assinar" | "emitir">;
  /** `LimitsService.snapshot()` (cache; nunca espera I/O). */
  limites: { snapshot(): { contas: AccountUsage[] } };
  /** `ServicoDecisoes.registrar` (sanitiza antes de gravar). */
  decisoes: { registrar(d: DecisaoEntrada): { id: string } };
  /** tabela efetiva (`equivalencia.ts`). */
  equivalencia(): EntradaEquivalencia;
  /** provedores habilitados e instalados, na ordem de preferência; padrão: provedores das contas habilitadas. */
  provedoresViaveis?(): readonly string[];
  clisOpenrouter?(): readonly string[];
  /** Movimento real (T-09.18). Ausente ⇒ o ciclo só registra (`falhou`) e o botão avisa `mover_indisponivel`. */
  moverPane?(pedido: PedidoMoverPane): Promise<{ novo_pane_id: string }>;
  emitirRenderer(evento: EventoHarness): void;
  /** Notificação nativa; só é chamada com a janela SEM foco (sugestão, sem alternativa, falha). */
  notificarNativa?(aviso: AvisoTroca): void;
  foco(): boolean;
  /** handoff em voo deste Pane (fila de wake/handoff do orquestrador). Padrão: nunca. */
  handoffEmVoo?(paneId: string): boolean;
  /** `true` quando há operação git em curso no `cwd` (padrão: arquivos de `.git`). */
  operacaoGit?(cwd: string | null, agora: number): boolean;
  agora?(): number;
  agendador?: Agendador;
  aviso?(mensagem: string): void;
}

export interface HarnessTroca {
  executor: ExecutorTroca;
  /** Avalia um workspace (ou todos com Panes ativos). */
  avaliarAgora(workspaceId?: string): Promise<void>;
  /** `harness:trocas_listar` */
  trocasListar(pedido: PedidoListarTrocas): PaginaTrocas;
  /** `harness:troca_decidir` */
  trocaDecidir(pedido: { troca_id: string; acao: AcaoTroca }): Promise<Troca>;
  /** `harness:mover_pane` (o clique é a prova: `force`). */
  moverPane(pedido: { pane_id: string; conta_alvo_id?: string }): Promise<ResultadoMoverPane>;
  /** Tool MCP `account_switch`: o MESMO caminho do botão; erros já no formato do MCP. */
  accountSwitch(pedido: { pane_id: string; target_account_id?: string; reason?: string; force?: boolean }): Promise<{ new_pane_id: string; from: ResultadoMoverPane["de"]; to: ResultadoMoverPane["para"] }>;
  /** Assina o barramento e liga o ciclo. */
  iniciar(): void;
  encerrar(): void;
}

const DEBOUNCE_CICLO_MS = 400;
const REAVALIAR_PENDENCIAS_MS = 15_000;
/** Frase de limite vista: vale por este tempo, ou até o Pane voltar a trabalhar. */
const VALIDADE_LIMITE_DETECTADO_MS = 30 * 60_000;

const agendadorPadrao: Agendador = {
  setTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    if (typeof id === "object" && id !== null && "unref" in id) (id as { unref: () => void }).unref();
    return id;
  },
  clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
};

/** Mapeia o erro da troca para o erro do MCP (code/subcode do contrato §8.5). */
export function trocaParaErroMcp(e: unknown): ErroMcp {
  if (e instanceof ErroMcp) return e;
  if (!(e instanceof ErroTroca)) return indisponivel("troca indisponível");
  switch (e.codigo) {
    case "not_at_limit":
      return violacaoDeRegra("not_at_limit", e.message);
    case "provider_mismatch":
      return violacaoDeRegra("provider_mismatch", e.message);
    case "limit_reached":
      return violacaoDeRegra("limit_reached", e.message);
    case "no_account_available":
      return argumentoInvalido(e.message, "no_account_available");
    case "no_capacity":
      return new ErroMcp("unavailable", e.message, "no_capacity");
    case "pane_nao_encontrado":
    case "troca_nao_encontrada":
      return naoEncontrado(e.message);
    case "operacao_em_curso":
      return violacaoDeRegra("limit_reached", e.message);
    default:
      return indisponivel(e.message);
  }
}

const paraTroca = (r: RegistroTroca): Troca => ({
  id: r.id,
  criado_em: r.criado_em,
  status: r.status,
  motivo: r.motivo,
  modo: r.modo,
  tipo_troca: r.tipo_troca,
  de: r.de,
  para: r.para,
  consumo_origem_pct: r.consumo_origem_pct,
  consumo_destino_pct: r.consumo_destino_pct,
  adiada_por: r.adiada_por,
  recibo: r.recibo,
});

export function ligarHarnessTroca(d: DependenciasHarnessTroca): HarnessTroca {
  const agora = d.agora ?? ((): number => Date.now());
  const ag = d.agendador ?? agendadorPadrao;
  const detectados = new Map<string, number>();
  const rotulos = new Map<string, string>();
  const operacaoGit = d.operacaoGit ?? ((cwd: string | null, t: number): boolean => operacaoGitEmCurso(cwd, t));

  const ativosDe = (ws: string): Pane[] => d.repos.pane.listarPorWorkspace(ws, { somenteAtivos: true, limite: 500 }).itens;

  /** Lê o mundo do workspace. `todosOsPanes` (botão) inclui Panes livres; o ciclo só olha Panes de Missão ou com rota. */
  function lerMundo(workspaceId: string, todosOsPanes: boolean): EntradaAvaliacao {
    const t = agora();
    const config = d.repos.harnessWorkspace.obter(workspaceId);
    const ws = d.repos.workspace.obter(workspaceId);
    const equivalencia = d.equivalencia();
    const contas = d.repos.conta.listar({ limite: 500 }).itens;
    const roteamento = new Map(d.repos.contaRoteamento.listar().map((r) => [r.conta_id, r]));
    const usos = d.limites.snapshot().contas;
    const viaveis = d.provedoresViaveis ? [...d.provedoresViaveis()] : [...new Set(contas.filter((c) => c.habilitada).map((c) => c.provedor))];
    const panes: PaneParaTroca[] = [];
    const operacaoGitSet = new Set<string>();
    const handoff = new Set<string>();
    for (const p of ativosDe(workspaceId)) {
      if (p.conta_id === null) continue;
      const rota = d.repos.paneRota.obter(p.id);
      if (!todosOsPanes && p.mission_id === null && rota === undefined) continue;
      const provedor = rota?.perfil.provider || p.cli || "";
      if (provedor === "") continue;
      const modelo = p.modelo ?? rota?.perfil.modelo ?? null;
      const det = detectados.get(p.id);
      const limiteVisto = det !== undefined && t - det < VALIDADE_LIMITE_DETECTADO_MS;
      const ate = (iso: string | null | undefined): number | null => {
        if (!iso) return null;
        const v = Date.parse(iso);
        return Number.isFinite(v) ? v : null;
      };
      panes.push({
        pane_id: p.id,
        workspace_id: workspaceId,
        mission_id: p.mission_id,
        task_ref: null,
        papel: p.papel,
        task_type: rota?.task_type ?? null,
        provedor,
        conta_id: p.conta_id,
        modelo,
        faixa: rota?.perfil.faixa ?? faixaDe(equivalencia, provedor, modelo) ?? "medio",
        estado: p.estado,
        limite_detectado: limiteVisto,
        saltos: rota?.saltos ?? 0,
        ultima_troca_em: ate(rota?.ultima_troca_em),
        ignorar_sugestao_ate: ate(rota?.ignorar_sugestao_ate),
      });
      if (operacaoGit(p.cwd, t)) operacaoGitSet.add(p.id);
      if (d.handoffEmVoo?.(p.id) === true) handoff.add(p.id);
    }
    for (const c of contas) rotulos.set(c.id, c.rotulo);
    return {
      panes,
      usos,
      config,
      mundo: {
        contas: contas.map((c) => ({ conta_id: c.id, provedor: c.provedor, habilitada: c.habilitada, roteamento: roteamento.get(c.id) ?? null })),
        equivalencia,
        provedoresViaveis: viaveis,
        clisOpenrouter: d.clisOpenrouter?.() ?? [],
        permissaoWorkspace: ws?.permissao ?? "seguro",
        operacaoGit: operacaoGitSet,
        handoffEmVoo: handoff,
      },
    };
  }
  /** O ciclo vê só Panes de Missão/rota; as ações diretas (botão, account_switch) veem qualquer Pane com conta. */
  let modoLeitura: "ciclo" | "direto" = "ciclo";
  const executor = criarExecutorTroca({
    agora,
    lerMundo: (ws) => lerMundo(ws, modoLeitura === "direto"),
    registrarDecisao: (e) => {
      const g = d.decisoes.registrar(e);
      try {
        d.barramento.emitir("decision.made", { decisao_id: g.id, proposito: "troca", pane_id: e.pane_id });
      } catch {
        /* acessório */
      }
      return { id: g.id };
    },
    inserirTroca: (n) => d.repos.trocaLog.inserir(n),
    atualizarTroca: (id, status, extra) => d.repos.trocaLog.atualizarStatus(id, status, extra),
    obterTroca: (id) => d.repos.trocaLog.obter(id),
    ...(d.moverPane ? { moverPane: d.moverPane } : {}),
    ignorarSugestaoAte: (paneId, ate) => {
      try {
        d.repos.paneRota.ignorarSugestaoAte(paneId, ate);
      } catch {
        /* Pane sem rota gravada: o silêncio fica só em memória do executor */
      }
    },
    avisar: (a) => {
      if (a.tipo === "sugerida") d.barramento.emitir("switch.suggested", { troca_id: a.troca_id, pane_id: a.pane_id, workspace_id: a.workspace_id });
      if (a.tipo === "feita") d.barramento.emitir("account.switched", { troca_id: a.troca_id, pane_id: a.pane_id, workspace_id: a.workspace_id });
      // sem foco, só o que pede decisão ou avisa de problema vira notificação do sistema (toast da janela cobre o resto)
      if ((a.tipo === "sugerida" || a.tipo === "sem_alternativa" || a.tipo === "falhou") && !d.foco()) {
        try {
          d.notificarNativa?.(a);
        } catch {
          /* notificação é acessório */
        }
      }
    },
    emitir: (e) => d.emitirRenderer(e),
    rotulos: () => Object.fromEntries(rotulos),
  });

  // ---- ciclo agendado ----
  let timer: unknown = null;
  let timerPend: unknown = null;
  let desassinar: Array<() => void> = [];
  let ativo = false;

  async function avaliarAgora(workspaceId?: string): Promise<void> {
    modoLeitura = "ciclo";
    const alvos = workspaceId !== undefined ? [workspaceId] : d.repos.workspace.listar({ limite: 500 }).itens.map((w) => w.id);
    for (const ws of alvos) {
      try {
        if (ativosDe(ws).every((p) => p.conta_id === null)) continue;
        await executor.ciclo(ws);
      } catch (e) {
        d.aviso?.(`troca por consumo: ${e instanceof Error ? e.message : "erro"}`);
      }
    }
    if (ativo && executor.temPendencias() && timerPend === null) {
      timerPend = ag.setTimeout(() => {
        timerPend = null;
        void avaliarAgora();
      }, REAVALIAR_PENDENCIAS_MS);
    }
  }
  const agendar = (): void => {
    if (!ativo || timer !== null) return;
    timer = ag.setTimeout(() => {
      timer = null;
      void avaliarAgora();
    }, DEBOUNCE_CICLO_MS);
  };
  const aoPaneFechar = (p: unknown): void => {
    const id = (p as { pane_id?: unknown } | null)?.pane_id;
    if (typeof id === "string") {
      detectados.delete(id);
      executor.liberarPane(id);
    }
    agendar();
  };

  async function direto<T>(f: () => Promise<T>): Promise<T> {
    modoLeitura = "direto";
    try {
      return await f();
    } finally {
      modoLeitura = "ciclo";
    }
  }
  const workspaceDoPane = (paneId: string): string => {
    for (const w of d.repos.workspace.listar({ limite: 500 }).itens) if (ativosDe(w.id).some((p) => p.id === paneId)) return w.id;
    throw new ErroTroca("pane_nao_encontrado", "Pane não encontrado ou encerrado");
  };

  async function moverPane(p: { pane_id: string; conta_alvo_id?: string; force?: boolean }): Promise<ResultadoMoverPane> {
    const ws = workspaceDoPane(p.pane_id);
    return direto(() => executor.mover({ pane_id: p.pane_id, workspace_id: ws, conta_alvo_id: p.conta_alvo_id ?? null, force: p.force ?? true }));
  }

  return {
    executor,
    avaliarAgora,
    trocasListar(p) {
      const g = d.repos.trocaLog.listar({
        ...(p.desde === undefined ? {} : { desde: p.desde }),
        ...(p.cursor === undefined ? {} : { cursor: p.cursor }),
        ...(p.limite === undefined ? {} : { limite: p.limite }),
      });
      return { itens: g.itens.map(paraTroca), proximo: g.proximo };
    },
    async trocaDecidir(p) {
      return paraTroca(await direto(() => executor.decidir(p.troca_id, p.acao)));
    },
    moverPane: (p) => moverPane({ ...p, force: true }),
    async accountSwitch(p) {
      try {
        const r = await moverPane({ pane_id: p.pane_id, ...(p.target_account_id === undefined ? {} : { conta_alvo_id: p.target_account_id }), force: p.force === true });
        return { new_pane_id: r.novo_pane_id, from: r.de, to: r.para };
      } catch (e) {
        throw trocaParaErroMcp(e);
      }
    },
    iniciar() {
      if (ativo) return;
      ativo = true;
      for (const t of ["limits.updated", "limit.high", "pane.spawned", "handoff.submitted"]) desassinar.push(d.barramento.assinar(t, () => agendar()));
      desassinar.push(
        d.barramento.assinar("pane.state_changed", (p) => {
          const o = p as { pane_id?: unknown; estado?: unknown } | null;
          // voltou a trabalhar: a frase de limite visto antes já não vale (o limite reiniciou ou o usuário seguiu)
          if (typeof o?.pane_id === "string" && o.estado === "trabalhando") detectados.delete(o.pane_id);
          agendar();
        }),
      );
      desassinar.push(
        d.barramento.assinar("limit.reached", (p) => {
          const id = (p as { pane_id?: unknown } | null)?.pane_id;
          if (typeof id === "string") detectados.set(id, agora());
          agendar();
        }),
      );
      desassinar.push(d.barramento.assinar("pane.closed", aoPaneFechar));
      agendar();
    },
    encerrar() {
      ativo = false;
      for (const f of desassinar) f();
      desassinar = [];
      if (timer !== null) ag.clearTimeout(timer);
      if (timerPend !== null) ag.clearTimeout(timerPend);
      timer = null;
      timerPend = null;
    },
  };
}
