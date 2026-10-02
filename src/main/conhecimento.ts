// Ligação do Conhecimento / RAG local (Fase 15, onda 2) no main: host do worker (RPC com timeout 170 ms na consulta), porta da Fase 8
// (`PortaConhecimento`), canais `conhecimento:*`, alimentação em ociosidade, progresso para a UI e a porta de consulta das tools MCP.
// Sem Electron aqui: o `main.ts` injeta a fábrica da thread, o canal do renderer, o diálogo de salvar e o sinal de ociosidade.
//
// LEVEZA (P-01/P-12): `ligarConhecimento` só cria objetos e registra canais (nenhum I/O, nenhuma thread). O worker sobe na PRIMEIRA
// chamada (onda 2/ociosa), o main só enfileira (≤ 1 ms) e repassa RPC; consulta que passa de 170 ms devolve `lento` e a tarefa segue.
// Segredo/arquivo de ambiente nunca são lidos aqui; o worker é quem lê docs/código (com denylist) e redige antes de gravar.
import { mkdirSync, renameSync, chmodSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import type { EstadoConhecimento, EstadoConsulta, RespostaBusca, RespostaContexto } from "../compartilhado/conhecimento";
import type { CanaisEvento } from "../compartilhado/ipc";
import type { ConfigConhecimentoDto, EstadoModelosEmbedding } from "../compartilhado/conhecimento-api";
import type { Banco } from "../nucleo/banco";
import type { Repositorios } from "../nucleo/banco/repos";
import { criarReposConhecimentoDominio, type ReposConhecimentoDominio } from "../nucleo/conhecimento/repos-dominio";
import { criarHostConhecimento, type HostConhecimento, type ThreadDoWorker } from "../nucleo/conhecimento/worker/host";
import { RpcCanceladoErro, RpcIndisponivelErro, RpcRemotoErro, RpcTimeoutErro } from "../nucleo/conhecimento/worker/rpc";
import type { EventoConhecimento, PortaConhecimento } from "../nucleo/memoria/eventos-conhecimento";
import type { PortaRag } from "../nucleo/mcp/portas";
import { destilar as destilarComIa, montarResumo, promptDeDestilacao } from "../nucleo/conhecimento/aprendizado/destilar";
import type { Barramento } from "./barramento";
import type { DadosDoWorkerConhecimento } from "./conhecimento-worker";
import type { ManipuladoresConhecimento } from "./ipc/conhecimento";

/** Teto do RPC de consulta contextual: o serviço do worker usa 150 ms; este é o do main (plano, DEC-4 e). */
export const TETO_CONSULTA_MS = 170;
const TIMEOUT_PADRAO_MS = 15_000;
const CHAVE_GLOBAL = "conhecimento_global_ativo";
const INTERVALO_TICK_MS = 4_000;
const INTERVALO_PROGRESSO_MS = 700;
const DIA_MS = 24 * 3_600_000;

export interface DepsConhecimento {
  banco: Banco;
  repos: Repositorios;
  barramento: Pick<Barramento, "assinar" | "emitir" | "emitirCoalescido">;
  /** `<userData>`: o `conhecimento.db` mora aqui (`conhecimento.db`), fora do banco do domínio. */
  pastaDados: string;
  home: string | null;
  codexHome?: string | null;
  caminhoWorker: string;
  /** injetável em teste; o padrão usa `worker_threads`. */
  criarThread?: (dados: DadosDoWorkerConhecimento) => ThreadDoWorker;
  preferencias: { obter(chave: string): unknown };
  enviar: <C extends keyof CanaisEvento>(canal: C, payload: CanaisEvento[C]) => void;
  /** diálogo nativo de salvar; `null` = cancelou. O renderer nunca escolhe o caminho. */
  escolherArquivoDeSaida: (nomeSugerido: string) => Promise<string | null>;
  /** sem flood de PTY e 2 s sem digitação. */
  ocioso: () => boolean;
  /** chamada HTTP ao Ollama no loopback (cliente-http com permissão de loopback só para ele). `null` = Ollama desligado. */
  redeOllama?: ((p: { url: string; metodo: "GET" | "POST"; corpo?: string }, sinal?: AbortSignal) => Promise<{ ok: boolean; status: number; texto: string }>) | null;
  /** métodos extras que o worker pode chamar no main (ex.: `rede.requisitar` do backend online). */
  /** o OBJETO é compartilhado com o host (consultado a cada chamada): quem o recebe pode acrescentar métodos depois (backend online). */
  metodosDoMain?: Record<string, (args: unknown[], sinal: AbortSignal) => unknown>;
  /** ids de conversa das sessões iniciadas pelo app (Claude/Codex), para a fonte de transcrições. */
  sessoesDoApp?: (workspaceId: string) => string[];
  aviso?: (mensagem: string) => void;
  agendar?: (fn: () => void, ms: number) => { cancelar(): void };
  agora?: () => number;
}

/** O que o chat e as tools MCP usam do conhecimento (o real fala com o worker; teste injeta um falso). */
export interface PortaRagMain {
  ativo(workspaceId: string): boolean;
  buscar(p: PedidoBuscaRag): Promise<RespostaBusca>;
  contexto(p: PedidoContextoRag): Promise<RespostaContexto>;
  buscarHits(workspaceId: string, p: { consulta: string; k?: number }): Promise<{ hits: unknown[]; estado: EstadoConsulta }>;
  aprender(p: PedidoAprenderRag): Promise<{ id: string; status: "candidate" | "active" | "merged"; merged_into?: string }>;
  feedback(p: PedidoFeedbackRag): Promise<{ ok: boolean }>;
  consultouRecentemente(workspaceId: string, missionId: string, taskRef: string): Promise<boolean>;
  politica(workspaceId: string): { consulta_obrigatoria: "off" | "aviso" | "bloqueio"; hook_prompt: boolean; contexto_chars: number };
}

export interface PedidoBuscaRag {
  workspace_id: string;
  mission_id: string | null;
  task_ref: string | null;
  pane_id: string | null;
  consulta: string;
  escopo: "projeto" | "missao" | "usuario" | "equipe";
  tipos: string[] | null;
  desde: string | null;
  limite: number;
  modo: "hibrido" | "lexical" | "semantico";
  origem: "tool" | "ui" | "chat";
}
export interface PedidoContextoRag {
  workspace_id: string;
  mission_id: string | null;
  task_ref: string | null;
  pane_id: string | null;
  tarefa: string;
  arquivos: string[];
  orcamento_chars: number;
  origem: "tool" | "injecao" | "hook" | "chat" | "ui";
}
export interface PedidoAprenderRag {
  workspace_id: string;
  mission_id: string | null;
  task_ref: string | null;
  pane_id: string | null;
  cli: string | null;
  tipo: "decisao" | "causa_raiz" | "armadilha" | "padrao" | "correcao" | "fato";
  titulo: string;
  texto: string;
  arquivos: string[];
  substitui: string | null;
}
export interface PedidoFeedbackRag {
  workspace_id: string;
  pane_id: string | null;
  consulta_id: string | null;
  alvo_id: string;
  valor: "util" | "inutil" | "errado";
  nota: string | null;
}

/** Formato esperado por `PortaConhecimentoPrevio` e pelas portas `consultar`/`aprender` do serviço do Maestro. */
export interface PortasRagDoMaestro {
  conhecimento: { contextoPrevio(texto: string, arquivos: string[]): Promise<string | null> };
  consultar(etapaId: string, texto: string): Promise<void>;
  aprender(p: { titulo: string; texto: string; tipo?: PedidoAprenderRag["tipo"]; mission_id?: string | null }): Promise<void>;
}

export interface LigacaoConhecimento {
  host: HostConhecimento;
  repos: ReposConhecimentoDominio;
  /** porta da Fase 8 (substitui `conhecimentoNulo`): `registrar` só enfileira. */
  portaConhecimento: PortaConhecimento;
  rag: PortaRagMain;
  /** a porta das tools MCP `rag_*`, da regra de consulta obrigatória e do contexto injetado (resolve Missão/task pelo Pane; sem memox por texto). */
  portaMcp: PortaRag;
  /** portas de RAG que o Maestro (Fase 16) exige, já presas ao workspace do pipeline. */
  paraMaestro(workspaceId: string): PortasRagDoMaestro;
  manipuladores: ManipuladoresConhecimento;
  /** chamada direta ao worker (para o serviço do chat e do backend online). Garante o workspace aberto. */
  chamarWs<T = unknown>(workspaceId: string, metodo: string, args?: unknown[], opcoes?: { timeoutMs?: number; sinal?: AbortSignal }): Promise<T>;
  workspace(workspaceId: string): { id: string; nome: string; raiz: string };
  /** liga a destilação por IA (P-56) à CLI do chat; sem ela o canal devolve 0. */
  definirDestilador(f: (workspaceId: string, prompt: string, sinal: AbortSignal) => Promise<string>): void;
  /** gancho chamado DEPOIS de o worker abrir um workspace (reaplica o estado de replicação do backend online). */
  aoAbrirWorkspace(f: (workspaceId: string) => Promise<void>): void;
  /** onda 2: tick ocioso, progresso e primeira indexação. Idempotente; cada passo isolado. */
  iniciar(): Promise<void>;
  encerrar(): void;
  metricas(): Record<string, number>;
}

const vazioContexto = (estado: EstadoConsulta): RespostaContexto => ({ markdown: "", sinais: { ja_existe: false, houve_correcao: false, decisoes_relacionadas: 0, fontes: [] }, estado, consulta_id: "", latencia_ms: 0 });

export function ligarConhecimento(d: DepsConhecimento): LigacaoConhecimento {
  const reposDominio = criarReposConhecimentoDominio(d.banco);
  const aviso = (m: string): void => d.aviso?.(m);
  const agora = d.agora ?? Date.now;
  const agendar =
    d.agendar ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return { cancelar: () => clearTimeout(t) };
    });

  // ---------------------------------------------------------------- worker (thread própria; sobe na primeira chamada)
  let geracao = 0;
  const metodosMain: Record<string, (args: unknown[], sinal: AbortSignal) => unknown> = d.metodosDoMain ?? {};
  metodosMain["rede.ollama"] ??= async ([p], sinal) => {
    if (d.redeOllama === undefined || d.redeOllama === null) throw new Error("Ollama desligado");
    return d.redeOllama(p as { url: string; metodo: "GET" | "POST"; corpo?: string }, sinal);
  };
  const abertos = new Set<string>();
  let destilador: ((workspaceId: string, prompt: string, sinal: AbortSignal) => Promise<string>) | null = null;
  const aoAbrir: Array<(workspaceId: string) => Promise<void>> = [];
  const host = criarHostConhecimento({
    criarThread: () => {
      const dados: DadosDoWorkerConhecimento = { paraConhecimento: true, caminhoBanco: join(d.pastaDados, "conhecimento.db"), home: d.home, ...(d.codexHome === undefined ? {} : { codexHome: d.codexHome }) };
      if (d.criarThread !== undefined) return d.criarThread(dados);
      const w = new Worker(d.caminhoWorker, { workerData: dados });
      let saiu: ((m: string) => void) | null = null;
      w.once("error", (e) => saiu?.(e instanceof Error ? e.message : "erro"));
      w.once("exit", (c) => saiu?.(`saiu com ${c}`));
      return {
        porta: w as unknown as ThreadDoWorker["porta"],
        aoSair: (f) => (saiu = f),
        encerrar: () => void w.terminate().catch(() => undefined),
      };
    },
    metodosDoMain: metodosMain,
    timeoutPadraoMs: TIMEOUT_PADRAO_MS,
    aoMudarEstado: (e) => {
      if (e === "reiniciando" || e === "indisponivel" || e === "parado") {
        geracao++;
        abertos.clear();
      }
      if (e === "indisponivel") aviso("conhecimento: o worker falhou várias vezes; o índice fica indisponível até reiniciar");
    },
  });

  // ---------------------------------------------------------------- workspaces e configuração
  const globalAtivo = (): boolean => d.preferencias.obter(CHAVE_GLOBAL) !== false;
  function workspace(id: string): { id: string; nome: string; raiz: string } {
    const w = d.repos.workspace.obter(id);
    if (w === undefined) throw new Error("workspace desconhecido");
    return { id: w.id, nome: w.nome, raiz: w.raiz };
  }
  const ativo = (ws: string): boolean => globalAtivo() && reposDominio.config.ler(ws).ativo;

  async function garantirAberto(ws: string): Promise<void> {
    if (abertos.has(ws)) return;
    const w = workspace(ws);
    const g = geracao;
    await host.chamar("abrir", [{ workspace_id: w.id, nome: w.nome, raiz: w.raiz, ativo: ativo(ws) }], { timeoutMs: 10_000 });
    if (g === geracao) abertos.add(ws);
    for (const f of aoAbrir) await f(ws).catch(() => undefined);
  }
  async function chamarWs<T = unknown>(ws: string, metodo: string, args: unknown[] = [], opcoes: { timeoutMs?: number; sinal?: AbortSignal } = {}): Promise<T> {
    await garantirAberto(ws);
    return host.chamar<T>(metodo, [ws, ...args], opcoes);
  }

  // ---------------------------------------------------------------- consulta (nunca lança; teto de 170 ms; estado explícito)
  const estadoDoErro = (e: unknown): EstadoConsulta => (e instanceof RpcTimeoutErro ? "lento" : "indisponivel");

  async function buscar(p: PedidoBuscaRag): Promise<RespostaBusca> {
    const t0 = agora();
    if (!ativo(p.workspace_id)) return { resultados: [], estado: "desligado", consulta_id: "", latencia_ms: 0, modelo: "", aviso: "conhecimento desligado" };
    try {
      const r = await chamarWs<RespostaBusca>(p.workspace_id, "buscar", [{ consulta: p.consulta, modo: p.modo, tipos: p.tipos, desde: p.desde, limite: p.limite, escopo: p.escopo, origem: p.origem, mission_id: p.mission_id, task_ref: p.task_ref, pane_id: p.pane_id }], { timeoutMs: p.origem === "ui" ? 5_000 : TETO_CONSULTA_MS });
      d.enviar("conhecimento:consultado", { workspace_id: p.workspace_id, consulta_id: r.consulta_id, origem: p.origem, estado: r.estado, n: r.resultados.length, latencia_ms: r.latencia_ms });
      return r;
    } catch (e) {
      const estado = estadoDoErro(e);
      return { resultados: [], estado, consulta_id: "", latencia_ms: Math.round(agora() - t0), modelo: "", aviso: estado === "lento" ? "a consulta demorou; seguindo sem o índice" : "índice indisponível" };
    }
  }

  async function contexto(p: PedidoContextoRag): Promise<RespostaContexto> {
    if (!ativo(p.workspace_id)) return vazioContexto("desligado");
    try {
      const r = await chamarWs<RespostaContexto>(p.workspace_id, "contexto", [{ tarefa: p.tarefa, arquivos: p.arquivos, orcamento_chars: p.orcamento_chars, origem: p.origem, mission_id: p.mission_id, task_ref: p.task_ref, pane_id: p.pane_id }], { timeoutMs: p.origem === "ui" ? 5_000 : TETO_CONSULTA_MS });
      d.enviar("conhecimento:consultado", { workspace_id: p.workspace_id, consulta_id: r.consulta_id, origem: p.origem, estado: r.estado, n: r.sinais.fontes.length, latencia_ms: r.latencia_ms });
      return r;
    } catch (e) {
      return vazioContexto(estadoDoErro(e));
    }
  }

  const rag: PortaRagMain = {
    ativo,
    buscar,
    contexto,
    async buscarHits(ws, p) {
      if (!ativo(ws)) return { hits: [], estado: "desligado" };
      try {
        const r = await chamarWs<{ hits: unknown[]; estado: EstadoConsulta }>(ws, "buscarHits", [{ consulta: p.consulta, k: p.k ?? 12, origem: "chat" }], { timeoutMs: 5_000 });
        return { hits: r.hits, estado: r.estado };
      } catch (e) {
        return { hits: [], estado: estadoDoErro(e) };
      }
    },
    async aprender(p) {
      if (!ativo(p.workspace_id)) throw new RpcIndisponivelErro("conhecimento desligado");
      return chamarWs(p.workspace_id, "aprender", [{ tipo: p.tipo, titulo: p.titulo, texto: p.texto, fonte: "agente", arquivos: p.arquivos, pane_id: p.pane_id, mission_id: p.mission_id, task_ref: p.task_ref, cli: p.cli }], { timeoutMs: 5_000 });
    },
    async feedback(p) {
      if (!ativo(p.workspace_id)) return { ok: false };
      return chamarWs(p.workspace_id, "feedback", [{ alvo_tipo: "aprendizado", alvo_id: p.alvo_id, valor: p.valor, por: "agente", pane_id: p.pane_id, consulta_id: p.consulta_id, nota: p.nota }], { timeoutMs: 3_000 });
    },
    async consultouRecentemente(ws, missionId, taskRef) {
      try {
        return await chamarWs<boolean>(ws, "consultouRecentemente", [missionId, taskRef], { timeoutMs: 500 });
      } catch {
        return false;
      }
    },
    politica(ws) {
      const c = reposDominio.config.ler(ws);
      return { consulta_obrigatoria: c.consulta_obrigatoria, hook_prompt: c.hook_prompt, contexto_chars: c.contexto_chars };
    },
  };

  // ---------------------------------------------------------------- tools MCP, regra de consulta obrigatória, injeção e Maestro
  /** Missão/task do Pane (a identidade vem do token: o agente nunca informa). Sem task ativa, `task_ref` fica nulo. */
  function contextoDoPane(paneId: string | null, missao: string | null, task: string | null): { mission_id: string | null; task_ref: string | null } {
    if (paneId === null) return { mission_id: missao, task_ref: task };
    try {
      const pane = d.banco.consultarUm<{ mission_id: string | null }>("SELECT mission_id FROM pane WHERE id = ?", [paneId]);
      const mission_id = missao ?? pane?.mission_id ?? null;
      if (task !== null || mission_id === null) return { mission_id, task_ref: task };
      const t = d.banco.consultarUm<{ task_ref: string }>("SELECT task_ref FROM task WHERE pane_id = ? AND mission_id = ? AND estado IN ('aberta','reivindicada','entregue') ORDER BY atualizado_em DESC LIMIT 1", [paneId, mission_id]);
      return { mission_id, task_ref: t?.task_ref ?? null };
    } catch {
      return { mission_id: missao, task_ref: task };
    }
  }
  const workspaceDaMissao = (missionId: string): string | null => d.banco.consultarUm<{ workspace_id: string }>("SELECT workspace_id FROM mission WHERE id = ?", [missionId])?.workspace_id ?? null;

  const AVISO_MEMOX = "O memox não oferece busca por texto nesta versão: use /expx:memox-arquivo <caminho> antes de editar arquivos de risco.";
  const portaMcp: PortaRag = {
    ativo: async (ws) => ativo(ws),
    async buscar(p) {
      const c = contextoDoPane(p.pane_id, p.mission_id, p.task_ref);
      const r = await buscar({ workspace_id: p.workspace_id, mission_id: c.mission_id, task_ref: c.task_ref, pane_id: p.pane_id, consulta: p.consulta, escopo: p.escopo, tipos: p.tipos, desde: p.desde, limite: p.limite, modo: p.modo, origem: "tool" });
      return p.fontes.includes("memox") ? { ...r, aviso: [r.aviso, AVISO_MEMOX].filter((x): x is string => x !== null).join(" ") } : r;
    },
    async contexto(p) {
      const c = contextoDoPane(p.pane_id, p.mission_id, p.task_ref);
      return contexto({ workspace_id: p.workspace_id, mission_id: c.mission_id, task_ref: c.task_ref, pane_id: p.pane_id, tarefa: p.tarefa, arquivos: p.arquivos, orcamento_chars: p.orcamento_chars, origem: "tool" });
    },
    async aprender(p) {
      const c = contextoDoPane(p.pane_id, p.mission_id, p.task_ref);
      return rag.aprender({ ...p, mission_id: c.mission_id, task_ref: c.task_ref });
    },
    feedback: (p) => rag.feedback(p),
    async consultouRecentemente(missionId, taskRef) {
      const ws = workspaceDaMissao(missionId);
      if (ws === null) return false;
      try {
        return taskRef === ""
          ? await chamarWs<boolean>(ws, "consultouMissao", [missionId], { timeoutMs: 500 })
          : await chamarWs<boolean>(ws, "consultouRecentemente", [missionId, taskRef], { timeoutMs: 500 });
      } catch {
        return false;
      }
    },
    async politica(ws) {
      return rag.politica(ws);
    },
    async contextoParaInjecao(p) {
      try {
        const pol = rag.politica(p.workspace_id);
        if (pol.contexto_chars <= 0) return "";
        const c = contextoDoPane(p.pane_id, p.mission_id, p.task_ref);
        const r = await contexto({ workspace_id: p.workspace_id, mission_id: c.mission_id, task_ref: c.task_ref, pane_id: p.pane_id, tarefa: p.tarefa, arquivos: p.arquivos, orcamento_chars: pol.contexto_chars, origem: p.origem });
        return r.estado === "ok" || r.estado === "degradado" ? r.markdown : "";
      } catch {
        return "";
      }
    },
  };

  const paraMaestro = (ws: string): PortasRagDoMaestro => ({
    conhecimento: {
      async contextoPrevio(texto, arquivos) {
        const r = await contexto({ workspace_id: ws, mission_id: null, task_ref: null, pane_id: null, tarefa: texto, arquivos, orcamento_chars: rag.politica(ws).contexto_chars, origem: "injecao" });
        return (r.estado === "ok" || r.estado === "degradado") && r.markdown.trim() !== "" ? r.markdown : null;
      },
    },
    async consultar(_etapaId, texto) {
      await contexto({ workspace_id: ws, mission_id: null, task_ref: null, pane_id: null, tarefa: texto, arquivos: [], orcamento_chars: rag.politica(ws).contexto_chars, origem: "injecao" });
    },
    async aprender(p) {
      await rag.aprender({ workspace_id: ws, mission_id: p.mission_id ?? null, task_ref: null, pane_id: null, cli: null, tipo: p.tipo ?? "fato", titulo: p.titulo.slice(0, 120), texto: p.texto.slice(0, 1000), arquivos: [], substitui: null });
    },
  });

  // ---------------------------------------------------------------- porta da Fase 8: só enfileira (≤ 1 ms no main)
  const buffer = new Map<string, EventoConhecimento[]>();
  let descargaAgendada = false;
  function descarregar(): void {
    descargaAgendada = false;
    for (const [ws, eventos] of [...buffer]) {
      buffer.delete(ws);
      void chamarWs(ws, "registrarLote", [eventos.map((evento) => ({ tipo: "evento", evento }))], { timeoutMs: TIMEOUT_PADRAO_MS }).catch(() => undefined);
    }
  }
  const portaConhecimento: PortaConhecimento = {
    registrar(evento) {
      try {
        if (!ativo(evento.workspace_id)) return;
        const fila = buffer.get(evento.workspace_id) ?? [];
        if (fila.length >= 2000) fila.shift();
        fila.push(evento);
        buffer.set(evento.workspace_id, fila);
        if (!descargaAgendada) {
          descargaAgendada = true;
          setImmediate(descarregar);
        }
      } catch {
        /* o RAG nunca derruba quem chama */
      }
    },
  };

  // ---------------------------------------------------------------- manipuladores `conhecimento:*`
  const taskDespachadas7d = (ws: string): Array<{ mission_id: string; task_ref: string }> =>
    d.banco.consultar<{ mission_id: string; task_ref: string }>(
      "SELECT t.mission_id AS mission_id, t.task_ref AS task_ref FROM task t JOIN mission m ON m.id = t.mission_id WHERE m.workspace_id = ? AND t.papel IN ('executor','explorador') AND t.estado IN ('reivindicada','entregue','validada') AND t.criado_em >= ? LIMIT 500",
      [ws, new Date(agora() - 7 * DIA_MS).toISOString()],
    );

  const estadoVazio = (ws: string): EstadoConhecimento => ({
    ativo: ativo(ws),
    chunks: 0,
    documentos: 0,
    aprendizados: { candidato: 0, ativo: 0, arquivado: 0, rejeitado: 0 },
    modelo: "hash-256-v1",
    dimensao: 256,
    vetor_backend: "exato",
    fts5: false,
    tamanho_bytes: 0,
    indexando: { pendentes: 0, fase: null, pct: null },
    reembutindo_pct: null,
    cobertura_consulta_7d_pct: null,
    backend: "local",
  });

  const configDto = (ws: string): ConfigConhecimentoDto => ({ ...reposDominio.config.ler(ws) });
  const opcoesReindexar = (ws: string): { indexar_codigo: boolean; indexar_transcricoes: boolean; sessoes_do_app: string[] } => {
    const c = reposDominio.config.ler(ws);
    return { indexar_codigo: c.indexar_codigo, indexar_transcricoes: c.indexar_transcricoes, sessoes_do_app: d.sessoesDoApp?.(ws) ?? [] };
  };

  async function salvarExportacao(conteudo: unknown, nomeSugerido: string): Promise<string | null> {
    const caminho = await d.escolherArquivoDeSaida(nomeSugerido);
    if (caminho === null) return null;
    mkdirSync(dirname(caminho), { recursive: true });
    const tmp = `${caminho}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(conteudo, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, caminho);
    if (process.platform !== "win32") chmodSync(caminho, 0o600);
    return caminho;
  }

  const manipuladores: ManipuladoresConhecimento = {
    "conhecimento:estado": async ({ workspace_id }) => {
      try {
        return await chamarWs<EstadoConhecimento>(workspace_id, "estado", [{ tarefasDespachadas7d: taskDespachadas7d(workspace_id) }], { timeoutMs: 5_000 });
      } catch {
        return estadoVazio(workspace_id);
      }
    },
    "conhecimento:config_ler": ({ workspace_id }) => configDto(workspace_id),
    "conhecimento:config_gravar": async ({ workspace_id, ...patch }) => {
      workspace(workspace_id);
      reposDominio.config.gravar(workspace_id, patch);
      if (patch.ativo !== undefined) await chamarWs(workspace_id, "ativar", [ativo(workspace_id)]).catch(() => undefined);
      return configDto(workspace_id);
    },
    "conhecimento:buscar": (p) => buscar({ workspace_id: p.workspace_id, mission_id: null, task_ref: null, pane_id: null, consulta: p.consulta, escopo: p.escopo, tipos: p.tipos, desde: p.desde, limite: p.limite, modo: p.modo, origem: "ui" }),
    "conhecimento:contexto_previa": (p) => contexto({ workspace_id: p.workspace_id, mission_id: null, task_ref: null, pane_id: null, tarefa: p.tarefa, arquivos: p.arquivos, orcamento_chars: p.orcamento_chars, origem: "ui" }),
    "conhecimento:documentos_listar": ({ workspace_id, ...p }) => chamarWs(workspace_id, "listarDocumentos", [p], { timeoutMs: 5_000 }),
    "conhecimento:documento_detalhe": ({ workspace_id, documento_id }) => chamarWs(workspace_id, "detalheDocumento", [documento_id], { timeoutMs: 5_000 }),
    "conhecimento:reindexar": ({ workspace_id, fonte }) => chamarWs(workspace_id, "reindexar", [fonte, opcoesReindexar(workspace_id)]),
    "conhecimento:esquecer": ({ workspace_id, alvo }) => chamarWs(workspace_id, "esquecer", [alvo], { timeoutMs: 30_000 }),
    "conhecimento:purgar": async ({ workspace_id, confirmacao }) => {
      const r = await chamarWs<{ removidos: number }>(workspace_id, "purgar", [confirmacao], { timeoutMs: 60_000 });
      if (r.removidos < 0) throw new Error("A confirmação digitada não confere com o nome do workspace.");
      return r;
    },
    "conhecimento:importar_historico": ({ workspace_id, cli }) => chamarWs(workspace_id, "importarHistorico", [cli, agora() - 365 * DIA_MS], { timeoutMs: 60_000 }),
    "conhecimento:exportar": async ({ workspace_id }) => {
      const docs = await chamarWs<{ itens: unknown[] }>(workspace_id, "listarDocumentos", [{ tipo: null, mission_id: null, busca: null, depois: null, limite: 200 }], { timeoutMs: 10_000 });
      const aprendizados = await chamarWs<{ itens: unknown[] }>(workspace_id, "listarAprendizados", [{ estado: null, tipo: null, busca: null, depois: null, limite: 200 }], { timeoutMs: 10_000 });
      // exporta o que o usuário vê (metadados e aprendizados já redigidos); o texto dos chunks não sai daqui
      return { caminho_salvo: await salvarExportacao({ versao: 1, workspace: workspace(workspace_id).nome, documentos: docs.itens, aprendizados: aprendizados.itens }, "conhecimento.json") };
    },
    "conhecimento:grafo_subgrafo": ({ workspace_id, ...f }) => chamarWs(workspace_id, "subgrafo", [f], { timeoutMs: 10_000 }),
    "conhecimento:grafo_no": ({ workspace_id, no_id }) => chamarWs(workspace_id, "detalheNo", [no_id], { timeoutMs: 5_000 }),
    "conhecimento:grafo_posicoes_gravar": ({ workspace_id, posicoes }) => chamarWs(workspace_id, "gravarPosicoes", [posicoes], { timeoutMs: 10_000 }),
    "conhecimento:aprendizados_listar": ({ workspace_id, ...p }) => chamarWs(workspace_id, "listarAprendizados", [p], { timeoutMs: 5_000 }),
    "conhecimento:aprendizado_atualizar": async ({ workspace_id, id, acao, texto }) => {
      if (acao === "editar" && (texto === undefined || texto.trim() === "")) throw new Error("Informe o novo texto do aprendizado.");
      return chamarWs(workspace_id, "atualizarAprendizado", [id, acao, texto ?? null], { timeoutMs: 5_000 });
    },
    "conhecimento:feedback": async ({ workspace_id, alvo_tipo, alvo_id, valor, nota }) => chamarWs(workspace_id, "feedback", [{ alvo_tipo, alvo_id, valor, por: "humano", ...(nota === undefined ? {} : { nota }) }], { timeoutMs: 3_000 }),
    "conhecimento:destilar_missao": async ({ workspace_id, mission_id }) => {
      // P-56: UMA chamada à CLI do chat (faixa rápida, cota da assinatura do usuário), resumo redigido ≤ 6 KB → JSON validado por esquema. Sem CLI ou
      // com erro/timeout o determinístico fica como está (0 novos).
      if (destilador === null) return { aprendizados: 0 };
      const dono = d.banco.consultarUm<{ workspace_id: string }>("SELECT workspace_id FROM mission WHERE id = ?", [mission_id]);
      if (dono === undefined || dono.workspace_id !== workspace_id) throw new Error("Missão desconhecida neste workspace.");
      const linhas = (sql: string): string[] => d.banco.consultar<{ t: string }>(sql, [mission_id]).map((r) => r.t);
      const resumo = montarResumo({
        decisoes: linhas("SELECT conteudo AS t FROM memoria_entrada WHERE mission_id = ? AND tipo IN ('decisao','aprendizado') AND estado = 'ativa' ORDER BY importancia DESC LIMIT 20"),
        riscos: linhas("SELECT conteudo AS t FROM memoria_entrada WHERE mission_id = ? AND tipo = 'risco' AND estado = 'ativa' ORDER BY importancia DESC LIMIT 10"),
        handoffs: linhas("SELECT (h.status || ': ' || h.resumo) AS t FROM handoff h JOIN task k ON k.id = h.task_id WHERE k.mission_id = ? ORDER BY h.criado_em DESC LIMIT 20"),
        qa: linhas("SELECT (k.task_ref || ' ' || k.estado || ' - ' || k.titulo) AS t FROM task k WHERE k.mission_id = ? AND k.estado IN ('validada','descartada') ORDER BY k.atualizado_em DESC LIMIT 20"),
      });
      if (resumo.trim() === "") return { aprendizados: 0 };
      const r = await destilarComIa({ resumo, llm: ({ sinal }) => destilador!(workspace_id, promptDeDestilacao(resumo), sinal), prov: { mission_id, origem: "destilacao_ia", em: new Date(agora()).toISOString() } });
      if (r.candidatos.length === 0) return { aprendizados: 0 };
      const n = await chamarWs<number>(workspace_id, "registrarDestilados", [r.candidatos.map((c) => ({ tipo: c.tipo, titulo: c.titulo, texto: c.texto })), mission_id], { timeoutMs: 30_000 });
      return { aprendizados: n };
    },
    "conhecimento:modelos": ({ workspace_id }): Promise<EstadoModelosEmbedding> => chamarWs(workspace_id, "modelos", [], { timeoutMs: 8_000 }),
    "conhecimento:modelo_definir": ({ workspace_id, modelo }): Promise<EstadoModelosEmbedding> => chamarWs(workspace_id, "definirModelo", [modelo], { timeoutMs: 20_000 }),
  };

  // ---------------------------------------------------------------- onda 2: tick ocioso + progresso para a UI
  let iniciado = false;
  let encerrado = false;
  let timerTick: { cancelar(): void } | null = null;
  let timerProgresso: { cancelar(): void } | null = null;
  const ultimoProgresso = new Map<string, string>();
  const ultimoPasso = new Map<string, number>();

  async function tick(): Promise<void> {
    if (encerrado) return;
    try {
      for (const ws of [...abertos]) {
        if (!ativo(ws)) continue;
        // fila pende → drena em fatias de 20 ms (também sem ociosidade total); o resto só ocioso
        for (let i = 0; i < 10 && !encerrado; i++) {
          const r = await host.chamar<{ trabalho: string | null; pendentes: number }>("passo", [ws, { ocioso: d.ocioso() }], { timeoutMs: 5_000 });
          ultimoPasso.set(ws, agora());
          if (r.trabalho === null) break;
          await new Promise<void>((resolver) => setImmediate(resolver));
        }
      }
    } catch (e) {
      if (!(e instanceof RpcIndisponivelErro) && !(e instanceof RpcTimeoutErro) && !(e instanceof RpcCanceladoErro) && !(e instanceof RpcRemotoErro)) aviso("conhecimento: passo de fundo falhou");
    } finally {
      reagendarTick();
    }
  }
  const reagendarTick = (): void => {
    if (encerrado) return;
    timerTick = agendar(() => void tick(), INTERVALO_TICK_MS);
  };

  async function emitirProgresso(): Promise<void> {
    if (encerrado) return;
    try {
      for (const ws of [...abertos]) {
        const p = await host.chamar<{ fase: string | null; pendentes: number; pct: number | null }>("progresso", [ws], { timeoutMs: 2_000 });
        const chave = `${p.fase}|${p.pendentes}|${p.pct}`;
        if (ultimoProgresso.get(ws) === chave) continue;
        ultimoProgresso.set(ws, chave);
        d.barramento.emitirCoalescido("conhecimento:progresso", ws, { workspace_id: ws, fase: p.fase, pendentes: p.pendentes, pct: p.pct }, 100);
      }
    } catch {
      /* sem worker: sem progresso */
    } finally {
      if (!encerrado) timerProgresso = agendar(() => void emitirProgresso(), INTERVALO_PROGRESSO_MS);
    }
  }

  const desligar: Array<() => void> = [];
  desligar.push(d.barramento.assinar("conhecimento:progresso", (p) => d.enviar("conhecimento:progresso", p as CanaisEvento["conhecimento:progresso"])));

  /** Ao ligar o RAG num workspace sem nada indexado, a indexação inicial (docs → commits → código → transcrições) roda em fatias. */
  async function primeiraIndexacao(ws: string): Promise<void> {
    try {
      if (!ativo(ws)) return;
      const est = await chamarWs<EstadoConhecimento>(ws, "estado", [{}], { timeoutMs: 5_000 });
      if (est.documentos === 0 && est.indexando.pendentes === 0) await chamarWs(ws, "reindexar", ["tudo", opcoesReindexar(ws)]);
    } catch {
      /* fica para o botão "Indexar agora" */
    }
  }
  const emFoco = new Set<string>();
  desligar.push(
    d.barramento.assinar("workspaces:mudou", (p: unknown) => {
      const atual = typeof p === "object" && p !== null ? (p as { atual?: { id?: unknown } | null }).atual : null;
      const id = atual?.id;
      if (typeof id === "string" && !emFoco.has(id)) {
        emFoco.add(id);
        void primeiraIndexacao(id);
      }
    }),
  );

  /** Fechou uma Missão: consolida (aprendizados) e relê os commits novos. */
  desligar.push(
    d.barramento.assinar("mission.closed", (p: unknown) => {
      const id = typeof p === "object" && p !== null ? (p as Record<string, unknown>)["mission_id"] : null;
      const ws = typeof id === "string" ? d.banco.consultarUm<{ workspace_id: string }>("SELECT workspace_id FROM mission WHERE id = ?", [id])?.workspace_id : undefined;
      if (ws === undefined || !ativo(ws)) return;
      void chamarWs(ws, "passo", [{ ocioso: true, missaoFechada: true }]).catch(() => undefined);
      void chamarWs(ws, "reindexar", ["git", { ...opcoesReindexar(ws), indexar_codigo: false, indexar_transcricoes: false }]).catch(() => undefined);
    }),
  );
  // o método gravou docs/**: relê os documentos alterados (incremental por mtime/hash em `rag_fonte`)
  let debounceDocs: { cancelar(): void } | null = null;
  desligar.push(
    d.barramento.assinar("metodo:mudou", (p: unknown) => {
      const id = typeof p === "object" && p !== null ? (p as Record<string, unknown>)["workspace_id"] : null;
      if (typeof id !== "string" || !abertos.has(id) || !ativo(id)) return;
      debounceDocs?.cancelar();
      debounceDocs = agendar(() => void chamarWs(id, "reindexar", ["docs", opcoesReindexar(id)]).catch(() => undefined), 2_000);
    }),
  );

  function metricas(): Record<string, number> {
    return { "worker.pronto": host.estado() === "pronto" ? 1 : 0, "workspaces.abertos": abertos.size, "buffer.eventos": [...buffer.values()].reduce((n, l) => n + l.length, 0) };
  }

  return {
    host,
    repos: reposDominio,
    portaConhecimento,
    rag,
    portaMcp,
    paraMaestro,
    manipuladores,
    chamarWs,
    workspace,
    aoAbrirWorkspace: (f) => void aoAbrir.push(f),
    definirDestilador: (f) => void (destilador = f),
    async iniciar() {
      if (iniciado || encerrado) return;
      iniciado = true;
      reagendarTick();
      timerProgresso = agendar(() => void emitirProgresso(), INTERVALO_PROGRESSO_MS);
    },
    encerrar() {
      encerrado = true;
      timerTick?.cancelar();
      timerProgresso?.cancelar();
      debounceDocs?.cancelar();
      while (desligar.length > 0) desligar.pop()?.();
      host.encerrar();
    },
    metricas,
  };
}
