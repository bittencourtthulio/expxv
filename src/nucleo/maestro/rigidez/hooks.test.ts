import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NIVEIS_RIGIDEZ } from "../../../compartilhado/maestro";
import { lerHooks } from "../../metodo/hooks";
import { PRODUTO } from "../../produto";
import { aplicarHooks, ARQUIVO_HOOKS, BACKUPS_MAX, CHAVE_DA_MARCA, criarPortaArquivosHooksNode, estadoDosHooks, hooksDoNivel, lerHooksJson, mesclar, reverterHooks, reverterMescla, type ArquivoHooks, type PortaArquivosHooks } from "./hooks";
import { SEGURANCA } from "./matriz";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function raiz(comExpx = true, hooks?: string): string {
  const d = mkdtempSync(join(tmpdir(), "maestro-hooks-"));
  dirs.push(d);
  if (comExpx) mkdirSync(join(d, ".expx"));
  if (hooks !== undefined) writeFileSync(join(d, ".expx", "hooks.json"), hooks);
  return d;
}
const arquivo = (r: string): string => join(r, ".expx", "hooks.json");
const ler = (r: string): ArquivoHooks => JSON.parse(readFileSync(arquivo(r), "utf8")) as ArquivoHooks;
const AGORA = () => new Date("2026-10-01T12:00:00.000Z");
const marca = (a: ArquivoHooks): { chaves: Record<string, { valor: string; anterior: string | null }>; nivel: number } => a[CHAVE_DA_MARCA] as never;

describe("hooksDoNivel", () => {
  it("nível 3 = nascimento (vazio); segurança nunca; níveis crescem em bloqueios", () => {
    expect(hooksDoNivel(3)).toEqual({});
    for (const n of NIVEIS_RIGIDEZ) for (const s of SEGURANCA) expect(hooksDoNivel(n)[s]).toBeUndefined();
    const bloqueios = (n: 1 | 2 | 3 | 4 | 5): number => Object.values(hooksDoNivel(n)).filter((m) => m === "bloqueio").length;
    expect(bloqueios(4)).toBeGreaterThan(bloqueios(2));
    expect(bloqueios(5)).toBeGreaterThan(bloqueios(4));
  });
});

