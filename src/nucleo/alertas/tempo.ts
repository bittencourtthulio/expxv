// Acumulador de TEMPO DE TRABALHO por task (T-20.07). PURO sobre a porta `RepoTempo`: soma os intervalos em que o Pane da task
// esteve `trabalhando` (`ativo_ms`) e `aguardando` (`aguardando_ms`). Uma escrita por transição; reconstitui do repositório no boot.
// Duas tasks no mesmo Pane NÃO somam o mesmo tempo: a janela é por task (D-106) e só a task ATIVA do Pane acumula.
import type { ReferenciaTask, Relogio } from "./portas";
import { relogioReal } from "./portas";

export type EstadoPane = "trabalhando" | "aguardando" | "ocioso" | "encerrado" | string;

export interface RegistroTempo {
  workspace_id: string;
  trabalho_id: string;
  task_id: string;
  inicio: string;
  fim: string | null;
  ativo_ms: number;
  aguardando_ms: number;
  estado_atual: EstadoPane | null;
  estado_desde: string | null;
  pane_id: string | null;
  alertou_atraso: 0 | 1 | 2;
}

export interface RepoTempo {
  gravar(r: RegistroTempo): void;
  /** janelas abertas (`fim IS NULL`). */
  abertas(): RegistroTempo[];
  concluidas(workspace_id: string, limite: number): RegistroTempo[];
}

export function criarRepoTempoMemoria(): RepoTempo {
  const linhas = new Map<string, RegistroTempo>();
  const k = (r: RegistroTempo): string => `${r.workspace_id}|${r.trabalho_id}|${r.task_id}|${r.inicio}`;
  return {
    gravar: (r) => void linhas.set(k(r), { ...r }),
    abertas: () => [...linhas.values()].filter((r) => r.fim === null).map((r) => ({ ...r })),
    concluidas: (ws, limite) => [...linhas.values()].filter((r) => r.workspace_id === ws && r.fim !== null).slice(-limite).map((r) => ({ ...r })),
  };
}

export interface AcumuladorTempo {
  iniciarTask(ref: ReferenciaTask, pane_id: string | null, estado?: EstadoPane): void;
  fecharTask(ref: ReferenciaTask): RegistroTempo | null;
  /** transição de estado de um Pane: atualiza só a task aberta vinculada a ele. */
  transicaoPane(pane_id: string, estado: EstadoPane): void;
  /** Pane que morreu: fecha a janela da task dele. */
  paneEncerrado(pane_id: string): RegistroTempo | null;
  /** valores até agora (soma o trecho corrente do estado atual). */
  leitura(ref: ReferenciaTask): { ativo_ms: number; aguardando_ms: number; decorrido_ms: number; estado_atual: EstadoPane | null; pane_id: string | null; alertou_atraso: 0 | 1 | 2 } | null;
  marcarAlertou(ref: ReferenciaTask, nivel: 1 | 2): void;
  taskDoPane(pane_id: string): ReferenciaTask | null;
  abertas(): ReferenciaTask[];
  /** boot: o tempo em que o app esteve fechado NÃO conta; janela cujo Pane não está vivo é fechada. */
  reconstituir(panesVivos: ReadonlySet<string>): void;
}

