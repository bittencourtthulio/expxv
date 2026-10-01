/**
 * Serviços de domínio do main: workspaces, provedores/contas, missões/panes e método Expx.
 *
 * COMO LIGAR (main.ts), depois de abrir o banco e de criar o barramento, o registro de IPC, o detector
 * de ferramentas e o contexto dos terminais:
 *
 *   const dominio = registrarServicosDominio({
 *     registro, banco, barramento, detector,            // o mesmo DetectorFerramentas dos terminais
 *     sessoes: () => contexto.sessoes(),                // espera a onda 2; é o GerenciadorSessoes da janela
 *     pastaDeDados: app.getPath("userData"),
 *     escolherPasta: async () => (await dialog.showOpenDialog(janela, { properties: ["openDirectory"] })).filePaths[0] ?? null,
 *     emitir: (canal, payload) => janela?.webContents.send(canal, payload),
 *     caminhoWorker: join(__dirname, "nucleo/metodo/worker.js"),   // FORA do asar no pacote
 *     workspaces,                                       // opcional: o mesmo serviço que já dá resolverCwd/permissaoDe ao contexto
 *   });
 *   // onda 1 do boot: nada além do registro acima (só registra canais; não abre worker, watcher nem sessão)
 *   // onda 2 (ServicosSecundarios): { dominio: () => dominio.iniciar() }
 *   // ao sair: await dominio.encerrar();
 *
 * `resolverCwd` e `permissaoDe` do contexto dos terminais vêm de `dominio.workspaces`. O cwd NUNCA vem
 * do renderer (contrato §2): ou é a raiz do workspace, ou o worktree da Missão.
 */
import type { CanaisEvento } from "../compartilhado/ipc";
import type { Banco } from "../nucleo/banco";
import { criarRepositorios, type Repositorios } from "../nucleo/banco/repos";
import { comandoInicialDaMissao, criarServicoMetodoMissao, type ServicoMetodoMissao } from "../nucleo/metodo/missao";
import type { OpcoesObservador, Observador } from "../nucleo/metodo/observador";
import { criarClienteWorker, type ClienteWorker } from "../nucleo/metodo/worker";
import { criarServicoPanes, type ServicoPanes, type SessoesDePanes } from "../nucleo/missoes/panes";
import { criarServicoMissoes, type ServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPortoes } from "../nucleo/orquestracao/portoes";
import { criarServicoContas, type ServicoContas } from "../nucleo/provedores/contas";
import { criarServicoProvedores, type DetectorDeProvedores, type ServicoProvedores } from "../nucleo/provedores/servico";
import { criarArmazemLayout, type ArmazemLayout } from "../nucleo/terminais/layout";
import { criarServicoWorkspaces, type ServicoWorkspaces } from "../nucleo/workspaces/servico";
import type { Barramento } from "./barramento";
import { registrarIpcMetodo, type MetodoLeitura } from "./ipc/metodo";
import { registrarIpcMissoes } from "./ipc/missoes";
import { registrarIpcProvedores } from "./ipc/provedores";
import type { RegistroIpc } from "./ipc/registro";
import { registrarIpcWorkspaces } from "./ipc/workspaces";
import { criarGerenciadorMetodo, type GerenciadorMetodo, type WorkspaceMetodo } from "./servicos-metodo";

type EventoDeDominio = "workspaces:mudou" | "missoes:mudou" | "metodo:mudou";

export interface DependenciasServicosDominio {
  registro: RegistroIpc;
  banco: Banco;
  barramento: Barramento;
  /** Espera a onda 2 do boot e devolve o gerenciador de sessões da janela atual. */
  sessoes: () => Promise<SessoesDePanes>;
  /** O mesmo detector dos terminais (cache compartilhado, invalidado no foco da janela). */
  detector: DetectorDeProvedores;
  /** Pasta de dados do app (userData): contas isoladas e layouts. */
  pastaDeDados: string;
  /** Diálogo nativo de pasta (só o main abre). `null` = cancelou. */
  escolherPasta: () => Promise<string | null>;
  /** Envia ao renderer da janela atual (no-op sem janela). */
  emitir: <C extends EventoDeDominio>(canal: C, payload: CanaisEvento[C]) => void;
  /** Serviço de workspaces já criado pelo main (para dar `resolverCwd` ao contexto dos terminais). */
  workspaces?: ServicoWorkspaces;
  armazemLayout?: (workspaceId: string | null) => ArmazemLayout;
  /** Caminho do worker de indexação (fora do asar no pacote). Padrão: ao lado deste módulo. */
  caminhoWorker?: string;
  aviso?: (mensagem: string) => void;
  /** Espera antes de entregar `*:mudou` ao renderer (junta rajadas). Padrão 50 ms. */
  atrasoCoalescerMs?: number;
  // ---- injeções de teste
  criarClienteWorker?: () => ClienteWorker;
  criarObservador?: (op: OpcoesObservador) => Observador;
  worktreesDe?: (ws: WorkspaceMetodo) => Promise<string[]>;
  debounceMetodoMs?: number;
  /** Esperas de `Panes.restaurar` quando o daemon ainda não responde (teste: `[]`). */
  atrasosRestauracaoMs?: readonly number[];
}

