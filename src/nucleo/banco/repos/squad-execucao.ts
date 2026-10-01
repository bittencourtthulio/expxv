import type { Banco, Parametros } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro, ValorInvalidoErro, type EstadoMissao, type OpcoesPagina, type Pagina } from "../../dominio";
import { bool, fecharPagina, int, limiteDe, novoId } from "./comum";

export const OBJETIVO_EXECUCAO_MAX = 4000;

/** Prompt enviado pela caixa da área Squads (já redigido pelo serviço). O estado exibido deriva de `missao_estado`. */
export interface SquadExecucaoLinha {
  id: string;
  squad_slug: string;
  squad_hash: string;
  workspace_id: string;
  mission_id: string | null;
  objetivo: string;
  plano_antes: boolean;
  nivel_rigidez: number | null;
  criado_em: string;
  /** estado atual da Missão vinculada (`null` se não há/ela sumiu). */
  missao_estado: EstadoMissao | null;
}
export interface NovaSquadExecucao {
  squad_slug: string;
  squad_hash: string;
  workspace_id: string;
  mission_id?: string | null;
  objetivo: string;
  plano_antes: boolean;
  nivel_rigidez?: number | null;
}
interface Linha extends Omit<SquadExecucaoLinha, "plano_antes"> {
  plano_antes: number;
}
const mapear = (l: Linha): SquadExecucaoLinha => ({ ...l, plano_antes: bool(l.plano_antes) });
const SELECT = "SELECT e.*, m.estado AS missao_estado FROM squad_execucao e LEFT JOIN mission m ON m.id = e.mission_id";

export function criarRepoSquadExecucao(banco: Banco) {
  const obter = (id: string): SquadExecucaoLinha | undefined => {
    const l = banco.consultarUm<Linha>(`${SELECT} WHERE e.id = ?`, [id]);
    return l ? mapear(l) : undefined;
  };
  const exigir = (id: string): SquadExecucaoLinha => {
    const e = obter(id);
    if (!e) throw new NaoEncontradoErro("SquadExecucao", id);
    return e;
  };
  return {
    obter,
    exigir,
    criar(d: NovaSquadExecucao): SquadExecucaoLinha {
      if (d.objetivo.trim() === "" || d.objetivo.length > OBJETIVO_EXECUCAO_MAX) throw new ValorInvalidoErro("objetivo", `${d.objetivo.length} caracteres`);
      if (!/^[0-9a-f]{64}$/.test(d.squad_hash)) throw new ValorInvalidoErro("squad_hash", d.squad_hash);
      const nivel = d.nivel_rigidez ?? null;
      if (nivel !== null && (!Number.isInteger(nivel) || nivel < 1 || nivel > 5)) throw new ValorInvalidoErro("nivel_rigidez", nivel);
      if (!banco.consultarUm("SELECT 1 AS x FROM workspace WHERE id = ? AND removido_em IS NULL", [d.workspace_id])) throw new NaoEncontradoErro("Workspace", d.workspace_id);
      const id = novoId("task", "sqx");
      banco.executar(
        "INSERT INTO squad_execucao (id,squad_slug,squad_hash,workspace_id,mission_id,objetivo,plano_antes,nivel_rigidez,criado_em) VALUES (?,?,?,?,?,?,?,?,?)",
        [id, d.squad_slug, d.squad_hash, d.workspace_id, d.mission_id ?? null, d.objetivo, int(d.plano_antes), nivel, agora()],
      );
      return exigir(id);
    },
    /** Liga a execução à Missão criada depois (a UNIQUE parcial impede duas execuções na mesma Missão). */
    vincularMissao(id: string, missionId: string): SquadExecucaoLinha {
      exigir(id);
      banco.executar("UPDATE squad_execucao SET mission_id = ? WHERE id = ?", [missionId, id]);
      return exigir(id);
    },
    porMissao(missionId: string): SquadExecucaoLinha | undefined {
      const l = banco.consultarUm<Linha>(`${SELECT} WHERE e.mission_id = ?`, [missionId]);
      return l ? mapear(l) : undefined;
    },
    /** Mais novas primeiro; cursor = id (ULID monotônico). */
    listarPorWorkspace(workspaceId: string, op?: OpcoesPagina): Pagina<SquadExecucaoLinha> {
      const limite = limiteDe(op);
      const cond = ["e.workspace_id = ?"];
      const params: (string | number)[] = [workspaceId];
      if (op?.depois) {
        cond.push("e.id < ?");
        params.push(op.depois);
      }
      params.push(limite + 1);
      const linhas = banco.consultar<Linha>(`${SELECT} WHERE ${cond.join(" AND ")} ORDER BY e.id DESC LIMIT ?`, params as Parametros);
      return fecharPagina(linhas.map(mapear), limite);
    },
  };
}
export type RepoSquadExecucao = ReturnType<typeof criarRepoSquadExecucao>;
