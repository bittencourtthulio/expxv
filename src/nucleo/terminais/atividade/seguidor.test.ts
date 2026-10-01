import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SeguidorArquivo } from "./seguidor";

const pastas: string[] = [];
const arquivo = (): string => { const p = mkdtempSync(join(tmpdir(), "seguidor-")); pastas.push(p); return join(p, "t.jsonl"); };
afterEach(() => { pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })); });

describe("SeguidorArquivo", () => {
  it("entrega só linhas completas novas, uma vez, mesmo com escrita em pedaços", async () => {
    const a = arquivo();
    const recebidas: string[] = [];
    const s = new SeguidorArquivo({ arquivo: a, aoLinhas: (l) => recebidas.push(...l) });
    await s.sincronizar(); // ainda não existe
    writeFileSync(a, "um\ndo");
    await s.sincronizar();
    expect(recebidas).toEqual(["um"]);
    appendFileSync(a, "is\ntrês\n");
    await s.sincronizar();
    await s.sincronizar();
    expect(recebidas).toEqual(["um", "dois", "três"]);
  });
  it("parar() faz a última leitura, inclusive linha final sem quebra", async () => {
    const a = arquivo();
    writeFileSync(a, "a\nfinal-sem-quebra");
    const recebidas: string[] = [];
    const s = new SeguidorArquivo({ arquivo: a, aoLinhas: (l) => recebidas.push(...l), intervalo_ms: 5000 });
    await s.parar();
    expect(recebidas).toEqual(["a", "final-sem-quebra"]);
  });
  it("arquivo que encolhe recomeça do início", async () => {
    const a = arquivo();
    writeFileSync(a, "aaaa\nbbbb\n");
    const r: string[] = [];
    const s = new SeguidorArquivo({ arquivo: a, aoLinhas: (l) => r.push(...l) });
    await s.sincronizar();
    writeFileSync(a, "c\n");
    await s.sincronizar();
    expect(r).toEqual(["aaaa", "bbbb", "c"]);
  });
});
