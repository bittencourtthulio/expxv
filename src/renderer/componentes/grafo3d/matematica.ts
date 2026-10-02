// Matemática mínima do grafo 3D (puro): matrizes 4x4 em coluna (como o WebGL espera), perspectiva, lookAt, projeção e câmera orbital.
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function perspectiva(fovY: number, aspecto: number, perto: number, longe: number, saida: Mat4 = new Float32Array(16)): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  saida.fill(0);
  saida[0] = f / aspecto;
  saida[5] = f;
  saida[10] = (longe + perto) / (perto - longe);
  saida[11] = -1;
  saida[14] = (2 * longe * perto) / (perto - longe);
  return saida;
}

export function olharPara(olho: Vec3, alvo: Vec3, cima: Vec3 = [0, 1, 0], saida: Mat4 = new Float32Array(16)): Mat4 {
  let zx = olho[0] - alvo[0], zy = olho[1] - alvo[1], zz = olho[2] - alvo[2];
  const lz = Math.hypot(zx, zy, zz) || 1;
  zx /= lz; zy /= lz; zz /= lz;
  let xx = cima[1] * zz - cima[2] * zy, xy = cima[2] * zx - cima[0] * zz, xz = cima[0] * zy - cima[1] * zx;
  const lx = Math.hypot(xx, xy, xz) || 1;
  xx /= lx; xy /= lx; xz /= lx;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  saida.set([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * olho[0] + xy * olho[1] + xz * olho[2]), -(yx * olho[0] + yy * olho[1] + yz * olho[2]), -(zx * olho[0] + zy * olho[1] + zz * olho[2]), 1]);
  return saida;
}

/** a · b (aplica b primeiro). */
export function multiplicar(a: Mat4, b: Mat4, saida: Mat4 = new Float32Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    saida[c * 4 + r] = (a[r] as number) * (b[c * 4] as number) + (a[4 + r] as number) * (b[c * 4 + 1] as number) + (a[8 + r] as number) * (b[c * 4 + 2] as number) + (a[12 + r] as number) * (b[c * 4 + 3] as number);
  }
  return saida;
}

/** Projeta (x,y,z) para pixels de tela (largura w, altura h). Devolve [sx, sy, profundidade(w do clip)]; profundidade <= 0 = atrás da câmera. */
export function projetar(m: ArrayLike<number>, x: number, y: number, z: number, w: number, h: number, saida: Float64Array | number[] = [0, 0, 0]): Float64Array | number[] {
  const cx = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
  const cy = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
  const cw = (m[3] as number) * x + (m[7] as number) * y + (m[11] as number) * z + (m[15] as number);
  const inv = cw !== 0 ? 1 / cw : 0;
  saida[0] = (cx * inv * 0.5 + 0.5) * w;
  saida[1] = (-cy * inv * 0.5 + 0.5) * h;
  saida[2] = cw;
  return saida;
}

export interface Orbita { az: number; el: number; raio: number; centro: Vec3 }
export const FOV = (50 * Math.PI) / 180;
export const EL_MAX = 1.3;
export const limitarElevacao = (el: number): number => Math.max(-EL_MAX, Math.min(EL_MAX, el));

export function posicaoDaCamera(o: Orbita): Vec3 {
  const ce = Math.cos(o.el);
  return [o.centro[0] + Math.sin(o.az) * ce * o.raio, o.centro[1] + Math.sin(o.el) * o.raio, o.centro[2] + Math.cos(o.az) * ce * o.raio];
}

/** Matriz projeção·vista da câmera orbital. */
export function matrizDaCamera(o: Orbita, largura: number, altura: number, saida: Mat4 = new Float32Array(16)): Mat4 {
  const p = perspectiva(FOV, largura / Math.max(altura, 1), 0.5, 6000);
  const v = olharPara(posicaoDaCamera(o), o.centro);
  return multiplicar(p, v, saida);
}

/** Raio da órbita para caber uma esfera de raio `r` no campo de visão (com folga). */
export const raioParaCaber = (r: number, folga = 1.25): number => (Math.max(r, 1) * folga) / Math.sin(FOV / 2);
