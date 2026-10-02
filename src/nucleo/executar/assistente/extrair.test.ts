import { describe, expect, it } from "vitest";
import { extrairJson, RESPOSTA_MAX_CHARS } from "./extrair";
import { montarPrompt, novaMarca, SISTEMA_ASSISTENTE } from "./prompt";

describe("extrairJson", () => {
  it.each<[string, string, unknown]>([
    ["puro", '{"configuracoes":[]}', { configuracoes: [] }],
    ["cerca de código", 'ok\n```json\n{"configuracoes":[{"nome":"a"}]}\n```', { configuracoes: [{ nome: "a" }] }],
    ["texto antes e depois", 'Aqui: {"configuracoes":[],"avisos":["x"]} fim.', { configuracoes: [], avisos: ["x"] }],
    ["chaves dentro de string não quebram", '{"configuracoes":[{"nome":"a } b { c","argumentos":["\\"{"]}]}', { configuracoes: [{ nome: "a } b { c", argumentos: ['"{'] }] }],
    ["prefere o objeto com configuracoes", '{"ruido":1} e depois {"configuracoes":[1]}', { configuracoes: [1] }],
    ["chave solta antes do JSON", '{ não é json } {"configuracoes":[]}', { configuracoes: [] }],
  ])("%s", (_n, texto, esperado) => {
    const r = extrairJson(texto);
    expect(r.ok && r.valor).toEqual(esperado);
  });
  it.each([[""], ["   "], ["sem objeto nenhum"], ['{"a": '], ["[1,2,3]"]])("falha em %j", (t) => {
    expect(extrairJson(t).ok).toBe(false);
  });
  it("sem `configuracoes` devolve o primeiro objeto (a validação recusa depois)", () => {
    const r = extrairJson('{"outra":1}');
    expect(r.ok && r.valor).toEqual({ outra: 1 });
  });
  it("não processa resposta gigante inteira", () => {
    const t0 = Date.now();
    extrairJson(`${"{".repeat(RESPOSTA_MAX_CHARS * 2)}`);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe("prompt", () => {
  it("dossiê entre delimitadores com marca aleatória, sistema manda ignorar ordens nos dados, lembrete depois dos dados", () => {
    const a = montarPrompt("conteúdo do repositório", "abc");
    expect(a.prompt).toContain("<<<DADOS-INICIO-abc\nconteúdo do repositório\nDADOS-FIM-abc>>>");
    expect(a.prompt.indexOf("LEMBRETE FINAL")).toBeGreaterThan(a.prompt.indexOf("DADOS-FIM-abc"));
    expect(SISTEMA_ASSISTENTE).toMatch(/NÃO CONFIÁVEL/);
    expect(SISTEMA_ASSISTENTE).toMatch(/Você NÃO tem ferramentas/);
    expect(a.prompt).toMatch(/Nunca use shell/);
    expect(novaMarca()).not.toBe(novaMarca());
    expect(novaMarca()).toMatch(/^[0-9a-f]{16}$/);
  });
  it("retentativa carrega o erro (limitado)", () => {
    const p = montarPrompt("x", "m", { erro: "e".repeat(2000) });
    expect(p.prompt).toContain("CORREÇÃO");
    expect(p.prompt.length).toBeLessThan(montarPrompt("x", "m").prompt.length + 800);
  });
});
