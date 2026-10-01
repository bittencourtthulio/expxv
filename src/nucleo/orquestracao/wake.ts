/**
 * Fila de wake (T-03.03): o piloto é avisado quando um worker entrega, mas NUNCA esperando o chamador
 * "ficar quieto". O aviso entra na fila e é entregue no próximo ponto seguro = Pane ocioso (`pronto`);
 * `aguardando` (pedido de aprovação ao usuário) não é ponto seguro. Preserva a ordem de chegada.
 * Cada entrega é um item por card: dois cards do mesmo Pane geram dois avisos e nunca se somam.
 */
import type { EstadoPane, StatusHandoff } from "../dominio";

export interface ItemWake {
  destino_pane_id: string;
  origem_pane_id: string;
  task_id: string;
  handoff_id: string;
  status: StatusHandoff;
  resumo: string;
  relatorio_path: string | null;
}

export interface ItemEnfileirado extends ItemWake {
  id: number;
}

export interface DepsFilaWake {
  /** Digita no Pane (com Enter). false = não aceitou; o item continua na fila. */
  enviar(pane_id: string, texto: string): Promise<boolean>;
  /** Estado conhecido do Pane quando ainda não houve `aoMudarEstado`. */
  estado?(pane_id: string): EstadoPane | null | Promise<EstadoPane | null>;
  emitir?(tipo: string, payload: unknown): void;
  /** Chamado depois de uma entrega ACEITA: o main apaga o registro persistido (AUD-05). Nunca antes do envio. */
  aoEntregar?(itens: readonly ItemEnfileirado[]): void;
}

export interface FilaWake {
  /** Síncrono para o chamador: nunca bloqueia esperando entrega. */
  enfileirar(item: ItemWake): void;
  /** O main chama a cada `pane.state_changed`. */
  aoMudarEstado(pane_id: string, estado: EstadoPane): void;
  /** Reavalia todos os destinos (rede de segurança contra evento perdido; também usada pelo hook PostToolUse). */
  sondar(): Promise<void>;
  pendentes(pane_id?: string): ItemEnfileirado[];
  /** Descarta a fila de um Pane encerrado. */
  descartar(pane_id: string): void;
  /** Resolve quando não há entrega em andamento (testes). */
  ociosa(): Promise<void>;
}

const STATUS_PT: Readonly<Record<StatusHandoff, string>> = { ok: "ok", parcial: "parcial", bloqueado: "bloqueado", falhou: "falhou" };

export function textoDoWake(itens: readonly ItemWake[]): string {
  return itens
    .map((i) => {
      const relatorio = i.relatorio_path === null ? "" : ` Relatório: ${i.relatorio_path}`;
      return `[wake] Worker ${i.origem_pane_id} entregou o card ${i.task_id} (${STATUS_PT[i.status]}): ${i.resumo.replace(/\s+/g, " ").trim()}${relatorio}`;
    })
    .join(" | ");
}

export function criarFilaWake(deps: DepsFilaWake): FilaWake {
  const filas = new Map<string, ItemEnfileirado[]>();
  const estados = new Map<string, EstadoPane>();
  const emAndamento = new Set<string>();
  /** pedido de nova avaliação que chegou durante uma em andamento (evento de estado não pode se perder) */
  const repetir = new Set<string>();
  const tarefas = new Set<Promise<void>>();
  let sequencia = 0;

  async function estadoDe(pane_id: string): Promise<EstadoPane | null> {
    const conhecido = estados.get(pane_id);
    if (conhecido !== undefined) return conhecido;
    return deps.estado === undefined ? null : await deps.estado(pane_id);
  }

  /** Uma avaliação do destino: entrega o lote inteiro, em ordem, se o Pane está ocioso. */
  async function avaliar(pane_id: string): Promise<void> {
    if ((await estadoDe(pane_id)) !== "pronto") return;
    const lote = [...(filas.get(pane_id) ?? [])];
    if (lote.length === 0) return;
    let aceito = false;
    try {
      aceito = await deps.enviar(pane_id, textoDoWake(lote));
    } catch {
      aceito = false;
    }
    if (!aceito) return;
    const ids = new Set(lote.map((i) => i.id));
    const restante = (filas.get(pane_id) ?? []).filter((i) => !ids.has(i.id));
    if (restante.length === 0) filas.delete(pane_id);
    else filas.set(pane_id, restante);
    estados.set(pane_id, "trabalhando"); // o Pane foi acordado: o próximo ponto seguro é o próximo ocioso
    try { deps.aoEntregar?.(lote); } catch { /* o registro persistido é reforço; a entrega já aconteceu */ }
    for (const i of lote) deps.emitir?.("wake.delivered", { pane_id, task_id: i.task_id, handoff_id: i.handoff_id });
  }

  async function tentar(pane_id: string): Promise<void> {
    if (emAndamento.has(pane_id)) {
      repetir.add(pane_id);
      return;
    }
    emAndamento.add(pane_id);
    try {
      do {
        repetir.delete(pane_id);
        if ((filas.get(pane_id)?.length ?? 0) === 0) break;
        await avaliar(pane_id);
      } while (repetir.has(pane_id));
    } finally {
      emAndamento.delete(pane_id);
    }
  }

  function disparar(pane_id: string): void {
    const t = tentar(pane_id).catch(() => undefined).finally(() => tarefas.delete(t));
    tarefas.add(t);
  }

  return {
    enfileirar(item) {
      const fila0 = filas.get(item.destino_pane_id);
      if (fila0?.some((i) => i.handoff_id === item.handoff_id) === true) return; // idempotente: reentrega do boot + entrega normal
      const enfileirado: ItemEnfileirado = { ...item, id: ++sequencia };
      const fila = filas.get(item.destino_pane_id) ?? [];
      fila.push(enfileirado);
      filas.set(item.destino_pane_id, fila);
      deps.emitir?.("wake.queued", { pane_id: item.destino_pane_id, task_id: item.task_id, handoff_id: item.handoff_id });
      disparar(item.destino_pane_id);
    },
    aoMudarEstado(pane_id, estado) {
      estados.set(pane_id, estado);
      if (estado === "pronto") disparar(pane_id);
      if (estado === "encerrado") filas.delete(pane_id);
    },
    async sondar() {
      await Promise.all([...filas.keys()].map((p) => tentar(p)));
    },
    pendentes(pane_id) {
      return pane_id === undefined ? [...filas.values()].flat() : [...(filas.get(pane_id) ?? [])];
    },
    descartar(pane_id) {
      filas.delete(pane_id);
      estados.delete(pane_id);
    },
    async ociosa() {
      while (tarefas.size > 0) await Promise.all([...tarefas]);
    },
  };
}
