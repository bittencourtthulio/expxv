// Estado da suíte ExpxDev no renderer (D-470…): o botão "Instalar suíte ExpxDev" do cabeçalho, as linhas de ação (card do workspace, tela Método) e o modal.
// Lazy: nada é pedido ao main no boot; só o estado do workspace atual em ocioso e, por card, quando o card aparece. A instalação só começa por clique.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { EstadoModulosSuite, EstadoSuite, EventoSuite, ModoInstalacao, PadraoModulos, PlanoSuite, ProgressoSuite } from "../../compartilhado/suite";
import { ade } from "../ade";
import { pedirTela } from "./navegacao";
import { storeWorkspaces, type StoreWorkspaces } from "./workspaces";

type Api = ApiAde["suite"];

export interface EstadoSuiteUI {
  workspaceId: string | null;
  /** estado por workspace (cards e cabeçalho) */
  estados: Readonly<Record<string, EstadoSuite>>;
  modal: boolean;
  plano: PlanoSuite | null;
  carregandoPlano: boolean;
  progresso: ProgressoSuite | null;
  /** o usuário pediu para cancelar (Esc ou botão): pergunta antes */
  confirmandoCancelar: boolean;
  erro: string | null;
  ocupado: boolean;
  disponivel: boolean;
  /** módulos da suíte por workspace (D-480) */
  modulos: Readonly<Record<string, EstadoModulosSuite>>;
  /** ligar/desligar que exige confirmação (cascata): o painel pergunta antes de mudar mais de um módulo */
  confirmandoModulo: { workspaceId: string; modulo: string; ligado: boolean; tipo: "desligar_dependentes" | "ligar_requisitos"; modulos: string[] } | null;
  erroModulos: string | null;
  /** padrão global "módulos para projetos novos" */
  padraoGlobal: PadraoModulos | null;
  /** aba que a tela Método deve abrir ao entrar (pedida pelo modal: "ajustar módulos"); a tela consome e limpa */
  metodoAba: "modulos" | null;
}

