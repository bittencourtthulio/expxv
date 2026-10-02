// Worklet de captura (Fase 11): junta ~2 048 amostras por mensagem e as entrega ao thread principal. Sem rede, sem armazenamento, nada além de repassar o áudio da fala.
class CapturaPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
  }
  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (!canal) return true;
    for (let i = 0; i < canal.length; i++) {
      this.buf[this.n++] = canal[i];
      if (this.n === this.buf.length) {
        const copia = this.buf.slice(0);
        this.port.postMessage(copia, [copia.buffer]);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("captura-pcm", CapturaPcm);
