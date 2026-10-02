// Geração do contexto do projeto (D-495): "Gerar agora" (um item) e "Gerar o que falta" (sequência) pelo mesmo mecanismo.
// Dispara UM comando por vez com `metodo:disparar` (D-20: novo Pane com a CLI padrão do workspace; módulo desligado, permissão e rigidez são decididos no main) e
// só avança quando o ARQUIVO aparece no índice (o disco é a verdade; nunca o texto do terminal). A skill pode perguntar algo no Pane: o app espera.
// "Pular" e "Cancelar" só param de ESPERAR: o agente já aberto continua no Pane, e nenhum próximo é disparado.
import { useSyncExternalStore } from "react";
import type { ResultadoDisparo, PedidoDispararComando } from "../../compartilhado/dominio";
import { CONTEXTOS, defDoContexto, type ContextoId } from "../../nucleo/metodo/contexto";
import type { CamadasProjeto } from "../../nucleo/metodo/tipos";
import { ade } from "../ade";
import { entregue, storeExecucaoMetodo } from "./execucao-metodo";

export type FaseGeracao = "ociosa" | "rodando" | "concluida" | "cancelada" | "falhou";

export interface EstadoGeracao {
  workspaceId: string | null;
  fase: FaseGeracao;
  /** tudo o que esta execução vai gerar, na ordem */
  fila: readonly ContextoId[];
  atual: ContextoId | null;
  /** o comando já foi enviado ao Pane e o app espera o arquivo aparecer */
  aguardando: boolean;
  comandoAtual: string | null;
  feitos: readonly ContextoId[];
  pulados: readonly ContextoId[];
  erro: string | null;
}

export interface OpcoesStoreGeracao {
  /** D-610: o comando foi enviado; `primeiro` = primeiro item da execução (só ele leva à tela Terminais: a sequência não puxa a pessoa de volta a cada item). */
  aoEnviar?: (r: ResultadoDisparo, info: { workspaceId: string; rotulo: string; primeiro: boolean }) => void;
  disparar?: (p: PedidoDispararComando) => Promise<ResultadoDisparo>;
}

const INICIAL: EstadoGeracao = { workspaceId: null, fase: "ociosa", fila: [], atual: null, aguardando: false, comandoAtual: null, feitos: [], pulados: [], erro: null };
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function criarStoreGeracao(op: OpcoesStoreGeracao = {}) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoGeracao = INICIAL;
  let geracao = 0;
  const publicar = (p: Partial<EstadoGeracao>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const disparar = (p: PedidoDispararComando): Promise<ResultadoDisparo> => {
    if (op.disparar !== undefined) return op.disparar(p);
    const api = ade();
    if (api === undefined) return Promise.resolve({ ok: false, pane_id: null, comando: null, motivo: "Disponível só no aplicativo." });
    return api.metodo.disparar(p);
  };

  async function dispararAtual(g: number, workspaceId: string, id: ContextoId): Promise<void> {
    publicar({ atual: id, aguardando: false, comandoAtual: null, erro: null });
    let r: ResultadoDisparo;
    try {
      r = await disparar({ workspace_id: workspaceId, trabalho_id: null, gesto: defDoContexto(id).gesto, argumento: null, pane_id: null });
    } catch (e) {
      r = { ok: false, pane_id: null, comando: null, motivo: msg(e) };
    }
    if (g !== geracao) return; // cancelado enquanto o main abria o Pane
    if (!entregue(r)) { publicar({ fase: "falhou", aguardando: false, erro: r.motivo ?? "O comando não foi enviado." }); return; }
    publicar({ aguardando: true, comandoAtual: r.comando });
    const info = { workspaceId, rotulo: `Gerar ${defDoContexto(id).nome}`, primeiro: estado.fila[0] === id };
    if (op.aoEnviar !== undefined) op.aoEnviar(r, info);
    else storeExecucaoMetodo.registrar(r, { workspaceId: info.workspaceId, rotulo: info.rotulo }, info.primeiro ? undefined : false);
  }

  async function avancar(g: number): Promise<void> {
    const ws = estado.workspaceId;
    if (ws === null) return;
    const i = estado.atual === null ? -1 : estado.fila.indexOf(estado.atual);
    const proximo = estado.fila[i + 1];
    if (proximo === undefined) { publicar({ fase: "concluida", atual: null, aguardando: false, comandoAtual: null }); return; }
    await dispararAtual(g, ws, proximo);
  }

  return {
    obter: (): EstadoGeracao => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },

    /** Começa uma execução (1 item = "Gerar agora"; vários = "Gerar o que falta"). Ignora se já há uma rodando. */
    async iniciar(workspaceId: string, ids: readonly ContextoId[]): Promise<void> {
      if (estado.fase === "rodando" || ids.length === 0) return;
      const g = ++geracao;
      const fila = [...new Set(ids)].filter((id) => CONTEXTOS.some((c) => c.id === id));
      publicar({ ...INICIAL, workspaceId, fase: "rodando", fila });
      await dispararAtual(g, workspaceId, fila[0] as ContextoId);
    },

    /** O índice mudou: se o arquivo do item atual apareceu, ele está feito e o próximo é disparado. */
    async indiceMudou(workspaceId: string, camadas: Pick<CamadasProjeto, "convencoes" | "design_system" | "produto" | "memoria" | "perfil_legado">): Promise<void> {
      if (estado.fase !== "rodando" || !estado.aguardando || estado.atual === null || estado.workspaceId !== workspaceId) return;
      if (!camadas[defDoContexto(estado.atual).chave]) return;
      const g = geracao;
      publicar({ feitos: [...estado.feitos, estado.atual], aguardando: false, comandoAtual: null });
      await avancar(g);
    },

    /** Para de esperar este item e segue para o próximo (o agente aberto continua no Pane). */
    async pular(): Promise<void> {
      if (estado.fase !== "rodando" || estado.atual === null) return;
      const g = geracao;
      publicar({ pulados: [...estado.pulados, estado.atual], aguardando: false, comandoAtual: null });
      await avancar(g);
    },

    /** Para a sequência: nada mais é disparado. O que já foi aberto segue no Pane. */
    cancelar(): void {
      if (estado.fase !== "rodando") return;
      geracao++;
      publicar({ fase: "cancelada", aguardando: false, comandoAtual: null });
    },

    /** Fecha o resumo final (volta a "ociosa"). */
    fechar(): void { if (estado.fase !== "rodando") publicar({ ...INICIAL }); },
    /** testes */
    _reiniciar(): void { geracao++; estado = INICIAL; ouvintes.forEach((o) => o()); },
  };
}
export type StoreGeracao = ReturnType<typeof criarStoreGeracao>;
export const storeGeracao = criarStoreGeracao();

export function useGeracao(store: StoreGeracao = storeGeracao): EstadoGeracao {
  return useSyncExternalStore(store.assinar, store.obter);
}