export interface ServicosDominio {
  repos: Repositorios;
  workspaces: ServicoWorkspaces;
  provedores: ServicoProvedores;
  contas: ServicoContas;
  missoes: ServicoMissoes;
  panes: ServicoPanes;
  metodo: ServicoMetodoMissao;
  gerenciadorMetodo: GerenciadorMetodo;
  /** Onda 2 do boot: religa os Panes, acompanha as sessões e começa a observar o workspace atual. */
  iniciar(): Promise<void>;
  /** Libera watchers, worker e assinaturas. Idempotente. As sessões continuam no daemon. */
  encerrar(): Promise<void>;
}

export function registrarServicosDominio(deps: DependenciasServicosDominio): ServicosDominio {
  const { barramento, banco } = deps;
  const atraso = deps.atrasoCoalescerMs ?? 50;
  const aviso = (m: string): void => deps.aviso?.(m);
  const repos = criarRepositorios(banco);
  const workspaces = deps.workspaces ?? criarServicoWorkspaces({ repos, escolherPasta: deps.escolherPasta });
  const contas = criarServicoContas({ banco, repos, pastaDeDados: deps.pastaDeDados });
  const provedores = criarServicoProvedores({ detector: deps.detector, contas });
  const armazemLayout = deps.armazemLayout ?? ((id: string | null) => criarArmazemLayout(deps.pastaDeDados, id));
  let iniciado = false;
  let encerrado = false;
  const cancelar: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();

  // ---------------------------------------------------------------- eventos coalescidos → renderer
  for (const canal of ["workspaces:mudou", "missoes:mudou", "metodo:mudou"] as const) {
    cancelar.push(barramento.assinar(canal, (payload) => deps.emitir(canal, payload as never)));
  }

  const pendentesMissoes = new Map<string, string | null>();
  const avisarMissoes = (e: { workspace_id: string; mission_id: string | null }): void => {
    // várias Missões do mesmo workspace na mesma janela viram "mission_id: null" (a UI recarrega a lista)
    const anterior = pendentesMissoes.get(e.workspace_id);
    const id = pendentesMissoes.has(e.workspace_id) && anterior !== e.mission_id ? null : e.mission_id;
    pendentesMissoes.set(e.workspace_id, id);
    barramento.emitirCoalescido("missoes:mudou", e.workspace_id, { workspace_id: e.workspace_id, mission_id: id }, atraso);
    // a entrega acontece no assinante: limpa o pendente logo depois (o payload já foi fixado no barramento)
    const t = setTimeout(() => void pendentesMissoes.delete(e.workspace_id), atraso + 5);
    t.unref();
    timers.add(t);
  };

  const avisarWorkspaces = (): void => {
    void workspaces.estado().then(
      (estado) => {
        barramento.emitirCoalescido("workspaces:mudou", "unico", estado, atraso);
        if (iniciado && !encerrado) void reagirAoWorkspaceAtual(estado.atual);
      },
      (e: unknown) => aviso(`workspaces:mudou: ${e instanceof Error ? e.message : String(e)}`),
    );
  };

  // ---------------------------------------------------------------- método
  const paraMetodo = (w: { id: string; raiz: string; e_git: boolean }): WorkspaceMetodo => ({ id: w.id, raiz: w.raiz, e_git: w.e_git });
  let metodo!: ServicoMetodoMissao;

  const gerenciadorMetodo = criarGerenciadorMetodo({
    criarCliente: deps.criarClienteWorker ?? (() => criarClienteWorker(deps.caminhoWorker)),
    ...(deps.criarObservador === undefined ? {} : { criarObservador: deps.criarObservador }),
    ...(deps.worktreesDe === undefined ? {} : { worktreesDe: deps.worktreesDe }),
    ...(deps.debounceMetodoMs === undefined ? {} : { debounceMs: deps.debounceMetodoMs }),
    aviso,
    aoMudar: (resumo) => barramento.emitirCoalescido("metodo:mudou", resumo.workspace_id, resumo, atraso),
    aoAtualizar: async (workspaceId) => {
      const ligadas = await metodo.sincronizarLigacoes(workspaceId);
      for (const l of ligadas) avisarMissoes({ workspace_id: workspaceId, mission_id: l.mission_id });
    },
  });

  async function garantirMetodo(workspaceId: string): Promise<boolean> {
    const w = workspaces.obter(workspaceId);
    if (w === undefined) return false;
    await gerenciadorMetodo.garantir(paraMetodo(w));
    return true;
  }

  async function reagirAoWorkspaceAtual(atual: { id: string; raiz: string; e_git: boolean } | null): Promise<void> {
    try {
      await gerenciadorMetodo.soltarExceto(atual?.id ?? null);
      if (atual !== null) await gerenciadorMetodo.garantir(paraMetodo(atual));
    } catch (e) {
      aviso(`método do workspace atual: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const leitura: MetodoLeitura = {
    async estado(workspaceId) {
      if (!(await garantirMetodo(workspaceId))) return null;
      return gerenciadorMetodo.estado(workspaceId);
    },
    async rastro(workspaceId, trabalhoId, depois) {
      if (!(await garantirMetodo(workspaceId))) return { eventos: [], proximo: 0 };
      return gerenciadorMetodo.rastro(workspaceId, trabalhoId, depois);
    },
  };

  // ---------------------------------------------------------------- missões e panes
  const panes = criarServicoPanes({
    banco, repos, workspaces, sessoes: deps.sessoes, detector: deps.detector, contas, armazemLayout,
    aoMudar: avisarMissoes,
    ...(deps.atrasosRestauracaoMs === undefined ? {} : { atrasosRestauracaoMs: deps.atrasosRestauracaoMs }),
  });

  const temporizadoresWorktree = new Map<string, ReturnType<typeof setTimeout>>();
  const aoMudarMissao = (e: { workspace_id: string; mission_id: string | null }): void => {
    avisarMissoes(e);
    // missão nova/encerrada pode ter criado ou mudado worktree: relê `git worktree list` (uma vez por rajada)
    if (!iniciado || encerrado || temporizadoresWorktree.has(e.workspace_id)) return;
    const t = setTimeout(() => {
      temporizadoresWorktree.delete(e.workspace_id);
      if (!encerrado) void gerenciadorMetodo.ressincronizar(e.workspace_id);
    }, 200);
    t.unref();
    temporizadoresWorktree.set(e.workspace_id, t);
  };

  const missoes = criarServicoMissoes({
    banco, repos, workspaces, panes,
    comandoInicial: comandoInicialDaMissao,
    aoMudar: aoMudarMissao,
    aoEventoDominio: (tipo, payload) => barramento.emitir(tipo, payload),
    aviso,
  });

  metodo = criarServicoMetodoMissao({
    repos, workspaces, missoes, panes, detector: deps.detector,
    indices: async (workspaceId) => {
      await garantirMetodo(workspaceId);
      return gerenciadorMetodo.indices(workspaceId);
    },
  });

  // ---------------------------------------------------------------- canais (só registra: nada pesado)
  registrarIpcWorkspaces({ registro: deps.registro, servico: workspaces, aoMudar: avisarWorkspaces });
  registrarIpcProvedores({ registro: deps.registro, servico: provedores, contas });
  registrarIpcMissoes({ registro: deps.registro, servico: missoes, portoes: criarServicoPortoes({ repos, banco, aoMudar: avisarMissoes }) });
  registrarIpcMetodo({ registro: deps.registro, leitura, missao: metodo });

  return {
    repos, workspaces, provedores, contas, missoes, panes, metodo, gerenciadorMetodo,

    async iniciar() {
      if (encerrado || iniciado) return;
      iniciado = true;
      const isolado = async (nome: string, fn: () => Promise<unknown>): Promise<void> => {
        try {
          await fn();
        } catch (e) {
          aviso(`${nome}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      await Promise.all([
        isolado("restaurar Panes", async () => {
          const r = await panes.restaurar();
          const atual = workspaces.atual();
          if (atual !== null && (r.religados.length > 0 || r.encerrados.length > 0)) avisarMissoes({ workspace_id: atual.id, mission_id: null });
        }),
        isolado("método do workspace atual", async () => {
          const atual = workspaces.atual();
          if (atual === null) return;
          await gerenciadorMetodo.garantir(paraMetodo(atual));
          await gerenciadorMetodo.prontoObservadores(atual.id);
        }),
      ]);
    },

    async encerrar() {
      if (encerrado) return;
      encerrado = true;
      iniciado = false;
      for (const t of [...timers, ...temporizadoresWorktree.values()]) clearTimeout(t);
      timers.clear();
      temporizadoresWorktree.clear();
      while (cancelar.length > 0) cancelar.pop()?.();
      await gerenciadorMetodo.encerrar();
    },
  };
}
