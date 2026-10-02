// Persistência segura do snapshot de Pane (R-3 da AUDITORIA-LOJA-MCP). O daemon de PTY sobrevive ao restart do app e o token do Pane continua válido (segredo HMAC
// persistente), mas o snapshot vivia só em memória: o Pane perdia o gate `pre-mcp` e a rota de segredos. Aqui o retrato (ids de servidor, papel, modo, raiz
// RELATIVA ao workspace) vai para `gateway_pane` e é reidratado sob demanda, enquanto o Pane existir e antes de `expira_em` (= validade do token, 24 h).
// NUNCA entram token, segredo, comando nem argumento. Puro: caminho e relógio entram por parâmetro.
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { PAPEIS_GATEWAY, type PapelGateway } from "../../compartilhado/catalogo";
import type { RegistroPaneGateway } from "./repositorio";
import type { ModoMissaoGw } from "./tipos";

export const TTL_SNAPSHOT_PANE_MS = 24 * 60 * 60 * 1000;
export type ViaSnapshot = "loja" | "gateway";

export interface PaneSnapshotPersistivel {
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  /** `nenhum` (painel livre sem papel) vira `executor` para o filtro */
  papel: string;
  modo: ModoMissaoGw;
  via: ViaSnapshot;
  ids: string[];
  agente_id: string | null;
  /** raiz absoluta onde o Pane trabalha */
  raiz: string | null;
}

export function papelDoGateway(papel: string): PapelGateway {
  return (PAPEIS_GATEWAY as readonly string[]).includes(papel) ? (papel as PapelGateway) : "executor";
}

export function serializarPane(p: PaneSnapshotPersistivel, raizWorkspace: string | null, agoraMs: number): RegistroPaneGateway {
  let raizRel: string | null = null;
  if (p.raiz !== null && raizWorkspace !== null) {
    const rel = relative(resolve(raizWorkspace), resolve(p.raiz));
    raizRel = rel === "" ? "." : rel.startsWith("..") || isAbsolute(rel) ? null : rel.split(sep).join("/");
  }
  return {
    pane_id: p.pane_id, workspace_id: p.workspace_id, mission_id: p.mission_id, papel: papelDoGateway(p.papel), modo: p.modo,
    dados_json: JSON.stringify({ via: p.via, ids: p.ids.slice(0, 100), agente_id: p.agente_id, raiz_rel: raizRel }),
    criado_em: new Date(agoraMs).toISOString(), expira_em: new Date(agoraMs + TTL_SNAPSHOT_PANE_MS).toISOString(),
  };
}

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** `null` se vencido, de outra via, ou malformado (linha adulterada nunca vira acesso). */
export function desserializarPane(r: RegistroPaneGateway, via: ViaSnapshot, raizWorkspace: string | null, agoraMs: number): PaneSnapshotPersistivel | null {
  if (Date.parse(r.expira_em) <= agoraMs) return null;
  let d: unknown;
  try { d = JSON.parse(r.dados_json); } catch { return null; }
  if (typeof d !== "object" || d === null) return null;
  const o = d as { via?: unknown; ids?: unknown; agente_id?: unknown; raiz_rel?: unknown };
  if (o.via !== via || !Array.isArray(o.ids) || !o.ids.every((i) => typeof i === "string" && (via === "gateway" ? ID.test(i) : ID.test(i)))) return null;
  if (r.modo !== "livre" && r.modo !== "squad" && r.modo !== "agentico") return null;
  let raiz: string | null = raizWorkspace;
  if (typeof o.raiz_rel === "string" && raizWorkspace !== null) {
    const alvo = resolve(join(raizWorkspace, o.raiz_rel));
    const rel = relative(resolve(raizWorkspace), alvo);
    raiz = rel.startsWith("..") || isAbsolute(rel) ? raizWorkspace : alvo;
  }
  return {
    pane_id: r.pane_id, workspace_id: r.workspace_id, mission_id: r.mission_id, papel: r.papel, modo: r.modo, via,
    ids: o.ids as string[], agente_id: typeof o.agente_id === "string" ? o.agente_id : null, raiz,
  };
}
