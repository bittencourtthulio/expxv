// Canais `conhecimento:*`, `chat:*` e `rag:*` (Fase 15, onda 2): registro dos manipuladores atrás dos validadores estritos. O manipulador
// recebe o valor JÁ reconstruído pelo validador e nunca fala com o banco: só chama o serviço do main (`src/main/conhecimento.ts`), que
// por sua vez fala com o worker. Estes canais são AÇÃO HUMANA: a identidade de agente (token do MCP) não passa por aqui.
import type { CanaisInvoke, NomeInvoke } from "../../compartilhado/ipc";
import { VALIDADORES_CHAT, VALIDADORES_CONHECIMENTO, VALIDADORES_RAG } from "./conhecimento-validadores";
import type { RegistroIpc } from "./registro";
import type { Validador } from "./validar";

export { VALIDADORES_CHAT, VALIDADORES_CONHECIMENTO, VALIDADORES_RAG } from "./conhecimento-validadores";

/** Um manipulador por canal de uma família, recebendo exatamente a `entrada` do contrato. */
export type ManipuladoresDaFamilia<Prefixo extends string> = {
  [C in Extract<NomeInvoke, `${Prefixo}${string}`>]: (entrada: CanaisInvoke[C]["entrada"]) => CanaisInvoke[C]["saida"] | Promise<CanaisInvoke[C]["saida"]>;
};

export type ManipuladoresConhecimento = ManipuladoresDaFamilia<"conhecimento:">;
export type ManipuladoresChat = ManipuladoresDaFamilia<"chat:">;
export type ManipuladoresRag = ManipuladoresDaFamilia<"rag:">;

export interface DependenciasIpcConhecimento {
  registro: RegistroIpc;
  conhecimento?: ManipuladoresConhecimento;
  chat?: ManipuladoresChat;
  rag?: ManipuladoresRag;
}

function registrarFamilia(registro: RegistroIpc, validadores: Record<string, unknown>, manipuladores: Record<string, unknown>): void {
  for (const canal of Object.keys(validadores)) {
    const manip = manipuladores[canal] as ((entrada: never) => unknown) | undefined;
    if (manip === undefined) throw new Error(`canal ${canal} sem manipulador`);
    (registro.invoke as (c: string, v: Validador<unknown>, m: (e: unknown) => unknown) => void)(canal, validadores[canal] as Validador<unknown>, (entrada) => manip(entrada as never));
  }
}

export function registrarIpcConhecimento(d: DependenciasIpcConhecimento): void {
  if (d.conhecimento !== undefined) registrarFamilia(d.registro, VALIDADORES_CONHECIMENTO, d.conhecimento);
  if (d.chat !== undefined) registrarFamilia(d.registro, VALIDADORES_CHAT, d.chat);
  if (d.rag !== undefined) registrarFamilia(d.registro, VALIDADORES_RAG, d.rag);
}