describe("mesclar (puro)", () => {
  it("não altera a entrada; preserva _comentario e chaves desconhecidas", () => {
    const atual: ArquivoHooks = { _comentario: "meu", versao: 7, hooks: { "x-meu": "bloqueio" } };
    const copia = JSON.stringify(atual);
    const r = mesclar(atual, hooksDoNivel(4), { nivel: 4, agora: "2026-10-01T00:00:00Z" });
    expect(JSON.stringify(atual)).toBe(copia);
    expect(r.arquivo._comentario).toBe("meu");
    expect(r.arquivo.versao).toBe(7);
    expect((r.arquivo.hooks as Record<string, string>)["x-meu"]).toBe("bloqueio");
    expect((r.arquivo.hooks as Record<string, string>)["task-so-fecha-verde"]).toBe("bloqueio");
    expect(marca(r.arquivo).chaves["task-so-fecha-verde"]).toEqual({ valor: "bloqueio", anterior: null });
  });
  it("chave definida pelo usuário nunca é alterada: aparece como preservada", () => {
    const r = mesclar({ hooks: { "task-so-fecha-verde": "desligado" } }, hooksDoNivel(4), { nivel: 4, agora: "t" });
    expect((r.arquivo.hooks as Record<string, string>)["task-so-fecha-verde"]).toBe("desligado");
    expect(r.preservadas).toEqual([{ nome: "task-so-fecha-verde", usuario: "desligado", pedido: "bloqueio" }]);
    expect(marca(r.arquivo).chaves["task-so-fecha-verde"]).toBeUndefined();
  });
  it("valor do usuário igual ao pedido: nada a avisar, e continua sendo dele", () => {
    const r = mesclar({ hooks: { "task-so-fecha-verde": "bloqueio" } }, hooksDoNivel(4), { nivel: 4, agora: "t" });
    expect(r.preservadas.find((p) => p.nome === "task-so-fecha-verde")).toBeUndefined();
    expect(marca(r.arquivo).chaves["task-so-fecha-verde"]).toBeUndefined();
  });
  it("modo em objeto ({modo}) do usuário também conta como dele", () => {
    const r = mesclar({ hooks: { "tdd-teste-antes": { modo: "aviso" } } }, hooksDoNivel(4), { nivel: 4, agora: "t" });
    expect(r.preservadas).toEqual([{ nome: "tdd-teste-antes", usuario: "aviso", pedido: "bloqueio" }]);
  });
  it("trocar de nível atualiza só as nossas; nível 3 remove só as gerenciadas", () => {
    const a4 = mesclar({ hooks: { "x-meu": "aviso" } }, hooksDoNivel(4), { nivel: 4, agora: "t" }).arquivo;
    const a5 = mesclar(a4, hooksDoNivel(5), { nivel: 5, agora: "t" });
    expect((a5.arquivo.hooks as Record<string, string>)["sem-colateral"]).toBe("bloqueio");
    expect(marca(a5.arquivo).nivel).toBe(5);
    const a3 = mesclar(a5.arquivo, hooksDoNivel(3), { nivel: 3, agora: "t" });
    expect(a3.arquivo.hooks).toEqual({ "x-meu": "aviso" });
    expect(a3.arquivo[CHAVE_DA_MARCA]).toBeUndefined();
    expect(a3.removidas.length).toBeGreaterThan(10);
  });
  it("usuário editou uma chave nossa depois: solta da gerência sem tocar", () => {
    const a4 = mesclar({}, hooksDoNivel(4), { nivel: 4, agora: "t" }).arquivo;
    const editado = { ...a4, hooks: { ...(a4.hooks as object), "task-so-fecha-verde": "desligado" } } as ArquivoHooks;
    const r = mesclar(editado, hooksDoNivel(3), { nivel: 3, agora: "t" });
    expect(r.soltas).toEqual(["task-so-fecha-verde"]);
    expect((r.arquivo.hooks as Record<string, string>)["task-so-fecha-verde"]).toBe("desligado");
    expect((r.arquivo.hooks as Record<string, string>)["escopo-da-task"]).toBeUndefined();
  });
  it("chaves de segurança no pedido são ignoradas (I8), mesmo se vierem", () => {
    const r = mesclar({}, { "segredo-no-commit": "desligado", "git-perigoso": "aviso", "task-so-fecha-verde": "aviso" }, { nivel: 1, agora: "t" });
    expect(Object.keys(r.arquivo.hooks as object)).toEqual(["task-so-fecha-verde"]);
  });
  it("reverterMescla remove só o que ainda é o que o ADE escreveu", () => {
    const a4 = mesclar({ hooks: { "x-meu": "aviso" } }, hooksDoNivel(4), { nivel: 4, agora: "t" }).arquivo;
    const editado = { ...a4, hooks: { ...(a4.hooks as object), "tdd-teste-antes": "desligado" } } as ArquivoHooks;
    const r = reverterMescla(editado);
    expect(r.soltas).toEqual(["tdd-teste-antes"]);
    expect(r.removidas).not.toContain("tdd-teste-antes");
    expect(r.arquivo.hooks).toMatchObject({ "x-meu": "aviso", "tdd-teste-antes": "desligado" });
    expect(r.arquivo[CHAVE_DA_MARCA]).toBeUndefined();
    expect(reverterMescla({ hooks: { a: "aviso" } }).mudou).toBe(false);
  });
});

describe("lerHooksJson", () => {
  it("aceita BOM, recusa não-objeto, lista, `hooks` de tipo errado e JSON quebrado", () => {
    expect(lerHooksJson("﻿{}").ok).toBe(true);
    expect(lerHooksJson(null)).toMatchObject({ ok: true, existia: false });
    for (const ruim of ["[]", "3", "null", "{", '{"hooks": []}', '{"hooks": 3}', ""]) expect(lerHooksJson(ruim), ruim).toEqual({ ok: false, erro: "hooks_json_invalido" });
  });
});

