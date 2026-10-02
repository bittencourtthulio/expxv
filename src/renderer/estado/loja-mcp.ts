// Estado da tela Loja de MCPs (Fase 7B, T-07B.26): cache do catálogo + estado local, filtros e assinatura do evento `loja_mcp:evento`.
// Regras: NADA roda no boot (a tela chama `iniciar()` ao montar); a busca é local sobre o cache (zero IPC por tecla); o andamento
// da instalação vive num mini-store POR ID, então um evento de progresso não re-renderiza a grade inteira; nenhum valor de segredo
// passa por aqui (só ids, hashes consentidos e resultados).
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { DiagnosticoLojaMcp, EventoLojaMcp, ListaLojaMcp } from "../../compartilhado/loja-mcp";
import type { IndiceFuzzy } from "../busca-fuzzy";
import { ade } from "../ade";
import { storeWorkspaces } from "./workspaces";
import type { CartaoMcp } from "../../compartilhado/loja-mcp";
import { criarIndiceCartoes, FILTROS_VAZIOS, mensagemDoErro, type FiltrosLoja } from "../telas/loja-mcp/logica";

type Api = ApiAde["lojaMcp"];

export interface EstadoLoja {
  /** `null` = ainda não carregou. */
  lista: ListaLojaMcp | null;
  indice: IndiceFuzzy<CartaoMcp> | null;
  carregando: boolean;
  erro: string | null;
  /** o canal `window.ade.lojaMcp` não existe (fora do Electron ou main antigo). */
  disponivel: boolean;
  filtros: FiltrosLoja;
  selecionado: string | null;
  diagnostico: DiagnosticoLojaMcp | null;
  /** ids habilitados no workspace atual (deny-by-default: sem linha = fora). */
  habilitados: ReadonlySet<string>;
}

export interface ProgressoInstalacao { instalacao_id: string; passo: number; rotulo: string }

interface Deps {
  api: () => Api | undefined;
  /** workspace atual (para ler `habilitacoes`); `null` = sem workspace. */
  workspace?: () => string | null;
  /** coalescência de eventos de estado/saúde (padrão 150 ms). */
  atrasoMs?: number;
}

const VAZIO = new Set<string>();

