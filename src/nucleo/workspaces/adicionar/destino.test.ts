import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";
import { avaliarDestino, dentroDe, mascararCaminho, nomeLivre, paiValido, pastaProjetosPadrao } from "./destino";

let raiz: string;
beforeEach(() => {
  raiz = pastaTmp("adic-dest-");
});
afterEach(() => {
  try { chmodSync(join(raiz, "somente-leitura"), 0o755); } catch { /* não existe */ }
  removerPasta(raiz);
});

describe("avaliarDestino", () => {
  it("livre: o destino não existe", async () => {
    const r = await avaliarDestino(raiz, "novo");
    expect(r).toMatchObject({ ok: true, situacao: "livre", caminho: join(raiz, "novo") });
  });
  it("vazio: pasta existente vazia é aceita (o git clona dentro)", async () => {
    mkdirSync(join(raiz, "vazia"));
    expect(await avaliarDestino(raiz, "vazia")).toMatchObject({ ok: true, situacao: "vazio" });
  });
  it("ocupado: existe e não está vazia → recusa e sugere outro nome (nunca sobrescreve)", async () => {
    mkdirSync(join(raiz, "app"));
    writeFileSync(join(raiz, "app", "x.txt"), "x");
    const r = await avaliarDestino(raiz, "app");
    expect(r).toMatchObject({ ok: false, situacao: "ocupado", sugestao: "app-2" });
    expect(r.motivo).toMatch(/Nada será sobrescrito/);
    mkdirSync(join(raiz, "app-2"));
    writeFileSync(join(raiz, "app-2", "y"), "y");
    expect((await avaliarDestino(raiz, "app")).sugestao).toBe("app-3");
  });
  it("arquivo com o mesmo nome é recusado", async () => {
    writeFileSync(join(raiz, "arq"), "x");
    expect(await avaliarDestino(raiz, "arq")).toMatchObject({ ok: false, situacao: "invalido" });
  });
  it("link simbólico é recusado (mesmo apontando para pasta vazia ou inexistente)", async () => {
    mkdirSync(join(raiz, "alvo"));
    symlinkSync(join(raiz, "alvo"), join(raiz, "elo"));
    symlinkSync(join(raiz, "nao-existe"), join(raiz, "elo-quebrado"));
    for (const n of ["elo", "elo-quebrado"]) {
      const r = await avaliarDestino(raiz, n);
      expect(r.ok).toBe(false);
      expect(r.motivo).toMatch(/link simbólico/);
    }
  });
  it("nome com travessia ou separador nunca vira caminho fora do pai", async () => {
    for (const n of ["../fora", "a/b", "..", ".", "a\\b", "", ".oculta", "-x"]) {
      const r = await avaliarDestino(raiz, n);
      expect(r.ok, n).toBe(false);
      expect(r.caminho).toBeNull();
    }
  });
  it("pai inválido: relativo, com NUL, inexistente, arquivo", async () => {
    writeFileSync(join(raiz, "arquivo"), "x");
    for (const pai of ["relativo/pasta", "/tmp/a\0b", join(raiz, "nao-existe"), join(raiz, "arquivo"), "/tmp/../etc"]) {
      expect((await avaliarDestino(pai, "x")).ok, pai).toBe(false);
    }
  });
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("pai sem permissão de escrita", async () => {
    mkdirSync(join(raiz, "somente-leitura"));
    chmodSync(join(raiz, "somente-leitura"), 0o555);
    const r = await avaliarDestino(join(raiz, "somente-leitura"), "x");
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/permissão/i);
  });
});

describe("dentroDe (fora de raiz)", () => {
  it("compara segmentos, nunca prefixo de texto", () => {
    expect(dentroDe("/a/b", "/a/b/c")).toBe(true);
    expect(dentroDe("/a/b", "/a/b")).toBe(true);
    expect(dentroDe("/a/b", "/a/bc")).toBe(false);
    expect(dentroDe("/a/b", "/a/b/../c")).toBe(false);
    expect(dentroDe("/a/b/", "/a/b/x")).toBe(true);
  });
});

describe("paiValido / mascararCaminho / pasta padrão", () => {
  it("só absoluto e normalizado", () => {
    expect(paiValido("/Users/x/projetos")).toBe(true);
    expect(paiValido("/Users/x/projetos/")).toBe(true);
    for (const p of ["", "x", "./x", "/a/../b", "/a/./b", "/a\0", 3, null]) expect(paiValido(p)).toBe(false);
  });
  it("mascara a pasta pessoal como ~", () => {
    expect(mascararCaminho("/Users/ana", "/Users/ana")).toBe("~");
    expect(mascararCaminho("/Users/ana/orca/projects/x", "/Users/ana")).toBe("~/orca/projects/x");
    expect(mascararCaminho("/Users/anabela/x", "/Users/ana")).toBe("/Users/anabela/x");
    expect(mascararCaminho("/opt/x", "/Users/ana")).toBe("/opt/x");
  });
  it("padrão: ~/orca/projects, senão ~/Developer, senão ~", async () => {
    const casa = raiz;
    expect(await pastaProjetosPadrao(casa)).toBe(casa);
    mkdirSync(join(casa, "Developer"));
    expect(await pastaProjetosPadrao(casa)).toBe(join(casa, "Developer"));
    mkdirSync(join(casa, "orca", "projects"), { recursive: true });
    expect(await pastaProjetosPadrao(casa)).toBe(join(casa, "orca", "projects"));
  });
  it("nomeLivre acha o primeiro nome vago", async () => {
    mkdirSync(join(raiz, "p-2"));
    expect(await nomeLivre(raiz, "p")).toBe("p-3");
  });
});
