// LimitsService (T-09.04): cache por conta, adaptadores por fonte, agendador injetável e eventos coalescidos.
// Regras (D-112, P-104): leitura de adaptador no máximo 1 a cada 60 s por conta (a primeira mudança depois de 60 s de
// calma lê na hora; as seguintes coalescem numa leitura final aos 60 s); `atualizar()` do usuário no máximo a cada 5 s;
// fontes de rede declaram `intervalo_min_s: 300`; SEM FOCO = ZERO leituras; `snapshot()` é síncrono e só lê o cache.
// Merge por janela: o dado mais recente vence (empate: medido > manual > estimado; estimativa só vale sem nada melhor).
// Breaker por adaptador: 3 falhas seguidas → 5 min de silêncio + `provedor_indisponivel`. Nunca toca credencial.
import type { AccountUsage, BaldeModelo, ConfiancaLimite, EventoLimites, JanelaKind, JanelaLimite, LimitSnapshot, RespostaLimites } from "../../compartilhado/limites";
import { agregarCotas } from "./agregar";
import { derivarUso } from "./derivar";
import type { AdaptadorLimite, ContaLimite } from "./adaptadores/adaptador";

export interface Agendador {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
export const agendadorReal: Agendador = {
  setTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    if (typeof id === "object" && id !== null && "unref" in id) (id as { unref: () => void }).unref();
    return id;
  },
  clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
};

export const INTERVALO_LEITURA_MS = 60_000;
export const INTERVALO_USUARIO_MS = 5_000;
export const TIMEOUT_ADAPTADOR_MS = 2_000;
export const COALESCER_EVENTOS_MS = 500;
export const BREAKER_FALHAS = 3;
export const BREAKER_SILENCIO_MS = 5 * 60_000;
export const HISTERESE_PONTOS = 5;
export const COOLDOWN_PTY_MS = 5 * 60_000;

export interface DependenciasLimitsService {
  contas(): readonly ContaLimite[];
  adaptadores: readonly AdaptadorLimite[];
  /** epoch ms. */
  agora(): number;
  agendador?: Agendador;
  /** A janela principal está em foco? Sem foco = 0 leituras automáticas. */
  foco(): boolean;
  emitir(evento: EventoLimites): void;
  limiares?(): { troca: number; esgotamento: number };
  /** Marca a conta em cooldown (frase de limite no PTY). */
  marcarCooldown?(contaId: string, ateIso: string): void;
  aviso?(mensagem: string): void;
  timeout_ms?: number;
  tick_ms?: number;
}

export interface LimitsService {
  /** Do cache; nunca espera I/O. `contaIds` omitido = todas as contas habilitadas. */
  snapshot(contaIds?: readonly string[]): RespostaLimites;
  usoDe(contaId: string): AccountUsage;
  /** Botão do usuário: ≤ 1 leitura por conta a cada 5 s (ignora foco). */
  atualizar(contaId?: string): Promise<RespostaLimites>;
  /** Relê SÓ uma fonte, agora (ex.: valor manual recém-informado). */
  recarregarFonte(contaId: string, adaptadorId: string): Promise<AccountUsage>;
  /** Watcher de arquivo: só MARCA a conta; a leitura obedece a regra de 60 s e ao foco. */
  marcarSuja(contaId: string): void;
  aoFocoMudar(emFoco: boolean): void;
  /** A lista de contas mudou (criada, removida, habilitada): descarta o que sobrou e relê as novas. */
  contasMudaram(): void;
  /** Frase de limite na saída do PTY (T-09.07). */
  registrarLimiteDoPty(d: { conta_id: string; pane_id: string | null; reinicia_em: string | null }): void;
  iniciar(): void;
  parar(): void;
  /** diagnóstico/perf */
  estatisticas(): { leituras: number; leiturasPorConta: Readonly<Record<string, number>> };
}

interface Breaker {
  falhas: number;
  abertoAte: number;
}
interface Armado {
  alto: boolean;
  atingido: boolean;
}
interface EstadoConta {
  porAdaptador: Map<string, LimitSnapshot[]>;
  ultimaLeitura: number;
  ultimaPorAdaptador: Map<string, number>;
  emVoo: Promise<void> | null;
  timerFinal: unknown;
  suja: boolean;
  armado: Map<string, Armado>;
  assinatura: string;
}

