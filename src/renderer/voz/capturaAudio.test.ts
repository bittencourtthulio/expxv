import { describe, expect, it } from "vitest";
import { abrirCaptura, codigoDeErroDeMidia, ErroAudio, type ContextoMinimo, type MidiaMinima, type NoMinimo } from "./capturaAudio";

function cena(opcoes: { taxa?: number; falharModulo?: boolean; falharMidia?: string } = {}) {
  const tracks = [{ parou: false, stop() { this.parou = true; } }, { parou: false, stop() { this.parou = true; } }];
  const no: NoMinimo & { desconectado: boolean } = { port: { onmessage: null }, connect: () => undefined, disconnect() { this.desconectado = true; }, desconectado: false };
  let fonteDesligada = false;
  let contextoFechado = false;
  const midia: MidiaMinima = {
    getUserMedia: async () => {
      if (opcoes.falharMidia !== undefined) throw Object.assign(new Error("x"), { name: opcoes.falharMidia });
      return { getTracks: () => tracks };
    },
  };
  const ctx: ContextoMinimo = {
    sampleRate: opcoes.taxa ?? 48_000,
    audioWorklet: { addModule: async () => { if (opcoes.falharModulo === true) throw new Error("módulo"); } },
    createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => { fonteDesligada = true; } }),
    close: async () => { contextoFechado = true; },
  };
  const blocos: [number, number][] = [];
  const niveis: number[] = [];
  let t = 0;
  const abrir = () => abrirCaptura({ midia, criarContexto: () => ctx, criarNo: () => no, urlWorklet: "x.js", aoBloco: (s, d) => blocos.push([s, d.byteLength]), aoNivel: (n) => niveis.push(n), agora: () => (t += 10) });
  const ativos = (): number => tracks.filter((x) => !x.parou).length;
  return { abrir, no, tracks, blocos, niveis, ativos, estado: () => ({ fonteDesligada, contextoFechado }) };
}

const onda = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 5) * 0.5);

describe("captura de áudio (P-49: microfone fechado fora da fala)", () => {
  it("parar fecha TODAS as trilhas, desconecta e fecha o contexto; é idempotente", async () => {
    const c = cena();
    const s = await c.abrir();
    expect(c.ativos()).toBe(2);
    await s.parar();
    await s.parar();
    expect(c.ativos()).toBe(0);
    expect(c.estado()).toEqual({ fonteDesligada: true, contextoFechado: true });
    expect(c.no.desconectado).toBe(true);
  });

  it("erro ao carregar o worklet também deixa 0 trilhas ativas", async () => {
    const c = cena({ falharModulo: true });
    await expect(c.abrir()).rejects.toBeInstanceOf(ErroAudio);
    expect(c.ativos()).toBe(0);
    expect(c.estado().contextoFechado).toBe(true);
  });

  it("permissão negada vira microfone_negado e ausência vira microfone_indisponivel (sem trilha aberta)", async () => {
    await expect(cena({ falharMidia: "NotAllowedError" }).abrir()).rejects.toMatchObject({ codigo: "microfone_negado" });
    await expect(cena({ falharMidia: "NotFoundError" }).abrir()).rejects.toMatchObject({ codigo: "microfone_indisponivel" });
    expect(codigoDeErroDeMidia(Object.assign(new Error(), { name: "SecurityError" }))).toBe("microfone_negado");
  });

  it("48 kHz vira PCM16 16 kHz em blocos de no máximo 64 KiB; o resto sai no parar", async () => {
    const c = cena();
    const s = await c.abrir();
    const total = 48_000 * 3; // 3 s
    for (let i = 0; i < total; i += 2_048) c.no.port.onmessage?.({ data: onda(2_048) });
    await s.parar();
    const bytes = c.blocos.reduce((a, [, n]) => a + n, 0);
    expect(Math.abs(bytes / 2 - 48_000) / 48_000).toBeLessThan(0.01); // 3 s a 16 kHz = 48 000 amostras
    expect(Math.max(...c.blocos.map(([, n]) => n))).toBeLessThanOrEqual(65_536);
    expect(c.blocos.map(([s2]) => s2)).toEqual(c.blocos.map((_, i) => i));
  });

  it("depois de parar nada mais é enviado, e o nível sai a no máximo 20 Hz", async () => {
    const c = cena();
    const s = await c.abrir();
    const handler = c.no.port.onmessage;
    for (let i = 0; i < 100; i++) handler?.({ data: onda(2_048) }); // relógio falso avança 10 ms por chamada
    expect(c.niveis.length).toBeLessThanOrEqual(21);
    await s.parar();
    const antes = c.blocos.length;
    handler?.({ data: onda(40_000) });
    expect(c.blocos.length).toBe(antes);
  });
});
