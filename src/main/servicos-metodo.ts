// Método Expx por workspace no main (T-04.02/T-04.03): um índice POR WORKTREE (`git worktree list`),
// indexado em worker_threads (P-12: nada de indexação no event loop do main), um observador por worktree
// (debounce de 300 ms, `awaitWriteFinish`) e a mescla de tudo num único `IndiceProjeto` por workspace.
// Nada aqui começa sozinho: só `garantir(...)` (chamado na onda 2 do boot ou sob demanda) abre worker e
// watchers. Somente leitura: nunca escreve em `docs/` (D-04).
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { EventoRastro, IndiceProjeto, ResumoMudancaMetodo } from "../compartilhado/dominio";
import { worktreeList } from "../nucleo/git";
import { lerRastroDoTrabalho } from "../nucleo/metodo/parser/jsonl";
import { acharTrabalho, type IndicesPorRaiz } from "../nucleo/metodo/missao";
import { criarObservador, type Observador, type OpcoesObservador } from "../nucleo/metodo/observador";
import type { Trabalho } from "../nucleo/metodo/tipos";
import type { ClienteWorker } from "../nucleo/metodo/worker";

export interface WorkspaceMetodo {
  id: string;
  raiz: string;
  e_git: boolean;
}

const PAGINA_RASTRO = 500;
const TRABALHO_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const AVISOS_MAX = 200;
const ESPERA_WATCHER_MS = 3_000;

/**
 * Um índice por worktree → um por workspace. A árvore principal dá a base (camadas, rejeições); trabalho
 * que só existe num worktree entra com o caminho dele; o mesmo trabalho nas duas árvores fica com a
 * atividade mais recente (empate: a principal). Violações são as dos trabalhos escolhidos.
 */
export function mesclarIndices(wsRaiz: string, indices: IndicesPorRaiz): IndiceProjeto {
  const principal = indices.get(wsRaiz);
  const primeiro = principal ?? [...indices.values()][0];
  const base: IndiceProjeto = primeiro ?? {
    raiz: wsRaiz, gerado_em: new Date(0).toISOString(), duracao_ms: 0, trabalhos: [], violacoes: [], rejeicoes: [], avisos: [],
    camadas: { convencoes: false, perfil_legado: false, design_system: false, produto: false, hooks: false, lock: false, memoria: false },
    artefatos_lidos: 0,
  };
  const escolhidos = new Map<string, Trabalho>();
  for (const t of principal?.trabalhos ?? []) escolhidos.set(t.id, t);
  const outros = [...indices.entries()].filter(([raiz]) => raiz !== wsRaiz);
  for (const [raiz, indice] of outros) {
    const relativo = relative(wsRaiz, raiz).replaceAll("\\", "/");
    for (const t of indice.trabalhos) {
      const atual = escolhidos.get(t.id);
      if (atual !== undefined && (t.ultima_atividade ?? "") <= (atual.ultima_atividade ?? "")) continue;
      escolhidos.set(t.id, t.worktree === null ? { ...t, worktree: relativo } : t);
    }
  }
  const trabalhos = [...escolhidos.values()];
  const todos = [...indices.values()];
  return {
    ...base,
    raiz: wsRaiz,
    gerado_em: todos.reduce((m, i) => (i.gerado_em > m ? i.gerado_em : m), base.gerado_em),
    duracao_ms: todos.reduce((s, i) => s + i.duracao_ms, 0),
    trabalhos,
    violacoes: trabalhos.flatMap((t) => t.violacoes),
    avisos: [...base.avisos, ...outros.flatMap(([, i]) => i.avisos)].slice(0, AVISOS_MAX),
    artefatos_lidos: todos.reduce((s, i) => s + i.artefatos_lidos, 0),
  };
}

async function worktreesPadrao(ws: WorkspaceMetodo): Promise<string[]> {
  if (!ws.e_git) return [ws.raiz];
  try {
    const lista = await worktreeList(ws.raiz);
    const outras = lista.filter((w) => !w.principal && !w.bare && !w.prunable && existsSync(w.caminho)).map((w) => w.caminho);
    return [ws.raiz, ...outras];
  } catch {
    return [ws.raiz];
  }
}

