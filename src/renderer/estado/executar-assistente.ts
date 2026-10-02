// Estado do "Assistente de execução com IA" no renderer (D-582…): prévia/consentimento → gerando → proposta → salvo, ou erro acionável. Nada é lido do main antes de o
// usuário abrir o assistente. O renderer nunca envia caminho: só a CLI (lista fechada), o hash do dossiê que ele viu, o id da proposta e as configurações revisadas.
import { useSyncExternalStore } from "react";
import type { ConfigExecucaoIpc } from "../../compartilhado/executar";
import type { CliAssistente, EventoAssistente, FaseAssistente, PreviaAssistente, ResultadoAssistente } from "../../compartilhado/executar-assistente";
import type { ApiAde } from "../../compartilhado/ipc";
import { ade } from "../ade";
import { storeExecutar, type StoreExecutar } from "./executar";

type Api = ApiAde["executar"];

export type FaseAssistenteUI = "fechado" | "consentimento" | "gerando" | "proposta" | "salvo" | "erro";

export interface ErroAssistenteUI { mensagem: string; sugestao: string; codigo: string | null }

export interface EstadoAssistenteUI {
  fase: FaseAssistenteUI;
  workspaceId: string | null;
  previa: PreviaAssistente | null;
  cli: CliAssistente | null;
  /** carregando a prévia (abrir ou trocar de CLI) */
  carregando: boolean;
  assistenteId: string | null;
  faseIa: FaseAssistente | null;
  iniciadoEm: number | null;
  cancelando: boolean;
  resultado: ResultadoAssistente | null;
  erro: ErroAssistenteUI | null;
  salvando: boolean;
  erroSalvar: string | null;
  /** quantas configurações foram salvas (fase `salvo`) */
  salvas: number;
}