export interface OpcoesStoreSuite {
  api: () => Api | undefined;
  workspaces?: Pick<StoreWorkspaces, "obter" | "assinar">;
  irParaMetodo?: () => void;
  ocioso?: (fn: () => void) => void;
  /** validade do estado por card, em ms (padrão 60 s) */
  validadeMs?: number;
  agora?: () => number;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const agendarOcioso = (fn: () => void): void => {
  const w = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(fn, { timeout: 4_000 });
  else setTimeout(fn, 2_000);
};

/** O botão do cabeçalho: o que mostrar para o estado atual. Pura (testada). */
export interface ApresentacaoBotaoSuite {
  visivel: boolean;
  modo: ModoInstalacao | null;
  rotulo: string;
  /** só a ação ("Instalar", "Reparar", "Atualizar", "Instalando…") para a largura média do cabeçalho */
  rotuloCurto: string;
  tooltip: string;
  tom: "primario" | "discreto";
  instalando: boolean;
  percentual: number | null;
}

export function apresentarBotaoSuite(estado: EstadoSuite | null, progresso: ProgressoSuite | null): ApresentacaoBotaoSuite {
  const oculto: ApresentacaoBotaoSuite = { visivel: false, modo: null, rotulo: "", rotuloCurto: "", tooltip: "", tom: "primario", instalando: false, percentual: null };
  if (estado === null) return oculto;
  if (estado.instalando || progresso?.fase === "rodando") {
    const p = progresso !== null && progresso.workspace_id === estado.workspace_id && progresso.fase === "rodando" ? progresso.percentual : null;
    return { visivel: true, modo: null, rotulo: p === null ? "Instalando…" : `Instalando… ${p}%`, rotuloCurto: p === null ? "Instalando…" : `${p}%`, tooltip: "Instalação da suíte ExpxDev em andamento: clique para acompanhar.", tom: "primario", instalando: true, percentual: p };
  }
  switch (estado.estado) {
    case "ausente":
      return estado.dispensado ? oculto : { visivel: true, modo: "instalar", rotulo: "Instalar suíte ExpxDev", rotuloCurto: "Instalar", tooltip: "Este projeto não tem a suíte ExpxDev. Clique para instalar (você confirma antes).", tom: "primario", instalando: false, percentual: null };
    case "incompleta":
      return estado.dispensado ? oculto : { visivel: true, modo: "reparar", rotulo: "Reparar suíte ExpxDev", rotuloCurto: "Reparar", tooltip: `A suíte ExpxDev está incompleta: ${estado.motivo} Clique para reparar.`, tom: "primario", instalando: false, percentual: null };
    case "desatualizada":
      return estado.dispensado ? oculto : { visivel: true, modo: "atualizar", rotulo: "Atualizar suíte ExpxDev", rotuloCurto: "Atualizar", tooltip: `${estado.motivo} Atualizar é opcional.`, tom: "discreto", instalando: false, percentual: null };
    default:
      return oculto;
  }
}

export function criarStoreSuite(op: OpcoesStoreSuite) {
  const workspaces = op.workspaces ?? storeWorkspaces;
  const agora = op.agora ?? Date.now;
  const ouvintes = new Set<() => void>();
  let estado: EstadoSuiteUI = {
    workspaceId: null, estados: {}, modal: false, plano: null, carregandoPlano: false, progresso: null, confirmandoCancelar: false, erro: null, ocupado: false, disponivel: true,
    modulos: {}, confirmandoModulo: null, erroModulos: null, padraoGlobal: null, metodoAba: null,
  };
  const buscados = new Map<string, number>();
  let ligado = false;
  /** card de OUTRO workspace clicado: abre o modal assim que o app trocar para ele */
  let pendenteAbrir: string | null = null;
  let desligar: Array<() => void> = [];

  const publicar = (p: Partial<EstadoSuiteUI>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const guardarEstado = (e: EstadoSuite): void => publicar({ estados: { ...estado.estados, [e.workspace_id]: e } });
  const api = (): Api | undefined => op.api();
  const ws = (): string | null => estado.workspaceId;

  async function garantirEstado(id: string, forcar = false): Promise<void> {
    const a = api();
    if (a === undefined) return;
    const visto = buscados.get(id);
    if (!forcar && visto !== undefined && agora() - visto < (op.validadeMs ?? 60_000)) return;
    buscados.set(id, agora());
    try { guardarEstado(await a.estado(id)); } catch { /* sem serviço ou workspace sumiu: o botão simplesmente não aparece */ }
  }

  const modulosBuscados = new Map<string, number>();
  async function garantirModulos(id: string, forcar = false): Promise<void> {
    const a = api();
    if (a === undefined) return;
    const visto = modulosBuscados.get(id);
    if (!forcar && visto !== undefined && agora() - visto < (op.validadeMs ?? 60_000)) return;
    modulosBuscados.set(id, agora());
    try { publicar({ modulos: { ...estado.modulos, [id]: await a.modulosEstado(id) }, erroModulos: null }); } catch (e) { publicar({ erroModulos: msg(e) }); }
  }

  function aoEvento(ev: EventoSuite): void {
    if (ev.tipo === "estado") { guardarEstado(ev.estado); return; }
    if (ev.workspace_id !== ws()) {
      // progresso de outro workspace: só mantém o estado coerente do card
      if (ev.fase !== "rodando") void garantirEstado(ev.workspace_id, true);
      return;
    }
    publicar({ progresso: ev, ...(ev.fase === "rodando" ? {} : { confirmandoCancelar: false, ocupado: false }) });
    if (ev.fase !== "rodando") void garantirEstado(ev.workspace_id, true);
  }

  function seguirWorkspace(): void {
    const id = workspaces.obter().atual?.id ?? null;
    if (id === ws()) return;
    publicar({ workspaceId: id, modal: false, plano: null, progresso: null, confirmandoCancelar: false, erro: null, ocupado: false });
    if (id !== null) (op.ocioso ?? agendarOcioso)(() => void garantirEstado(id));
    if (id !== null && pendenteAbrir === id) { pendenteAbrir = null; api_abrirModal(); }
  }

  async function carregarPlano(): Promise<void> {
    const id = ws();
    const a = api();
    if (id === null || a === undefined) return;
    publicar({ carregandoPlano: true, erro: null });
    try {
      const plano = await a.requisitos(id);
      if (ws() === id) publicar({ plano, carregandoPlano: false });
    } catch (e) { publicar({ erro: msg(e), carregandoPlano: false }); }
  }

  function api_abrirModal(): void {
    const atual = ws() === null ? null : estado.estados[ws() as string] ?? null;
    publicar({ modal: true, confirmandoCancelar: false, erro: null, plano: null });
    if (atual?.instalando === true || estado.progresso?.fase === "rodando") return;
    publicar({ progresso: null });
    void carregarPlano();
  }

  return {
    obter: (): EstadoSuiteUI => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },

    /** Liga a assinatura do evento e o seguimento do workspace atual. Idempotente; devolve o desligador. */
    ligar(): () => void {
      if (!ligado) {
        ligado = true;
        const a = api();
        if (a === undefined) publicar({ disponivel: false });
        else {
          desligar.push(a.assinar(aoEvento));
          // a mudança de módulos (por este ou por outro painel/janela) relê o que já está na tela
          desligar.push(a.assinarModulos((e) => {
            if (e.workspace_id === null) { void this.carregarPadraoGlobal(); return; }
            if (estado.modulos[e.workspace_id] !== undefined) void garantirModulos(e.workspace_id, true);
          }));
        }
        desligar.push(workspaces.assinar(seguirWorkspace));
        seguirWorkspace();
      }
      return () => { desligar.forEach((d) => d()); desligar = []; ligado = false; };
    },

    garantirEstado,
    garantirModulos,
    /** Desligados do workspace (ids); vazio enquanto não foi lido. */
    desligadosDe: (id: string): ReadonlySet<string> => new Set(estado.modulos[id]?.desligados ?? []),
    estadoDe: (id: string): EstadoSuite | null => estado.estados[id] ?? null,

    /** Abre o modal: instalando → mostra o progresso; senão carrega os requisitos (local, sem rede). */
    abrirModal: api_abrirModal,
    /** Card de um workspace que não é o atual: o app troca para ele (quem chama) e o modal abre quando a troca chegar. */
    abrirModalPara(id: string): void {
      if (id === ws()) { api_abrirModal(); return; }
      pendenteAbrir = id;
    },
    /** Fecha sem cancelar nada (o modal só é fechável fora da instalação; durante ela o Esc pede confirmação). */
    fecharModal(): void { publicar({ modal: false, confirmandoCancelar: false, erro: null }); },

    async instalar(): Promise<void> {
      const id = ws();
      const a = api();
      const plano = estado.plano;
      if (id === null || a === undefined || plano === null || estado.ocupado || !plano.pode_instalar) return;
      publicar({ ocupado: true, erro: null, confirmandoCancelar: false });
      try { await a.instalar(id, plano.modo); publicar({ ocupado: false }); } catch (e) { publicar({ erro: msg(e), ocupado: false }); }
    },
    pedirCancelar(): void { publicar({ confirmandoCancelar: true }); },
    desistirCancelar(): void { publicar({ confirmandoCancelar: false }); },
    async cancelar(): Promise<void> {
      const id = ws();
      const a = api();
      if (id === null || a === undefined) return;
      publicar({ confirmandoCancelar: false });
      try { await a.cancelar(id); } catch (e) { publicar({ erro: msg(e) }); }
    },
    /** Falha/cancelamento → volta ao primeiro passo (os requisitos são relidos). */
    tentarDeNovo(): void {
      publicar({ progresso: null, confirmandoCancelar: false, erro: null, plano: null });
      void carregarPlano();
    },
    async dispensar(dispensar: boolean): Promise<void> {
      const id = ws();
      const a = api();
      if (id === null || a === undefined) return;
      try { guardarEstado(await a.dispensar(id, dispensar)); if (dispensar) publicar({ modal: false }); } catch (e) { publicar({ erro: msg(e) }); }
    },
    /** Liga/desliga um módulo. Se mudaria outros (dependentes/requisitos), pede confirmação ANTES: nunca em cascata em silêncio. */
    async alternarModulo(modulo: string, ligado: boolean): Promise<void> {
      const id = ws();
      const a = api();
      if (id === null || a === undefined) return;
      try {
        const r = await a.modulosDefinir(id, modulo, ligado, false);
        if (r.ok) publicar({ modulos: { ...estado.modulos, [id]: r.estado }, erroModulos: null, confirmandoModulo: null });
        else publicar({ modulos: { ...estado.modulos, [id]: r.estado }, confirmandoModulo: { workspaceId: id, modulo, ligado, tipo: r.precisa_confirmar.tipo, modulos: r.precisa_confirmar.modulos }, erroModulos: null });
      } catch (e) { publicar({ erroModulos: msg(e) }); }
    },
    async confirmarModulo(): Promise<void> {
      const c = estado.confirmandoModulo;
      const a = api();
      if (c === null || a === undefined) return;
      try {
        const r = await a.modulosDefinir(c.workspaceId, c.modulo, c.ligado, true);
        publicar({ modulos: { ...estado.modulos, [c.workspaceId]: r.estado }, confirmandoModulo: null, erroModulos: null });
      } catch (e) { publicar({ erroModulos: msg(e), confirmandoModulo: null }); }
    },
    cancelarConfirmacaoModulo(): void { publicar({ confirmandoModulo: null }); },
    async restaurarModulos(): Promise<void> {
      const id = ws();
      const a = api();
      if (id === null || a === undefined) return;
      try { publicar({ modulos: { ...estado.modulos, [id]: await a.modulosRestaurar(id) }, erroModulos: null, confirmandoModulo: null }); } catch (e) { publicar({ erroModulos: msg(e) }); }
    },
    async carregarPadraoGlobal(): Promise<void> {
      const a = api();
      if (a === undefined) return;
      try { publicar({ padraoGlobal: await a.modulosPadrao(), erroModulos: null }); } catch (e) { publicar({ erroModulos: msg(e) }); }
    },
    /** Devolve `null` se gravou, ou o texto do erro (o painel mostra ao lado). */
    async definirPadraoGlobal(modulos: Record<string, boolean>): Promise<string | null> {
      const a = api();
      if (a === undefined) return "Indisponível.";
      try { publicar({ padraoGlobal: await a.modulosPadraoDefinir(modulos), erroModulos: null }); return null; } catch (e) { return msg(e); }
    },
    abrirMetodo(aba?: "modulos"): void { publicar({ modal: false, metodoAba: aba ?? null }); (op.irParaMetodo ?? (() => pedirTela("metodo")))(); },
    limparAbaMetodo(): void { if (estado.metodoAba !== null) publicar({ metodoAba: null }); },
    limparErro(): void { if (estado.erro !== null) publicar({ erro: null }); },
  };
}

export type StoreSuite = ReturnType<typeof criarStoreSuite>;
export const storeSuite: StoreSuite = criarStoreSuite({ api: () => ade()?.suite });

export function useSuite(store: StoreSuite = storeSuite): EstadoSuiteUI {
  return useSyncExternalStore(store.assinar, store.obter);
}

/** Módulos desligados do workspace (ids) para esconder gestos/botões; lê do main uma vez por workspace (lazy). */
export function useModulosDesligados(workspaceId: string | null, store: StoreSuite = storeSuite): ReadonlySet<string> {
  const ui = useSuite(store);
  useEffect(() => { if (workspaceId !== null) void store.garantirModulos(workspaceId); }, [store, workspaceId]);
  const lista = workspaceId === null ? undefined : ui.modulos[workspaceId]?.desligados;
  return useMemo(() => new Set(lista ?? []), [lista]);
}
