// Host do worker do conhecimento no lado do main (T-15.12): sobe a thread sob demanda, repassa chamadas com timeout/cancelamento e
// REINICIA com backoff quando ela cai. Nada aqui importa Electron: a fábrica da thread é injetada (o main usa `worker_threads`).
// Desistência: depois de `maxFalhas` quedas na janela, fica `indisponivel` até `reiniciar()` (o RAG some, o app não).
import { criarClienteRpc, atenderRpc, RpcIndisponivelErro, type ClienteRpc, type MetodoRpc, type OpcoesChamada, type PortaMensagens } from "./rpc";

export interface ThreadDoWorker {
  porta: PortaMensagens;
  /** o ouvinte é chamado UMA vez quando a thread termina (erro ou saída). */
  aoSair(ouvinte: (motivo: string) => void): void;
  encerrar(): void;
}

export interface OpcoesHost {
  criarThread(): ThreadDoWorker;
  /** métodos que o WORKER pode chamar no main (ex.: `rede.requisitar`). */
  metodosDoMain?: Readonly<Record<string, MetodoRpc>>;
  /** esperas entre reinícios (ms); a última se repete. */
  backoffMs?: readonly number[];
  maxFalhas?: number;
  janelaFalhasMs?: number;
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => { cancelar(): void };
  timeoutPadraoMs?: number;
  aoMudarEstado?: (estado: EstadoHost) => void;
}

export type EstadoHost = "parado" | "subindo" | "pronto" | "reiniciando" | "indisponivel";

export interface HostConhecimento {
  chamar<T = unknown>(metodo: string, args?: unknown[], opcoes?: OpcoesChamada): Promise<T>;
  estado(): EstadoHost;
  /** força nova tentativa (zera a contagem de falhas). */
  reiniciar(): void;
  encerrar(): void;
}

export function criarHostConhecimento(op: OpcoesHost): HostConhecimento {
  const backoff = op.backoffMs ?? [500, 1500, 4000, 10_000, 30_000];
  const maxFalhas = op.maxFalhas ?? 5;
  const janela = op.janelaFalhasMs ?? 120_000;
  const agora = op.agora ?? Date.now;
  const agendar =
    op.agendar ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return { cancelar: () => clearTimeout(t) };
    });

  let estado: EstadoHost = "parado";
  let thread: ThreadDoWorker | null = null;
  let cliente: ClienteRpc | null = null;
  let desligarAtendimento: (() => void) | null = null;
  let falhas: number[] = [];
  let timerReinicio: { cancelar(): void } | null = null;
  let encerrado = false;

  const mudar = (e: EstadoHost): void => {
    if (estado === e) return;
    estado = e;
    op.aoMudarEstado?.(e);
  };

  function subir(): void {
    if (encerrado) return;
    mudar("subindo");
    let t: ThreadDoWorker;
    try {
      t = op.criarThread();
    } catch {
      registrarQueda();
      return;
    }
    thread = t;
    cliente = criarClienteRpc(t.porta, "main", op.timeoutPadraoMs ?? 30_000);
    desligarAtendimento = op.metodosDoMain ? atenderRpc(t.porta, "main", op.metodosDoMain) : null;
    t.aoSair(() => {
      if (thread !== t) return;
      registrarQueda();
    });
    mudar("pronto");
  }

  function limparThread(): void {
    desligarAtendimento?.();
    desligarAtendimento = null;
    cliente?.falharPendentes(new RpcIndisponivelErro());
    cliente = null;
    const t = thread;
    thread = null;
    try {
      t?.encerrar();
    } catch {
      /* já encerrada */
    }
  }

  function registrarQueda(): void {
    limparThread();
    if (encerrado) return;
    const t = agora();
    falhas = [...falhas.filter((x) => t - x < janela), t];
    if (falhas.length >= maxFalhas) {
      mudar("indisponivel");
      return;
    }
    mudar("reiniciando");
    timerReinicio = agendar(() => {
      timerReinicio = null;
      subir();
    }, backoff[Math.min(falhas.length - 1, backoff.length - 1)] as number);
  }

  return {
    async chamar<T = unknown>(metodo: string, args: unknown[] = [], opcoes: OpcoesChamada = {}): Promise<T> {
      if (encerrado) throw new RpcIndisponivelErro("o conhecimento foi encerrado");
      if (estado === "indisponivel") throw new RpcIndisponivelErro("o worker do conhecimento falhou várias vezes; reinicie o índice");
      if (estado === "reiniciando") throw new RpcIndisponivelErro("o worker do conhecimento está reiniciando");
      if (thread === null) subir();
      if (cliente === null) throw new RpcIndisponivelErro();
      return cliente.chamar<T>(metodo, args, opcoes);
    },
    estado: () => estado,
    reiniciar() {
      if (encerrado) return;
      timerReinicio?.cancelar();
      timerReinicio = null;
      falhas = [];
      limparThread();
      subir();
    },
    encerrar() {
      encerrado = true;
      timerReinicio?.cancelar();
      timerReinicio = null;
      limparThread();
      mudar("parado");
    },
  };
}
