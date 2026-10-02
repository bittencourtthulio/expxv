import { describe, expect, it, vi } from "vitest";
import type { RepoCatalogo } from "../nucleo/banco/repos/catalogo";
import { criarCatalogoMain, foraDoAsar, pastaDasSkillsEmbarcadas } from "./catalogo";

describe("catalogo no main", () => {
  it("foraDoAsar troca app.asar por app.asar.unpacked (worker_threads não lê de dentro do asar)", () => {
    expect(foraDoAsar("/R/app.asar/dist/nucleo/catalogo/worker.js")).toBe("/R/app.asar.unpacked/dist/nucleo/catalogo/worker.js");
    expect(foraDoAsar("/dev/dist/x.js")).toBe("/dev/dist/x.js");
  });
  it("pasta das skills: <resources>/skills empacotado; <app>/resources/skills em desenvolvimento", () => {
    expect(pastaDasSkillsEmbarcadas({ empacotado: true, resourcesPath: "/R", appPath: "/A", existe: () => true })).toBe("/R/skills");
    expect(pastaDasSkillsEmbarcadas({ empacotado: false, resourcesPath: "/R", appPath: "/A", existe: (c) => c === "/A/resources/skills" })).toBe("/A/resources/skills");
  });
  it("criar o serviço NÃO abre worker, não lê disco e não toca o repositório (sob demanda)", async () => {
    const repo = new Proxy({}, { get: () => () => { throw new Error("repo tocado no boot"); } }) as unknown as RepoCatalogo;
    const emitir = vi.fn();
    const c = criarCatalogoMain({ repo, caminhoWorker: "/nao/existe/worker.js", dirSkills: "/nao/existe", workspaces: () => [], emitirRenderer: emitir, barramento: emitir, lixeira: async () => undefined, revelar: () => undefined });
    expect(emitir).not.toHaveBeenCalled();
    await c.encerrar(); // sem worker criado: não falha
  });
});
