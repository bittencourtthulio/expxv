// Movimento de um Pane para outra conta/modelo (Fase 9, T-09.18) e checkpoint por turno, no main. Sem Electron: todo efeito (abrir e
// fechar Pane, disco, git, tela, foco, relógio) entra por injeção. O núcleo (`harness/brief.ts`) monta os textos; aqui só se orquestra.
// ATÔMICO: o Pane antigo só fecha (`superseded`) depois de o novo existir; qualquer falha depois disso desfaz o novo e reata o card,
// e o antigo continua intacto. Exceção do piloto: a Missão admite um piloto vivo por vez, então ele fecha ANTES e, se o novo não abrir,
// o antigo é reaberto (`respawn`) na mesma conta.
// Brief e checkpoint passam pelo scrubber do cofre antes de tocar o disco. Caminhos gravados são relativos à raiz da árvore.
import { resolve } from "node:path";
import type { Conta, Mission, Pane, Task, Workspace } from "../nucleo/dominio/tipos";
import type { PaneRota } from "../nucleo/banco/repos/pane-rota";
import type { ConfigHarness } from "../compartilhado/harness";
import {
  criarCheckpointer,
  instrucaoDeRetomada,
  montarBrief,
  montarCheckpoint,
  nomeSeguro,
  type Checkpointer,
  type EntradaBrief,
  type EntradaCheckpoint,
  type ProvedorDeBrief,
  type Scrub,
} from "../nucleo/harness/brief";
import type { PedidoMoverPane } from "../nucleo/harness/troca";
import type { PaneAberto, PedidoAbrirPane } from "../nucleo/missoes/panes";
import { PRODUTO } from "../nucleo/produto";

/** Cooldown da conta de origem depois de uma troca (a conta estourou ou está quente). */
export const COOLDOWN_ORIGEM_MS = 5 * 60_000;
const LINHAS_DE_TELA = 60;

export interface ReposMover {
  pane: { obter(id: string): Pane | undefined };
  paneRota: { obter(paneId: string): PaneRota | undefined; gravar(d: { pane_id: string; perfil: PaneRota["perfil"]; task_type?: string | null; decisao_id?: string | null; saltos?: number }): PaneRota; registrarTroca(paneId: string, instante?: string): PaneRota };
  contaRoteamento: { obter(contaId: string): { em_cooldown_ate: string | null } | undefined; definirCooldown(contaId: string, ate: string | null): unknown };
  conta: { obter(id: string): Conta | undefined };
  mission: { obter(id: string): Mission | undefined };
  workspace: { obter(id: string): Workspace | undefined };
  harnessWorkspace: { obter(workspaceId: string): ConfigHarness };
}

export interface DependenciasMover {
  repos: ReposMover;
  panes: {
    abrirPane(p: PedidoAbrirPane): Promise<PaneAberto>;
    encerrarPane(paneId: string, motivo: string): Promise<Pane>;
    respawn(paneId: string): Promise<PaneAberto>;
  };
  /** card (task) vinculado ao Pane, se houver. */
  taskDoPane(paneId: string): Task | undefined;
  /** reata o card ao Pane novo (a transição de estado do card não muda). */
  reatribuirTask(taskId: string, paneId: string): void;
  /** raiz absoluta da árvore do Pane: worktree da Missão ou raiz do workspace. */
  raiz(workspaceId: string, missionId: string | null): string;
  /** grava texto sob a pasta do produto; devolve o caminho absoluto. `rel` é relativo à raiz. */
  gravar(raiz: string, rel: string, texto: string): Promise<string>;
  /** lê texto sob a raiz; `null` se não existe. */
  ler(raiz: string, rel: string): Promise<string | null>;
  /** `git status --short` e branch do worktree; `null` fora de repo ou em falha. */
  statusGit(cwd: string): Promise<{ branch: string | null; linhas: string[] } | null>;
  /** últimas linhas da tela do Pane. */
  tela(paneId: string, n: number): Promise<string[]>;
  /** abre o scrubber do cofre (identidade se não há cofre). */
  scrub(): Promise<Scrub>;
  existeDiretorio?(caminho: string): boolean;
  agora?(): number;
  aviso?(mensagem: string): void;
  intervaloCheckpointMs?: number;
}

export interface MoverPane {
  /** Implementa `PortasExecutorTroca.moverPane`. */
  moverPane(pedido: PedidoMoverPane): Promise<{ novo_pane_id: string }>;
  checkpoint: Checkpointer;
  /** Porta de brief (a fase 8 troca a implementação). */
  brief: ProvedorDeBrief;
}

const pastaDaMissao = (missionId: string): string => `${PRODUTO.pastaNoProjeto}/missoes/${missionId}`;
export const caminhoDoCheckpoint = (missionId: string, paneId: string): string => `${pastaDaMissao(missionId)}/checkpoints/${nomeSeguro(paneId)}.md`;
const caminhoDoBrief = (missionId: string | null, paneId: string, ts: number): string =>
  `${missionId === null ? `${PRODUTO.pastaNoProjeto}/trocas` : `${pastaDaMissao(missionId)}/briefs`}/retomada-${nomeSeguro(paneId)}-${ts}.md`;