export function criarAcumuladorTempo(deps: { repo: RepoTempo; relogio?: Relogio }): AcumuladorTempo {
  const relogio = deps.relogio ?? relogioReal;
  const iso = (ms = relogio.agora()): string => new Date(ms).toISOString();
  const chave = (r: ReferenciaTask): string => `${r.workspace_id}|${r.trabalho_id}|${r.task_id}`;
  const abertas = new Map<string, RegistroTempo>();
  for (const r of deps.repo.abertas()) abertas.set(chave(r), r); // reconstituição no boot

  /** consolida o trecho do estado atual em `ativo_ms`/`aguardando_ms` até `ate`. */
  function consolidar(r: RegistroTempo, ate: number): void {
    if (r.estado_desde !== null && r.estado_atual !== null) {
      const dt = Math.max(0, ate - Date.parse(r.estado_desde));
      if (r.estado_atual === "trabalhando") r.ativo_ms += dt;
      else if (r.estado_atual === "aguardando") r.aguardando_ms += dt;
    }
    r.estado_desde = iso(ate);
  }
  function fechar(r: RegistroTempo): RegistroTempo {
    const t = relogio.agora();
    consolidar(r, t);
    r.fim = iso(t);
    r.estado_atual = null;
    r.estado_desde = null;
    abertas.delete(chave(r));
    deps.repo.gravar(r);
    return { ...r };
  }
  const doPane = (pane_id: string): RegistroTempo | undefined => [...abertas.values()].find((r) => r.pane_id === pane_id);

  return {
    iniciarTask(ref, pane_id, estado) {
      const k = chave(ref);
      if (abertas.has(k)) return;
      // o Pane só serve a UMA task por vez: abrir outra fecha a anterior dele (nada de tempo em dobro)
      if (pane_id !== null) {
        const antiga = doPane(pane_id);
        if (antiga !== undefined) {
          consolidar(antiga, relogio.agora());
          antiga.pane_id = null;
          antiga.estado_atual = null;
          antiga.estado_desde = null;
          deps.repo.gravar(antiga);
        }
      }
      const t = relogio.agora();
      const r: RegistroTempo = { ...ref, inicio: iso(t), fim: null, ativo_ms: 0, aguardando_ms: 0, estado_atual: estado ?? null, estado_desde: estado === undefined ? null : iso(t), pane_id, alertou_atraso: 0 };
      abertas.set(k, r);
      deps.repo.gravar(r);
    },
    fecharTask(ref) {
      const r = abertas.get(chave(ref));
      return r === undefined ? null : fechar(r);
    },
    transicaoPane(pane_id, estado) {
      const r = doPane(pane_id);
      if (r === undefined || r.estado_atual === estado) return;
      const t = relogio.agora();
      consolidar(r, t);
      r.estado_atual = estado;
      deps.repo.gravar(r);
    },
    paneEncerrado(pane_id) {
      const r = doPane(pane_id);
      return r === undefined ? null : fechar(r);
    },
    leitura(ref) {
      const r = abertas.get(chave(ref));
      if (r === undefined) return null;
      const t = relogio.agora();
      let ativo = r.ativo_ms;
      let aguard = r.aguardando_ms;
      if (r.estado_desde !== null) {
        const dt = Math.max(0, t - Date.parse(r.estado_desde));
        if (r.estado_atual === "trabalhando") ativo += dt;
        else if (r.estado_atual === "aguardando") aguard += dt;
      }
      return { ativo_ms: ativo, aguardando_ms: aguard, decorrido_ms: Math.max(0, t - Date.parse(r.inicio)), estado_atual: r.estado_atual, pane_id: r.pane_id, alertou_atraso: r.alertou_atraso };
    },
    taskDoPane(pane_id) {
      const r = doPane(pane_id);
      return r === undefined ? null : { workspace_id: r.workspace_id, trabalho_id: r.trabalho_id, task_id: r.task_id };
    },
    marcarAlertou(ref, nivel) {
      const r = abertas.get(chave(ref));
      if (r === undefined || r.alertou_atraso >= nivel) return;
      r.alertou_atraso = nivel;
      deps.repo.gravar(r);
    },
    reconstituir(vivos) {
      const t = relogio.agora();
      for (const r of [...abertas.values()]) {
        if (r.pane_id !== null && !vivos.has(r.pane_id)) {
          fechar(r);
        } else if (r.estado_desde !== null) {
          r.estado_desde = iso(t);
          deps.repo.gravar(r);
        }
      }
    },
    abertas: () => [...abertas.values()].map((r) => ({ workspace_id: r.workspace_id, trabalho_id: r.trabalho_id, task_id: r.task_id })),
  };
}
