import { cpus } from "node:os";
import { join } from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type { DadosWorker, MensagemExtrair, RespostaExtracao } from "./worker-extracao";
import type { Extracao, Linguagem } from "./tipos";

// Pool de workers de extração (T-17.05, D-163). Tamanho = min(CPU−1, 4) (mínimo 1); workers criados SOB DEMANDA e
// encerrados após 30 s ociosos (0 workers e 0 handles com o mapa parado, P-248); fila FIFO com UMA tarefa por worker
// (o timeout de 5 s por arquivo conta só o tempo de execução); timeout mata o worker e o pool segue; queda do
// worker isola o erro no arquivo (uma nova tentativa antes de desistir); cancelamento por AbortSignal.
// O pool nunca roda extração no thread que o chama.

export interface TarefaExtracao {
  caminho_abs: string;
  /** Raiz absoluta do workspace: o worker recusa arquivo cujo realpath saia dela. */
  raiz?: string;
  /** Relativo à raiz do workspace (vira o `caminho` da extração). */
  caminho?: string;
  linguagem: Linguagem;
  versao_extrator?: number;
  tamanho_max?: number;
}

export type CodigoFalha = "erro" | "timeout" | "queda" | "cancelado" | "encerrado" | "nao_implementado" | "sem_gramatica" | "parse_falhou" | "arquivo_sensivel" | "arquivo_ilegivel";

export type ResultadoTarefa = { ok: true; extracao: Extracao; ms: number } | { ok: false; erro: string; codigo: CodigoFalha; timeout?: true };

export interface OpcoesPool {
  /** Padrão: `worker-extracao.js` ao lado deste módulo (CommonJS compilado). */
  caminhoWorker?: string;
  /** Padrão: `min(CPU−1, 4)`, mínimo 1. */
  tamanho?: number;
  /** Padrão 5 000 ms por arquivo. */
  timeoutMs?: number;
  /** Padrão 30 000 ms: encerra o worker parado. */
  ociosoMs?: number;
  workerData?: DadosWorker | Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  /** Fábrica de workers (testes observam o ciclo de vida das threads). */
  criarWorker?: (caminho: string, opcoes: WorkerOptions) => Worker;
}

export interface OpcoesLote {
  signal?: AbortSignal;
  /** Chamado a cada resultado, na ordem de conclusão (progresso). */
  aoResultado?: (indice: number, resultado: ResultadoTarefa) => void;
}

export interface Pool {
  readonly tamanho: number;
  /** Workers vivos agora. */
  readonly vivos: number;
  readonly emVoo: number;
  readonly naFila: number;
  executar(tarefa: TarefaExtracao, sinal?: AbortSignal): Promise<ResultadoTarefa>;
  /** Resultados na ORDEM de entrada; mantém no máximo 2×N tarefas em voo (backpressure). */
  executarLote(tarefas: Iterable<TarefaExtracao>, opcoes?: OpcoesLote): Promise<ResultadoTarefa[]>;
  /** Cancela fila e execuções (resultados `cancelado`); o pool continua utilizável (retomada). */
  cancelar(): void;
  encerrar(): Promise<void>;
}

export function tamanhoPadraoPool(ncpu: number = cpus().length): number {
  return Math.min(Math.max(ncpu - 1, 1), 4);
}

interface Pendente {
  tarefa: TarefaExtracao;
  resolver: (r: ResultadoTarefa) => void;
  tentativas: number;
  sinal: AbortSignal | undefined;
  aoAbortar: (() => void) | undefined;
}

interface Slot {
  worker: Worker;
  atual: { id: number; pendente: Pendente } | null;
  timeout: NodeJS.Timeout | undefined;
  ocioso: NodeJS.Timeout | undefined;
  encerrando: boolean;
}

const cancelado = (): ResultadoTarefa => ({ ok: false, erro: "cancelado", codigo: "cancelado" });

