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
  /** número de exibição (`#n`): crescente e nunca reutilizado nesta execução. */
  numero: number;
  estado: EstadoSessao;
  atividade?: AtividadeTerminal;
  mensagem: string | null;
  codigo_saida: number | null;
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

  const registrar = (meta: Pick<MetadadosSessao, "sessao_id" | "ferramenta_id" | "estado">): SessaoUI => {
    const existente = sessoes.get(meta.sessao_id);
    if (existente !== undefined) return existente;
    const nova: SessaoUI = { sessao_id: meta.sessao_id, ferramenta_id: meta.ferramenta_id, numero: ++contador, estado: meta.estado, mensagem: null, codigo_saida: null, ...antecipado.get(meta.sessao_id) };
    antecipado.delete(meta.sessao_id);
    sessoes.set(nova.sessao_id, nova);
    return nova;
  };

  const alterar = (id: string, mudanca: Partial<SessaoUI>): void => {
    const atual = sessoes.get(id);
    if (atual === undefined) antecipado.set(id, { ...antecipado.get(id), ...mudanca });
    else sessoes.set(id, { ...atual, ...mudanca });
  };

  function tratar(e: EventoTerminal): void {
    const id = e.sessao_id;
    if (fechadas.has(id)) return;
    if (e.tipo === "saida") {
      if (!armazem.empurrar(id, e.sequencia, e.dados).aceito) return;
      // ninguém com o terminal montado: o dado fica retido no armazém, então o consumo é confirmado aqui
      if (armazem.assinantes(id) === 0) void obterApi()?.confirmarConsumo(id, bytesDoChunk(e.dados)).catch(() => undefined);
      return; // saída não muda estado de UI: nada de re-render
    }
    if (!armazem.registrarSequencia(id, e.sequencia)) return;
    if (e.tipo === "estado") alterar(id, { estado: e.estado, mensagem: e.mensagem });
    else if (e.tipo === "encerramento") alterar(id, { estado: "encerrada", codigo_saida: e.codigo });
    else if (e.tipo === "atividade") alterar(id, { atividade: e.atividade });
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
        registrar({ sessao_id: r.sessao_id, ferramenta_id: ferramenta.id, estado: r.estado });
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
