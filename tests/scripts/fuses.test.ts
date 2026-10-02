// T-21.07 / AU-22: fuses conferidos no binário. RunAsNode permanece ligado (o daemon, os hooks e o MCP dependem); release desliga o --inspect; perf o mantém (Playwright).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { carregarBase, configParaPerfil, FUSES } from "../../scripts/lib/config-builder.mjs";
import { conferirFuses, fusesEsperados, verificarFuses } from "../../scripts/lib/fuses.mjs";

const RAIZ = resolve(__dirname, "..", "..");
const fio = (o: Record<number, number>) => ({ version: "1", 0: 49, 1: 48, 2: 49, 3: 49, 4: 48, 5: 48, 6: 48, 7: 49, ...o });

describe("fuses por perfil (au22_fuses_conferidos)", () => {
  it("RunAsNode está ligado em TODOS os perfis exigidos e a configuração derivada concorda com o conferidor", () => {
    for (const p of ["local", "ci", "release", "perf", "com-atualizacao"]) expect(fusesEsperados(p).runAsNode, p).toBe(true);
    expect(FUSES.release.runAsNode && FUSES.perf.runAsNode).toBe(true);
    const base = carregarBase(RAIZ);
    expect(configParaPerfil(base, "release").config.electronFuses).toEqual(fusesEsperados("release"));
    expect(configParaPerfil(base, "perf").config.electronFuses).toEqual(fusesEsperados("perf"));
  });

  it("conferirFuses detecta RunAsNode desligado (quebraria o daemon) e --inspect ligado no release", () => {
    expect(conferirFuses(fio({ 0: 48 }), "local")).toEqual({ ok: false, divergencias: [{ fuse: "runAsNode", esperado: "ligado", atual: "desligado" }] });
    expect(conferirFuses(fio({}), "release").divergencias).toEqual([{ fuse: "enableNodeCliInspectArguments", esperado: "desligado", atual: "ligado" }]);
    expect(conferirFuses(fio({ 3: 48 }), "release").ok).toBe(true);
    expect(conferirFuses(fio({}), "perf").ok).toBe(true);
    expect(conferirFuses(fio({ 3: 48 }), "perf").ok).toBe(false);
    expect(conferirFuses(fio({ 0: 114 }), "local").divergencias[0]?.atual).toBe("ausente");
  });

  it("verificarFuses usa o leitor injetado (sem tocar em binário)", async () => {
    expect((await verificarFuses("/nao/importa", "release", async () => fio({ 3: 48 }))).ok).toBe(true);
  });

  const pacote = ["mac-universal", "mac-arm64"].map((d) => join(RAIZ, "dist-app", d, "ExpxV.app")).find((p) => existsSync(p));
  it.skipIf(pacote === undefined)("no pacote local real (somente leitura): o perfil local passa e o release FALHA com a lista, porque o pacote local não aplica fuses", async () => {
    const local = spawnSync("node", [join(RAIZ, "scripts", "verificar-fuses.mjs"), "--perfil", "local", "--app", pacote as string], { encoding: "utf8" });
    expect(local.status, local.stderr).toBe(0);
    const release = spawnSync("node", [join(RAIZ, "scripts", "verificar-fuses.mjs"), "--perfil", "release", "--app", pacote as string], { encoding: "utf8" });
    expect(release.status).toBe(1);
    expect(release.stderr).toMatch(/enableNodeCliInspectArguments: esperado desligado, encontrado ligado/);
  });

  it("sem pacote e sem --app a CLI falha com mensagem clara (sem lançar)", () => {
    const r = spawnSync("node", [join(RAIZ, "scripts", "verificar-fuses.mjs"), "--app", join(RAIZ, "nao-existe.app")], { encoding: "utf8" });
    expect(r.status).toBe(1);
  });
});
