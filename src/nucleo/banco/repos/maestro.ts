// Repositório do Maestro (Fase 16, T-16.02). Implementa a `PortaPersistencia` do serviço sobre SQLite (síncrono por baixo; a porta é assíncrona).
// `PipelineEstado` é serializável e sem o texto do pedido: o plano vai em `plano_json`; as execuções, uma linha por tentativa (reescritas em bloco
// numa transação, no máximo ~20 linhas por pipeline). Campos além do SQL do plano (tipo, piso, reduz, reforço, agrupa, avaliações, confirmada,
// pane_fechado) ficam em `extra_json`. Também guarda a configuração por etapa, o nível de rigidez por escopo e a auditoria de mudança de nível.
import type { Banco, Valor } from "../banco";
import { agora } from "../tempo";
import { ValorInvalidoErro } from "../../dominio";
import type { EtapaConfig, EtapaExec, EstadoPipeline, NivelRigidez, PipelineEstado, ReciboMaestro } from "../../../compartilhado/maestro";
import { ESTADOS_PIPELINE_TERMINAIS, MODOS_EXECUCAO } from "../../../compartilhado/maestro";
import { FAIXAS } from "../../../compartilhado/harness";
import { resumirParaDecisor } from "../../harness/decisor/resumo";
import { novoId } from "./comum";
import { jsonDe, lerJson } from "./json";

export const RETENCAO_RECIBO_DIAS = 90;
export const RETENCAO_RIGIDEZ_LOG_DIAS = 365;
const LOTE_PURGA = 500;
const TERMINAIS_SQL = ESTADOS_PIPELINE_TERMINAIS.map((e) => `'${e}'`).join(",");

interface LinhaPipeline {
  id: string;
  workspace_id: string;
  mission_id: string | null;
  trabalho_id: string | null;
  pipeline_id: string;
  intencao: string;
  estado: EstadoPipeline;
  via: string;
  origem_pane_id: string | null;
  texto_hash: string;
  texto_resumo: string;
  nivel_base: number;
  nivel_atual: number;
  nivel_pedido: number | null;
  executar_direto: number;
  voltar_ao_padrao: number;
  override_trava: number;
  plano_json: string;
  motivo_fim: string | null;
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
}
interface LinhaExec {
  etapa_id: string;
  ordem: number;
  tentativa: number;
  rodada: number;
  estado: string;
  pane_id: string | null;
  perfil_json: string | null;
  nivel: number;
  comando: string | null;
  reutilizou_pane: number;
  detectada_por: string | null;
  inicio_em: string | null;
  fim_em: string | null;
  detalhe: string | null;
  extra_json: string;
}
interface ExtraExec {
  tipo: EtapaExec["tipo"];
  piso: boolean;
  reduz: boolean;
  reforco: string | null;
  agrupa_com_anterior: boolean;
  avaliacoes: number;
  confirmada: boolean;
  pane_fechado?: boolean;
}
interface LinhaRecibo {
  id: string;
  criado_em: string;
  pipeline_id: string | null;
  intencao: string;
  confianca: number;
  fonte: string;
  decididor_json: string;
  escolha_regra: string | null;
  escolha_decisor: string | null;
  divergiu: number;
  nivel: number;
  texto: string;
}
const COLUNAS_RECIBO = "id,criado_em,pipeline_id,intencao,confianca,fonte,decididor_json,escolha_regra,escolha_decisor,divergiu,nivel,texto";
const DECIDIDOR_PADRAO: ReciboMaestro["decididor"] = { tipo: "regra", modelo: null, endpoint_host: null, latencia_ms: null, custo_usd: null };

export interface DadosGravarRecibo {
  workspace_id: string;
  via: string;
  sinais: readonly string[];
  resumo_enviado: string | null;
  resumo_hash: string | null;
  criado_em: string;
}
export interface EntradaRigidezLog {
  id?: string;
  ts: string;
  workspace_id: string;
  mission_id?: string | null;
  pipeline_id: string | null;
  etapa_atual: string | null;
  escopo: "workspace" | "missao" | "pedido";
  de: number | null;
  para: number;
  por: "usuario" | "sistema";
  trava: "raio_alto" | "branch_protegida" | "producao" | null;
  justificativa: string | null;
  hooks_escritos: boolean;
  arquivo_hooks?: string | null;
}
export interface LinhaConfigEtapa {
  config: EtapaConfig;
  workspace_id: string | null;
}
export interface RigidezGravada {
  nivel: NivelRigidez;
  voltar_ao_padrao: boolean;
}

