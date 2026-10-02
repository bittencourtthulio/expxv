// Captura de áudio no renderer (Fase 11, T-11.04): o microfone abre SÓ ao iniciar e fecha em `finally`, em `parar`, e a partir de `blur`/`visibilitychange`/`pagehide` (quem chama).
// getUserMedia -> AudioWorklet (asset estático servido pelo scheme, sem URL temporária em memória) -> reamostra para 16 kHz -> PCM16 LE em blocos de 4–64 KiB. O nível RMS sai a ≤ 20 Hz só para o indicador.
import type { CodigoErroVoz } from "../../compartilhado/captura";
import { criarFatiador, paraPcm16, reamostrar, rms, TAXA_ALVO } from "./logica";

export interface MidiaMinima {
  getUserMedia(c: { audio: MediaTrackConstraints | boolean }): Promise<{ getTracks(): { stop(): void; readyState?: string }[] }>;
}

export interface NoMinimo { port: { onmessage: ((e: { data: Float32Array }) => void) | null }; connect(destino: unknown): unknown; disconnect(): void }
export interface ContextoMinimo {
  sampleRate: number;
  audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(s: unknown): { connect(n: unknown): unknown; disconnect(): void };
  close(): Promise<void>;
}

export interface OpcoesCaptura {
  aoBloco(sequencia: number, dados: Uint8Array): void;
  aoNivel?(rms: number): void;
  midia?: MidiaMinima;
  criarContexto?: () => ContextoMinimo;
  criarNo?: (ctx: ContextoMinimo) => NoMinimo;
  urlWorklet?: string;
  agora?: () => number;
}

export interface SessaoAudio {
  /** Fecha o microfone, entrega o que faltava e libera tudo. Idempotente. */
  parar(): Promise<void>;
}

export class ErroAudio extends Error {
  constructor(readonly codigo: CodigoErroVoz) {
    super(codigo);
    this.name = "ErroAudio";
  }
}

export function codigoDeErroDeMidia(e: unknown): CodigoErroVoz {
  const nome = (e as { name?: string } | null)?.name ?? "";
  if (nome === "NotAllowedError" || nome === "SecurityError") return "microfone_negado";
  return "microfone_indisponivel";
}

const URL_WORKLET = (): string => new URL("./worklet-pcm.js", import.meta.url).href;

export async function abrirCaptura(op: OpcoesCaptura): Promise<SessaoAudio> {
  const midia = op.midia ?? (navigator.mediaDevices as unknown as MidiaMinima | undefined);
  if (midia === undefined) throw new ErroAudio("microfone_indisponivel");
  let stream: Awaited<ReturnType<MidiaMinima["getUserMedia"]>>;
  try {
    stream = await midia.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  } catch (e) {
    throw new ErroAudio(codigoDeErroDeMidia(e));
  }
  let ctx: ContextoMinimo | null = null;
  let fonte: { connect(n: unknown): unknown; disconnect(): void } | null = null;
  let no: NoMinimo | null = null;
  let fechado = false;
  const agora = op.agora ?? ((): number => Date.now());
  const fatiador = criarFatiador(op.aoBloco);
  let ultimoNivel = 0;

  const liberar = async (): Promise<void> => {
    if (fechado) return;
    fechado = true;
    try { if (no !== null) no.port.onmessage = null; } catch { /* já solto */ }
    try { fonte?.disconnect(); } catch { /* já solto */ }
    try { no?.disconnect(); } catch { /* já solto */ }
    for (const t of stream.getTracks()) { try { t.stop(); } catch { /* já parada */ } } // o microfone fecha SEMPRE
    try { await ctx?.close(); } catch { /* contexto já fechado */ }
  };

  try {
    ctx = op.criarContexto !== undefined ? op.criarContexto() : (new AudioContext({ latencyHint: "interactive" }) as unknown as ContextoMinimo);
    await ctx.audioWorklet.addModule(op.urlWorklet ?? URL_WORKLET());
    const c = ctx;
    fonte = c.createMediaStreamSource(stream);
    no = op.criarNo !== undefined ? op.criarNo(c) : (new AudioWorkletNode(c as unknown as BaseAudioContext, "captura-pcm", { numberOfInputs: 1, numberOfOutputs: 0 }) as unknown as NoMinimo);
    no.port.onmessage = (e): void => {
      if (fechado) return;
      const f32 = reamostrar(e.data, c.sampleRate, TAXA_ALVO);
      fatiador.adicionar(paraPcm16(f32));
      const t = agora();
      if (op.aoNivel !== undefined && t - ultimoNivel >= 50) { ultimoNivel = t; op.aoNivel(rms(f32)); } // ≤ 20 Hz
    };
    fonte.connect(no);
  } catch (e) {
    await liberar();
    throw e instanceof ErroAudio ? e : new ErroAudio("microfone_indisponivel");
  }
  return {
    async parar() {
      if (fechado) return;
      const resto = fatiador;
      await liberar();
      resto.descarregar();
    },
  };
}
