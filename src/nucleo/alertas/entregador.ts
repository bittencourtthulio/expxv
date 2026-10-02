// Entregador (T-20.14): fila (persistente via `RepoEntregas`), UMA entrega por vez por canal, espaçamento mínimo e teto por minuto,
// retry com backoff (5 s, 15 s, 60 s, 5 min; máx. 5), respeita `tentar_em_ms` (429), rajada vira resumo (0 alertas perdidos),
// consentimento e `saida_ligada` checados ANTES de chamar o adaptador, cancelável (pânico), idempotente (UNIQUE no repositório).
import type { AlertaVisao, CanalRegistro, EntregaRegistro } from "../../compartilhado/alertas";
import { liberarLotes } from "./agrupar";
import { consentimentoValido, precisaConsentimento, type CanalComunicacao, type ErroEnvio, type MensagemSaida } from "./canal";
import { montarMensagemAlerta, montarMensagemLote, type OpcoesMensagem } from "./mensagem";
import { temporizadorReal, type TemporizadorPorta } from "./agendador";
import type { PortaBarramento, RepoAlertas, RepoCanais, RepoEntregas, Relogio } from "./portas";
import { relogioReal } from "./portas";
import type { TipoCanal } from "../../compartilhado/alertas";

export const BACKOFF_MS: readonly number[] = [5_000, 15_000, 60_000, 300_000];
export const MAX_TENTATIVAS = 5;
export const RAJADA = 3;

export interface DepsEntregador {
  entregas: RepoEntregas;
  alertas: RepoAlertas;
  canais: RepoCanais;
  obterAdaptador(tipo: TipoCanal): Promise<CanalComunicacao | null>;
  /** versão vigente do texto de consentimento do canal. */
  versaoConsentimento(tipo: TipoCanal): string;
  opcoesMensagem?(canal: CanalRegistro, entrega: EntregaRegistro): OpcoesMensagem;
  barramento?: PortaBarramento;
  relogio?: Relogio;
  timers?: TemporizadorPorta;
  /** erro permanente no canal (token inválido, chat inalcançável): o main marca o canal `erro` e emite `canal_erro`. */
  aoErroPermanente?(canal: CanalRegistro, erro: ErroEnvio): void;
  rajada?: number;
}

export interface Entregador {
  /** há entregas novas: tenta drenar já. */
  acordar(): void;
  drenar(): Promise<void>;
  /** pânico: aborta o envio em voo e descarta a fila do canal (ou de todos). */
  cancelar(canal_id?: string): void;
  parar(): void;
  pendentes(): number;
  timersVivos(): number;
}

interface EstadoCanalFila {
  ultimo: number;
  janela: number[];
  emVoo: AbortController | null;
  bloqueadoAte: number;
}

