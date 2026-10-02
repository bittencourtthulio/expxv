// Estado do seletor de rigidez (Fase 16, T-16.31). `useSyncExternalStore`: só o seletor e os badges re-renderizam.
// O evento `rigidez:evento` é coalescido em 1 quadro e só RELÊ o estado efetivo. Nada roda no boot além de uma leitura leve (e só com API presente).
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { EscopoRigidez, EstadoHooksDto, EstadoRigidez, MatrizRigidezDto, NivelRigidez, PedidoDefinirRigidez, ResultadoDefinirRigidez } from "../../compartilhado/maestro";
import { exigenciaDoErro, exigenciaPrevia, type Exigencia } from "../telas/pipelines/logica";
import { ade } from "../ade";
import { ehCanalAusente } from "./carga";

type Api = ApiAde["rigidez"];

export interface PendenteRigidez {
  nivel: NivelRigidez;
  escopo: EscopoRigidez;
  voltarAoPadrao: boolean;
  aplicarHooksJa: boolean;
  /** o que já foi digitado em passos anteriores (justificativa e depois frase) e segue junto. */
  justificativa: string | null;
  confirmacaoDigitada: string | null;
  exigencia: Exigencia;
}
export interface EstadoStoreRigidez {
  disponivel: boolean;
  workspaceId: string | null;
  missionId: string | null;
  estado: EstadoRigidez | null;
  matriz: MatrizRigidezDto | null;
  hooks: EstadoHooksDto | null;
  carregando: boolean;
  ocupado: boolean;
  erro: string | null;
  /** nível escolhido e ainda não confirmado (diálogo de confirmação/justificativa). */
  pendente: PendenteRigidez | null;
  ultimo: ResultadoDefinirRigidez | null;
  /** contador: cada pedido de "abra os detalhes da rigidez" (ex.: "Ativar proteções" do Método); o seletor abre o popover quando muda. */
  pedidoAbrir: number;
}
export interface OpcoesDefinir {
  escopo?: EscopoRigidez;
  voltarAoPadrao?: boolean;
  aplicarHooksJa?: boolean;
  justificativa?: string | null;
  confirmacaoDigitada?: string | null;
  planoId?: string | null;
}
export interface OpcoesStoreRigidez {
  api?: () => Api | undefined;
  quadro?: (fn: () => void) => void;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const INICIAL: EstadoStoreRigidez = { disponivel: true, workspaceId: null, missionId: null, estado: null, matriz: null, hooks: null, carregando: false, ocupado: false, erro: null, pendente: null, ultimo: null, pedidoAbrir: 0 };

export function criarStoreRigidez(op: OpcoesStoreRigidez = {}) {
  const obterApi = op.api ?? (() => ade()?.rigidez);
  const quadro = op.quadro ?? ((fn: () => void) => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn()); else setTimeout(fn, 16); });
  const ouvintes = new Set<() => void>();
  let estado: EstadoStoreRigidez = INICIAL;
  let geracao = 0;
  let cancelarAssinatura: (() => void) | null = null;
  let agendado = false;

  const publicar = (p: Partial<EstadoStoreRigidez>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const usavel = (a: Api | undefined): a is Api => a !== undefined && typeof a.ler === "function";

  async function ler(): Promise<void> {
    const api = obterApi();
    const ws = estado.workspaceId;
    if (!usavel(api)) { publicar({ disponivel: false, carregando: false }); return; }
    if (ws === null) { publicar({ estado: null, carregando: false }); return; }
    const g = ++geracao;
    publicar({ carregando: true, erro: null });
    try {
      const e = await api.ler({ workspace_id: ws, mission_id: estado.missionId, plano_id: null });
      if (g === geracao) publicar({ estado: e, carregando: false });
    } catch (e) {
      if (g !== geracao) return;
      if (ehCanalAusente(e)) publicar({ disponivel: false, carregando: false });
      else publicar({ erro: `Não foi possível ler a rigidez: ${msg(e)}`, carregando: false });
    }
  }

  const coalescido = (): void => {
    if (agendado) return;
    agendado = true;
    quadro(() => { agendado = false; void ler(); });
  };

  const ligarEventos = (): void => {
    if (cancelarAssinatura !== null) return;
    const api = obterApi();
    if (!usavel(api) || typeof api.assinar !== "function") return;
    cancelarAssinatura = api.assinar((e) => { if (e.workspace_id === estado.workspaceId) coalescido(); });
  };
  async function carregarHooks(): Promise<void> {
    const api = obterApi();
    const ws = estado.workspaceId;
    if (!usavel(api) || ws === null) return;
    try { publicar({ hooks: await api.hooksEstado({ workspace_id: ws, mission_id: estado.missionId }) }); } catch (e) { if (!ehCanalAusente(e)) publicar({ erro: `Não foi possível ler os hooks: ${msg(e)}` }); }
  }

  return {
    obter: (): EstadoStoreRigidez => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },

    /** Define o contexto (workspace e Missão em foco) e relê o nível efetivo. Idempotente para o mesmo par. */
    definirContexto(workspaceId: string | null, missionId: string | null = null): Promise<void> {
      if (workspaceId === estado.workspaceId && missionId === estado.missionId && (estado.estado !== null || estado.carregando)) return Promise.resolve();
      publicar({ workspaceId, missionId, estado: workspaceId === estado.workspaceId ? estado.estado : null, hooks: null, pendente: null });
      ligarEventos();
      return ler();
    },
    ligarEventos,
    desligarEventos(): void { cancelarAssinatura?.(); cancelarAssinatura = null; },
    recarregar: ler,

    /** Matriz estática (nomes e descrição ligado/desligado dos níveis): só quando o popover abre. */
    async carregarMatriz(): Promise<void> {
      const api = obterApi();
      if (!usavel(api) || estado.matriz !== null) return;
      try { publicar({ matriz: await api.matriz() }); } catch (e) { if (!ehCanalAusente(e)) publicar({ erro: `Não foi possível ler os níveis: ${msg(e)}` }); }
    },
    carregarHooks,
    async reverterHooks(): Promise<string[]> {
      const api = obterApi();
      const ws = estado.workspaceId;
      if (!usavel(api) || ws === null) return [];
      try {
        const r = await api.hooksReverter({ workspace_id: ws, mission_id: estado.missionId });
        await carregarHooks();
        return r.revertidas;
      } catch (e) { publicar({ erro: `Não foi possível reverter os hooks: ${msg(e)}` }); return []; }
    },

    /**
     * Muda o nível. Abaixo do mínimo travado: pede justificativa antes de chamar; erros nominais do main
     * (`confirmacao_necessaria`/`abaixo_do_minimo`) viram o diálogo certo em `pendente`. Devolve se aplicou.
     */
    async definir(nivel: NivelRigidez, o: OpcoesDefinir = {}): Promise<boolean> {
      const api = obterApi();
      const ws = estado.workspaceId;
      if (!usavel(api) || ws === null) return false;
      const escopo: EscopoRigidez = o.escopo ?? (estado.pendente?.escopo ?? "workspace");
      const base = { nivel, escopo, voltarAoPadrao: o.voltarAoPadrao ?? estado.pendente?.voltarAoPadrao ?? escopo === "pedido", aplicarHooksJa: o.aplicarHooksJa ?? estado.pendente?.aplicarHooksJa ?? false, justificativa: o.justificativa ?? estado.pendente?.justificativa ?? null, confirmacaoDigitada: o.confirmacaoDigitada ?? estado.pendente?.confirmacaoDigitada ?? null };
      const minimo = estado.estado?.minimo_travado ?? 1;
      const previa = base.justificativa === null ? exigenciaPrevia(nivel, minimo, estado.estado?.motivo_trava ?? null) : null;
      if (previa !== null) { publicar({ pendente: { ...base, exigencia: previa } }); return false; }
      const pedido: PedidoDefinirRigidez = {
        workspace_id: ws, escopo, mission_id: escopo === "missao" ? estado.missionId : null, plano_id: o.planoId ?? null, nivel,
        justificativa: base.justificativa, confirmacao_digitada: base.confirmacaoDigitada, aplicar_hooks_ja: base.aplicarHooksJa, voltar_ao_padrao: base.voltarAoPadrao,
      };
      publicar({ ocupado: true, erro: null });
      try {
        const r = await api.definir(pedido);
        publicar({ ocupado: false, pendente: null, estado: r.estado, ultimo: r });
        return true;
      } catch (e) {
        const ex = exigenciaDoErro(e);
        if (ex !== null) { publicar({ ocupado: false, pendente: { ...base, exigencia: ex } }); return false; }
        publicar({ ocupado: false, pendente: null, erro: `Não foi possível mudar a rigidez: ${msg(e)}` });
        return false;
      }
    },
    descartarPendente(): void { publicar({ pendente: null }); },
    /** Pede ao seletor do topo que abra o popover de detalhes (hooks, prévia e "Aplicar"): nada é escrito aqui. */
    pedirAbrir(): void { publicar({ pedidoAbrir: estado.pedidoAbrir + 1 }); },
    limparErro(): void { publicar({ erro: null }); },
    /** testes */
    _reiniciar(): void { geracao++; cancelarAssinatura?.(); cancelarAssinatura = null; estado = INICIAL; ouvintes.forEach((o) => o()); },
  };
}
export type StoreRigidez = ReturnType<typeof criarStoreRigidez>;
export const storeRigidez = criarStoreRigidez();

export function useRigidez(store: StoreRigidez = storeRigidez): EstadoStoreRigidez {
  return useSyncExternalStore(store.assinar, store.obter);
}
