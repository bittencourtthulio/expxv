// Isolamento DURO no Claude Code (Fase 7, T-07.21): a partir da política resolvida produz (puro) o que o settings por Pane e o argv precisam:
// gate `pre-skill`/`pre-mcp` (hooks), `permissions.deny` (cinto e suspensório), `--strict-mcp-config` e `--plugin-dir` do plugin efêmero.
// Nunca toca `~/.claude` nem `.claude/` do projeto: tudo vive em `<dirApp>/panes/<pane_id>/`. Subagentes da CLI NÃO são bloqueados (limite conhecido).
import { join } from "node:path";
import type { PoliticaResolvida } from "../../../compartilhado/catalogo";
import { normalizarNomeSkill } from "../politica";

/** Teto de regras `deny` por Pane (o excedente fica só no gate). */
export const MAX_REGRAS_DENY = 500;

export interface EntradaIsolamentoClaude {
  politica: PoliticaResolvida;
  /** nomes de exibição das skills conhecidas do catálogo (de lá saem as regras `Skill(<nome>)`) */
  skillsConhecidas: readonly string[];
  /** nomes dos servidores MCP de USUÁRIO conhecidos (de lá saem as regras `mcp__<servidor>`) */
  servidoresUsuario: readonly string[];
  dirApp: string;
  pane_id: string;
  /** o plugin efêmero com as `ev-*` foi materializado (T-07.17) */
  temPluginEfemero: boolean;
}

export interface IsolamentoClaude {
  /** `false` = política sem filtro (livre): nada muda no settings */
  ativo: boolean;
  deny: string[];
  /** hooks `PreToolUse` para `Skill` e `mcp__.*` */
  gateSkill: boolean;
  gateMcpAmplo: boolean;
  /** argumentos extras do argv do Claude (`--strict-mcp-config`, `--plugin-dir <dir>`) */
  argumentos: string[];
  /** quantas regras ficaram só no gate por causa do teto */
  excedente: number;
}

const NOME_REGRA = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,80}$/;
const SERVIDOR_REGRA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function pastaDoPluginEfemero(dirApp: string, pane_id: string): string {
  return join(dirApp, "panes", pane_id, "plugin");
}

export function montarIsolamentoClaude(e: EntradaIsolamentoClaude): IsolamentoClaude {
  const p = e.politica;
  if (p.skills === null) return { ativo: false, deny: [], gateSkill: false, gateMcpAmplo: false, argumentos: [], excedente: 0 };
  const permitidas = new Set(p.skills);
  const regras: string[] = [];
  const vistos = new Set<string>();
  for (const nome of [...new Set(e.skillsConhecidas)].sort()) {
    if (!NOME_REGRA.test(nome) || permitidas.has(normalizarNomeSkill(nome)) || vistos.has(nome)) continue;
    vistos.add(nome);
    regras.push(`Skill(${nome})`);
  }
  if (p.mcp_do_usuario === "lista") {
    const liberados = new Set(p.servidores_mcp.map(normalizarNomeSkill));
    for (const s of [...new Set(e.servidoresUsuario)].sort()) {
      if (!SERVIDOR_REGRA.test(s) || liberados.has(normalizarNomeSkill(s))) continue;
      regras.push(`mcp__${s}`);
    }
  }
  const deny = regras.slice(0, MAX_REGRAS_DENY);
  const argumentos: string[] = [];
  // `nenhum`: só o MCP do app e os da Loja (do --mcp-config do Pane) entram; os do usuário (~/.claude.json, .mcp.json) ficam de fora
  if (p.mcp_do_usuario === "nenhum") argumentos.push("--strict-mcp-config");
  if (e.temPluginEfemero) argumentos.push("--plugin-dir", pastaDoPluginEfemero(e.dirApp, e.pane_id));
  return { ativo: true, deny, gateSkill: true, gateMcpAmplo: true, argumentos, excedente: regras.length - deny.length };
}
