import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

const BLOCO = 256 * 1024;

/** Segue um arquivo que só cresce (transcript JSONL): entrega as linhas completas novas, sem reler o que já entregou. */
export class SeguidorArquivo {
  readonly #arquivo: string;
  readonly #aoLinhas: (linhas: string[]) => void;
  readonly #intervalo: number;
  readonly #decodificador = new StringDecoder("utf8");
  #deslocamento: number;
  #resto = "";
  #relogio: NodeJS.Timeout | null = null;
  #fila: Promise<void> = Promise.resolve();

  constructor(opcoes: { arquivo: string; aoLinhas: (linhas: string[]) => void; intervalo_ms?: number; deslocamento?: number }) {
    this.#arquivo = opcoes.arquivo;
    this.#aoLinhas = opcoes.aoLinhas;
    this.#intervalo = opcoes.intervalo_ms ?? 250;
    this.#deslocamento = opcoes.deslocamento ?? 0;
  }

  get deslocamento(): number { return this.#deslocamento; }

  iniciar(): void {
    if (this.#relogio !== null) return;
    this.#relogio = setInterval(() => { void this.sincronizar(); }, this.#intervalo);
    this.#relogio.unref();
    void this.sincronizar();
  }

  /** Lê o que cresceu desde a última vez. Chamadas concorrentes são enfileiradas. */
  sincronizar(): Promise<void> {
    this.#fila = this.#fila.then(() => this.#ler()).catch(() => undefined);
    return this.#fila;
  }

  /** Para o relógio e faz uma última leitura, para não perder o final do arquivo. */
  async parar(): Promise<void> {
    if (this.#relogio !== null) { clearInterval(this.#relogio); this.#relogio = null; }
    await this.sincronizar();
    if (this.#resto.trim() !== "") { const ultima = this.#resto; this.#resto = ""; this.#aoLinhas([ultima]); }
  }

  async #ler(): Promise<void> {
    let tamanho: number;
    try { tamanho = (await stat(this.#arquivo)).size; } catch { return; } // ainda não existe
    if (tamanho < this.#deslocamento) { this.#deslocamento = 0; this.#resto = ""; }
    if (tamanho === this.#deslocamento) return;
    const arquivo = await open(this.#arquivo, "r");
    try {
      const linhas: string[] = [];
      while (this.#deslocamento < tamanho) {
        const buffer = Buffer.allocUnsafe(Math.min(BLOCO, tamanho - this.#deslocamento));
        const { bytesRead } = await arquivo.read(buffer, 0, buffer.length, this.#deslocamento);
        if (bytesRead === 0) break;
        this.#deslocamento += bytesRead;
        const partes = (this.#resto + this.#decodificador.write(buffer.subarray(0, bytesRead))).split("\n");
        this.#resto = partes.pop() ?? "";
        linhas.push(...partes.filter((p) => p.trim() !== ""));
      }
      if (linhas.length > 0) this.#aoLinhas(linhas);
    } finally { await arquivo.close(); }
  }
}
