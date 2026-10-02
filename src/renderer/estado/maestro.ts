// Estado do Maestro no renderer (Fase 16, T-16.32/36): plano proposto, pipelines ativos e detalhe. `useSyncExternalStore`; eventos
// `maestro:evento` coalescidos em 1 quadro. Arquivo pequeno de propósito: a paleta (casca) e a tela (lazy) compartilham o mesmo store.
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { AcaoDoPipelineIpc, ContextoPedido, DetalhePipeline, EtapaDoPlano, Intencao, NivelRigidez, PipelineResumo, RespostaPedirMaestro } from "../../compartilhado/maestro";
import { exigenciaDoErro, problemaDoTexto, type Exigencia } from "../telas/pipelines/logica";
import { ade } from "../ade";
import { ehCanalAusente } from "./carga";

type Api = ApiAde["maestro"];

export interface AjustesDoPlano {
  nivel: NivelRigidez | null;
  intencao: Intencao | null;
  etapasDesligadas: readonly string[];
  justificativa: string | null;
  confirmacaoDigitada: string | null;
}
export const AJUSTES_VAZIOS: AjustesDoPlano = { nivel: null, intencao: null, etapasDesligadas: [], justificativa: null, confirmacaoDigitada: null };

export interface EstadoStoreMaestro {
  disponivel: boolean;
  workspaceId: string | null;
  ativos: readonly PipelineResumo[] | null;
  carregando: boolean;
  erro: string | null;
  selecionadoId: string | null;
  detalhe: DetalhePipeline | null;
  detalheCarregando: boolean;
  detalheErro: string | null;
  plano: RespostaPedirMaestro | null;
  /** etapas recalculadas pela prévia quando o usuário muda o nível antes de executar. */
  etapasPrevia: readonly EtapaDoPlano[] | null;
  ajustes: AjustesDoPlano;
  pedindo: boolean;
  confirmando: boolean;
  erroPedido: string | null;
  exigencia: Exigencia | null;
  ocupadoAcao: boolean;
  aviso: string | null;
}
export interface OpcoesStoreMaestro {
  api?: () => Api | undefined;
  /** prévia de plano por nível (canal `rigidez:previa_plano`). */
  previa?: () => ApiAde["rigidez"] | undefined;
  quadro?: (fn: () => void) => void;
}
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const INICIAL: EstadoStoreMaestro = {
  disponivel: true, workspaceId: null, ativos: null, carregando: false, erro: null, selecionadoId: null, detalhe: null, detalheCarregando: false, detalheErro: null,
  plano: null, etapasPrevia: null, ajustes: AJUSTES_VAZIOS, pedindo: false, confirmando: false, erroPedido: null, exigencia: null, ocupadoAcao: false, aviso: null,
};

