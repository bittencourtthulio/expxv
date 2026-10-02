// Autorização por allowlist (T-20.25): SÓ por `from.id` numérico E `chat.id` privado iguais ao do pareamento — nunca por username/nome.
// Ignora (em silêncio) encaminhadas, `via_bot`, `sender_chat`, editadas, grupos/canais e tudo que não seja `message`/`callback_query`.
// Não autorizado: NENHUMA resposta (sem oráculo); só contador sem texto (teto 500) e, no máx. 1/h, um aviso ao desktop.
import type { RelogioTg } from "./portas";
import type { AutorizadoRow, RepoTelegram } from "./repo";
import type { TgCallbackQuery, TgMessage, TgUpdate } from "./tipos";

export const INATIVIDADE_DIAS = 30;
export const INATIVIDADE_MS = INATIVIDADE_DIAS * 86_400_000;

export type MotivoIgnorado =
  | "tipo_nao_suportado"
  | "grupo_ou_canal"
  | "encaminhada"
  | "via_bot"
  | "sender_chat"
  | "editada"
  | "sem_remetente"
  | "remetente_bot"
  | "chat_diferente"
  | "bloqueado"
  | "revogado"
  | "expirado"
  | "nao_autorizado";

export type ResultadoAutorizacao =
  | { ok: true; tipo: "mensagem"; autorizado: AutorizadoRow; user_id: number; chat_id: number; mensagem: TgMessage }
  | { ok: true; tipo: "callback"; autorizado: AutorizadoRow; user_id: number; chat_id: number; callback: TgCallbackQuery; mensagem: TgMessage }
  | { ok: false; motivo: MotivoIgnorado };

export interface DepsAutorizacao {
  repo: RepoTelegram;
  canal_id: string;
  relogio: RelogioTg;
  /** no máx. 1 por hora: tentativa de usuário desconhecido (só ids e contagem; sem texto). */
  aoDesconhecido?(info: { user_id: number; contagem: number }): void;
}
export interface Autorizador {
  autorizar(u: TgUpdate): ResultadoAutorizacao;
  /** grava os contadores acumulados (1 escrita por usuário por descarga, não por mensagem). */
  descarregar(): void;
  bloquear(user_id: number): void;
  desbloquear(user_id: number): void;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function criarAutorizador(deps: DepsAutorizacao): Autorizador {
  const bloqueados = new Set<number>(deps.repo.listarNaoAutorizados().filter((n) => n.bloqueado).map((n) => n.user_id));
  const contagem = new Map<number, { n: number; primeiro: number; ultimo: number }>();
  let ultimoAviso = -Infinity;

  function desconhecido(user_id: number): void {
    const t = deps.relogio.agora();
    const c = contagem.get(user_id) ?? { n: 0, primeiro: t, ultimo: t };
    c.n++;
    c.ultimo = t;
    contagem.set(user_id, c);
    if (t - ultimoAviso >= 3_600_000 && deps.aoDesconhecido !== undefined) {
      ultimoAviso = t;
      try {
        deps.aoDesconhecido({ user_id, contagem: (deps.repo.naoAutorizado(user_id)?.contagem ?? 0) + c.n });
      } catch {
        /* isolado */
      }
    }
  }

  function localizar(user_id: number, chat_id: number): { ok: true; a: AutorizadoRow } | { ok: false; motivo: MotivoIgnorado } {
    if (bloqueados.has(user_id)) return { ok: false, motivo: "bloqueado" };
    const a = deps.repo.autorizadoPorUser(deps.canal_id, user_id);
    if (a === null) {
      desconhecido(user_id);
      return { ok: false, motivo: "nao_autorizado" };
    }
    if (a.revogado_em !== null) {
      desconhecido(user_id);
      return { ok: false, motivo: "revogado" };
    }
    const t = deps.relogio.agora();
    if (Date.parse(a.expira_em) <= t) {
      desconhecido(user_id);
      return { ok: false, motivo: "expirado" };
    }
    if (a.chat_id !== chat_id) return { ok: false, motivo: "chat_diferente" };
    // validade deslizante: cada uso estende 30 dias
    const novo: AutorizadoRow = { ...a, ultimo_uso_em: iso(t), expira_em: iso(t + INATIVIDADE_MS) };
    if (Date.parse(a.ultimo_uso_em) < t - 60_000) deps.repo.gravarAutorizado(novo);
    return { ok: true, a: Date.parse(a.ultimo_uso_em) < t - 60_000 ? novo : a };
  }

  return {
    autorizar(u) {
      if (u.callback_query !== undefined) {
        const cb = u.callback_query;
        const m = cb.message;
        if (typeof cb.from?.id !== "number" || m === undefined || m.chat === undefined) return { ok: false, motivo: "sem_remetente" };
        if (cb.from.is_bot === true) return { ok: false, motivo: "remetente_bot" };
        if (m.chat.type !== "private") return { ok: false, motivo: "grupo_ou_canal" };
        const r = localizar(cb.from.id, m.chat.id);
        return r.ok ? { ok: true, tipo: "callback", autorizado: r.a, user_id: cb.from.id, chat_id: m.chat.id, callback: cb, mensagem: m } : r;
      }
      if (u.edited_message !== undefined && u.message === undefined) return { ok: false, motivo: "editada" };
      const m = u.message;
      if (m === undefined) return { ok: false, motivo: "tipo_nao_suportado" };
      if (m.chat?.type !== "private") return { ok: false, motivo: "grupo_ou_canal" };
      if (m.forward_origin !== undefined || m.forward_date !== undefined) return { ok: false, motivo: "encaminhada" };
      if (m.via_bot !== undefined) return { ok: false, motivo: "via_bot" };
      if (m.sender_chat !== undefined) return { ok: false, motivo: "sender_chat" };
      if (typeof m.from?.id !== "number") return { ok: false, motivo: "sem_remetente" };
      if (m.from.is_bot === true) return { ok: false, motivo: "remetente_bot" };
      const r = localizar(m.from.id, m.chat.id);
      return r.ok ? { ok: true, tipo: "mensagem", autorizado: r.a, user_id: m.from.id, chat_id: m.chat.id, mensagem: m } : r;
    },
    descarregar() {
      for (const [user_id, c] of contagem) {
        const atual = deps.repo.naoAutorizado(user_id);
        deps.repo.gravarNaoAutorizado({ user_id, primeiro_em: atual?.primeiro_em ?? iso(c.primeiro), ultimo_em: iso(c.ultimo), contagem: (atual?.contagem ?? 0) + c.n, bloqueado: atual?.bloqueado ?? false });
      }
      contagem.clear();
    },
    bloquear(user_id) {
      bloqueados.add(user_id);
      const t = deps.relogio.agora();
      const atual = deps.repo.naoAutorizado(user_id);
      deps.repo.gravarNaoAutorizado({ user_id, primeiro_em: atual?.primeiro_em ?? iso(t), ultimo_em: iso(t), contagem: atual?.contagem ?? 0, bloqueado: true });
    },
    desbloquear(user_id) {
      bloqueados.delete(user_id);
      const atual = deps.repo.naoAutorizado(user_id);
      if (atual !== null) deps.repo.gravarNaoAutorizado({ ...atual, bloqueado: false });
    },
  };
}
