// Thread de leitura de transcripts (T-10.07). Lê por offset e devolve LOTES de ≤ 500 registros `{ts, modelo, tokens, chave, usd_medido?}` — nada de conteúdo atravessa.
// Backpressure: depois de um lote a thread ESPERA `continuar` (no máximo 1 lote em voo). Compilada para CommonJS e carregada com `new Worker(caminho)` (fora do asar).
// Sem rede, sem banco: o main grava. Qualquer erro vira `{tipo:"erro", codigo}` nominal (nunca texto de arquivo).
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { fabricaClaude } from "./leitores/claude";
import { fabricaCodex } from "./leitores/codex";
import { lerLotes, type FabricaLeitor, type LoteLido } from "./leitores/leitor";
import { lerLotesOpenCode, localizarSessaoOpenCode } from "./leitores/opencode";

export type CliLida = "claude" | "codex" | "opencode";
export type CliJsonl = "claude" | "codex";
export type PedidoWorker =
  | { tipo: "ler"; req: number; cli: CliLida; caminho: string; offset: number; estado?: unknown; /** OpenCode: id da sessão dentro do `opencode.db` (`offset` = cursor em ms). */ sessao?: string }
  | { tipo: "localizar"; req: number; cli: "opencode"; caminho: string; conversa: string | null; cwd: string | null; desdeMs: number }
  | { tipo: "continuar"; req: number }
  | { tipo: "cancelar"; req: number };
export type RespostaWorker =
  | { tipo: "lote"; req: number; lote: LoteLido }
  | { tipo: "sessao"; req: number; sessao: string | null }
  | { tipo: "erro"; req: number; codigo: string };

export interface PortaWorker {
  postMessage(m: RespostaWorker): void;
  on(ev: "message", f: (m: PedidoWorker) => void): void;
}
const FABRICAS: Record<CliJsonl, FabricaLeitor> = { claude: fabricaClaude, codex: fabricaCodex };
const codigoDe = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return c === "ENOENT" ? "arquivo_ausente" : c === "EACCES" || c === "EPERM" ? "sem_permissao" : c === "sessao_invalida" ? "sessao_invalida" : "leitura_falhou";
};

/** Atende pedidos numa porta (exportado para teste em processo). */
export function atenderPedidos(porta: PortaWorker): void {
  const esperando = new Map<number, () => void>();
  const cancelados = new Set<number>();
  porta.on("message", (m) => {
    if (m.tipo === "continuar") esperando.get(m.req)?.();
    else if (m.tipo === "cancelar") {
      cancelados.add(m.req);
      esperando.get(m.req)?.();
    } else if (m.tipo === "localizar") {
      try {
        porta.postMessage({ tipo: "sessao", req: m.req, sessao: localizarSessaoOpenCode({ caminho: m.caminho, conversa: m.conversa, cwd: m.cwd, desdeMs: m.desdeMs }) });
      } catch (e) {
        porta.postMessage({ tipo: "erro", req: m.req, codigo: codigoDe(e) });
      }
    } else void executar(m);
  });
  function lotesDe(m: Extract<PedidoWorker, { tipo: "ler" }>): AsyncIterable<LoteLido> {
    if (m.cli === "opencode") return lerLotesOpenCode({ caminho: m.caminho, sessao: m.sessao ?? "", offset: m.offset });
    return lerLotes({ caminho: m.caminho, offset: m.offset, ...(m.estado === undefined ? {} : { estado: m.estado }), fabrica: FABRICAS[m.cli] });
  }
  async function executar(m: Extract<PedidoWorker, { tipo: "ler" }>): Promise<void> {
    try {
      for await (const lote of lotesDe(m)) {
        if (cancelados.has(m.req)) return;
        porta.postMessage({ tipo: "lote", req: m.req, lote });
        if (lote.ultimo) return;
        await new Promise<void>((r) => esperando.set(m.req, r));
        esperando.delete(m.req);
      }
    } catch (e) {
      porta.postMessage({ tipo: "erro", req: m.req, codigo: codigoDe(e) });
    } finally {
      cancelados.delete(m.req);
      esperando.delete(m.req);
    }
  }
}

/** só a thread criada com `workerData.paraCustoLeitor` assume a porta (um worker de teste que importe este módulo não a captura). */
if (!isMainThread && parentPort !== null && (workerData as { paraCustoLeitor?: unknown } | null)?.paraCustoLeitor === true) atenderPedidos(parentPort as unknown as PortaWorker);
