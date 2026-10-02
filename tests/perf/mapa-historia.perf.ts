// P-249 (Fase 17, T-17.22): história git do mapa. Janela padrão (20 000 commits) ≤ 3 s; 50 000 commits ≤ 8 s.
// Repositório sintético do gerador de `tests/fixtures/vcs`. Máquina compartilhada: vale o MELHOR de 3 execuções.
import { afterAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { gerarRepo } from "../fixtures/vcs/gerar";
import { isolarConfigGit, pastaTmp, removerPasta } from "../fixtures/vcs/repos";
import { coletarHistoria } from "../../src/nucleo/mapa/git-historia";
import { gravarMedicoes, registrar } from "./registro";

const pastas: string[] = [];
afterAll(() => {
  gravarMedicoes();
  for (const p of pastas.splice(0)) removerPasta(p);
});

async function medir(commits: number, id: string, limiteS: number): Promise<void> {
  isolarConfigGit();
  const base = pastaTmp("mapa-hist-perf-");
  pastas.push(base);
  const r = await gerarRepo(join(base, "r"), { arquivos: 2000, commits, alteracoesPorCommit: 4 });
  const agora = new Date(1_700_000_000_000 + (commits + 10) * 1000);
  let melhor = Infinity;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const h = await coletarHistoria({ raiz: r.dir, agora, maxCommits: commits + 100, janelaDias: 3650 });
    melhor = Math.min(melhor, performance.now() - t0);
    n = h.commits;
  }
  expect(n).toBe(commits);
  const m = registrar({ id, descricao: `História git de ${commits} commits (churn, autores, acoplamento)`, valor: melhor / 1000, limite: limiteS, unidade: "s" });
  console.log(`${id}: ${commits} commits em ${(melhor / 1000).toFixed(2)} s (limite ${m.limite} s)`);
  expect(m.ok).toBe(true);
}

describe("P-249 história git do mapa", () => {
  it("20 000 commits (janela padrão) ≤ 3 s", async () => medir(20_000, "P-249a", 3), 300_000);
  it("50 000 commits ≤ 8 s", async () => medir(50_000, "P-249b", 8), 600_000);
});
