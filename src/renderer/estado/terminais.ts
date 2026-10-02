import { useSyncExternalStore } from "react";
import {
  LIMITES_TERMINAIS,
  type AtividadeTerminal,
  type EstadoSessao,
  type EventoTerminal,
  type FerramentaDetectada,
  type FerramentaId,
  type MetadadosSessao,
} from "../../compartilhado/terminais";
import type { ApiAde } from "../../compartilhado/ipc";
import { armazemDeSaida, type Armazem } from "../componentes/Terminal/armazem";
import { bytesDoChunk } from "../componentes/Terminal/dimensao";
import { ponte } from "../ponte";
import { storeConfig } from "./config";

type ApiTerminais = ApiAde["terminais"];

export interface SessaoUI {
  sessao_id: string;
  ferramenta_id: FerramentaId;
  /** D-570: workspace de origem da sessão (a tela Terminais só mostra as do workspace atual); `null` = sem projeto (legada ou terminal avulso). */
  workspace_id?: string | null;
  /** número de exibição (`#n`): crescente e nunca reutilizado nesta execução. */
  numero: number;
  estado: EstadoSessao;
  atividade?: AtividadeTerminal;
  mensagem: string | null;
  codigo_saida: number | null;
  /** aberta pelo main (worker de painel que orquestra, Pane de squad…) e adotada por `listarSessoes`; a Tela decide onde pôr na grade. */
  externa?: boolean;
  /** subagentes INTERNOS da CLI (somente leitura; nunca viram sessão): total já iniciado e quantos seguem vivos. */
  subagentes?: { total: number; ativos: number };
}

export interface EstadoTerminais {
  sessoes: readonly SessaoUI[];
  /** null = ainda não carregou. */
  ferramentas: readonly FerramentaDetectada[] | null;
  erroFerramentas: string | null;
  /** a recuperação de sessões que sobreviveram terminou (só então o layout pode ser gravado). */
  recuperado: boolean;
  /** aberturas em curso (sessão ainda provisória: layout não é gravado). */
  pendentes: number;
  /** sessões em execução esperando a pessoa (contador do rodapé). */
  aguardando: number;
  falhas: Readonly<Record<string, string>>;
  erro: string | null;
  /** há API do main (falso em navegador/teste sem ponte). */
  disponivel: boolean;
}

interface Deps {
  api: () => ApiTerminais | undefined;
  armazem: Armazem;
  agora?: () => string;
  /** Limite de sessões da janela (config `limite_paineis`); lido a cada abertura. Padrão: o do contrato. */
  limite?: () => number;
}

