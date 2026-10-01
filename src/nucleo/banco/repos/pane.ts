import type { Banco, Parametros } from "../banco";
import { proximoValor } from "../sequencia";
import { agora } from "../tempo";
import {
  ESTADOS_PANE,
  NaoEncontradoErro,
  PAPEIS,
  PilotoDuplicadoErro,
  TIPOS_PANE,
  ValorInvalidoErro,
  type EstadoPane,
  type OpcoesPagina,
  type Pagina,
  type Pane,
  type Papel,
  type Sessao,
  type TipoPane,
} from "../../dominio";
import { atualizarCampos, bool, ehUnicoViolado, exigirEnum, fecharPagina, int, limiteDe, novoId } from "./comum";

type LinhaPane = Omit<Pane, "eh_piloto"> & { eh_piloto: number };
const mapear = (l: LinhaPane): Pane => ({ ...l, eh_piloto: bool(l.eh_piloto) });

export interface NovoPane {
  workspace_id: string;
  mission_id?: string | null;
  tipo: TipoPane;
  cli?: string | null;
  executavel_id?: string | null;
  conta_id?: string | null;
  modelo?: string | null;
  esforco?: string | null;
  papel?: Papel;
  /** Padrão: `papel === "piloto"`. */
  eh_piloto?: boolean;
  estado?: EstadoPane;
  cwd?: string | null;
  respawn_de?: string | null;
  /** Fase 14: `"<squad>.<membro>"`. */
  agente_id?: string | null;
}

export interface AtualizacaoPane {
  estado?: Exclude<EstadoPane, "encerrado">;
  sessao_pty_id?: string | null;
  modelo?: string | null;
  esforco?: string | null;
  conta_id?: string | null;
  cwd?: string | null;
}

