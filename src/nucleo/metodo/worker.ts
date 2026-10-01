import { join } from "node:path";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { criarIndexador, type Indexador } from "./indexador";
import type { IndiceProjeto } from "./tipos";

// Worker de indexação (P-10/P-12): roda em thread própria para nunca bloquear o event loop do main.
// Este arquivo é compilado para CommonJS (dist/nucleo/metodo/worker.js) e carregado com
// `new Worker(caminho)`; no pacote precisa ficar FORA do asar (worker_threads não lê de dentro).

export type MensagemWorker =
  | { id: number; tipo: "indexar"; raiz: string }
  | { id: number; tipo: "descartar"; raiz: string };

export type RespostaWorker = { id: number; ok: true; resultado: unknown } | { id: number; ok: false; erro: string };

/** A função pura que o worker executa: testável sem thread. Nunca lança. */
export async function executarTarefa(indexador: Indexador, msg: MensagemWorker): Promise<RespostaWorker> {
  const id = typeof msg?.id === "number" ? msg.id : -1;
  try {
    switch (msg.tipo) {
      case "indexar":
        if (typeof msg.raiz !== "string" || msg.raiz === "") return { id, ok: false, erro: "raiz ausente" };
        return { id, ok: true, resultado: await indexador.indexar(msg.raiz) };
      case "descartar":
        if (typeof msg.raiz !== "string") return { id, ok: false, erro: "raiz ausente" };
        indexador.descartar(msg.raiz);
        return { id, ok: true, resultado: null };
      default:
        return { id, ok: false, erro: `tipo de tarefa desconhecida: ${String((msg as { tipo?: unknown }).tipo)}` };
    }
  } catch (e) {
    return { id, ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

// ---- lado worker: só liga quando este arquivo roda como thread
if (!isMainThread && parentPort) {
  const porta = parentPort;
  const indexador = criarIndexador();
  // tarefas em série: o estado incremental por raiz não tolera duas indexações simultâneas
  let fila: Promise<void> = Promise.resolve();
  porta.on("message", (msg: MensagemWorker) => {
    fila = fila.then(async () => {
      porta.postMessage(await executarTarefa(indexador, msg));
    });
  });
}

// ---- lado main: cliente que fala com o worker
export interface ClienteWorker {
  indexar(raiz: string): Promise<IndiceProjeto>;
  descartar(raiz: string): Promise<void>;
  encerrar(): Promise<void>;
}

export function criarClienteWorker(caminho: string = join(__dirname, "worker.js")): ClienteWorker {
  const worker = new Worker(caminho);
  let proximo = 1;
  let encerrado = false;
  const pendentes = new Map<number, { ok: (v: unknown) => void; erro: (e: Error) => void }>();

  worker.on("message", (r: RespostaWorker) => {
    const p = pendentes.get(r.id);
    if (!p) return;
    pendentes.delete(r.id);
    if (r.ok) p.ok(r.resultado);
    else p.erro(new Error(r.erro));
  });
  const falhar = (e: Error): void => {
    for (const p of pendentes.values()) p.erro(e);
    pendentes.clear();
  };
  worker.on("error", (e) => falhar(e instanceof Error ? e : new Error(String(e))));
  worker.on("exit", () => {
    encerrado = true;
    falhar(new Error("worker de indexacao encerrado"));
  });

  const chamar = (msg: Omit<MensagemWorker, "id">): Promise<unknown> => {
    if (encerrado) return Promise.reject(new Error("worker de indexacao encerrado"));
    const id = proximo++;
    return new Promise((ok, erro) => {
      pendentes.set(id, { ok, erro });
      worker.postMessage({ ...msg, id });
    });
  };

  return {
    indexar: (raiz) => chamar({ tipo: "indexar", raiz }) as Promise<IndiceProjeto>,
    descartar: async (raiz) => void (await chamar({ tipo: "descartar", raiz })),
    async encerrar() {
      if (encerrado) return;
      encerrado = true;
      await worker.terminate();
    },
  };
}
