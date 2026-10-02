// Processo de reconhecimento (Fase 11, D-544): roda FORA do main (`ELECTRON_RUN_AS_NODE`/Node com canal IPC) e carrega `sherpa-onnx-node` (addon N-API pré-compilado) só quando o main manda carregar.
// Autocontido de propósito: SÓ módulos nativos do Node e o addon (o arquivo vai para fora do asar com o addon e não carrega nada relativo em tempo de execução). Descarregar = o main encerra o processo,
// o que devolve TODA a memória ao sistema (o ONNX Runtime não devolve arenas). Nada aqui escreve em disco, loga ou abre rede; áudio e texto só existem em memória.
import type { MensagemDoWorker, MensagemParaWorker } from "./protocolo";

const TAXA = 16_000;

interface Reconhecedor {
  createStream(): { acceptWaveform(a: { sampleRate: number; samples: Float32Array }): void };
  decode(s: unknown): void;
  getResult(s: unknown): { text?: unknown };
}

let reconhecedor: Reconhecedor | null = null;
let trechoMaxS = 28;

const enviar = (m: MensagemDoWorker): void => { process.send?.(m); };
const ramMb = (): number => Math.round(process.memoryUsage().rss / (1024 * 1024));

function carregarSherpa(): { OfflineRecognizer: new (c: unknown) => Reconhecedor } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("sherpa-onnx-node") as { OfflineRecognizer: new (c: unknown) => Reconhecedor };
  } catch {
    return null;
  }
}

function pcmParaFloat(pcm: Uint8Array): Float32Array {
  const n = Math.floor(pcm.byteLength / 2);
  const v = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 32768;
  return out;
}

/** divide em fatias IGUAIS de no máximo `max` amostras (sem cortar no meio de uma palavra por acaso a cada 28 s exatos: fatias iguais evitam um resto minúsculo). */
export function fatiar(amostras: Float32Array, max: number): Float32Array[] {
  if (amostras.length <= max) return [amostras];
  const partes = Math.ceil(amostras.length / max);
  const tam = Math.ceil(amostras.length / partes);
  const saida: Float32Array[] = [];
  for (let i = 0; i < amostras.length; i += tam) saida.push(amostras.subarray(i, Math.min(amostras.length, i + tam)));
  return saida;
}

process.on("message", (bruto: unknown) => {
  const m = bruto as MensagemParaWorker;
  if (m.t === "sair") { process.exit(0); return; }
  if (m.t === "carregar") {
    const t0 = Date.now();
    const sherpa = carregarSherpa();
    if (sherpa === null) { enviar({ t: "erro", req: m.req, codigo: "runtime_indisponivel" }); return; }
    try {
      reconhecedor = new sherpa.OfflineRecognizer(m.config.sherpa);
      trechoMaxS = m.config.trecho_max_s;
      enviar({ t: "carregado", req: m.req, ms: Date.now() - t0, ram_mb: ramMb() });
    } catch {
      reconhecedor = null;
      enviar({ t: "erro", req: m.req, codigo: "modelo_corrompido" });
    }
    return;
  }
  if (m.t === "transcrever") {
    if (reconhecedor === null) { enviar({ t: "erro", req: m.req, codigo: "falha" }); return; }
    try {
      const t0 = Date.now();
      const amostras = pcmParaFloat(m.pcm);
      const textos: string[] = [];
      for (const fatia of fatiar(amostras, Math.floor(trechoMaxS * TAXA))) {
        const s = reconhecedor.createStream();
        s.acceptWaveform({ sampleRate: TAXA, samples: fatia });
        reconhecedor.decode(s);
        const texto = reconhecedor.getResult(s).text;
        if (typeof texto === "string" && texto.trim() !== "") textos.push(texto.trim());
      }
      enviar({ t: "resultado", req: m.req, texto: textos.join(" "), ms: Date.now() - t0, duracao_ms: Math.round((amostras.length / TAXA) * 1000), ram_mb: ramMb() });
    } catch {
      enviar({ t: "erro", req: m.req, codigo: "falha" });
    }
  }
});

// o pai morreu: não fica órfão consumindo RAM
process.on("disconnect", () => process.exit(0));
enviar({ t: "pronto" });
