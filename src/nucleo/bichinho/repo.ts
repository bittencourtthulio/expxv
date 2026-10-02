// Persistência e leituras de contadores do Bichinho (D-465, D-670…). Só COUNT e SUM sobre índices existentes: nada de conteúdo.
import type { Banco } from "../banco/banco";
import type { EspecieId, EstagioId } from "../../compartilhado/bichinho";

export interface LinhaBichinho {
  workspace_id: string;
  especie: EspecieId;
  especie_manual: boolean;
  apelido: string | null;
  maturidade_max: number;
  estagio: EstagioId;
  atualizado_em: string;
  /** 0 = visual original; > 0 só quando as 100 espécies estavam em uso e esta se repetiu. */
  variante: number;
  /** contador MONOTÔNICO de tarefas concluídas (o ovo só nasce com a meta atingida). */
  tarefas_concluidas: number;
  /** espécie anterior, enquanto o aviso único da reatribuição ainda não foi dado. */
  reatribuido_de: EspecieId | null;
}

interface Linha { workspace_id: string; especie: EspecieId; especie_manual: number; apelido: string | null; maturidade_max: number; estagio: EstagioId; atualizado_em: string; variante: number; tarefas_concluidas: number; reatribuido_de: EspecieId | null }

const COLUNAS = "workspace_id, especie, especie_manual, apelido, maturidade_max, estagio, atualizado_em, variante, tarefas_concluidas, reatribuido_de";
const doBanco = (l: Linha): LinhaBichinho => ({ ...l, especie_manual: l.especie_manual === 1 });

/**
 * Ids distintos do trabalho CONCLUÍDO do workspace (D-671), sem contar duas vezes a mesma coisa:
 * tasks entregues/validadas de Missões do workspace; Missões concluídas (só as que não têm task entregue, que já contam pelas tasks);
 * pipelines do Maestro concluídos (contados pela Missão quando ligados a uma, senão pelo próprio id).
 */
const SQL_TAREFAS = `
SELECT 't:' || t.id AS k FROM task t JOIN mission m ON m.id = t.mission_id WHERE m.workspace_id = ?1 AND t.estado IN ('entregue','validada')
UNION
SELECT 'm:' || m.id FROM mission m WHERE m.workspace_id = ?1 AND m.estado = 'concluida'
  AND NOT EXISTS (SELECT 1 FROM task t WHERE t.mission_id = m.id AND t.estado IN ('entregue','validada'))
UNION
SELECT CASE WHEN p.mission_id IS NULL THEN 'p:' || p.id ELSE 'm:' || p.mission_id END FROM maestro_pipeline p WHERE p.workspace_id = ?1 AND p.estado = 'concluido'
  AND (p.mission_id IS NULL OR NOT EXISTS (SELECT 1 FROM task t WHERE t.mission_id = p.mission_id AND t.estado IN ('entregue','validada')))
`;