export function criarStoreTerminais({ api: obterApi, armazem, agora = () => new Date().toISOString(), limite = () => LIMITES_TERMINAIS.sessoes_por_janela }: Deps) {
  const sessoes = new Map<string, SessaoUI>();
  const antecipado = new Map<string, Partial<SessaoUI>>(); // eventos que chegaram antes do registro
  const fechadas = new Set<string>();
  /** ids dos subagentes internos VIVOS por sessão (o total é só um número em `SessaoUI.subagentes`). */
  const subagentesVivos = new Map<string, Set<string>>();
  let sincronia: ReturnType<typeof setTimeout> | null = null;
  /** aberturas pedidas ao main (painel livre) em curso: a sincronia espera, para não adotar como externa a sessão que o próprio renderer vai pôr na grade. */
  let seguros = 0;
  const falhas: Record<string, string> = {};
  const ouvintes = new Set<() => void>();
  let contador = 0;
  let iniciado: Promise<void> | null = null;
  let estado: EstadoTerminais = {
    sessoes: [], ferramentas: null, erroFerramentas: null, recuperado: false, pendentes: 0, aguardando: 0, falhas: {}, erro: null, disponivel: true,
  };

  const publicar = (parcial: Partial<EstadoTerminais> = {}): void => {
    const lista = [...sessoes.values()];
    estado = {
      ...estado,
      ...parcial,
      sessoes: lista,
      falhas: { ...falhas },
      aguardando: lista.filter((s) => s.estado === "executando" && s.atividade === "aguardando").length,
    };
    ouvintes.forEach((o) => o());
  };

  const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  const registrar = (meta: Pick<MetadadosSessao, "sessao_id" | "ferramenta_id" | "estado"> & { workspace_id?: string | null }): SessaoUI => {
    const existente = sessoes.get(meta.sessao_id);
    if (existente !== undefined) return existente;
    const nova: SessaoUI = { sessao_id: meta.sessao_id, ferramenta_id: meta.ferramenta_id, workspace_id: meta.workspace_id ?? null, numero: ++contador, estado: meta.estado, mensagem: null, codigo_saida: null, ...antecipado.get(meta.sessao_id) };
    antecipado.delete(meta.sessao_id);
    sessoes.set(nova.sessao_id, nova);
    return nova;
  };

  const alterar = (id: string, mudanca: Partial<SessaoUI>): void => {
    const atual = sessoes.get(id);
    if (atual === undefined) antecipado.set(id, { ...antecipado.get(id), ...mudanca });
    else sessoes.set(id, { ...atual, ...mudanca });
  };

  const ATRASO_SINCRONIA_MS = 60;

  /** Sessões abertas pelo main (workers, Panes de squad): registra as que o store ainda não conhece, marcadas `externa`. */
  async function sincronizar(): Promise<string[]> {
    const api = obterApi();
    if (api === undefined || typeof api.listarSessoes !== "function") return [];
    let lista: MetadadosSessao[];
    try { lista = await api.listarSessoes(); } catch { return []; }
    const novas: string[] = [];
    for (const meta of lista) {
      if (sessoes.has(meta.sessao_id) || fechadas.has(meta.sessao_id) || meta.estado === "encerrada" || meta.estado === "erro") continue;
      const nova = registrar(meta);
      sessoes.set(nova.sessao_id, { ...nova, externa: true });
      novas.push(meta.sessao_id);
    }
    if (novas.length > 0) publicar();
    return novas;
  }

  function agendarSincronia(): void {
    if (sincronia !== null) return;
    sincronia = setTimeout(() => {
      sincronia = null;
      // abertura do próprio renderer em curso: o `abrir` registra a sessão; tenta de novo logo depois
      if (estado.pendentes > 0 || seguros > 0) { agendarSincronia(); return; }
      void sincronizar();
    }, ATRASO_SINCRONIA_MS);
  }

  function contarSubagente(id: string, e: Extract<EventoTerminal, { tipo: "subagente_iniciado" | "subagente_concluido" }>): void {
    const atual = sessoes.get(id);
    if (atual === undefined) return;
    const vivos = subagentesVivos.get(id) ?? new Set<string>();
    let total = atual.subagentes?.total ?? 0;
    if (e.tipo === "subagente_iniciado") {
      if (!vivos.has(e.subagente_id)) { vivos.add(e.subagente_id); total += 1; }
    } else vivos.delete(e.subagente_id);
    subagentesVivos.set(id, vivos);
    sessoes.set(id, { ...atual, subagentes: { total, ativos: vivos.size } });
  }

  function tratar(e: EventoTerminal): void {
    const id = e.sessao_id;
    if (fechadas.has(id)) return;
    if (!sessoes.has(id) && estado.recuperado) agendarSincronia();
    if (e.tipo === "saida") {
      if (!armazem.empurrar(id, e.sequencia, e.dados).aceito) return;
      // ninguém com o terminal montado: o dado fica retido no armazém, então o consumo é confirmado aqui
      if (armazem.assinantes(id) === 0) void obterApi()?.confirmarConsumo(id, bytesDoChunk(e.dados)).catch(() => undefined);
      return; // saída não muda estado de UI: nada de re-render
    }
    if (!armazem.registrarSequencia(id, e.sequencia)) return;
    if (e.tipo === "fechada") {
      // D-520: o app fechou a sessão de propósito (orquestrador, dono, fim do trabalho): o painel sai da grade na hora, sem "Sessão encerrada" pendurada.
      // O main já descartou a sessão: aqui só se esquece dela (a árvore a tira e a grade reflui).
      fechadas.add(id);
      sessoes.delete(id);
      antecipado.delete(id);
      subagentesVivos.delete(id);
      delete falhas[id];
      armazem.descartar(id);
      publicar();
      return;
    }
    if (e.tipo === "estado") alterar(id, { estado: e.estado, mensagem: e.mensagem });
    // `solicitado`: o app pediu o encerramento, então o código (143 do SIGTERM) não é resultado da CLI e nunca aparece como tal
    else if (e.tipo === "encerramento") alterar(id, { estado: "encerrada", codigo_saida: e.solicitado === true ? null : e.codigo });
    else if (e.tipo === "atividade") alterar(id, { atividade: e.atividade });
    else if (e.tipo === "subagente_iniciado" || e.tipo === "subagente_concluido") contarSubagente(id, e);
    else return;
    publicar();
  }

  return {
    obter: (): EstadoTerminais => estado,
    assinar(ouvinte: () => void): () => void {
      ouvintes.add(ouvinte);
      return () => void ouvintes.delete(ouvinte);
    },
    /** UMA assinatura global do main, repartida por sessão; depois recupera as sessões que sobreviveram. Idempotente. */
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        const api = obterApi();
        if (api === undefined) { publicar({ recuperado: true, disponivel: false }); return; }
        api.assinarEventos(tratar);
        api.assinarFalhas((f) => { falhas[f.sessao_id] = f.mensagem; publicar(); });
        try {
          const r = await api.recuperar();
          for (const meta of r.sessoes) registrar(meta);
          publicar({ recuperado: true });
        } catch (e) {
          publicar({ recuperado: true, erro: `Não foi possível recuperar as sessões: ${mensagemDe(e)}` });
        }
      })();
      return iniciado;
    },
    async carregarFerramentas(forcar = false): Promise<void> {
      const api = obterApi();
      if (api === undefined) return;
      try {
        publicar({ ferramentas: await api.listarFerramentas(forcar), erroFerramentas: null });
      } catch (e) {
        publicar({ ferramentas: [], erroFerramentas: mensagemDe(e) });
      }
    },
    /** Abre a sessão; devolve o id real (a UI só põe na árvore depois disso: nunca há id provisório no layout). */
    async abrir(ferramenta: FerramentaDetectada, opcoes: { colunas?: number; linhas?: number; workspaceId?: string | null } = {}): Promise<string | null> {
      const api = obterApi();
      if (api === undefined || ferramenta.executavel_id === null) return null;
      const max = limite();
      if ([...sessoes.values()].filter((s) => s.estado !== "encerrada" && s.estado !== "erro").length + estado.pendentes >= max) {
        publicar({ erro: `Limite de ${max} sessões por janela. Feche uma para abrir outra ou aumente o limite em Configurações.` });
        return null;
      }
      publicar({ pendentes: estado.pendentes + 1, erro: null });
      try {
        const r = await api.abrir({
          versao: 1, ferramenta_id: ferramenta.id, executavel_id: ferramenta.executavel_id, argumentos: [],
          colunas: opcoes.colunas ?? 120, linhas: opcoes.linhas ?? 30, workspace_id: opcoes.workspaceId ?? null,
        });
        registrar({ sessao_id: r.sessao_id, ferramenta_id: ferramenta.id, estado: r.estado, workspace_id: opcoes.workspaceId ?? null });
        publicar({ pendentes: estado.pendentes - 1 });
        return r.sessao_id;
      } catch (e) {
        publicar({ pendentes: estado.pendentes - 1, erro: `Não foi possível abrir ${ferramenta.nome}: ${mensagemDe(e)}` });
        return null;
      }
    },
    /** Fecha de vez: encerra o processo se vive e apaga sessão e histórico. */
    fechar(id: string): void {
      fechadas.add(id);
      sessoes.delete(id);
      antecipado.delete(id);
      subagentesVivos.delete(id);
      delete falhas[id];
      armazem.descartar(id);
      void obterApi()?.descartar(id).catch(() => undefined);
      publicar();
    },
    interromper(id: string): void { obterApi()?.interromper(id); },
    limparErro(): void { if (estado.erro !== null) publicar({ erro: null }); },
    nomeDaFerramenta(id: FerramentaId): string {
      return estado.ferramentas?.find((f) => f.id === id)?.nome ?? id;
    },
    /** Adota a sessão que o main abriu a pedido desta janela (`painelLivre.abrir/orquestrar`): registra sem marcar `externa` (a Tela a põe na grade). */
    adotar(meta: Pick<MetadadosSessao, "sessao_id" | "ferramenta_id" | "estado"> & { workspace_id?: string | null }): void {
      fechadas.delete(meta.sessao_id);
      const existente = sessoes.get(meta.sessao_id);
      if (existente?.externa === true) { const { externa: _x, ...resto } = existente; void _x; sessoes.set(meta.sessao_id, resto); } else registrar(meta);
      publicar();
    },
    /** Segura a sincronia de sessões externas enquanto uma abertura pedida ao main não volta; devolve quem solta. */
    segurarSincronia(): () => void {
      seguros += 1;
      let solto = false;
      return () => { if (!solto) { solto = true; seguros = Math.max(0, seguros - 1); } };
    },
    /** Procura sessões abertas pelo main que o store ainda não conhece (workers); devolve os ids novos. */
    sincronizar,
    /** Só para teste. */
    tratar,
  };
}

export type StoreTerminais = ReturnType<typeof criarStoreTerminais>;

/** Store da interface: lê a API do preload só na hora de usar (a ponte pode não existir no import). */
export const storeTerminais: StoreTerminais = criarStoreTerminais({ api: () => ponte()?.terminais, armazem: armazemDeSaida, limite: () => storeConfig.obter().limitePaineis });

export function useTerminais(store: StoreTerminais = storeTerminais): EstadoTerminais {
  return useSyncExternalStore(store.assinar, store.obter);
}

/** Contador "N aguardando você" para o rodapé (primitivo: só re-renderiza quando o número muda). */
export function useAguardando(store: StoreTerminais = storeTerminais): number {
  return useSyncExternalStore(store.assinar, () => store.obter().aguardando);
}
