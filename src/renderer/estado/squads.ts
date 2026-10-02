// Estado da tela Squads (Fase 14): lista, seleção, busca/filtro e cache das opções de perfil por CLI. O texto dos prompts NÃO passa
// por aqui (só pelo painel do prompt). Carrega em OCIOSO: nada acontece no boot; a tela chama `iniciar()` ao montar.
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { OpcoesPerfilCli, PedidoDuplicarSquad, PedidoGravarSquad, ResultadoGravarSquad, Squad, SquadResumo } from "../../compartilhado/squads";
import { ade } from "../ade";

export type FiltroSquads = "todas" | "minhas" | "fabrica";

export interface EstadoSquads {
  /** null = ainda não carregou. */
  lista: readonly SquadResumo[] | null;
  carregando: boolean;
  erro: string | null;
  disponivel: boolean;
  busca: string;
  filtro: FiltroSquads;
  selecionada: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const normalizar = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrarLista(lista: readonly SquadResumo[], busca: string, filtro: FiltroSquads): SquadResumo[] {
  const q = normalizar(busca.trim());
  return lista.filter((s) => {
    if (filtro === "fabrica" && s.origem !== "fabrica") return false;
    if (filtro === "minhas" && s.origem === "fabrica") return false;
    return q === "" || normalizar(`${s.nome} ${s.slug} ${s.escopo}`).includes(q);
  });
}

export interface GrupoSquads {
  rotulo: "Minhas" | "Fábrica";
  itens: SquadResumo[];
}
export function agruparLista(lista: readonly SquadResumo[]): GrupoSquads[] {
  const minhas = lista.filter((s) => s.origem !== "fabrica");
  const fabrica = lista.filter((s) => s.origem === "fabrica");
  return [...(minhas.length > 0 ? [{ rotulo: "Minhas" as const, itens: minhas }] : []), ...(fabrica.length > 0 ? [{ rotulo: "Fábrica" as const, itens: fabrica }] : [])];
}

interface Deps {
  squads: () => ApiAde["squads"] | undefined;
  agentes: () => ApiAde["agentes"] | undefined;
  /** coalescência dos eventos `squads:evento` (padrão 120 ms). */
  atrasoMs?: number;
}

export function criarStoreSquads({ squads: obterSquads, agentes: obterAgentes, atrasoMs = 120 }: Deps) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoSquads = { lista: null, carregando: false, erro: null, disponivel: true, busca: "", filtro: "todas", selecionada: null };
  let emCurso: Promise<void> | null = null;
  let iniciado: Promise<void> | null = null;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  const opcoesPorCli = new Map<string, Promise<OpcoesPerfilCli>>();

  const publicar = (p: Partial<EstadoSquads>): void => {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  };
  const exigir = (): ApiAde["squads"] => {
    const a = obterSquads();
    if (a === undefined) throw new Error("A API de squads não está disponível.");
    return a;
  };

  function carregar(): Promise<void> {
    if (emCurso !== null) return emCurso;
    const api = obterSquads();
    if (api === undefined) {
      publicar({ lista: [], disponivel: false });
      return Promise.resolve();
    }
    publicar({ carregando: true });
    emCurso = api
      .listar()
      .then((lista) => {
        const sel = estado.selecionada !== null && !lista.some((s) => s.slug === estado.selecionada) ? null : estado.selecionada;
        publicar({ lista, carregando: false, erro: null, selecionada: sel });
      })
      .catch((e: unknown) => publicar({ lista: estado.lista ?? [], carregando: false, erro: `Não foi possível listar as squads: ${msg(e)}` }))
      .finally(() => {
        emCurso = null;
      });
    return emCurso;
  }

  return {
    obter: (): EstadoSquads => estado,
    assinar(o: () => void): () => void {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    carregar,
    /** Carrega e liga UMA assinatura de eventos (squad gravada/apagada/editada fora do app). Idempotente. */
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        obterSquads()?.assinar(() => {
          if (temporizador !== null) return;
          temporizador = setTimeout(() => {
            temporizador = null;
            void carregar();
          }, atrasoMs);
        });
        await carregar();
      })();
      return iniciado;
    },
    selecionar(slug: string | null): void {
      if (slug !== estado.selecionada) publicar({ selecionada: slug });
    },
    definirBusca(busca: string): void {
      publicar({ busca });
    },
    definirFiltro(filtro: FiltroSquads): void {
      publicar({ filtro });
    },
    hashDe(slug: string): string | null {
      return estado.lista?.find((s) => s.slug === slug)?.hash ?? null;
    },
    resumoDe(slug: string): SquadResumo | null {
      return estado.lista?.find((s) => s.slug === slug) ?? null;
    },
    obterSquad: (slug: string): Promise<Squad> => exigir().obter(slug),
    async gravar(pedido: PedidoGravarSquad): Promise<ResultadoGravarSquad> {
      const r = await exigir().gravar(pedido);
      if (r.ok) await carregar();
      return r;
    },
    validar: (squad: Squad, workspaceId: string | null) => exigir().validar(squad, workspaceId),
    async duplicar(p: PedidoDuplicarSquad): Promise<Squad> {
      const s = await exigir().duplicar(p);
      await carregar();
      publicar({ selecionada: s.slug });
      return s;
    },
    async apagar(slug: string, confirmarSlug: string): Promise<void> {
      await exigir().apagar(slug, confirmarSlug);
      if (estado.selecionada === slug) publicar({ selecionada: null });
      await carregar();
    },
    /** Opções de modelo/esforço de uma CLI (cache por CLI; falha não fica em cache). */
    opcoes(cli: string): Promise<OpcoesPerfilCli> {
      let p = opcoesPorCli.get(cli);
      if (p === undefined) {
        const api = obterAgentes();
        if (api === undefined) return Promise.reject(new Error("A API de agentes não está disponível."));
        p = api.opcoesDePerfil(cli);
        opcoesPorCli.set(cli, p);
        p.catch(() => opcoesPorCli.delete(cli));
      }
      return p;
    },
    limparErro(): void {
      if (estado.erro !== null) publicar({ erro: null });
    },
  };
}

export type StoreSquads = ReturnType<typeof criarStoreSquads>;
export const storeSquads: StoreSquads = criarStoreSquads({ squads: () => ade()?.squads, agentes: () => ade()?.agentes });

export function useSquads(store: StoreSquads = storeSquads): EstadoSquads {
  return useSyncExternalStore(store.assinar, store.obter);
}