export function criarRepoBichinho(banco: Banco, agoraIso: () => string = () => new Date().toISOString()) {
  const ler = (ws: string): LinhaBichinho | undefined => {
    const l = banco.consultarUm<Linha>(`SELECT ${COLUNAS} FROM workspace_bichinho WHERE workspace_id = ?`, [ws]);
    return l === undefined ? undefined : doBanco(l);
  };
  return {
    obter: ler,
    /**
     * Cria ou atualiza. Garantias no SQL (não só no chamador): `maturidade_max` só sobe; o estágio nunca volta a "ovo" depois de chocar; o contador de tarefas só sobe.
     * `variante` e `reatribuido_de` só mudam quando informados (`undefined` mantém).
     */
    gravar(p: { workspace_id: string; especie: EspecieId; especie_manual: boolean; apelido: string | null; maturidade: number; estagio: EstagioId; variante?: number; tarefas_concluidas?: number; reatribuido_de?: EspecieId | null }): void {
      const mat = Math.max(0, Math.min(100, Math.round(p.maturidade)));
      banco.executar(
        `INSERT INTO workspace_bichinho (workspace_id, especie, especie_manual, apelido, maturidade_max, estagio, atualizado_em, variante, tarefas_concluidas, reatribuido_de) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET especie = excluded.especie, especie_manual = excluded.especie_manual, apelido = excluded.apelido,
           maturidade_max = MAX(workspace_bichinho.maturidade_max, excluded.maturidade_max),
           estagio = CASE WHEN workspace_bichinho.estagio != 'ovo' AND excluded.estagio = 'ovo' THEN workspace_bichinho.estagio
                          WHEN excluded.maturidade_max >= workspace_bichinho.maturidade_max OR (workspace_bichinho.estagio = 'ovo' AND excluded.estagio != 'ovo') THEN excluded.estagio
                          ELSE workspace_bichinho.estagio END,
           atualizado_em = excluded.atualizado_em,
           variante = CASE WHEN ?11 = 1 THEN excluded.variante ELSE workspace_bichinho.variante END,
           tarefas_concluidas = MAX(workspace_bichinho.tarefas_concluidas, excluded.tarefas_concluidas),
           reatribuido_de = CASE WHEN ?12 = 1 THEN excluded.reatribuido_de ELSE workspace_bichinho.reatribuido_de END`,
        [p.workspace_id, p.especie, p.especie_manual ? 1 : 0, p.apelido, mat, p.estagio, agoraIso(), Math.max(0, Math.min(3, Math.round(p.variante ?? 0))), Math.max(0, Math.round(p.tarefas_concluidas ?? 0)), p.reatribuido_de ?? null, p.variante === undefined ? 0 : 1, p.reatribuido_de === undefined ? 0 : 1],
      );
    },
    /** todas as linhas, da mais antiga atribuição para a mais nova (ordem do rowid): base de "quem usa cada espécie" e da correção dos repetidos. */
    todas(): Array<LinhaBichinho & { nome: string }> {
      return banco.consultar<Linha & { nome: string }>(`SELECT b.${COLUNAS.split(", ").join(", b.")}, w.nome AS nome FROM workspace_bichinho b JOIN workspace w ON w.id = b.workspace_id ORDER BY b.rowid`)
        .map((l) => ({ ...doBanco(l), nome: l.nome }));
    },
    /** o aviso único foi dado (ou a espécie mudou de novo): zera a marca. */
    limparAviso(ws: string): void {
      banco.executar("UPDATE workspace_bichinho SET reatribuido_de = NULL WHERE workspace_id = ?", [ws]);
    },
    /** tarefas concluídas distintas hoje (ver SQL_TAREFAS); o contador persistido é o máximo entre este número e o que já foi guardado. */
    tarefasConcluidas(ws: string): number {
      return Number(banco.consultarUm<{ n: number }>(`SELECT COUNT(*) AS n FROM (${SQL_TAREFAS})`, [ws])?.n ?? 0);
    },
    /** tokens in+out acumulados do workspace (soma persistida de `custo_agregado`, Fase 10; cache fora de propósito). */
    tokensTotais(ws: string): number {
      const l = banco.consultarUm<{ t: number | null }>("SELECT SUM(tokens_entrada + tokens_saida) AS t FROM custo_agregado WHERE escopo = 'workspace' AND chave = ?", [ws]);
      return Number(l?.t ?? 0);
    },
    /** entradas de memória ATIVAS do workspace (contagem pelo índice ix_mem_workspace_anel). */
    memoriaAtiva(ws: string): number {
      const l = banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM memoria_entrada WHERE workspace_id = ? AND estado = 'ativa'", [ws]);
      return Number(l?.n ?? 0);
    },
    /** nome e raiz do workspace (para desempate por hash e leitura dos arquivos-marca). */
    workspace(ws: string): { id: string; nome: string; raiz: string } | undefined {
      return banco.consultarUm<{ id: string; nome: string; raiz: string }>("SELECT id, nome, raiz FROM workspace WHERE id = ?", [ws]);
    },
  };
}

export type RepoBichinho = ReturnType<typeof criarRepoBichinho>;
