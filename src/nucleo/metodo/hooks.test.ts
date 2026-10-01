import { mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, limpar } from "../../../tests/fixtures/dominio/ambiente";
import { HOOKS_DE_NASCIMENTO, lerHooks } from "./hooks";

afterEach(limpar);

function projeto(conteudo?: string): string {
  const raiz = criarTmp("hooks-");
  if (conteudo !== undefined) {
    mkdirSync(join(raiz, ".expx"));
    writeFileSync(join(raiz, ".expx", "hooks.json"), conteudo);
  }
  return raiz;
}
const modo = (r: Awaited<ReturnType<typeof lerHooks>>, nome: string) => r.hooks.find((h) => h.nome === nome);

describe("hooks.json (somente leitura)", () => {
  it("ausente: valem os padrões de nascimento (segurança em bloqueio, método em aviso)", async () => {
    const r = await lerHooks(projeto());
    expect(r).toMatchObject({ presente: false, origem: "padrao", avisos: [] });
    expect(r.hooks.length).toBe(HOOKS_DE_NASCIMENTO.length);
    expect(modo(r, "segredo-no-commit")).toMatchObject({ modo: "bloqueio", tipo: "seguranca", origem: "padrao" });
    expect(modo(r, "git-perigoso")?.modo).toBe("bloqueio");
    expect(modo(r, "task-so-fecha-verde")).toMatchObject({ modo: "aviso", tipo: "metodo" });
    expect(modo(r, "aprovacao-em-raio-alto")?.modo).toBe("bloqueio");
  });

  it("formato do plugin: string por hook; o que não é citado fica no padrão", async () => {
    const r = await lerHooks(projeto(JSON.stringify({ hooks: { "task-so-fecha-verde": "bloqueio", "sem-jargao-no-uso": "desligado" } })));
    expect(r).toMatchObject({ presente: true, origem: "arquivo" });
    expect(modo(r, "task-so-fecha-verde")).toMatchObject({ modo: "bloqueio", origem: "arquivo" });
    expect(modo(r, "sem-jargao-no-uso")?.modo).toBe("desligado");
    expect(modo(r, "segredo-no-commit")).toMatchObject({ modo: "bloqueio", origem: "padrao" });
  });

  it("formato do contrato: objeto {modo, tipo}; hook desconhecido entra como método", async () => {
    const r = await lerHooks(projeto(JSON.stringify({ expx_hooks: 1, hooks: { segredo: { modo: "bloqueio", tipo: "seguranca" }, novo: { modo: "aviso" } } })));
    expect(modo(r, "segredo")).toMatchObject({ modo: "bloqueio", tipo: "seguranca", origem: "arquivo" });
    expect(modo(r, "novo")).toMatchObject({ modo: "aviso", tipo: "metodo", origem: "arquivo" });
  });

  it("segurança nunca é rebaixada por ausência: só o desligado explícito desliga", async () => {
    const r = await lerHooks(projeto(JSON.stringify({ hooks: { "git-perigoso": "desligado" } })));
    expect(modo(r, "git-perigoso")?.modo).toBe("desligado");
    expect(modo(r, "segredo-no-commit")?.modo).toBe("bloqueio");
  });

  it("modo inválido ou JSON quebrado viram aviso, nunca exceção", async () => {
    const a = await lerHooks(projeto(JSON.stringify({ hooks: { "task-so-fecha-verde": "talvez" } })));
    expect(modo(a, "task-so-fecha-verde")?.modo).toBe("aviso");
    expect(a.avisos.join(" ")).toMatch(/task-so-fecha-verde/);
    const b = await lerHooks(projeto("{ isto não é json"));
    expect(b.presente).toBe(true);
    expect(b.origem).toBe("padrao");
    expect(b.avisos[0]).toMatch(/ilegível/);
    const c = await lerHooks(projeto("[1,2,3]"));
    expect(c.avisos[0]).toMatch(/formato/);
  });

  it("arquivo enorme é ignorado com aviso", async () => {
    const r = await lerHooks(projeto(JSON.stringify({ hooks: { a: "aviso" }, lixo: "x".repeat(400_000) })));
    expect(r.origem).toBe("padrao");
    expect(r.avisos[0]).toMatch(/grande/);
  });

  it("agrupamento por skill (aninhado) é achatado com o nome composto", async () => {
    const r = await lerHooks(projeto(JSON.stringify({ hooks: { legadox: { "zona-de-risco": "bloqueio", "sem-colateral": { modo: "aviso" } } } })));
    expect(modo(r, "legadox/zona-de-risco")?.modo).toBe("bloqueio");
    expect(modo(r, "legadox/sem-colateral")?.modo).toBe("aviso");
  });

  it("não escreve nada: o arquivo fica byte a byte igual e nenhum arquivo novo aparece", async () => {
    const raiz = projeto(JSON.stringify({ hooks: { a: "aviso" } }));
    const antes = readFileSync(join(raiz, ".expx", "hooks.json"), "utf8");
    const mt = statSync(join(raiz, ".expx", "hooks.json")).mtimeMs;
    await lerHooks(raiz);
    expect(readFileSync(join(raiz, ".expx", "hooks.json"), "utf8")).toBe(antes);
    expect(statSync(join(raiz, ".expx", "hooks.json")).mtimeMs).toBe(mt);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(join(raiz, ".expx"))).toEqual(["hooks.json"]);
  });
});
