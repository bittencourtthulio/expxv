// Lado do MAIN do servidor MCP em worker thread (ver `mcp-rpc.ts`): cria a thread, atende as chamadas
// das portas de domínio e emite/revoga os tokens de Pane. Este módulo NÃO importa o SDK do MCP: ele é
// leve e só a thread do servidor (`mcp-worker.ts`) carrega o SDK. O segredo dos tokens é sorteado aqui e
// entregue à thread por `workerData` (nunca sai do processo); a emissão é síncrona no main, a verificação
// acontece na thread, e a revogação viaja por mensagem com o número de emissão que separa velho de novo.
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { ContextoGancho, PortaAlertasMcp, PortaAgilMcp, PortaCatalogo, PortaCustoMcp, PortaGanchos, PortaGateway, PortaHarness, PortaLimites, PortaLoja, PortaMaestroMcp, PortaMapaMcp, PortaMemoria, PortaRag, PortaRota, PortaSquads, PortaTroca } from "../nucleo/mcp/portas";
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

function portaHarness(d: DepsDoServidorRemoto): PortaHarness {
  if (d.harness === undefined) throw new Error("harness indisponível");
  return d.harness;
}
function portaLimites(d: DepsDoServidorRemoto): PortaLimites {
  if (d.limites === undefined) throw new Error("limites indisponíveis");
  return d.limites;
}

function portaRota(d: DepsDoServidorRemoto): PortaRota {
  if (d.rota === undefined) throw new Error("rota indisponível");
  return d.rota;
}
function portaTroca(d: DepsDoServidorRemoto): PortaTroca {
  if (d.troca === undefined) throw new Error("troca indisponível");
  return d.troca;
}

function portaSquads(d: DepsDoServidorRemoto): PortaSquads {
  if (d.squads === undefined) throw new Error("squads indisponíveis");
  return d.squads;
}

function portaGateway(d: DepsDoServidorRemoto): PortaGateway {
  if (d.gateway === undefined) throw new Error("gateway indisponível");
  return d.gateway;
}
function portaLoja(d: DepsDoServidorRemoto): PortaLoja {
  if (d.loja === undefined) throw new Error("loja indisponível");
  return d.loja;
}

function portaMaestro(d: DepsDoServidorRemoto): PortaMaestroMcp {
  if (d.maestro === undefined) throw new Error("maestro indisponível");
  return d.maestro;
}

function portaAlertas(d: DepsDoServidorRemoto): PortaAlertasMcp {
  if (d.alertas === undefined) throw new Error("alertas indisponíveis");
  return d.alertas;
}

function portaAgil(d: DepsDoServidorRemoto): PortaAgilMcp {
  if (d.agil === undefined) throw new Error("gestão ágil indisponível");
  return d.agil;
}

function portaCusto(d: DepsDoServidorRemoto): PortaCustoMcp {
  if (d.custo === undefined) throw new Error("board e custo indisponíveis");
  return d.custo;
}

function portaMemoria(d: DepsDoServidorRemoto): PortaMemoria {
  if (d.memoria === undefined) throw new Error("memória indisponível");
  return d.memoria;
}

function portaRag(d: DepsDoServidorRemoto): PortaRag {
  if (d.rag === undefined) throw new Error("RAG indisponível");
  return d.rag;
}

function portaCatalogo(d: DepsDoServidorRemoto): PortaCatalogo {
  if (d.catalogo === undefined) throw new Error("catálogo indisponível");
  return d.catalogo;
}

