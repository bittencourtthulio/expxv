// Cofre no ponto de montagem das variáveis do Pane (Fase 9, T-09.22).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ambienteDoCofre, ambienteSeguro, definirScrubDoAmbiente, removerSegredosDoAmbiente } from "./ambiente";

const VALOR = "valor-secreto-do-cofre-123456";
const scrub = (t: string): string => t.replaceAll(VALOR, "«cofre:CHAVE»");
const exe = { caminho: process.execPath };

describe("cofre no ambiente do Pane", () => {
  it("ambienteDoCofre: sem `injetar` o cofre NEM é consultado; com `injetar` devolve o que o cofre entrega (só não sensível)", async () => {
    let consultas = 0;
    const cofre = { ambienteDoPane: async (_ws: string | null, injetar: boolean) => ((consultas++, injetar ? { REGIAO: "sa-east-1" } : {})) };
    expect(await ambienteDoCofre(cofre, { workspace_id: "ws_1", injetar: false })).toEqual({});
    expect(consultas).toBe(0);
    expect(await ambienteDoCofre(cofre, { workspace_id: "ws_1", injetar: true })).toEqual({ REGIAO: "sa-east-1" });
    expect(consultas).toBe(1);
  });

  it("removerSegredosDoAmbiente tira a variável cujo valor é do cofre (inclusive embutido noutro texto) e mantém o resto; scrubber que falha não derruba", () => {
    const vars = { A: VALOR, B: `prefixo-${VALOR}-sufixo`, C: "normal", PATH: "/usr/bin" };
    expect(removerSegredosDoAmbiente(vars, scrub)).toEqual({ C: "normal", PATH: "/usr/bin" });
    expect(
      removerSegredosDoAmbiente(vars, () => {
        throw new Error("boom");
      }),
    ).toEqual(vars);
  });

  it("ambienteSeguro aplica o scrubber ligado pelo main (a opção `scrub` vence); desligado volta ao normal", () => {
    const origem: NodeJS.ProcessEnv = { PATH: "/usr/bin", TOKEN_VAZADO: VALOR, HOME: "/h" };
    const inicio = mkdtempSync(join(tmpdir(), "amb-cofre-"));
    try {
      expect(ambienteSeguro(exe, { origem, inicio })["TOKEN_VAZADO"]).toBe(VALOR);
      definirScrubDoAmbiente(scrub);
      const com = ambienteSeguro(exe, { origem, inicio });
      expect(com["TOKEN_VAZADO"]).toBeUndefined();
      expect(com["HOME"]).toBe("/h");
      expect(ambienteSeguro(exe, { origem, inicio, scrub: null })["TOKEN_VAZADO"]).toBe(VALOR);
    } finally {
      definirScrubDoAmbiente(null);
    }
    expect(ambienteSeguro(exe, { origem, inicio })["TOKEN_VAZADO"]).toBe(VALOR);
  });
});
