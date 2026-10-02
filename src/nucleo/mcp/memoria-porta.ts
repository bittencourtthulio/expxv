// Lado do MAIN da porta `PortaMemoria` (Fase 8): despacha cada tool `memory_*` para o serviço da memória com o `pane_id` do TOKEN e traduz
// `MemoriaErro` para o contrato externo (1:1; `limit_reached`/`rate_limited` viram `rule_violation` com subcode `limit_reached`).
// Nunca devolve stack nem mensagem de erro desconhecido (vira `unavailable`).
import { MemoriaErro } from "../memoria/tipos";
import { ErroMcp, violacaoDeRegra } from "./erros";
import type { NomeToolMemoria, PortaMemoria } from "./portas";

/** O que a porta usa do serviço da memória (o real cumpre; teste injeta um falso). */
export interface ServicoParaMcp {
  memory_write(paneId: unknown, args: unknown): unknown;
  memory_checkpoint(paneId: unknown, args: unknown): unknown;
  memory_search(paneId: unknown, args: unknown): Promise<unknown>;
  memory_brief(paneId: unknown, args: unknown): unknown;
  memory_forget(paneId: unknown, args: unknown): unknown;
  /** `mission_complete`: `true` quando não há o que avisar (inclusive memória desligada para a Missão). */
  missaoSemAviso(missionId: string): boolean;
}

export function erroMcpDeMemoria(erro: unknown): unknown {
  if (erro instanceof ErroMcp) return erro;
  if (erro instanceof MemoriaErro) {
    switch (erro.codigo) {
      case "memory_disabled":
      case "too_large":
      case "invalid_argument":
      case "unauthorized":
      case "not_found":
        return new ErroMcp(erro.codigo, erro.message);
      case "limit_reached":
      case "rate_limited":
        return violacaoDeRegra("limit_reached", erro.message);
    }
  }
  return erro; // o servidor converte o desconhecido em `unavailable` genérico
}

export function criarPortaMemoria(servico: ServicoParaMcp): PortaMemoria {
  return {
    async chamar(tool: NomeToolMemoria, paneId: string, args: Record<string, unknown>): Promise<unknown> {
      try {
        switch (tool) {
          case "memory_write":
            return servico.memory_write(paneId, args);
          case "memory_checkpoint":
            return servico.memory_checkpoint(paneId, args);
          case "memory_search":
            return await servico.memory_search(paneId, args);
          case "memory_brief":
            return servico.memory_brief(paneId, args);
          case "memory_forget":
            return servico.memory_forget(paneId, args);
        }
      } catch (erro) {
        throw erroMcpDeMemoria(erro);
      }
    },
    async temAprendizado(missionId: string): Promise<boolean> {
      return servico.missaoSemAviso(missionId);
    },
  };
}
