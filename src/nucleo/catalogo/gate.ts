// Gate de skills e de MCP de usuário por Pane (Fase 7, T-07.22). PURO. Decide sobre o SNAPSHOT do Pane (não sobre o token).
// FALHA FECHADA: nome ilegível, snapshot corrompido ou exceção interna => negado. Snapshot ausente = Pane sem política (livre): liberado.
import type { NivelIsolamento } from "../../compartilhado/catalogo";
import { PRODUTO } from "../produto";
import { normalizarNomeSkill } from "./politica";

export interface SnapshotPane {
  cli: string;
  nivel: NivelIsolamento;
  /** `null` = sem filtro de skills */
  skills: readonly string[] | null;
  mcp_do_usuario: "nenhum" | "lista";
  servidores_mcp: readonly string[];
}
export type PedidoGate = { tipo: "skill" | "mcp"; nome: unknown; snapshot: SnapshotPane | null };
export interface DecisaoGate {
  permitido: boolean;
  motivo?: string;
  /** nome saneado para evento/log */
  nome?: string;
}

const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9:._ -]{0,100}$/;
const PADRAO_MCP = /^mcp__([A-Za-z0-9_-]{1,64})__([A-Za-z0-9_.-]{1,128})$/;
const PREFIXO_LOJA = "ev_";

/** Texto saneado para entrar em motivo/evento: sem controle/bidi, truncado. */
export function sanearNomeDoGate(valor: unknown, max = 60): string {
  const t = typeof valor === "string" ? valor : "";
  // eslint-disable-next-line no-control-regex
  return t.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function listaCurta(l: readonly string[]): string {
  const v = l.slice(0, 12).join(", ");
  return l.length > 12 ? `${v} (+${l.length - 12})` : v;
}

export function decidirGate(p: PedidoGate): DecisaoGate {
  try {
    const s = p.snapshot;
    if (s === null) return { permitido: true };
    if (p.tipo === "skill") {
      if (s.skills === null) return { permitido: true };
      const bruto = typeof p.nome === "string" ? p.nome : "";
      const nome = sanearNomeDoGate(bruto);
      if (!ID_VALIDO.test(bruto) || normalizarNomeSkill(bruto) === "") return { permitido: false, motivo: "skill_not_allowed: nome de skill inválido.", nome };
      if (s.skills.includes(normalizarNomeSkill(bruto))) return { permitido: true, nome };
      return { permitido: false, motivo: `skill_not_allowed: ${nome}. Skills permitidas neste Pane: ${s.skills.length === 0 ? "nenhuma" : listaCurta(s.skills)}.`, nome };
    }
    const bruto = typeof p.nome === "string" ? p.nome : "";
    const m = PADRAO_MCP.exec(bruto);
    if (m === null) return { permitido: false, motivo: "mcp_not_allowed: nome de ferramenta MCP inválido.", nome: sanearNomeDoGate(bruto) };
    const servidor = m[1] as string;
    const nome = sanearNomeDoGate(servidor);
    if (servidor === PRODUTO.id) return { permitido: true, nome };
    if (servidor.startsWith(PREFIXO_LOJA)) return { permitido: true, nome }; // servidores da Loja: o gate `mcp__ev_*` da Loja decide (snapshot próprio)
    if (s.skills === null) return { permitido: true, nome }; // sem isolamento ativo
    if (s.mcp_do_usuario === "lista" && s.servidores_mcp.map(normalizarNomeSkill).includes(normalizarNomeSkill(servidor))) return { permitido: true, nome };
    return { permitido: false, motivo: `mcp_not_allowed: o servidor MCP "${nome}" não está liberado para este Pane.`, nome };
  } catch {
    return { permitido: false, motivo: "O gate de skills falhou: ação bloqueada." };
  }
}
