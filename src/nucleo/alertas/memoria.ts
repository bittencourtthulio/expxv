// Implementações EM MEMÓRIA das portas de repositório (testes, perf e uso até o main ligar o SQLite). Mesmo contrato do SQL:
// `UNIQUE (alerta_id, canal_id, regra_id)`, ordem `criado_em DESC, id DESC`, paginação por cursor `depois_id`.
import type { AlertaVisao, CanalRegistro, EntregaRegistro, EstadoEntrega, Pagina, Regra, TipoAlerta } from "../../compartilhado/alertas";
import { severidadeMin } from "./catalogo";
import type { FiltroAlertas, RepoAlertas, RepoCanais, RepoEntregas, RepoRegras } from "./portas";

export function criarRepoAlertasMemoria(): RepoAlertas {
  const linhas = new Map<string, AlertaVisao>();
  const ordenadas = (): AlertaVisao[] => [...linhas.values()].sort((a, b) => (a.criado_em === b.criado_em ? (a.id < b.id ? 1 : -1) : a.criado_em < b.criado_em ? 1 : -1));
  return {
    inserir(a) {
      linhas.set(a.id, { ...a, dados: { ...a.dados } });
    },
    atualizar(id, patch) {
      const a = linhas.get(id);
      if (a !== undefined) linhas.set(id, { ...a, ...patch });
    },
    obter: (id) => linhas.get(id) ?? null,
    recentePorDedupe(chave, desde) {
      let melhor: AlertaVisao | null = null;
      for (const a of linhas.values()) {
        if (a.dedupe_chave !== chave || a.lido_em !== null || a.atualizado_em < desde) continue;
        if (melhor === null || a.atualizado_em > melhor.atualizado_em) melhor = a;
      }
      return melhor;
    },
    listar(f: FiltroAlertas): Pagina<AlertaVisao> {
      const limite = Math.min(Math.max(f.limite ?? 50, 1), 100);
      const busca = f.busca?.toLowerCase();
      const todas = ordenadas().filter((a) => {
        if (a.arquivado_em !== null) return false;
        if ((f.estado ?? "todos") === "nao_lidos" && a.lido_em !== null) return false;
        if (f.estado === "silenciados" && a.silenciado_ate === null) return false;
        if (f.tipos !== undefined && f.tipos.length > 0 && !f.tipos.includes(a.tipo)) return false;
        if (f.severidade_min !== undefined && !severidadeMin(a.severidade, f.severidade_min)) return false;
        if (f.workspace_id !== undefined && a.workspace_id !== f.workspace_id) return false;
        if (f.mission_id !== undefined && a.mission_id !== f.mission_id) return false;
        if (busca !== undefined && !a.titulo.toLowerCase().includes(busca)) return false;
        return true;
      });
      let ini = 0;
      if (f.depois_id !== undefined && f.depois_id !== null) {
        const i = todas.findIndex((a) => a.id === f.depois_id);
        ini = i < 0 ? todas.length : i + 1;
      }
      const itens = todas.slice(ini, ini + limite);
      const ultimo = itens[itens.length - 1];
      return { itens, proximo: ini + limite < todas.length && ultimo !== undefined ? ultimo.id : null };
    },
    contar() {
      let nao_lidos = 0;
      let criticos = 0;
      for (const a of linhas.values()) {
        if (a.lido_em !== null || a.arquivado_em !== null) continue;
        nao_lidos++;
        if (a.severidade === "critico") criticos++;
      }
      return { nao_lidos, criticos };
    },
    marcarLido(ids, em) {
      let n = 0;
      for (const id of ids) {
        const a = linhas.get(id);
        if (a !== undefined && a.lido_em === null) {
          linhas.set(id, { ...a, lido_em: em });
          n++;
        }
      }
      return n;
    },
    silenciar(alvo, ate) {
      let n = 0;
      for (const [id, a] of linhas) {
        const casa = "tipo" in alvo ? a.tipo === alvo.tipo : a.entidade_tipo === alvo.entidade_tipo && a.entidade_id === alvo.entidade_id;
        if (casa) {
          linhas.set(id, { ...a, silenciado_ate: ate });
          n++;
        }
      }
      return n;
    },
    apagarAntesDe(iso) {
      let n = 0;
      for (const [id, a] of linhas) if (a.criado_em < iso) (linhas.delete(id), n++);
      return n;
    },
  };
}

export function criarRepoEntregasMemoria(): RepoEntregas {
  const linhas = new Map<string, EntregaRegistro>();
  const unicas = new Set<string>();
  const chave = (e: Pick<EntregaRegistro, "alerta_id" | "canal_id" | "regra_id">): string => `${e.alerta_id}|${e.canal_id}|${e.regra_id ?? ""}`;
  return {
    inserir(e) {
      const k = chave(e);
      if (unicas.has(k)) return false;
      unicas.add(k);
      linhas.set(e.id, { ...e });
      return true;
    },
    obter: (id) => linhas.get(id) ?? null,
    atualizar(id, patch) {
      const e = linhas.get(id);
      if (e !== undefined) linhas.set(id, { ...e, ...patch });
    },
    porEstado(estado: EstadoEntrega, limite) {
      return [...linhas.values()].filter((e) => e.estado === estado).sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : a.id < b.id ? -1 : 1)).slice(0, limite);
    },
    apagarAntesDe(iso) {
      let n = 0;
      for (const [id, e] of linhas) if (e.criado_em < iso) (unicas.delete(chave(e)), linhas.delete(id), n++);
      return n;
    },
  };
}

export function criarRepoRegrasMemoria(iniciais: Regra[] = []): RepoRegras {
  const linhas = new Map<string, Regra>(iniciais.map((r) => [r.id, r]));
  return {
    listar: () => [...linhas.values()],
    gravar: (r) => void linhas.set(r.id, r),
    apagar: (id) => linhas.delete(id),
  };
}

export function criarRepoCanaisMemoria(iniciais: CanalRegistro[] = []): RepoCanais {
  const linhas = new Map<string, CanalRegistro>(iniciais.map((c) => [c.id, c]));
  return {
    listar: () => [...linhas.values()],
    obter: (id) => linhas.get(id) ?? null,
    gravar: (c) => void linhas.set(c.id, { ...c }),
  };
}

export type { TipoAlerta };