export interface DependenciasGerenciadorMetodo {
  /** Cliente do worker de indexação; criado só no primeiro uso. */
  criarCliente: () => ClienteWorker;
  /** Raízes (absolutas) a indexar: a do workspace primeiro, depois cada worktree. Padrão: `git worktree list`. */
  worktreesDe?: (ws: WorkspaceMetodo) => Promise<string[]>;
  criarObservador?: (op: OpcoesObservador) => Observador;
  /** Depois de cada releitura causada por mudança em disco (alimenta `metodo:mudou`). */
  aoMudar: (resumo: ResumoMudancaMetodo) => void;
  /** Depois de qualquer (re)indexação, inclusive a primeira: é onde se liga Missão ↔ trabalho. */
  aoAtualizar?: (workspaceId: string) => void | Promise<void>;
  aviso?: (mensagem: string) => void;
  debounceMs?: number;
  estabilidadeMs?: number;
  assentamentoMs?: number;
}

export interface GerenciadorMetodo {
  /** Indexa o workspace e passa a observá-lo (idempotente). */
  garantir(ws: WorkspaceMetodo): Promise<void>;
  /** Resolve quando os watchers do workspace estão prontos (ou passou o limite). */
  prontoObservadores(workspaceId: string): Promise<void>;
  /** Índice mesclado do workspace; `null` se ainda não foi garantido. */
  estado(workspaceId: string): IndiceProjeto | null;
  /** Índices por raiz absoluta (vazio se o workspace não foi garantido). */
  indices(workspaceId: string): Promise<IndicesPorRaiz>;
  rastro(workspaceId: string, trabalhoId: string, depois: number): Promise<{ eventos: EventoRastro[]; proximo: number }>;
  /** Relê `git worktree list`: worktree novo entra, removido sai. */
  ressincronizar(workspaceId: string): Promise<void>;
  soltar(workspaceId: string): Promise<void>;
  soltarExceto(workspaceId: string | null): Promise<void>;
  /** Fecha todos os watchers e o worker. Idempotente. */
  encerrar(): Promise<void>;
}

interface Entrada {
  ws: WorkspaceMetodo;
  indices: Map<string, IndiceProjeto>;
  observadores: Map<string, Observador>;
  /** serializa tudo o que mexe na entrada */
  fila: Promise<unknown>;
  /** watchers com o `ready` dado (mudança depois disso nunca se perde) */
  prontos: Promise<void>;
  fechada: boolean;
}

