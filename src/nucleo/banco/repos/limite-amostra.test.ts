import { afterEach, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { abrirBanco, migrar, type Banco } from "../index";
import { criarRepositorios } from "./index";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const r = criarRepositorios(b);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const conta = r.conta.criar({ provedor: "claude", rotulo: "c1" });
  return { b, r, ws, conta };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

import type { AmostraComFonte } from "./limite-amostra";

const hora = (h: number) => new Date(Date.UTC(2026, 0, 1) + h * 3_600_000).toISOString();
const am = (conta: string, h: number, pct: number, extra: Partial<AmostraComFonte> = {}): AmostraComFonte => ({ conta_id: conta, janela: "weekly", balde: "", ts: hora(h), usado_pct: pct, reinicia_em: null, fonte: "codex_rollout", ...extra });

describe("repo limite-amostra", () => {
  it("grava o lote numa transação (duplicata ignorada), consulta em ordem e devolve a última", () => {
    const { r, conta } = novo();
    expect(r.limiteAmostra.gravarLote([am(conta.id, 0, 10), am(conta.id, 1, 20), am(conta.id, 1, 99)])).toBe(2);
    expect(r.limiteAmostra.gravarLote([])).toBe(0);
    const s = r.limiteAmostra.consultar({ conta_id: conta.id, janela: "weekly", desde: hora(0), ate: hora(5), max_pontos: 300 });
    expect(s.map((x) => x.usado_pct)).toEqual([10, 20]);
    expect(r.limiteAmostra.ultima(conta.id, "weekly")?.usado_pct).toBe(20);
    expect(r.limiteAmostra.ultima(conta.id, "five_hour")).toBeUndefined();
  });

  it("lote inválido faz rollback inteiro; balde só combina com janela modelo; 0..100", () => {
    const { r, conta } = novo();
    expect(() => r.limiteAmostra.gravarLote([am(conta.id, 0, 10), am(conta.id, 1, 150)])).toThrow(ValorInvalidoErro);
    expect(r.limiteAmostra.ultima(conta.id, "weekly")).toBeUndefined();
    expect(() => r.limiteAmostra.gravarLote([am(conta.id, 0, 10, { balde: "opus" })])).toThrow(ValorInvalidoErro);
    expect(() => r.limiteAmostra.gravarLote([am(conta.id, 0, 10, { janela: "modelo", balde: "" })])).toThrow(ValorInvalidoErro);
    expect(r.limiteAmostra.gravarLote([am(conta.id, 0, 10, { janela: "modelo", balde: "opus" })])).toBe(1);
    expect(r.limiteAmostra.consultar({ conta_id: conta.id, janela: "modelo", balde: "opus", desde: hora(0), ate: hora(1), max_pontos: 10 })).toHaveLength(1);
    expect(() => r.limiteAmostra.consultar({ conta_id: conta.id, janela: "weekly", desde: hora(0), ate: hora(1), max_pontos: 301 })).toThrow(ValorInvalidoErro);
  });

  it("decimação em SQL: ≤ max_pontos, mantém o último ponto e a ordem", () => {
    const { r, conta } = novo();
    const lote = Array.from({ length: 1000 }, (_, i) => am(conta.id, i, i % 100));
    r.limiteAmostra.gravarLote(lote);
    for (const max of [300, 7, 1]) {
      const s = r.limiteAmostra.consultar({ conta_id: conta.id, janela: "weekly", desde: hora(0), ate: hora(2000), max_pontos: max });
      expect(s.length, String(max)).toBeLessThanOrEqual(max);
      expect(s[s.length - 1]!.ts).toBe(hora(999));
      expect([...s].map((x) => x.ts)).toEqual([...s].map((x) => x.ts).sort());
    }
    const dentro = r.limiteAmostra.consultar({ conta_id: conta.id, janela: "weekly", desde: hora(10), ate: hora(19), max_pontos: 300 });
    expect(dentro).toHaveLength(10);
  });

  it("retenção apaga o antigo; eficiência semanal guarda o MAIOR pico e acumula estouro (permanente)", () => {
    const { r, conta } = novo();
    r.limiteAmostra.gravarLote([am(conta.id, 0, 10), am(conta.id, 100, 20)]);
    expect(r.limiteAmostra.podar(hora(50))).toBe(1);
    const base = { semana_inicio: "2026-01-05", conta_id: conta.id, janela: "weekly" as const, estouro_precoce: false };
    r.limiteAmostra.registrarSemana({ ...base, pico_pct: 60, estourou: false, amostras: 10 });
    const s = r.limiteAmostra.registrarSemana({ ...base, pico_pct: 40, estourou: true, estouro_precoce: true, amostras: 5 });
    expect(s).toMatchObject({ pico_pct: 60, estourou: true, estouro_precoce: true, amostras: 15 });
    r.limiteAmostra.registrarSemana({ ...base, semana_inicio: "2026-01-12", pico_pct: 95, estourou: false, amostras: 3 });
    expect(r.limiteAmostra.listarSemanas(1, conta.id).map((x) => x.semana_inicio)).toEqual(["2026-01-12"]);
    expect(r.limiteAmostra.listarSemanas(26).map((x) => x.semana_inicio)).toEqual(["2026-01-12", "2026-01-05"]);
    expect(() => r.limiteAmostra.registrarSemana({ ...base, janela: "monthly" as never, pico_pct: 1, estourou: false, amostras: 1 })).toThrow(ValorInvalidoErro);
    expect(() => r.limiteAmostra.listarSemanas(27)).toThrow(ValorInvalidoErro);
  });

  it("P-109: gravar lote de 10 contas e consultar 30 dias decimado ficam rápidos", () => {
    const { r, b } = novo();
    const contas = Array.from({ length: 10 }, (_, i) => r.conta.criar({ provedor: "claude", rotulo: `c${i}` }));
    // 10 contas × 90 dias × 1 amostra/hora (mudanças) ≈ 21 600 linhas
    b.transacao(() => {
      for (const c of contas) r.limiteAmostra.gravarLote(Array.from({ length: 90 * 24 }, (_, i) => am(c.id, i, (i * 7) % 100)));
    });
    const tg: number[] = [];
    const tc: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      r.limiteAmostra.gravarLote([am(contas[0]!.id, 90 * 24 + i, 50)]);
      tg.push(performance.now() - t0);
      const t1 = performance.now();
      r.limiteAmostra.consultar({ conta_id: contas[3]!.id, janela: "weekly", desde: hora(60 * 24), ate: hora(90 * 24), max_pontos: 300 });
      tc.push(performance.now() - t1);
    }
    expect(mediana(tg)).toBeLessThanOrEqual(2);
    expect(mediana(tc)).toBeLessThanOrEqual(20);
  });
});
