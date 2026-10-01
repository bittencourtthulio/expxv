// Sanitização de OSC na saída do PTY: remove OSC 52 (escrita na área de transferência) e OSC 8
// (hiperlink), inclusive quando a sequência chega partida entre chunks. Os demais OSC (título,
// cor, diretório) passam. O terminal nunca deve poder mexer na área de transferência nem
// inventar link clicável a partir do que a CLI imprime.

const ESC = "\u001b";
const BEL = "\u0007";
/** Uma OSC acima disto, guardada à espera do fim, deixa de ser retida. */
export const LIMITE_OSC_PENDENTE = 8_192;

const perigosa = (conteudo: string): boolean => conteudo.startsWith("52;") || conteudo.startsWith("8;");

function acharTerminador(texto: string, desde: number): { inicio: number; fim: number } | null {
  const bel = texto.indexOf(BEL, desde);
  const st = texto.indexOf(`${ESC}\\`, desde);
  if (bel < 0 && st < 0) return null;
  if (st < 0 || (bel >= 0 && bel < st)) return { inicio: bel, fim: bel + 1 };
  return { inicio: st, fim: st + 2 };
}

export class SanitizadorOsc {
  #pendente = "";
  /** Descartando o corpo de uma OSC perigosa grande demais para reter, até o terminador. */
  #descartando = false;

  /** Recebe um chunk e devolve o que pode sair; o que ainda não dá para decidir fica retido. */
  processar(chunk: string): string {
    // AUD-19: o xterm também aceita OSC/ST de 8 bits (U+009D / U+009C): normaliza para a forma ESC antes de decidir
    let entrada = this.#pendente + chunk.replace(/\u009d/g, `${ESC}]`).replace(/\u009c/g, `${ESC}\\`);
    this.#pendente = "";
    if (this.#descartando) {
      const fim = acharTerminador(entrada, 0);
      if (fim === null) {
        this.#pendente = entrada.endsWith(ESC) ? ESC : "";
        return "";
      }
      this.#descartando = false;
      entrada = entrada.slice(fim.fim);
    }
    let saida = "";
    let cursor = 0;
    while (cursor < entrada.length) {
      const inicio = entrada.indexOf(`${ESC}]`, cursor);
      if (inicio < 0) {
        // ESC solto no fim pode ser o começo de uma OSC partida
        const parcial = entrada.endsWith(ESC);
        saida += parcial ? entrada.slice(cursor, -1) : entrada.slice(cursor);
        if (parcial) this.#pendente = ESC;
        return saida;
      }
      saida += entrada.slice(cursor, inicio);
      const fim = acharTerminador(entrada, inicio + 2);
      if (fim === null) {
        const resto = entrada.slice(inicio);
        if (resto.length <= LIMITE_OSC_PENDENTE) { this.#pendente = resto; return saida; }
        if (perigosa(resto.slice(2, 8))) {
          this.#descartando = true;
          this.#pendente = resto.endsWith(ESC) ? ESC : "";
          return saida;
        }
        return saida + resto; // OSC inofensiva e enorme: passa
      }
      if (!perigosa(entrada.slice(inicio + 2, fim.inicio))) saida += entrada.slice(inicio, fim.fim);
      cursor = fim.fim;
    }
    return saida;
  }

  /** Só para testes e diagnóstico. */
  get pendente(): string { return this.#pendente; }
}

/** Versão de uma chamada só (texto completo, sem continuação). */
export function sanitizarOsc(texto: string): string {
  const s = new SanitizadorOsc();
  return s.processar(texto) + s.pendente;
}
