import type { Banco } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro, RESUMO_HANDOFF_MAX, ResumoLongoErro, STATUS_HANDOFF, ValorInvalidoErro, type Handoff, type StatusHandoff } from "../../dominio";
import { exigirEnum, novoId } from "./comum";

export interface NovoHandoff {
  task_id: string;
  de_pane_id?: string | null;
  para_pane_id?: string | null;
  resumo: string;
  relatorio_path?: string | null;
  status: StatusHandoff;
}

export function criarRepoHandoff(banco: Banco) {
  const obter = (id: string): Handoff | undefined => banco.consultarUm<Handoff>("SELECT * FROM handoff WHERE id = ?", [id]);
  return {
    obter,
    /** Grava o handoff e aponta `task.handoff_id` para ele, na mesma transação. */
    criar(d: NovoHandoff): Handoff {
      const status = exigirEnum("status", d.status, STATUS_HANDOFF);
      if (typeof d.resumo !== "string" || d.resumo.trim() === "") throw new ValorInvalidoErro("resumo", d.resumo);
      const tamanho = [...d.resumo].length;
      if (tamanho > RESUMO_HANDOFF_MAX) throw new ResumoLongoErro(tamanho, RESUMO_HANDOFF_MAX);
      return banco.transacao((tx) => {
        if (!tx.consultarUm("SELECT 1 AS x FROM task WHERE id = ?", [d.task_id])) throw new NaoEncontradoErro("Task", d.task_id);
        const id = novoId("handoff", "hof");
        const ts = agora();
        tx.executar(
          "INSERT INTO handoff (id,task_id,de_pane_id,para_pane_id,resumo,relatorio_path,status,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)",
          [id, d.task_id, d.de_pane_id ?? null, d.para_pane_id ?? null, d.resumo, d.relatorio_path ?? null, status, ts, ts],
        );
        tx.executar("UPDATE task SET handoff_id = ?, atualizado_em = ? WHERE id = ?", [id, ts, d.task_id]);
        return tx.consultarUm<Handoff>("SELECT * FROM handoff WHERE id = ?", [id]) as Handoff;
      });
    },
    listarPorTask(taskId: string): Handoff[] {
      return banco.consultar<Handoff>("SELECT * FROM handoff WHERE task_id = ? ORDER BY id", [taskId]);
    },
  };
}

export type RepoHandoff = ReturnType<typeof criarRepoHandoff>;
