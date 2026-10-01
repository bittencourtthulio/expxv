// Lado do MAIN do servidor MCP em worker thread (ver `mcp-rpc.ts`): cria a thread, atende as chamadas
// das portas de domínio e emite/revoga os tokens de Pane. Este módulo NÃO importa o SDK do MCP: ele é
// leve e só a thread do servidor (`mcp-worker.ts`) carrega o SDK. O segredo dos tokens é sorteado aqui e
// entregue à thread por `workerData` (nunca sai do processo); a emissão é síncrona no main, a verificação
// acontece na thread, e a revogação viaja por mensagem com o número de emissão que separa velho de novo.
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { ContextoGancho, PortaGanchos } from "../nucleo/mcp/portas";
import { carregarRevogados, carregarSegredoPersistente, criarEmissorDeTokens, criarGravadorRevogados, type PedidoToken, type Revogados } from "../nucleo/mcp/tokens";
import type { DepsTools } from "../nucleo/mcp/tools/comum";
import { atenderChamadas, type PortaDeMensagens } from "./mcp-rpc";

export interface DadosDoWorker {
  paraServidorMcp: true;
  segredo: string;
  maxPanes: number;
  porta: number;
  /** porta do início anterior (tentada primeiro) */
  portaPreferida?: number;
  /** revogações persistidas (a thread só verifica; novas chegam por mensagem) */
  revogados?: Revogados;
}

export interface ThreadMcp extends PortaDeMensagens {
  once(evento: "error" | "exit", ouvinte: (valor: unknown) => void): unknown;
  terminate(): Promise<unknown>;
}

export type DepsDoServidorRemoto = Omit<DepsTools, "relogio">;

export interface OpcoesServidorRemoto {
  /** caminho do `mcp-worker.js` (fora do asar no pacote) */
  caminhoWorker: string;
  deps: DepsDoServidorRemoto;
  ganchos: PortaGanchos;
  /** 0 = porta efêmera (padrão) */
  porta?: number;
  /**
   * Pasta de dados do app: ativa o segredo persistente (`mcp-segredo`), a lista de revogados e a porta
   * preferida (`mcp-porta`), para a sessão recuperada do daemon continuar válida depois de reiniciar.
   * Sem ela (teste), o segredo é aleatório do processo.
   */
  dirSegredo?: string;
  tempoLimiteMs?: number;
  /** injeção de teste: cria a thread (ou um dublê) */
  criarThread?: (dados: DadosDoWorker) => ThreadMcp;
}

export interface ServidorRemoto {
  url: string;
  urlGanchos: string;
  porta: number;
  /** Porta gravada no início anterior (`null` na primeira vez). */
  portaAnterior: number | null;
  /** false = a porta anterior estava ocupada por OUTRO processo: sessões recuperadas apontam para a porta errada. */
  portaReutilizada: boolean;
  emitirToken(pedido: PedidoToken): string;
  revogar(pane_id: string): void;
  fechar(): Promise<void>;
}

interface Pronto { url: string; urlGanchos: string; porta: number }