export function criarEntregador(deps: DepsEntregador): Entregador {
  const relogio = deps.relogio ?? relogioReal;
  const timers = deps.timers ?? temporizadorReal;
  const rajada = deps.rajada ?? RAJADA;
  const filas = new Map<string, EstadoCanalFila>();
  let timer: unknown = null;
  let rodando = false;
  let refazer = false;
  let parado = false;
  let geracao = 0; // incrementa a cada cancelamento: trabalho iniciado antes do pânico não envia depois dele
  const iso = (ms: number): string => new Date(ms).toISOString();
  const fila = (id: string): EstadoCanalFila => {
    let f = filas.get(id);
    if (f === undefined) filas.set(id, (f = { ultimo: -Infinity, janela: [], emVoo: null, bloqueadoAte: 0 }));
    return f;
  };
  const emitir = (tipo: string, payload: unknown): void => {
    try {
      deps.barramento?.emitir(tipo, payload);
    } catch {
      /* isolado */
    }
  };

  const devidas = (estado: "pendente" | "agrupado", canal_id: string, agora: number): EntregaRegistro[] =>
    deps.entregas.porEstado(estado, 1000).filter((e) => e.canal_id === canal_id && (e.proxima_tentativa_em === null || Date.parse(e.proxima_tentativa_em) <= agora));

  function descartar(es: EntregaRegistro[], motivo: string): void {
    for (const e of es) deps.entregas.atualizar(e.id, { estado: "descartado", erro_codigo: motivo });
  }

  /** @returns instante (ms) da próxima tentativa deste canal, ou `null` */
  async function processarCanal(canal: CanalRegistro): Promise<number | null> {
    const f = fila(canal.id);
    if (f.emVoo !== null) return null;
    const minhaGeracao = geracao;
    const agora = relogio.agora();
    const pend = devidas("pendente", canal.id, agora);
    const agr = devidas("agrupado", canal.id, agora);
    const futuros = [...deps.entregas.porEstado("pendente", 1000), ...deps.entregas.porEstado("agrupado", 1000)].filter((e) => e.canal_id === canal.id && e.proxima_tentativa_em !== null && Date.parse(e.proxima_tentativa_em) > agora).map((e) => Date.parse(e.proxima_tentativa_em as string));
    const proximoFuturo = futuros.length === 0 ? null : Math.min(...futuros);
    if (pend.length === 0 && agr.length === 0) return proximoFuturo;

    // 1. chaves de segurança, SEM I/O
    if (!canal.saida_ligada) {
      descartar([...pend, ...agr], "desligado");
      return proximoFuturo;
    }
    if (precisaConsentimento(canal.tipo) && !consentimentoValido(canal.consentimento, deps.versaoConsentimento(canal.tipo))) {
      descartar([...pend, ...agr], "consentimento_ausente");
      return proximoFuturo;
    }
    const adaptador = await deps.obterAdaptador(canal.tipo);
    if (geracao !== minhaGeracao || parado) return null;
    // o consentimento/estado pode ter mudado durante o `await`: confere de novo com o registro atual, ainda sem I/O
    const atual = deps.canais.obter(canal.id) ?? canal;
    if (!atual.saida_ligada || (precisaConsentimento(atual.tipo) && !consentimentoValido(atual.consentimento, deps.versaoConsentimento(atual.tipo)))) {
      descartar([...pend, ...agr], atual.saida_ligada ? "consentimento_ausente" : "desligado");
      return proximoFuturo;
    }
    if (adaptador === null) {
      descartar([...pend, ...agr], "desligado");
      return proximoFuturo;
    }
    const cap = adaptador.capacidades;

    // 2. taxa
    f.janela = f.janela.filter((t) => agora - t < 60_000);
    const espera = Math.max(f.ultimo + cap.min_intervalo_ms - agora, f.janela.length >= cap.max_por_min ? (f.janela[0] as number) + 60_000 - agora : 0, f.bloqueadoAte - agora, 0);
    if (espera > 0) return agora + espera;

    // 3. unidade de envio
    const alertas = new Map<string, AlertaVisao>();
    for (const e of [...pend, ...agr]) {
      const a = deps.alertas.obter(e.alerta_id);
      if (a !== null) alertas.set(a.id, a);
    }
    const semAlerta = [...pend, ...agr].filter((e) => !alertas.has(e.alerta_id));
    if (semAlerta.length > 0) descartar(semAlerta, "alerta_removido");
    const pendOk = pend.filter((e) => alertas.has(e.alerta_id));
    let unidade: EntregaRegistro[] = [];
    let ehLote = false;
    const critica = pendOk.find((e) => alertas.get(e.alerta_id)?.severidade === "critico");
    const lotes = liberarLotes(agr, alertas, agora);
    if (critica !== undefined) unidade = [critica];
    else if (lotes.length > 0) {
      const l = lotes[0] as (typeof lotes)[number];
      unidade = l.entrega_ids.map((id) => deps.entregas.obter(id)).filter((e): e is EntregaRegistro => e !== null);
      ehLote = unidade.length > 1;
    } else if (pendOk.length > rajada) {
      // rajada vira UM resumo, mas só entre entregas do MESMO destino: (regra, chat de destino, nível). O acompanhamento efêmero de um pedido (chat_ref) nunca vaza para os outros chats
      // nem arrasta um alerta de nível `completo` para uma mensagem de nível `minimo`; os demais grupos saem nas rodadas seguintes (0 alertas perdidos).
      const grupos = new Map<string, EntregaRegistro[]>();
      for (const e of pendOk) {
        const k = `${e.regra_id ?? ""}|${e.chat_ref ?? ""}|${e.nivel}`;
        const g = grupos.get(k);
        if (g === undefined) grupos.set(k, [e]);
        else g.push(e);
      }
      unidade = [...grupos.values()].sort((a, b) => b.length - a.length)[0] as EntregaRegistro[];
      ehLote = unidade.length > 1;
    } else if (pendOk.length > 0) unidade = [pendOk[0] as EntregaRegistro];
    if (unidade.length === 0) return proximoFuturo;

    const primeira = unidade[0] as EntregaRegistro;
    const opc = deps.opcoesMensagem?.(canal, primeira) ?? { nivel: primeira.nivel };
    const alertasUnidade = unidade.map((e) => alertas.get(e.alerta_id)).filter((a): a is AlertaVisao => a !== undefined);
    const msg: MensagemSaida = ehLote ? montarMensagemLote(alertasUnidade, cap, primeira.id, { ...opc, chat_ref: primeira.chat_ref }) : montarMensagemAlerta(alertasUnidade[0] as AlertaVisao, canal.tipo, cap, primeira.id, { ...opc, ...(primeira.chat_ref === null ? {} : { chat_ref: primeira.chat_ref }) });

    // 4. envio
    const ac = new AbortController();
    f.emVoo = ac;
    let r: Awaited<ReturnType<CanalComunicacao["enviar"]>>;
    try {
      r = await adaptador.enviar(msg, ac.signal);
    } catch {
      r = { ok: false, permanente: false, erro: "rede" };
    } finally {
      f.emVoo = null;
    }
    const fim = relogio.agora();
    if (ac.signal.aborted) return null; // cancelado (pânico): a fila já foi descartada

    f.ultimo = fim;
    f.janela.push(fim);
    if (r.ok) {
      for (const e of unidade) {
        deps.entregas.atualizar(e.id, { estado: "enviado", enviado_em: iso(fim), ...(r.mensagem_externa_id === undefined ? {} : { mensagem_externa_id: r.mensagem_externa_id }), erro_codigo: null, tentativas: e.tentativas + 1 });
        emitir("alert.delivery_succeeded", { entrega_id: e.id, canal_tipo: canal.tipo });
      }
      return fim + cap.min_intervalo_ms;
    }
    if (r.erro === "rate_limited") f.bloqueadoAte = fim + (r.tentar_em_ms ?? 1000);
    let proximo: number | null = null;
    for (const e of unidade) {
      const tentativas = e.tentativas + 1;
      if (r.permanente || tentativas >= MAX_TENTATIVAS) {
        deps.entregas.atualizar(e.id, { estado: "falhou", tentativas, erro_codigo: r.erro, proxima_tentativa_em: null });
        emitir("alert.delivery_failed", { entrega_id: e.id, canal_tipo: canal.tipo, erro: r.erro });
      } else {
        const em = fim + (r.tentar_em_ms ?? (BACKOFF_MS[tentativas - 1] as number));
        deps.entregas.atualizar(e.id, { estado: "pendente", tentativas, erro_codigo: r.erro, proxima_tentativa_em: iso(em) });
        proximo = proximo === null ? em : Math.min(proximo, em);
      }
    }
    if (r.permanente) {
      try {
        deps.aoErroPermanente?.(canal, r.erro);
      } catch {
        /* isolado */
      }
      // fila do canal inteira: nada mais sai por este canal até o usuário resolver
      descartar([...pend, ...agr].filter((e) => !unidade.some((u) => u.id === e.id)), r.erro);
      return null;
    }
    return proximo;
  }

  function rearmar(quando: number | null): void {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    if (quando === null || parado) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void drenar();
    }, Math.max(0, quando - relogio.agora()));
  }

  async function drenar(): Promise<void> {
    if (parado) return;
    if (rodando) {
      refazer = true;
      return;
    }
    rodando = true;
    let proximo: number | null = null;
    try {
      do {
        refazer = false;
        const alvos = await Promise.all(deps.canais.listar().map((c) => processarCanal(c)));
        proximo = alvos.reduce<number | null>((m, x) => (x === null ? m : m === null ? x : Math.min(m, x)), null);
      } while (refazer);
    } finally {
      rodando = false;
      rearmar(proximo);
    }
  }

  return {
    acordar: () => void drenar(),
    drenar,
    cancelar(canal_id) {
      geracao++;
      for (const [id, f] of filas) if (canal_id === undefined || id === canal_id) f.emVoo?.abort();
      for (const c of deps.canais.listar()) {
        if (canal_id !== undefined && c.id !== canal_id) continue;
        descartar([...deps.entregas.porEstado("pendente", 5000), ...deps.entregas.porEstado("agrupado", 5000)].filter((e) => e.canal_id === c.id), "cancelado");
      }
      if (canal_id === undefined && timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
    },
    parar() {
      parado = true;
      for (const f of filas.values()) f.emVoo?.abort();
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
    pendentes: () => deps.entregas.porEstado("pendente", 5000).length + deps.entregas.porEstado("agrupado", 5000).length,
    timersVivos: () => (timer === null ? 0 : 1),
  };
}
