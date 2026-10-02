// Estado do backend online opcional do RAG (Fase 15, D-90..D-92). O SEGREDO nunca é guardado aqui: `configurar` e `testar` recebem o valor,
// repassam ao main e não o retêm; só máscaras (devolvidas pelo main) ficam no estado. Tudo desligado por padrão.
import { useSyncExternalStore } from "react";
import type { TipoDocumento } from "../../compartilhado/conhecimento";
import type { EstadoBackendRag, EventoRag, PedidoConfigurarBackend, PedidoTestarBackend, PreviaMigracao, ProvedorRagDto, ResultadoTestarBackend, ResultadoVerificacaoMigracao } from "../../compartilhado/rag";
import { ade } from "../ade";
import { maquinaMigracao, type EntradaMaquina, type EstadoMaquina } from "../telas/conhecimento/logica";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";
import { ehCanalAusente } from "./carga";

type Api = NonNullable<ReturnType<typeof ade>>["rag"];

export interface EstadoStoreRag {
  disponivel: boolean;
  workspaceId: string | null;
  carregando: boolean;
  erro: string | null;
  estado: EstadoBackendRag | null;
  provedores: readonly ProvedorRagDto[];
  teste: { testando: boolean; resultado: ResultadoTestarBackend | null };
  previa: PreviaMigracao | null;
  previaCarregando: boolean;
  maquina: EstadoMaquina;
  migracaoId: string | null;
  verificacao: ResultadoVerificacaoMigracao | null;
  avisoRag: string | null;
  ocupado: boolean;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export interface OpcoesStoreRag { api?: () => Api | undefined; avisar?: (texto: string, tom?: TomAviso) => unknown }

export function criarStoreRag(op: OpcoesStoreRag = {}) {
  const obterApi = op.api ?? (() => ade()?.rag);
  const avisar = op.avisar ?? avisarPadrao;
  const ouvintes = new Set<() => void>();
  const inicial = (): EstadoStoreRag => ({
    disponivel: true, workspaceId: null, carregando: false, erro: null, estado: null, provedores: [], teste: { testando: false, resultado: null },
    previa: null, previaCarregando: false, maquina: maquinaMigracao.inicial(), migracaoId: null, verificacao: null, avisoRag: null, ocupado: false,
  });
  let estado = inicial();
  let usuarios = 0;
  let desligar: (() => void) | null = null;
  let geracao = 0;

  const publicar = (p: Partial<EstadoStoreRag>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const usavel = (a: Api | undefined): a is Api => a !== undefined && typeof a.estado === "function";
  const falha = (e: unknown, prefixo: string): string | null => {
    if (ehCanalAusente(e)) { publicar({ disponivel: false }); return null; }
    return `${prefixo}: ${msg(e)}`;
  };
  const alimentar = (e: EntradaMaquina): void => publicar({ maquina: maquinaMigracao.passo(estado.maquina, e) });

  function aoEvento(e: EventoRag): void {
    if (e.canal === "rag:migracao_progresso") {
      if (estado.migracaoId !== null && e.payload.migracao_id !== estado.migracaoId) return;
      if (estado.migracaoId === null) publicar({ migracaoId: e.payload.migracao_id });
      alimentar({ tipo: "progresso", estado: e.payload.estado, enviados: e.payload.enviados, total: e.payload.total });
      if (e.payload.estado === "concluida" || e.payload.estado === "falhou" || e.payload.estado === "cancelada") void api.carregar();
    } else if (e.canal === "rag:aviso") {
      publicar({ avisoRag: e.payload.mensagem });
      avisar(e.payload.mensagem, e.payload.codigo === "offline" ? "info" : "aviso");
    }
  }

  async function guardar<T>(fn: (a: Api, w: string) => Promise<T>, prefixo: string): Promise<T | null> {
    const a = obterApi();
    const w = estado.workspaceId;
    if (!usavel(a) || w === null) return null;
    publicar({ ocupado: true });
    try { return await fn(a, w); }
    catch (e) { const t = falha(e, prefixo); if (t !== null) avisar(t, "erro"); return null; }
    finally { publicar({ ocupado: false }); }
  }

  const api = {
    obter: (): EstadoStoreRag => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    reiniciar(): void { geracao++; estado = inicial(); ouvintes.forEach((o) => o()); },
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
      geracao++;
      estado = { ...inicial(), workspaceId: id };
      ouvintes.forEach((o) => o());
      if (id !== null) await api.carregar();
    },
    async carregar(): Promise<void> {
      const a = obterApi();
      const w = estado.workspaceId;
      if (!usavel(a) || w === null) { if (!usavel(a)) publicar({ disponivel: false }); return; }
      const g = geracao;
      publicar({ carregando: true, erro: null });
      try {
        const [e, p] = await Promise.all([a.estado(w), estado.provedores.length > 0 ? Promise.resolve(estado.provedores) : a.provedores()]);
        if (g !== geracao) return;
        const ativa = e.migracao_ativa;
        publicar({
          estado: e, provedores: p, carregando: false,
          ...(ativa !== null && estado.maquina.etapa === "inicio"
            ? { migracaoId: ativa.migracao_id, maquina: maquinaMigracao.passo(maquinaMigracao.passo(maquinaMigracao.passo(maquinaMigracao.passo(estado.maquina, { tipo: "previa_pronta", previa_id: "ativa" }), { tipo: "pedir_consentimento" }), { tipo: "consentir" }), { tipo: "iniciar" }) }
            : {}),
        });
        if (ativa !== null) alimentar({ tipo: "progresso", estado: ativa.estado, enviados: ativa.enviados, total: ativa.total });
      } catch (err) { if (g === geracao) publicar({ carregando: false, erro: falha(err, "Não foi possível ler o backend") }); }
    },

    /** O valor secreto passa por aqui UMA vez e não é retido. Devolve as máscaras; o chamador limpa o próprio campo. */
    async configurar(pedido: Omit<PedidoConfigurarBackend, "workspace_id">): Promise<boolean> {
      const r = await guardar((a, w) => a.configurar({ workspace_id: w, ...pedido }), "Não foi possível salvar o backend");
      if (r?.ok !== true) return false;
      avisar("Backend salvo. Segredos ficam no cofre do sistema.", "sucesso");
      publicar({ teste: { testando: false, resultado: null } });
      await api.carregar();
      return true;
    },
    async testar(pedido: Omit<PedidoConfigurarBackend, "workspace_id"> | { usar_salvo: true }): Promise<ResultadoTestarBackend | null> {
      publicar({ teste: { testando: true, resultado: null } });
      const r = await guardar((a, w) => a.testar(({ workspace_id: w, ...pedido }) as PedidoTestarBackend), "Não foi possível testar a conexão");
      publicar({ teste: { testando: false, resultado: r } });
      return r;
    },
    async esquecerSegredo(): Promise<boolean> {
      const prov = estado.estado?.provedor;
      if (prov === null || prov === undefined) return false;
      const r = await guardar((a) => a.esquecerSegredo(prov), "Não foi possível esquecer o segredo");
      if (r?.ok === true) { avisar("Segredo removido do cofre.", "sucesso"); await api.carregar(); }
      return r?.ok === true;
    },

    // ---- migração (prévia → consentimento → envio → verificação)
    async gerarPrevia(tipos: TipoDocumento[]): Promise<boolean> {
      publicar({ previaCarregando: true, verificacao: null });
      const p = await guardar((a, w) => a.previaMigracao(w, tipos), "Não foi possível montar a prévia da migração");
      publicar({ previaCarregando: false });
      if (p === null) return false;
      publicar({ previa: p, migracaoId: null });
      alimentar({ tipo: "previa_pronta", previa_id: p.previa_id });
      return true;
    },
    pedirConsentimento(): void { alimentar({ tipo: "pedir_consentimento" }); },
    recusarConsentimento(): void { alimentar({ tipo: "recusar" }); },
    /** O consentimento só vale para a prévia atual; sem ele `iniciar` não faz nada. */
    async consentirEIniciar(): Promise<boolean> {
      const previa = estado.previa;
      if (previa === null || estado.maquina.etapa !== "consentimento") return false;
      alimentar({ tipo: "consentir" });
      const d = previa.destino;
      const r = await guardar((a, w) => a.iniciarMigracao({ workspace_id: w, previa_id: previa.previa_id, consentimento: { provedor: d.provedor, host: d.host, colecao: d.colecao, versao_politica: d.versao_politica } }), "Não foi possível iniciar a migração");
      if (r === null) { alimentar({ tipo: "reiniciar" }); return false; }
      publicar({ migracaoId: r.migracao_id });
      alimentar({ tipo: "iniciar" });
      return true;
    },
    async pausar(): Promise<void> { const id = estado.migracaoId; if (id !== null) await guardar((a) => a.pausarMigracao(id), "Não foi possível pausar"); },
    async retomar(): Promise<void> { const id = estado.migracaoId; if (id !== null) await guardar((a) => a.retomarMigracao(id), "Não foi possível retomar"); },
    async cancelar(): Promise<void> { const id = estado.migracaoId; if (id !== null) await guardar((a) => a.cancelarMigracao(id), "Não foi possível cancelar"); },
    async verificar(): Promise<ResultadoVerificacaoMigracao | null> {
      const id = estado.migracaoId;
      if (id === null) return null;
      const r = await guardar((a) => a.verificarMigracao(id), "Não foi possível verificar");
      if (r !== null) publicar({ verificacao: r });
      return r;
    },
    reiniciarAssistente(): void { publicar({ maquina: maquinaMigracao.inicial(), previa: null, migracaoId: null, verificacao: null }); },

    async voltarParaLocal(baixar: boolean): Promise<boolean> {
      const r = await guardar((a, w) => a.voltarParaLocal(w, baixar), "Não foi possível voltar para o modo local");
      if (r?.ok === true) { avisar("Modo local ativo. Nada foi apagado.", "sucesso"); await api.carregar(); }
      return r?.ok === true;
    },
    async sincronizar(): Promise<{ enviados: number; recebidos: number } | null> {
      const r = await guardar((a, w) => a.sincronizar(w), "Não foi possível sincronizar");
      if (r !== null) { avisar(`Sincronizado: ${r.enviados} enviados, ${r.recebidos} recebidos.`, "sucesso"); await api.carregar(); }
      return r;
    },
    async apagarRemoto(confirmacao: string): Promise<boolean> {
      const r = await guardar((a, w) => a.apagarRemoto(w, confirmacao), "Não foi possível apagar o remoto");
      if (r === null) return false;
      avisar("Coleção remota apagada.", "sucesso");
      await api.carregar();
      return true;
    },
  };
  return api;
}

export type StoreRag = ReturnType<typeof criarStoreRag>;
export const storeRag: StoreRag = criarStoreRag();
export function useRag(store: StoreRag = storeRag): EstadoStoreRag {
  return useSyncExternalStore(store.assinar, store.obter);
}
