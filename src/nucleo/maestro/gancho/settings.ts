// T-16.28 · Fragmento de hooks do Claude para o Maestro (`UserPromptSubmit`) e a SOMA com outros fragmentos (o do RAG da Fase 15, a sinaleira…).
// Vive SÓ no settings POR Pane (`--settings <arquivo>` em diretório do app); nunca no global do usuário nem no do projeto. Só painéis livres do Claude:
// piloto, workers, Panes de etapa e Missões do Maestro NÃO recebem (`painelElegivel`). O script falha aberta com teto duro de 400 ms.
import type { ModoMissao, Papel } from "../../dominio";

export const EVENTO_GANCHO_MAESTRO = "maestro-prompt";
export const TIMEOUT_DO_HOOK_S = 1;
export type FragmentoDeHooks = Record<string, unknown[]>;

export interface OpcoesFragmentoMaestro {
  executavelNode: string;
  electronComoNode?: boolean;
  /** caminho absoluto do `maestro-prompt.mjs` */
  script: string;
  variavelUrl: string;
  variavelToken: string;
}
const aspas = (v: string): string => `"${v.replace(/(["\\$`])/g, "\\$1")}"`;

/**
 * O Pane pode ter o hook? Painel LIVRE do Claude: sem Missão (`mission_modo: null`) ou numa Missão de modo `livre` (onde o Pane é `executor`
 * avulso); nunca o piloto; não aberto pelo Maestro. Squads/agêntico (workers, terminais avulsos) e Panes de etapa do Maestro nunca (as respostas
 * da entrevista do método não podem ser interceptadas).
 */
export function painelElegivel(p: { cli: string; papel: Papel; mission_modo: ModoMissao | null; pane_do_maestro: boolean }): boolean {
  return p.cli === "claude" && p.papel !== "piloto" && (p.mission_modo === null || p.mission_modo === "livre") && !p.pane_do_maestro;
}

export function fragmentoDeHooksDoMaestro(o: OpcoesFragmentoMaestro): FragmentoDeHooks {
  const prefixo = o.electronComoNode === true ? "ELECTRON_RUN_AS_NODE=1 " : "";
  const comando = `${prefixo}${aspas(o.executavelNode)} ${aspas(o.script)} ${o.variavelUrl} ${o.variavelToken}`;
  return { UserPromptSubmit: [{ hooks: [{ type: "command", command: comando, timeout: TIMEOUT_DO_HOOK_S }] }] };
}

/** Soma fragmentos (por evento, na ordem recebida: o do Maestro roda antes do RAG quando vem primeiro). Não muta a entrada. */
export function juntarHooksDoClaude(...fragmentos: ReadonlyArray<FragmentoDeHooks | null | undefined>): FragmentoDeHooks {
  const saida: FragmentoDeHooks = {};
  for (const f of fragmentos) {
    if (f === null || f === undefined) continue;
    for (const [evento, lista] of Object.entries(f)) saida[evento] = [...(saida[evento] ?? []), ...lista];
  }
  return saida;
}
