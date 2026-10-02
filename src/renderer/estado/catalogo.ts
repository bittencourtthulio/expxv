// Estado da tela Catálogo (Fase 7, T-07.26): cache por tipo, filtro local (zero IPC por tecla), assinatura de `catalogo:evento`
// (coalescida), diff por `mudou`, saúde e embarcadas. NADA roda no boot: a tela chama `iniciar()` ao montar. O renderer nunca guarda
// caminho absoluto nem segredo (só ids, hashes curtos e resultados). Descrições vêm saneadas do main e só são exibidas como texto.
import { useSyncExternalStore } from "react";
import type { AchadoSaude, ConcluidoCatalogo, DetalheCatalogo, ErroVarreduraCatalogo, EstadoEmbarcada, EventoCatalogo, ItemCatalogo, PoliticaSkills, TipoCatalogo } from "../../compartilhado/catalogo";
import type { ApiAde } from "../../compartilhado/ipc";
import type { IndiceFuzzy } from "../busca-fuzzy";
import { ade } from "../ade";
import { criarIndiceItens, FILTROS_VAZIOS, mensagemDoErro, type FiltrosCatalogo } from "../telas/catalogo/logica";
import { storeWorkspaces } from "./workspaces";

type Api = ApiAde["catalogo"];

/** Cache considerado recente: trocar de aba dentro dele não faz IPC. */
export const VALIDADE_CACHE_MS = 5 * 60_000;

export interface CacheTipo {
  itens: readonly ItemCatalogo[];
  indice: IndiceFuzzy<ItemCatalogo>;
  ultima_varredura_em: string | null;
  truncado: boolean;
  carregado_em: number;
}
export interface ProgressoVarredura { feitos: number; total: number | null }
export interface EstadoCatalogo {
  aba: TipoCatalogo;
  cache: Readonly<Partial<Record<TipoCatalogo, CacheTipo>>>;
  filtros: FiltrosCatalogo;
  selecionado: string | null;
  detalhe: DetalheCatalogo | null;
  carregando: boolean;
  varrendo: boolean;
  progresso: ProgressoVarredura | null;
  erro: string | null;
  errosCli: readonly ErroVarreduraCatalogo[];
  /** o canal `window.ade.catalogo` não existe (fora do Electron ou main antigo). */
  disponivel: boolean;
  saude: readonly AchadoSaude[];
  embarcadas: readonly EstadoEmbarcada[] | null;
  politicas: readonly PoliticaSkills[] | null;
}

interface Deps {
  api: () => Api | undefined;
  workspace?: () => string | null;
  agora?: () => number;
  /** coalescência de eventos (padrão 150 ms) */
  atrasoMs?: number;
}

const INICIAL: EstadoCatalogo = {
  aba: "skill", cache: {}, filtros: FILTROS_VAZIOS, selecionado: null, detalhe: null, carregando: false, varrendo: false, progresso: null,
  erro: null, errosCli: [], disponivel: true, saude: [], embarcadas: null, politicas: null,
};

