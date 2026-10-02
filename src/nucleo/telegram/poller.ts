// Poller (T-20.24): long polling de SAÍDA (`getUpdates`), sem porta aberta. Offset gravado DEPOIS do lote (mesma transação), dedupe por `update_id`,
// descarte inicial, filtro defensivo no handler, backoff com jitter, 401 sem laço, 429 com `retry_after`, 409 (5 s, 15 s, depois `conflito` SEM
// retomada automática), `suspender/retomarSistema`, `AbortController`, parada limpa e instância única por canal.
import { ErroTelegram, LimiteDeTaxa, ehErroTelegram } from "./erros";
import type { ClienteBotApi } from "./api";
import { dormirReal, type DormirPorta, type RelogioTg } from "./portas";
import type { RepoTelegram } from "./repo";
import type { EstadoPoller } from "../../compartilhado/alertas";
import type { TgUpdate } from "./tipos";

export const BACKOFF_REDE_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
export const ESPERA_409_MS: readonly number[] = [5_000, 15_000];
const TETO_BACKOFF_MS = 60_000;

/** trava de processo: uma instância de poller por canal (token). */
const travas = new Set<string>();

export interface DepsPoller {
  api: ClienteBotApi;
  repo: RepoTelegram;
  canal_id: string;
  /** trata UM update; deve ser idempotente por `update_id` (o poller também deduplica). */
  processar(u: TgUpdate): Promise<void>;
  relogio: RelogioTg;
  dormir?: DormirPorta;
  /** [0,1): jitter determinístico em teste. */
  aleatorio?: () => number;
  online?: () => boolean;
  aoEstado?(e: EstadoPoller, detalhe?: string): void;
  /** fim de cada lote (descarregar contadores etc.). */
  aoLote?(): void;
  limite?: number;
  timeout_s?: number;
  travas?: Set<string>;
}

export interface Poller {
  iniciar(): void;
  /** parada limpa: aborta o long poll, espera <= 1 s e libera a trava. Idempotente. */
  parar(): Promise<void>;
  /** sistema suspendeu: aborta a requisição em voo e pausa. */
  suspender(): void;
  /** sistema voltou: espera 3 s, drena rápido (timeout=0) e volta ao long poll. */
  retomarSistema(): void;
  /** botão [Retomar] depois de `conflito`/`erro` (o main roda `getWebhookInfo` antes). */
  retomarManual(): void;
  estado(): EstadoPoller;
  ativo(): boolean;
  /** promessa do laço atual (testes). */
  ocioso(): Promise<void>;
}

