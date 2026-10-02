// Repositório SQL do Telegram (Fase 20, T-20.03). Invariantes: nonce de uso único ATÔMICO (`UPDATE ... WHERE estado='pendente' AND expira_em>? RETURNING`),
// `UNIQUE(canal_id, update_id)` em `mensagem_entrada`, `transacao` real, só hashes (nunca token/PIN em claro).
import type { ModoWorkspaceTelegram } from "../../../compartilhado/alertas";
import type { AcaoAprovacao, AprovacaoRow, AuditoriaRow, AutorizadoRow, EntradaRow, EstadoEntrada, EstadoTelegramRow, NaoAutorizadoRow, RepoTelegram, WorkspaceRow } from "../../telegram/repo";
import { estadoVazio } from "../../telegram/repo";
import type { Banco, Valor } from "../banco";

type Cru<T, K extends keyof T> = Omit<T, K> & Record<K, number>;
const b01 = (v: boolean): number => (v ? 1 : 0);

interface LinhaAprov { nonce_hash: string; mensagem_entrada_id: string; acao: string; plano_id: string; args_hash: string; chat_id: number; message_id: number | null; user_id: number; estado: string; expira_em: string; usado_em: string | null; extra: string | null }
const aAprov = (l: LinhaAprov): AprovacaoRow => ({ ...l, acao: l.acao as AcaoAprovacao, estado: l.estado as AprovacaoRow["estado"], ...(l.extra === null ? {} : { extra: l.extra }) });

interface LinhaEntrada {
  id: string; canal_id: string; autorizado_id: string; update_id: number; texto_redigido: string; tamanho_original: number; comando: string | null; intencao: string | null; plano_id: string | null;
  workspace_id: string | null; estado: string; motivo: string | null; args_hash: string | null; mission_id: string | null; resultado_resumo: string | null; aprovado_em: string | null; aprovado_por: string | null;
  criado_em: string; atualizado_em: string; texto_hash: string | null; edicoes: number;
}
const aEntrada = (l: LinhaEntrada): EntradaRow => {
  const { texto_hash, edicoes, ...resto } = l;
  return { ...resto, estado: l.estado as EstadoEntrada, edicoes, ...(texto_hash === null ? {} : { texto_hash }) };
};
const COLUNAS_ENTRADA = ["texto_redigido", "tamanho_original", "comando", "intencao", "plano_id", "workspace_id", "estado", "motivo", "args_hash", "mission_id", "resultado_resumo", "aprovado_em", "aprovado_por", "atualizado_em", "texto_hash", "edicoes"] as const;

interface LinhaAut { id: string; canal_id: string; user_id: number; chat_id: number; nome_exibicao: string; modo_padrao: string; texto_livre: number; pin_hash: string | null; criado_em: string; ultimo_uso_em: string; expira_em: string; revogado_em: string | null }
const aAut = (l: LinhaAut): AutorizadoRow => ({ ...l, modo_padrao: l.modo_padrao as ModoWorkspaceTelegram, texto_livre: l.texto_livre === 1 });

