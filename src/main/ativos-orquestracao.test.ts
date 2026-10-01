import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foraDoAsar, resolverAtivos } from "./ativos-orquestracao";

describe("ativos da orquestração", () => {
  it("empacotado: tudo em app.asar.unpacked", () => {
    const dirMain = join("/Apps/X.app/Contents/Resources/app.asar/dist/main");
    const a = resolverAtivos({ dirMain, empacotado: true, existe: () => false });
    expect(a.pastaDePrompts).toBe("/Apps/X.app/Contents/Resources/app.asar.unpacked/dist/nucleo/orquestracao/prompts");
    expect(a.scriptGancho).toBe("/Apps/X.app/Contents/Resources/app.asar.unpacked/dist/nucleo/orquestracao/hooks/scripts/gancho.mjs");
    expect(a.caminhoWorker).toBe("/Apps/X.app/Contents/Resources/app.asar.unpacked/dist/main/mcp-worker.js");
  });

  it("desenvolvimento: usa dist quando o build copiou os ativos, senão src", () => {
    const dirMain = "/repo/dist/main";
    const copiado = resolverAtivos({ dirMain, empacotado: false, existe: () => true });
    expect(copiado.pastaDePrompts).toBe("/repo/dist/nucleo/orquestracao/prompts");
    const semCopia = resolverAtivos({ dirMain, empacotado: false, existe: () => false });
    expect(semCopia.pastaDePrompts).toBe("/repo/src/nucleo/orquestracao/prompts");
    expect(semCopia.scriptGancho).toBe("/repo/src/nucleo/orquestracao/hooks/scripts/gancho.mjs");
    expect(semCopia.caminhoWorker).toBe("/repo/dist/main/mcp-worker.js");
  });

  it("foraDoAsar só troca o segmento do asar", () => {
    expect(foraDoAsar("C:\\App\\resources\\app.asar\\dist\\x.js")).toBe("C:\\App\\resources\\app.asar.unpacked\\dist\\x.js");
    expect(foraDoAsar("/a/app.asar.unpacked/x")).toBe("/a/app.asar.unpacked/x");
  });
});
