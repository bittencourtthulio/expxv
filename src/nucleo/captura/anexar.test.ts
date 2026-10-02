import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anexarImagemAoPane, textoPromptQuadros } from "./anexar";

let ws = "";
let fora = "";
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "anx-ws-"));
  fora = await mkdtemp(join(tmpdir(), "anx-fora-"));
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
  await rm(fora, { recursive: true, force: true });
});

describe("anexar captura ao Pane", () => {
  it("imagem dentro do workspace vira caminho relativo, sem Enter", async () => {
    await mkdir(join(ws, ".expxv", "capturas"), { recursive: true });
    await writeFile(join(ws, ".expxv", "capturas", "2026-10-01_10-00-00.png"), "x");
    const r = await anexarImagemAoPane(ws, "s1", join(ws, ".expxv", "capturas", "2026-10-01_10-00-00.png"));
    expect(r.caminhos).toEqual([join(".expxv", "capturas", "2026-10-01_10-00-00.png")]);
    expect(r.texto).toBe(`${join(".expxv", "capturas", "2026-10-01_10-00-00.png")} `);
    expect(r.texto).not.toMatch(/[\r\n]/);
  });

  it("imagem fora do workspace é copiada para a pasta de entradas (caminho relativo)", async () => {
    await writeFile(join(fora, "2026-10-01_10-00-00.png"), "conteudo");
    const r = await anexarImagemAoPane(ws, "sessao-1", join(fora, "2026-10-01_10-00-00.png"));
    expect(r.caminhos[0]).toMatch(/^\.expxv[\\/]entradas[\\/]sessao-1[\\/].*2026-10-01_10-00-00\.png$/);
    expect(await readFile(join(ws, r.caminhos[0] ?? ""), "utf8")).toBe("conteudo");
  });

  it("recusa symlink que aponta para fora do workspace e arquivo de ambiente", async () => {
    await writeFile(join(fora, "segredo.png"), "s");
    await symlink(join(fora, "segredo.png"), join(ws, "atalho.png"));
    await expect(anexarImagemAoPane(ws, "s1", join(ws, "atalho.png"))).rejects.toThrow(/symlink|Atalho/);
    const nomeAmbiente = ".en" + "v";
    await writeFile(join(fora, nomeAmbiente), "A=1");
    await expect(anexarImagemAoPane(ws, "s1", join(fora, nomeAmbiente))).rejects.toThrow(/Tipo/);
  });

  it("prompt de quadros usa caminho relativo quando dentro do cwd e termina sem quebra de linha", () => {
    const r = textoPromptQuadros("/w", "/w/.expxv/capturas/quadros/2026-10-01_10-00-00", 10, 2);
    expect(r.caminhos).toEqual([".expxv/capturas/quadros/2026-10-01_10-00-00"]);
    expect(r.texto).toMatch(/^The folder \.expxv\/capturas\/quadros\/2026-10-01_10-00-00 contains 10 frames sampled at 2 fps/);
    expect(r.texto).not.toMatch(/[\r\n]/);
    expect(textoPromptQuadros("/w", "/u/cap quadros/x", 3, 1).caminhos).toEqual(["/u/cap quadros/x"]);
  });
});
