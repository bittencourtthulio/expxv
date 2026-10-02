// Estado da tela Conhecimento (Fase 15). `useSyncExternalStore`: só quem lê re-renderiza. Chunk lazy: nada disto roda no boot.
// Eventos `conhecimento:progresso` são coalescidos em 1 quadro; respostas de pedidos velhos são descartadas (geração).
import { useSyncExternalStore } from "react";
import type { Aprendizado, ArestaGrafo, EstadoAprendizado, EstadoConhecimento, EscopoBusca, FonteResultado, ModoBusca, NoGrafo, RespostaBusca, RespostaContexto, TipoAprendizado, TipoDocumento, ValorFeedback } from "../../compartilhado/conhecimento";
import type { AcaoAprendizado, AlvoEsquecer, ConfigConhecimentoDto, DetalheNoGrafo, EstadoModelosEmbedding, EventoConhecimentoApi, FonteReindexar, PedidoGravarConfigConhecimento, PosicaoNo } from "../../compartilhado/conhecimento-api";
import { ade } from "../ade";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";
import { ehCanalAusente } from "./carga";

type Api = NonNullable<ReturnType<typeof ade>>["conhecimento"];

export const PAGINA_CONHECIMENTO = 100;
export const MAX_NOS_GRAFO = 1500;

export interface FiltrosGrafo { tipos: readonly string[]; desde: string | null; missionId: string | null; busca: string }
export const FILTROS_GRAFO_INICIAIS: FiltrosGrafo = { tipos: [], desde: null, missionId: null, busca: "" };
export interface FiltrosAprendizados { estado: EstadoAprendizado | null; tipo: TipoAprendizado | null; busca: string }
export const FILTROS_APRENDIZADOS_INICIAIS: FiltrosAprendizados = { estado: null, tipo: null, busca: "" };

export interface ParametrosBusca { consulta: string; modo: ModoBusca; tipos: TipoDocumento[] | null; desde: string | null; escopo: EscopoBusca }

