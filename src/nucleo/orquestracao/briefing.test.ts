import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUTO } from "../produto";
import { contextoPrevioDoBriefing, gerarBriefing, gravarBriefing, lerBriefing, preencherSecao, registrarResultadoNoBriefing, secoesDoBriefing } from "./briefing";

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

describe("contexto prévio do RAG no despacho (Fase 15, DEC-4 b)", () => {
  const ENV = '<conhecimento_previo gerado_em="2026-10-01T10:00:00Z" tipo="dados">\nAVISO: dado.\n## Já existe?\n- [k1] algo\n</conhecimento_previo>\nAntes de implementar, confira acima.';
  const ids = { workspace_id: "ws_1", mission_id: "mis_1", task_ref: "T-03.01", pane_id: null };
  async function comBriefing() {
    const raiz = mkdtempSync(join(tmpdir(), "brief-rag-"));
    return { raiz, rel: await gravarBriefing(raiz, dados) };
  }

  it("sem `conhecimento` o briefing é idêntico ao de antes (byte a byte)", () => {
    expect(gerarBriefing({ ...dados, conhecimento: null })).toBe(gerarBriefing(dados));
    expect(gerarBriefing({ ...dados, conhecimento: "  " })).toBe(gerarBriefing(dados));
  });
  it("com `conhecimento` entra depois do Contrato e não atrapalha as seções nem o preenchimento do resultado", async () => {
    const md = gerarBriefing({ ...dados, conhecimento: ENV });
    expect(md.indexOf("## Conhecimento prévio")).toBeGreaterThan(md.indexOf("## Contrato"));
    expect(md.indexOf("## Conhecimento prévio")).toBeLessThan(md.indexOf("## Resultado"));
    expect(secoesDoBriefing(md).Contrato).toBe("Entregar o servidor.\nCom testes.");
    const novo = preencherSecao(md, "Resultado", "feito");
    expect(secoesDoBriefing(novo).Resultado).toBe("feito");
    expect(novo).toContain("<conhecimento_previo");
  });
  it("pede à porta o contexto do Contrato, com origem injecao e a identidade do despacho", async () => {
    const { raiz, rel } = await comBriefing();
    const chamadas: unknown[] = [];
    const r = await contextoPrevioDoBriefing({ contextoParaInjecao: async (p) => { chamadas.push(p); return `${ENV}\n`; } }, { raiz, briefing_path: rel, ...ids });
    expect(r).toBe(ENV);
    expect(chamadas).toEqual([{ ...ids, tarefa: "Entregar o servidor. Com testes.", arquivos: [], origem: "injecao" }]);
  });
  it("porta ausente, vazia, que lança ou lenta: devolve vazio e nunca bloqueia", async () => {
    const { raiz, rel } = await comBriefing();
    expect(await contextoPrevioDoBriefing(undefined, { raiz, briefing_path: rel, ...ids })).toBe("");
    expect(await contextoPrevioDoBriefing(null, { raiz, briefing_path: rel, ...ids })).toBe("");
    expect(await contextoPrevioDoBriefing({ contextoParaInjecao: async () => "" }, { raiz, briefing_path: rel, ...ids })).toBe("");
    expect(await contextoPrevioDoBriefing({ contextoParaInjecao: async () => { throw new Error("boom"); } }, { raiz, briefing_path: rel, ...ids })).toBe("");
    const t0 = Date.now();
    const lenta = await contextoPrevioDoBriefing({ contextoParaInjecao: () => new Promise<string>(() => undefined) }, { raiz, briefing_path: rel, ...ids, tetoMs: 30 });
    expect(lenta).toBe("");
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("briefing ausente ou sem Contrato: nada a consultar", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "brief-rag-"));
    let chamou = false;
    const porta = { contextoParaInjecao: async () => { chamou = true; return ENV; } };
    expect(await contextoPrevioDoBriefing(porta, { raiz, briefing_path: null, ...ids })).toBe("");
    expect(await contextoPrevioDoBriefing(porta, { raiz, briefing_path: "nao/existe.md", ...ids })).toBe("");
    expect(chamou).toBe(false);
  });
});