describe("aplicarHooks no disco real", () => {
  it("arquivo ausente com .expx/ ⇒ cria, sem backup (não havia nada); `lerHooks` do método lê o resultado", async () => {
    const r = raiz();
    const res = await aplicarHooks(criarPortaArquivosHooksNode(r), 4, { agora: AGORA });
    expect(res).toMatchObject({ escrito: true, agendado: false, arquivo: ARQUIVO_HOOKS, erro: null, backup: null });
    expect(res.escritas.length).toBeGreaterThan(10);
    const estado = await lerHooks(r);
    expect(estado.presente).toBe(true);
    expect(estado.origem).toBe("arquivo");
    expect(estado.hooks.find((h) => h.nome === "task-so-fecha-verde")).toMatchObject({ modo: "bloqueio", origem: "arquivo" });
    expect(estado.hooks.find((h) => h.nome === "segredo-no-commit")).toMatchObject({ modo: "bloqueio", origem: "padrao" });
    expect(estado.avisos).toEqual([]);
  });
  it(".expx/ ausente ⇒ NÃO cria nada", async () => {
    const r = raiz(false);
    const res = await aplicarHooks(criarPortaArquivosHooksNode(r), 4);
    expect(res.escrito).toBe(false);
    expect(res.aviso).toMatch(/\.expx\/ ausente/);
    expect(existsSync(join(r, ".expx"))).toBe(false);
    expect(readdirSync(r)).toEqual([]);
  });
  it("JSON inválido ⇒ recusa com erro nominal e NADA é gravado (nem backup)", async () => {
    const r = raiz(true, "{ isto nao e json");
    const res = await aplicarHooks(criarPortaArquivosHooksNode(r), 4);
    expect(res).toMatchObject({ escrito: false, erro: "hooks_json_invalido" });
    expect(readFileSync(arquivo(r), "utf8")).toBe("{ isto nao e json");
    expect(existsSync(join(r, PRODUTO.pastaNoProjeto))).toBe(false);
    expect(readdirSync(join(r, ".expx"))).toEqual(["hooks.json"]);
  });
  it("faz backup do arquivo anterior em <pasta do produto>/maestro/backup e escreve atômico (sem temporários sobrando)", async () => {
    const original = JSON.stringify({ _comentario: "x", hooks: { "x-meu": "aviso" } }, null, 2);
    const r = raiz(true, original);
    const res = await aplicarHooks(criarPortaArquivosHooksNode(r), 4, { agora: AGORA });
    expect(res.backup).toMatch(new RegExp(`^${PRODUTO.pastaNoProjeto}/maestro/backup/hooks-2026-10-01T12-00-00-000Z\\.json$`));
    expect(readFileSync(join(r, res.backup as string), "utf8")).toBe(original);
    expect(readdirSync(join(r, ".expx"))).toEqual(["hooks.json"]);
    expect(ler(r)._comentario).toBe("x");
  });
  it("preserva chave do usuário e a lista como preservada no aviso", async () => {
    const r = raiz(true, JSON.stringify({ hooks: { "escopo-da-task": "desligado" } }));
    const res = await aplicarHooks(criarPortaArquivosHooksNode(r), 4, { agora: AGORA });
    expect(res.preservadas).toEqual([{ nome: "escopo-da-task", usuario: "desligado", pedido: "bloqueio" }]);
    expect(res.aviso).toMatch(/Preservadas \(definidas por você\): escopo-da-task=desligado/);
    expect((ler(r).hooks as Record<string, string>)["escopo-da-task"]).toBe("desligado");
  });
  it("nível 3 depois de 4 remove só as gerenciadas; reverter depois também; segunda aplicação idempotente", async () => {
    const r = raiz(true, JSON.stringify({ hooks: { "x-meu": "aviso" } }));
    const porta = criarPortaArquivosHooksNode(r);
    await aplicarHooks(porta, 4, { agora: AGORA });
    const de4 = readFileSync(arquivo(r), "utf8");
    const igual = await aplicarHooks(porta, 4, { agora: AGORA });
    expect(igual.escrito).toBe(false);
    expect(readFileSync(arquivo(r), "utf8")).toBe(de4);
    const n3 = await aplicarHooks(porta, 3, { agora: () => new Date("2026-10-01T12:01:00.000Z") });
    expect(n3.escrito).toBe(true);
    expect(ler(r).hooks).toEqual({ "x-meu": "aviso" });
    expect(ler(r)[CHAVE_DA_MARCA]).toBeUndefined();
    expect((await estadoDosHooks(porta)).gerenciadas).toEqual([]);
  });
  it("reverter: restaura só o que o ADE escreveu; usuário editou depois ⇒ solta sem tocar", async () => {
    const r = raiz();
    const porta = criarPortaArquivosHooksNode(r);
    await aplicarHooks(porta, 5, { agora: AGORA });
    const a = ler(r);
    writeFileSync(arquivo(r), JSON.stringify({ ...a, hooks: { ...(a.hooks as object), "sem-colateral": "desligado", "meu-hook": "aviso" } }));
    const res = await reverterHooks(porta, { agora: () => new Date("2026-10-01T12:05:00.000Z") });
    expect(res.revertidas).not.toContain("sem-colateral");
    expect(res.revertidas).toContain("task-so-fecha-verde");
    expect(res.soltas).toEqual(["sem-colateral"]);
    expect(ler(r).hooks).toEqual({ "sem-colateral": "desligado", "meu-hook": "aviso" });
    expect(res.backup).not.toBeNull();
    expect((await reverterHooks(porta)).revertidas).toEqual([]);
  });
  it("chaves de SEGURANÇA nunca são escritas, em nível algum", async () => {
    for (const n of NIVEIS_RIGIDEZ) {
      const r = raiz();
      await aplicarHooks(criarPortaArquivosHooksNode(r), n, { legado: true, agora: AGORA });
      if (n === 3) {
        expect(existsSync(arquivo(r))).toBe(false); // nascimento: nada a escrever, nada é criado
        continue;
      }
      const chaves = Object.keys((ler(r).hooks ?? {}) as object);
      for (const s of SEGURANCA) expect(chaves).not.toContain(s);
    }
  });
  it("escrever_hooks=false desliga a exceção; agendar não escreve", async () => {
    const r = raiz();
    const porta = criarPortaArquivosHooksNode(r);
    expect(await aplicarHooks(porta, 4, { escrever_hooks: false })).toMatchObject({ escrito: false, agendado: false });
    expect(await aplicarHooks(porta, 4, { agendar: true })).toMatchObject({ escrito: false, agendado: true });
    expect(existsSync(arquivo(r))).toBe(false);
  });
  it("modo legado nos níveis 1–2 grava o grupo do legadox em aviso", async () => {
    const r = raiz();
    await aplicarHooks(criarPortaArquivosHooksNode(r), 2, { legado: true, agora: AGORA });
    expect((ler(r).hooks as Record<string, string>)["raio-antes-do-plano"]).toBe("aviso");
  });
  it("preserva o modo (permissões) do arquivo existente", async () => {
    const r = raiz(true, "{}");
    chmodSync(arquivo(r), 0o600);
    await aplicarHooks(criarPortaArquivosHooksNode(r), 4, { agora: AGORA });
    expect(statSync(arquivo(r)).mode & 0o777).toBe(0o600);
  });
  it("crash entre o temporário e o rename não corrompe o original nem deixa lixo", async () => {
    const original = JSON.stringify({ hooks: { "x-meu": "aviso" } });
    const r = raiz(true, original);
    const real = criarPortaArquivosHooksNode(r);
    const quebrada: PortaArquivosHooks = { ...real, escreverAtomico: async () => { throw new Error("queda de energia simulada"); } };
    await expect(aplicarHooks(quebrada, 4, { agora: AGORA })).rejects.toThrow(/queda/);
    expect(readFileSync(arquivo(r), "utf8")).toBe(original);
    expect(readdirSync(join(r, ".expx"))).toEqual(["hooks.json"]);
  });
  it("mantém só os 20 últimos backups", async () => {
    const r = raiz(true, "{}");
    const porta = criarPortaArquivosHooksNode(r);
    for (let i = 0; i < BACKUPS_MAX + 5; i++) {
      await aplicarHooks(porta, i % 2 === 0 ? 4 : 5, { agora: () => new Date(Date.UTC(2026, 9, 1, 12, i, 0)) });
    }
    expect(readdirSync(join(r, PRODUTO.pastaNoProjeto, "maestro", "backup")).length).toBe(BACKUPS_MAX);
  });
  it("estado dos hooks: ausente, inválido e com gerenciadas", async () => {
    const porta = (r: string) => criarPortaArquivosHooksNode(r);
    expect(await estadoDosHooks(porta(raiz()))).toMatchObject({ presente: false, gerenciadas: [] });
    expect(await estadoDosHooks(porta(raiz(true, "{")))).toMatchObject({ presente: true, invalido: true });
    const r = raiz();
    await aplicarHooks(porta(r), 4, { agora: AGORA });
    const e = await estadoDosHooks(porta(r));
    expect(e.nivel_aplicado).toBe(4);
    expect(e.gerenciadas).toContain("tdd-teste-antes");
  });
  it("P-219: mesclar 50 chaves ≤ 10 ms; backup + escrita ≤ 50 ms", async () => {
    const muitas: Record<string, string> = {};
    for (let i = 0; i < 50; i++) muitas[`hook-do-usuario-${i}`] = "aviso";
    const r = raiz(true, JSON.stringify({ hooks: muitas }));
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) mesclar({ hooks: muitas }, hooksDoNivel(4), { nivel: 4, agora: "t" });
    expect((performance.now() - t0) / 50).toBeLessThan(10);
    const t1 = performance.now();
    await aplicarHooks(criarPortaArquivosHooksNode(r), 4, { agora: AGORA });
    expect(performance.now() - t1).toBeLessThan(50);
  });
  it("só escreve onde permitido: .expx/hooks.json e a pasta do produto (varredura do que mudou)", async () => {
    const r = raiz(true, JSON.stringify({ hooks: {} }));
    writeFileSync(join(r, "README.md"), "x");
    await aplicarHooks(criarPortaArquivosHooksNode(r), 4, { agora: AGORA });
    const arvore = (d: string, p = ""): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arvore(join(d, e.name), `${p}${e.name}/`) : [`${p}${e.name}`]));
    const todos = arvore(r);
    for (const f of todos) expect(f === "README.md" || f === ".expx/hooks.json" || f.startsWith(`${PRODUTO.pastaNoProjeto}/maestro/backup/`), f).toBe(true);
    expect(readFileSync(join(r, "README.md"), "utf8")).toBe("x");
  });
});
