/**
 * Ciclo de vida do painel do worker (D-520 em diante, 05-CONTRATOS §20). Regras PURAS, sem E/S:
 *  - quem fechou (`FechadoPor`) e como terminou (`EstadoFechado`);
 *  - decisão quando a CLI sai por conta própria (sucesso fecha o painel sozinho; erro NÃO pedido mantém o painel e avisa);
 *  - memória dos workers fechados (só no processo, nunca em disco): cauda da saída (≤ 16 KB, limpa de ANSI e redigida) por 10 min,
 *    para `pane_read`, `pane_list` e a decisão do orquestrador depois que o painel já saiu da grade.
 */

export type FechadoPor = "orquestrador" | "dono" | "auto" | "erro";
export type EstadoFechado = "concluido" | "fechado" | "falhou";

export const CAUDA_MAX_BYTES = 16 * 1024;
export const TTL_CAUDA_PADRAO_MS = 10 * 60_000;
/** Prazo entre a entrega (ou a saída com sucesso) e o fechamento automático do painel. */
export const PRAZO_FECHAR_PADRAO_MS = 3_000;
/** Painel de worker que MORREU com erro: some sozinho depois disto, se o dono não interagir (a interface mede; o main só informa o prazo). */
export const PRAZO_FALHA_PADRAO_MS = 60_000;
export const MAX_FECHADOS = 64;
/** Trecho do final da saída que `pane_list` mostra de um worker que falhou. */
export const TRECHO_FALHA_MAX = 1_500;

/** Contrato externo (inglês snake_case): o que o orquestrador vê nas tools. */
export const ESTADO_FECHADO_EXTERNO: Readonly<Record<EstadoFechado, string>> = { concluido: "done", fechado: "closed", falhou: "failed" };
export const FECHADO_POR_EXTERNO: Readonly<Record<FechadoPor, string>> = { orquestrador: "orchestrator", dono: "owner", auto: "auto", erro: "error" };

/** Fechamentos que o app pede de propósito (o `código 143` deles NÃO é falha). */
export const MOTIVO_HANDOFF_FEITO = "handoff_done";

export interface HandoffDoWorker {
  status: "ok" | "parcial" | "bloqueado" | "falhou";
}

/**
 * Como o worker terminou, vendo o que ficou registrado: erro não pedido = `falhou`; handoff `falhou` = `falhou`; handoff ok/parcial ou saída limpa = `concluido`;
 * o resto (fechado antes de entregar, handoff `bloqueado`) = `fechado`.
 */
export function classificarFechamento(e: { fechado_por: FechadoPor; handoff: HandoffDoWorker | null }): EstadoFechado {
  if (e.fechado_por === "erro") return "falhou";
  if (e.handoff !== null) {
    if (e.handoff.status === "falhou") return "falhou";
    if (e.handoff.status === "ok" || e.handoff.status === "parcial") return "concluido";
    return "fechado";
  }
  return e.fechado_por === "auto" ? "concluido" : "fechado";
}

export type SaidaEspontanea = "concluida" | "falhou";

/** A CLI do worker saiu sem o app pedir: código 0 = terminou bem (o painel fecha sozinho); qualquer outra coisa (código ≠ 0, sinal) = falha que o orquestrador precisa ver. */
export function classificarSaidaEspontanea(e: { codigo: number | null }): SaidaEspontanea {
  return e.codigo === 0 ? "concluida" : "falhou";
}

// ESC [ ... final, ESC ] ... (BEL | ESC \), ESC + 1 caractere; controles C0 (menos \n e \t) e DEL
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * Cauda da saída de um worker: linhas lógicas da tela viram texto limpo (sem ANSI nem controles), passam pelo redator (segredos) e ficam
 * limitadas às últimas `max` bytes, sempre cortando em início de linha. Nunca devolve mais que o teto.
 */
export function limparCauda(linhas: readonly string[], redigir: (texto: string) => string, max: number = CAUDA_MAX_BYTES): string {
  const texto = linhas.join("\n").replace(ANSI, "").replace(CONTROLES, "");
  const limpo = redigir(texto).replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (Buffer.byteLength(limpo) <= max) return limpo;
  let corte = Buffer.from(limpo).subarray(Buffer.byteLength(limpo) - max).toString("utf8").replace(/^�+/, "");
  const quebra = corte.indexOf("\n");
  if (quebra >= 0 && quebra < corte.length - 1) corte = corte.slice(quebra + 1);
  return corte;
}

export interface WorkerFechado {
  pane_id: string;
  mission_id: string | null;
  workspace_id: string;
  papel: string;
  provedor: string;
  task_id: string | null;
  estado: EstadoFechado;
  fechado_por: FechadoPor;
  /** código de saída do processo (`null` = não observado, ex.: fechado pelo app antes de sair) */
  codigo: number | null;
  /** instante do fechamento (ms desde a época) */
  fechado_em: number;
  /** cauda redigida da saída (≤ 16 KB). Só memória. */
  cauda: string;
}

export interface MemoriaDeFechados {
  registrar(w: WorkerFechado): void;
  /** `undefined` depois do prazo (o registro é apagado na leitura). */
  obter(pane_id: string): WorkerFechado | undefined;
  daMissao(mission_id: string): WorkerFechado[];
  descartar(pane_id: string): void;
  limpar(): void;
  tamanho(): number;
}

export function criarMemoriaDeFechados(opcoes: { agora?: () => number; ttlMs?: number; max?: number } = {}): MemoriaDeFechados {
  const agora = opcoes.agora ?? Date.now;
  const ttl = opcoes.ttlMs ?? TTL_CAUDA_PADRAO_MS;
  const max = opcoes.max ?? MAX_FECHADOS;
  const itens = new Map<string, WorkerFechado>();
  const varrer = (): void => {
    const corte = agora() - ttl;
    for (const [id, w] of itens) if (w.fechado_em <= corte) itens.delete(id);
  };
  return {
    registrar(w) {
      varrer();
      itens.delete(w.pane_id);
      itens.set(w.pane_id, w);
      while (itens.size > max) {
        const primeiro = itens.keys().next().value;
        if (primeiro === undefined) break;
        itens.delete(primeiro);
      }
    },
    obter(pane_id) {
      varrer();
      return itens.get(pane_id);
    },
    daMissao(mission_id) {
      varrer();
      return [...itens.values()].filter((w) => w.mission_id === mission_id);
    },
    descartar: (pane_id) => void itens.delete(pane_id),
    limpar: () => itens.clear(),
    tamanho: () => { varrer(); return itens.size; },
  };
}

/** Linhas da cauda (`pane_read` de worker fechado): as últimas `n`, sem a linha vazia final. */
export function linhasDaCauda(cauda: string, n: number): string[] {
  if (cauda === "") return [];
  const linhas = cauda.split("\n");
  return linhas.slice(-Math.max(1, n));
}

/** Final da cauda para `pane_list` (worker que falhou): últimos `TRECHO_FALHA_MAX` caracteres, em início de linha quando possível. */
export function trechoDaFalha(cauda: string): string {
  if (cauda.length <= TRECHO_FALHA_MAX) return cauda;
  const fim = cauda.slice(-TRECHO_FALHA_MAX);
  const quebra = fim.indexOf("\n");
  return quebra >= 0 && quebra < fim.length - 1 ? fim.slice(quebra + 1) : fim;
}
