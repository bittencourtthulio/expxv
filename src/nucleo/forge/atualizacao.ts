import { semSegredos } from "./comum";
import { ForgeRateLimitErro } from "./erros";
import type { Forge, LimiteApi, PrResumo } from "./forge";

// T-06.21 · Atualização inteligente. Consulta SÓ os PRs que o chamador manda (Missões ativas + abertos do usuário), SÓ com a
// janela em foco, no máximo 1 chamada por PR a cada 60 s, ETag condicional, backoff exponencial e pausa por rate limit.
// Sem timers próprios: o agendador é injetado (padrão: setTimeout com unref); `tick()` é determinístico para teste.

export const INTERVALO_MINIMO_MS = 60_000;
export const BACKOFF_MAX_MS = 15 * 60_000;
const VERIFICAR_LIMITE_A_CADA_MS = 5 * 60_000;
const MAX_ALVOS = 50;

export interface Agendador {
  /** Agenda `fn` daqui a `ms`; devolve o cancelamento. */
  agendar(fn: () => void, ms: number): () => void;
}
export const agendadorPadrao: Agendador = {
  agendar(fn, ms) {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return () => clearTimeout(t);
  },
};

export type EventoAtualizacao =
  | { tipo: "pr"; numero: number; pr: PrResumo; anterior: PrResumo | null }
  | { tipo: "pausa-rate-limit"; ate: number }
  | { tipo: "erro"; mensagem: string; proximaTentativaEmMs: number };

export interface OpcoesAtualizador {
  forge: Pick<Forge, "prs" | "limiteApi">;
  /** Números dos PRs a observar agora (o main une Missões ativas + abertos do usuário). */
  alvos: () => number[] | Promise<number[]>;
  janelaEmFoco: () => boolean;
  aoEvento: (e: EventoAtualizacao) => void;
  agendador?: Agendador;
  agora?: () => number;
  /** Intervalo entre rodadas (mínimo 60 s). */
  intervaloMs?: number;
  backoffBaseMs?: number;
}
export type ResultadoTick = { pulado: "sem-foco" | "pausa" | "em-andamento" | null; consultados: number[]; emCache: number[] };

const mudou = (a: PrResumo | null, b: PrResumo): boolean => a === null || a.estado !== b.estado || a.atualizadoEm !== b.atualizadoEm || a.titulo !== b.titulo || a.rascunho !== b.rascunho || a.revisao !== b.revisao;

export class AtualizadorPrs {
  private readonly agendador: Agendador;
  private readonly agora: () => number;
  private readonly intervalo: number;
  private readonly base: number;
  private readonly ultima = new Map<number, number>();
  private readonly etags = new Map<number, string>();
  private readonly vistos = new Map<number, PrResumo>();
  private pausadoAte = 0;
  private falhas = 0;
  private ultimoLimite = -Infinity;
  private cancelarAgenda: (() => void) | null = null;
  private ativo = false;
  private emAndamento = false;
  private ac = new AbortController();

  constructor(private readonly op: OpcoesAtualizador) {
    this.agendador = op.agendador ?? agendadorPadrao;
    this.agora = op.agora ?? Date.now;
    this.intervalo = Math.max(op.intervaloMs ?? INTERVALO_MINIMO_MS, INTERVALO_MINIMO_MS);
    this.base = Math.max(op.backoffBaseMs ?? INTERVALO_MINIMO_MS, 1000);
  }

  get falhasSeguidas(): number {
    return this.falhas;
  }
  iniciar(): void {
    if (this.ativo) return;
    this.ativo = true;
    this.ac = new AbortController();
    this.agendarProxima(0);
  }
  parar(): void {
    this.ativo = false;
    this.ac.abort();
    this.cancelarAgenda?.();
    this.cancelarAgenda = null;
  }
  /** Descarta o que se sabe de um PR (fechou/saiu da Missão). */
  esquecer(numero: number): void {
    this.ultima.delete(numero);
    this.etags.delete(numero);
    this.vistos.delete(numero);
  }

