import type { Banco, Parametros } from "../banco";
import { agora } from "../tempo";
import {
  DuplicadoErro,
  ESTADOS_TASK,
  NaoEncontradoErro,
  PAPEIS,
  ErroDominio,
  ValidacaoSemRevisorErro,
  type EstadoTask,
  type OpcoesPagina,
  type Pagina,
  type Papel,
  type Task,
} from "../../dominio";
import { ehUnicoViolado, exigirEnum, fecharPagina, limiteDe, novoId, textoObrigatorio } from "./comum";

export class TransicaoTaskInvalidaErro extends ErroDominio {
  override name = "TransicaoTaskInvalidaErro";
  constructor(
    readonly de: string,
    readonly para: string,
  ) {
    super(`Transição de task inválida: ${de} → ${para}.`);
  }
}

const TRANSICOES_TASK: Readonly<Record<EstadoTask, readonly EstadoTask[]>> = {
  aberta: ["reivindicada", "entregue", "descartada"],
  reivindicada: ["aberta", "entregue", "descartada"],
  entregue: ["reivindicada", "validada", "descartada"],
  validada: [],
  descartada: [],
};

export interface NovaTask {
  mission_id: string;
  task_ref: string;
  titulo: string;
  papel: Papel;
  briefing_path?: string | null;
}

export function criarRepoTask(banco: Banco) {
  const obter = (id: string): Task | undefined => banco.consultarUm<Task>("SELECT * FROM task WHERE id = ?", [id]);
  const exigir = (id: string): Task => {
    const t = obter(id);
    if (!t) throw new NaoEncontradoErro("Task", id);
    return t;
  };
  return {
    obter,
    exigir,
    criar(d: NovaTask): Task {
      const papel = exigirEnum("papel", d.papel, PAPEIS);
      const ref = textoObrigatorio("task_ref", d.task_ref);
      const titulo = textoObrigatorio("titulo", d.titulo);
      if (!banco.consultarUm("SELECT 1 AS x FROM mission WHERE id = ?", [d.mission_id])) throw new NaoEncontradoErro("Mission", d.mission_id);
      const id = novoId("task", "task");
      const ts = agora();
      try {
        banco.executar(
          "INSERT INTO task (id,mission_id,task_ref,titulo,briefing_path,papel,estado,pane_id,handoff_id,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,'aberta',NULL,NULL,?,?)",
          [id, d.mission_id, ref, titulo, d.briefing_path ?? null, papel, ts, ts],
        );
      } catch (e) {
        if (ehUnicoViolado(e, "task.task_ref")) throw new DuplicadoErro("Task", `${d.mission_id}/${ref}`);
        throw e;
      }
      return exigir(id);
    },
    /**
     * Muda o estado seguindo a tabela de transições. `validada` exige handoff `ok` de um Pane de
     * papel `revisor` para esta task (o mais recente passa a ser `handoff_id`).
     */
    mudarEstado(id: string, para: EstadoTask, extra?: { pane_id?: string | null }): Task {
      exigirEnum("estado", para, ESTADOS_TASK);
      return banco.transacao((tx) => {
        const atual = tx.consultarUm<Task>("SELECT * FROM task WHERE id = ?", [id]);
        if (!atual) throw new NaoEncontradoErro("Task", id);
        let handoffId = atual.handoff_id;
        if (para === "validada") {
          const h = tx.consultarUm<{ id: string }>(
            "SELECT h.id FROM handoff h JOIN pane p ON p.id = h.de_pane_id WHERE h.task_id = ? AND h.status = 'ok' AND p.papel = 'revisor' ORDER BY h.id DESC LIMIT 1",
            [id],
          );
          if (!h) throw new ValidacaoSemRevisorErro(id);
          handoffId = h.id;
        }
        if (!TRANSICOES_TASK[atual.estado].includes(para)) throw new TransicaoTaskInvalidaErro(atual.estado, para);
        let paneId = atual.pane_id;
        if (extra?.pane_id !== undefined) paneId = extra.pane_id;
        else if (para === "aberta") paneId = null;
        tx.executar("UPDATE task SET estado = ?, pane_id = ?, handoff_id = ?, atualizado_em = ? WHERE id = ?", [para, paneId, handoffId, agora(), id]);
        return tx.consultarUm<Task>("SELECT * FROM task WHERE id = ?", [id]) as Task;
      });
    },
    listarPorMissao(missionId: string, op?: OpcoesPagina & { estado?: EstadoTask }): Pagina<Task> {
      const limite = limiteDe(op);
      const cond = ["mission_id = ?"];
      const params: (string | number)[] = [missionId];
      if (op?.estado !== undefined) {
        cond.push("estado = ?");
        params.push(exigirEnum("estado", op.estado, ESTADOS_TASK));
      }
      if (op?.depois) {
        cond.push("id > ?");
        params.push(op.depois);
      }
      params.push(limite + 1);
      return fecharPagina(banco.consultar<Task>(`SELECT * FROM task WHERE ${cond.join(" AND ")} ORDER BY id LIMIT ?`, params as Parametros), limite);
    },
  };
}

export type RepoTask = ReturnType<typeof criarRepoTask>;
