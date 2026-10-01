import type { Banco } from "../banco";
import { agora } from "../tempo";
import { ValorInvalidoErro } from "../../dominio";
import {
  FAIXAS_MINIMAS_TROCA,
  MODOS_TROCA,
  PADROES_HARNESS,
  type ConfigHarness,
  type ConfigHarnessEntrada,
  type FaixaMinimaTroca,
  type ModoTroca,
} from "../../../compartilhado/harness";
import { bool, exigirEnum, int } from "./comum";
import { numeroEm } from "./json";

interface Linha {
  workspace_id: string;
  nivel: number;
  modo_troca: ModoTroca | null;
  limiar_troca_pct: number;
  limiar_esgotamento_pct: number;
  margem_troca_pontos: number;
  troca_entre_provedores: number;
  faixa_minima_troca: FaixaMinimaTroca;
  max_saltos: number;
  espera_ponto_seguro_s: number;
  piloto_edita_politica: number;
  injetar_cofre_no_env: number;
  atualizado_em: string;
}
const mapear = (l: Linha): ConfigHarness => ({
  workspace_id: l.workspace_id,
  nivel: l.nivel,
  modo_troca: l.modo_troca,
  limiar_troca_pct: l.limiar_troca_pct,
  limiar_esgotamento_pct: l.limiar_esgotamento_pct,
  margem_troca_pontos: l.margem_troca_pontos,
  troca_entre_provedores: bool(l.troca_entre_provedores),
  faixa_minima_troca: l.faixa_minima_troca,
  max_saltos: l.max_saltos,
  espera_ponto_seguro_s: l.espera_ponto_seguro_s,
  piloto_edita_politica: bool(l.piloto_edita_politica),
  injetar_cofre_no_env: bool(l.injetar_cofre_no_env),
  atualizado_em: l.atualizado_em,
});

/** Padrões do plano com os overrides P-28 (nível 4, 85/100, margem 10, troca entre provedores, até 3 saltos). */
export function configHarnessPadrao(workspaceId: string): ConfigHarnessEntrada {
  return { workspace_id: workspaceId, modo_troca: null, ...PADROES_HARNESS };
}

export function criarRepoHarnessWorkspace(banco: Banco) {
  return {
    /** Sem linha gravada, devolve os padrões (o `modo_troca: null` deriva de `workspace.permissao`). */
    obter(workspaceId: string): ConfigHarness {
      const l = banco.consultarUm<Linha>("SELECT * FROM harness_workspace WHERE workspace_id = ?", [workspaceId]);
      return l ? mapear(l) : { ...configHarnessPadrao(workspaceId), atualizado_em: "" };
    },
    existe(workspaceId: string): boolean {
      return banco.consultarUm("SELECT 1 AS x FROM harness_workspace WHERE workspace_id = ?", [workspaceId]) !== undefined;
    },
    gravar(c: ConfigHarnessEntrada): ConfigHarness {
      numeroEm("nivel", c.nivel, 1, 4);
      if (c.modo_troca !== null) exigirEnum("modo_troca", c.modo_troca, MODOS_TROCA);
      exigirEnum("faixa_minima_troca", c.faixa_minima_troca, FAIXAS_MINIMAS_TROCA);
      numeroEm("limiar_troca_pct", c.limiar_troca_pct, 50, 99);
      numeroEm("limiar_esgotamento_pct", c.limiar_esgotamento_pct, 51, 100);
      if (c.limiar_troca_pct >= c.limiar_esgotamento_pct) throw new ValorInvalidoErro("limiar_troca_pct", c.limiar_troca_pct);
      numeroEm("margem_troca_pontos", c.margem_troca_pontos, 0, 50);
      numeroEm("max_saltos", c.max_saltos, 1, 6);
      numeroEm("espera_ponto_seguro_s", c.espera_ponto_seguro_s, 30, 3600);
      banco.executar(
        `INSERT INTO harness_workspace (workspace_id,nivel,modo_troca,limiar_troca_pct,limiar_esgotamento_pct,margem_troca_pontos,troca_entre_provedores,faixa_minima_troca,max_saltos,espera_ponto_seguro_s,piloto_edita_politica,injetar_cofre_no_env,atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET nivel=excluded.nivel, modo_troca=excluded.modo_troca, limiar_troca_pct=excluded.limiar_troca_pct,
           limiar_esgotamento_pct=excluded.limiar_esgotamento_pct, margem_troca_pontos=excluded.margem_troca_pontos,
           troca_entre_provedores=excluded.troca_entre_provedores, faixa_minima_troca=excluded.faixa_minima_troca, max_saltos=excluded.max_saltos,
           espera_ponto_seguro_s=excluded.espera_ponto_seguro_s, piloto_edita_politica=excluded.piloto_edita_politica,
           injetar_cofre_no_env=excluded.injetar_cofre_no_env, atualizado_em=excluded.atualizado_em`,
        [
          c.workspace_id, c.nivel, c.modo_troca, c.limiar_troca_pct, c.limiar_esgotamento_pct, c.margem_troca_pontos, int(c.troca_entre_provedores),
          c.faixa_minima_troca, c.max_saltos, c.espera_ponto_seguro_s, int(c.piloto_edita_politica), int(c.injetar_cofre_no_env), agora(),
        ],
      );
      return this.obter(c.workspace_id);
    },
    /** Volta aos padrões (apaga a linha). */
    restaurar(workspaceId: string): void {
      banco.executar("DELETE FROM harness_workspace WHERE workspace_id = ?", [workspaceId]);
    },
  };
}
export type RepoHarnessWorkspace = ReturnType<typeof criarRepoHarnessWorkspace>;
