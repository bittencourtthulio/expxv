import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUTO } from "../produto";
import { gerarBriefing, gravarBriefing, lerBriefing, preencherSecao, registrarResultadoNoBriefing, secoesDoBriefing } from "./briefing";

const dados = { mission_id: "mis_1", task_ref: "T-03.01", titulo: "Sidecar MCP", papel: "executor" as const, contrato: "Entregar o servidor.\nCom testes." };

describe("briefing", () => {
  it("tem as seções Contrato, Resultado e Executado_por", () => {
    const s = secoesDoBriefing(gerarBriefing(dados));
    expect(s.Contrato).toBe("Entregar o servidor.\nCom testes.");
    expect(s.Resultado).toContain("worker preenche");
    expect(s.Executado_por).not.toBeNull();
  });
  it("grava em <pasta>/missoes/<mission>/briefing-<task>.md e devolve caminho relativo", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "brief-"));
    const rel = await gravarBriefing(raiz, dados);
    expect(rel).toBe(join(PRODUTO.pastaNoProjeto, "missoes", "mis_1", "briefing-T-03.01.md"));
    expect(readFileSync(join(raiz, rel), "utf8")).toContain("## Contrato");
    expect(readFileSync(join(raiz, PRODUTO.pastaNoProjeto, ".gitignore"), "utf8")).toBe("*\n");
  });
  it("o worker preenche o MESMO arquivo, preservando o Contrato", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "brief-"));
    const rel = await gravarBriefing(raiz, dados);
    expect(await registrarResultadoNoBriefing(raiz, rel, { resultado: "feito: 2", executado_por: "codex · pane 7" })).toBe(true);
    const s = secoesDoBriefing((await lerBriefing(raiz, rel)) ?? "");
    expect(s).toEqual({ Contrato: "Entregar o servidor.\nCom testes.", Resultado: "feito: 2", Executado_por: "codex · pane 7" });
  });
  it("rejeita identificadores que escapam da pasta", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "brief-"));
    await expect(gravarBriefing(raiz, { ...dados, task_ref: "../../etc/x" })).rejects.toThrow();
    await expect(gravarBriefing(raiz, { ...dados, mission_id: "a/b" })).rejects.toThrow();
    expect(await lerBriefing(raiz, "../fora.md")).toBeNull();
  });
  it("preencherSecao cria seção ausente", () => {
    expect(secoesDoBriefing(preencherSecao("# x\n", "Resultado", "ok")).Resultado).toBe("ok");
  });
});
