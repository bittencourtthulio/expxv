// Estado do harness visto pelos Panes: sugestões de troca pendentes, recibos ("por que esta conta") e toasts de troca.
// Uma assinatura de `harness:evento`. Canal ausente = vazio (nunca erro).
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { AcaoTroca, Decisao, EventoHarness, ResultadoMoverPane, Troca } from "../../compartilhado/harness";
import { ade } from "../ade";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";

type Api = ApiAde["harness"];

export interface EstadoHarnessPane {
  /** sugestões pendentes (status "sugerida") por pane de origem. */
  sugestoes: Readonly<Record<string, Troca>>;
  /** recibo da escolha de rota por Pane (última Decision com recibo). */
  recibos: Readonly<Record<string, string>>;
  erro: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export const TEXTO_PENSAMENTO_PERDIDO = "Mover cria um novo Pane com um resumo do trabalho; o raciocínio interno (pensamento) da sessão atual não é transferido.";

/** Destino da troca em uma frase: `codex / gpt-5`. */
export function descreverDestino(t: Troca): string {
  return `${t.para.provedor}${t.para.modelo !== null ? ` / ${t.para.modelo}` : ""}`;
}

export function criarStoreHarnessPane({ api: obter, avisar = avisarPadrao }: { api: () => Api | undefined; avisar?: (t: string, tom?: TomAviso) => unknown }) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoHarnessPane = { sugestoes: {}, recibos: {}, erro: null };
  let iniciado: Promise<void> | null = null;
  const panePorTroca = new Map<string, string>();
  const publicar = (p: Partial<EstadoHarnessPane>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const usavel = (a: Api | undefined): a is Api => a !== undefined && typeof a.listarTrocas === "function" && typeof a.assinar === "function";

  async function carregar(): Promise<void> {
    const api = obter();
    if (!usavel(api)) return;
    try {
      const [trocas, decisoes] = await Promise.all([api.listarTrocas({ limite: 100 }), api.listarDecisoes({ limite: 200 })]);
      const sug: Record<string, Troca> = {};
      for (const t of trocas.itens) {
        const pane = panePorTroca.get(t.id);
        if (t.status === "sugerida" && pane !== undefined) sug[pane] = t;
      }
      const rec: Record<string, string> = {};
      for (const d of [...decisoes.itens].reverse() as Decisao[]) if (d.pane_id !== null && d.recibo !== "") rec[d.pane_id] = d.recibo;
      publicar({ sugestoes: sug, recibos: rec, erro: null });
    } catch (e) { publicar({ erro: `Não foi possível ler as trocas: ${msg(e)}` }); }
  }

  const aoEvento = (e: EventoHarness): void => {
    if (e.tipo === "troca_sugerida") {
      panePorTroca.set(e.troca_id, e.pane_id);
      avisar("Sugestão de troca de conta: a conta atual está perto do limite.", "aviso");
      void carregar();
    } else if (e.tipo === "troca_feita") { avisar("Trabalho movido para outra conta. O recibo está no novo Pane.", "sucesso"); void carregar(); }
    else if (e.tipo === "troca_falhou") { avisar("A troca de conta falhou; o Pane original continua aberto.", "erro"); void carregar(); }
    else if (e.tipo === "decisor_pausado") avisar(`Decisor externo pausado: ${e.motivo}. As regras locais continuam valendo.`, "aviso");
    else void carregar();
  };

  return {
    obter: (): EstadoHarnessPane => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        const api = obter();
        if (!usavel(api)) return;
        api.assinar(aoEvento);
        await carregar();
      })();
      return iniciado;
    },
    recarregar: carregar,
    async decidir(trocaId: string, acao: AcaoTroca): Promise<boolean> {
      try {
        await obter()!.decidirTroca(trocaId, acao);
        const pane = panePorTroca.get(trocaId);
        if (pane !== undefined) { const { [pane]: _fora, ...resto } = estado.sugestoes; publicar({ sugestoes: resto }); }
        if (acao === "adiar_30min") avisar("Sugestão adiada por 30 minutos.", "info");
        await carregar();
        return true;
      } catch (e) { publicar({ erro: `Não foi possível responder à sugestão: ${msg(e)}` }); return false; }
    },
    async mover(paneId: string, contaAlvoId?: string): Promise<ResultadoMoverPane | null> {
      try { const r = await obter()!.moverPane(paneId, contaAlvoId); await carregar(); return r; }
      catch (e) {
        const m = msg(e);
        publicar({ erro: /no_capacity/.test(m) ? "Sem destino disponível (no_capacity): nenhuma conta ou modelo equivalente com folga." : `Não foi possível mover o Pane: ${m}` });
        return null;
      }
    },
    limparErro(): void { publicar({ erro: null }); },
  };
}
export type StoreHarnessPane = ReturnType<typeof criarStoreHarnessPane>;
export const storeHarnessPane: StoreHarnessPane = criarStoreHarnessPane({ api: () => ade()?.harness });
export function useHarnessPane(store: StoreHarnessPane = storeHarnessPane): EstadoHarnessPane {
  return useSyncExternalStore(store.assinar, store.obter);
}
