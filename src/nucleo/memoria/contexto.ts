// Resolve a identidade de memória de um Pane a partir do banco (nunca de argumento de agente).
import type { Banco } from "../banco";
import { NaoEncontradoErro } from "../dominio";
import { raizDaLinhagem } from "./linhagem";
import { resolverModo } from "./modo";
import { criarRepoMemoria } from "./repo";
import type { ContextoMemoria, PapelMemoria } from "./tipos";

interface LinhaPane {
  workspace_id: string;
  mission_id: string | null;
  tipo: "cli" | "shell";
  cli: string | null;
  papel: PapelMemoria;
  missao_modo: "livre" | "squad" | "agentico" | null;
  squad_slug: string | null;
}

export interface OpcoesContexto {
  /** `recursosDaFerramenta(cli).mcp`; padrão: CLIs com cli != null têm MCP. */
  cliTemMcp?: (cli: string | null) => boolean;
}

export function resolverContextoDoPane(banco: Banco, paneId: string, op: OpcoesContexto = {}): ContextoMemoria {
  const l = banco.consultarUm<LinhaPane>(
    `SELECT p.workspace_id, p.mission_id, p.tipo, p.cli, p.papel, m.modo AS missao_modo, ms.squad_slug AS squad_slug
       FROM pane p LEFT JOIN mission m ON m.id = p.mission_id LEFT JOIN mission_squad ms ON ms.mission_id = p.mission_id WHERE p.id = ?`,
    [paneId],
  );
  if (!l) throw new NaoEncontradoErro("Pane", paneId);
  const repo = criarRepoMemoria(banco);
  const modo = resolverModo({
    config: repo.obterConfig(l.workspace_id),
    global_ativa: repo.globalAtiva(),
    missao_ativa: l.mission_id ? repo.missaoAtiva(l.mission_id) : null,
    pane: { tipo: l.tipo },
    missao: l.missao_modo ? { modo: l.missao_modo } : null,
    cli_tem_mcp: (op.cliTemMcp ?? ((c) => c !== null))(l.cli),
  });
  return {
    workspace_id: l.workspace_id,
    mission_id: l.mission_id,
    pane_id: paneId,
    linhagem_id: raizDaLinhagem(banco, paneId),
    squad_slug: l.missao_modo === "squad" ? l.squad_slug : null,
    modo,
    papel: l.papel,
  };
}

/** Contexto de Missão (sem Pane): usado por eventos que só conhecem a Missão (task.updated, mission.closed, método). */
export function resolverContextoDaMissao(banco: Banco, missionId: string): ContextoMemoria | null {
  const l = banco.consultarUm<{ workspace_id: string; modo: "livre" | "squad" | "agentico"; squad_slug: string | null }>(
    "SELECT m.workspace_id, m.modo, ms.squad_slug FROM mission m LEFT JOIN mission_squad ms ON ms.mission_id = m.id WHERE m.id = ?",
    [missionId],
  );
  if (!l) return null;
  const repo = criarRepoMemoria(banco);
  const modo = resolverModo({
    config: repo.obterConfig(l.workspace_id),
    global_ativa: repo.globalAtiva(),
    missao_ativa: repo.missaoAtiva(missionId),
    pane: { tipo: "cli" },
    missao: { modo: l.modo },
    cli_tem_mcp: true,
  });
  return { workspace_id: l.workspace_id, mission_id: missionId, pane_id: null, linhagem_id: null, squad_slug: l.modo === "squad" ? l.squad_slug : null, modo, papel: "nenhum" };
}
