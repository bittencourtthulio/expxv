import { describe, expect, it } from "vitest";
import { AtualizadorPrs, type Agendador, type EventoAtualizacao } from "./atualizacao";
import { ForgeRateLimitErro, ForgeRedeErro } from "./erros";
import type { ConsultaPr, Forge, LimiteApi, PrResumo } from "./forge";

const pr = (n: number, extra: Partial<PrResumo> = {}): PrResumo => ({ numero: n, titulo: `PR ${n}`, estado: "aberto", rascunho: false, autor: "a", ramoOrigem: "x", ramoDestino: "main", url: "", criadoEm: "", atualizadoEm: "t1", labels: [], revisao: "nenhuma", checks: null, ...extra });

function cenario(consultar: (n: number, etag?: string) => ConsultaPr | Promise<ConsultaPr>, limite: () => LimiteApi | null = () => null) {
  let t = 1_000_000;
  const chamadas: Array<{ n: number; etag?: string; em: number }> = [];
  const eventos: EventoAtualizacao[] = [];
  let foco = true;
  let alvos = [1, 2];
  const agendados: Array<{ fn: () => void; ms: number }> = [];
  const agendador: Agendador = { agendar: (fn, ms) => (agendados.push({ fn, ms }), () => undefined) };
  const forge = {
    prs: { consultar: async (n: number, etag?: string) => (chamadas.push({ n, ...(etag ? { etag } : {}), em: t }), consultar(n, etag)) },
    limiteApi: async () => limite(),
  } as unknown as Pick<Forge, "prs" | "limiteApi">;
  const at = new AtualizadorPrs({ forge, alvos: () => alvos, janelaEmFoco: () => foco, aoEvento: (e) => eventos.push(e), agendador, agora: () => t, backoffBaseMs: 60_000 });
  return { at, chamadas, eventos, agendados, avancar: (ms: number) => (t += ms), foco: (v: boolean) => (foco = v), alvos: (a: number[]) => (alvos = a) };
}

describe("atualização inteligente (T-06.21)", () => {
  it("sem foco da janela nenhuma chamada é feita", async () => {
    const c = cenario((n) => ({ naoModificado: false, pr: pr(n) }));
    c.foco(false);
    expect((await c.at.tick()).pulado).toBe("sem-foco");
    expect(c.chamadas).toHaveLength(0);
    c.foco(true);
    expect((await c.at.tick()).consultados).toEqual([1, 2]);
  });
  it("no máximo 1 chamada por PR a cada 60 s", async () => {
    const c = cenario((n) => ({ naoModificado: false, pr: pr(n) }));
    await c.at.tick();
    c.avancar(30_000);
    const r = await c.at.tick();
    expect(r.consultados).toEqual([]);
    expect(r.emCache).toEqual([1, 2]);
    expect(c.chamadas).toHaveLength(2);
    c.avancar(30_001);
    await c.at.tick();
    expect(c.chamadas).toHaveLength(4);
    for (const n of [1, 2]) {
      const em = c.chamadas.filter((x) => x.n === n).map((x) => x.em);
      for (let i = 1; i < em.length; i++) expect(em[i]! - em[i - 1]!).toBeGreaterThanOrEqual(60_000);
    }
  });
  it("só consulta os alvos pedidos e reaproveita o ETag; evento só quando muda", async () => {
    const c = cenario((n, etag) => (etag ? { naoModificado: true, etag } : { naoModificado: false, etag: `"e${n}"`, pr: pr(n) }));
    c.alvos([5]);
    await c.at.tick();
    expect(c.eventos).toHaveLength(1);
    c.avancar(61_000);
    await c.at.tick();
    expect(c.chamadas.map((x) => [x.n, x.etag])).toEqual([[5, undefined], [5, '"e5"']]);
    expect(c.eventos).toHaveLength(1);
  });
  it("mudança real gera evento com o estado anterior", async () => {
    let v = 1;
    const c = cenario((n) => ({ naoModificado: false, pr: pr(n, { estado: v === 1 ? "aberto" : "mesclado", atualizadoEm: `t${v}` }) }));
    c.alvos([9]);
    await c.at.tick();
    v = 2;
    c.avancar(61_000);
    await c.at.tick();
    const e = c.eventos[1] as Extract<EventoAtualizacao, { tipo: "pr" }>;
    expect(e.pr.estado).toBe("mesclado");
    expect(e.anterior?.estado).toBe("aberto");
  });
  it("erro dispara backoff exponencial (60 s, 120 s, 240 s) e sucesso zera", async () => {
    let falhar = true;
    const c = cenario(() => {
      if (falhar) throw new ForgeRedeErro("x");
      return { naoModificado: true };
    });
    c.alvos([1]);
    c.at.iniciar();
    expect(c.agendados.at(-1)!.ms).toBe(0);
    const esperas: number[] = [];
    for (let i = 0; i < 3; i++) {
      c.agendados.at(-1)!.fn();
      await new Promise((r) => setTimeout(r, 10));
      esperas.push(c.agendados.at(-1)!.ms);
      c.avancar(300_000);
    }
    expect(esperas).toEqual([60_000, 120_000, 240_000]);
    expect(c.eventos.every((e) => e.tipo === "erro")).toBe(true);
    falhar = false;
    c.agendados.at(-1)!.fn();
    await new Promise((r) => setTimeout(r, 10));
    expect(c.at.falhasSeguidas).toBe(0);
    expect(c.agendados.at(-1)!.ms).toBe(60_000);
    c.at.parar();
  });
  it("rate limit: pausa até o reset (por erro, por cabeçalho e por `rate_limit`)", async () => {
    const reset = 1_000_000 / 1000 + 600;
    let modo: "erro" | "cab" = "erro";
    const c = cenario(() => {
      if (modo === "erro") throw new ForgeRateLimitErro(reset);
      return { naoModificado: true, limite: { limite: 5000, restante: 3, reiniciaEm: reset } };
    });
    await c.at.tick();
    expect(c.eventos[0]).toMatchObject({ tipo: "pausa-rate-limit", ate: reset * 1000 + 1000 });
    expect((await c.at.tick()).pulado).toBe("pausa");
    c.avancar(700_000);
    modo = "cab";
    c.alvos([1]);
    await c.at.tick();
    expect(c.eventos.filter((e) => e.tipo === "pausa-rate-limit")).toHaveLength(2);
    const d = cenario(() => ({ naoModificado: true }), () => ({ limite: 5000, restante: 1, reiniciaEm: 1_000_000 / 1000 + 100 }));
    const r = await d.at.tick();
    expect(r.consultados).toEqual([]);
    expect(d.chamadas).toHaveLength(0);
  });
  it("parar cancela a agenda; erro nunca carrega token", async () => {
    const c = cenario(() => {
      throw new Error("falhou ghp_ABCDEFGHIJKLMNOPQRSTUV12345 em https://tok@github.com/a/b");
    });
    c.alvos([1]);
    await c.at.tick();
    expect(JSON.stringify(c.eventos)).not.toMatch(/ghp_|tok@/);
    c.at.iniciar();
    c.at.parar();
    const n = c.agendados.length;
    c.agendados.at(-1)!.fn();
    await new Promise((r) => setTimeout(r, 10));
    expect(c.agendados.length).toBe(n);
  });
});