export interface OpcoesStoreAssistente {
  api: () => Api | undefined;
  executar?: Pick<StoreExecutar, "obter" | "carregarLista" | "abrirEditor">;
  agora?: () => number;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const INICIAL: EstadoAssistenteUI = {
  fase: "fechado", workspaceId: null, previa: null, cli: null, carregando: false, assistenteId: null, faseIa: null, iniciadoEm: null, cancelando: false, resultado: null, erro: null,
  salvando: false, erroSalvar: null, salvas: 0,
};

export function criarStoreAssistente(op: OpcoesStoreAssistente) {
  const executar = op.executar ?? storeExecutar;
  const agora = op.agora ?? Date.now;
  const ouvintes = new Set<() => void>();
  let estado: EstadoAssistenteUI = INICIAL;
  let desligar: (() => void) | null = null;
  const publicar = (p: Partial<EstadoAssistenteUI>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const api = (): Api | undefined => op.api();
  const faseAtual = (): FaseAssistenteUI => estado.fase;
  const erroDe = (e: unknown, sugestao = "Tente de novo ou use a detecção automática."): ErroAssistenteUI => ({ mensagem: msg(e), sugestao, codigo: null });

  function aoEvento(ev: EventoAssistente): void {
    if (ev.workspace_id !== estado.workspaceId || estado.fase !== "gerando") return;
    // o primeiro evento chega antes da resposta do `propor`: adota o id dele; depois só vale o id corrente
    if (estado.assistenteId !== null && ev.assistente_id !== estado.assistenteId) return;
    if (estado.assistenteId === null) publicar({ assistenteId: ev.assistente_id });
    if (ev.tipo === "progresso") publicar({ faseIa: ev.fase });
    else if (ev.tipo === "concluido") publicar({ fase: "proposta", resultado: ev.resultado, faseIa: null, cancelando: false, erro: null });
    else if (ev.tipo === "erro") publicar({ fase: "erro", erro: { mensagem: ev.erro.mensagem, sugestao: ev.erro.sugestao, codigo: ev.erro.codigo }, faseIa: null, cancelando: false });
    else { publicar({ fase: "consentimento", faseIa: null, assistenteId: null, iniciadoEm: null, cancelando: false }); void carregarPrevia(estado.cli ?? undefined); }
  }

  async function carregarPrevia(cli?: CliAssistente): Promise<void> {
    const ws = estado.workspaceId;
    const a = api();
    if (ws === null || a === undefined) return;
    publicar({ carregando: true, erro: null });
    try {
      const p = await a.assistentePrevia(ws, cli);
      if (estado.workspaceId === ws && (estado.fase === "consentimento")) publicar({ previa: p, cli: p.cli, carregando: false });
    } catch (e) {
      if (estado.workspaceId === ws) publicar({ fase: "erro", carregando: false, erro: erroDe(e, "Feche e abra o assistente de novo.") });
    }
  }

  /** Assina o evento (idempotente) e devolve o desligador. */
  function ligar(): () => void {
    if (desligar === null) {
      const a = api();
      if (a !== undefined) desligar = a.assistenteAssinar(aoEvento);
    }
    return () => { desligar?.(); desligar = null; };
  }

  async function cancelar(): Promise<void> {
    const ws = estado.workspaceId;
    const a = api();
    if (ws === null || a === undefined || estado.fase !== "gerando" || estado.cancelando) return;
    publicar({ cancelando: true });
    try { await a.assistenteCancelar(ws); } catch { /* o evento 'cancelado' (ou o término) fecha o estado */ }
  }

  return {
    obter: (): EstadoAssistenteUI => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },

    /** Liga a assinatura do evento (idempotente); devolve o desligador. */
    ligar,

    /** "Configurar com IA…": abre o consentimento com a prévia do que será enviado. */
    async abrir(): Promise<void> {
      const ws = executar.obter().workspaceId;
      if (ws === null || estado.fase !== "fechado") return;
      estado = { ...INICIAL, fase: "consentimento", workspaceId: ws, carregando: true };
      ligar(); // o primeiro evento da análise pode chegar antes de o chunk do diálogo montar
      ouvintes.forEach((o) => o());
      await carregarPrevia();
    },
    async trocarCli(cli: CliAssistente): Promise<void> {
      if (estado.fase !== "consentimento") return;
      publicar({ cli });
      await carregarPrevia(cli);
    },
    /** o clique em "Concordo, analisar": só aqui algo sai para a CLI */
    async consentir(): Promise<void> {
      const ws = estado.workspaceId;
      const a = api();
      const p = estado.previa;
      const cli = estado.cli;
      if (ws === null || a === undefined || p === null || cli === null || estado.fase !== "consentimento" || estado.carregando) return;
      publicar({ fase: "gerando", faseIa: "preparando", iniciadoEm: agora(), assistenteId: null, resultado: null, erro: null, cancelando: false });
      try {
        const r = await a.assistentePropor(ws, cli, p.dossie_hash, true);
        if (faseAtual() === "gerando" && estado.assistenteId === null) publicar({ assistenteId: r.assistente_id });
      } catch (e) {
        publicar({ fase: "erro", faseIa: null, erro: erroDe(e, "Abra o assistente de novo para rever o que será enviado.") });
      }
    },
    cancelar,
    /** Fecha o diálogo; se estiver analisando, cancela a CLI antes. */
    fechar(): void {
      if (estado.fase === "gerando") void cancelar();
      estado = { ...INICIAL };
      ouvintes.forEach((o) => o());
    },
    /** volta ao consentimento (erro → "Tentar de novo") */
    voltar(): void {
      if (estado.fase !== "erro" && estado.fase !== "proposta") return;
      publicar({ fase: "consentimento", erro: null, resultado: null, assistenteId: null, faseIa: null, iniciadoEm: null });
      void carregarPrevia(estado.cli ?? undefined);
    },
    /** "Usar a detecção automática": fecha o assistente e abre o editor comum */
    usarDeteccao(): void {
      estado = { ...INICIAL };
      ouvintes.forEach((o) => o());
      executar.abrirEditor("editar");
    },
    /** Devolve `null` quando salvou, ou o texto do erro (o diálogo mostra ao lado do botão). */
    async salvar(configs: ConfigExecucaoIpc[], padraoId: string | null): Promise<string | null> {
      const ws = estado.workspaceId;
      const a = api();
      const r = estado.resultado;
      if (ws === null || a === undefined || r === null || estado.salvando) return "Assistente indisponível.";
      publicar({ salvando: true, erroSalvar: null });
      try {
        await a.assistenteSalvar(ws, r.assistente_id, configs, padraoId);
        publicar({ fase: "salvo", salvando: false, salvas: configs.length });
        void executar.carregarLista();
        return null;
      } catch (e) {
        publicar({ salvando: false, erroSalvar: msg(e) });
        return msg(e);
      }
    },
  };
}

export type StoreAssistente = ReturnType<typeof criarStoreAssistente>;
export const storeAssistenteExecutar: StoreAssistente = criarStoreAssistente({ api: () => ade()?.executar });

export function useAssistenteExecutar(store: StoreAssistente = storeAssistenteExecutar): EstadoAssistenteUI {
  return useSyncExternalStore(store.assinar, store.obter);
}
