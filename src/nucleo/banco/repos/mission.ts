import type { Banco, Parametros } from "../banco";
import { agora } from "../tempo";
import {
  ESTADOS_MISSAO,
  MODOS_MISSAO,
  NaoEncontradoErro,
  ORIGENS_MISSAO,
  TransicaoMissaoInvalidaErro,
  missaoTerminal,
  transicaoMissaoValida,
  type EstadoMissao,
  type Mission,
  type ModoMissao,
  type OpcoesPagina,
  type OrigemMissao,
  type Pagina,
} from "../../dominio";
import { atualizarCampos, exigirEnum, fecharPagina, limiteDe, novoId, textoObrigatorio } from "./comum";

export interface NovaMissao {
  workspace_id: string;
  modo: ModoMissao;
  origem: OrigemMissao;
  titulo: string;
  trabalho_id?: string | null;
  worktree?: string | null;
  branch?: string | null;
  /** Fase 14: slug da squad (sem ele a Missão é idêntica à do MVP). */
  squad_id?: string | null;
}

export function criarRepoMission(banco: Banco) {
  const obter = (id: string): Mission | undefined => banco.consultarUm<Mission>("SELECT * FROM mission WHERE id = ?", [id]);
  const exigir = (id: string): Mission => {
    const m = obter(id);
    if (!m) throw new NaoEncontradoErro("Mission", id);
    return m;
  };
  return {
    obter,
    exigir,
    criar(d: NovaMissao): Mission {
      const modo = exigirEnum("modo", d.modo, MODOS_MISSAO);
      const origem = exigirEnum("origem", d.origem, ORIGENS_MISSAO);
      const titulo = textoObrigatorio("titulo", d.titulo);
      if (!banco.consultarUm("SELECT 1 AS x FROM workspace WHERE id = ? AND removido_em IS NULL", [d.workspace_id])) {
        throw new NaoEncontradoErro("Workspace", d.workspace_id);
      }
      const id = novoId("mission", "mis");
      const ts = agora();
      banco.executar(
        "INSERT INTO mission (id,workspace_id,modo,origem,trabalho_id,titulo,estado,worktree,branch,piloto_pane_id,concluida_em,squad_id,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,'intake',?,?,NULL,NULL,?,?,?)",
        [id, d.workspace_id, modo, origem, d.trabalho_id ?? null, titulo, d.worktree ?? null, d.branch ?? null, d.squad_id ?? null, ts, ts],
      );
      return exigir(id);
    },
    /** Mais novas primeiro. Cursor = id (ULID monotônico). */
    listarPorWorkspace(workspaceId: string, op?: OpcoesPagina & { estado?: EstadoMissao }): Pagina<Mission> {
      const limite = limiteDe(op);
      const cond = ["workspace_id = ?"];
      const params: (string | number)[] = [workspaceId];
      if (op?.estado !== undefined) {
        cond.push("estado = ?");
        params.push(exigirEnum("estado", op.estado, ESTADOS_MISSAO));
      }
      if (op?.depois) {
        cond.push("id < ?");
        params.push(op.depois);
      }
      params.push(limite + 1);
      const linhas = banco.consultar<Mission>(`SELECT * FROM mission WHERE ${cond.join(" AND ")} ORDER BY id DESC LIMIT ?`, params as Parametros);
      return fecharPagina(linhas, limite);
    },
    /** Máquina de estados: só as transições de TRANSICOES_MISSAO. Lê e grava na mesma transação. */
    transicionar(id: string, para: EstadoMissao): Mission {
      exigirEnum("estado", para, ESTADOS_MISSAO);
      return banco.transacao((tx) => {
        const atual = tx.consultarUm<Mission>("SELECT * FROM mission WHERE id = ?", [id]);
        if (!atual) throw new NaoEncontradoErro("Mission", id);
        if (!transicaoMissaoValida(atual.estado, para)) throw new TransicaoMissaoInvalidaErro(atual.estado, para);
        const ts = agora();
        tx.executar("UPDATE mission SET estado = ?, concluida_em = ?, atualizado_em = ? WHERE id = ?", [
          para,
          missaoTerminal(para) ? ts : null,
          ts,
          id,
        ]);
        return tx.consultarUm<Mission>("SELECT * FROM mission WHERE id = ?", [id]) as Mission;
      });
    },
    definirWorktree(id: string, d: { worktree: string | null; branch: string | null }): Mission {
      exigir(id);
      atualizarCampos(banco, "mission", id, { worktree: d.worktree, branch: d.branch }, ["worktree", "branch"], agora());
      return exigir(id);
    },
    atualizarTitulo(id: string, titulo: string): Mission {
      exigir(id);
      atualizarCampos(banco, "mission", id, { titulo: textoObrigatorio("titulo", titulo) }, ["titulo"], agora());
      return exigir(id);
    },
  };
}

export type RepoMission = ReturnType<typeof criarRepoMission>;