export function criarStoreCatalogo({ api: obter, workspace = () => null, agora = Date.now, atrasoMs = 150 }: Deps) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoCatalogo = INICIAL;
  let iniciado: Promise<void> | null = null;
  let cancelar: (() => void) | null = null;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  const pendentes = new Set<TipoCatalogo>();
  const emCurso = new Map<TipoCatalogo, Promise<void>>();

  const publicar = (p: Partial<EstadoCatalogo>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const trocarCache = (tipo: TipoCatalogo, c: CacheTipo | undefined): void => {
    const novo = { ...estado.cache };
    if (c === undefined) delete novo[tipo]; else novo[tipo] = c;
    publicar({ cache: novo });
  };

  function carregarTipo(tipo: TipoCatalogo): Promise<void> {
    const a = obter();
    if (a === undefined) { publicar({ disponivel: false, carregando: false }); return Promise.resolve(); }
    const em = emCurso.get(tipo);
    if (em !== undefined) return em;
    publicar({ carregando: true });
    const p = a.listar({ tipo, workspace_id: workspace() })
      .then((r) => {
        trocarCache(tipo, { itens: r.itens, indice: criarIndiceItens(r.itens), ultima_varredura_em: r.ultima_varredura_em, truncado: r.truncado, carregado_em: agora() });
        const sel = estado.selecionado;
        publicar({ erro: null, selecionado: sel !== null && estado.aba === tipo && !r.itens.some((i) => i.id === sel) ? null : sel });
      })
      .catch((e: unknown) => publicar({ erro: mensagemDoErro(e) }))
      .finally(() => { emCurso.delete(tipo); publicar({ carregando: emCurso.size > 0 }); });
    emCurso.set(tipo, p);
    return p;
  }

  const cacheRecente = (tipo: TipoCatalogo): boolean => {
    const c = estado.cache[tipo];
    return c !== undefined && agora() - c.carregado_em < VALIDADE_CACHE_MS;
  };

  async function aplicarDiff(ids: readonly string[], tipos: readonly TipoCatalogo[]): Promise<void> {
    const a = obter();
    if (a === undefined) return;
    if (ids.length === 0) {
      for (const t of tipos) { if (t === estado.aba) void carregarTipo(t); else trocarCache(t, undefined); }
      return;
    }
    const lidos = await Promise.all(ids.map((id) => a.detalhe(id).catch(() => undefined)));
    const novo: Partial<Record<TipoCatalogo, CacheTipo>> = { ...estado.cache };
    ids.forEach((id, k) => {
      const d = lidos[k];
      if (d === undefined) return; // falha de leitura: mantém o que havia
      for (const t of Object.keys(novo) as TipoCatalogo[]) {
        const c = novo[t];
        if (c === undefined) continue;
        const sem = c.itens.filter((i) => i.id !== id);
        if (d === null) { if (sem.length !== c.itens.length) novo[t] = { ...c, itens: sem, indice: criarIndiceItens(sem) }; continue; }
        if (d.tipo !== t) continue;
        const itens = [...sem, d];
        novo[t] = { ...c, itens, indice: criarIndiceItens(itens) };
      }
      // item novo de um tipo ainda sem cache é ignorado (carrega ao abrir a aba)
    });
    publicar({ cache: novo });
  }

  function agendar(tipos: readonly TipoCatalogo[], ids: readonly string[]): void {
    if (ids.length === 0) tipos.forEach((t) => pendentes.add(t));
    pendentesIds.push(...ids);
    if (temporizador !== null) return;
    temporizador = setTimeout(() => {
      temporizador = null;
      const ts = [...pendentes]; pendentes.clear();
      const is = [...new Set(pendentesIds)]; pendentesIds.length = 0;
      if (ts.length > 0) void aplicarDiff([], ts);
      if (is.length > 0) void aplicarDiff(is, []);
    }, atrasoMs);
  }
  const pendentesIds: string[] = [];

  function aoEvento(e: EventoCatalogo): void {
    if (e.tipo_evento === "progresso") {
      publicar({ varrendo: true, progresso: { feitos: e.feitos, total: e.total } });
    } else if (e.tipo_evento === "concluido") {
      const c: ConcluidoCatalogo = e;
      publicar({ varrendo: false, progresso: null, errosCli: c.erros });
      for (const t of Object.keys(estado.cache) as TipoCatalogo[]) { if (t !== estado.aba) trocarCache(t, undefined); }
      void carregarTipo(estado.aba);
    } else {
      agendar(e.tipos, e.item_ids);
    }
  }

  async function carregarExtras(a: Api): Promise<void> {
    const ws = workspace();
    await Promise.all([
      a.saude(ws).then((saude) => publicar({ saude })).catch(() => undefined),
      ws === null ? Promise.resolve() : a.politicaLer(ws).then((politicas) => publicar({ politicas })).catch(() => undefined),
    ]);
  }

  return {
    obter: (): EstadoCatalogo => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        const a = obter();
        if (a === undefined) { publicar({ disponivel: false }); return; }
        cancelar = a.assinar(aoEvento);
        await carregarTipo(estado.aba);
        void carregarExtras(a);
      })();
      return iniciado;
    },
    parar(): void {
      cancelar?.(); cancelar = null; iniciado = null;
      if (temporizador !== null) { clearTimeout(temporizador); temporizador = null; }
    },
    /** Troca de aba: sem IPC se o cache do tipo é recente. */
    definirAba(tipo: TipoCatalogo): Promise<void> {
      if (tipo === estado.aba) return Promise.resolve();
      publicar({ aba: tipo, selecionado: null, detalhe: null });
      return cacheRecente(tipo) ? Promise.resolve() : carregarTipo(tipo);
    },
    /** Abertura da tela: recarrega só se o cache da aba tem mais de 5 min. */
    aoAbrirTela(): Promise<void> { return cacheRecente(estado.aba) ? Promise.resolve() : carregarTipo(estado.aba); },
    recarregar(): Promise<void> { return carregarTipo(estado.aba); },
    /** Dispara a varredura (o resultado chega por evento). */
    async varrer(): Promise<void> {
      const a = obter();
      if (a === undefined) return;
      publicar({ varrendo: true, progresso: null, erro: null });
      try { await a.varrer({ workspace_id: workspace(), tipos: null, clis: null }); }
      catch (e) { publicar({ varrendo: false, erro: mensagemDoErro(e) }); }
    },
    definirFiltros(p: Partial<FiltrosCatalogo>): void { publicar({ filtros: { ...estado.filtros, ...p } }); },
    limparFiltros(): void { publicar({ filtros: { ...FILTROS_VAZIOS, agrupar: estado.filtros.agrupar, ordem: estado.filtros.ordem } }); },
    async selecionar(id: string | null): Promise<void> {
      if (id === estado.selecionado) return;
      publicar({ selecionado: id, detalhe: null });
      if (id === null) return;
      const a = obter();
      if (a === undefined) return;
      try {
        const d = await a.detalhe(id);
        if (estado.selecionado === id) publicar({ detalhe: d });
      } catch { /* o detalhe é adorno: a linha continua válida */ }
    },
    async recarregarExtras(): Promise<void> { const a = obter(); if (a !== undefined) await carregarExtras(a); },
    async carregarEmbarcadas(): Promise<void> {
      const a = obter();
      if (a === undefined) return;
      try { publicar({ embarcadas: await a.embarcadasEstado() }); } catch (e) { publicar({ erro: mensagemDoErro(e) }); }
    },
    /** Remove do cache local (depois de limpar/remover no main) sem novo IPC. */
    removerLocal(ids: readonly string[]): void {
      const novo: Partial<Record<TipoCatalogo, CacheTipo>> = {};
      for (const t of Object.keys(estado.cache) as TipoCatalogo[]) {
        const c = estado.cache[t] as CacheTipo;
        const itens = c.itens.filter((i) => !ids.includes(i.id));
        novo[t] = itens.length === c.itens.length ? c : { ...c, itens, indice: criarIndiceItens(itens) };
      }
      publicar({ cache: novo, selecionado: estado.selecionado !== null && ids.includes(estado.selecionado) ? null : estado.selecionado });
    },
  };
}

export type StoreCatalogo = ReturnType<typeof criarStoreCatalogo>;

export const storeCatalogo: StoreCatalogo = criarStoreCatalogo({
  api: () => ade()?.catalogo,
  workspace: () => storeWorkspaces.obter().atual?.id ?? null,
});

export const useCatalogo = (store: StoreCatalogo = storeCatalogo): EstadoCatalogo => useSyncExternalStore(store.assinar, store.obter);