export function criarMoverPane(d: DependenciasMover): MoverPane {
  const agora = d.agora ?? ((): number => Date.now());
  const { repos } = d;
  const rotuloDaConta = (id: string | null): string => (id === null ? "conta do sistema" : (repos.conta.obter(id)?.rotulo ?? "conta"));

  // ---------------------------------------------------------------- checkpoint por turno
  async function coletar(paneId: string): Promise<EntradaCheckpoint | null> {
    const pane = repos.pane.obter(paneId);
    if (pane === undefined || pane.estado === "encerrado" || pane.mission_id === null) return null;
    const ws = repos.workspace.obter(pane.workspace_id);
    if (ws === undefined) return null;
    const raiz = d.raiz(pane.workspace_id, pane.mission_id);
    const task = d.taskDoPane(paneId);
    const git = await d.statusGit(raiz).catch(() => null);
    const tela = await d.tela(paneId, LINHAS_DE_TELA).catch(() => []);
    return {
      task_ref: task?.task_ref ?? null,
      titulo: task?.titulo ?? null,
      branch: git?.branch ?? null,
      status_curto: git?.linhas ?? [],
      ultimas_linhas: tela,
      em: new Date(agora()).toISOString(),
    };
  }
  const checkpoint = criarCheckpointer({
    agora,
    coletar,
    gravar: async (paneId, texto) => {
      const pane = repos.pane.obter(paneId);
      if (pane === undefined || pane.mission_id === null) return;
      await d.gravar(d.raiz(pane.workspace_id, pane.mission_id), caminhoDoCheckpoint(pane.mission_id, paneId), texto);
    },
    scrub: d.scrub,
    ...(d.intervaloCheckpointMs === undefined ? {} : { intervaloMs: d.intervaloCheckpointMs }),
  });

  // ---------------------------------------------------------------- brief
  const brief: ProvedorDeBrief = {
    async gerar({ pane_id, recibo, de, para }) {
      const pane = repos.pane.obter(pane_id);
      if (pane === undefined) throw new Error("Pane não encontrado");
      const raiz = d.raiz(pane.workspace_id, pane.mission_id);
      const scrub = await d.scrub();
      const task = d.taskDoPane(pane_id);
      let ultimo: string | null = null;
      if (pane.mission_id !== null) {
        ultimo = await d.ler(raiz, caminhoDoCheckpoint(pane.mission_id, pane_id)).catch(() => null);
        if (ultimo === null) {
          // sem checkpoint do turno (Pane que nunca fechou um turno): registra o estado de agora, uma vez, só para este brief
          const e = await coletar(pane_id).catch(() => null);
          if (e !== null) ultimo = montarCheckpoint(e, scrub);
        }
      }
      const entrada: EntradaBrief = {
        de,
        para,
        recibo,
        card: task === undefined ? null : { task_ref: task.task_ref, titulo: task.titulo, briefing_path: task.briefing_path },
        checkpoint: ultimo,
        em: new Date(agora()).toISOString(),
      };
      const rel = caminhoDoBrief(pane.mission_id, pane_id, agora());
      await d.gravar(raiz, rel, montarBrief(entrada, scrub));
      return { caminho_relativo: rel };
    },
  };

  // ---------------------------------------------------------------- mover
  function cooldownDaOrigem(contaId: string | null): void {
    if (contaId === null) return;
    try {
      const ate = new Date(agora() + COOLDOWN_ORIGEM_MS).toISOString();
      const atual = repos.contaRoteamento.obter(contaId)?.em_cooldown_ate ?? null;
      if (atual !== null && atual > ate) return; // já estava em espera por mais tempo (ex.: até o reset)
      repos.contaRoteamento.definirCooldown(contaId, ate);
    } catch (e) {
      d.aviso?.(`cooldown da conta de origem não gravado: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  async function moverPane(p: PedidoMoverPane): Promise<{ novo_pane_id: string }> {
    const antigo = repos.pane.obter(p.pane_id);
    if (antigo === undefined || antigo.estado === "encerrado") throw new Error("Pane não está ativo");
    // Fase 14: o agente livre (Pane avulso de um membro de squad) leva a permissão e o prompt do membro em argumentos que só o modo livre conhece;
    // um Pane novo nasceria sem eles (e com a permissão do workspace). Em Missão o preparo do agente os refaz (herda de `respawn_de`).
    if (antigo.mission_id === null && antigo.agente_id !== null) throw new Error("agente livre não troca de conta pela troca por consumo: abra outro agente com a conta desejada");
    const ws = repos.workspace.obter(antigo.workspace_id);
    if (ws === undefined) throw new Error("workspace não encontrado");
    const missao = antigo.mission_id === null ? undefined : repos.mission.obter(antigo.mission_id);
    const rotaAntiga = repos.paneRota.obter(antigo.id);
    const task = d.taskDoPane(antigo.id);
    const existe = d.existeDiretorio ?? ((c: string): boolean => c !== "");

    // 1) brief (efeito só em arquivo: nada a desfazer se o resto falhar)
    const { caminho_relativo } = await brief.gerar({
      pane_id: antigo.id,
      recibo: p.recibo,
      de: { provedor: p.de.provedor, modelo: p.de.modelo, conta: rotuloDaConta(p.de.conta_id) },
      para: { provedor: p.para.provedor, modelo: p.para.modelo, conta: rotuloDaConta(p.para.conta_id) },
    });

    // 2) novo Pane (mesmo papel, mesmo card, mesma pasta; `respawn_de` = antigo)
    const cwdAntigo = antigo.cwd !== null && antigo.cwd !== "." ? resolve(ws.raiz, antigo.cwd) : undefined;
    const base: PedidoAbrirPane = {
      cli: p.para.cli,
      papel: antigo.papel,
      modelo: p.para.modelo,
      esforco: p.para.esforco,
      conta_id: p.para.conta_id,
      respawn_de: antigo.id,
      ...(cwdAntigo !== undefined && existe(cwdAntigo) ? { cwd: cwdAntigo } : {}),
    };
    const pedido: PedidoAbrirPane = missao === undefined ? { ...base, workspace_id: ws.id } : { ...base, missao_id: missao.id };
    if (missao === undefined || antigo.eh_piloto) pedido.prompt_inicial = instrucaoDeRetomada(caminho_relativo);
    if (task !== undefined && missao !== undefined && !antigo.eh_piloto) pedido.contexto = { card: { task_id: task.id, task_ref: task.task_ref, briefing_path: caminho_relativo } };

    let novo: PaneAberto;
    if (antigo.eh_piloto) {
      // um piloto vivo por Missão: fecha antes; se o novo não abrir, devolve o antigo na conta de origem
      await d.panes.encerrarPane(antigo.id, "superseded");
      try {
        novo = await d.panes.abrirPane(pedido);
      } catch (e) {
        try {
          await d.panes.respawn(antigo.id);
        } catch (e2) {
          d.aviso?.(`o piloto não pôde ser reaberto após a falha da troca: ${e2 instanceof Error ? e2.message : "erro"}`);
        }
        throw e;
      }
    } else {
      novo = await d.panes.abrirPane(pedido);
      try {
        if (task !== undefined) d.reatribuirTask(task.id, novo.pane.id);
        await d.panes.encerrarPane(antigo.id, "superseded");
      } catch (e) {
        // desfaz: o antigo segue (ou volta a ser dono do card) e o novo some
        try {
          if (task !== undefined) d.reatribuirTask(task.id, antigo.id);
          await d.panes.encerrarPane(novo.pane.id, "troca_desfeita");
        } catch {
          /* melhor esforço */
        }
        throw e;
      }
    }

    // 3) rota do novo Pane, salto, cooldown (acessórios: o movimento já está feito)
    try {
      repos.paneRota.gravar({
        pane_id: novo.pane.id,
        perfil: { agente_id: rotaAntiga?.perfil.agente_id ?? antigo.agente_id ?? null, provider: p.para.provedor, cli: p.para.cli, modelo: p.para.modelo, esforco: p.para.esforco, faixa: p.para.faixa },
        task_type: rotaAntiga?.task_type ?? null,
        decisao_id: p.decisao_id ?? rotaAntiga?.decisao_id ?? null,
        saltos: rotaAntiga?.saltos ?? 0,
      });
      repos.paneRota.registrarTroca(novo.pane.id, new Date(agora()).toISOString());
    } catch (e) {
      d.aviso?.(`rota do novo Pane não gravada: ${e instanceof Error ? e.message : "erro"}`);
    }
    cooldownDaOrigem(p.de.conta_id);
    checkpoint.liberar(antigo.id);
    return { novo_pane_id: novo.pane.id };
  }

  return { moverPane, checkpoint, brief };
}

/** Liga o checkpoint ao barramento: fim de turno (`pane.state_changed` → `pronto`) grava; `pane.closed` libera o estado do Pane. */
export function ligarCheckpoints(barramento: Pick<import("./barramento").Barramento, "assinar">, checkpoint: Checkpointer): () => void {
  const a = barramento.assinar("pane.state_changed", (p) => {
    const o = p as { pane_id?: unknown; estado?: unknown } | null;
    if (typeof o?.pane_id === "string" && o.estado === "pronto") void checkpoint.aoFimDoTurno(o.pane_id);
  });
  const b = barramento.assinar("pane.closed", (p) => {
    const id = (p as { pane_id?: unknown } | null)?.pane_id;
    if (typeof id === "string") checkpoint.liberar(id);
  });
  return () => {
    a();
    b();
  };
}