export async function iniciarServidorRemoto(o: OpcoesServidorRemoto): Promise<ServidorRemoto> {
  const dir = o.dirSegredo;
  const segredo = dir === undefined ? randomBytes(32) : await carregarSegredoPersistente(dir);
  const revogados = dir === undefined ? {} : await carregarRevogados(dir);
  const gravador = dir === undefined ? null : criarGravadorRevogados(dir);
  const arquivoPorta = dir === undefined ? null : join(dir, "mcp-porta");
  const portaAnterior = arquivoPorta === null ? NaN : Number.parseInt(await readFile(arquivoPorta, "utf8").catch(() => ""), 10);
  const base = criarEmissorDeTokens({ segredo, revogados, ...(gravador === null ? {} : { aoRevogar: (r: Revogados) => gravador.gravar(r) }) });
  const dados: DadosDoWorker = {
    paraServidorMcp: true,
    segredo: segredo.toString("base64"),
    maxPanes: o.deps.maxPanesParalelos,
    porta: o.porta ?? 0,
    revogados,
    ...(Number.isInteger(portaAnterior) && portaAnterior > 0 && portaAnterior < 65536 ? { portaPreferida: portaAnterior } : {}),
  };
  const thread: ThreadMcp = o.criarThread !== undefined ? o.criarThread(dados) : (new Worker(o.caminhoWorker, { workerData: dados }) as unknown as ThreadMcp);
  const d = o.deps;
  const desligar = atenderChamadas(thread, {
    "panes.spawn": (p: Parameters<DepsTools["panes"]["spawn"]>[0]) => d.panes.spawn(p),
    "panes.listar": (f: Parameters<DepsTools["panes"]["listar"]>[0]) => d.panes.listar(f),
    "panes.obter": (id: string) => d.panes.obter(id),
    "panes.ler": (id: string, n: number) => d.panes.ler(id, n),
    "panes.enviar": (id: string, t: string, s: boolean) => d.panes.enviar(id, t, s),
    "panes.fechar": (id: string, m: string) => d.panes.fechar(id, m),
    "missoes.obter": (id: string) => d.missoes.obter(id),
    "missoes.listar": (f: Parameters<DepsTools["missoes"]["listar"]>[0]) => d.missoes.listar(f),
    "missoes.concluir": (id: string) => d.missoes.concluir(id),
    "provedores.listar": (ws: string) => d.provedores.listar(ws),
    "provedores.modelos": (p: string) => d.provedores.modelos(p),
    "handoff.registrar": (p: Parameters<DepsTools["handoff"]["registrar"]>[0]) => d.handoff.registrar(p),
    "handoff.doPane": (id: string) => d.handoff.doPane(id),
    "handoff.temRevisorOk": (id: string) => d.handoff.temRevisorOk(id),
    raiz: (ws: string, m: string | null) => d.raiz(ws, m),
    avisar: (m: string) => { d.avisar(m); },
    "ganchos.tratar": (evento: string, contexto: ContextoGancho, corpo: unknown) => o.ganchos.tratar(evento, contexto, corpo),
  });

  const pronto = await new Promise<Pronto>((ok, erro) => {
    const t = setTimeout(() => erro(new Error("O servidor MCP não respondeu a tempo.")), o.tempoLimiteMs ?? 15_000);
    t.unref();
    thread.on("message", (m) => {
      const msg = m as { t?: string; url?: string; urlGanchos?: string; porta?: number; mensagem?: string } | null;
      if (msg?.t === "pronto" && typeof msg.url === "string" && typeof msg.urlGanchos === "string" && typeof msg.porta === "number") {
        clearTimeout(t);
        ok({ url: msg.url, urlGanchos: msg.urlGanchos, porta: msg.porta });
      } else if (msg?.t === "falha") {
        clearTimeout(t);
        erro(new Error(msg.mensagem ?? "O servidor MCP não iniciou."));
      }
    });
    thread.once("error", (e) => { clearTimeout(t); erro(e instanceof Error ? e : new Error("Falha na thread do servidor MCP.")); });
    thread.once("exit", () => { clearTimeout(t); erro(new Error("A thread do servidor MCP terminou.")); });
  }).catch(async (e: unknown) => {
    desligar();
    await thread.terminate().catch(() => undefined);
    throw e;
  });

  // a porta fica gravada para o próximo início (melhor esforço; nunca bloqueia)
  if (arquivoPorta !== null && pronto.porta !== portaAnterior) void writeFile(arquivoPorta, String(pronto.porta), { mode: 0o600 }).catch(() => undefined);

  let fechado = false;
  const anterior = Number.isInteger(portaAnterior) && portaAnterior > 0 ? portaAnterior : null;
  return {
    ...pronto,
    portaAnterior: anterior,
    portaReutilizada: anterior !== null && pronto.porta === anterior,
    emitirToken(pedido) {
      return base.emitir(pedido);
    },
    revogar(pane_id) {
      const limite = base.revogar(pane_id);
      try { thread.postMessage({ t: "revogar", pane_id, limite }); } catch { /* thread já encerrada */ }
    },
    async fechar() {
      if (fechado) return;
      fechado = true;
      const saiu = new Promise<void>((ok) => { thread.once("exit", () => ok()); });
      try { thread.postMessage({ t: "fechar" }); } catch { /* já encerrada */ }
      const limite = new Promise<void>((ok) => { setTimeout(ok, 2_000).unref(); });
      await Promise.race([saiu, limite]);
      desligar();
      await thread.terminate().catch(() => undefined);
      await gravador?.aguardar();
    },
  };
}
