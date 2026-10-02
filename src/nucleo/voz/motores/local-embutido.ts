// Motor "Local neste computador" (Fase 11, D-540/D-544): transcreve o WAV da fala no runtime embutido (processo próprio, modelo baixado e verificado). NADA sai da máquina e o áudio nunca vai a disco:
// o WAV já está em memória, vira PCM16 e segue ao processo por mensagem. A verificação de integridade do modelo roda ANTES de cada carga (marca rápida) e o resultado passa pelo pós-processo do serviço.
import type { RuntimeVoz } from "../local/runtime";
import type { ConfigCarga } from "../local/protocolo";
import { ErroMotor, type MotorStt, type OpcoesTranscricao } from "./motor";

/** Extrai o PCM16 mono de um WAV (percorre os blocos; tolera `LIST`/`FLLR` antes de `data`). */
export function pcmDoWav(wav: Uint8Array, taxaEsperada = 16_000): Uint8Array {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const texto = (o: number, n: number): string => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(wav[o + i] ?? 0); return s; };
  if (wav.byteLength < 44 || texto(0, 4) !== "RIFF" || texto(8, 4) !== "WAVE") throw new ErroMotor("motor_falhou", "wav inválido");
  let o = 12;
  let formatoOk = false;
  while (o + 8 <= wav.byteLength) {
    const id = texto(o, 4);
    const tam = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      formatoOk = v.getUint16(o + 8, true) === 1 && v.getUint16(o + 10, true) === 1 && v.getUint32(o + 12, true) === taxaEsperada && v.getUint16(o + 22, true) === 16;
    } else if (id === "data") {
      if (!formatoOk) throw new ErroMotor("motor_falhou", "formato de áudio inesperado");
      const fim = Math.min(wav.byteLength, o + 8 + tam);
      return wav.subarray(o + 8, o + 8 + Math.floor((fim - (o + 8)) / 2) * 2);
    }
    o += 8 + tam + (tam % 2);
  }
  throw new ErroMotor("motor_falhou", "wav sem dados");
}

export interface OpcoesMotorLocal {
  runtime: RuntimeVoz;
  /** confere a integridade do modelo ativo e monta a configuração (lança `ErroMotor` modelo_ausente/modelo_corrompido/runtime_indisponivel). */
  preparar: (idioma: OpcoesTranscricao["idioma"]) => Promise<ConfigCarga>;
}

export function criarMotorLocalEmbutido(o: OpcoesMotorLocal): MotorStt {
  return {
    async transcrever(wav, op) {
      const config = await o.preparar(op.idioma);
      const pcm = pcmDoWav(wav);
      const r = await o.runtime.transcrever(config, pcm, op.sinal === undefined ? {} : { sinal: op.sinal });
      return r.texto;
    },
  };
}
