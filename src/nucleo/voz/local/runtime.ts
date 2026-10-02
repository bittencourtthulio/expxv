// Runtime de voz local do lado do main (Fase 11, D-544): gerencia UM processo de reconhecimento por vez, criado SOB DEMANDA e encerrado por ociosidade.
//  - nada de processo, timer ou memória do modelo até alguém pedir (ditado iniciado, autoteste): CPU ociosa = 0 e RAM do modelo = 0 com o modelo descarregado;
//  - carregar e transcrever são mensagens pequenas ao processo; o main nunca decodifica (nada bloqueia o main nem o renderer);
//  - descarregar = encerrar o processo (devolve toda a RAM); o relógio de ociosidade reinicia a cada uso e só roda com o modelo carregado e sem pedido em andamento;
//  - uma operação por vez (fila): ditados não se atropelam e o autoteste não rouba o modelo no meio de uma fala;
//  - falha do processo (morte, timeout) vira `ErroMotor("motor_falhou")` e o estado volta a "descarregado"; a próxima chamada cria outro processo;
//  - nenhum erro, log ou evento carrega áudio, texto ou caminho.
import { ErroMotor } from "../motores/motor";
import type { ConfigCarga, MensagemDoWorker, MensagemParaWorker } from "./protocolo";

export interface PortaProcesso {
  enviar(m: MensagemParaWorker): void;
  aoMensagem(cb: (m: MensagemDoWorker) => void): void;
  aoSair(cb: () => void): void;
  matar(): void;
}

export interface EstadoRuntime {
  carregado: boolean;
  chave: string | null;
  ram_mb: number | null;
  ocupado: boolean;
}

export interface OpcoesRuntime {
  fabrica: () => PortaProcesso;
  /** ms de ociosidade antes de descarregar. */
  ociosidade_ms: () => number;
  agendar?: (fn: () => void, ms: number) => () => void;
  timeoutCarga_ms?: number;
  timeoutTranscricao_ms?: number;
  /** avisa a UI quando carrega/descarrega (coalescido por quem chama). */
  aoMudar?: (e: EstadoRuntime) => void;
}

export interface ResultadoTranscricao {
  texto: string;
  /** tempo de decodificação no processo. */
  ms: number;
  duracao_ms: number;
  ram_mb: number;
  /** tempo gasto carregando o modelo neste pedido (0 se já estava carregado). */
  carregamento_ms: number;
}

export interface RuntimeVoz {
  /** carrega (se preciso) e decodifica o PCM16 16 kHz mono. */
  transcrever(config: ConfigCarga, pcm: Uint8Array, op?: { sinal?: AbortSignal }): Promise<ResultadoTranscricao>;
  /** carrega o modelo em segundo plano (ao iniciar o ditado), sem transcrever. */
  preaquecer(config: ConfigCarga): Promise<{ carregamento_ms: number; ram_mb: number }>;
  descarregar(): void;
  estado(): EstadoRuntime;
  encerrar(): void;
}

interface Pendente {
  resolver(m: MensagemDoWorker): void;
  falhar(e: ErroMotor): void;
}

const erroDe = (codigo: "runtime_indisponivel" | "modelo_corrompido" | "falha"): ErroMotor =>
  new ErroMotor(codigo === "runtime_indisponivel" ? "runtime_indisponivel" : codigo === "modelo_corrompido" ? "modelo_corrompido" : "motor_falhou", codigo);

