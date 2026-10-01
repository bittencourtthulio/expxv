import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarPreferencias } from "./preferencias";
import { criarMarcasPerf } from "./perf";
import { preferenciaValida, resolverTema } from "./tema";

describe("preferências", () => {
  it("grava atômico e relê em outra instância", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "prefs-"));
    const a = criarPreferencias(pasta);
    await a.definir("tema_preferencia", "escuro");
    await a.definir("scrollback", 5000);
    const b = criarPreferencias(pasta);
    expect(b.obter("tema_preferencia")).toBe("escuro");
    expect(b.obter("scrollback")).toBe(5000);
    expect(b.obter("nao_existe")).toBeNull();
    expect(JSON.parse(readFileSync(join(pasta, "preferencias.json"), "utf8"))).toMatchObject({ scrollback: 5000 });
  });

  it("arquivo corrompido ou com forma errada vira vazio, sem lançar", () => {
    const pasta = mkdtempSync(join(tmpdir(), "prefs-"));
    writeFileSync(join(pasta, "preferencias.json"), "{ isto nao e json");
    expect(criarPreferencias(pasta).lerSync()).toEqual({});
    writeFileSync(join(pasta, "preferencias.json"), "[1,2,3]");
    expect(criarPreferencias(pasta).lerSync()).toEqual({});
  });
});

describe("preferências: falha de escrita (AUD-07)", () => {
  it("uma escrita que falha não envenena as seguintes; a falha vai ao chamador DAQUELA escrita e o cache não mente", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "prefs-"));
    const alvo = join(pasta, "preferencias.json");
    mkdirSync(alvo); // o rename sobre uma pasta falha: simula disco cheio/permissão
    const p = criarPreferencias(pasta);
    await expect(p.definir("a", 1)).rejects.toThrow();
    expect(p.obter("a")).toBeNull(); // não diz que gravou o que não gravou
    expect(readdirSync(pasta).filter((n) => n.endsWith(".tmp"))).toEqual([]); // sem lixo
    rmSync(alvo, { recursive: true });
    await p.definir("b", 2); // o problema passou: a próxima escrita tenta de novo
    expect(JSON.parse(readFileSync(alvo, "utf8"))).toEqual({ b: 2 });
    expect(criarPreferencias(pasta).obter("b")).toBe(2);
  });

  it("depois de uma falha, escritas concorrentes seguem em ordem e a última vale", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "prefs-"));
    const alvo = join(pasta, "preferencias.json");
    mkdirSync(alvo);
    const p = criarPreferencias(pasta);
    await expect(p.definir("x", 1)).rejects.toThrow();
    rmSync(alvo, { recursive: true });
    const escritas = [p.definir("y", 2), p.definir("y", 3), p.definir("z", 4)];
    await Promise.all(escritas);
    expect(existsSync(alvo)).toBe(true);
    expect(JSON.parse(readFileSync(alvo, "utf8"))).toEqual({ y: 3, z: 4 });
  });

  it("AUD-28: a chave __proto__ vira dado comum, nunca troca o protótipo", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "prefs-"));
    const p = criarPreferencias(pasta);
    await p.definir("__proto__", { admin: true });
    expect(({} as Record<string, unknown>)["admin"]).toBeUndefined();
    expect(p.obter("__proto__")).toEqual({ admin: true });
    expect(p.obter("admin")).toBeNull();
    expect(criarPreferencias(pasta).obter("__proto__")).toEqual({ admin: true });
  });
});

describe("tema", () => {
  it("resolve sistema pelo modo do SO e respeita escolha explícita", () => {
    expect(resolverTema("sistema", true)).toBe("escuro");
    expect(resolverTema("sistema", false)).toBe("claro");
    expect(resolverTema("claro", true)).toBe("claro");
    expect(resolverTema("escuro", false)).toBe("escuro");
  });

  it("preferência inválida vira sistema", () => {
    expect(preferenciaValida("roxo")).toBe("sistema");
    expect(preferenciaValida(null)).toBe("sistema");
    expect(preferenciaValida("claro")).toBe("claro");
  });
});

describe("marcas de perf", () => {
  it("mede desde o início do processo, ignora duplicada e nome inválido", () => {
    let agora = 1000;
    const m = criarMarcasPerf(900, () => agora);
    m.marcar("janela:visivel");
    agora = 2000;
    m.marcar("janela:visivel");
    m.marcar("");
    expect(m.ler()).toEqual({ janelaVisivelMs: 100, marcas: { "janela:visivel": 100 } });
  });
});
