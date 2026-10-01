// Thread do servidor MCP (D-13): carrega o SDK e atende o HTTP em loopback. Não toca banco, terminais
// nem arquivos do usuário: tudo o que uma tool precisa chega por chamadas ao main (`mcp-rpc.ts`).
// Compilado para CommonJS e carregado com `new Worker(caminho)`; no pacote fica FORA do asar.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import type { ContextoGancho, PortaGanchos } from "../nucleo/mcp/portas";
import { relogioReal } from "../nucleo/mcp/portas";
import { iniciarServidorMcp, type ServidorMcp } from "../nucleo/mcp/servidor";
import { criarEmissorDeTokens, type EmissorDeTokens } from "../nucleo/mcp/tokens";
import type { DepsTools } from "../nucleo/mcp/tools/comum";
import type { DadosDoWorker } from "./mcp-remoto";
import { criarChamador, type PortaDeMensagens } from "./mcp-rpc";

/** Monta o servidor desta thread falando com o main por `porta`. Exportado para teste em processo. */
export async function montarServidorDoWorker(
  porta: PortaDeMensagens,
  dados: DadosDoWorker,
  aoFechar: () => void = () => process.exit(0),
): Promise<ServidorMcp> {
  const { chamar } = criarChamador(porta);
  const base = criarEmissorDeTokens({ segredo: Buffer.from(dados.segredo, "base64"), ...(dados.revogados === undefined ? {} : { revogados: dados.revogados }) });
  const revogados = new Map<string, number>();
  const emissor: EmissorDeTokens = {
    emitir() {
      throw new Error("Tokens só são emitidos no main.");
    },
    verificar(token) {
      const claims = base.verificar(token);
      if (claims === null) return null;
      const limite = revogados.get(claims.pane_id);
      return limite !== undefined && claims.n <= limite ? null : claims;
    },
    revogar(pane_id) {
      revogados.set(pane_id, Number.MAX_SAFE_INTEGER);
      return Number.MAX_SAFE_INTEGER;
    },
  };
  const deps: DepsTools = {
    panes: {
      spawn: (p) => chamar("panes.spawn", p),
      listar: (f) => chamar("panes.listar", f),
      obter: (id) => chamar("panes.obter", id),
      ler: (id, n) => chamar("panes.ler", id, n),
      enviar: (id, t, s) => chamar("panes.enviar", id, t, s),
      fechar: (id, m) => chamar("panes.fechar", id, m),
    },
    missoes: {
      obter: (id) => chamar("missoes.obter", id),
      listar: (f) => chamar("missoes.listar", f),
      concluir: (id) => chamar("missoes.concluir", id),
    },
    provedores: { listar: (ws) => chamar("provedores.listar", ws), modelos: (p) => chamar("provedores.modelos", p) },
    handoff: {
      registrar: (p) => chamar("handoff.registrar", p),
      doPane: (id) => chamar("handoff.doPane", id),
      temRevisorOk: (id) => chamar("handoff.temRevisorOk", id),
    },
    relogio: relogioReal,
    raiz: (ws, m) => chamar("raiz", ws, m),
    maxPanesParalelos: dados.maxPanes,
    avisar: (m) => { void chamar("avisar", m).catch(() => undefined); },
  };
  const ganchos: PortaGanchos = { tratar: (evento: string, contexto: ContextoGancho, corpo: unknown) => chamar("ganchos.tratar", evento, contexto, corpo) };
  const servidor = await iniciarServidorMcp({ deps, emissor, ganchos, porta: dados.porta, ...(dados.portaPreferida === undefined ? {} : { portaPreferida: dados.portaPreferida }) });
  porta.on("message", (m) => {
    const msg = m as { t?: string; pane_id?: string; limite?: number } | null;
    if (msg?.t === "revogar" && typeof msg.pane_id === "string" && typeof msg.limite === "number") revogados.set(msg.pane_id, msg.limite);
    else if (msg?.t === "fechar") void servidor.fechar().finally(aoFechar);
  });
  porta.postMessage({ t: "pronto", url: servidor.url, urlGanchos: servidor.urlGanchos, porta: servidor.porta });
  return servidor;
}

const dadosDoWorker = workerData as Partial<DadosDoWorker> | null | undefined;
if (!isMainThread && parentPort !== null && dadosDoWorker?.paraServidorMcp === true) {
  const porta = parentPort;
  montarServidorDoWorker(porta, dadosDoWorker as DadosDoWorker).catch((e: unknown) => {
    porta.postMessage({ t: "falha", mensagem: e instanceof Error ? e.message : "O servidor MCP não iniciou." });
  });
}
