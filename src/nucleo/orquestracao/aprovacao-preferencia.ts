/**
 * Preferências da política de aprovações dos workers (D-640): padrão global + valor por workspace, em `config` (chave/valor), como as demais preferências do painel livre.
 * Sem valor no workspace, vale o padrão global (e sem padrão global, `automatico_seguro`: o dono pediu workers autônomos). O nível `total` só é gravado com a palavra
 * digitada (`liberar tudo`) e a confirmação some quando o nível deixa de ser `total`. Funções puras sobre uma porta mínima de config (testáveis sem banco).
 */
import {
  NIVEL_APROVACAO_PADRAO, confirmacaoTotalValida, ehNivelAprovacao,
  type NivelAprovacaoWorker, type PedidoAprovacaoWorkers, type PreferenciaAprovacaoWorkers,
} from "../../compartilhado/aprovacao-workers";

export interface PortaConfigAprovacao {
  obter<T = unknown>(chave: string): T | undefined;
  definir(chave: string, valor: unknown): void;
  remover(chave: string): void;
}

export const CHAVE_APROVACAO_GLOBAL = "orquestracao.aprovacao_workers.global";
export const chaveAprovacaoWorkspace = (workspace_id: string): string => `orquestracao.aprovacao_workers.ws.${workspace_id}`;

interface RegistroNivel { nivel: NivelAprovacaoWorker; total_confirmado: boolean }
interface RegistroWorkspace { nivel: NivelAprovacaoWorker | null; total_confirmado: boolean; permitir_raiz: boolean; confiavel: boolean }

export class ErroAprovacaoWorkers extends Error {
  constructor(readonly codigo: "confirmacao_necessaria" | "escopo_invalido", mensagem: string) {
    super(mensagem);
    this.name = "ErroAprovacaoWorkers";
  }
}

function lerGlobal(c: PortaConfigAprovacao): RegistroNivel {
  const v = c.obter<unknown>(CHAVE_APROVACAO_GLOBAL);
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const nivel = ehNivelAprovacao(o["nivel"]) ? o["nivel"] : NIVEL_APROVACAO_PADRAO;
  return { nivel, total_confirmado: nivel === "total" && o["total_confirmado"] === true };
}

function lerWorkspace(c: PortaConfigAprovacao, id: string): RegistroWorkspace {
  const v = c.obter<unknown>(chaveAprovacaoWorkspace(id));
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const nivel = ehNivelAprovacao(o["nivel"]) ? o["nivel"] : null;
  return { nivel, total_confirmado: nivel === "total" && o["total_confirmado"] === true, permitir_raiz: o["permitir_raiz"] === true, confiavel: o["confiavel"] !== false };
}

export function lerAprovacaoWorkers(c: PortaConfigAprovacao, workspace_id: string | null): PreferenciaAprovacaoWorkers {
  const g = lerGlobal(c);
  if (workspace_id === null) return { workspace_id: null, nivel: g.nivel, proprio: true, permitir_raiz: false, confiavel: true, padrao_global: g.nivel };
  const w = lerWorkspace(c, workspace_id);
  return { workspace_id, nivel: w.nivel ?? g.nivel, proprio: w.nivel !== null, permitir_raiz: w.permitir_raiz, confiavel: w.confiavel, padrao_global: g.nivel };
}

/** Valores efetivos para o lançamento de um worker deste workspace. */
export function aprovacaoEfetivaDoWorkspace(c: PortaConfigAprovacao, workspace_id: string): { nivel: NivelAprovacaoWorker; totalConfirmado: boolean; permitirNaRaiz: boolean; projetoConfiavel: boolean } {
  const g = lerGlobal(c);
  const w = lerWorkspace(c, workspace_id);
  const proprio = w.nivel !== null;
  return {
    nivel: w.nivel ?? g.nivel,
    totalConfirmado: proprio ? w.total_confirmado : g.total_confirmado,
    permitirNaRaiz: w.permitir_raiz,
    projetoConfiavel: w.confiavel,
  };
}

/** Grava e devolve o estado. `total` sem a palavra digitada lança `confirmacao_necessaria` e NÃO grava nada. */
export function definirAprovacaoWorkers(c: PortaConfigAprovacao, p: PedidoAprovacaoWorkers): PreferenciaAprovacaoWorkers {
  if (p.nivel === "total" && !confirmacaoTotalValida(p.confirmacao)) {
    throw new ErroAprovacaoWorkers("confirmacao_necessaria", "Para liberar o nível Total, digite exatamente: liberar tudo.");
  }
  if (p.workspace_id === null) {
    if (p.herdar === true || p.permitir_raiz !== undefined || p.confiavel !== undefined) throw new ErroAprovacaoWorkers("escopo_invalido", "Herdar, raiz e confiança só existem por projeto.");
    if (p.nivel !== undefined) c.definir(CHAVE_APROVACAO_GLOBAL, { nivel: p.nivel, ...(p.nivel === "total" ? { total_confirmado: true } : {}) });
    return lerAprovacaoWorkers(c, null);
  }
  const atual = lerWorkspace(c, p.workspace_id);
  let nivel = atual.nivel;
  let confirmado = atual.total_confirmado;
  if (p.herdar === true) { nivel = null; confirmado = false; }
  else if (p.nivel !== undefined) { nivel = p.nivel; confirmado = p.nivel === "total"; }
  c.definir(chaveAprovacaoWorkspace(p.workspace_id), {
    ...(nivel === null ? {} : { nivel }),
    ...(nivel === "total" && confirmado ? { total_confirmado: true } : {}),
    permitir_raiz: p.permitir_raiz ?? atual.permitir_raiz,
    confiavel: p.confiavel ?? atual.confiavel,
  });
  return lerAprovacaoWorkers(c, p.workspace_id);
}