/** O comando é só informativo (o que o ADE digitou): o argumento pode carregar o texto do pedido, então vai REDIGIDO e curto (D-25: sem segredo no banco). */
export const COMANDO_MAX = 300;
const comandoRedigido = (c: string): string => resumirParaDecisor(c, { max: COMANDO_MAX });

const execDe = (l: LinhaExec): EtapaExec => {
  const x = lerJson<Partial<ExtraExec>>(l.extra_json, {});
  return {
    etapa_id: l.etapa_id as EtapaExec["etapa_id"],
    ordem: l.ordem,
    tentativa: l.tentativa,
    rodada: l.rodada,
    estado: l.estado as EtapaExec["estado"],
    pane_id: l.pane_id,
    perfil: lerJson<EtapaExec["perfil"]>(l.perfil_json, null),
    nivel: l.nivel as NivelRigidez,
    comando: l.comando,
    reutilizou_pane: l.reutilizou_pane === 1,
    detectada_por: l.detectada_por as EtapaExec["detectada_por"],
    inicio_em: l.inicio_em,
    fim_em: l.fim_em,
    detalhe: l.detalhe,
    tipo: x.tipo ?? "utilitario",
    piso: x.piso ?? false,
    reduz: x.reduz ?? false,
    reforco: x.reforco ?? null,
    agrupa_com_anterior: x.agrupa_com_anterior ?? false,
    avaliacoes: x.avaliacoes ?? 1,
    confirmada: x.confirmada ?? false,
    ...(x.pane_fechado === undefined ? {} : { pane_fechado: x.pane_fechado }),
  };
};

