// Pânico, revogação e kill-switch (T-20.32). `panico()` (botão, bandeja ou `/parar`) leva ao MESMO estado final: poller parado (0 sockets em <= 1 s),
// fila de saída cancelada, nonces e planos pendentes anulados, TODOS revogados, entrada/saída desligadas, canal `desligado`. Opcionalmente para as
// execuções iniciadas pelo bot (para; NUNCA apaga Pane/worktree). Reativar exige refazer o pareamento (o consentimento fica).
import type { RelogioTg } from "./portas";
import type { Auditoria } from "./auditoria";
import type { Pareamento } from "./pareamento";
import type { PortaOrquestrador } from "./portas-entrada";
import type { RepoTelegram } from "./repo";
import { INATIVIDADE_MS } from "./autorizacao";

export interface DepsPanico {
  repo: RepoTelegram;
  canal_id: string;
  relogio: RelogioTg;
  auditoria: Auditoria;
  /** `poller.parar()` (aborta o long poll e libera a trava). */
  pararPoller(): Promise<void>;
  /** `entregador.cancelar(canal_id)`. */
  cancelarFila(): void;
  pareamento?: Pareamento;
  orquestrador?: Pick<PortaOrquestrador, "pararPlano">;
  /** atualiza o canal no banco: `entrada_ligada=0`, `saida_ligada=0`, `estado='desligado'`. */
  desligarCanal(): void;
  aoEvento?(tipo: "panico" | "revogado" | "entrada_expirou", detalhe: { revogados?: number }): void;
}

export interface Panico {
  panico(o: { parar_execucoes: boolean; origem: string }): Promise<{ ok: boolean; revogados: number }>;
  revogar(autorizado_id: string): boolean;
  /** AB-30: expira quem passou de 30 dias sem uso; sem ninguém ativo desliga a entrada. */
  verificarInatividade(): { expirados: number; entrada_desligada: boolean };
}

export function criarPanico(deps: DepsPanico): Panico {
  const iso = (): string => new Date(deps.relogio.agora()).toISOString();
  let emCurso: Promise<{ ok: boolean; revogados: number }> | null = null;

  async function executar(o: { parar_execucoes: boolean; origem: string }): Promise<{ ok: boolean; revogados: number }> {
    // 1. rede primeiro: poller (0 sockets) e fila de saída
    deps.cancelarFila();
    await deps.pararPoller();
    deps.pareamento?.cancelar();
    // 2. nonces e planos pendentes
    deps.repo.anularTodasAprovacoes(deps.canal_id);
    const autorizados = deps.repo.listarAutorizados(deps.canal_id);
    const pendentes = autorizados.flatMap((a) => deps.repo.entradasDoAutorizado(a.id, ["plano_enviado", "recebida"]));
    for (const e of pendentes) deps.repo.atualizarEntrada(e.id, { estado: "cancelada", motivo: "panico", atualizado_em: iso() });
    // 3. execuções iniciadas por aqui: só para; nada é apagado
    if (o.parar_execucoes && deps.orquestrador !== undefined) {
      for (const a of autorizados) {
        for (const e of deps.repo.entradasDoAutorizado(a.id, ["executando"])) {
          if (e.plano_id === null) continue;
          try {
            await deps.orquestrador.pararPlano(e.plano_id);
          } catch {
            /* melhor esforço */
          }
        }
      }
    }
    // 4. revogação total
    const revogados = deps.repo.revogarTodos(deps.canal_id, iso());
    deps.desligarCanal();
    deps.auditoria.registrar("panico", { resultado: o.origem, detalhe: { revogados, parar_execucoes: o.parar_execucoes } });
    deps.aoEvento?.("panico", { revogados });
    return { ok: true, revogados };
  }

  return {
    panico(o) {
      emCurso ??= executar(o).finally(() => {
        emCurso = null;
      });
      return emCurso;
    },
    revogar(autorizado_id) {
      const a = deps.repo.autorizadoPorId(autorizado_id);
      if (a === null) return false;
      const ok = deps.repo.revogarAutorizado(autorizado_id, iso());
      deps.repo.anularAprovacoesDoUsuario(a.user_id);
      for (const e of deps.repo.entradasDoAutorizado(a.id, ["plano_enviado", "recebida"])) deps.repo.atualizarEntrada(e.id, { estado: "cancelada", motivo: "revogado", atualizado_em: iso() });
      if (ok) {
        deps.auditoria.registrar("revogado", { user_id: a.user_id });
        deps.aoEvento?.("revogado", { revogados: 1 });
      }
      return ok;
    },
    verificarInatividade() {
      const agora = deps.relogio.agora();
      let expirados = 0;
      let ativos = 0;
      for (const a of deps.repo.listarAutorizados(deps.canal_id)) {
        if (a.revogado_em !== null) continue;
        if (Date.parse(a.expira_em) <= agora || agora - Date.parse(a.ultimo_uso_em) > INATIVIDADE_MS) {
          deps.repo.revogarAutorizado(a.id, iso());
          deps.repo.anularAprovacoesDoUsuario(a.user_id);
          deps.auditoria.registrar("expirado", { user_id: a.user_id });
          expirados++;
        } else ativos++;
      }
      const desligar = expirados > 0 && ativos === 0;
      if (desligar) {
        deps.desligarCanal();
        deps.aoEvento?.("entrada_expirou", {});
      }
      return { expirados, entrada_desligada: desligar };
    },
  };
}
