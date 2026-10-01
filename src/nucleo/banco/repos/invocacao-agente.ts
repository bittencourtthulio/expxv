import type { Banco } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";
import type { PerfilEfetivoMembro } from "../../../compartilhado/squads";
import { novoId } from "./comum";
import { jsonDe, lerJson } from "./json";

export const RECIBO_MAX = 240;

/** Cada `agent_invoke` / "abrir agente" (auditoria, paralelismo, custo). `mission_id` nulo = modo livre (CT-14.08). */
export interface InvocacaoAgente {
  id: string;
  mission_id: string | null;
  pane_id: string | null;
  agente_id: string;
  task_ref: string | null;
  /** perfil EFETIVO no instante do spawn. */
  perfil: Partial<PerfilEfetivoMembro>;
  prompt_hash: string;
  recibo: string | null;
  criado_em: string;
  encerrada_em: string | null;
}
export interface NovaInvocacaoAgente {
  mission_id?: string | null;
  pane_id?: string | null;
  agente_id: string;
  task_ref?: string | null;
  perfil: Partial<PerfilEfetivoMembro>;
  prompt_hash: string;
  recibo?: string | null;
}
interface Linha {
  id: string;
  mission_id: string | null;
  pane_id: string | null;
  agente_id: string;
  task_ref: string | null;
  perfil_json: string;
  prompt_hash: string;
  recibo: string | null;
  criado_em: string;
  encerrada_em: string | null;
}
const mapear = (l: Linha): InvocacaoAgente => ({
  id: l.id,
  mission_id: l.mission_id,
  pane_id: l.pane_id,
  agente_id: l.agente_id,
  task_ref: l.task_ref,
  perfil: lerJson<Partial<PerfilEfetivoMembro>>(l.perfil_json, {}),
  prompt_hash: l.prompt_hash,
  recibo: l.recibo,
  criado_em: l.criado_em,
  encerrada_em: l.encerrada_em,
});

export function criarRepoInvocacaoAgente(banco: Banco) {
  const obter = (id: string): InvocacaoAgente | undefined => {
    const l = banco.consultarUm<Linha>("SELECT * FROM invocacao_agente WHERE id = ?", [id]);
    return l ? mapear(l) : undefined;
  };
  const exigir = (id: string): InvocacaoAgente => {
    const i = obter(id);
    if (!i) throw new NaoEncontradoErro("InvocacaoAgente", id);
    return i;
  };
  return {
    obter,
    exigir,
    abrir(d: NovaInvocacaoAgente): InvocacaoAgente {
      if (d.agente_id.trim() === "" || d.agente_id.length > 80) throw new ValorInvalidoErro("agente_id", d.agente_id);
      if (d.prompt_hash.trim() === "") throw new ValorInvalidoErro("prompt_hash", d.prompt_hash);
      const recibo = d.recibo === undefined || d.recibo === null ? null : d.recibo.length > RECIBO_MAX ? `${d.recibo.slice(0, RECIBO_MAX - 1)}…` : d.recibo;
      const id = novoId("task", "inv");
      banco.executar(
        "INSERT INTO invocacao_agente (id,mission_id,pane_id,agente_id,task_ref,perfil_json,prompt_hash,recibo,criado_em,encerrada_em) VALUES (?,?,?,?,?,?,?,?,?,NULL)",
        [id, d.mission_id ?? null, d.pane_id ?? null, d.agente_id, d.task_ref ?? null, jsonDe("perfil", d.perfil), d.prompt_hash, recibo, agora()],
      );
      return exigir(id);
    },
    /** Marca a invocação como encerrada (idempotente: mantém o primeiro instante). */
    fechar(id: string, instante: string = agora()): InvocacaoAgente {
      exigir(id);
      banco.executar("UPDATE invocacao_agente SET encerrada_em = ? WHERE id = ? AND encerrada_em IS NULL", [instante, id]);
      return exigir(id);
    },
    /** `pane.closed`: fecha as invocações abertas do Pane. Devolve quantas fechou. */
    fecharPorPane(paneId: string, instante: string = agora()): number {
      return banco.executar("UPDATE invocacao_agente SET encerrada_em = ? WHERE pane_id = ? AND encerrada_em IS NULL", [instante, paneId]).alteracoes;
    },
    /** Invocações abertas da Missão (todas, ou de um agente): base de `limit_reached` por membro e por squad. */
    contarVivas(missionId: string, agenteId?: string): number {
      const l =
        agenteId === undefined
          ? banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM invocacao_agente WHERE mission_id = ? AND encerrada_em IS NULL", [missionId])
          : banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM invocacao_agente WHERE mission_id = ? AND agente_id = ? AND encerrada_em IS NULL", [missionId, agenteId]);
      return Number(l?.n ?? 0);
    },
    /** Vivas por agente em todo o app (`agentes:listar` → `vivos`); filtra por squad pelo prefixo `<squad>.`. */
    vivasPorAgente(squadSlug?: string): Record<string, number> {
      const linhas =
        squadSlug === undefined
          ? banco.consultar<{ agente_id: string; n: number }>("SELECT agente_id, COUNT(*) AS n FROM invocacao_agente WHERE encerrada_em IS NULL GROUP BY agente_id")
          : banco.consultar<{ agente_id: string; n: number }>(
              "SELECT agente_id, COUNT(*) AS n FROM invocacao_agente WHERE encerrada_em IS NULL AND substr(agente_id, 1, ?) = ? GROUP BY agente_id",
              [squadSlug.length + 1, `${squadSlug}.`],
            );
      return Object.fromEntries(linhas.map((l) => [l.agente_id, Number(l.n)]));
    },
    listarPorMissao(missionId: string): InvocacaoAgente[] {
      return banco.consultar<Linha>("SELECT * FROM invocacao_agente WHERE mission_id = ? ORDER BY criado_em, id", [missionId]).map(mapear);
    },
  };
}
export type RepoInvocacaoAgente = ReturnType<typeof criarRepoInvocacaoAgente>;
