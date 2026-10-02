// Gerador determinístico para o fuzz da Fase 22 (T-22.24): PRNG mulberry32 com semente FIXA, sem dependência nova. Mesma semente = mesmo corpus em qualquer máquina.

export const SEMENTE = 0x22_24_0f;
export const ENTRADAS = 200_000;
export interface Rnd {
  (): number;
  int(n: number): number;
  bytes(n: number): Buffer;
  pick<T>(l: readonly T[]): T;
}
export function criarRnd(semente = SEMENTE): Rnd {
  let s = semente >>> 0;
  const f = (() => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rnd;
  f.int = (n) => Math.floor(f() * n);
  f.bytes = (n) => {
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = f.int(256);
    return b;
  };
  f.pick = (l) => l[f.int(l.length)] as never;
  return f;
}

/** mutações de bit, byte, truncamento, extensão, inserção e remoção. */
export function mutar(base: Uint8Array, r: Rnd): Buffer {
  let b = Buffer.from(base);
  const n = 1 + r.int(4);
  for (let k = 0; k < n; k++) {
    switch (r.int(7)) {
      case 0:
        if (b.length > 0) b[r.int(b.length)]! ^= 1 << r.int(8);
        break;
      case 1:
        if (b.length > 0) b[r.int(b.length)] = r.int(256);
        break;
      case 2:
        b = b.subarray(0, r.int(b.length + 1));
        break;
      case 3:
        b = Buffer.concat([b, r.bytes(1 + r.int(64))]);
        break;
      case 4: {
        const i = r.int(b.length + 1);
        b = Buffer.concat([b.subarray(0, i), r.bytes(1 + r.int(8)), b.subarray(i)]);
        break;
      }
      case 5: {
        const i = r.int(b.length + 1);
        b = Buffer.concat([b.subarray(0, i), b.subarray(Math.min(b.length, i + 1 + r.int(8)))]);
        break;
      }
      default:
        b = Buffer.from(b);
        for (let j = 0; j < 3 && b.length > 0; j++) b[r.int(b.length)] = r.pick([0, 0xff, 0x80, 0xc0, 0xf8, 0x7b, 0x22]);
    }
  }
  return Buffer.from(b);
}
const NUMEROS = ["0", "-1", "1e999", "-1e999", "9007199254740993", "1.7976931348623157e308", "0.0000001", "NaN", "null", "true", "[]", "{}", '"x"', "18446744073709551616"];
/** valor JSON hostil: aninhamento profundo, números enormes, chaves duplicadas/protótipo, strings gigantes. */
export function jsonHostil(r: Rnd): string {
  switch (r.int(8)) {
    case 0:
      return "[".repeat(1 + r.int(5000)) + "]".repeat(r.int(5000));
    case 1:
      return `{"a":`.repeat(1 + r.int(2000)) + "1" + "}".repeat(r.int(2000));
    case 2:
      return r.pick(NUMEROS);
    case 3:
      return `{"__proto__":{"x":1},"constructor":{"prototype":{}},"r":${r.pick(NUMEROS)},"id":${r.pick(NUMEROS)},"corpo":${r.pick(NUMEROS)}}`;
    case 4:
      return JSON.stringify({ r: "x".repeat(r.int(70000)), id: r.int(1 << 30), corpo: null });
    case 5:
      return Buffer.concat([Buffer.from('{"t":"'), r.bytes(r.int(40)), Buffer.from('"}')]).toString("latin1");
    case 6:
      return `{"t":"hello","t":"ok","canal":"${"a".repeat(32)}","canal":1}`;
    default:
      return mutar(Buffer.from('{"t":"hello","v":"x","papel":"host","canal":"00000000000000000000000000000000","ts":1,"nonce":"AAAAAAAAAAAAAAAAAAAAAA=="}'), r).toString("utf8");
  }
}

/** mede a maior pausa do event loop e o tempo por lote durante `fn` (síncrono em lotes que cedem). */
export async function medir(lotes: number, porLote: number, fn: (i: number) => void | Promise<void>): Promise<{ maiorLoteMs: number; maiorAtrasoMs: number; heapMb: number }> {
  // `maiorAtrasoMs` = a maior duração de UMA entrada (a "tarefa" do critério de 50 ms). O histograma do event loop fica de fora: GC e carga de outros arquivos de teste o contaminam.
  let maiorTarefa = 0;
  let maior = 0;
  const heap0 = process.memoryUsage().heapUsed;
  let i = 0;
  for (let l = 0; l < lotes; l++) {
    const t = performance.now();
    for (let k = 0; k < porLote; k++) {
      const t1 = performance.now();
      await fn(i++);
      maiorTarefa = Math.max(maiorTarefa, performance.now() - t1);
    }
    maior = Math.max(maior, performance.now() - t);
    await new Promise((res) => setImmediate(res));
  }
  return { maiorLoteMs: maior, maiorAtrasoMs: maiorTarefa, heapMb: (process.memoryUsage().heapUsed - heap0) / 1048576 };
}