export function criarPool(opcoes: OpcoesPool = {}): Pool {
  const caminhoWorker = opcoes.caminhoWorker ?? join(__dirname, "worker-extracao.js");
  const tamanho = Math.max(1, Math.floor(opcoes.tamanho ?? tamanhoPadraoPool()));
  const timeoutMs = opcoes.timeoutMs ?? 5000;
  const ociosoMs = opcoes.ociosoMs ?? 30_000;
  const slots: Slot[] = [];
  const fila: Pendente[] = [];
  let proximoId = 1;
  let encerrado = false;

  const limparTimers = (s: Slot): void => {
    if (s.timeout !== undefined) clearTimeout(s.timeout);
    if (s.ocioso !== undefined) clearTimeout(s.ocioso);
    s.timeout = undefined;
    s.ocioso = undefined;
  };

  const matar = (s: Slot): Promise<number> => {
    s.encerrando = true;
    limparTimers(s);
    const i = slots.indexOf(s);
    if (i !== -1) slots.splice(i, 1);
    return s.worker.terminate();
  };

  const concluir = (p: Pendente, r: ResultadoTarefa): void => {
    if (p.sinal !== undefined && p.aoAbortar !== undefined) p.sinal.removeEventListener("abort", p.aoAbortar);
    p.resolver(r);
  };

  const criarSlot = (): Slot => {
    const opcoesWorker: WorkerOptions = { workerData: opcoes.workerData ?? {}, ...(opcoes.env !== undefined ? { env: opcoes.env } : {}) };
    const worker = opcoes.criarWorker !== undefined ? opcoes.criarWorker(caminhoWorker, opcoesWorker) : new Worker(caminhoWorker, opcoesWorker);
    worker.unref(); // ocioso não segura o processo; `ref()` enquanto trabalha
    const slot: Slot = { worker, atual: null, timeout: undefined, ocioso: undefined, encerrando: false };
    worker.on("message", (r: RespostaExtracao) => {
      const a = slot.atual;
      if (a === null || r.id !== a.id) return;
      slot.atual = null;
      limparTimers(slot);
      worker.unref();
      concluir(a.pendente, r.ok ? { ok: true, extracao: r.extracao, ms: r.ms } : { ok: false, erro: r.erro, codigo: r.codigo });
      aposLiberar(slot);
    });
    const cair = (motivo: string): void => {
      if (slot.encerrando) return;
      const a = slot.atual;
      slot.atual = null;
      void matar(slot);
      if (a !== null) {
        if (a.pendente.tentativas < 2 && !encerrado) {
          a.pendente.tentativas++;
          fila.unshift(a.pendente); // uma nova tentativa num worker novo
        } else {
          concluir(a.pendente, { ok: false, erro: `worker caiu: ${motivo}`, codigo: "queda" });
        }
      }
      despachar();
    };
    worker.on("error", (e) => cair(e instanceof Error ? e.message : String(e)));
    worker.on("exit", (codigo) => cair(`saída ${codigo}`));
    slots.push(slot);
    return slot;
  };

  const aposLiberar = (slot: Slot): void => {
    if (fila.length > 0) {
      despachar();
      return;
    }
    if (ociosoMs > 0 && !slot.encerrando) {
      slot.ocioso = setTimeout(() => void matar(slot), ociosoMs);
      slot.ocioso.unref();
    }
  };

  const enviar = (slot: Slot, pendente: Pendente): void => {
    if (slot.ocioso !== undefined) clearTimeout(slot.ocioso);
    slot.ocioso = undefined;
    const id = proximoId++;
    slot.atual = { id, pendente };
    slot.worker.ref();
    slot.timeout = setTimeout(() => {
      if (slot.atual === null || slot.atual.id !== id) return;
      const a = slot.atual;
      slot.atual = null;
      void matar(slot);
      concluir(a.pendente, { ok: false, erro: `tempo esgotado (${timeoutMs} ms)`, codigo: "timeout", timeout: true });
      despachar();
    }, timeoutMs);
    const t = pendente.tarefa;
    const msg: MensagemExtrair = {
      id,
      tipo: "extrair",
      caminho_abs: t.caminho_abs,
      linguagem: t.linguagem,
      ...(t.raiz !== undefined ? { raiz: t.raiz } : {}),
      ...(t.caminho !== undefined ? { caminho: t.caminho } : {}),
      ...(t.versao_extrator !== undefined ? { versao_extrator: t.versao_extrator } : {}),
      ...(t.tamanho_max !== undefined ? { tamanho_max: t.tamanho_max } : {}),
    };
    slot.worker.postMessage(msg);
  };

  const despachar = (): void => {
    while (fila.length > 0 && !encerrado) {
      let slot = slots.find((s) => s.atual === null && !s.encerrando);
      if (slot === undefined && slots.length < tamanho) slot = criarSlot();
      if (slot === undefined) return;
      enviar(slot, fila.shift() as Pendente);
    }
  };

  const executar = (tarefa: TarefaExtracao, sinal?: AbortSignal): Promise<ResultadoTarefa> => {
    if (encerrado) return Promise.resolve({ ok: false, erro: "pool encerrado", codigo: "encerrado" });
    if (sinal?.aborted === true) return Promise.resolve(cancelado());
    return new Promise<ResultadoTarefa>((resolver) => {
      const pendente: Pendente = { tarefa, resolver, tentativas: 1, sinal, aoAbortar: undefined };
      if (sinal !== undefined) {
        pendente.aoAbortar = () => {
          const i = fila.indexOf(pendente);
          if (i !== -1) {
            fila.splice(i, 1);
            concluir(pendente, cancelado());
            return;
          }
          const slot = slots.find((s) => s.atual?.pendente === pendente);
          if (slot !== undefined) {
            slot.atual = null;
            void matar(slot); // cancelar uma tarefa em execução = encerrar o worker; o próximo é criado sob demanda
            concluir(pendente, cancelado());
            despachar();
          }
        };
        sinal.addEventListener("abort", pendente.aoAbortar, { once: true });
      }
      fila.push(pendente);
      despachar();
    });
  };

  return {
    get tamanho() {
      return tamanho;
    },
    get vivos() {
      return slots.length;
    },
    get emVoo() {
      return slots.filter((s) => s.atual !== null).length;
    },
    get naFila() {
      return fila.length;
    },
    executar,
    async executarLote(tarefas, op = {}) {
      const lista = [...tarefas];
      const resultados = new Array<ResultadoTarefa>(lista.length);
      const janela = tamanho * 2;
      let proximo = 0;
      const corredores = Array.from({ length: Math.min(janela, lista.length) }, async () => {
        for (;;) {
          const i = proximo++;
          if (i >= lista.length) return;
          const r = op.signal?.aborted === true ? cancelado() : await executar(lista[i] as TarefaExtracao, op.signal);
          resultados[i] = r;
          op.aoResultado?.(i, r);
        }
      });
      await Promise.all(corredores);
      return resultados;
    },
    cancelar() {
      for (const p of fila.splice(0)) concluir(p, cancelado());
      for (const s of [...slots]) {
        const a = s.atual;
        if (a !== null) {
          s.atual = null;
          void matar(s);
          concluir(a.pendente, cancelado());
        }
      }
    },
    async encerrar() {
      encerrado = true;
      for (const p of fila.splice(0)) concluir(p, { ok: false, erro: "pool encerrado", codigo: "encerrado" });
      const todos = [...slots];
      for (const s of todos) {
        const a = s.atual;
        s.atual = null;
        if (a !== null) concluir(a.pendente, { ok: false, erro: "pool encerrado", codigo: "encerrado" });
      }
      await Promise.all(todos.map((s) => matar(s)));
    },
  };
}
