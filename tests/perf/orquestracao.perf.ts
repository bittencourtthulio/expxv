import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "../fixtures/mcp/ambiente-orq";
import { gravarMedicoes, percentil, registrar } from "./registro";

let amb: AmbienteOrq;

beforeAll(async () => {
  amb = await criarAmbienteOrq();
}, 120_000);

afterAll(async () => {
  gravarMedicoes();
  await amb?.fechar();
});

describe("orçamentos da orquestração", () => {
  it("P-15: delegação 1+1 com CLI falsa (pane_spawn → wake no piloto) p50 ≤ 2 s", async () => {
    const tempos: number[] = [];
    // a 1ª rodada aquece (primeiro `node` com o SDK no disco, cache do sistema) e não entra na mediana
    for (let rodada = 0; rodada < 6; rodada++) {
      const missao = await amb.iniciarMissao(`Delegação ${rodada}`, {
        esperar_wake: true,
        chamadas: [amb.spawnWorker({ worker: "handoff", resumo: "2" })],
      });
      const { spawn, wake } = await esperar(async () => {
        const ev = await amb.eventos(missao.id);
        const s = ev.find((l) => l.evento === "chamada" && l.tool === "pane_spawn");
        const w = ev.find((l) => l.evento === "wake");
        return s !== undefined && w !== undefined ? { spawn: s, wake: w } : undefined;
      }, 30_000);
      expect(spawn["ok"]).toBe(true);
      if (rodada > 0) tempos.push(wake.t - (spawn["t0"] as number));
      await amb.abortarCriadas();
    }
    const p50 = percentil(tempos, 50);
    const m = registrar({ id: "P-15", descricao: "delegação 1+1 com CLI falsa (p50)", valor: p50, limite: 2000, unidade: "ms" });
    console.log(`P-15 tempos (ms): ${tempos.map(Math.round).join(", ")} → p50 ${m.valor}`);
    expect(m.ok, `p50 ${m.valor} ms > ${m.limite} ms`).toBe(true);
  }, 180_000);
});
