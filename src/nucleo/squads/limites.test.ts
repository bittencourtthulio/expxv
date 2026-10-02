import { describe, expect, it } from "vitest";
import { MAX_PANES_PARALELOS } from "../orquestracao/regras";
import { limiteEfetivoDaSquad, podeInvocar } from "./limites";

const base = { max_instancias_membro: 2, max_instancias_paralelas_squad: 4, vivos_do_membro: 0, vivos_da_squad: 0, vivos_globais: 0, max_global: MAX_PANES_PARALELOS };

describe("podeInvocar: instâncias por membro, por squad e global", () => {
  it.each([
    ["livre", {}, true, null],
    ["membro cheio", { vivos_do_membro: 2, vivos_da_squad: 2 }, false, "membro"],
    ["squad cheia (membros diferentes)", { vivos_da_squad: 4 }, false, "squad"],
    ["global cheio", { vivos_globais: 8, max_global: 8 }, false, "global"],
    ["squad com limite maior que o global: o global manda", { max_instancias_paralelas_squad: 8, vivos_da_squad: 3, vivos_globais: 3, max_global: 3 }, false, "global"],
    ["um a menos que o teto passa", { vivos_do_membro: 1, vivos_da_squad: 3, vivos_globais: 7 }, true, null],
    ["membro de 1 instância ocupado", { max_instancias_membro: 1, vivos_do_membro: 1 }, false, "membro"],
  ] as const)("%s", (_nome, extra, ok, motivo) => {
    const r = podeInvocar({ ...base, ...extra });
    expect(r.ok).toBe(ok);
    if (!r.ok) {
      expect(r.motivo).toBe(motivo);
      expect(r.mensagem).toMatch(/limite/i);
    }
  });

  it("encerrar libera a vaga (contagem menor volta a passar)", () => {
    expect(podeInvocar({ ...base, vivos_do_membro: 2 }).ok).toBe(false);
    expect(podeInvocar({ ...base, vivos_do_membro: 1 }).ok).toBe(true);
  });

  it("ordem de reporte: membro antes de squad antes de global", () => {
    const r = podeInvocar({ ...base, vivos_do_membro: 2, vivos_da_squad: 4, vivos_globais: 8 });
    expect(r).toMatchObject({ ok: false, motivo: "membro" });
  });
});

describe("limiteEfetivoDaSquad", () => {
  it("é o menor entre o da squad, o pedido na caixa de prompt e o global", () => {
    expect(limiteEfetivoDaSquad(4, null, 8)).toBe(4);
    expect(limiteEfetivoDaSquad(6, 2, 8)).toBe(2);
    expect(limiteEfetivoDaSquad(6, 7, 5)).toBe(5);
    expect(limiteEfetivoDaSquad(6, 0, 8)).toBe(1); // nunca abaixo de 1
  });
});