  private agendarProxima(ms: number): void {
    this.cancelarAgenda?.();
    if (!this.ativo) return;
    this.cancelarAgenda = this.agendador.agendar(() => {
      void this.tick().finally(() => {
        if (!this.ativo) return;
        const espera = this.falhas > 0 ? Math.min(this.base * 2 ** (this.falhas - 1), BACKOFF_MAX_MS) : this.intervalo;
        this.agendarProxima(Math.max(espera, this.pausadoAte - this.agora()));
      });
    }, ms);
  }

  async tick(): Promise<ResultadoTick> {
    const vazio = (pulado: ResultadoTick["pulado"]): ResultadoTick => ({ pulado, consultados: [], emCache: [] });
    if (this.emAndamento) return vazio("em-andamento");
    if (!this.op.janelaEmFoco()) return vazio("sem-foco"); // janela sem foco: nenhuma chamada
    if (this.agora() < this.pausadoAte) return vazio("pausa");
    this.emAndamento = true;
    const r: ResultadoTick = { pulado: null, consultados: [], emCache: [] };
    try {
      const alvos = [...new Set(await this.op.alvos())].filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, MAX_ALVOS);
      await this.verificarLimite();
      for (const n of alvos) {
        if (!this.ativo && this.ac.signal.aborted) break;
        if (this.agora() < this.pausadoAte) break;
        const ult = this.ultima.get(n);
        if (ult !== undefined && this.agora() - ult < INTERVALO_MINIMO_MS) {
          r.emCache.push(n);
          continue;
        }
        this.ultima.set(n, this.agora());
        r.consultados.push(n);
        const c = await this.op.forge.prs.consultar(n, this.etags.get(n), { signal: this.ac.signal });
        this.falhas = 0;
        if (c.etag) this.etags.set(n, c.etag);
        if (!c.naoModificado && c.pr) {
          const antes = this.vistos.get(n) ?? null;
          this.vistos.set(n, c.pr);
          if (mudou(antes, c.pr)) this.op.aoEvento({ tipo: "pr", numero: n, pr: c.pr, anterior: antes });
        }
        if (c.limite) this.aplicarLimite(c.limite);
      }
    } catch (e) {
      if (e instanceof ForgeRateLimitErro) {
        this.pausar((e.reiniciaEm ?? Math.floor((this.agora() + this.base) / 1000)) * 1000 + 1000);
      } else if (!this.ac.signal.aborted) {
        this.falhas++;
        const prox = Math.min(this.base * 2 ** (this.falhas - 1), BACKOFF_MAX_MS);
        this.op.aoEvento({ tipo: "erro", mensagem: semSegredos(e instanceof Error ? e.message : String(e)), proximaTentativaEmMs: prox });
      }
    } finally {
      this.emAndamento = false;
    }
    return r;
  }

  private pausar(ateMs: number): void {
    this.pausadoAte = ateMs;
    this.op.aoEvento({ tipo: "pausa-rate-limit", ate: ateMs });
  }
  private aplicarLimite(l: LimiteApi): void {
    // folga: menos de 5% (mín. 10) restantes pausa até o reset, para nunca estourar a cota do usuário.
    if (l.restante <= Math.max(10, Math.floor(l.limite * 0.05))) this.pausar(l.reiniciaEm * 1000 + 1000);
  }
  private async verificarLimite(): Promise<void> {
    if (this.agora() - this.ultimoLimite < VERIFICAR_LIMITE_A_CADA_MS) return;
    this.ultimoLimite = this.agora();
    try {
      const l = await this.op.forge.limiteApi({ signal: this.ac.signal }); // `gh api rate_limit` não consome a cota principal
      if (l) this.aplicarLimite(l);
    } catch {
      /* sem informação de limite: segue só com backoff */
    }
  }
}