export function criarStoreLojaMcp({ api: obter, workspace = () => null, atrasoMs = 150 }: Deps) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoLoja = { lista: null, indice: null, carregando: false, erro: null, disponivel: true, filtros: FILTROS_VAZIOS, selecionado: null, diagnostico: null, habilitados: VAZIO };
  let emCurso: Promise<void> | null = null;
  let iniciado: Promise<void> | null = null;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let cancelarEventos: (() => void) | null = null;

  // andamento por id: snapshot ESTÁVEL por id (só muda quando o dado muda), com ouvintes por id
  const andamento = new Map<string, ProgressoInstalacao>();
  const ouvintesPorId = new Map<string, Set<() => void>>();
  const avisarId = (id: string): void => ouvintesPorId.get(id)?.forEach((o) => o());

  const publicar = (p: Partial<EstadoLoja>): void => {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  };

  async function carregarHabilitados(a: Api): Promise<void> {
    const ws = workspace();
    if (ws === null) { if (estado.habilitados.size > 0) publicar({ habilitados: VAZIO }); return; }
    try {
      const h = await a.habilitacoes(ws);
      publicar({ habilitados: new Set(h.filter((x) => x.habilitado && x.alvo_tipo === "workspace" && x.alvo_valor === ws).map((x) => x.servidor_id)) });
    } catch { /* habilitações são adorno do cartão: a falha não derruba a Loja */ }
  }

  function carregar(): Promise<void> {
    if (emCurso !== null) return emCurso;
    const a = obter();
    if (a === undefined) {
      publicar({ disponivel: false, carregando: false });
      return Promise.resolve();
    }
    publicar({ carregando: true });
    emCurso = a
      .listar()
      .then(async (lista) => {
        const sel = estado.selecionado !== null && !lista.entradas.some((c) => c.id === estado.selecionado) ? null : estado.selecionado;
        publicar({ lista, indice: criarIndiceCartoes(lista.entradas), carregando: false, erro: null, selecionado: sel, disponivel: true });
        await carregarHabilitados(a);
      })
      .catch((e: unknown) => publicar({ carregando: false, erro: mensagemDoErro(e) }))
      .finally(() => { emCurso = null; });
    return emCurso;
  }

  function agendarRecarga(): void {
    if (temporizador !== null) return;
    temporizador = setTimeout(() => { temporizador = null; void carregar(); }, atrasoMs);
  }

  function aoEvento(e: EventoLojaMcp): void {
    if (e.tipo === "progresso") {
      const atual = andamento.get(e.id);
      if (atual !== undefined && atual.instalacao_id === e.instalacao_id && atual.passo === e.passo && atual.rotulo === e.rotulo) return;
      andamento.set(e.id, { instalacao_id: e.instalacao_id, passo: e.passo, rotulo: e.rotulo });
      avisarId(e.id);
      return;
    }
    if (e.tipo === "estado") {
      if (e.estado !== "instalando" && e.estado !== "removendo" && andamento.delete(e.id)) avisarId(e.id);
      agendarRecarga();
      return;
    }
    agendarRecarga(); // saúde: o cartão traz `saude`
  }

  return {
    obter: (): EstadoLoja => estado,
    assinar(o: () => void): () => void {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    /** Carrega o catálogo e liga UMA assinatura de eventos. Idempotente. O diagnóstico vem em seguida (não bloqueia a lista). */
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        cancelarEventos = obter()?.assinar(aoEvento) ?? null;
        await carregar();
        const a = obter();
        if (a !== undefined) void a.diagnostico().then((diagnostico) => publicar({ diagnostico })).catch(() => undefined);
      })();
      return iniciado;
    },
    parar(): void {
      cancelarEventos?.();
      cancelarEventos = null;
      iniciado = null;
      if (temporizador !== null) { clearTimeout(temporizador); temporizador = null; }
    },
    carregar,
    recarregarHabilitados(): Promise<void> {
      const a = obter();
      return a === undefined ? Promise.resolve() : carregarHabilitados(a);
    },
    atualizarDiagnostico(): Promise<void> {
      const a = obter();
      return a === undefined ? Promise.resolve() : a.diagnostico().then((diagnostico) => publicar({ diagnostico })).catch(() => undefined);
    },
    definirFiltros(p: Partial<FiltrosLoja>): void { publicar({ filtros: { ...estado.filtros, ...p } }); },
    limparFiltros(): void { publicar({ filtros: FILTROS_VAZIOS }); },
    selecionar(id: string | null): void { if (id !== estado.selecionado) publicar({ selecionado: id }); },
    /** Marca o início local (entre o clique e o primeiro evento) para o cartão já mostrar "Instalando…". */
    marcarInicio(ids: readonly string[], instalacaoId: string): void {
      for (const id of ids) { andamento.set(id, { instalacao_id: instalacaoId, passo: 0, rotulo: "Preparando" }); avisarId(id); }
    },
    limparAndamento(id: string): void { if (andamento.delete(id)) avisarId(id); },
    andamentoDe: (id: string): ProgressoInstalacao | null => andamento.get(id) ?? null,
    assinarId(id: string, o: () => void): () => void {
      let c = ouvintesPorId.get(id);
      if (c === undefined) { c = new Set(); ouvintesPorId.set(id, c); }
      c.add(o);
      return () => void c.delete(o);
    },
  };
}

export type StoreLojaMcp = ReturnType<typeof criarStoreLojaMcp>;

export const storeLojaMcp: StoreLojaMcp = criarStoreLojaMcp({
  api: () => ade()?.lojaMcp,
  workspace: () => storeWorkspaces.obter().atual?.id ?? null,
});

export const useLojaMcp = (store: StoreLojaMcp = storeLojaMcp): EstadoLoja => useSyncExternalStore(store.assinar, store.obter);

/** Andamento de UM servidor: re-renderiza só o cartão dono do id. */
export function useAndamentoMcp(id: string, store: StoreLojaMcp = storeLojaMcp): ProgressoInstalacao | null {
  return useSyncExternalStore((o) => store.assinarId(id, o), () => store.andamentoDe(id));
}
