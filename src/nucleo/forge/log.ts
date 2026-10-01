// T-06.19 · Log paginado. O log chega em streaming (`checks.log`) e é guardado em pedaços com um índice de linhas
// (Uint32Array crescente), de modo que a tela peça só uma janela (linhas visíveis) sem reprocessar 50 MB.

const PEDACO = 1 << 20;
export class ArmazemLog {
  private readonly blocos: Buffer[] = [];
  private bytes = 0;
  private offsets = new Uint32Array(1 << 14);
  private nLinhas = 0;
  private iniciaLinha = true;

  constructor(private readonly maxBytes = 256 * 1024 * 1024) {}

  get totalBytes(): number {
    return this.bytes;
  }
  get totalLinhas(): number {
    return this.nLinhas;
  }
  /** Acrescenta texto do streaming; respeita o teto de memória. Devolve false quando o teto foi atingido. */
  adicionar(texto: string): boolean {
    const b = Buffer.from(texto, "utf8");
    if (this.bytes + b.length > this.maxBytes) return false;
    for (let i = 0; i < b.length; i += PEDACO) this.blocos.push(b.subarray(i, i + PEDACO));
    const base = this.bytes;
    for (let i = 0; i < b.length; i++) {
      if (this.iniciaLinha) {
        this.marcar(base + i);
        this.iniciaLinha = false;
      }
      if (b[i] === 0x0a) this.iniciaLinha = true;
    }
    this.bytes += b.length;
    return true;
  }
  private marcar(off: number): void {
    if (this.nLinhas >= this.offsets.length) {
      const n = new Uint32Array(this.offsets.length * 2);
      n.set(this.offsets);
      this.offsets = n;
    }
    this.offsets[this.nLinhas++] = off;
  }
  /** Linhas [inicio, inicio+quantidade). */
  linhas(inicio: number, quantidade: number): string[] {
    if (inicio < 0 || quantidade <= 0 || inicio >= this.nLinhas) return [];
    const fim = Math.min(inicio + quantidade, this.nLinhas);
    const de = this.offsets[inicio]!;
    const ate = fim < this.nLinhas ? this.offsets[fim]! : this.bytes;
    return this.ler(de, ate).replace(/\n$/, "").split("\n");
  }
  pagina(n: number, tamanho = 500): string[] {
    return this.linhas(n * tamanho, tamanho);
  }
  paginas(tamanho = 500): number {
    return Math.ceil(this.nLinhas / tamanho);
  }
  private ler(de: number, ate: number): string {
    const partes: Buffer[] = [];
    let pos = 0;
    for (const bl of this.blocos) {
      const ini = pos;
      const fim = pos + bl.length;
      pos = fim;
      if (fim <= de) continue;
      if (ini >= ate) break;
      partes.push(bl.subarray(Math.max(de - ini, 0), Math.min(ate - ini, bl.length)));
    }
    return Buffer.concat(partes).toString("utf8");
  }
}
