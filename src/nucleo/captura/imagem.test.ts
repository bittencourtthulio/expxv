import { describe, expect, it } from "vitest";
import { bitmapValido, codificarCaptura, dimensoesJpeg, dimensoesPng, idDeCapturaValido, imagemEmBranco, radicalDeData, radicalLivre, recortarBitmap, type Bitmap, type Codificador } from "./imagem";

function bitmap(l: number, a: number, f: (x: number, y: number) => [number, number, number, number]): Bitmap {
  const dados = new Uint8Array(l * a * 4);
  for (let y = 0; y < a; y++) for (let x = 0; x < l; x++) dados.set(f(x, y), (y * l + x) * 4);
  return { largura: l, altura: a, dados };
}

describe("imagem de captura", () => {
  it("imagem toda transparente ou de uma cor só é 'em branco' (permissão de tela negada)", () => {
    expect(imagemEmBranco(bitmap(100, 80, () => [0, 0, 0, 0]))).toBe(true);
    expect(imagemEmBranco(bitmap(100, 80, () => [30, 30, 30, 255]))).toBe(true);
    expect(imagemEmBranco(bitmap(100, 80, (x) => [x * 2, 10, 10, 255]))).toBe(false);
    expect(imagemEmBranco({ largura: 0, altura: 0, dados: new Uint8Array(0) })).toBe(true);
  });

  it("recorta os pixels certos e recusa recorte fora da imagem", () => {
    const b = bitmap(10, 10, (x, y) => [x, y, 0, 255]);
    const r = recortarBitmap(b, { x: 2, y: 3, largura: 4, altura: 2 });
    expect(r.largura).toBe(4);
    expect(bitmapValido(r)).toBe(true);
    expect(Array.from(r.dados.subarray(0, 4))).toEqual([2, 3, 0, 255]);
    expect(Array.from(r.dados.subarray(r.dados.length - 4))).toEqual([5, 4, 0, 255]);
    expect(() => recortarBitmap(b, { x: 8, y: 8, largura: 5, altura: 5 })).toThrow();
  });

  it("PNG até 800 KB, senão JPEG q85", () => {
    const b = bitmap(2, 2, () => [1, 2, 3, 255]);
    const usado: number[] = [];
    const pequeno: Codificador = { png: () => new Uint8Array(1000), jpeg: () => new Uint8Array(1) };
    const grande: Codificador = { png: () => new Uint8Array(800 * 1024 + 1), jpeg: (_b, q) => { usado.push(q); return new Uint8Array(5); } };
    expect(codificarCaptura(b, pequeno).formato).toBe("png");
    expect(codificarCaptura(b, grande)).toMatchObject({ formato: "jpeg" });
    expect(usado).toEqual([85]);
  });

  it("nome YYYY-MM-DD_HH-mm-ss sem colisão", () => {
    const d = new Date(2026, 9, 1, 8, 5, 9);
    expect(radicalDeData(d)).toBe("2026-10-01_08-05-09");
    const ocupados = new Set(["2026-10-01_08-05-09", "2026-10-01_08-05-09-1"]);
    expect(radicalLivre(d, (r) => ocupados.has(r))).toBe("2026-10-01_08-05-09-2");
    expect(idDeCapturaValido("2026-10-01_08-05-09")).toBe(true);
    expect(idDeCapturaValido("q_2026-10-01_08-05-09-3")).toBe(true);
    expect(idDeCapturaValido("../etc/passwd")).toBe(false);
    expect(idDeCapturaValido("2026-10-01_08-05-09/../x")).toBe(false);
  });

  it("lê dimensões de PNG e JPEG; lixo devolve null", () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 640);
    new DataView(png.buffer).setUint32(20, 480);
    expect(dimensoesPng(png)).toEqual({ largura: 640, altura: 480 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(dimensoesJpeg(jpg)).toEqual({ largura: 640, altura: 480 });
    expect(dimensoesPng(new Uint8Array(40))).toBeNull();
    expect(dimensoesJpeg(new Uint8Array(40))).toBeNull();
  });
});
