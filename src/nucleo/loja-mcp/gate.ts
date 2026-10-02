// Gate `pre-mcp` da Loja (Fase 7B, T-07B.22/.24): decide se uma tool `mcp__ev_<id>__*` pode rodar num Pane. Falha FECHADA:
// só passa o servidor que está no snapshot do Pane (política resolvida no lançamento: instalado, configurado, habilitado pela
// pessoa na UI e não bloqueado). Puro. "Permitido" aqui significa só "não negado pela Loja": o hook não força `allow`, então a
// aprovação normal da CLI continua valendo (a pessoa ainda confirma a chamada no terminal quando a CLI pede).

import { nomeNaCli, PREFIXO_NOME_CLI } from "./injecao";

export interface DecisaoGate {
  permitido: boolean;
  motivo: string | null;
}

/** `true` para o nome de tool que a Loja criou (`mcp__ev_…`). */
export function ehToolDaLoja(ferramenta: string): boolean {
  return ferramenta.startsWith(`mcp__${PREFIXO_NOME_CLI}`);
}

export function decidirToolLoja(ferramenta: unknown, permitidos: ReadonlySet<string> | null | undefined): DecisaoGate {
  if (typeof ferramenta !== "string" || !ehToolDaLoja(ferramenta)) return { permitido: true, motivo: null };
  if (permitidos === null || permitidos === undefined || permitidos.size === 0) {
    return { permitido: false, motivo: "Nenhum servidor da Loja de MCPs está habilitado para este Pane." };
  }
  for (const id of permitidos) {
    try {
      if (ferramenta.startsWith(`mcp__${nomeNaCli(id)}__`)) return { permitido: true, motivo: null };
    } catch {
      // id inválido no snapshot: nunca casa
    }
  }
  return { permitido: false, motivo: "Este servidor da Loja de MCPs não está habilitado para este Pane: habilite-o na Loja antes de usar." };
}