export function criarRepoTelegramSql(banco: Banco): RepoTelegram {
  const aprovPorHash = (h: string): AprovacaoRow | null => {
    const l = banco.consultarUm<LinhaAprov>("SELECT * FROM telegram_aprovacao WHERE nonce_hash = ?", [h]);
    return l === undefined ? null : aAprov(l);
  };
  const anular = (cond: string, params: Valor[]): number => banco.executar(`UPDATE telegram_aprovacao SET estado = 'anulado' WHERE estado = 'pendente' AND ${cond}`, params).alteracoes;

  return {
    estado(canal_id) {
      const l = banco.consultarUm<Cru<EstadoTelegramRow, "descarte_inicial_feito">>("SELECT * FROM telegram_estado WHERE canal_id = ?", [canal_id]);
      return l === undefined ? estadoVazio(canal_id) : { ...l, descarte_inicial_feito: l.descarte_inicial_feito === 1 };
    },
    salvarEstado(canal_id, patch) {
      const e = { ...this.estado(canal_id), ...patch, canal_id };
      banco.executar(
        "INSERT INTO telegram_estado (canal_id,proximo_offset,ultimo_update_id,bot_id,bot_username,bot_nome,ultimo_poll_em,ultimo_erro_codigo,conflitos_seguidos,descarte_inicial_feito) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(canal_id) DO UPDATE SET proximo_offset=excluded.proximo_offset, ultimo_update_id=excluded.ultimo_update_id, bot_id=excluded.bot_id, bot_username=excluded.bot_username, bot_nome=excluded.bot_nome, ultimo_poll_em=excluded.ultimo_poll_em, ultimo_erro_codigo=excluded.ultimo_erro_codigo, conflitos_seguidos=excluded.conflitos_seguidos, descarte_inicial_feito=excluded.descarte_inicial_feito",
        [canal_id, e.proximo_offset, e.ultimo_update_id, e.bot_id, e.bot_username, e.bot_nome, e.ultimo_poll_em, e.ultimo_erro_codigo, e.conflitos_seguidos, b01(e.descarte_inicial_feito)],
      );
    },
    updateVisto: (id) => banco.consultarUm("SELECT 1 AS x FROM telegram_update_visto WHERE update_id = ?", [id]) !== undefined,
    marcarVisto(id, em) {
      banco.executar("INSERT INTO telegram_update_visto (update_id, visto_em) VALUES (?, ?) ON CONFLICT(update_id) DO UPDATE SET visto_em = excluded.visto_em", [id, em]);
    },
    apagarVistosAntesDe: (iso) => banco.executar("DELETE FROM telegram_update_visto WHERE visto_em < ?", [iso]).alteracoes,
    apagarEntradasAntesDe(iso) {
      // `telegram_aprovacao` cai em cascata (ON DELETE CASCADE); desconhecidos antigos e NÃO bloqueados também saem
      const n = banco.executar("DELETE FROM mensagem_entrada WHERE criado_em < ?", [iso]).alteracoes;
      banco.executar("DELETE FROM telegram_nao_autorizado WHERE bloqueado = 0 AND ultimo_em < ?", [iso]);
      return n;
    },

    autorizadoPorUser(canal_id, user_id) {
      const l = banco.consultarUm<LinhaAut>("SELECT * FROM telegram_autorizado WHERE canal_id = ? AND user_id = ?", [canal_id, user_id]);
      return l === undefined ? null : aAut(l);
    },
    autorizadoPorId(id) {
      const l = banco.consultarUm<LinhaAut>("SELECT * FROM telegram_autorizado WHERE id = ?", [id]);
      return l === undefined ? null : aAut(l);
    },
    listarAutorizados: (canal_id) => banco.consultar<LinhaAut>("SELECT * FROM telegram_autorizado WHERE canal_id = ? ORDER BY criado_em ASC, rowid ASC", [canal_id]).map(aAut),
    gravarAutorizado(r) {
      banco.transacao((b) => {
        b.executar("DELETE FROM telegram_autorizado WHERE canal_id = ? AND user_id = ? AND id <> ?", [r.canal_id, r.user_id, r.id]);
        b.executar(
          "INSERT INTO telegram_autorizado (id,canal_id,user_id,chat_id,nome_exibicao,modo_padrao,texto_livre,pin_hash,criado_em,ultimo_uso_em,expira_em,revogado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canal_id=excluded.canal_id, user_id=excluded.user_id, chat_id=excluded.chat_id, nome_exibicao=excluded.nome_exibicao, modo_padrao=excluded.modo_padrao, texto_livre=excluded.texto_livre, pin_hash=excluded.pin_hash, criado_em=excluded.criado_em, ultimo_uso_em=excluded.ultimo_uso_em, expira_em=excluded.expira_em, revogado_em=excluded.revogado_em",
          [r.id, r.canal_id, r.user_id, r.chat_id, r.nome_exibicao, r.modo_padrao, b01(r.texto_livre), r.pin_hash, r.criado_em, r.ultimo_uso_em, r.expira_em, r.revogado_em],
        );
      });
    },
    revogarAutorizado: (id, em) => banco.executar("UPDATE telegram_autorizado SET revogado_em = ? WHERE id = ? AND revogado_em IS NULL", [em, id]).alteracoes === 1,
    revogarTodos: (canal_id, em) => banco.executar("UPDATE telegram_autorizado SET revogado_em = ? WHERE canal_id = ? AND revogado_em IS NULL", [em, canal_id]).alteracoes,
    workspaces: (id) =>
      banco.consultar<Cru<WorkspaceRow, "padrao">>("SELECT * FROM telegram_workspace WHERE autorizado_id = ? ORDER BY rowid ASC", [id]).map((w) => ({ autorizado_id: w.autorizado_id, workspace_id: w.workspace_id, modo: w.modo as ModoWorkspaceTelegram, padrao: w.padrao === 1 })),
    gravarWorkspaces(id, rows) {
      banco.transacao((b) => {
        b.executar("DELETE FROM telegram_workspace WHERE autorizado_id = ?", [id]);
        for (const r of rows) b.executar("INSERT INTO telegram_workspace (autorizado_id,workspace_id,modo,padrao) VALUES (?,?,?,?)", [id, r.workspace_id, r.modo, b01(r.padrao)]);
      });
    },

    naoAutorizado(user_id) {
      const l = banco.consultarUm<Cru<NaoAutorizadoRow, "bloqueado">>("SELECT * FROM telegram_nao_autorizado WHERE user_id = ?", [user_id]);
      return l === undefined ? null : { ...l, bloqueado: l.bloqueado === 1 };
    },
    gravarNaoAutorizado(r) {
      banco.transacao((b) => {
        b.executar(
          "INSERT INTO telegram_nao_autorizado (user_id,primeiro_em,ultimo_em,contagem,bloqueado) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET primeiro_em=excluded.primeiro_em, ultimo_em=excluded.ultimo_em, contagem=excluded.contagem, bloqueado=excluded.bloqueado",
          [r.user_id, r.primeiro_em, r.ultimo_em, r.contagem, b01(r.bloqueado)],
        );
        const n = b.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM telegram_nao_autorizado")?.n ?? 0;
        if (n > 500) b.executar("DELETE FROM telegram_nao_autorizado WHERE user_id IN (SELECT user_id FROM telegram_nao_autorizado WHERE bloqueado = 0 ORDER BY ultimo_em ASC, user_id ASC LIMIT ?)", [n - 500]);
      });
    },
    listarNaoAutorizados: () => banco.consultar<Cru<NaoAutorizadoRow, "bloqueado">>("SELECT * FROM telegram_nao_autorizado ORDER BY user_id ASC").map((l) => ({ ...l, bloqueado: l.bloqueado === 1 })),

    entradaPorUpdate(canal_id, update_id) {
      const l = banco.consultarUm<LinhaEntrada>("SELECT * FROM mensagem_entrada WHERE canal_id = ? AND update_id = ?", [canal_id, update_id]);
      return l === undefined ? null : aEntrada(l);
    },
    inserirEntrada(r) {
      return (
        banco.executar(
          "INSERT OR IGNORE INTO mensagem_entrada (id,canal_id,autorizado_id,update_id,texto_redigido,tamanho_original,comando,intencao,plano_id,workspace_id,estado,motivo,args_hash,mission_id,resultado_resumo,aprovado_em,aprovado_por,criado_em,atualizado_em,texto_hash,edicoes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [r.id, r.canal_id, r.autorizado_id, r.update_id, r.texto_redigido, r.tamanho_original, r.comando, r.intencao, r.plano_id, r.workspace_id, r.estado, r.motivo, r.args_hash, r.mission_id, r.resultado_resumo, r.aprovado_em, r.aprovado_por, r.criado_em, r.atualizado_em, r.texto_hash ?? null, r.edicoes ?? 0],
        ).alteracoes === 1
      );
    },
    entrada(id) {
      const l = banco.consultarUm<LinhaEntrada>("SELECT * FROM mensagem_entrada WHERE id = ?", [id]);
      return l === undefined ? null : aEntrada(l);
    },
    atualizarEntrada(id, patch) {
      const sets: string[] = [];
      const params: Valor[] = [];
      for (const c of COLUNAS_ENTRADA) {
        if (!(c in patch)) continue;
        sets.push(`${c} = ?`);
        params.push(((patch as Record<string, unknown>)[c] ?? null) as Valor);
      }
      if (sets.length > 0) banco.executar(`UPDATE mensagem_entrada SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    },
    entradasDoAutorizado(autorizado_id, estados) {
      if (estados.length === 0) return [];
      return banco.consultar<LinhaEntrada>(`SELECT * FROM mensagem_entrada WHERE autorizado_id = ? AND estado IN (${estados.map(() => "?").join(",")}) ORDER BY criado_em ASC, rowid ASC`, [autorizado_id, ...estados]).map(aEntrada);
    },
    entradaPorPlano(plano_id) {
      const l = banco.consultarUm<LinhaEntrada>("SELECT * FROM mensagem_entrada WHERE plano_id = ? ORDER BY rowid ASC LIMIT 1", [plano_id]);
      return l === undefined ? null : aEntrada(l);
    },
    entradaRecentePorHash(autorizado_id, texto_hash, desde) {
      const l = banco.consultarUm<LinhaEntrada>("SELECT * FROM mensagem_entrada WHERE autorizado_id = ? AND texto_hash = ? AND criado_em >= ? ORDER BY rowid ASC LIMIT 1", [autorizado_id, texto_hash, desde]);
      return l === undefined ? null : aEntrada(l);
    },

    inserirAprovacao(r) {
      banco.executar(
        "INSERT OR REPLACE INTO telegram_aprovacao (nonce_hash,mensagem_entrada_id,acao,plano_id,args_hash,chat_id,message_id,user_id,estado,expira_em,usado_em,extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [r.nonce_hash, r.mensagem_entrada_id, r.acao, r.plano_id, r.args_hash, r.chat_id, r.message_id, r.user_id, r.estado, r.expira_em, r.usado_em, r.extra ?? null],
      );
    },
    definirMessageIdAprovacoes(id, message_id) {
      banco.executar("UPDATE telegram_aprovacao SET message_id = ? WHERE mensagem_entrada_id = ? AND message_id IS NULL", [message_id, id]);
    },
    aprovacao: aprovPorHash,
    consumirAprovacao(h, agora) {
      const l = banco.consultarUm<LinhaAprov>("UPDATE telegram_aprovacao SET estado = 'usado', usado_em = ? WHERE nonce_hash = ? AND estado = 'pendente' AND expira_em > ? RETURNING *", [agora, h, agora]);
      if (l !== undefined) return aAprov(l);
      banco.executar("UPDATE telegram_aprovacao SET estado = 'expirado' WHERE nonce_hash = ? AND estado = 'pendente' AND expira_em <= ?", [h, agora]);
      return null;
    },
    consumirAprovacaoPorPlano(plano_id, acao, agora) {
      const l = banco.consultarUm<LinhaAprov>(
        "UPDATE telegram_aprovacao SET estado = 'usado', usado_em = ? WHERE nonce_hash = (SELECT nonce_hash FROM telegram_aprovacao WHERE plano_id = ? AND acao = ? AND estado = 'pendente' AND expira_em > ? ORDER BY rowid ASC LIMIT 1) AND estado = 'pendente' AND expira_em > ? RETURNING *",
        [agora, plano_id, acao, agora, agora],
      );
      return l === undefined ? null : aAprov(l);
    },
    anularAprovacoesPorPlano: (p) => anular("plano_id = ?", [p]),
    anularAprovacoesDoUsuario: (u) => anular("user_id = ?", [u]),
    anularTodasAprovacoes: () => anular("1 = 1", []),

    inserirAuditoria(r) {
      banco.executar("INSERT INTO telegram_auditoria (id,ts,canal_id,evento,user_id,workspace_id,plano_id,mensagem_entrada_id,args_hash,resultado,detalhe_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
        r.id, r.ts, r.canal_id, r.evento, r.user_id, r.workspace_id, r.plano_id, r.mensagem_entrada_id, r.args_hash, r.resultado, JSON.stringify(r.detalhe ?? {}),
      ]);
    },
    listarAuditoria(canal_id, depois_ts, limite) {
      const l = banco.consultar<Omit<AuditoriaRow, "detalhe"> & { detalhe_json: string }>(
        `SELECT * FROM telegram_auditoria WHERE canal_id = ?${depois_ts === null ? "" : " AND ts < ?"} ORDER BY ts DESC, id DESC LIMIT ?`,
        depois_ts === null ? [canal_id, limite] : [canal_id, depois_ts, limite],
      );
      return l.map(({ detalhe_json, ...r }) => ({ ...r, detalhe: JSON.parse(detalhe_json) as Record<string, unknown> }));
    },
    apagarAuditoriaAntesDe: (iso) => banco.executar("DELETE FROM telegram_auditoria WHERE ts < ?", [iso]).alteracoes,
    transacao: (fn) => banco.transacao(() => fn()),
  };
}
