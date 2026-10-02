// Repositórios SQL do Centro de Alertas (Fase 20, T-20.03). Mesmo contrato dos `criarRepo*Memoria` (provado em `alertas.contrato.test.ts`).
import type { AlertaVisao, CanalRegistro, ConsentimentoCanal, EntregaRegistro, EstadoEntrega, Pagina, Regra, Severidade } from "../../../compartilhado/alertas";
import { SEVERIDADES } from "../../../compartilhado/alertas";
import type { FiltroAlertas, RepoAlertas, RepoCanais, RepoEntregas, RepoRegras } from "../../alertas/portas";
import type { ModeloGravado, RepoModelos } from "../../alertas/repo-modelos";
import type { RegistroTempo, RepoTempo } from "../../alertas/tempo";
import type { Banco, Valor } from "../banco";

const json = (v: unknown): string => JSON.stringify(v ?? null);
const lerJson = <T>(t: unknown, padrao: T): T => {
  try {
    return typeof t === "string" ? (JSON.parse(t) as T) : padrao;
  } catch {
    return padrao;
  }
};
const nul = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const agoraIso = (): string => new Date().toISOString();

// ---------------------------------------------------------------------------------------------------- alertas
interface LinhaAlerta {
  id: string; tipo: string; severidade: string; fonte: string; workspace_id: string | null; mission_id: string | null; entidade_tipo: string | null; entidade_id: string | null;
  titulo: string; dados_json: string; dedupe_chave: string; contagem: number; criado_em: string; atualizado_em: string; lido_em: string | null; silenciado_ate: string | null; arquivado_em: string | null;
}
const aAlerta = (l: LinhaAlerta): AlertaVisao => ({
  id: l.id, tipo: l.tipo as AlertaVisao["tipo"], severidade: l.severidade as Severidade, fonte: l.fonte as AlertaVisao["fonte"], workspace_id: l.workspace_id, mission_id: l.mission_id,
  entidade_tipo: l.entidade_tipo, entidade_id: l.entidade_id, titulo: l.titulo, dados: lerJson(l.dados_json, {}), dedupe_chave: l.dedupe_chave, contagem: l.contagem,
  criado_em: l.criado_em, atualizado_em: l.atualizado_em, lido_em: l.lido_em, silenciado_ate: l.silenciado_ate, arquivado_em: l.arquivado_em,
});
const COLUNAS_ALERTA: Record<string, (v: unknown) => Valor> = {
  tipo: (v) => String(v), severidade: (v) => String(v), fonte: (v) => String(v), workspace_id: nul, mission_id: nul, entidade_tipo: nul, entidade_id: nul, titulo: (v) => String(v),
  dados: json, dedupe_chave: (v) => String(v), contagem: (v) => Number(v), criado_em: (v) => String(v), atualizado_em: (v) => String(v), lido_em: nul, silenciado_ate: nul, arquivado_em: nul,
};
const NOME_COLUNA: Record<string, string> = { dados: "dados_json" };