export function criarRepoMaestro(banco: Banco) {
  const execsDe = (pipelineId: string): EtapaExec[] =>
    banco.consultar<LinhaExec>("SELECT * FROM maestro_etapa_exec WHERE pipeline_id = ? ORDER BY ordem, tentativa, rodada, rowid", [pipelineId]).map(execDe);
  const pipelineDe = (l: LinhaPipeline): PipelineEstado => ({
    id: l.id,
    workspace_id: l.workspace_id,
    mission_id: l.mission_id,
    trabalho_id: l.trabalho_id,
    pipeline_id: l.pipeline_id as PipelineEstado["pipeline_id"],
    intencao: l.intencao as PipelineEstado["intencao"],
    estado: l.estado,
    via: l.via as PipelineEstado["via"],
    origem_pane_id: l.origem_pane_id,
    texto_hash: l.texto_hash,
    texto_resumo: l.texto_resumo,
    nivel_base: l.nivel_base as NivelRigidez,
    nivel_atual: l.nivel_atual as NivelRigidez,
    nivel_pedido: (l.nivel_pedido ?? null) as NivelRigidez | null,
    executar_direto: l.executar_direto === 1,
    voltar_ao_padrao: l.voltar_ao_padrao === 1,
    override_trava: l.override_trava === 1,
    plano: lerJson<PipelineEstado["plano"]>(l.plano_json, null as never),
    execs: execsDe(l.id),
    motivo_fim: l.motivo_fim,
    criado_em: l.criado_em,
    atualizado_em: l.atualizado_em,
    concluido_em: l.concluido_em,
  });
  const reciboDe = (l: LinhaRecibo): ReciboMaestro => ({
    id: l.id,
    pipeline_id: l.pipeline_id,
    intencao: l.intencao as ReciboMaestro["intencao"],
    confianca: l.confianca,
    fonte: l.fonte as ReciboMaestro["fonte"],
    decididor: lerJson<ReciboMaestro["decididor"]>(l.decididor_json, DECIDIDOR_PADRAO),
    escolha_regra: (l.escolha_regra ?? null) as ReciboMaestro["escolha_regra"],
    escolha_decisor: (l.escolha_decisor ?? null) as ReciboMaestro["escolha_decisor"],
    divergiu: l.divergiu === 1,
    nivel: l.nivel as NivelRigidez,
    texto: l.texto,
  });

  const salvarPipeline = (p: PipelineEstado): void => {
    if (p.plano === undefined || p.plano === null) throw new ValorInvalidoErro("plano", "ausente");
    banco.transacao((b) => {
      b.executar(
        `INSERT INTO maestro_pipeline (id,workspace_id,mission_id,trabalho_id,pipeline_id,intencao,estado,via,origem_pane_id,texto_hash,texto_resumo,nivel_base,nivel_atual,nivel_pedido,executar_direto,voltar_ao_padrao,override_trava,plano_json,motivo_fim,criado_em,atualizado_em,concluido_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET mission_id=excluded.mission_id, trabalho_id=excluded.trabalho_id, pipeline_id=excluded.pipeline_id, intencao=excluded.intencao, estado=excluded.estado,
           nivel_base=excluded.nivel_base, nivel_atual=excluded.nivel_atual, nivel_pedido=excluded.nivel_pedido, executar_direto=excluded.executar_direto, voltar_ao_padrao=excluded.voltar_ao_padrao,
           override_trava=excluded.override_trava, plano_json=excluded.plano_json, motivo_fim=excluded.motivo_fim, atualizado_em=excluded.atualizado_em, concluido_em=excluded.concluido_em`,
        [
          p.id, p.workspace_id, p.mission_id, p.trabalho_id, p.pipeline_id, p.intencao, p.estado, p.via, p.origem_pane_id, p.texto_hash, p.texto_resumo.slice(0, 400), p.nivel_base, p.nivel_atual, p.nivel_pedido,
          p.executar_direto ? 1 : 0, p.voltar_ao_padrao ? 1 : 0, p.override_trava ? 1 : 0, jsonDe("plano", p.plano), p.motivo_fim, p.criado_em, p.atualizado_em, p.concluido_em,
        ] as Valor[],
      );
      b.executar("DELETE FROM maestro_etapa_exec WHERE pipeline_id = ?", [p.id]);
      for (const e of p.execs) {
        const extra: ExtraExec = { tipo: e.tipo, piso: e.piso, reduz: e.reduz, reforco: e.reforco, agrupa_com_anterior: e.agrupa_com_anterior, avaliacoes: e.avaliacoes, confirmada: e.confirmada, ...(e.pane_fechado === undefined ? {} : { pane_fechado: e.pane_fechado }) };
        b.executar(
          `INSERT INTO maestro_etapa_exec (id,pipeline_id,etapa_id,ordem,tentativa,rodada,estado,pane_id,perfil_json,nivel,comando,reutilizou_pane,detectada_por,inicio_em,fim_em,detalhe,extra_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [novoId("task", "mex"), p.id, e.etapa_id, e.ordem, e.tentativa, e.rodada, e.estado, e.pane_id, e.perfil === null ? null : jsonDe("perfil", e.perfil), e.nivel, e.comando === null ? null : comandoRedigido(e.comando), e.reutilizou_pane ? 1 : 0, e.detectada_por, e.inicio_em, e.fim_em, e.detalhe, jsonDe("extra", extra)] as Valor[],
        );
      }
    });
  };

  return {
    // ---------------------------------------------------------------- pipelines
    salvarPipeline,
    carregarPipeline(id: string): PipelineEstado | null {
      const l = banco.consultarUm<LinhaPipeline>("SELECT * FROM maestro_pipeline WHERE id = ?", [id]);
      return l === undefined ? null : pipelineDe(l);
    },
    listarAtivos(workspaceId: string | null): PipelineEstado[] {
      const sql = `SELECT * FROM maestro_pipeline WHERE estado NOT IN (${TERMINAIS_SQL})${workspaceId === null ? "" : " AND workspace_id = ?"} ORDER BY criado_em`;
      return banco.consultar<LinhaPipeline>(sql, workspaceId === null ? [] : [workspaceId]).map(pipelineDe);
    },
    listarPipelines(workspaceId: string, soAtivos: boolean, limite: number): PipelineEstado[] {
      const lim = Math.min(Math.max(Math.trunc(limite), 1), 100);
      const filtro = soAtivos ? ` AND estado NOT IN (${TERMINAIS_SQL})` : "";
      return banco.consultar<LinhaPipeline>(`SELECT * FROM maestro_pipeline WHERE workspace_id = ?${filtro} ORDER BY criado_em DESC, id DESC LIMIT ?`, [workspaceId, lim]).map(pipelineDe);
    },
    // ---------------------------------------------------------------- recibos
    salvarRecibo(r: ReciboMaestro, d: DadosGravarRecibo): void {
      banco.executar(
        `INSERT OR REPLACE INTO maestro_recibo (id,criado_em,pipeline_id,workspace_id,via,intencao,confianca,fonte,decididor_json,escolha_regra,escolha_decisor,divergiu,nivel,sinais_json,resumo_hash,resumo_enviado,texto)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.id, d.criado_em, r.pipeline_id, d.workspace_id, d.via, r.intencao, r.confianca, r.fonte, jsonDe("decididor", r.decididor), r.escolha_regra, r.escolha_decisor, r.divergiu ? 1 : 0, r.nivel, jsonDe("sinais", [...d.sinais]), d.resumo_hash, d.resumo_enviado === null ? null : d.resumo_enviado.slice(0, 500), r.texto] as Valor[],
      );
    },
    lerRecibo(pipelineId: string): ReciboMaestro | null {
      const l = banco.consultarUm<LinhaRecibo>(`SELECT ${COLUNAS_RECIBO} FROM maestro_recibo WHERE pipeline_id = ? ORDER BY criado_em DESC LIMIT 1`, [pipelineId]);
      return l === undefined ? null : reciboDe(l);
    },
    listarRecibos(workspaceId: string, limite: number): ReciboMaestro[] {
      const lim = Math.min(Math.max(Math.trunc(limite), 1), 200);
      return banco.consultar<LinhaRecibo>(`SELECT ${COLUNAS_RECIBO} FROM maestro_recibo WHERE workspace_id = ? ORDER BY criado_em DESC, id DESC LIMIT ?`, [workspaceId, lim]).map(reciboDe);
    },
    // ---------------------------------------------------------------- configuração por etapa (global = workspace NULL)
    listarConfig(workspaceId: string | null): LinhaConfigEtapa[] {
      const linhas = banco.consultar<{ workspace_id: string | null; etapa_id: string; agente_id: string | null; cli: string | null; modelo: string | null; esforco: string | null; faixa: string | null; origem_modelo: string; skills_json: string; modo_execucao: string; atualizado_por: string }>(
        workspaceId === null ? "SELECT * FROM maestro_etapa_config WHERE workspace_id IS NULL" : "SELECT * FROM maestro_etapa_config WHERE workspace_id = ?",
        workspaceId === null ? [] : [workspaceId],
      );
      return linhas.map((l) => ({
        workspace_id: l.workspace_id,
        config: {
          etapa_id: l.etapa_id,
          perfil: { cli: l.cli ?? "claude", modelo: l.modelo, esforco: l.esforco, faixa: (l.faixa ?? "alto") as EtapaConfig["perfil"]["faixa"], origem_modelo: l.origem_modelo as "cli" | "openrouter", agente_id: l.agente_id },
          skills: lerJson<string[]>(l.skills_json, []),
          modo_execucao: l.modo_execucao as EtapaConfig["modo_execucao"],
          atualizado_por: l.atualizado_por as EtapaConfig["atualizado_por"],
        },
      }));
    },
    gravarConfig(workspaceId: string | null, c: EtapaConfig): void {
      if (!(MODOS_EXECUCAO as readonly string[]).includes(c.modo_execucao)) throw new ValorInvalidoErro("modo_execucao", c.modo_execucao);
      if (!(FAIXAS as readonly string[]).includes(c.perfil.faixa)) throw new ValorInvalidoErro("faixa", c.perfil.faixa);
      const t = agora();
      const existente = banco.consultarUm<{ id: string }>("SELECT id FROM maestro_etapa_config WHERE COALESCE(workspace_id,'') = ? AND etapa_id = ?", [workspaceId ?? "", c.etapa_id]);
      const valores: Valor[] = [c.perfil.agente_id, c.perfil.cli, c.perfil.modelo, c.perfil.esforco, c.perfil.faixa, c.perfil.origem_modelo, jsonDe("skills", c.skills), c.modo_execucao, c.atualizado_por];
      if (existente === undefined) {
        banco.executar(
          "INSERT INTO maestro_etapa_config (id,workspace_id,etapa_id,agente_id,cli,modelo,esforco,faixa,origem_modelo,skills_json,modo_execucao,atualizado_por,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [novoId("task", "mcf"), workspaceId, c.etapa_id, ...valores, t, t] as Valor[],
        );
      } else {
        banco.executar("UPDATE maestro_etapa_config SET agente_id=?,cli=?,modelo=?,esforco=?,faixa=?,origem_modelo=?,skills_json=?,modo_execucao=?,atualizado_por=?,atualizado_em=? WHERE id=?", [...valores, t, existente.id] as Valor[]);
      }
    },
    /** Apaga os overrides (volta à fábrica). `etapaId = null` apaga todos do escopo. */
    restaurarConfig(workspaceId: string | null, etapaId: string | null): number {
      const filtro = etapaId === null ? "" : " AND etapa_id = ?";
      const p: Valor[] = [workspaceId ?? "", ...(etapaId === null ? [] : [etapaId])];
      return banco.executar(`DELETE FROM maestro_etapa_config WHERE COALESCE(workspace_id,'') = ?${filtro}`, p).alteracoes;
    },
    // ---------------------------------------------------------------- rigidez por escopo + auditoria
    lerRigidez(escopo: "workspace" | "missao", alvoId: string): RigidezGravada | null {
      const l = banco.consultarUm<{ nivel: number; voltar_ao_padrao: number }>("SELECT nivel, voltar_ao_padrao FROM maestro_rigidez WHERE escopo = ? AND alvo_id = ?", [escopo, alvoId]);
      return l === undefined ? null : { nivel: l.nivel as NivelRigidez, voltar_ao_padrao: l.voltar_ao_padrao === 1 };
    },
    gravarRigidez(escopo: "workspace" | "missao", alvoId: string, nivel: NivelRigidez, voltarAoPadrao = false): void {
      if (!Number.isInteger(nivel) || nivel < 1 || nivel > 5) throw new ValorInvalidoErro("nivel", nivel);
      banco.executar(
        "INSERT INTO maestro_rigidez (escopo,alvo_id,nivel,voltar_ao_padrao,atualizado_em) VALUES (?,?,?,?,?) ON CONFLICT(escopo,alvo_id) DO UPDATE SET nivel=excluded.nivel, voltar_ao_padrao=excluded.voltar_ao_padrao, atualizado_em=excluded.atualizado_em",
        [escopo, alvoId, nivel, voltarAoPadrao ? 1 : 0, agora()],
      );
    },
    removerRigidez(escopo: "workspace" | "missao", alvoId: string): void {
      banco.executar("DELETE FROM maestro_rigidez WHERE escopo = ? AND alvo_id = ?", [escopo, alvoId]);
    },
    registrarRigidezLog(e: EntradaRigidezLog): string {
      const id = e.id ?? novoId("task", "mrg");
      banco.executar(
        "INSERT INTO maestro_rigidez_log (id,ts,workspace_id,mission_id,pipeline_id,etapa_atual,escopo,de,para,por,trava,justificativa,hooks_escritos,arquivo_hooks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, e.ts, e.workspace_id, e.mission_id ?? null, e.pipeline_id, e.etapa_atual, e.escopo, e.de, e.para, e.por, e.trava, e.justificativa, e.hooks_escritos ? 1 : 0, e.arquivo_hooks ?? null] as Valor[],
      );
      return id;
    },
    listarRigidezLog(workspaceId: string, limite: number): EntradaRigidezLog[] {
      const lim = Math.min(Math.max(Math.trunc(limite), 1), 200);
      return banco
        .consultar<Omit<EntradaRigidezLog, "hooks_escritos"> & { hooks_escritos: number }>("SELECT * FROM maestro_rigidez_log WHERE workspace_id = ? ORDER BY ts DESC, id DESC LIMIT ?", [workspaceId, lim])
        .map((l) => ({ ...l, hooks_escritos: l.hooks_escritos === 1 }));
    },
    // ---------------------------------------------------------------- retenção (job em ocioso, em lotes; nunca bloqueia o main)
    /** Apaga um LOTE de linhas vencidas e devolve quantas apagou (chame de novo enquanto > 0). Execs só de pipelines terminais. */
    purgarLote(agoraMs: number): number {
      const corte = (dias: number): string => new Date(agoraMs - dias * 86_400_000).toISOString();
      let n = 0;
      n += banco.executar(`DELETE FROM maestro_recibo WHERE id IN (SELECT id FROM maestro_recibo WHERE criado_em < ? LIMIT ${LOTE_PURGA})`, [corte(RETENCAO_RECIBO_DIAS)]).alteracoes;
      n += banco.executar(
        `DELETE FROM maestro_etapa_exec WHERE id IN (SELECT e.id FROM maestro_etapa_exec e JOIN maestro_pipeline p ON p.id = e.pipeline_id WHERE e.fim_em IS NOT NULL AND e.fim_em < ? AND p.estado IN (${TERMINAIS_SQL}) LIMIT ${LOTE_PURGA})`,
        [corte(RETENCAO_RECIBO_DIAS)],
      ).alteracoes;
      n += banco.executar(`DELETE FROM maestro_rigidez_log WHERE id IN (SELECT id FROM maestro_rigidez_log WHERE ts < ? LIMIT ${LOTE_PURGA})`, [corte(RETENCAO_RIGIDEZ_LOG_DIAS)]).alteracoes;
      return n;
    },
  };
}
export type RepoMaestro = ReturnType<typeof criarRepoMaestro>;