export function criarRuntimeVoz(op: OpcoesRuntime): RuntimeVoz {
  const agendar = op.agendar ?? ((fn: () => void, ms: number): (() => void) => { const t = setTimeout(fn, ms); t.unref?.(); return () => clearTimeout(t); });
  const timeoutCarga = op.timeoutCarga_ms ?? 180_000;
  const timeoutTranscricao = op.timeoutTranscricao_ms ?? 120_000;

  let proc: PortaProcesso | null = null;
  let pronto: Promise<void> | null = null;
  let chave: string | null = null;
  let ram: number | null = null;
  let req = 0;
  let ocupado = 0;
  let cancelarOcioso: (() => void) | null = null;
  let fila: Promise<unknown> = Promise.resolve();
  const pendentes = new Map<number, Pendente>();
  let aoPronto: (() => void) | null = null;

  const estado = (): EstadoRuntime => ({ carregado: proc !== null && chave !== null, chave, ram_mb: ram, ocupado: ocupado > 0 });
  const avisar = (): void => op.aoMudar?.(estado());

  function falharTudo(e: ErroMotor): void {
    for (const p of pendentes.values()) p.falhar(e);
    pendentes.clear();
  }

  function descarregarAgora(motivo: ErroMotor | null = null): void {
    cancelarOcioso?.();
    cancelarOcioso = null;
    const p = proc;
    proc = null;
    pronto = null;
    aoPronto = null;
    const tinha = chave !== null;
    chave = null;
    ram = null;
    if (p !== null) {
      try { p.enviar({ t: "sair" }); } catch { /* já morreu */ }
      p.matar();
    }
    falharTudo(motivo ?? new ErroMotor("cancelado", "descarregado"));
    if (tinha || p !== null) avisar();
  }

  function armarOcioso(): void {
    cancelarOcioso?.();
    cancelarOcioso = null;
    if (proc === null || ocupado > 0) return;
    cancelarOcioso = agendar(() => { cancelarOcioso = null; if (ocupado === 0) descarregarAgora(); }, op.ociosidade_ms());
  }

  function iniciarProcesso(): Promise<void> {
    if (pronto !== null) return pronto;
    const p = op.fabrica();
    proc = p;
    pronto = new Promise<void>((ok, falha) => {
      const t = setTimeout(() => { falha(new ErroMotor("motor_falhou", "processo não ficou pronto")); }, 30_000);
      t.unref?.();
      aoPronto = () => { clearTimeout(t); ok(); };
      p.aoSair(() => {
        clearTimeout(t);
        if (proc === p) {
          proc = null; pronto = null; chave = null; ram = null; aoPronto = null;
          falharTudo(new ErroMotor("motor_falhou", "processo encerrou"));
          falha(new ErroMotor("motor_falhou", "processo encerrou"));
          avisar();
        }
      });
    });
    pronto.catch(() => undefined);
    p.aoMensagem((m) => {
      if (proc !== p) return;
      if (m.t === "pronto") { aoPronto?.(); return; }
      const pend = pendentes.get(m.req);
      if (pend === undefined) return;
      pendentes.delete(m.req);
      if (m.t === "erro") pend.falhar(erroDe(m.codigo));
      else pend.resolver(m);
    });
    return pronto;
  }

  function chamar(m: MensagemParaWorker & { req: number }, limite_ms: number, sinal?: AbortSignal): Promise<MensagemDoWorker> {
    return new Promise<MensagemDoWorker>((ok, falha) => {
      const t = setTimeout(() => { pendentes.delete(m.req); falha(new ErroMotor("tempo_esgotado", "sem resposta")); descarregarAgora(); }, limite_ms);
      t.unref?.();
      const aoAbortar = (): void => { clearTimeout(t); if (pendentes.delete(m.req)) falha(new ErroMotor("cancelado", "abortado")); };
      if (sinal?.aborted === true) { clearTimeout(t); falha(new ErroMotor("cancelado", "abortado")); return; }
      sinal?.addEventListener("abort", aoAbortar, { once: true });
      pendentes.set(m.req, {
        resolver: (r) => { clearTimeout(t); sinal?.removeEventListener("abort", aoAbortar); ok(r); },
        falhar: (e) => { clearTimeout(t); sinal?.removeEventListener("abort", aoAbortar); falha(e); },
      });
      try { proc?.enviar(m); } catch { pendentes.delete(m.req); clearTimeout(t); falha(new ErroMotor("motor_falhou", "envio")); }
    });
  }

  async function garantirCarregado(config: ConfigCarga): Promise<{ carregamento_ms: number }> {
    if (proc !== null && chave === config.chave) return { carregamento_ms: 0 };
    if (proc !== null) descarregarAgora(); // outro modelo/idioma: recarrega do zero
    try {
      await iniciarProcesso();
      const r = await chamar({ t: "carregar", req: ++req, config }, timeoutCarga);
      if (r.t !== "carregado") throw new ErroMotor("motor_falhou", "resposta inesperada");
      chave = config.chave;
      ram = r.ram_mb;
      avisar();
      return { carregamento_ms: r.ms };
    } catch (e) {
      descarregarAgora(e instanceof ErroMotor ? e : null);
      throw e instanceof ErroMotor ? e : new ErroMotor("motor_falhou", "carga");
    }
  }

  /** serializa as operações e mantém o relógio de ociosidade correto. */
  function emFila<T>(fn: () => Promise<T>): Promise<T> {
    const exec = async (): Promise<T> => {
      cancelarOcioso?.();
      cancelarOcioso = null;
      ocupado++;
      try { return await fn(); } finally { ocupado--; armarOcioso(); }
    };
    const r = fila.then(exec, exec);
    fila = r.catch(() => undefined);
    return r;
  }

  return {
    estado,
    transcrever(config, pcm, o = {}) {
      return emFila(async () => {
        if (o.sinal?.aborted === true) throw new ErroMotor("cancelado", "abortado");
        const { carregamento_ms } = await garantirCarregado(config);
        const r = await chamar({ t: "transcrever", req: ++req, pcm }, timeoutTranscricao, o.sinal);
        if (r.t !== "resultado") throw new ErroMotor("motor_falhou", "resposta inesperada");
        ram = r.ram_mb;
        return { texto: r.texto, ms: r.ms, duracao_ms: r.duracao_ms, ram_mb: r.ram_mb, carregamento_ms };
      });
    },
    preaquecer(config) {
      return emFila(async () => {
        const { carregamento_ms } = await garantirCarregado(config);
        return { carregamento_ms, ram_mb: ram ?? 0 };
      });
    },
    descarregar: () => descarregarAgora(),
    encerrar: () => descarregarAgora(),
  };
}
