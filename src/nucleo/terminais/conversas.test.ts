import { mkdtempSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarArmazemConversas, MAX_CONVERSAS } from "./conversas";

const pasta = () => mkdtempSync(join(tmpdir(), "conversas-"));

describe("ArmazemConversas", () => {
  it("grava, lê e apaga", () => {
    const a = criarArmazemConversas(pasta(), "/raiz");
    a.gravar("sessao_a", "claude", "c-1");
    expect(a.listar()).toEqual({ sessao_a: "c-1" });
    a.gravar("sessao_a", "claude", "c-2");
    expect(a.listar()).toEqual({ sessao_a: "c-2" });
    a.apagar("sessao_a");
    expect(a.listar()).toEqual({});
  });
  it("raízes diferentes não se misturam", () => {
    const dir = pasta();
    criarArmazemConversas(dir, "/a").gravar("sessao_a", "claude", "c-1");
    expect(criarArmazemConversas(dir, "/b").listar()).toEqual({});
  });
  it("a 201ª entrada tira a mais antiga", () => {
    let t = 0;
    const a = criarArmazemConversas(pasta(), "/raiz", () => ++t);
    for (let i = 0; i <= MAX_CONVERSAS; i++) a.gravar(`sessao_${i}`, "codex", `c${i}`);
    const l = a.listar();
    expect(Object.keys(l)).toHaveLength(MAX_CONVERSAS);
    expect(l["sessao_0"]).toBeUndefined();
    expect(l[`sessao_${MAX_CONVERSAS}`]).toBe(`c${MAX_CONVERSAS}`);
  });
  it("id inválido é ignorado e arquivo corrompido lê vazio", () => {
    const dir = pasta();
    const a = criarArmazemConversas(dir, "/raiz");
    a.gravar("sessao_a", "claude", "tem espaço");
    expect(a.listar()).toEqual({});
    a.gravar("sessao_a", "claude", "ok");
    writeFileSync(join(dir, readdirSync(dir)[0]!), "{lixo");
    expect(a.listar()).toEqual({});
  });
  it.skipIf(process.platform === "win32")("arquivo 0600", () => {
    const dir = pasta();
    criarArmazemConversas(dir, "/raiz").gravar("sessao_a", "claude", "c");
    expect(statSync(join(dir, readdirSync(dir)[0]!)).mode & 0o777).toBe(0o600);
  });
});