export interface EstadoStoreConhecimento {
  disponivel: boolean;
  workspaceId: string | null;
  estado: EstadoConhecimento | null;
  erroEstado: string | null;
  config: ConfigConhecimentoDto | null;
  progresso: { fase: string | null; pendentes: number; pct: number | null } | null;
  nos: readonly NoGrafo[];
  arestas: readonly ArestaGrafo[];
  truncado: boolean;
  focoNoId: string | null;
  filtrosGrafo: FiltrosGrafo;
  grafoCarregando: boolean;
  grafoErro: string | null;
  detalhe: DetalheNoGrafo | null;
  detalheCarregando: boolean;
  busca: { params: ParametrosBusca; resposta: RespostaBusca | null; buscando: boolean; erro: string | null; previa: RespostaContexto | null; feedbacks: Readonly<Record<string, ValorFeedback>> };
  fontes: { itens: readonly FonteResultado[]; proximo: string | null; carregando: boolean; erro: string | null; carregado: boolean };
  aprendizados: { itens: readonly Aprendizado[]; proximo: string | null; carregando: boolean; erro: string | null; filtros: FiltrosAprendizados; carregado: boolean };
  aprendizadosNovos: number;
  modelos: EstadoModelosEmbedding | null;
  modelosErro: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export const BUSCA_INICIAL: EstadoStoreConhecimento["busca"] = { params: { consulta: "", modo: "hibrido", tipos: null, desde: null, escopo: "projeto" }, resposta: null, buscando: false, erro: null, previa: null, feedbacks: {} };

export interface OpcoesStoreConhecimento {
  api?: () => Api | undefined;
  avisar?: (texto: string, tom?: TomAviso) => unknown;
  quadro?: (fn: () => void) => void;
}

export function criarStoreConhecimento(op: OpcoesStoreConhecimento = {}) {
  const obterApi = op.api ?? (() => ade()?.conhecimento);
  const avisar = op.avisar ?? avisarPadrao;
  const quadro = op.quadro ?? ((fn: () => void) => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn()); else setTimeout(fn, 16); });
  const ouvintes = new Set<() => void>();
  const inicial = (): EstadoStoreConhecimento => ({
    disponivel: true, workspaceId: null, estado: null, erroEstado: null, config: null, progresso: null,
    nos: [], arestas: [], truncado: false, focoNoId: null, filtrosGrafo: FILTROS_GRAFO_INICIAIS, grafoCarregando: false, grafoErro: null,
    detalhe: null, detalheCarregando: false, busca: BUSCA_INICIAL,
    fontes: { itens: [], proximo: null, carregando: false, erro: null, carregado: false },
    aprendizados: { itens: [], proximo: null, carregando: false, erro: null, filtros: FILTROS_APRENDIZADOS_INICIAIS, carregado: false },
    aprendizadosNovos: 0, modelos: null, modelosErro: null,
  });
  let estado = inicial();
  let usuarios = 0;
  let desligar: (() => void) | null = null;
  let geracao = 0;
  let geracaoGrafo = 0;
  let progressoPendente: EstadoStoreConhecimento["progresso"] | undefined;
  let quadroAgendado = false;

  const publicar = (p: Partial<EstadoStoreConhecimento>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const usavel = (a: Api | undefined): a is Api => a !== undefined && typeof a.estado === "function";
  const erroDe = (e: unknown, prefixo: string): string | null => {
    if (ehCanalAusente(e)) { publicar({ disponivel: false }); return null; }
    return `${prefixo}: ${msg(e)}`;
  };
  const ws = (): string | null => estado.workspaceId;

  async function guardar<T>(fn: (a: Api, w: string) => Promise<T>, falha: string): Promise<T | null> {
    const a = obterApi();
    const w = ws();
    if (!usavel(a) || w === null) return null;
    try { return await fn(a, w); } catch (e) { const t = erroDe(e, falha); if (t !== null) avisar(t, "erro"); return null; }
  }

  function aoEvento(e: EventoConhecimentoApi): void {
    if (e.payload.workspace_id !== ws()) return;
    if (e.canal === "conhecimento:progresso") {
      progressoPendente = e.payload.pendentes === 0 && e.payload.pct === null ? null : { fase: e.payload.fase, pendentes: e.payload.pendentes, pct: e.payload.pct };
      if (quadroAgendado) return;
      quadroAgendado = true;
      quadro(() => {
        quadroAgendado = false;
        if (progressoPendente === undefined) return;
        const p = progressoPendente;
        progressoPendente = undefined;
        publicar({ progresso: p });
        if (p === null) { void api.carregarEstado(); void api.carregarGrafo(); }
      });
    } else if (e.canal === "conhecimento:aprendizado_novo") {
      publicar({ aprendizadosNovos: estado.aprendizadosNovos + 1 });
    }
  }

  const pedidoGrafo = (foco: string | null) => ({
    workspace_id: ws() as string,
    tipos: estado.filtrosGrafo.tipos.length === 0 ? null : [...estado.filtrosGrafo.tipos],
    desde: estado.filtrosGrafo.desde,
    mission_id: estado.filtrosGrafo.missionId,
    foco_no_id: foco,
    max_nos: MAX_NOS_GRAFO,
  });

  const api = {
    obter: (): EstadoStoreConhecimento => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    reiniciar(): void { geracao++; geracaoGrafo++; estado = inicial(); ouvintes.forEach((o) => o()); },

    /** Contagem de usuários: a assinatura de eventos nasce com o primeiro e morre com o último. */
    iniciar(): () => void {
      usuarios++;
      if (usuarios === 1 && desligar === null) {
        const a = obterApi();
        const cancelar = a !== undefined && typeof a.assinar === "function" ? a.assinar(aoEvento) : () => undefined;
        desligar = () => { cancelar(); desligar = null; };
      }
      return () => { usuarios = Math.max(0, usuarios - 1); if (usuarios === 0) desligar?.(); };
    },

    async definirWorkspace(id: string | null): Promise<void> {
      if (id === estado.workspaceId) return;
      geracao++; geracaoGrafo++;
      estado = { ...inicial(), workspaceId: id };
      ouvintes.forEach((o) => o());
      if (id === null) return;
      await Promise.all([api.carregarEstado(), api.carregarConfig()]);
    },

    async carregarEstado(): Promise<void> {
      const a = obterApi();
      const w = ws();
      if (!usavel(a) || w === null) { if (!usavel(a)) publicar({ disponivel: false }); return; }
      const g = geracao;
      try {
        const e = await a.estado(w);
        if (g === geracao) publicar({ estado: e, erroEstado: null, progresso: e.indexando.pendentes > 0 ? { fase: e.indexando.fase, pendentes: e.indexando.pendentes, pct: e.indexando.pct } : null });
      } catch (err) { if (g === geracao) publicar({ erroEstado: erroDe(err, "Não foi possível ler o estado do conhecimento") }); }
    },
    async carregarConfig(): Promise<void> {
      const g = geracao;
      const c = await guardar((a, w) => a.lerConfig(w), "Não foi possível ler a configuração");
      if (c !== null && g === geracao) publicar({ config: c });
    },
    async gravarConfig(p: Omit<PedidoGravarConfigConhecimento, "workspace_id">): Promise<boolean> {
      const c = await guardar((a, w) => a.gravarConfig({ workspace_id: w, ...p }), "Não foi possível gravar a configuração");
      if (c === null) return false;
      publicar({ config: c });
      void api.carregarEstado();
      return true;
    },

    // ---- grafo
    definirFiltrosGrafo(p: Partial<FiltrosGrafo>): void { publicar({ filtrosGrafo: { ...estado.filtrosGrafo, ...p } }); },
    async carregarGrafo(foco: string | null = estado.focoNoId): Promise<void> {
      const a = obterApi();
      if (!usavel(a) || ws() === null) { if (!usavel(a)) publicar({ disponivel: false }); return; }
      const g = ++geracaoGrafo;
      publicar({ grafoCarregando: true, grafoErro: null, focoNoId: foco });
      try {
        const r = await a.subgrafo(pedidoGrafo(foco));
        if (g === geracaoGrafo) publicar({ nos: r.nos, arestas: r.arestas, truncado: r.truncado, grafoCarregando: false });
      } catch (e) { if (g === geracaoGrafo) publicar({ grafoCarregando: false, grafoErro: erroDe(e, "Não foi possível carregar o grafo") }); }
    },
    /** duplo clique: foca a vizinhança (1 salto). `null` limpa. */
    focar(noId: string | null): Promise<void> { return api.carregarGrafo(noId); },
    async abrirNo(noId: string): Promise<void> {
      publicar({ detalheCarregando: true });
      const g = geracao;
      const d = await guardar((a, w) => a.detalheNo(w, noId), "Não foi possível abrir o nó");
      if (g === geracao) publicar({ detalhe: d, detalheCarregando: false });
    },
    fecharDetalhe(): void { publicar({ detalhe: null, detalheCarregando: false }); },
    /** trechos que originaram um documento (proveniência); sem estado: quem pede guarda. */
    async trechosDoDocumento(documentoId: string): Promise<Array<{ id: string; trecho: string }> | null> {
      const d = await guardar((a, w) => a.detalheDocumento(w, documentoId), "Não foi possível ler os trechos");
      return d?.chunks ?? null;
    },
    async gravarPosicoes(posicoes: PosicaoNo[]): Promise<void> {
      const a = obterApi();
      const w = ws();
      if (!usavel(a) || w === null || posicoes.length === 0) return;
      try { await a.gravarPosicoes(w, posicoes); } catch { /* posição é só cache: falhar não incomoda */ }
    },

    // ---- busca
    definirParametrosBusca(p: Partial<ParametrosBusca>): void { publicar({ busca: { ...estado.busca, params: { ...estado.busca.params, ...p } } }); },
    async buscar(): Promise<void> {
      const a = obterApi();
      const w = ws();
      const par = estado.busca.params;
      if (!usavel(a) || w === null || par.consulta.trim() === "") return;
      const g = geracao;
      publicar({ busca: { ...estado.busca, buscando: true, erro: null, previa: null } });
      try {
        const r = await a.buscar({ workspace_id: w, consulta: par.consulta.trim(), modo: par.modo, tipos: par.tipos, desde: par.desde, limite: 20, escopo: par.escopo });
        if (g === geracao) publicar({ busca: { ...estado.busca, resposta: r, buscando: false } });
      } catch (e) { if (g === geracao) publicar({ busca: { ...estado.busca, buscando: false, erro: erroDe(e, "A busca falhou") } }); }
    },
    limparBusca(): void { publicar({ busca: { ...BUSCA_INICIAL, params: { ...estado.busca.params, consulta: "" } } }); },
    async previaContexto(): Promise<void> {
      const par = estado.busca.params;
      const p = await guardar((a, w) => a.contextoPrevia({ workspace_id: w, tarefa: par.consulta.trim(), arquivos: [], orcamento_chars: estado.config?.contexto_chars ?? 6000 }), "Não foi possível montar a prévia do contexto");
      if (p !== null) publicar({ busca: { ...estado.busca, previa: p } });
    },
    async darFeedback(alvoTipo: "chunk" | "documento" | "aprendizado", alvoId: string, valor: ValorFeedback): Promise<boolean> {
      const r = await guardar((a, w) => a.feedback({ workspace_id: w, alvo_tipo: alvoTipo, alvo_id: alvoId, valor }), "Não foi possível registrar o feedback");
      if (r?.ok !== true) return false;
      publicar({ busca: { ...estado.busca, feedbacks: { ...estado.busca.feedbacks, [`${alvoTipo}:${alvoId}`]: valor } } });
      return true;
    },

    // ---- fontes
    async carregarFontes(): Promise<void> {
      publicar({ fontes: { ...estado.fontes, carregando: true, erro: null } });
      const g = geracao;
      const a = obterApi();
      const w = ws();
      if (!usavel(a) || w === null) { publicar({ fontes: { ...estado.fontes, carregando: false } }); return; }
      try {
        const p = await a.listarDocumentos({ workspace_id: w, tipo: null, mission_id: null, busca: null, depois: null, limite: 500 });
        if (g === geracao) publicar({ fontes: { itens: p.itens, proximo: p.proximo, carregando: false, erro: null, carregado: true } });
      } catch (e) { if (g === geracao) publicar({ fontes: { ...estado.fontes, carregando: false, carregado: true, erro: erroDe(e, "Não foi possível listar as fontes") } }); }
    },
    async reindexar(fonte: FonteReindexar): Promise<boolean> {
      const r = await guardar((a, w) => a.reindexar(w, fonte), "Não foi possível reindexar");
      if (r === null) return false;
      avisar(r.enfileirado ? "Reindexação enfileirada." : "Já há uma indexação em andamento.", "info");
      publicar({ progresso: estado.progresso ?? { fase: "enfileirado", pendentes: 1, pct: null } });
      return r.enfileirado;
    },
    async esquecer(alvo: AlvoEsquecer): Promise<number | null> {
      const r = await guardar((a, w) => a.esquecer(w, alvo), "Não foi possível esquecer");
      if (r === null) return null;
      avisar(`${r.removidos} ${r.removidos === 1 ? "item removido" : "itens removidos"} do índice.`, "sucesso");
      void api.carregarFontes(); void api.carregarEstado(); void api.carregarGrafo();
      return r.removidos;
    },
    async purgar(confirmacao: string): Promise<number | null> {
      const r = await guardar((a, w) => a.purgar(w, confirmacao), "Não foi possível apagar o conhecimento");
      if (r === null) return null;
      avisar("Conhecimento deste projeto apagado.", "sucesso");
      publicar({ nos: [], arestas: [], detalhe: null, fontes: { itens: [], proximo: null, carregando: false, erro: null, carregado: true } });
      void api.carregarEstado();
      return r.removidos;
    },
    async importarHistorico(cli: "claude" | "codex" | "opencode"): Promise<{ enfileirado: boolean; sessoes: number } | null> {
      const r = await guardar((a, w) => a.importarHistorico(w, cli), "Não foi possível importar o histórico");
      if (r !== null) avisar(`Histórico do ${cli}: ${r.sessoes} ${r.sessoes === 1 ? "sessão" : "sessões"} ${r.enfileirado ? "na fila" : "sem novidades"}.`, "info");
      return r;
    },
    async exportar(): Promise<string | null> {
      const r = await guardar((a, w) => a.exportar(w), "Não foi possível exportar");
      if (r?.caminho_salvo != null) avisar("Conhecimento exportado.", "sucesso");
      return r?.caminho_salvo ?? null;
    },

    // ---- aprendizados
    definirFiltrosAprendizados(p: Partial<FiltrosAprendizados>): void { publicar({ aprendizados: { ...estado.aprendizados, filtros: { ...estado.aprendizados.filtros, ...p } } }); },
    async carregarAprendizados(mais = false): Promise<void> {
      const a = obterApi();
      const w = ws();
      if (!usavel(a) || w === null) return;
      const atual = estado.aprendizados;
      if (mais && (atual.proximo === null || atual.carregando)) return;
      const g = geracao;
      publicar({ aprendizados: { ...atual, carregando: true, erro: null, ...(mais ? {} : { itens: [], proximo: null }) } });
      try {
        const f = estado.aprendizados.filtros;
        const p = await a.listarAprendizados({ workspace_id: w, estado: f.estado, tipo: f.tipo, busca: f.busca.trim() === "" ? null : f.busca.trim(), depois: mais ? atual.proximo : null, limite: PAGINA_CONHECIMENTO });
        if (g !== geracao) return;
        const base = mais ? estado.aprendizados.itens : [];
        const ja = new Set(base.map((x) => x.id));
        publicar({ aprendizados: { ...estado.aprendizados, itens: [...base, ...p.itens.filter((x) => !ja.has(x.id))], proximo: p.proximo, carregando: false, carregado: true }, aprendizadosNovos: 0 });
      } catch (e) { if (g === geracao) publicar({ aprendizados: { ...estado.aprendizados, carregando: false, carregado: true, erro: erroDe(e, "Não foi possível listar os aprendizados") } }); }
    },
    async atualizarAprendizado(id: string, acao: AcaoAprendizado, texto?: string): Promise<boolean> {
      const r = await guardar((a, w) => a.atualizarAprendizado({ workspace_id: w, id, acao, ...(texto !== undefined ? { texto } : {}) }), "Não foi possível atualizar o aprendizado");
      if (r === null) return false;
      const itens = estado.aprendizados.itens.map((x) => (x.id === id ? r : x));
      publicar({ aprendizados: { ...estado.aprendizados, itens } });
      void api.carregarEstado();
      return true;
    },
    async destilarMissao(missionId: string): Promise<number | null> {
      const r = await guardar((a, w) => a.destilarMissao(w, missionId), "Não foi possível destilar a missão");
      if (r !== null) { avisar(`${r.aprendizados} ${r.aprendizados === 1 ? "aprendizado novo" : "aprendizados novos"}.`, "info"); void api.carregarAprendizados(); }
      return r?.aprendizados ?? null;
    },

    // ---- modelos de embedding
    async carregarModelos(): Promise<void> {
      const g = geracao;
      const a = obterApi();
      const w = ws();
      if (!usavel(a) || w === null) return;
      try { const m = await a.modelos(w); if (g === geracao) publicar({ modelos: m, modelosErro: null }); }
      catch (e) { if (g === geracao) publicar({ modelosErro: erroDe(e, "Não foi possível ler os modelos de embedding") }); }
    },
    async definirModelo(id: string): Promise<boolean> {
      const m = await guardar((a, w) => a.definirModelo(w, id), "Não foi possível trocar o modelo");
      if (m === null) return false;
      publicar({ modelos: m });
      void api.carregarEstado();
      return true;
    },
  };
  return api;
}

export type StoreConhecimento = ReturnType<typeof criarStoreConhecimento>;
export const storeConhecimento: StoreConhecimento = criarStoreConhecimento();
export function useConhecimento(store: StoreConhecimento = storeConhecimento): EstadoStoreConhecimento {
  return useSyncExternalStore(store.assinar, store.obter);
}
