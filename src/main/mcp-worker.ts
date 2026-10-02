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
      fechados: (f) => chamar("panes.fechados", f),
      relatorio: (id) => chamar("panes.relatorio", id),
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
    harness: {
      listar: (ws, c) => chamar("harness.listar", ws, c),
      recomendar: (ws, desc) => chamar("harness.recomendar", ws, desc),
      definir: (p) => chamar("harness.definir", p),
      pilotoEditaPolitica: (ws) => chamar("harness.pilotoEditaPolitica", ws),
      decisoes: (f) => chamar("harness.decisoes", f),
    },
    limites: { limites: (p) => chamar("limites.limites", p), escolher: (p) => chamar("limites.escolher", p) },
    rota: { nivel: (ws) => chamar("rota.nivel", ws), rotear: (p) => chamar("rota.rotear", p), gravar: (id, r, ag) => chamar("rota.gravar", id, r, ag) },
    troca: { mover: (p) => chamar("troca.mover", p) },
    squads: { listar: (id) => chamar("squads.listar", id), invocar: (c, a) => chamar("squads.invocar", c, a) },
    loja: { segredos: (paneId, servidor) => chamar("loja.segredos", paneId, servidor), listar: (paneId, f) => chamar("loja.listar", paneId, f) },
    gateway: { listar: (paneId) => chamar("gateway.listar", paneId), chamar: (paneId, nome, args) => chamar("gateway.chamar", paneId, nome, args) },
    memoria: { chamar: (tool, paneId, args) => chamar("memoria.chamar", tool, paneId, args), temAprendizado: (id) => chamar("memoria.temAprendizado", id) },
    maestro: { pedir: (c, p) => chamar("maestro.pedir", c, p), status: (c, planId) => chamar("maestro.status", c, planId), permitido: (paneId) => chamar("maestro.permitido", paneId) },
    agil: { chamar: (tool, c, a) => chamar("agil.chamar", tool, c, a) },
    custo: { listarTasks: (c, p) => chamar("custo.listarTasks", c, p), obterTask: (c, p) => chamar("custo.obterTask", c, p), relatorio: (c, p) => chamar("custo.relatorio", c, p) },
    alertas: { levantar: (c, a) => chamar("alertas.levantar", c, a) },
    rag: {
      ativo: (ws) => chamar("rag.ativo", ws),
      buscar: (p) => chamar("rag.buscar", p),
      contexto: (p) => chamar("rag.contexto", p),
      aprender: (p) => chamar("rag.aprender", p),
      feedback: (p) => chamar("rag.feedback", p),
      consultouRecentemente: (missionId, taskRef) => chamar("rag.consultouRecentemente", missionId, taskRef),
      politica: (ws) => chamar("rag.politica", ws),
      contextoParaInjecao: (p) => chamar("rag.contextoParaInjecao", p),
    },
    catalogo: { listar: (p) => chamar("catalogo.listar", p), permitidasDoPane: (paneId) => chamar("catalogo.permitidasDoPane", paneId), permitidasDoPapel: (p) => chamar("catalogo.permitidasDoPapel", p) },
    mapa: {
      disponivel: (ws) => chamar("mapa.disponivel", ws),
      status: (ws) => chamar("mapa.status", ws),
      query: (ws, a) => chamar("mapa.query", ws, a),
      impact: (ws, a) => chamar("mapa.impact", ws, a),
      evidence: (ws, a) => chamar("mapa.evidence", ws, a),
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
