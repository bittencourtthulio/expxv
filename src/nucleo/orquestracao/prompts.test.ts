import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUTO } from "../produto";
import { NOMES_PROMPT, PASTA_PROMPTS_PADRAO, analisarPrompt, carregarPrompt, renderizarPrompt } from "./prompts";

describe("prompts versionados e editáveis", () => {
  it("os quatro prompts-base existem como arquivos .md versionados", async () => {
    expect(readdirSync(PASTA_PROMPTS_PADRAO).filter((f) => f.endsWith(".md")).sort()).toEqual(["intake.md", "piloto.md", "revisor.md", "worker.md"]);
    for (const nome of NOMES_PROMPT) {
      const p = await carregarPrompt(nome);
      expect(p.versao).toBeGreaterThanOrEqual(1);
      expect(p.texto.length).toBeGreaterThan(300);
      expect(p.texto).not.toContain("---\nversao");
    }
  });

  it("são carregados de arquivo: editar o arquivo muda o prompt (sem recompilar)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-"));
    writeFileSync(join(dir, "piloto.md"), "---\nversao: 7\n---\nSeja breve, {{PASTA}}.\n");
    const a = await carregarPrompt("piloto", dir);
    expect(a).toEqual({ nome: "piloto", versao: 7, texto: "Seja breve, {{PASTA}}." });
    writeFileSync(join(dir, "piloto.md"), "---\nversao: 8\n---\nOutro texto.\n");
    expect((await carregarPrompt("piloto", dir)).texto).toBe("Outro texto.");
    await expect(carregarPrompt("worker", dir)).rejects.toThrow();
  });

  it("sem front-matter vale versão 1; marcadores são substituídos e desconhecidos ficam", () => {
    expect(analisarPrompt("worker", "texto").versao).toBe(1);
    expect(renderizarPrompt("a {{PASTA}} b {{CARD}} c {{X}}", { CARD: "T-1" })).toBe(`a ${PRODUTO.pastaNoProjeto} b T-1 c {{X}}`);
  });

  it("o prompt do piloto cobre o que a spec exige: não codifica, gates, limites, handoff e wake", async () => {
    const t = (await carregarPrompt("piloto")).texto;
    for (const termo of ["não escreve", "pane_spawn", "gate_pending", "reviewer", "mission_complete", "8 workers", "wake", "400"]) expect(t.toLowerCase()).toContain(termo.toLowerCase());
    expect((await carregarPrompt("intake")).texto).toContain("direction");
    expect((await carregarPrompt("worker")).texto).toContain("handoff_submit");
    expect((await carregarPrompt("revisor")).texto).toContain("handoff_submit");
  });
});