export function criarRepoPane(banco: Banco) {
  const obter = (id: string): Pane | undefined => {
    const l = banco.consultarUm<LinhaPane>("SELECT * FROM pane WHERE id = ?", [id]);
    return l ? mapear(l) : undefined;
  };
  const exigir = (id: string): Pane => {
    const p = obter(id);
    if (!p) throw new NaoEncontradoErro("Pane", id);
    return p;
  };
  return {
    obter,
    exigir,
    /**
     * Cria o Pane com `display_id` da sequência do workspace. Tudo numa transação: se o piloto
     * duplicar (índice parcial) ou a atualização da Missão falhar, nada fica gravado (nem o contador).
     */
    criar(d: NovoPane): Pane {
      const tipo = exigirEnum("tipo", d.tipo, TIPOS_PANE);
      const papel = exigirEnum("papel", d.papel ?? "nenhum", PAPEIS);
      const estado = exigirEnum("estado", d.estado ?? "iniciando", ESTADOS_PANE);
      const ehPiloto = d.eh_piloto ?? papel === "piloto";
      const missionId = d.mission_id ?? null;
      return banco.transacao((tx) => {
        if (!tx.consultarUm("SELECT 1 AS x FROM workspace WHERE id = ? AND removido_em IS NULL", [d.workspace_id])) {
          throw new NaoEncontradoErro("Workspace", d.workspace_id);
        }
        if (missionId !== null) {
          const m = tx.consultarUm<{ workspace_id: string }>("SELECT workspace_id FROM mission WHERE id = ?", [missionId]);
          if (!m) throw new NaoEncontradoErro("Mission", missionId);
          if (m.workspace_id !== d.workspace_id) throw new ValorInvalidoErro("mission_id", missionId);
        }
        const id = novoId("pane", "pane");
        const ts = agora();
        const display = proximoValor(tx, `pane:${d.workspace_id}`);
        try {
          tx.executar(
            "INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,cli,executavel_id,conta_id,modelo,esforco,papel,eh_piloto,estado,sessao_pty_id,respawn_de,cwd,encerrado_motivo,agente_id,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,?,?,?)",
            [
              id, missionId, d.workspace_id, display, tipo, d.cli ?? null, d.executavel_id ?? null, d.conta_id ?? null,
              d.modelo ?? null, d.esforco ?? null, papel, int(ehPiloto), estado, d.respawn_de ?? null, d.cwd ?? null, d.agente_id ?? null, ts, ts,
            ],
          );
        } catch (e) {
          if (missionId !== null && ehUnicoViolado(e, "pane.mission_id")) throw new PilotoDuplicadoErro(missionId);
          throw e;
        }
        if (missionId !== null && ehPiloto) {
          tx.executar("UPDATE mission SET piloto_pane_id = ?, atualizado_em = ? WHERE id = ?", [id, ts, missionId]);
        }
        return exigir(id);
      });
    },
    /**
     * Fecha o Pane e atualiza a Missão (limpa `piloto_pane_id` se era o piloto) na mesma transação.
     * Idempotente: já encerrado devolve o Pane como está (mantém o primeiro motivo).
     */
    encerrar(id: string, motivo: string | null): Pane {
      return banco.transacao((tx) => {
        const l = tx.consultarUm<LinhaPane>("SELECT * FROM pane WHERE id = ?", [id]);
        if (!l) throw new NaoEncontradoErro("Pane", id);
        if (l.estado === "encerrado") return mapear(l);
        const ts = agora();
        tx.executar("UPDATE pane SET estado = 'encerrado', encerrado_motivo = ?, atualizado_em = ? WHERE id = ?", [motivo, ts, id]);
        if (l.mission_id !== null) {
          tx.executar(
            "UPDATE mission SET piloto_pane_id = CASE WHEN piloto_pane_id = ? THEN NULL ELSE piloto_pane_id END, atualizado_em = ? WHERE id = ?",
            [id, ts, l.mission_id],
          );
        }
        return mapear(tx.consultarUm<LinhaPane>("SELECT * FROM pane WHERE id = ?", [id]) as LinhaPane);
      });
    },
    atualizar(id: string, patch: AtualizacaoPane): Pane {
      if (patch.estado !== undefined) {
        if ((patch.estado as string) === "encerrado") throw new ValorInvalidoErro("estado", "encerrado (use encerrar)");
        exigirEnum("estado", patch.estado, ESTADOS_PANE);
      }
      exigir(id);
      atualizarCampos(
        banco,
        "pane",
        id,
        { ...patch },
        ["estado", "sessao_pty_id", "modelo", "esforco", "conta_id", "cwd"],
        agora(),
      );
      return exigir(id);
    },
    listarPorWorkspace(workspaceId: string, op?: OpcoesPagina & { somenteAtivos?: boolean }): Pagina<Pane> {
      const limite = limiteDe(op);
      const cond = ["workspace_id = ?"];
      const params: (string | number)[] = [workspaceId];
      if (op?.somenteAtivos) cond.push("estado <> 'encerrado'");
      if (op?.depois) {
        cond.push("id > ?");
        params.push(op.depois);
      }
      params.push(limite + 1);
      const linhas = banco.consultar<LinhaPane>(`SELECT * FROM pane WHERE ${cond.join(" AND ")} ORDER BY id LIMIT ?`, params as Parametros);
      const p = fecharPagina(linhas, limite);
      return { itens: p.itens.map(mapear), proximo: p.proximo };
    },
    listarPorMissao(missionId: string): Pane[] {
      return banco.consultar<LinhaPane>("SELECT * FROM pane WHERE mission_id = ? ORDER BY display_id", [missionId]).map(mapear);
    },
    registrarSessao(paneId: string, cliRefConversa: string | null): Sessao {
      exigir(paneId);
      const id = novoId("sessao", "ses");
      const ts = agora();
      banco.executar("INSERT INTO sessao (id,pane_id,cli_ref_conversa,ultimo_uso_em,criado_em,atualizado_em) VALUES (?,?,?,?,?,?)", [
        id, paneId, cliRefConversa, ts, ts, ts,
      ]);
      return banco.consultarUm<Sessao>("SELECT * FROM sessao WHERE id = ?", [id]) as Sessao;
    },
    ultimaSessao(paneId: string): Sessao | undefined {
      return banco.consultarUm<Sessao>("SELECT * FROM sessao WHERE pane_id = ? ORDER BY ultimo_uso_em DESC, id DESC LIMIT 1", [paneId]);
    },
  };
}

export type RepoPane = ReturnType<typeof criarRepoPane>;
