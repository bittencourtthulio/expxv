import type { Banco } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro } from "../../dominio";
import type { PerfilAgente } from "../../../compartilhado/harness";
import { jsonDe, lerJson } from "./json";

export interface PaneRota {
  pane_id: string;
  perfil: PerfilAgente;
  task_type: string | null;
  decisao_id: string | null;
  saltos: number;
  ultima_troca_em: string | null;
  ignorar_sugestao_ate: string | null;
  atualizado_em: string;
}
export interface NovaPaneRota {
  pane_id: string;
  perfil: PerfilAgente;
  task_type?: string | null;
  decisao_id?: string | null;
  saltos?: number;
}
interface Linha {
  pane_id: string;
  perfil_json: string;
  task_type: string | null;
  decisao_id: string | null;
  saltos: number;
  ultima_troca_em: string | null;
  ignorar_sugestao_ate: string | null;
  atualizado_em: string;
}
const mapear = (l: Linha): PaneRota => ({
  pane_id: l.pane_id,
  perfil: lerJson<PerfilAgente>(l.perfil_json, { agente_id: null, provider: "", cli: null, modelo: null, esforco: null, faixa: "medio" }),
  task_type: l.task_type,
  decisao_id: l.decisao_id,
  saltos: l.saltos,
  ultima_troca_em: l.ultima_troca_em,
  ignorar_sugestao_ate: l.ignorar_sugestao_ate,
  atualizado_em: l.atualizado_em,
});

/** Rota efetiva de um Pane (perfil, task_type, decisão, saltos). O Pane apagado leva a rota em cascata. */
export function criarRepoPaneRota(banco: Banco) {
  const obter = (paneId: string): PaneRota | undefined => {
    const l = banco.consultarUm<Linha>("SELECT * FROM pane_rota WHERE pane_id = ?", [paneId]);
    return l ? mapear(l) : undefined;
  };
  const exigir = (paneId: string): PaneRota => {
    const r = obter(paneId);
    if (!r) throw new NaoEncontradoErro("PaneRota", paneId);
    return r;
  };
  return {
    obter,
    exigir,
    /** Cria ou substitui a rota (mantém `ultima_troca_em` e `ignorar_sugestao_ate` já gravados). */
    gravar(d: NovaPaneRota): PaneRota {
      banco.executar(
        `INSERT INTO pane_rota (pane_id,perfil_json,task_type,decisao_id,saltos,atualizado_em) VALUES (?,?,?,?,?,?)
         ON CONFLICT(pane_id) DO UPDATE SET perfil_json=excluded.perfil_json, task_type=excluded.task_type, decisao_id=excluded.decisao_id, saltos=excluded.saltos, atualizado_em=excluded.atualizado_em`,
        [d.pane_id, jsonDe("perfil", d.perfil), d.task_type ?? null, d.decisao_id ?? null, d.saltos ?? 0, agora()],
      );
      return exigir(d.pane_id);
    },
    /** Registra uma troca: +1 salto e carimbo de hora (anti-vai-e-volta: ≥ 10 min entre trocas). */
    registrarTroca(paneId: string, instante: string = agora()): PaneRota {
      exigir(paneId);
      banco.executar("UPDATE pane_rota SET saltos = saltos + 1, ultima_troca_em = ?, atualizado_em = ? WHERE pane_id = ?", [instante, agora(), paneId]);
      return exigir(paneId);
    },
    /** "Ignorar 30 min": a sugestão não reaparece antes de `ate`. */
    ignorarSugestaoAte(paneId: string, ate: string | null): PaneRota {
      exigir(paneId);
      banco.executar("UPDATE pane_rota SET ignorar_sugestao_ate = ?, atualizado_em = ? WHERE pane_id = ?", [ate, agora(), paneId]);
      return exigir(paneId);
    },
    remover(paneId: string): void {
      banco.executar("DELETE FROM pane_rota WHERE pane_id = ?", [paneId]);
    },
  };
}
export type RepoPaneRota = ReturnType<typeof criarRepoPaneRota>;
