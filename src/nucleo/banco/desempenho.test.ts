import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { abrirBanco, type Banco } from "./banco";
import { migrar } from "./migrar";
import { agora } from "./tempo";
import { gerarId } from "./ids";

let banco: Banco | undefined;
let pasta: string | undefined;
afterEach(() => {
  banco?.fechar();
  banco = undefined;
  if (pasta) rmSync(pasta, { recursive: true, force: true });
  pasta = undefined;
});

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

describe("P-14: consulta quente ao banco ≤ 5 ms", () => {
  it("mediana de 50 execuções com 10 000 linhas em evento_dominio", () => {
    pasta = mkdtempSync(join(tmpdir(), "expxv-perf-"));
    banco = abrirBanco(join(pasta, "p.db"));
    migrar(banco);
    const tipos = ["pane_criado", "pane_encerrado", "mission_criada", "task_entregue", "handoff_criado"];
    banco.transacao((tx) => {
      const ins = tx.preparar("INSERT INTO evento_dominio (id,tipo,payload_json,criado_em) VALUES (?,?,?,?)");
      for (let i = 0; i < 10_000; i++) {
        ins.executar([gerarId("evento", 1_700_000_000_000 + i), tipos[i % tipos.length] as string, '{"x":1}', agora(new Date(1_700_000_000_000 + i * 1000))]);
      }
    });
    expect(banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM evento_dominio")?.n).toBe(10_000);

    const consulta = banco.preparar("SELECT id,tipo,payload_json,criado_em FROM evento_dominio WHERE tipo = ? ORDER BY criado_em DESC LIMIT 50");
    const porJanela = banco.preparar("SELECT COUNT(*) AS n FROM evento_dominio WHERE criado_em < ?");
    const tempos: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const linhas = consulta.consultar(["task_entregue"]);
      porJanela.consultarUm(["2023-11-14T00:00:00.000Z"]);
      tempos.push(performance.now() - t0);
      expect(linhas).toHaveLength(50);
    }
    expect(mediana(tempos)).toBeLessThanOrEqual(5);
  });

  it("usa índice (sem varredura) na consulta quente", () => {
    banco = abrirBanco(":memory:");
    migrar(banco);
    const plano = banco
      .consultar<{ detail: string }>("EXPLAIN QUERY PLAN SELECT * FROM evento_dominio WHERE tipo = ? ORDER BY criado_em DESC LIMIT 50", ["x"])
      .map((p) => p.detail)
      .join(" | ");
    expect(plano).toMatch(/USING (COVERING )?INDEX/);
    expect(plano).not.toMatch(/SCAN evento_dominio/);
  });
});