const PRIORIDADE: Record<ConfiancaLimite, number> = { medido: 3, manual: 2, estimado: 1, desconhecido: 0 };
const NUNCA = Number.NEGATIVE_INFINITY;
const emBranco = (): EstadoConta => ({ porAdaptador: new Map(), ultimaLeitura: NUNCA, ultimaPorAdaptador: new Map(), emVoo: null, timerFinal: undefined, suja: false, armado: new Map(), assinatura: "" });

const expirada = (resetsAt: string | null, agora: number): boolean => {
  if (resetsAt === null) return false;
  const t = Date.parse(resetsAt);
  return Number.isFinite(t) && t <= agora;
};
const tempo = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

interface Candidato<T> {
  item: T;
  snap: LimitSnapshot;
}
/** Escolhe o melhor candidato: com dado e não vencido > o resto; estimativa só sem nada melhor; mais recente; empate por confiança. */
function melhor<T extends { used_pct: number | null; resets_at: string | null }>(cands: Candidato<T>[], agora: number): Candidato<T> | undefined {
  const nota = (c: Candidato<T>): [number, number, number, number] => [
    c.item.used_pct !== null && !expirada(c.item.resets_at, agora) ? 1 : 0,
    c.snap.confianca === "estimado" ? 0 : 1,
    tempo(c.snap.fetched_at),
    PRIORIDADE[c.snap.confianca],
  ];
  let escolhido: Candidato<T> | undefined;
  let nEscolhido: number[] = [];
  const maior = (x: number[], y: number[]): boolean => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] as number) > (y[i] as number);
    return false;
  };
  for (const c of cands) {
    const n = nota(c);
    if (escolhido === undefined || maior(n, nEscolhido)) {
      escolhido = c;
      nEscolhido = n;
    }
  }
  return escolhido;
}

/** Mescla os snapshots de várias fontes de UMA conta no snapshot único. */
export function mesclarSnapshots(conta: Pick<ContaLimite, "id" | "provedor">, todos: readonly LimitSnapshot[], agora: number): LimitSnapshot {
  if (todos.length === 0) {
    return { account_id: conta.id, provider: conta.provedor, fetched_at: new Date(agora).toISOString(), fonte: "nenhuma", confianca: "desconhecido", status: "unavailable", windows: [], model_buckets: {} };
  }
  const porKind = new Map<JanelaKind, Candidato<JanelaLimite>[]>();
  const porBalde = new Map<string, Candidato<BaldeModelo>[]>();
  for (const s of todos) {
    for (const w of s.windows) {
      const l = porKind.get(w.kind) ?? [];
      l.push({ item: w, snap: s });
      porKind.set(w.kind, l);
    }
    for (const [nome, b] of Object.entries(s.model_buckets)) {
      const l = porBalde.get(nome) ?? [];
      l.push({ item: b, snap: s });
      porBalde.set(nome, l);
    }
  }
  const windows: JanelaLimite[] = [];
  const vencedores: LimitSnapshot[] = [];
  for (const [, cands] of porKind) {
    const m = melhor(cands, agora);
    if (m !== undefined) {
      windows.push({ ...m.item });
      vencedores.push(m.snap);
    }
  }
  const model_buckets: Record<string, BaldeModelo> = {};
  for (const [nome, cands] of porBalde) {
    const m = melhor(cands, agora);
    if (m !== undefined) {
      model_buckets[nome] = { ...m.item };
      vencedores.push(m.snap);
    }
  }
  // metadados = do vencedor mais recente (medido > manual > estimado no empate)
  const base = [...(vencedores.length > 0 ? vencedores : todos)].sort((a, b) => tempo(b.fetched_at) - tempo(a.fetched_at) || PRIORIDADE[b.confianca] - PRIORIDADE[a.confianca])[0] as LimitSnapshot;
  const credit = [...todos].filter((s) => s.credit !== undefined).sort((a, b) => tempo(b.fetched_at) - tempo(a.fetched_at))[0]?.credit;
  const temJanela = windows.length > 0 || Object.keys(model_buckets).length > 0;
  const authErro = todos.some((s) => s.status === "auth_error");
  const merged: LimitSnapshot = {
    account_id: conta.id,
    provider: conta.provedor,
    fetched_at: base.fetched_at,
    fonte: base.fonte,
    confianca: base.confianca,
    status: temJanela ? "ok" : authErro ? "auth_error" : "unavailable",
    windows,
    model_buckets,
  };
  if (credit !== undefined) merged.credit = credit;
  return merged;
}

