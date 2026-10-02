// Lançamento de um servidor stdio da Loja pelo lançador `mcp-run` (Fase 7B, T-07B.21; D-132): o main resolve o comando EXATO
// (`montarComando` em modo execução, com os segredos do cofre) e o ambiente por ALLOWLIST; o lançador (sem dependências, roda
// fora do bundle) só faz `spawn` do que recebe. O segredo vive no ambiente/argv do processo do servidor real, nunca no Pane.

import { dirname } from "node:path";
import { montarAmbienteServidor } from "./ambiente";
import { montarComando, type ContextoComando } from "./comando";
import type { EntradaMcp } from "./esquema";
import type { ValoresDoServidor } from "./segredos";

export interface ComandoLancador {
  executavel: string;
  args: string[];
  /** Ambiente EXATO do servidor (allowlist + declaradas + fixas): o lançador não herda nada do seu próprio ambiente. */
  env: Record<string, string>;
  /** Pasta do servidor; `null` quando não há. */
  cwd: string | null;
}

export interface ContextoLancamento extends Pick<ContextoComando, "userData" | "workspace" | "plataforma" | "node" | "nodeEhElectron"> {
  /** Origem das variáveis básicas do sistema (padrão: o ambiente do processo). */
  origem?: NodeJS.ProcessEnv;
}

/** Lança se o servidor é remoto ou se falta variável exigida (o chamador traduz em 4xx). */
export function montarLancamento(e: EntradaMcp, valores: ValoresDoServidor, ctx: ContextoLancamento): ComandoLancador {
  const c = montarComando(e, {
    userData: ctx.userData, workspace: ctx.workspace, variaveis: valores.publicos, segredos: valores.secretos, modo: "execucao",
    ...(ctx.plataforma ? { plataforma: ctx.plataforma } : {}), ...(ctx.node ? { node: ctx.node } : {}), ...(ctx.nodeEhElectron !== undefined ? { nodeEhElectron: ctx.nodeEhElectron } : {}),
  });
  if (c.tipo === "remoto" || c.executavel === null) throw new Error("servidor remoto não passa pelo lançador");
  const amb = montarAmbienteServidor({
    declaradas: e.variaveis, valores: { ...valores.publicos, ...valores.secretos },
    pathExtra: [dirname(ctx.node ?? process.execPath)], ...(ctx.origem ? { origem: ctx.origem } : {}), ...(ctx.plataforma ? { plataforma: ctx.plataforma } : {}),
  });
  return { executavel: c.executavel, args: c.args, env: { ...amb.variaveis, ...c.env_fixas }, cwd: c.pasta };
}