export function criarRepoAlertasSql(banco: Banco): RepoAlertas {
  return {
    inserir(a) {
      banco.executar(
        "INSERT INTO alerta (id,tipo,severidade,fonte,workspace_id,mission_id,entidade_tipo,entidade_id,titulo,dados_json,dedupe_chave,contagem,criado_em,atualizado_em,lido_em,silenciado_ate,arquivado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, severidade=excluded.severidade, fonte=excluded.fonte, workspace_id=excluded.workspace_id, mission_id=excluded.mission_id, entidade_tipo=excluded.entidade_tipo, entidade_id=excluded.entidade_id, titulo=excluded.titulo, dados_json=excluded.dados_json, dedupe_chave=excluded.dedupe_chave, contagem=excluded.contagem, criado_em=excluded.criado_em, atualizado_em=excluded.atualizado_em, lido_em=excluded.lido_em, silenciado_ate=excluded.silenciado_ate, arquivado_em=excluded.arquivado_em",
        [a.id, a.tipo, a.severidade, a.fonte, a.workspace_id, a.mission_id, a.entidade_tipo, a.entidade_id, a.titulo, json(a.dados), a.dedupe_chave, a.contagem, a.criado_em, a.atualizado_em, a.lido_em, a.silenciado_ate, a.arquivado_em],
      );
    },
    atualizar(id, patch) {
      const sets: string[] = [];
      const params: Valor[] = [];
      for (const [k, v] of Object.entries(patch)) {
        const conv = COLUNAS_ALERTA[k];
        if (conv === undefined || k === "id") continue;
        sets.push(`${NOME_COLUNA[k] ?? k} = ?`);
        params.push(conv(v));
      }
      if (sets.length === 0) return;
      banco.executar(`UPDATE alerta SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    },
    obter(id) {
      const l = banco.consultarUm<LinhaAlerta>("SELECT * FROM alerta WHERE id = ?", [id]);
      return l === undefined ? null : aAlerta(l);
    },
    recentePorDedupe(chave, desde) {
      const l = banco.consultarUm<LinhaAlerta>("SELECT * FROM alerta WHERE dedupe_chave = ? AND lido_em IS NULL AND atualizado_em >= ? ORDER BY atualizado_em DESC, id DESC LIMIT 1", [chave, desde]);
      return l === undefined ? null : aAlerta(l);
    },
    listar(f: FiltroAlertas): Pagina<AlertaVisao> {
      const limite = Math.min(Math.max(f.limite ?? 50, 1), 100);
      const cond: string[] = ["arquivado_em IS NULL"];
      const p: Valor[] = [];
      if ((f.estado ?? "todos") === "nao_lidos") cond.push("lido_em IS NULL");
      if (f.estado === "silenciados") cond.push("silenciado_ate IS NOT NULL");
      if (f.tipos !== undefined && f.tipos.length > 0) {
        cond.push(`tipo IN (${f.tipos.map(() => "?").join(",")})`);
        p.push(...f.tipos);
      }
      if (f.severidade_min !== undefined) {
        const ok = SEVERIDADES.slice(SEVERIDADES.indexOf(f.severidade_min));
        cond.push(`severidade IN (${ok.map(() => "?").join(",")})`);
        p.push(...ok);
      }
      if (f.workspace_id !== undefined) (cond.push("workspace_id = ?"), p.push(f.workspace_id));
      if (f.mission_id !== undefined) (cond.push("mission_id = ?"), p.push(f.mission_id));
      if (f.busca !== undefined && f.busca !== "") (cond.push("instr(lower(titulo), lower(?)) > 0"), p.push(f.busca));
      if (f.depois_id !== undefined && f.depois_id !== null) {
        const c = banco.consultarUm<{ criado_em: string; id: string }>("SELECT criado_em, id FROM alerta WHERE id = ?", [f.depois_id]);
        if (c === undefined) return { itens: [], proximo: null };
        cond.push("(criado_em < ? OR (criado_em = ? AND id < ?))");
        p.push(c.criado_em, c.criado_em, c.id);
      }
      const linhas = banco.consultar<LinhaAlerta>(`SELECT * FROM alerta WHERE ${cond.join(" AND ")} ORDER BY criado_em DESC, id DESC LIMIT ?`, [...p, limite + 1]);
      const itens = linhas.slice(0, limite).map(aAlerta);
      const ultimo = itens[itens.length - 1];
      return { itens, proximo: linhas.length > limite && ultimo !== undefined ? ultimo.id : null };
    },
    contar() {
      const r = banco.consultarUm<{ n: number; c: number | null }>("SELECT COUNT(*) AS n, SUM(CASE WHEN severidade = 'critico' THEN 1 ELSE 0 END) AS c FROM alerta WHERE lido_em IS NULL AND arquivado_em IS NULL");
      return { nao_lidos: r?.n ?? 0, criticos: r?.c ?? 0 };
    },
    marcarLido(ids, em) {
      let n = 0;
      banco.transacao((b) => {
        for (const id of ids) n += b.executar("UPDATE alerta SET lido_em = ? WHERE id = ? AND lido_em IS NULL", [em, id]).alteracoes;
      });
      return n;
    },
    silenciar(alvo, ate) {
      if ("tipo" in alvo) return banco.executar("UPDATE alerta SET silenciado_ate = ? WHERE tipo = ?", [ate, alvo.tipo]).alteracoes;
      return banco.executar("UPDATE alerta SET silenciado_ate = ? WHERE entidade_tipo = ? AND entidade_id = ?", [ate, alvo.entidade_tipo, alvo.entidade_id]).alteracoes;
    },
    apagarAntesDe(iso) {
      return banco.executar("DELETE FROM alerta WHERE criado_em < ?", [iso]).alteracoes;
    },
  };
}

// ---------------------------------------------------------------------------------------------------- entregas
interface LinhaEntrega {
  id: string; alerta_id: string; canal_id: string; regra_id: string | null; estado: string; tentativas: number; proxima_tentativa_em: string | null; erro_codigo: string | null;
  lote_id: string | null; mensagem_externa_id: string | null; enviado_em: string | null; criado_em: string; nivel: string; chat_ref: string | null;
}
const aEntrega = (l: LinhaEntrega): EntregaRegistro => ({ ...l, estado: l.estado as EstadoEntrega, nivel: l.nivel as EntregaRegistro["nivel"] });
const COLUNAS_ENTREGA = ["alerta_id", "canal_id", "regra_id", "estado", "tentativas", "proxima_tentativa_em", "erro_codigo", "lote_id", "mensagem_externa_id", "enviado_em", "criado_em", "nivel", "chat_ref"] as const;

export function criarRepoEntregasSql(banco: Banco): RepoEntregas {
  return {
    inserir(e) {
      const r = banco.executar(
        "INSERT OR IGNORE INTO alerta_entrega (id,alerta_id,canal_id,regra_id,estado,tentativas,proxima_tentativa_em,erro_codigo,lote_id,mensagem_externa_id,enviado_em,criado_em,nivel,chat_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [e.id, e.alerta_id, e.canal_id, e.regra_id, e.estado, e.tentativas, e.proxima_tentativa_em, e.erro_codigo, e.lote_id, e.mensagem_externa_id, e.enviado_em, e.criado_em, e.nivel, e.chat_ref],
      );
      return r.alteracoes === 1;
    },
    obter(id) {
      const l = banco.consultarUm<LinhaEntrega>("SELECT * FROM alerta_entrega WHERE id = ?", [id]);
      return l === undefined ? null : aEntrega(l);
    },
    atualizar(id, patch) {
      const sets: string[] = [];
      const params: Valor[] = [];
      for (const c of COLUNAS_ENTREGA) {
        if (!(c in patch)) continue;
        sets.push(`${c} = ?`);
        params.push(((patch as Record<string, unknown>)[c] ?? null) as Valor);
      }
      if (sets.length > 0) banco.executar(`UPDATE alerta_entrega SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    },
    porEstado(estado, limite) {
      return banco.consultar<LinhaEntrega>("SELECT * FROM alerta_entrega WHERE estado = ? ORDER BY criado_em ASC, id ASC LIMIT ?", [estado, limite]).map(aEntrega);
    },
    apagarAntesDe(iso) {
      return banco.executar("DELETE FROM alerta_entrega WHERE criado_em < ?", [iso]).alteracoes;
    },
  };
}

// ---------------------------------------------------------------------------------------------------- regras
interface LinhaRegra {
  id: string; nome: string; ativa: number; tipos_json: string; canal_id: string; filtros_json: string; silencio_json: string; agrupamento_json: string; nivel: string;
  efemera_ate: string | null; origem: string; chat_ref: string | null;
}
const aRegra = (l: LinhaRegra): Regra => ({
  id: l.id, nome: l.nome, ativa: l.ativa === 1, tipos: lerJson(l.tipos_json, []), canal_id: l.canal_id, filtros: lerJson(l.filtros_json, {}), silencio: lerJson(l.silencio_json, {}),
  agrupamento: lerJson(l.agrupamento_json, { modo: "imediato" as const }), nivel: l.nivel as Regra["nivel"], efemera_ate: l.efemera_ate, origem: l.origem as Regra["origem"],
  ...(l.chat_ref === null ? {} : { chat_ref: l.chat_ref }),
});

export function criarRepoRegrasSql(banco: Banco): RepoRegras {
  return {
    listar: () => banco.consultar<LinhaRegra>("SELECT * FROM alerta_regra ORDER BY criado_em ASC, rowid ASC").map(aRegra),
    gravar(r) {
      banco.executar(
        "INSERT INTO alerta_regra (id,nome,ativa,tipos_json,canal_id,filtros_json,silencio_json,agrupamento_json,nivel,efemera_ate,origem,chat_ref,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, ativa=excluded.ativa, tipos_json=excluded.tipos_json, canal_id=excluded.canal_id, filtros_json=excluded.filtros_json, silencio_json=excluded.silencio_json, agrupamento_json=excluded.agrupamento_json, nivel=excluded.nivel, efemera_ate=excluded.efemera_ate, origem=excluded.origem, chat_ref=excluded.chat_ref",
        [r.id, r.nome, r.ativa ? 1 : 0, json(r.tipos), r.canal_id, json(r.filtros), json(r.silencio), json(r.agrupamento), r.nivel, r.efemera_ate, r.origem, r.chat_ref ?? null, agoraIso()],
      );
    },
    apagar(id) {
      return banco.transacao((b) => {
        // SET NULL no histórico poderia colidir com o índice de idempotência: some o duplicado antes
        b.executar("DELETE FROM alerta_entrega WHERE regra_id = ? AND EXISTS (SELECT 1 FROM alerta_entrega o WHERE o.alerta_id = alerta_entrega.alerta_id AND o.canal_id = alerta_entrega.canal_id AND o.regra_id IS NULL)", [id]);
        return b.executar("DELETE FROM alerta_regra WHERE id = ?", [id]).alteracoes === 1;
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------- canais
interface LinhaCanal {
  id: string; tipo: string; nome: string; estado: string; config_json: string; consentimento_json: string | null; saida_ligada: number; entrada_ligada: number; silenciado_ate: string | null; erro_codigo: string | null;
}
const aCanal = (l: LinhaCanal): CanalRegistro => ({
  id: l.id, tipo: l.tipo as CanalRegistro["tipo"], nome: l.nome, estado: l.estado as CanalRegistro["estado"], saida_ligada: l.saida_ligada === 1, entrada_ligada: l.entrada_ligada === 1,
  consentimento: l.consentimento_json === null ? null : lerJson<ConsentimentoCanal | null>(l.consentimento_json, null), silenciado_ate: l.silenciado_ate, erro_codigo: l.erro_codigo,
});

export interface RepoCanaisSql extends RepoCanais {
  /** `config_json` (SEM segredo). */
  config(id: string): Record<string, unknown>;
  gravarConfig(id: string, config: Record<string, unknown>): void;
  remover(id: string): boolean;
}

export function criarRepoCanaisSql(banco: Banco): RepoCanaisSql {
  return {
    listar: () => banco.consultar<LinhaCanal>("SELECT * FROM canal ORDER BY criado_em ASC, rowid ASC").map(aCanal),
    obter(id) {
      const l = banco.consultarUm<LinhaCanal>("SELECT * FROM canal WHERE id = ?", [id]);
      return l === undefined ? null : aCanal(l);
    },
    gravar(c) {
      const t = agoraIso();
      banco.executar(
        "INSERT INTO canal (id,tipo,nome,estado,consentimento_json,saida_ligada,entrada_ligada,silenciado_ate,erro_codigo,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, nome=excluded.nome, estado=excluded.estado, consentimento_json=excluded.consentimento_json, saida_ligada=excluded.saida_ligada, entrada_ligada=excluded.entrada_ligada, silenciado_ate=excluded.silenciado_ate, erro_codigo=excluded.erro_codigo, atualizado_em=excluded.atualizado_em",
        [c.id, c.tipo, c.nome, c.estado, c.consentimento === null ? null : json(c.consentimento), c.saida_ligada ? 1 : 0, c.entrada_ligada ? 1 : 0, c.silenciado_ate, c.erro_codigo, t, t],
      );
    },
    config(id) {
      const l = banco.consultarUm<{ config_json: string }>("SELECT config_json FROM canal WHERE id = ?", [id]);
      return l === undefined ? {} : lerJson<Record<string, unknown>>(l.config_json, {});
    },
    gravarConfig(id, config) {
      banco.executar("UPDATE canal SET config_json = ?, atualizado_em = ? WHERE id = ?", [json(config), agoraIso(), id]);
    },
    remover: (id) => banco.executar("DELETE FROM canal WHERE id = ?", [id]).alteracoes === 1,
  };
}

// ---------------------------------------------------------------------------------------------------- tempo
interface LinhaTempo {
  workspace_id: string; trabalho_id: string; task_id: string; inicio: string; fim: string | null; ativo_ms: number; aguardando_ms: number; estado_atual: string | null; estado_desde: string | null;
  pane_id: string | null; alertou_atraso: number;
}
const aTempo = (l: LinhaTempo): RegistroTempo => ({ ...l, alertou_atraso: l.alertou_atraso as 0 | 1 | 2 });

export function criarRepoTempoSql(banco: Banco): RepoTempo {
  return {
    gravar(r) {
      banco.executar(
        "INSERT INTO tarefa_tempo (workspace_id,trabalho_id,task_id,inicio,fim,ativo_ms,aguardando_ms,estado_atual,estado_desde,pane_id,alertou_atraso) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,trabalho_id,task_id,inicio) DO UPDATE SET fim=excluded.fim, ativo_ms=excluded.ativo_ms, aguardando_ms=excluded.aguardando_ms, estado_atual=excluded.estado_atual, estado_desde=excluded.estado_desde, pane_id=excluded.pane_id, alertou_atraso=excluded.alertou_atraso",
        [r.workspace_id, r.trabalho_id, r.task_id, r.inicio, r.fim, Math.round(r.ativo_ms), Math.round(r.aguardando_ms), r.estado_atual, r.estado_desde, r.pane_id, r.alertou_atraso],
      );
    },
    abertas: () => banco.consultar<LinhaTempo>("SELECT * FROM tarefa_tempo WHERE fim IS NULL ORDER BY inicio ASC").map(aTempo),
    concluidas(workspace_id, limite) {
      const l = banco.consultar<LinhaTempo>("SELECT * FROM tarefa_tempo WHERE workspace_id = ? AND fim IS NOT NULL ORDER BY fim DESC, inicio DESC LIMIT ?", [workspace_id, limite]);
      return l.reverse().map(aTempo);
    },
  };
}

// ---------------------------------------------------------------------------------------------------- modelos
export function criarRepoModelosSql(banco: Banco, agora: () => number = Date.now): RepoModelos {
  interface L { tipo: string; canal_tipo: string; nivel: string; corpo: string; editado: number; atualizado_em: string }
  const a = (l: L): ModeloGravado => ({ tipo: l.tipo as ModeloGravado["tipo"], canal_tipo: l.canal_tipo as ModeloGravado["canal_tipo"], nivel: l.nivel as ModeloGravado["nivel"], corpo: l.corpo, editado: l.editado === 1, atualizado_em: l.atualizado_em });
  const listar = (): ModeloGravado[] => banco.consultar<L>("SELECT tipo,canal_tipo,nivel,corpo,editado,atualizado_em FROM alerta_template ORDER BY tipo, canal_tipo, nivel").map(a);
  return {
    listar,
    gravar(m) {
      const em = new Date(agora()).toISOString();
      banco.executar(
        "INSERT INTO alerta_template (id,tipo,canal_tipo,nivel,corpo,editado,atualizado_em) VALUES (?,?,?,?,?,1,?) ON CONFLICT(tipo,canal_tipo,nivel) DO UPDATE SET corpo=excluded.corpo, editado=1, atualizado_em=excluded.atualizado_em",
        [`tpl_${m.tipo}_${m.canal_tipo}_${m.nivel}`, m.tipo, m.canal_tipo, m.nivel, m.corpo, em],
      );
      return { tipo: m.tipo, canal_tipo: m.canal_tipo, nivel: m.nivel, corpo: m.corpo, editado: true, atualizado_em: em };
    },
    restaurar(t, c, n) {
      banco.executar("DELETE FROM alerta_template WHERE tipo = ? AND canal_tipo = ? AND nivel = ?", [t, c, n]);
    },
    corpos: () => new Map(listar().map((m) => [`${m.tipo}|${m.canal_tipo}|${m.nivel}`, m.corpo])),
  };
}