export function criarLimitsService(deps: DependenciasLimitsService): LimitsService {
  const ag = deps.agendador ?? agendadorReal;
  const timeoutMs = deps.timeout_ms ?? TIMEOUT_ADAPTADOR_MS;
  const tickMs = deps.tick_ms ?? INTERVALO_LEITURA_MS;
  const limiares = (): { troca: number; esgotamento: number } => deps.limiares?.() ?? { troca: 85, esgotamento: 100 };
  const estados = new Map<string, EstadoConta>();
  const breakers = new Map<string, Breaker>();
  const leiturasPorConta: Record<string, number> = {};
  let leituras = 0;
  let parado = false;
  let ticando = false;
  let timerTick: unknown;
  let timerEventos: unknown;
  const pendentesAtualizado = new Set<string>();

  const estado = (id: string): EstadoConta => {
    let e = estados.get(id);
    if (e === undefined) {
      e = emBranco();
      estados.set(id, e);
    }
    return e;
  };
  const contasAtivas = (): ContaLimite[] => deps.contas().filter((c) => c.habilitada);
  const conta = (id: string): ContaLimite | undefined => deps.contas().find((c) => c.id === id);

  // ---------------------------------------------------------------- derivação e eventos
  function usoDeConta(c: ContaLimite): AccountUsage {
    const todos = [...estado(c.id).porAdaptador.values()].flat();
    return derivarUso(mesclarSnapshots(c, todos, deps.agora()), deps.agora());
  }

  function agendarAtualizado(id: string): void {
    pendentesAtualizado.add(id);
    if (timerEventos !== undefined) return;
    timerEventos = ag.setTimeout(() => {
      timerEventos = undefined;
      if (parado || pendentesAtualizado.size === 0) return;
      const contas = [...pendentesAtualizado].sort();
      pendentesAtualizado.clear();
      deps.emitir({ tipo: "atualizado", contas });
    }, COALESCER_EVENTOS_MS);
  }

  function avaliar(c: ContaLimite): void {
    const e = estado(c.id);
    const uso = usoDeConta(c);
    const assinatura = JSON.stringify([uso.windows.map((j) => [j.kind, j.used_pct, j.resets_at]), uso.model_buckets, uso.fonte, uso.confianca, uso.status]);
    const mudou = assinatura !== e.assinatura;
    e.assinatura = assinatura;
    const { troca, esgotamento } = limiares();
    const series: Array<{ chave: string; janela: JanelaKind | "modelo"; used: number | null }> = [
      ...uso.windows.map((j) => ({ chave: j.kind, janela: j.kind as JanelaKind | "modelo", used: j.used_pct })),
      ...Object.entries(uso.model_buckets).map(([n, b]) => ({ chave: `modelo:${n}`, janela: "modelo" as const, used: b.used_pct })),
    ];
    for (const s of series) {
      const a = e.armado.get(s.chave) ?? { alto: true, atingido: true };
      e.armado.set(s.chave, a);
      if (s.used === null) {
        a.alto = true;
        a.atingido = true;
        continue;
      }
      if (s.used >= troca && a.alto) {
        a.alto = false;
        deps.emitir({ tipo: "consumo_alto", conta_id: c.id, janela: s.janela, used_pct: s.used });
      } else if (s.used < troca - HISTERESE_PONTOS) a.alto = true;
      if (s.used >= esgotamento && a.atingido) {
        a.atingido = false;
        deps.emitir({ tipo: "limite_atingido", conta_id: c.id, janela: s.janela, pane_id: null, fonte: "medido" });
      } else if (s.used < esgotamento - HISTERESE_PONTOS) a.atingido = true;
    }
    if (mudou) agendarAtualizado(c.id);
  }

  // ---------------------------------------------------------------- leitura de um adaptador (timeout + breaker)
  async function lerAdaptador(a: AdaptadorLimite, c: ContaLimite): Promise<{ ok: true; valor: LimitSnapshot[] | null } | { ok: false }> {
    const b = breakers.get(a.id) ?? { falhas: 0, abertoAte: 0 };
    breakers.set(a.id, b);
    if (b.abertoAte > deps.agora()) return { ok: false };
    const ctrl = new AbortController();
    let idTimer: unknown;
    const limite = new Promise<never>((_, rejeitar) => {
      idTimer = ag.setTimeout(() => {
        ctrl.abort();
        rejeitar(new Error("timeout"));
      }, timeoutMs);
    });
    try {
      const r = await Promise.race([a.ler(c, { sinal: ctrl.signal, agora: deps.agora() }), limite]);
      b.falhas = 0;
      b.abertoAte = 0;
      if (r === null) return { ok: true, valor: null };
      const agoraMs = deps.agora();
      const lista = (Array.isArray(r) ? r : [r]).map<LimitSnapshot>((s) => ({ ...s, account_id: c.id, provider: c.provedor, fetched_at: new Date(Math.min(tempo(s.fetched_at) || agoraMs, agoraMs)).toISOString() }));
      return { ok: true, valor: lista };
    } catch {
      b.falhas++;
      if (b.falhas >= BREAKER_FALHAS) {
        b.falhas = 0;
        b.abertoAte = deps.agora() + BREAKER_SILENCIO_MS;
        const provider = a.provedores?.[0] ?? a.id;
        deps.aviso?.(`fonte de limite ${a.id} indisponível por 5 min`);
        deps.emitir({ tipo: "provedor_indisponivel", provider, motivo: `fonte ${a.id} falhou ${BREAKER_FALHAS} vezes seguidas` });
      }
      return { ok: false };
    } finally {
      ag.clearTimeout(idTimer);
    }
  }

  /** Uma "leitura" da conta: roda os adaptadores aplicáveis em paralelo. `forcar` ignora o intervalo das fontes locais. */
  function lerConta(c: ContaLimite, opcoes: { forcar: boolean; apenas?: string }): Promise<void> {
    const e = estado(c.id);
    if (e.emVoo !== null) return e.emVoo;
    const inicio = deps.agora();
    const alvo = deps.adaptadores.filter((a) => {
      if (opcoes.apenas !== undefined) return a.id === opcoes.apenas;
      if (!a.aplicavel(c)) return false;
      const ult = e.ultimaPorAdaptador.get(a.id) ?? NUNCA;
      const minimo = a.intervalo_min_s * 1000;
      if (opcoes.forcar && !a.rede) return true;
      return inicio - ult >= minimo;
    });
    if (alvo.length === 0) return Promise.resolve();
    if (opcoes.apenas === undefined) e.ultimaLeitura = inicio;
    e.suja = false;
    leituras++;
    leiturasPorConta[c.id] = (leiturasPorConta[c.id] ?? 0) + 1;
    const p = (async () => {
      const resultados = await Promise.all(alvo.map((a) => lerAdaptador(a, c).then((r) => [a, r] as const)));
      if (parado) return;
      for (const [a, r] of resultados) {
        e.ultimaPorAdaptador.set(a.id, inicio);
        if (!r.ok) continue; // falha: mantém o último dado (a idade denuncia)
        if (r.valor === null) e.porAdaptador.delete(a.id);
        else e.porAdaptador.set(a.id, r.valor);
      }
      avaliar(c);
    })().finally(() => {
      e.emVoo = null;
      if (e.suja && !parado) {
        const atual = conta(c.id); // arquivo mudou durante a leitura: uma leitura final respeitando os 60 s
        if (atual?.habilitada === true) pedirLeituraAuto(atual);
      }
    });
    e.emVoo = p;
    return p;
  }

  // ---------------------------------------------------------------- agendamento automático
  function pedirLeituraAuto(c: ContaLimite): void {
    const e = estado(c.id);
    if (parado) return;
    if (!deps.foco()) {
      e.suja = true; // sem foco = 0 leituras; volta a ler quando o foco voltar
      return;
    }
    if (e.emVoo !== null || e.timerFinal !== undefined) return;
    const decorrido = deps.agora() - e.ultimaLeitura;
    if (decorrido >= INTERVALO_LEITURA_MS) {
      void lerConta(c, { forcar: false });
      return;
    }
    e.timerFinal = ag.setTimeout(() => {
      e.timerFinal = undefined;
      if (parado) return;
      const atual = conta(c.id);
      if (atual === undefined || !atual.habilitada) return;
      if (!deps.foco()) {
        e.suja = true;
        return;
      }
      void lerConta(atual, { forcar: false });
    }, Math.max(0, INTERVALO_LEITURA_MS - decorrido));
  }

  function tick(): void {
    timerTick = undefined;
    if (parado) return;
    if (deps.foco()) for (const c of contasAtivas()) pedirLeituraAuto(c);
    timerTick = ag.setTimeout(tick, tickMs);
  }

  function resposta(contas: readonly ContaLimite[]): RespostaLimites {
    const usos = contas.map(usoDeConta);
    const rotulos = Object.fromEntries(contas.map((c) => [c.id, c.rotulo]));
    const { troca, esgotamento } = limiares();
    return { contas: usos, geral: agregarCotas(usos, { rotulos, limiar_alerta_pct: troca, limiar_esgotada_pct: esgotamento }) };
  }

  return {
    snapshot(contaIds) {
      const todas = contaIds === undefined ? contasAtivas() : deps.contas().filter((c) => contaIds.includes(c.id));
      return resposta(todas);
    },
    usoDe(contaId) {
      const c = conta(contaId);
      return c === undefined ? derivarUso(mesclarSnapshots({ id: contaId, provedor: "" }, [], deps.agora()), deps.agora()) : usoDeConta(c);
    },
    async atualizar(contaId) {
      const alvo = contaId === undefined ? contasAtivas() : deps.contas().filter((c) => c.id === contaId);
      await Promise.all(
        alvo.map((c) => {
          const e = estado(c.id);
          if (e.emVoo !== null) return e.emVoo;
          if (deps.agora() - e.ultimaLeitura < INTERVALO_USUARIO_MS) return Promise.resolve();
          return lerConta(c, { forcar: true });
        }),
      );
      return resposta(alvo);
    },
    async recarregarFonte(contaId, adaptadorId) {
      const c = conta(contaId);
      if (c === undefined) return this.usoDe(contaId);
      const e = estado(c.id);
      if (e.emVoo !== null) await e.emVoo;
      await lerConta(c, { forcar: true, apenas: adaptadorId });
      return usoDeConta(c);
    },
    marcarSuja(contaId) {
      const c = conta(contaId);
      if (c === undefined || !c.habilitada) return;
      estado(contaId).suja = true;
      pedirLeituraAuto(c);
    },
    aoFocoMudar(emFoco) {
      if (!emFoco || parado) return;
      for (const c of contasAtivas()) pedirLeituraAuto(c); // borda de subida: lê na hora quem passou de 60 s
    },
    contasMudaram() {
      const ids = new Set(deps.contas().map((c) => c.id));
      for (const [id, e] of [...estados]) {
        if (!ids.has(id)) {
          if (e.timerFinal !== undefined) ag.clearTimeout(e.timerFinal);
          estados.delete(id);
        }
      }
      for (const c of contasAtivas()) pedirLeituraAuto(c);
    },
    registrarLimiteDoPty({ conta_id, pane_id, reinicia_em }) {
      const c = conta(conta_id);
      if (c === undefined) return;
      const ate = reinicia_em !== null && Date.parse(reinicia_em) > deps.agora() ? reinicia_em : new Date(deps.agora() + COOLDOWN_PTY_MS).toISOString();
      deps.marcarCooldown?.(conta_id, ate);
      const janela: JanelaKind = reinicia_em !== null && Date.parse(reinicia_em) - deps.agora() > 5 * 3_600_000 ? "weekly" : "five_hour";
      deps.emitir({ tipo: "limite_atingido", conta_id, janela, pane_id, fonte: "saida_do_pty" });
    },
    iniciar() {
      parado = false;
      if (ticando) return;
      ticando = true;
      for (const c of contasAtivas()) pedirLeituraAuto(c); // leitura inicial (só com foco)
      timerTick = ag.setTimeout(tick, tickMs);
    },
    parar() {
      parado = true;
      ticando = false;
      if (timerTick !== undefined) ag.clearTimeout(timerTick);
      timerTick = undefined;
      if (timerEventos !== undefined) ag.clearTimeout(timerEventos);
      timerEventos = undefined;
      pendentesAtualizado.clear();
      for (const e of estados.values()) {
        if (e.timerFinal !== undefined) ag.clearTimeout(e.timerFinal);
        e.timerFinal = undefined;
      }
    },
    estatisticas: () => ({ leituras, leiturasPorConta: { ...leiturasPorConta } }),
  };
}
