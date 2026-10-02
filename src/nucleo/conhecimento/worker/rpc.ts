// RPC simétrico entre a thread do main e a thread do worker do conhecimento (T-15.12): id por chamada, timeout, cancelamento por
// `AbortSignal` e erro como TEXTO curto (nunca o objeto de erro: pode carregar caminho/segredo). Só dados clonáveis cruzam a fronteira.
// Cada lado pode atender E chamar (o worker chama o main para sair à rede, que só o main faz); `de` impede que a resposta de um sentido
// seja tomada pela do outro.
export interface PortaMensagens {
  postMessage(mensagem: unknown): void;
  on(evento: "message", ouvinte: (mensagem: unknown) => void): unknown;
  off?(evento: "message", ouvinte: (mensagem: unknown) => void): unknown;
}

export type LadoRpc = "main" | "worker";

interface Chamada {
  t: "rpc";
  de: LadoRpc;
  id: number;
  metodo: string;
  args: unknown[];
}
interface Resposta {
  t: "resp";
  de: LadoRpc;
  id: number;
  ok: boolean;
  valor?: unknown;
  erro?: string;
}
interface Cancelar {
  t: "cancel";
  de: LadoRpc;
  id: number;
}

export class RpcTimeoutErro extends Error {
  override name = "RpcTimeoutErro";
  constructor(readonly metodo: string, readonly ms: number) {
    super(`a chamada ${metodo} excedeu ${ms} ms`);
  }
}
export class RpcCanceladoErro extends Error {
  override name = "RpcCanceladoErro";
  constructor(readonly metodo: string) {
    super(`a chamada ${metodo} foi cancelada`);
  }
}
export class RpcIndisponivelErro extends Error {
  override name = "RpcIndisponivelErro";
  constructor(motivo = "o worker do conhecimento está indisponível") {
    super(motivo);
  }
}
/** Erro de negócio devolvido pelo outro lado (mensagem já curta e sem segredo). */
export class RpcRemotoErro extends Error {
  override name = "RpcRemotoErro";
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const MAX_ERRO = 300;

function textoDoErro(e: unknown): string {
  const m = e instanceof Error ? e.message : "falha interna";
  // caminho absoluto (posix/windows) nunca atravessa a fronteira
  return m.replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"'`:;,)]+[\\/])+[^\s"'`:;,)]*/g, "<caminho>").slice(0, MAX_ERRO);
}

export type MetodoRpc = (args: unknown[], sinal: AbortSignal) => unknown;

/** Lado que TEM as implementações. Devolve quem desliga a escuta. */
export function atenderRpc(porta: PortaMensagens, lado: LadoRpc, metodos: Readonly<Record<string, MetodoRpc>>): () => void {
  const ativos = new Map<number, AbortController>();
  const ouvinte = (m: unknown): void => {
    if (!ehObjeto(m)) return;
    if (m["t"] === "cancel" && m["de"] !== lado) {
      ativos.get(m["id"] as number)?.abort();
      return;
    }
    if (m["t"] !== "rpc" || m["de"] === lado) return;
    const c = m as unknown as Chamada;
    const responder = (r: Omit<Resposta, "t" | "de" | "id">): void => {
      ativos.delete(c.id);
      try {
        porta.postMessage({ t: "resp", de: c.de, id: c.id, ...r } satisfies Resposta);
      } catch {
        /* porta fechada */
      }
    };
    const metodo = Object.hasOwn(metodos, c.metodo) ? metodos[c.metodo] : undefined;
    if (metodo === undefined || !Array.isArray(c.args)) {
      responder({ ok: false, erro: "método desconhecido" });
      return;
    }
    const ctl = new AbortController();
    ativos.set(c.id, ctl);
    Promise.resolve()
      .then(() => metodo(c.args, ctl.signal))
      .then((valor) => responder({ ok: true, valor: valor === undefined ? null : valor }))
      .catch((erro: unknown) => responder({ ok: false, erro: textoDoErro(erro) }));
  };
  porta.on("message", ouvinte);
  return () => {
    for (const c of ativos.values()) c.abort();
    ativos.clear();
    porta.off?.("message", ouvinte);
  };
}

export interface OpcoesChamada {
  timeoutMs?: number;
  sinal?: AbortSignal;
}

export interface ClienteRpc {
  chamar<T = unknown>(metodo: string, args?: unknown[], opcoes?: OpcoesChamada): Promise<T>;
  /** rejeita tudo que está pendente (o worker caiu). */
  falharPendentes(erro: Error): void;
  pendentes(): number;
}

export function criarClienteRpc(porta: PortaMensagens, lado: LadoRpc, timeoutPadraoMs = 30_000): ClienteRpc {
  let proximo = 0;
  const pendentes = new Map<number, { ok: (v: unknown) => void; falha: (e: Error) => void }>();
  porta.on("message", (m) => {
    if (!ehObjeto(m) || m["t"] !== "resp" || m["de"] !== lado) return;
    const r = m as unknown as Resposta;
    const p = pendentes.get(r.id);
    if (p === undefined) return;
    pendentes.delete(r.id);
    if (r.ok) p.ok(r.valor);
    else p.falha(new RpcRemotoErro(typeof r.erro === "string" ? r.erro.slice(0, MAX_ERRO) : "falha"));
  });
  return {
    chamar<T = unknown>(metodo: string, args: unknown[] = [], opcoes: OpcoesChamada = {}): Promise<T> {
      const id = ++proximo;
      const ms = opcoes.timeoutMs ?? timeoutPadraoMs;
      return new Promise<T>((resolver, rejeitar) => {
        if (opcoes.sinal?.aborted) return rejeitar(new RpcCanceladoErro(metodo));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limpar = (): void => {
          if (timer !== undefined) clearTimeout(timer);
          opcoes.sinal?.removeEventListener("abort", aoCancelar);
          pendentes.delete(id);
        };
        const aoCancelar = (): void => {
          limpar();
          try {
            porta.postMessage({ t: "cancel", de: lado, id } satisfies Cancelar);
          } catch {
            /* porta fechada */
          }
          rejeitar(new RpcCanceladoErro(metodo));
        };
        pendentes.set(id, {
          ok: (v) => (limpar(), resolver(v as T)),
          falha: (e) => (limpar(), rejeitar(e)),
        });
        opcoes.sinal?.addEventListener("abort", aoCancelar, { once: true });
        if (Number.isFinite(ms) && ms > 0) {
          timer = setTimeout(() => {
            limpar();
            try {
              porta.postMessage({ t: "cancel", de: lado, id } satisfies Cancelar);
            } catch {
              /* porta fechada */
            }
            rejeitar(new RpcTimeoutErro(metodo, ms));
          }, ms);
          timer.unref?.();
        }
        try {
          porta.postMessage({ t: "rpc", de: lado, id, metodo, args } satisfies Chamada);
        } catch {
          limpar();
          rejeitar(new RpcIndisponivelErro("não foi possível enviar a chamada ao worker"));
        }
      });
    },
    falharPendentes(erro) {
      for (const [id, p] of [...pendentes]) {
        pendentes.delete(id);
        p.falha(erro);
      }
    },
    pendentes: () => pendentes.size,
  };
}
