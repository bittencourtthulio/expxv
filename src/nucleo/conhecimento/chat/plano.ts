// Plano do chat (T-15.33): montado por CÓDIGO determinístico a partir da intenção; o texto livre do LLM nunca vira ação.
// Máquina de estados do plano com transições fechadas. Passos usam só as tools de orquestração (porta).
import { idLocal } from "../ids";
import type { EstadoPlano, ModoExecucaoChat, PassoPlano, PerfilChat, PlanoChat } from "./tipos";
import type { AcaoHumana } from "./intencao";

/** Intenção → comando do método (D-20: `/expx:<nome> <argumento>`). Dúvidas não geram plano. */
export const COMANDO_POR_INTENCAO: Readonly<Record<string, string | null>> = {
  bug: "runx",
  feature: "sprintx",
  pedido_cru: "prodx-triar",
  projeto: "buildx",
  refatoracao: "sprintx",
  entrega: "mergex-check",
  duvida: null,
  consulta_historico: null,
};

const TRANSICOES: Readonly<Record<EstadoPlano, readonly EstadoPlano[]>> = {
  proposto: ["aprovado", "cancelado"],
  aprovado: ["executando", "cancelado"],
  executando: ["concluido", "falhou", "cancelado"],
  concluido: [],
  cancelado: [],
  falhou: [],
};

export class TransicaoInvalidaErro extends Error {
  override name = "TransicaoInvalidaErro";
  constructor(de: string, para: string) {
    super(`transição de plano inválida: ${de} → ${para}`);
  }
}

export function transicionar(de: EstadoPlano, para: EstadoPlano): EstadoPlano {
  if (!TRANSICOES[de].includes(para)) throw new TransicaoInvalidaErro(de, para);
  return para;
}

export const estadoTerminal = (e: EstadoPlano): boolean => TRANSICOES[e].length === 0;

export interface EntradaPlano {
  intencao: string;
  pedido_titulo: string;
  prompt: string;
  uma_linha: string;
  criterios_aceite: string[];
  arquivos_provaveis: string[];
  perfil_destino: PerfilChat;
  mission_alvo_id: string | null;
  acoes_humanas: readonly AcaoHumana[];
  rag_consulta_id: string | null;
  modo_execucao: ModoExecucaoChat;
  /** passos cujo efeito é destrutivo (nenhum hoje: o chat só cria e digita). */
  destrutivo?: boolean;
}

/** Plano determinístico. `null` quando a intenção não gera ação (dúvida) ou só havia ação exclusiva do humano. */
export function montarPlano(e: EntradaPlano): PlanoChat | null {
  const comando = COMANDO_POR_INTENCAO[e.intencao] ?? null;
  const avisos: string[] = [];
  const humanas = e.acoes_humanas.map((a) => a.descricao);
  if (comando === null) return null;
  const passos: PassoPlano[] = [];
  if (e.mission_alvo_id === null) passos.push({ tipo: "criar_missao", titulo: e.pedido_titulo.slice(0, 120) });
  passos.push({ tipo: "abrir_pane", titulo: `${comando}: ${e.pedido_titulo}`.slice(0, 120), perfil: e.perfil_destino });
  passos.push({ tipo: "disparar_metodo", comando, argumento: e.uma_linha });
  if (e.acoes_humanas.length > 0) avisos.push("Parte do pedido é exclusiva do humano e não será executada pelo chat.");
  const exige = e.modo_execucao === "confirmar" || e.destrutivo === true;
  return {
    id: idLocal("plano"),
    intencao: e.intencao,
    resumo: `${comando} · ${e.pedido_titulo}`.slice(0, 200),
    passos,
    prompt: e.prompt,
    criterios_aceite: e.criterios_aceite,
    arquivos_provaveis: e.arquivos_provaveis,
    acoes_humanas: humanas,
    avisos,
    mission_alvo_id: e.mission_alvo_id,
    mission_id: e.mission_alvo_id,
    pane_ids: [],
    estado: "proposto",
    rag_consulta_id: e.rag_consulta_id,
    exige_aprovacao: exige,
  };
}

export interface EventoProgresso {
  plano_id: string;
  pane_id: string | null;
  estado: EstadoPlano | "passo";
  resumo: string;
}

/** Executa o plano pela porta de orquestração; cada passo emite progresso; falha para e marca `falhou` (nunca desfaz nem apaga). */
export async function executarPlano(
  plano: PlanoChat,
  porta: import("./tipos").PortaOrquestracao,
  onProgresso: (e: EventoProgresso) => void = () => undefined,
  sinal?: AbortSignal,
): Promise<PlanoChat> {
  let p: PlanoChat = { ...plano, estado: transicionar(plano.estado, "executando") };
  onProgresso({ plano_id: p.id, pane_id: null, estado: "executando", resumo: "executando" });
  let paneId: string | null = null;
  try {
    for (const passo of p.passos) {
      if (sinal?.aborted) {
        p = { ...p, estado: transicionar(p.estado, "cancelado") };
        onProgresso({ plano_id: p.id, pane_id: paneId, estado: "cancelado", resumo: "cancelado pelo usuário" });
        return p;
      }
      if (passo.tipo === "criar_missao") {
        const m = await porta.criarMissao({ titulo: passo.titulo });
        p = { ...p, mission_id: m.mission_id };
        onProgresso({ plano_id: p.id, pane_id: null, estado: "passo", resumo: "Missão criada" });
      } else if (passo.tipo === "abrir_pane") {
        if (p.mission_id === null) throw new Error("sem Missão para abrir o terminal");
        const r = await porta.abrirPane({ mission_id: p.mission_id, titulo: passo.titulo, perfil: passo.perfil });
        paneId = r.pane_id;
        p = { ...p, pane_ids: [...p.pane_ids, r.pane_id] };
        onProgresso({ plano_id: p.id, pane_id: paneId, estado: "passo", resumo: "terminal aberto" });
      } else if (passo.tipo === "disparar_metodo") {
        if (paneId === null) throw new Error("sem terminal para disparar o método");
        await porta.dispararMetodo({ pane_id: paneId, comando: passo.comando, argumento: passo.argumento, prompt: p.prompt });
        onProgresso({ plano_id: p.id, pane_id: paneId, estado: "passo", resumo: `/expx:${passo.comando} enviado` });
      } else {
        if (paneId === null) throw new Error("sem terminal para enviar o prompt");
        await porta.enviarPrompt({ pane_id: paneId, texto: passo.texto });
        onProgresso({ plano_id: p.id, pane_id: paneId, estado: "passo", resumo: "prompt enviado" });
      }
    }
    p = { ...p, estado: transicionar(p.estado, "concluido") };
    onProgresso({ plano_id: p.id, pane_id: paneId, estado: "concluido", resumo: "em execução no terminal" });
    return p;
  } catch (e) {
    p = { ...p, estado: transicionar(p.estado, "falhou"), avisos: [...p.avisos, `falhou: ${e instanceof Error ? e.message.slice(0, 160) : "erro"}`] };
    onProgresso({ plano_id: p.id, pane_id: paneId, estado: "falhou", resumo: "falhou" });
    return p;
  }
}