export function criarPoller(deps: DepsPoller): Poller {
  const dormir = deps.dormir ?? dormirReal;
  const aleatorio = deps.aleatorio ?? Math.random;
  const trava = deps.travas ?? travas;
  const limite = deps.limite ?? 20;
  const timeout_s = deps.timeout_s ?? 30;
  let estado: EstadoPoller = "parado";
  let ac: AbortController | null = null;
  let laco: Promise<void> = Promise.resolve();
  let rodando = false;
  let pausado = false;
  let drenarAoVoltar = false;
  let falhasRede = 0;

  const mudar = (e: EstadoPoller, detalhe?: string): void => {
    estado = e;
    try {
      deps.aoEstado?.(e, detalhe);
    } catch {
      /* isolado */
    }
  };
  const iso = (): string => new Date(deps.relogio.agora()).toISOString();
  const jitter = (ms: number): number => Math.min(TETO_BACKOFF_MS, Math.round(ms * (0.8 + aleatorio() * 0.4)));

  async function esperar(ms: number, sinal: AbortSignal): Promise<boolean> {
    try {
      await dormir.dormir(ms, sinal);
      return true;
    } catch {
      return false;
    }
  }

  async function processarLote(updates: TgUpdate[]): Promise<void> {
    const ordenados = [...updates].sort((a, b) => a.update_id - b.update_id);
    let maior = -1;
    for (const u of ordenados) {
      // pânico/parada no meio do lote: o resto NÃO é tratado e NÃO é marcado como visto (não executa nada depois do `/parar`)
      if (!rodando) break;
      maior = Math.max(maior, u.update_id);
      if (deps.repo.updateVisto(u.update_id)) continue; // replay: já tratado
      try {
        await deps.processar(u);
      } catch {
        // um update com erro não trava a fila: fica marcado como visto (não reprocessa em laço) e o erro é do handler
      }
      deps.repo.marcarVisto(u.update_id, iso());
    }
    if (maior >= 0) {
      // offset só DEPOIS do lote tratado e persistido
      deps.repo.transacao(() => deps.repo.salvarEstado(deps.canal_id, { proximo_offset: maior + 1, ultimo_update_id: maior, ultimo_poll_em: iso() }));
    }
    deps.aoLote?.();
  }

  async function descarteInicial(sinal: AbortSignal): Promise<boolean> {
    // nada anterior ao pareamento é executado: esvazia a fila descartando o conteúdo e confirma pelo maior update_id + 1
    for (let i = 0; i < 1000; i++) {
      const e = deps.repo.estado(deps.canal_id);
      const lote = await deps.api.getUpdates({ offset: e.proximo_offset, limit: 100, timeout: 0 }, sinal);
      if (lote.length === 0) break;
      const maior = Math.max(...lote.map((u) => u.update_id));
      deps.repo.salvarEstado(deps.canal_id, { proximo_offset: maior + 1, ultimo_update_id: maior });
    }
    deps.repo.salvarEstado(deps.canal_id, { descarte_inicial_feito: true });
    return true;
  }

  async function volta(): Promise<void> {
    while (rodando) {
      const sinal = (ac = new AbortController()).signal;
      try {
        if (pausado) {
          await esperar(15_000, sinal);
          if (!rodando) break;
          continue;
        }
        if (deps.online !== undefined && !deps.online()) {
          mudar("pausado", "sem_rede");
          await esperar(15_000, sinal);
          continue;
        }
        if (estado === "pausado") mudar("ativo");
        if (!deps.repo.estado(deps.canal_id).descarte_inicial_feito) await descarteInicial(sinal);
        const rapido = drenarAoVoltar;
        drenarAoVoltar = false;
        const e = deps.repo.estado(deps.canal_id);
        const updates = await deps.api.getUpdates({ offset: e.proximo_offset, limit: limite, timeout: rapido ? 0 : timeout_s }, sinal);
        falhasRede = 0;
        if (e.conflitos_seguidos > 0 || e.ultimo_erro_codigo !== null) deps.repo.salvarEstado(deps.canal_id, { conflitos_seguidos: 0, ultimo_erro_codigo: null });
        if (estado !== "ativo") mudar("ativo");
        deps.repo.salvarEstado(deps.canal_id, { ultimo_poll_em: iso() });
        if (updates.length > 0) await processarLote(updates);
        if (rapido && updates.length > 0) drenarAoVoltar = true; // continua drenando até esvaziar
      } catch (err) {
        if (!rodando) break;
        if (pausado || (err instanceof ErroTelegram && err.codigo === "abortado")) {
          if (!rodando) break;
          continue;
        }
        if (!ehErroTelegram(err)) {
          falhasRede++;
          if (!(await esperar(jitter(BACKOFF_REDE_MS[Math.min(falhasRede - 1, BACKOFF_REDE_MS.length - 1)] as number), sinal))) break;
          continue;
        }
        deps.repo.salvarEstado(deps.canal_id, { ultimo_erro_codigo: err.codigo });
        if (err.codigo === "token_invalido") {
          mudar("erro", "token_invalido"); // sem laço de retentativa
          rodando = false;
          break;
        }
        if (err.codigo === "consentimento_ausente" || err.codigo === "token_ausente") {
          mudar("erro", err.codigo);
          rodando = false;
          break;
        }
        if (err.codigo === "conflito") {
          const n = deps.repo.estado(deps.canal_id).conflitos_seguidos + 1;
          deps.repo.salvarEstado(deps.canal_id, { conflitos_seguidos: n });
          if (n >= 3) {
            // para e NÃO volta sozinho: só o botão [Retomar]
            rodando = false;
            let suspeito = false;
            try {
              suspeito = (await deps.api.getWebhookInfo()).url !== "";
            } catch {
              suspeito = false;
            }
            mudar(suspeito ? "token_possivelmente_comprometido" : "conflito", suspeito ? "webhook_alheio" : "getupdates_concorrente");
            break;
          }
          if (!(await esperar(ESPERA_409_MS[n - 1] as number, sinal))) break;
          continue;
        }
        if (err instanceof LimiteDeTaxa) {
          if (!(await esperar(err.retry_after_s * 1000 + 1000, sinal))) break;
          continue;
        }
        // 400 (erro de programação: registra e segue), 5xx e rede: backoff 1,2,4,8,16,30 s com jitter, reset no sucesso
        falhasRede++;
        if (!(await esperar(jitter(BACKOFF_REDE_MS[Math.min(falhasRede - 1, BACKOFF_REDE_MS.length - 1)] as number), sinal))) break;
      }
    }
    ac = null;
    trava.delete(deps.canal_id);
    if (estado === "ativo" || estado === "pausado") mudar("parado");
  }

  function iniciar(): void {
    if (rodando) return;
    if (trava.has(deps.canal_id)) throw new Error("poller_ja_ativo");
    trava.add(deps.canal_id);
    rodando = true;
    pausado = false;
    falhasRede = 0;
    mudar("ativo");
    laco = volta();
  }

  return {
    iniciar,
    async parar() {
      if (!rodando && ac === null) {
        trava.delete(deps.canal_id);
        if (estado !== "erro" && estado !== "conflito" && estado !== "token_possivelmente_comprometido") estado = "parado";
        return;
      }
      rodando = false;
      ac?.abort();
      await Promise.race([laco, new Promise<void>((r) => setTimeout(r, 1000).unref?.())]);
      trava.delete(deps.canal_id);
    },
    suspender() {
      if (!rodando) return;
      pausado = true;
      mudar("pausado", "suspenso");
      ac?.abort();
    },
    retomarSistema() {
      if (!rodando) return;
      const sinal = ac?.signal;
      void (async () => {
        await dormir.dormir(3_000, sinal).catch(() => undefined); // abortado (parar): o laço decide
        if (!rodando) return;
        drenarAoVoltar = true;
        pausado = false;
        ac?.abort();
      })();
    },
    retomarManual() {
      if (rodando) return;
      deps.repo.salvarEstado(deps.canal_id, { conflitos_seguidos: 0, ultimo_erro_codigo: null });
      iniciar();
    },
    estado: () => estado,
    ativo: () => rodando,
    ocioso: () => laco,
  };
}