export function criarStoreMaestro(op: OpcoesStoreMaestro = {}) {
  const obterApi = op.api ?? (() => ade()?.maestro);
  const obterPrevia = op.previa ?? (() => ade()?.rigidez);
  const quadro = op.quadro ?? ((fn: () => void) => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn()); else setTimeout(fn, 16); });
  const ouvintes = new Set<() => void>();
  let estado: EstadoStoreMaestro = INICIAL;
  let geracao = 0;
  let agendado = false;
  let cancelar: (() => void) | null = null;

  const publicar = (p: Partial<EstadoStoreMaestro>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const usavel = (a: Api | undefined): a is Api => a !== undefined && typeof a.pedir === "function";

  async function recarregar(): Promise<void> {
    const api = obterApi();
    const ws = estado.workspaceId;
    if (!usavel(api)) { publicar({ disponivel: false, carregando: false }); return; }
    if (ws === null) { publicar({ ativos: [], carregando: false }); return; }
    const g = ++geracao;
    publicar({ carregando: estado.ativos === null, erro: null });
    try {
      const lista = await api.listarPipelines({ workspace_id: ws, so_ativos: true, limite: 50 });
      if (g !== geracao) return;
      publicar({ ativos: lista, carregando: false });
      if (estado.selecionadoId !== null) void carregarDetalhe(estado.selecionadoId, false);
    } catch (e) {
      if (g !== geracao) return;
      if (ehCanalAusente(e)) publicar({ disponivel: false, carregando: false });
      else publicar({ erro: `Não foi possível listar os pipelines: ${msg(e)}`, carregando: false });
    }
  }
  async function carregarDetalhe(id: string, mostrarCarga: boolean): Promise<void> {
    const api = obterApi();
    if (!usavel(api)) return;
    if (mostrarCarga) publicar({ detalheCarregando: true, detalheErro: null });
    try {
      const d = await api.detalhe(id);
      if (estado.selecionadoId === id) publicar({ detalhe: d, detalheCarregando: false, detalheErro: d === null ? "Pipeline não encontrado." : null });
    } catch (e) {
      if (estado.selecionadoId === id) publicar({ detalheCarregando: false, detalheErro: `Não foi possível abrir o pipeline: ${msg(e)}` });
    }
  }
  const coalescido = (): void => {
    if (agendado) return;
    agendado = true;
    quadro(() => { agendado = false; void recarregar(); });
  };
  const ligarEventos = (): void => {
    if (cancelar !== null) return;
    const api = obterApi();
    if (!usavel(api) || typeof api.assinar !== "function") return;
    cancelar = api.assinar((e) => { if (e.workspace_id === estado.workspaceId) coalescido(); });
  };

  return {
    obter: (): EstadoStoreMaestro => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    ligarEventos,
    desligarEventos(): void { cancelar?.(); cancelar = null; },

    definirWorkspace(id: string | null): Promise<void> {
      if (id === estado.workspaceId && estado.ativos !== null) return Promise.resolve();
      publicar({ workspaceId: id, ativos: null, selecionadoId: null, detalhe: null, plano: null, etapasPrevia: null, ajustes: AJUSTES_VAZIOS, exigencia: null, erroPedido: null });
      ligarEventos();
      return recarregar();
    },
    recarregar,
    async selecionar(id: string | null): Promise<void> {
      publicar({ selecionadoId: id, detalhe: null, detalheErro: null });
      if (id !== null) await carregarDetalhe(id, true);
    },

    /** Pede o plano (via "paleta"). Nunca abre terminal: só propõe. */
    async pedir(texto: string, contexto: ContextoPedido | null = null, nivelPedido: NivelRigidez | null = null): Promise<boolean> {
      const api = obterApi();
      const ws = estado.workspaceId;
      const problema = problemaDoTexto(texto);
      if (problema !== null) { publicar({ erroPedido: problema }); return false; }
      if (!usavel(api) || ws === null) { publicar({ erroPedido: ws === null ? "Abra um projeto antes de pedir ao Maestro." : "O Maestro só funciona no aplicativo." }); return false; }
      publicar({ pedindo: true, erroPedido: null, plano: null, etapasPrevia: null, ajustes: { ...AJUSTES_VAZIOS, nivel: nivelPedido }, exigencia: null });
      try {
        const r = await api.pedir({ workspace_id: ws, texto, contexto, via: "paleta", nivel_pedido: nivelPedido, executar_direto: null });
        publicar({ pedindo: false, plano: r });
        void recarregar();
        return true;
      } catch (e) {
        publicar({ pedindo: false, erroPedido: `O Maestro não conseguiu montar o plano: ${msg(e)}` });
        return false;
      }
    },
    ajustar(p: Partial<AjustesDoPlano>): void { publicar({ ajustes: { ...estado.ajustes, ...p } }); },
    /** Muda o nível ANTES de executar: relê as etapas pela prévia (sem efeito no disco). */
    async mudarNivelDoPlano(nivel: NivelRigidez): Promise<void> {
      const plano = estado.plano?.plano;
      const ws = estado.workspaceId;
      publicar({ ajustes: { ...estado.ajustes, nivel, justificativa: null, confirmacaoDigitada: null }, exigencia: null });
      const api = obterPrevia();
      if (plano === undefined || ws === null || api === undefined || typeof api.previaPlano !== "function") return;
      try { publicar({ etapasPrevia: await api.previaPlano({ workspace_id: ws, pipeline_id: plano.pipeline_id, nivel }) }); } catch (e) { publicar({ aviso: `Não foi possível recalcular as etapas: ${msg(e)}` }); }
    },
    alternarEtapa(etapaId: string): void {
      const d = new Set(estado.ajustes.etapasDesligadas);
      if (d.has(etapaId)) d.delete(etapaId); else d.add(etapaId);
      publicar({ ajustes: { ...estado.ajustes, etapasDesligadas: [...d] } });
    },
    /** Executar: `maestro:confirmar`. Erros de trava/confirmação viram `exigencia` (diálogo próprio). */
    async confirmar(): Promise<boolean> {
      const api = obterApi();
      const p = estado.plano?.plano;
      if (!usavel(api) || p === undefined) return false;
      const a = estado.ajustes;
      publicar({ confirmando: true, erroPedido: null });
      try {
        const r = await api.confirmar({ plano_id: p.id, nivel: a.nivel, etapas_desligadas: [...a.etapasDesligadas], intencao: a.intencao, justificativa: a.justificativa, confirmacao_digitada: a.confirmacaoDigitada });
        publicar({ confirmando: false, plano: null, etapasPrevia: null, ajustes: AJUSTES_VAZIOS, exigencia: null, selecionadoId: r.id });
        await recarregar();
        await carregarDetalhe(r.id, true);
        return true;
      } catch (e) {
        const ex = exigenciaDoErro(e);
        if (ex !== null) { publicar({ confirmando: false, exigencia: ex }); return false; }
        publicar({ confirmando: false, erroPedido: `Não foi possível executar o plano: ${msg(e)}` });
        return false;
      }
    },
    /** Cancelar o plano proposto, ou "tratar neste painel" (mesmo efeito: o plano é descartado e o painel segue normal). */
    async descartarPlano(): Promise<void> {
      const api = obterApi();
      const p = estado.plano?.plano;
      publicar({ plano: null, etapasPrevia: null, ajustes: AJUSTES_VAZIOS, exigencia: null, erroPedido: null });
      if (usavel(api) && p !== undefined) { try { await api.cancelar(p.id); } catch { /* o plano expira sozinho */ } void recarregar(); }
    },
    async acao(id: string, acao: AcaoDoPipelineIpc, etapaId: string | null): Promise<void> {
      const api = obterApi();
      if (!usavel(api)) return;
      publicar({ ocupadoAcao: true, aviso: null });
      try {
        await api.acao({ id, acao, etapa_id: etapaId });
        publicar({ ocupadoAcao: false });
        await recarregar();
        if (estado.selecionadoId === id) await carregarDetalhe(id, false);
      } catch (e) { publicar({ ocupadoAcao: false, aviso: `Não foi possível executar a ação: ${msg(e)}` }); }
    },
    async cancelarPipeline(id: string): Promise<void> {
      const api = obterApi();
      if (!usavel(api)) return;
      publicar({ ocupadoAcao: true, aviso: null });
      try { await api.cancelar(id); publicar({ ocupadoAcao: false }); await recarregar(); if (estado.selecionadoId === id) await carregarDetalhe(id, false); } catch (e) { publicar({ ocupadoAcao: false, aviso: `Não foi possível cancelar: ${msg(e)}` }); }
    },
    limparExigencia(): void { publicar({ exigencia: null, ajustes: { ...estado.ajustes, justificativa: null, confirmacaoDigitada: null } }); },
    limparAviso(): void { publicar({ aviso: null }); },
    _reiniciar(): void { geracao++; cancelar?.(); cancelar = null; estado = INICIAL; ouvintes.forEach((o) => o()); },
  };
}
export type StoreMaestro = ReturnType<typeof criarStoreMaestro>;
export const storeMaestro = criarStoreMaestro();

export function useMaestro(store: StoreMaestro = storeMaestro): EstadoStoreMaestro {
  return useSyncExternalStore(store.assinar, store.obter);
}