export function criarGerenciadorMetodo(deps: DependenciasGerenciadorMetodo): GerenciadorMetodo {
  const entradas = new Map<string, Entrada>();
  const emProgresso = new Map<string, Promise<void>>();
  let cliente: ClienteWorker | null = null;
  let encerrado = false;
  const aviso = (m: string): void => deps.aviso?.(m);
  const worker = (): ClienteWorker => (cliente ??= deps.criarCliente());
  const erroTexto = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  /** Fire-and-forget: quem liga Missões pergunta pelos índices (`indices()` espera a fila), então nunca se espera por ele aqui. */
  const atualizou = (workspaceId: string): void => {
    try {
      void Promise.resolve(deps.aoAtualizar?.(workspaceId)).catch(() => undefined);
    } catch {
      /* callback com erro não derruba o gerenciador */
    }
  };

  const naFila = <T>(e: Entrada, fn: () => Promise<T>): Promise<T> => {
    const r = e.fila.then(fn, fn);
    e.fila = r.catch(() => undefined);
    return r;
  };

  async function indexar(e: Entrada, raiz: string): Promise<void> {
    try {
      e.indices.set(raiz, await worker().indexar(raiz));
    } catch (erro) {
      aviso(`indexação de ${e.ws.id} falhou: ${erroTexto(erro)}`);
    }
  }

  async function soltarRaiz(e: Entrada, raiz: string): Promise<void> {
    const obs = e.observadores.get(raiz);
    e.observadores.delete(raiz);
    e.indices.delete(raiz);
    await obs?.fechar().catch(() => undefined);
    await cliente?.descartar(raiz).catch(() => undefined);
  }

  function abrirObservador(e: Entrada, raiz: string): void {
    const fabrica = deps.criarObservador ?? criarObservador;
    const obs = fabrica({
      raiz,
      ...(deps.debounceMs === undefined ? {} : { debounceMs: deps.debounceMs }),
      ...(deps.estabilidadeMs === undefined ? {} : { estabilidadeMs: deps.estabilidadeMs }),
      ...(deps.assentamentoMs === undefined ? {} : { assentamentoMs: deps.assentamentoMs }),
      aoErro: (erro) => aviso(`observador de ${e.ws.id}: ${erro.message}`),
      aoMudar: () =>
        naFila(e, async () => {
          if (e.fechada || !e.observadores.has(raiz)) return;
          await indexar(e, raiz);
          if (e.fechada) return;
          const merged = mesclarIndices(e.ws.raiz, e.indices);
          deps.aoMudar({ workspace_id: e.ws.id, trabalhos: merged.trabalhos.length, violacoes: merged.violacoes.length, gerado_em: merged.gerado_em });
          atualizou(e.ws.id);
        }),
    });
    e.observadores.set(raiz, obs);
  }

  /** Alinha o conjunto ao `git worktree list`. */
  async function sincronizar(e: Entrada): Promise<void> {
    const alvo = [...new Set(await (deps.worktreesDe ?? worktreesPadrao)(e.ws))];
    if (!alvo.includes(e.ws.raiz)) alvo.unshift(e.ws.raiz);
    for (const raiz of [...e.indices.keys(), ...e.observadores.keys()]) if (!alvo.includes(raiz)) await soltarRaiz(e, raiz);
    const novas = alvo.filter((r) => !e.observadores.has(r));
    await Promise.all(novas.map((r) => indexar(e, r)));
    if (e.fechada) return;
    for (const raiz of novas) abrirObservador(e, raiz);
    // a indexação já está pronta para o `metodo:estado`; os watchers terminam em segundo plano
    e.prontos = Promise.all([e.prontos, ...novas.map((raiz) => Promise.race([e.observadores.get(raiz)?.pronto, new Promise<void>((r) => setTimeout(r, ESPERA_WATCHER_MS).unref())]))]).then(() => undefined);
  }

  const obter = (id: string): Entrada | undefined => entradas.get(id);

  return {
    async garantir(ws) {
      if (encerrado) return;
      const existente = emProgresso.get(ws.id);
      if (existente !== undefined) return existente;
      if (entradas.has(ws.id)) return;
      const e: Entrada = { ws, indices: new Map(), observadores: new Map(), fila: Promise.resolve(), prontos: Promise.resolve(), fechada: false };
      entradas.set(ws.id, e);
      const execucao = naFila(e, () => sincronizar(e))
        .then(() => atualizou(ws.id))
        .catch((erro: unknown) => aviso(`método de ${ws.id}: ${erroTexto(erro)}`))
        .finally(() => void emProgresso.delete(ws.id));
      emProgresso.set(ws.id, execucao);
      return execucao;
    },

    async prontoObservadores(workspaceId) {
      const e = obter(workspaceId);
      if (e === undefined) return;
      await e.fila;
      await e.prontos;
    },

    estado(workspaceId) {
      const e = obter(workspaceId);
      if (e === undefined || e.indices.size === 0) return null;
      return mesclarIndices(e.ws.raiz, e.indices);
    },

    async indices(workspaceId) {
      const e = obter(workspaceId);
      if (e !== undefined) await e.fila;
      return new Map(e?.indices ?? []);
    },

    async rastro(workspaceId, trabalhoId, depois) {
      const e = obter(workspaceId);
      if (e === undefined || !TRABALHO_SEGURO.test(trabalhoId)) return { eventos: [], proximo: 0 };
      const raiz = acharTrabalho(e.indices, e.ws.raiz, trabalhoId)?.raiz ?? e.ws.raiz;
      const { eventos } = await lerRastroDoTrabalho(join(raiz, "docs", "eventos"), trabalhoId);
      const inicio = Math.max(0, Math.min(depois, eventos.length));
      const pagina = eventos.slice(inicio, inicio + PAGINA_RASTRO);
      return { eventos: pagina, proximo: inicio + pagina.length };
    },

    async ressincronizar(workspaceId) {
      const e = obter(workspaceId);
      if (e === undefined || e.fechada || encerrado) return;
      await naFila(e, () => sincronizar(e)).catch((erro: unknown) => aviso(`método de ${workspaceId}: ${erroTexto(erro)}`));
      atualizou(workspaceId);
    },

    async soltar(workspaceId) {
      const e = obter(workspaceId);
      if (e === undefined) return;
      entradas.delete(workspaceId);
      e.fechada = true;
      await e.fila;
      for (const raiz of [...e.observadores.keys()]) await soltarRaiz(e, raiz);
    },

    async soltarExceto(workspaceId) {
      for (const id of [...entradas.keys()]) if (id !== workspaceId) await this.soltar(id);
    },

    async encerrar() {
      if (encerrado) return;
      encerrado = true;
      // o encerramento nunca espera um watcher: o fechamento do `fs.watch` recursivo é imediato, e o resto o SO libera
      await Promise.race([
        Promise.all([...entradas.keys()].map((id) => this.soltar(id))),
        new Promise<void>((resolver) => { setTimeout(resolver, 1_000).unref(); }),
      ]);
      const c = cliente;
      cliente = null;
      await c?.encerrar().catch(() => undefined);
    },
  };
}
