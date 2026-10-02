// Física 3D do grafo (pura, sem DOM): molas nas ligações, repulsão (todos os pares até 400 nós; grade espacial acima disso),
// gravidade fraca e resfriamento. `rodar(ms)` amortiza o custo: nunca passa do orçamento por quadro (mínimo de uma iteração).
export interface EntradaFisica {
  n: number;
  /** ligações como pares de índices. */
  de: ArrayLike<number>;
  para: ArrayLike<number>;
  /** grupo de cada nó (>= 0) ou -1; nós do mesmo grupo nascem juntos. */
  grupo?: ArrayLike<number>;
  semente?: number;
}

export const LIMIAR_PARES = 400;
export const CALOR_MIN = 0.02;

function aleatorio(semente: number): () => number {
  let a = (semente >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Comprimento de mola: mantém o raio da rede perto de 60 unidades de mundo qualquer que seja o tamanho do grafo. */
export const comprimentoDaMola = (n: number): number => Math.max(3, 60 / Math.cbrt(Math.max(n, 1)));

export class Fisica {
  readonly n: number;
  readonly L: number;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  calor = 1;
  iteracoes = 0;
  private cursor = 0;
  private readonly de: Int32Array;
  private readonly para: Int32Array;
  private readonly cabeca: Int32Array;
  private readonly proximo: Int32Array;
  private readonly mascara: number;
  private readonly rnd: () => number;

  constructor(e: EntradaFisica) {
    this.n = e.n;
    this.L = comprimentoDaMola(e.n);
    this.pos = new Float32Array(e.n * 3);
    this.vel = new Float32Array(e.n * 3);
    this.de = Int32Array.from(e.de);
    this.para = Int32Array.from(e.para);
    let tabela = 16;
    while (tabela < e.n * 2) tabela <<= 1;
    this.cabeca = new Int32Array(tabela);
    this.proximo = new Int32Array(e.n);
    this.mascara = tabela - 1;
    this.rnd = aleatorio(e.semente ?? 7);
    this.semear(e.grupo);
  }

  private direcao(): [number, number, number] {
    const z = this.rnd() * 2 - 1, a = this.rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), z, r * Math.sin(a)];
  }

  private semear(grupo?: ArrayLike<number>): void {
    const R = this.L * Math.cbrt(this.n) * 1.1;
    const centros = new Map<number, [number, number, number]>();
    const tamanhos = new Map<number, number>();
    if (grupo !== undefined) for (let i = 0; i < this.n; i++) { const g = grupo[i] as number; if (g >= 0) tamanhos.set(g, (tamanhos.get(g) ?? 0) + 1); }
    for (let i = 0; i < this.n; i++) {
      const g = grupo !== undefined ? (grupo[i] as number) : -1;
      const d = this.direcao();
      let raio = R * Math.cbrt(this.rnd());
      let c: [number, number, number] = [0, 0, 0];
      if (g >= 0 && (tamanhos.get(g) ?? 0) > 1) {
        let cg = centros.get(g);
        if (cg === undefined) { const u = this.direcao(); const r0 = R * 0.75; cg = [u[0] * r0, u[1] * r0, u[2] * r0]; centros.set(g, cg); }
        c = cg;
        raio = this.L * Math.cbrt(tamanhos.get(g) as number) * 1.2 * Math.cbrt(this.rnd());
      }
      this.pos[i * 3] = c[0] + d[0] * raio; this.pos[i * 3 + 1] = c[1] + d[1] * raio; this.pos[i * 3 + 2] = c[2] + d[2] * raio;
    }
  }

  get frio(): boolean { return this.calor <= CALOR_MIN + 0.001; }
  reaquecer(forca = 1): void { this.calor = Math.max(this.calor, forca); }

  private repulsaoTodos(k: number): void {
    const { n, L } = this;
    const pos = this.pos, vel = this.vel as unknown as number[];
    const rep = 0.15 * L * L * L * k, folga = L * L * 0.04;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = (pos[i * 3] as number) - (pos[j * 3] as number), dy = (pos[i * 3 + 1] as number) - (pos[j * 3 + 1] as number), dz = (pos[i * 3 + 2] as number) - (pos[j * 3 + 2] as number);
      const r2 = dx * dx + dy * dy + dz * dz + folga, f = rep / (r2 * Math.sqrt(r2));
      vel[i * 3]! += dx * f; vel[i * 3 + 1]! += dy * f; vel[i * 3 + 2]! += dz * f;
      vel[j * 3]! -= dx * f; vel[j * 3 + 1]! -= dy * f; vel[j * 3 + 2]! -= dz * f;
    }
  }

  /** Repulsão da grade para os nós [de, ate) — a grade é montada só quando `de === 0` (as posições não mudam entre fatias). */
  private repulsaoGrade(k: number, de: number, prazo: number, agora: () => number): number {
    const { n, L, cabeca, proximo, mascara } = this;
    const pos = this.pos, vel = this.vel as unknown as number[];
    const lado = L * 2, inv = 1 / lado, corte2 = lado * lado;
    const rep = 0.15 * L * L * L * k, folga = L * L * 0.04;
    const chave = (x: number, y: number, z: number): number => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mascara;
    if (de === 0) {
      cabeca.fill(-1);
      for (let i = 0; i < n; i++) {
        const h = chave(Math.floor((pos[i * 3] as number) * inv), Math.floor((pos[i * 3 + 1] as number) * inv), Math.floor((pos[i * 3 + 2] as number) * inv));
        proximo[i] = cabeca[h] as number; cabeca[h] = i;
      }
    }
    for (let i = de; i < n; i++) {
      if ((i & 31) === 0 && i > de && agora() >= prazo) return i;
      const px = pos[i * 3] as number, py = pos[i * 3 + 1] as number, pz = pos[i * 3 + 2] as number;
      const cx = Math.floor(px * inv), cy = Math.floor(py * inv), cz = Math.floor(pz * inv);
      let ax = 0, ay = 0, az = 0;
      for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
        for (let j = cabeca[chave(x, y, z)] as number; j >= 0; j = proximo[j] as number) {
          if (j === i) continue;
          const dx = px - (pos[j * 3] as number), dy = py - (pos[j * 3 + 1] as number), dz = pz - (pos[j * 3 + 2] as number);
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > corte2) continue;
          const r2 = d2 + folga, f = rep / (r2 * Math.sqrt(r2));
          ax += dx * f; ay += dy * f; az += dz * f;
        }
      }
      vel[i * 3]! += ax; vel[i * 3 + 1]! += ay; vel[i * 3 + 2]! += az;
    }
    return n;
  }

  /** Molas, gravidade, integração e resfriamento (a repulsão já foi somada em `vel`). */
  private integrar(): void {
    const { n, L, de, para } = this;
    const pos = this.pos as unknown as number[], vel = this.vel as unknown as number[];
    const k = this.calor;
    for (let e = 0; e < de.length; e++) {
      const a = de[e] as number, b = para[e] as number;
      const dx = (pos[b * 3] as number) - (pos[a * 3] as number), dy = (pos[b * 3 + 1] as number) - (pos[a * 3 + 1] as number), dz = (pos[b * 3 + 2] as number) - (pos[a * 3 + 2] as number);
      const d = Math.hypot(dx, dy, dz) || 0.01, f = ((d - L) * 0.05 * k) / d;
      vel[a * 3]! += dx * f; vel[a * 3 + 1]! += dy * f; vel[a * 3 + 2]! += dz * f;
      vel[b * 3]! -= dx * f; vel[b * 3 + 1]! -= dy * f; vel[b * 3 + 2]! -= dz * f;
    }
    const vmax = L * 2;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const o = i * 3 + c;
        let v = ((vel[o] as number) - (pos[o] as number) * 0.006 * k) * 0.82;
        if (v > vmax) v = vmax; else if (v < -vmax) v = -vmax;
        vel[o] = v;
        pos[o] = (pos[o] as number) + v;
      }
    }
    this.calor = Math.max(CALOR_MIN, this.calor * (n > 2000 ? 0.97 : 0.985));
    this.iteracoes++;
  }

  /** Uma iteração completa. */
  passo(): void {
    this.cursor = 0;
    if (this.n <= LIMIAR_PARES) this.repulsaoTodos(this.calor); else this.repulsaoGrade(this.calor, 0, Infinity, () => 0);
    this.integrar();
  }

  /** Avança até `prazo` (ms do relógio dado); só integra quando a repulsão de todos os nós foi somada. Devolve se a iteração fechou. */
  private fatia(prazo: number, agora: () => number): boolean {
    if (this.n <= LIMIAR_PARES) { this.repulsaoTodos(this.calor); this.integrar(); return true; }
    this.cursor = this.repulsaoGrade(this.calor, this.cursor, prazo, agora);
    if (this.cursor < this.n) return false;
    this.cursor = 0;
    this.integrar();
    return true;
  }

  /** Trabalha até gastar `orcamentoMs` (relógio injetável para teste); com muitos nós a iteração é fatiada entre quadros. Devolve as iterações fechadas. */
  rodar(orcamentoMs: number, agora: () => number = () => performance.now(), maxIteracoes = 4): number {
    if (this.frio) return 0;
    const prazo = agora() + orcamentoMs;
    let feitas = 0;
    do { if (this.fatia(prazo, agora)) feitas++; } while (feitas < maxIteracoes && !this.frio && agora() < prazo);
    return feitas;
  }

  /** Centro e raio da esfera que contém o `quantil` dos nós (ignora os mais distantes). */
  envoltoria(quantil = 0.98): { centro: [number, number, number]; raio: number } {
    const { pos, n } = this;
    if (n === 0) return { centro: [0, 0, 0], raio: 1 };
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pos[i * 3] as number; cy += pos[i * 3 + 1] as number; cz += pos[i * 3 + 2] as number; }
    cx /= n; cy /= n; cz /= n;
    const ds = new Float32Array(n);
    for (let i = 0; i < n; i++) ds[i] = Math.hypot((pos[i * 3] as number) - cx, (pos[i * 3 + 1] as number) - cy, (pos[i * 3 + 2] as number) - cz);
    ds.sort();
    return { centro: [cx, cy, cz], raio: Math.max(ds[Math.min(n - 1, Math.floor(n * quantil))] as number, this.L) };
  }
}
