// Gerador mínimo de QR Code (T-22.22, D-374): SEM biblioteca, SEM rede. Modo byte, correção M, versões 1 a 10 (até 213 bytes), máscara escolhida pela penalidade da norma,
// Reed-Solomon em GF(256). Só o necessário para o link de pareamento (`<pwa_origem>#r=…&c=…&h=…&p=…`). Puro: devolve a matriz; a tela a desenha em SVG.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255] as number;
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : (GF_EXP[(GF_LOG[a] as number) + (GF_LOG[b] as number)] as number));

/** logaritmo em GF(256) (a norma lista o gerador em expoentes de α). */
export const logGf = (x: number): number => GF_LOG[x] as number;

/** coeficientes (sem o termo líder) do polinômio gerador de grau n: ∏ (x − α^i). */
export function polinomioGerador(n: number): number[] {
  let p = [1];
  for (let i = 0; i < n; i++) {
    const q = new Array<number>(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) {
      q[j] = (q[j] as number) ^ (p[j] as number);
      q[j + 1] = (q[j + 1] as number) ^ mul(p[j] as number, GF_EXP[i] as number);
    }
    p = q;
  }
  return p.slice(1);
}
export function restoRS(dados: readonly number[], n: number): number[] {
  const g = polinomioGerador(n);
  const r = new Array<number>(n).fill(0);
  for (const d of dados) {
    const f = d ^ (r.shift() as number);
    r.push(0);
    for (let i = 0; i < n; i++) r[i] = (r[i] as number) ^ mul(g[i] as number, f);
  }
  return r;
}

/** [bytes de correção por bloco, [nº de blocos, bytes de dados por bloco][]] — nível M. */
const BLOCOS_M: Record<number, [number, Array<[number, number]>]> = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};
const ALINHAMENTO: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
export const VERSAO_MAX = 10;
const dadosDaVersao = (v: number): number => (BLOCOS_M[v] as [number, Array<[number, number]>])[1].reduce((s, [n, d]) => s + n * d, 0);
/** bytes úteis (modo byte) na versão v: dados − 1 (modo+contador de 8 bits ≈ 12 bits) ou −2 (contador de 16 bits na v10). */
export const capacidadeBytes = (v: number): number => dadosDaVersao(v) - (v >= 10 ? 3 : 2);

export function formatoBits(mascara: number): number {
  const dados = (0 << 3) | mascara; // nível M = 00
  let r = dados;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((dados << 10) | r) ^ 0x5412;
}
export function versaoBits(v: number): number {
  let r = v;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  return (v << 12) | r;
}
const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

export function codewords(texto: Uint8Array, v: number): number[] {
  const total = dadosDaVersao(v);
  const bits: number[] = [];
  const poe = (val: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  poe(0b0100, 4);
  poe(texto.length, v >= 10 ? 16 : 8);
  for (const b of texto) poe(b, 8);
  poe(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const dados: number[] = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let k = 0; dados.length < total; k++) dados.push(k % 2 === 0 ? 0xec : 0x11);
  const [nec, grupos] = BLOCOS_M[v] as [number, Array<[number, number]>];
  const blocos: number[][] = [];
  const ecs: number[][] = [];
  let p = 0;
  for (const [n, d] of grupos) {
    for (let i = 0; i < n; i++) {
      const b = dados.slice(p, p + d);
      p += d;
      blocos.push(b);
      ecs.push(restoRS(b, nec));
    }
  }
  const out: number[] = [];
  const maxD = Math.max(...blocos.map((b) => b.length));
  for (let i = 0; i < maxD; i++) for (const b of blocos) if (i < b.length) out.push(b[i] as number);
  for (let i = 0; i < nec; i++) for (const e of ecs) out.push(e[i] as number);
  return out;
}

const MASCARAS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
];

