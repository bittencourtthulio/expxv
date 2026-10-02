import type { Banco } from "../banco";
import type { ConfigGateway, EntradaAuditoriaGateway } from "../../../compartilhado/catalogo";
import { CONFIG_PADRAO_GATEWAY, type RegistroPaneGateway, type RepoGateway } from "../../gateway-mcp/repositorio";
import type { RegraFiltro } from "../../gateway-mcp/tipos";
import { bool, int } from "./comum";

/** Repositório SQLite do gateway MCP (Fase 7C, migration 0018). Só metadado; auditoria sem argumentos nem resultados. */
export function criarRepoGateway(banco: Banco): RepoGateway {
  const cfg = (ws: string, l: Record<string, unknown> | undefined): ConfigGateway =>
    l === undefined
      ? { workspace_id: ws, ...CONFIG_PADRAO_GATEWAY, atualizado_em: null }
      : {
          workspace_id: ws, ativo: bool(l["ativo"]), modo_superficie: l["modo_superficie"] as ConfigGateway["modo_superficie"], max_ferramentas: Number(l["max_ferramentas"]),
          limite_por_min: Number(l["limite_por_min"]), ocioso_s: Number(l["ocioso_s"]), atualizado_em: String(l["atualizado_em"]),
        };
  return {
    config: (ws) => cfg(ws, banco.consultarUm<Record<string, unknown>>("SELECT * FROM gateway_config WHERE workspace_id = ?", [ws]) ?? undefined),
    gravarConfig(p, agora) {
      banco.executar(
        `INSERT INTO gateway_config (workspace_id,ativo,modo_superficie,max_ferramentas,limite_por_min,ocioso_s,atualizado_em) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET ativo=excluded.ativo, modo_superficie=excluded.modo_superficie, max_ferramentas=excluded.max_ferramentas,
           limite_por_min=excluded.limite_por_min, ocioso_s=excluded.ocioso_s, atualizado_em=excluded.atualizado_em`,
        [p.workspace_id, int(p.ativo), p.modo_superficie, p.max_ferramentas, p.limite_por_min, p.ocioso_s, agora],
      );
      return cfg(p.workspace_id, banco.consultarUm<Record<string, unknown>>("SELECT * FROM gateway_config WHERE workspace_id = ?", [p.workspace_id]) ?? undefined);
    },
    regras: (ws) =>
      banco.consultar<Record<string, unknown>>("SELECT servidor_id,ferramenta,papel,habilitada FROM gateway_filtro WHERE workspace_id = ?", [ws]).map((l): RegraFiltro => ({
        servidor_id: String(l["servidor_id"]), ferramenta: String(l["ferramenta"]), papel: l["papel"] as RegraFiltro["papel"], habilitada: bool(l["habilitada"]),
      })),
    definirRegra(ws, r, agora) {
      banco.executar(
        `INSERT INTO gateway_filtro (workspace_id,servidor_id,ferramenta,papel,habilitada,atualizado_em) VALUES (?,?,?,?,?,?)
         ON CONFLICT(workspace_id,servidor_id,ferramenta,papel) DO UPDATE SET habilitada=excluded.habilitada, atualizado_em=excluded.atualizado_em`,
        [ws, r.servidor_id, r.ferramenta, r.papel, int(r.habilitada), agora],
      );
    },
    gravarPane(r) {
      banco.executar(
        `INSERT INTO gateway_pane (pane_id,workspace_id,mission_id,papel,modo,servidores_json,criado_em,expira_em) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(pane_id) DO UPDATE SET workspace_id=excluded.workspace_id, mission_id=excluded.mission_id, papel=excluded.papel, modo=excluded.modo,
           servidores_json=excluded.servidores_json, criado_em=excluded.criado_em, expira_em=excluded.expira_em`,
        [r.pane_id, r.workspace_id, r.mission_id, r.papel, r.modo, r.dados_json, r.criado_em, r.expira_em],
      );
    },
    obterPane(paneId) {
      const l = banco.consultarUm<Record<string, unknown>>("SELECT * FROM gateway_pane WHERE pane_id = ?", [paneId]);
      return l === undefined || l === null
        ? null
        : { pane_id: String(l["pane_id"]), workspace_id: String(l["workspace_id"]), mission_id: l["mission_id"] === null ? null : String(l["mission_id"]), papel: String(l["papel"]), modo: String(l["modo"]), dados_json: String(l["servidores_json"]), criado_em: String(l["criado_em"]), expira_em: String(l["expira_em"]) } satisfies RegistroPaneGateway;
    },
    removerPane: (paneId) => { banco.executar("DELETE FROM gateway_pane WHERE pane_id = ?", [paneId]); },
    podarPanes(agoraIso) {
      const n = banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM gateway_pane WHERE expira_em <= ?", [agoraIso])?.n ?? 0;
      banco.executar("DELETE FROM gateway_pane WHERE expira_em <= ?", [agoraIso]);
      return Number(n);
    },
    registrarAuditoria(e) {
      banco.executar(
        "INSERT INTO gateway_auditoria (id,em,workspace_id,pane_id,papel,servidor_id,ferramenta,decisao,duracao_ms,bytes_entrada,bytes_saida) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [e.id, e.em, e.workspace_id, e.pane_id, e.papel, e.servidor_id, e.ferramenta, e.decisao, e.duracao_ms, e.bytes_entrada, e.bytes_saida],
      );
    },
    listarAuditoria(ws, limite) {
      const n = Math.min(Math.max(1, Math.trunc(limite)), 500);
      const linhas = ws === null
        ? banco.consultar<Record<string, unknown>>("SELECT * FROM gateway_auditoria ORDER BY em DESC, id DESC LIMIT ?", [n])
        : banco.consultar<Record<string, unknown>>("SELECT * FROM gateway_auditoria WHERE workspace_id = ? ORDER BY em DESC, id DESC LIMIT ?", [ws, n]);
      const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
      return linhas.map((l): EntradaAuditoriaGateway => ({
        id: String(l["id"]), em: String(l["em"]), workspace_id: String(l["workspace_id"]), pane_id: String(l["pane_id"]), papel: String(l["papel"]),
        servidor_id: l["servidor_id"] === null ? null : String(l["servidor_id"]), ferramenta: l["ferramenta"] === null ? null : String(l["ferramenta"]),
        decisao: l["decisao"] as EntradaAuditoriaGateway["decisao"], duracao_ms: num(l["duracao_ms"]), bytes_entrada: num(l["bytes_entrada"]), bytes_saida: num(l["bytes_saida"]),
      }));
    },
    podarAuditoria(antes) {
      const n = banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM gateway_auditoria WHERE em < ?", [antes])?.n ?? 0;
      banco.executar("DELETE FROM gateway_auditoria WHERE em < ?", [antes]);
      return Number(n);
    },
  };
}
