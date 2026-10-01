import type { Banco } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";
import { PORTOES_MISSAO, type PortaoMissao } from "../../../compartilhado/dominio";
import { bool, int } from "./comum";
import { jsonDe, lerJson } from "./json";

/** Snapshot de auditoria da squad no momento da Missão (D-211: a squad editada depois NÃO muda o hash daqui). */
export interface MissionSquad {
  mission_id: string;
  squad_slug: string;
  /** sha256 do `squad.json` + dos `.md` (64 hex). */
  squad_hash: string;
  portoes_pendentes: PortaoMissao[];
  nivel_rigidez: number | null;
  plano_antes: boolean;
  criado_em: string;
}
export interface NovaMissionSquad {
  mission_id: string;
  squad_slug: string;
  squad_hash: string;
  portoes_pendentes?: readonly PortaoMissao[];
  nivel_rigidez?: number | null;
  plano_antes?: boolean;
}
interface Linha {
  mission_id: string;
  squad_slug: string;
  squad_hash: string;
  portoes_pendentes_json: string;
  nivel_rigidez: number | null;
  plano_antes: number;
  criado_em: string;
}
const mapear = (l: Linha): MissionSquad => ({
  mission_id: l.mission_id,
  squad_slug: l.squad_slug,
  squad_hash: l.squad_hash,
  portoes_pendentes: lerJson<PortaoMissao[]>(l.portoes_pendentes_json, []),
  nivel_rigidez: l.nivel_rigidez,
  plano_antes: bool(l.plano_antes),
  criado_em: l.criado_em,
});

const ESTADOS_TERMINAIS = "('concluida','falhou','abortada')";

/** Vínculo squad↔Missão. Grava também `mission.squad_id` na mesma transação (a Missão sem squad não muda). */
export function criarRepoMissionSquad(banco: Banco) {
  const obter = (missionId: string): MissionSquad | undefined => {
    const l = banco.consultarUm<Linha>("SELECT * FROM mission_squad WHERE mission_id = ?", [missionId]);
    return l ? mapear(l) : undefined;
  };
  return {
    obter,
    exigir(missionId: string): MissionSquad {
      const m = obter(missionId);
      if (!m) throw new NaoEncontradoErro("MissionSquad", missionId);
      return m;
    },
    gravar(d: NovaMissionSquad): MissionSquad {
      if (!/^[0-9a-f]{64}$/.test(d.squad_hash)) throw new ValorInvalidoErro("squad_hash", d.squad_hash);
      if (d.squad_slug.trim() === "") throw new ValorInvalidoErro("squad_slug", d.squad_slug);
      const pend = [...(d.portoes_pendentes ?? [])];
      for (const p of pend) if (!(PORTOES_MISSAO as readonly string[]).includes(p)) throw new ValorInvalidoErro("portoes_pendentes", p);
      const nivel = d.nivel_rigidez ?? null;
      if (nivel !== null && (!Number.isInteger(nivel) || nivel < 1 || nivel > 5)) throw new ValorInvalidoErro("nivel_rigidez", nivel);
      return banco.transacao((tx) => {
        if (!tx.consultarUm("SELECT 1 AS x FROM mission WHERE id = ?", [d.mission_id])) throw new NaoEncontradoErro("Mission", d.mission_id);
        const ts = agora();
        tx.executar(
          `INSERT INTO mission_squad (mission_id,squad_slug,squad_hash,portoes_pendentes_json,nivel_rigidez,plano_antes,criado_em) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(mission_id) DO UPDATE SET squad_slug=excluded.squad_slug, squad_hash=excluded.squad_hash, portoes_pendentes_json=excluded.portoes_pendentes_json, nivel_rigidez=excluded.nivel_rigidez, plano_antes=excluded.plano_antes`,
          [d.mission_id, d.squad_slug, d.squad_hash, jsonDe("portoes_pendentes", pend), nivel, int(d.plano_antes ?? true), ts],
        );
        tx.executar("UPDATE mission SET squad_id = ?, atualizado_em = ? WHERE id = ?", [d.squad_slug, ts, d.mission_id]);
        return mapear(tx.consultarUm<Linha>("SELECT * FROM mission_squad WHERE mission_id = ?", [d.mission_id]) as Linha);
      });
    },
    /** A squad está em uso por alguma Missão ainda ativa? (bloqueia apagar; "squad fechado não some"). */
    emUso(squadSlug: string): boolean {
      return banco.consultarUm(`SELECT 1 AS x FROM mission WHERE squad_id = ? AND estado NOT IN ${ESTADOS_TERMINAIS} LIMIT 1`, [squadSlug]) !== undefined;
    },
    /** Slugs das squads com Missão ativa (uma consulta para a lista inteira). */
    slugsEmUso(): string[] {
      return banco
        .consultar<{ squad_id: string }>(`SELECT DISTINCT squad_id FROM mission WHERE squad_id IS NOT NULL AND estado NOT IN ${ESTADOS_TERMINAIS} ORDER BY squad_id`)
        .map((l) => l.squad_id);
    },
  };
}
export type RepoMissionSquad = ReturnType<typeof criarRepoMissionSquad>;
