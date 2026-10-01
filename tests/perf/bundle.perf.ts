// P-08: JavaScript inicial do renderer ≤ 350 KB gzip (só o que o index.html referencia; xterm, grafo e telas
// pesadas ficam em chunks lazy). Mede com scripts/tamanho-bundle.mjs (--json) sobre dist/renderer e registra
// em docs/ade/perf/ultimo.json. Determinístico: o fator de tolerância não se aplica (semFator).
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { gravarMedicoes, registrar } from "./registro";

afterAll(() => gravarMedicoes());

describe("P-08: JavaScript inicial do renderer", () => {
  it("≤ 350 KB gzip", () => {
    const saida = execFileSync("node", [resolve(__dirname, "../../scripts/tamanho-bundle.mjs"), "--json"], { encoding: "utf8" });
    const { kb, arquivos } = JSON.parse(saida.trim().split("\n").at(-1) as string) as { kb: number; arquivos: number };
    expect(arquivos, "nenhum JS referenciado no index.html (rode `npm run build`)").toBeGreaterThan(0);
    const m = registrar({ id: "P-08", descricao: "JS inicial do renderer (gzip)", valor: kb, limite: 350, unidade: "KB", semFator: true });
    console.log(`P-08 JS inicial gzip: ${m.valor} KB em ${arquivos} arquivo(s)`);
    expect(m.ok, `${m.valor} KB > ${m.limite} KB`).toBe(true);
  });
});
