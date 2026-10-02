// Perfis de build (T-21.03): o perfil padrão não muda o `files:`; com-atualizacao só tira a exclusão do updater (D-340).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ARQUIVO_DISTRIBUICAO_NO_PACOTE, carregarBase, configParaPerfil, FUSES, gravarConfigDerivada, PADRAO_EXCLUSAO_UPDATER } from "../../scripts/lib/config-builder.mjs";
import { PERFIS } from "../../scripts/lib/distribuicao.mjs";

const RAIZ = resolve(__dirname, "..", "..");
const base = carregarBase(RAIZ);

describe("configParaPerfil", () => {
  it("local e ci produzem exatamente a configuração de hoje (diff zero), sem mutar a base", () => {
    const original = structuredClone(base);
    expect(configParaPerfil(base, "local").config).toEqual(base);
    expect(configParaPerfil(base, "ci").config).toEqual(base);
    expect(configParaPerfil(base, "local").config.files).toEqual(parse(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")).files);
    expect(base).toEqual(original);
  });

  it("o padrão exclui o electron-updater e nenhum perfil sem atualização o inclui", () => {
    for (const p of ["local", "ci", "release", "perf"]) {
      const f = configParaPerfil(base, p).config.files as string[];
      expect(
        f.some((x) => PADRAO_EXCLUSAO_UPDATER.test(x)),
        p,
      ).toBe(true);
    }
  });

  it("com-atualizacao: remove SÓ a exclusão do updater (e das dependências exclusivas dele) e leva o manifesto de build", () => {
    const { config } = configParaPerfil(base, "com-atualizacao", { temUpdater: true });
    const antes = base.files as string[];
    const depois = config.files as string[];
    const removidos = antes.filter((x) => !depois.includes(x));
    expect(removidos).toHaveLength(1);
    expect(removidos[0]).toMatch(/^!node_modules\/\{electron-updater,/);
    expect(depois.filter((x) => !antes.includes(x))).toEqual([ARQUIVO_DISTRIBUICAO_NO_PACOTE]);
    expect({ ...config, files: null }).toEqual({ ...base, files: null }); // nada mais muda (publish, asarUnpack, mac, win...)
    expect(config.publish).toEqual(base.publish);
  });

  it("com-atualizacao falha FECHADO sem a dependência no package.json (hoje ela não está instalada: D-24)", () => {
    const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
    const instalada = Boolean(pkg.dependencies?.["electron-updater"] ?? pkg.optionalDependencies?.["electron-updater"]);
    if (!instalada) expect(() => configParaPerfil(base, "com-atualizacao", { raiz: RAIZ })).toThrow(/electron-updater/);
    else expect(() => configParaPerfil(base, "com-atualizacao", { raiz: RAIZ })).not.toThrow();
  });

  it("com-atualizacao avisa que a dependência sozinha não liga nada quando o build tem habilitada=false (duas chaves)", () => {
    const r = configParaPerfil(base, "com-atualizacao", { temUpdater: true, distribuicao: { atualizacao: { habilitada: false } } });
    expect(r.avisos.join()).toMatch(/duas chaves/);
    expect(configParaPerfil(base, "com-atualizacao", { temUpdater: true, distribuicao: { atualizacao: { habilitada: true } } }).avisos).toEqual([]);
  });

  it("fuses (D-344): RunAsNode permanece ligado em todos os perfis; --inspect só no perf; release o desliga", () => {
    expect(FUSES.release.runAsNode).toBe(true);
    expect(FUSES.perf.runAsNode).toBe(true);
    expect(configParaPerfil(base, "release").config.electronFuses).toEqual({ runAsNode: true, enableNodeCliInspectArguments: false });
    expect(configParaPerfil(base, "perf").config.electronFuses.enableNodeCliInspectArguments).toBe(true);
    expect(configParaPerfil(base, "local").config.electronFuses).toBeUndefined();
  });

  it("release endurece o runtime do macOS e liga a notarização só por gancho que age só com credencial", () => {
    const { config } = configParaPerfil(base, "release", { raiz: RAIZ });
    expect(config.mac.hardenedRuntime).toBe(true);
    if (existsSync(join(RAIZ, "scripts", "notarizar.cjs"))) expect(config.afterSign).toBe("scripts/notarizar.cjs");
    expect(JSON.stringify(config)).not.toMatch(/CSC_|APPLE_ID|APPLE_APP|_PASSWORD/); // nenhum nome de credencial vira valor da configuração
  });

  it("perfil desconhecido é erro e o script de perfil não lê variável de ambiente", () => {
    expect(() => configParaPerfil(base, "producao")).toThrow(/desconhecido/);
    for (const p of PERFIS) expect(() => configParaPerfil(base, p, { temUpdater: true })).not.toThrow();
    const fonte = readFileSync(join(RAIZ, "scripts", "lib", "config-builder.mjs"), "utf8");
    expect(fonte).not.toMatch(/process\.env/);
  });

  it("a configuração derivada é gravada fora da árvore e é YAML válido", () => {
    const destino = gravarConfigDerivada(configParaPerfil(base, "release", { raiz: RAIZ }).config, "release");
    expect(destino.startsWith(RAIZ)).toBe(false);
    expect((parse(readFileSync(destino, "utf8")) as { appId: string }).appId).toBe(base.appId);
  });
});