export function penalidade(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  for (const linhas of [m, m[0]!.map((_, x) => m.map((l) => l[x] as boolean))]) {
    for (const l of linhas) {
      let corrida = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && l[i] === l[i - 1]) corrida++;
        else {
          if (corrida >= 5) p += 3 + corrida - 5;
          corrida = 1;
        }
      }
      for (let i = 0; i + 10 < n + 0; i++) {
        const w = l.slice(i, i + 11).map((b) => (b ? 1 : 0)).join("");
        if (w === "10111010000" || w === "00001011101") p += 40;
      }
    }
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) if (m[y]![x] === m[y]![x + 1] && m[y]![x] === m[y + 1]![x] && m[y]![x] === m[y + 1]![x + 1]) p += 3;
  const escuros = m.reduce((s, l) => s + l.filter(Boolean).length, 0);
  p += (Math.ceil(Math.abs(escuros * 20 - n * n * 10) / (n * n)) - 1) * 10;
  return p;
}

export interface Qr {
  versao: number;
  tamanho: number;
  mascara: number;
  /** `true` = módulo escuro; `modulos[linha][coluna]`. */
  modulos: boolean[][];
}

export function gerarQr(texto: string): Qr {
  const bytes = new TextEncoder().encode(texto);
  let v = 1;
  while (v <= VERSAO_MAX && bytes.length > capacidadeBytes(v)) v++;
  if (v > VERSAO_MAX) throw new RangeError("texto_grande_demais");
  const n = 17 + 4 * v;
  const mod: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fn: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (x: number, y: number, escuro: boolean): void => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    (mod[y] as boolean[])[x] = escuro;
    (fn[y] as boolean[])[x] = true;
  };
  for (let i = 0; i < n; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]] as const) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    set(cx + dx, cy + dy, d !== 2 && d !== 4);
  }
  const al = ALINHAMENTO[v] as number[];
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set((al[i] as number) + dx, (al[j] as number) + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const formato = (mascara: number): void => {
    const b = formatoBits(mascara);
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6));
    set(8, 8, bit(b, 7));
    set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(b, i));
    set(8, n - 8, true);
  };
  formato(0);
  if (v >= 7) {
    const b = versaoBits(v);
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3);
      const c = Math.floor(i / 3);
      set(a, c, bit(b, i));
      set(c, a, bit(b, i));
    }
  }
  const dados = codewords(bytes, v);
  let k = 0;
  for (let direita = n - 1; direita >= 1; direita -= 2) {
    if (direita === 6) direita = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = direita - j;
        const y = ((direita + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (!(fn[y] as boolean[])[x] && k < dados.length * 8) {
          (mod[y] as boolean[])[x] = bit(dados[k >>> 3] as number, 7 - (k & 7));
          k++;
        }
      }
    }
  }
  let melhor = 0;
  let melhorP = Infinity;
  for (let m = 0; m < 8; m++) {
    const t = mod.map((l) => l.slice());
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!(fn[y] as boolean[])[x] && (MASCARAS[m] as (x: number, y: number) => boolean)(x, y)) (t[y] as boolean[])[x] = !(t[y] as boolean[])[x];
    // o formato entra na penalidade (como nas implementações de referência)
    const saved = mod.map((l) => l.slice());
    for (let y = 0; y < n; y++) (mod[y] as boolean[]).splice(0, n, ...(t[y] as boolean[]));
    formato(m);
    const pen = penalidade(mod);
    for (let y = 0; y < n; y++) (mod[y] as boolean[]).splice(0, n, ...(saved[y] as boolean[]));
    if (pen < melhorP) {
      melhorP = pen;
      melhor = m;
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!(fn[y] as boolean[])[x] && (MASCARAS[melhor] as (x: number, y: number) => boolean)(x, y)) (mod[y] as boolean[])[x] = !(mod[y] as boolean[])[x];
  formato(melhor);
  return { versao: v, tamanho: n, mascara: melhor, modulos: mod };
}

/** caminho SVG único (um `M…h1v1h-1z` por módulo escuro) com zona de silêncio de 4 módulos. */
export function qrParaCaminho(q: Qr, silencio = 4): { caminho: string; lado: number } {
  const partes: string[] = [];
  q.modulos.forEach((l, y) => l.forEach((e, x) => e && partes.push(`M${x + silencio} ${y + silencio}h1v1h-1z`)));
  return { caminho: partes.join(""), lado: q.tamanho + 2 * silencio };
}
