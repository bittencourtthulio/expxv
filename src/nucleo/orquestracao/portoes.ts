/**
 * Portões de intake da Missão (spec-02): o piloto só abre workers depois que a PESSOA libera o portão do
 * papel (`direction` → explorador, `build` → executor, `qa` → revisor). O estado vive em `config`
 * (`orquestracao.portoes.<mission_id>`), lido pela porta de Missões do MCP (somente leitura para o piloto).
 * Quem libera é o usuário, pelo canal de IPC; nunca por tool MCP. Sem dependência do servidor MCP.
 */
import type { EstadoPortoes, PortaoMissao } from "../../compartilhado/dominio";
import { PORTOES_MISSAO } from "../../compartilhado/dominio";
import type { Banco } from "../banco";
import type { RepoConfig } from "../banco/repos/config";
import type { Repositorios } from "../banco/repos";
import { registrarEventoDominio } from "../missoes/eventos";

export const chavePortoes = (mission_id: string): string => `orquestracao.portoes.${mission_id}`;

const TERMINAIS: readonly string[] = ["concluida", "falhou", "abortada"];

/** Portões liberados da Missão (ignora valores desconhecidos do banco). */
export function lerPortoes(config: Pick<RepoConfig, "obter">, mission_id: string): PortaoMissao[] {
  const v = config.obter<unknown>(chavePortoes(mission_id));
  return Array.isArray(v) ? PORTOES_MISSAO.filter((p) => v.includes(p)) : [];
}

/** Grava a liberação (idempotente). Devolve `true` se o portão acabou de ser liberado. */
export function gravarPortao(config: Pick<RepoConfig, "obter" | "definir">, mission_id: string, portao: PortaoMissao): boolean {
  const atuais = lerPortoes(config, mission_id);
  if (atuais.includes(portao)) return false;
  config.definir(chavePortoes(mission_id), PORTOES_MISSAO.filter((p) => p === portao || atuais.includes(p)));
  return true;
}

export function estadoDosPortoes(config: Pick<RepoConfig, "obter">, mission_id: string): EstadoPortoes {
  const liberados = lerPortoes(config, mission_id);
  return { mission_id, liberados, pendentes: PORTOES_MISSAO.filter((p) => !liberados.includes(p)) };
}

export interface ServicoPortoes {
  /** `null` se a Missão não existe */
  estado(mission_id: string): EstadoPortoes | null;
  /** Libera a pedido do USUÁRIO. `null` se a Missão não existe; erro se já terminou. Idempotente. */
  liberar(mission_id: string, portao: PortaoMissao): EstadoPortoes | null;
}

export interface DepsServicoPortoes {
  repos: Pick<Repositorios, "mission" | "config">;
  banco: Banco;
  /** avisa a UI (a camada acima coalesce) */
  aoMudar: (e: { workspace_id: string; mission_id: string }) => void;
}

export function criarServicoPortoes(d: DepsServicoPortoes): ServicoPortoes {
  return {
    estado(mission_id) {
      return d.repos.mission.obter(mission_id) === undefined ? null : estadoDosPortoes(d.repos.config, mission_id);
    },
    liberar(mission_id, portao) {
      const missao = d.repos.mission.obter(mission_id);
      if (missao === undefined) return null;
      if (TERMINAIS.includes(missao.estado)) {
        throw new Error("A Missão já foi encerrada: não há portão a liberar.");
      }
      if (gravarPortao(d.repos.config, mission_id, portao)) {
        // auditoria curta, sem segredos: quem decidiu, qual portão, em qual Missão
        registrarEventoDominio(d.banco, "mission.gate_released", { mission_id, workspace_id: missao.workspace_id, portao, por: "usuario" });
        d.aoMudar({ workspace_id: missao.workspace_id, mission_id });
      }
      return estadoDosPortoes(d.repos.config, mission_id);
    },
  };
}
