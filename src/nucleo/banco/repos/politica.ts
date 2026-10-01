import type { Banco, Valor } from "../banco";
import { agora } from "../tempo";
import { ValorInvalidoErro } from "../../dominio";
import { ATUALIZADO_POR, FAIXAS, type AtualizadoPor, type Executor, type Politica, type PoliticaEntrada } from "../../../compartilhado/harness";
import { bool, exigirEnum, int, novoId, textoObrigatorio } from "./comum";
import { jsonDe, lerJson } from "./json";

interface Linha {
  id: string;
  workspace_id: string | null;
  task_type: string;
  executor_json: string;
  alternativas_json: string;
  fallback_json: string;
  skills_json: string;
  agente: string | null;
  conta_fixa_id: string | null;
  evitar_reservadas: number;
  habilitada: number;
  atualizado_por: AtualizadoPor;
  atualizado_em: string;
}
const mapear = (l: Linha): Politica => ({
  id: l.id,
  workspace_id: l.workspace_id,
  task_type: l.task_type,
  executor: lerJson<Executor>(l.executor_json, { provider: "", cli: null, model: null, effort: null, faixa: null }),
  alternativas: lerJson<Executor[]>(l.alternativas_json, []),
  fallback: lerJson<Executor[]>(l.fallback_json, []),
  skills: lerJson<string[]>(l.skills_json, []),
  agente: l.agente,
  conta_fixa_id: l.conta_fixa_id,
  evitar_reservadas: bool(l.evitar_reservadas),
  habilitada: bool(l.habilitada),
  atualizado_por: l.atualizado_por,
  atualizado_em: l.atualizado_em,
});

function checarExecutor(campo: string, e: Executor): void {
  textoObrigatorio(`${campo}.provider`, e.provider);
  if (e.faixa !== null) exigirEnum(`${campo}.faixa`, e.faixa, FAIXAS);
}

/** Política por (workspace, task_type); `workspace_id` NULL = global. Override do workspace vence a global. */
export function criarRepoPolitica(banco: Banco) {
  const obterExata = (workspaceId: string | null, taskType: string): Politica | undefined => {
    const l = banco.consultarUm<Linha>("SELECT * FROM politica WHERE COALESCE(workspace_id,'') = COALESCE(?,'') AND task_type = ?", [workspaceId, taskType]);
    return l ? mapear(l) : undefined;
  };
  return {
    obter: obterExata,
    obterPorId(id: string): Politica | undefined {
      const l = banco.consultarUm<Linha>("SELECT * FROM politica WHERE id = ?", [id]);
      return l ? mapear(l) : undefined;
    },
    /** Só as linhas daquele escopo (global ou do workspace). */
    listar(workspaceId: string | null): Politica[] {
      const sql = workspaceId === null ? "SELECT * FROM politica WHERE workspace_id IS NULL ORDER BY task_type" : "SELECT * FROM politica WHERE workspace_id = ? ORDER BY task_type";
      return banco.consultar<Linha>(sql, workspaceId === null ? [] : [workspaceId]).map(mapear);
    },
    /** Efetiva: a do workspace vence a global do mesmo task_type. */
    efetivas(workspaceId: string | null): Politica[] {
      const globais = this.listar(null);
      if (workspaceId === null) return globais;
      const mapa = new Map(globais.map((p) => [p.task_type, p]));
      for (const p of this.listar(workspaceId)) mapa.set(p.task_type, p);
      return [...mapa.values()].sort((a, b) => a.task_type.localeCompare(b.task_type));
    },
    /** Política efetiva de um tipo (workspace → global), ou undefined. */
    efetiva(workspaceId: string | null, taskType: string): Politica | undefined {
      return (workspaceId !== null ? obterExata(workspaceId, taskType) : undefined) ?? obterExata(null, taskType);
    },
    /** Cria ou substitui a política do (workspace, task_type). `fallback` nunca pode ser vazio. */
    gravar(d: PoliticaEntrada, por: AtualizadoPor): Politica {
      exigirEnum("atualizado_por", por, ATUALIZADO_POR);
      textoObrigatorio("task_type", d.task_type);
      checarExecutor("executor", d.executor);
      d.alternativas.forEach((e, i) => checarExecutor(`alternativas[${i}]`, e));
      if (!Array.isArray(d.fallback) || d.fallback.length === 0) throw new ValorInvalidoErro("fallback", "[]");
      d.fallback.forEach((e, i) => checarExecutor(`fallback[${i}]`, e));
      const ts = agora();
      return banco.transacao((tx) => {
        const existente = tx.consultarUm<{ id: string }>("SELECT id FROM politica WHERE COALESCE(workspace_id,'') = COALESCE(?,'') AND task_type = ?", [d.workspace_id, d.task_type]);
        const comuns: Valor[] = [jsonDe("executor", d.executor), jsonDe("alternativas", d.alternativas), jsonDe("fallback", d.fallback), jsonDe("skills", d.skills), d.agente, d.conta_fixa_id, int(d.evitar_reservadas), int(d.habilitada), por, ts];
        let id: string;
        if (existente) {
          id = existente.id;
          tx.executar(
            "UPDATE politica SET executor_json=?, alternativas_json=?, fallback_json=?, skills_json=?, agente=?, conta_fixa_id=?, evitar_reservadas=?, habilitada=?, atualizado_por=?, atualizado_em=? WHERE id = ?",
            [...comuns, id],
          );
        } else {
          id = novoId("conta", "pol");
          tx.executar(
            "INSERT INTO politica (id,workspace_id,task_type,executor_json,alternativas_json,fallback_json,skills_json,agente,conta_fixa_id,evitar_reservadas,habilitada,atualizado_por,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [id, d.workspace_id, d.task_type, ...comuns.slice(0, 9), ts, ts],
          );
        }
        return mapear(tx.consultarUm<Linha>("SELECT * FROM politica WHERE id = ?", [id]) as Linha);
      });
    },
    /** Remove as políticas do escopo (todas, ou só a de um task_type). Devolve quantas. */
    remover(workspaceId: string | null, taskType?: string): number {
      const cond = "COALESCE(workspace_id,'') = COALESCE(?,'')" + (taskType !== undefined ? " AND task_type = ?" : "");
      return banco.executar(`DELETE FROM politica WHERE ${cond}`, taskType !== undefined ? [workspaceId, taskType] : [workspaceId]).alteracoes;
    },
  };
}
export type RepoPolitica = ReturnType<typeof criarRepoPolitica>;
