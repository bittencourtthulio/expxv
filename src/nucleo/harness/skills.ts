// Ponto de extensão das skills da política (Fase 9, T-09.16) RESOLVIDO pela Fase 7. PURO.
// Claude Code (isolamento DURO, D-44): em Missão `squad`/`agentico` a lista é IMPOSTA em código (gate `pre-skill` por hook + `permissions.deny`, inclusive em modo
// automático) => `enforced:true`. Demais CLIs (isolamento PARCIAL: texto + gate do MCP do app) e qualquer CLI em modo `livre`/desconhecido => `enforced:false`,
// e a frase diz honestamente que a restrição não é imposta. O nome da skill é DADO: só ids saneados entram na frase, nunca descrição nem corpo de skill.
import type { NivelIsolamento } from "../../compartilhado/catalogo";
import { NIVEL_POR_CLI } from "../catalogo/politica";
import { PRODUTO } from "../produto";

export interface ResultadoSkills {
  /** `true` só quando a CLI de fato limita as skills (Claude Code em Missão com isolamento ativo). */
  enforced: boolean;
  nivel: NivelIsolamento;
  /** frase para o prompt inicial; `null` se não há skills. */
  linha_no_prompt: string | null;
}

export interface OpcoesAplicarSkills {
  /** modo da Missão; sem ele (ou `livre`) a restrição não é imposta. */
  modo?: "livre" | "squad" | "agentico";
}

const ID_SKILL = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,80}$/;

export function aplicarSkills(cli: string, skills: readonly string[], opcoes: OpcoesAplicarSkills = {}): ResultadoSkills {
  const limpas = [...new Set(skills.filter((s) => ID_SKILL.test(s)))].slice(0, 12);
  const nivelDaCli: NivelIsolamento = (NIVEL_POR_CLI as Record<string, NivelIsolamento>)[cli] ?? "nenhum";
  const comIsolamento = opcoes.modo === "squad" || opcoes.modo === "agentico";
  const enforced = nivelDaCli === "duro" && comIsolamento;
  const nivel: NivelIsolamento = comIsolamento ? nivelDaCli : "nenhum";
  if (limpas.length === 0) return { enforced, nivel, linha_no_prompt: null };
  const lista = limpas.join(", ");
  const linha = enforced
    ? `Skills permitidas neste Pane (restrição imposta pelo ${PRODUTO.nome}): ${lista}.`
    : `Skills sugeridas pela política (sem restrição imposta nesta CLI): ${lista}.`;
  return { enforced, nivel, linha_no_prompt: linha };
}