function portaMapa(d: DepsDoServidorRemoto): PortaMapaMcp {
  if (d.mapa === undefined) throw new Error("mapa indisponível");
  return d.mapa;
}

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
    "panes.fechados": (f: { workspace_id: string; mission_id: string | null }) => d.panes.fechados?.(f) ?? Promise.resolve([]),
    "panes.relatorio": (id: string) => d.panes.relatorio?.(id) ?? Promise.resolve(null),
    "missoes.obter": (id: string) => d.missoes.obter(id),
    "missoes.listar": (f: Parameters<DepsTools["missoes"]["listar"]>[0]) => d.missoes.listar(f),
    "missoes.concluir": (id: string) => d.missoes.concluir(id),
    "provedores.listar": (ws: string) => d.provedores.listar(ws),
    "provedores.modelos": (p: string) => d.provedores.modelos(p),
    "handoff.registrar": (p: Parameters<DepsTools["handoff"]["registrar"]>[0]) => d.handoff.registrar(p),
    "handoff.doPane": (id: string) => d.handoff.doPane(id),
    "handoff.temRevisorOk": (id: string) => d.handoff.temRevisorOk(id),
    // Fase 9 (T-09.17): harness e limites. Sem a porta no main, a chamada falha e a tool responde `unavailable`.
    "harness.listar": (ws: string, c: string | null) => portaHarness(d).listar(ws, c),
    "harness.recomendar": (ws: string, desc: string) => portaHarness(d).recomendar(ws, desc),
    "harness.definir": (p: Parameters<PortaHarness["definir"]>[0]) => portaHarness(d).definir(p),
    "harness.pilotoEditaPolitica": (ws: string) => portaHarness(d).pilotoEditaPolitica(ws),
    "harness.decisoes": (f: Parameters<PortaHarness["decisoes"]>[0]) => portaHarness(d).decisoes(f),
    "limites.limites": (p: string | null) => portaLimites(d).limites(p),
    "limites.escolher": (p: Parameters<PortaLimites["escolher"]>[0]) => portaLimites(d).escolher(p),
    // Fase 9 (T-09.16, T-09.20): rota do `pane_spawn` sem provedor e `account_switch`.
    "rota.nivel": (ws: string) => portaRota(d).nivel(ws),
    "rota.rotear": (p: Parameters<PortaRota["rotear"]>[0]) => portaRota(d).rotear(p),
    "rota.gravar": (id: string, r: Parameters<PortaRota["gravar"]>[1], ag: string | null) => portaRota(d).gravar(id, r, ag),
    "troca.mover": (p: Parameters<PortaTroca["mover"]>[0]) => portaTroca(d).mover(p),
    // Fase 14 (T-14.13): `agent_list` e `agent_invoke`. A lógica roda aqui no main; o `ErroMcp` da porta atravessa com code/subcode.
    "squads.listar": (missionId: string) => portaSquads(d).listar(missionId),
    "squads.invocar": (c: Parameters<PortaSquads["invocar"]>[0], a: Parameters<PortaSquads["invocar"]>[1]) => portaSquads(d).invocar(c, a),
    // Fase 8: `memory_*` (a lógica roda aqui no main; `MemoriaErro` já chega traduzido para `ErroMcp`) e o aviso do `mission_complete`.
    // Fase 7B: segredos da Loja para o lançador `mcp-run` (a política, o cofre e o limite por Pane moram no main).
    "loja.segredos": (paneId: string, servidor: unknown) => portaLoja(d).segredos(paneId, servidor),
    // Fase 7C: gateway MCP (`POST /gateway`). Filtro, limite, auditoria e servidores moram no main; a thread só autentica o token (audiência `gateway`).
    "gateway.listar": (paneId: string) => portaGateway(d).listar(paneId),
    "gateway.chamar": (paneId: string, nome: string, args: Record<string, unknown>) => portaGateway(d).chamar(paneId, nome, args),
    // Fase 7B (D-138): `mcp_store_list`, só leitura do snapshot do Pane
    "loja.listar": (paneId: string, f: { query: string | null; category: string | null; limit: number }) => {
      const p = portaLoja(d);
      if (p.listar === undefined) throw new Error("loja indisponível");
      return p.listar(paneId, f);
    },
    "memoria.chamar": (tool: Parameters<PortaMemoria["chamar"]>[0], paneId: string, a: Record<string, unknown>) => portaMemoria(d).chamar(tool, paneId, a),
    "memoria.temAprendizado": (missionId: string) => portaMemoria(d).temAprendizado(missionId),
    // Fase 16 (T-16.27): `maestro_request`/`maestro_status`. A lógica roda aqui no main; o `ErroMcp` da porta (loop_guard…) atravessa com code/subcode.
    "maestro.pedir": (c: Parameters<PortaMaestroMcp["pedir"]>[0], p: Parameters<PortaMaestroMcp["pedir"]>[1]) => portaMaestro(d).pedir(c, p),
    "maestro.status": (c: Parameters<PortaMaestroMcp["status"]>[0], planId: string | null) => portaMaestro(d).status(c, planId),
    "maestro.permitido": (paneId: string) => portaMaestro(d).permitido(paneId),
    // Fase 18: `backlog_*`, `estimate_*`, `sprint_status`, `rework_list`, `metrics_get`. A lógica roda aqui no main; o `ErroMcp` (human_only…) atravessa com code/subcode.
    "agil.chamar": (tool: Parameters<PortaAgilMcp["chamar"]>[0], c: Parameters<PortaAgilMcp["chamar"]>[1], a: Record<string, unknown>) => portaAgil(d).chamar(tool, c, a),
    // Fase 10: `task_list`, `task_get`, `cost_report` (SOMENTE LEITURA). A lógica roda aqui no main; o `ErroMcp` (not_found…) atravessa com code/subcode.
    "custo.listarTasks": (c: Parameters<PortaCustoMcp["listarTasks"]>[0], p: Parameters<PortaCustoMcp["listarTasks"]>[1]) => portaCusto(d).listarTasks(c, p),
    "custo.obterTask": (c: Parameters<PortaCustoMcp["obterTask"]>[0], p: Parameters<PortaCustoMcp["obterTask"]>[1]) => portaCusto(d).obterTask(c, p),
    "custo.relatorio": (c: Parameters<PortaCustoMcp["relatorio"]>[0], p: Parameters<PortaCustoMcp["relatorio"]>[1]) => portaCusto(d).relatorio(c, p),
    // Fase 20: `alert_raise`. A lógica (limite por Pane, redação) roda aqui no main; o `ErroMcp` (limit_reached, invalid_argument) atravessa com code/subcode.
    "alertas.levantar": (c: Parameters<PortaAlertasMcp["levantar"]>[0], a: Parameters<PortaAlertasMcp["levantar"]>[1]) => portaAlertas(d).levantar(c, a),
    // Fase 15 (T-15.26): `rag_*`. A lógica roda aqui no main; o `ErroMcp` da porta (rag_disabled, limit_reached…) atravessa com code/subcode.
    "rag.ativo": (ws: string) => portaRag(d).ativo(ws),
    "rag.buscar": (p: Parameters<PortaRag["buscar"]>[0]) => portaRag(d).buscar(p),
    "rag.contexto": (p: Parameters<PortaRag["contexto"]>[0]) => portaRag(d).contexto(p),
    "rag.aprender": (p: Parameters<PortaRag["aprender"]>[0]) => portaRag(d).aprender(p),
    "rag.feedback": (p: Parameters<PortaRag["feedback"]>[0]) => portaRag(d).feedback(p),
    "rag.consultouRecentemente": (missionId: string, taskRef: string) => portaRag(d).consultouRecentemente(missionId, taskRef),
    "rag.politica": (ws: string) => portaRag(d).politica(ws),
    "rag.contextoParaInjecao": (p: Parameters<PortaRag["contextoParaInjecao"]>[0]) => portaRag(d).contextoParaInjecao(p),
    // Fase 17 (T-17.32): `map_*`. Só leitura; a lógica roda aqui no main (o `ErroMcp` da porta atravessa com code/subcode).
    // Fase 7: `catalog_list` (snapshot do PRÓPRIO Pane) e `pane_spawn.skills`. A política e o repositório moram no main; o `ErroMcp` atravessa com code/subcode.
    "catalogo.listar": (p: Parameters<PortaCatalogo["listar"]>[0]) => portaCatalogo(d).listar(p),
    "catalogo.permitidasDoPane": (paneId: string) => portaCatalogo(d).permitidasDoPane(paneId),
    "catalogo.permitidasDoPapel": (p: Parameters<PortaCatalogo["permitidasDoPapel"]>[0]) => portaCatalogo(d).permitidasDoPapel(p),
    "mapa.disponivel": (ws: string) => portaMapa(d).disponivel(ws),
    "mapa.status": (ws: string) => portaMapa(d).status(ws),
    "mapa.query": (ws: string, a: Parameters<PortaMapaMcp["query"]>[1]) => portaMapa(d).query(ws, a),
    "mapa.impact": (ws: string, a: Parameters<PortaMapaMcp["impact"]>[1]) => portaMapa(d).impact(ws, a),
    "mapa.evidence": (ws: string, a: Parameters<PortaMapaMcp["evidence"]>[1]) => portaMapa(d).evidence(ws, a),
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
