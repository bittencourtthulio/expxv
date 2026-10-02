// Fachada de leitura/estado (T-20.05, parte do `servico.ts`): lido, silenciar, contagem. Idempotente.
import type { AlertaVisao, Pagina, TipoAlerta } from "../../compartilhado/alertas";
import type { PortaBarramento, FiltroAlertas, RepoAlertas, Relogio } from "./portas";
import { relogioReal } from "./portas";

export interface ServicoLeituraAlertas {
  listar(f: FiltroAlertas): Pagina<AlertaVisao>;
  contar(): { nao_lidos: number; criticos: number };
  marcarLido(ids: string[]): number;
  marcarTodosLidos(f?: FiltroAlertas): number;
  silenciar(alvo: { tipo: TipoAlerta } | { entidade_tipo: string; entidade_id: string }, ate: string | null): boolean;
}

export function criarServicoLeitura(deps: { repo: RepoAlertas; barramento?: PortaBarramento; relogio?: Relogio }): ServicoLeituraAlertas {
  const relogio = deps.relogio ?? relogioReal;
  const iso = (): string => new Date(relogio.agora()).toISOString();
  return {
    listar: (f) => deps.repo.listar(f),
    contar: () => deps.repo.contar(),
    marcarLido(ids) {
      const n = deps.repo.marcarLido(ids.slice(0, 200), iso());
      if (n > 0) deps.barramento?.emitir("alert.read", { ids: ids.slice(0, 200) });
      return n;
    },
    marcarTodosLidos(f = {}) {
      const ids: string[] = [];
      let depois: string | null = null;
      for (let i = 0; i < 1000; i++) {
        const p: Pagina<AlertaVisao> = deps.repo.listar({ ...f, estado: "nao_lidos", depois_id: depois, limite: 100 });
        for (const a of p.itens) ids.push(a.id);
        if (p.proximo === null) break;
        depois = p.proximo;
      }
      const n = deps.repo.marcarLido(ids, iso());
      if (n > 0) deps.barramento?.emitir("alert.read", { ids });
      return n;
    },
    silenciar(alvo, ate) {
      deps.repo.silenciar(alvo, ate);
      deps.barramento?.emitir("alert.muted", { alvo, ate });
      return true;
    },
  };
}
