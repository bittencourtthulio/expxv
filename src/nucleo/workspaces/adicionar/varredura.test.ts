import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";
import { lerBranch, raizesPadrao, varrerProjetos, type AchadoBruto } from "./varredura";

let raiz: string;
beforeEach(() => {
  raiz = pastaTmp("adic-varr-");
});
afterEach(() => removerPasta(raiz));

const repo = (rel: string, branch = "main"): void => {
  mkdirSync(join(raiz, rel, ".git"), { recursive: true });
  writeFileSync(join(raiz, rel, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
};
const manifesto = (rel: string, arq = "package.json"): void => {
  mkdirSync(join(raiz, rel), { recursive: true });
  writeFileSync(join(raiz, rel, arq), "{}");
};
async function achar(op: { raizes?: Parameters<typeof varrerProjetos>[0]["raizes"]; max?: number; sinal?: AbortSignal; ceder?: () => Promise<void>; agora?: () => number } = {}) {
  const achados: AchadoBruto[] = [];
  const lotes: number[] = [];
  const resumo = await varrerProjetos({
    raizes: op.raizes ?? [{ caminho: raiz, profundidade: 3 }],
    sinal: op.sinal ?? new AbortController().signal,
    aoLote: (itens) => { achados.push(...itens); lotes.push(itens.length); },
    ...(op.max === undefined ? {} : { maxDiretorios: op.max }),
    ...(op.ceder === undefined ? {} : { ceder: op.ceder }),
    ...(op.agora === undefined ? {} : { agora: op.agora }),
  });
  return { achados, resumo, lotes };
}

describe("varrerProjetos", () => {
  it("acha repositórios git e pastas com manifesto, com branch e sem descer dentro do projeto", async () => {
    repo("a", "main");
    repo("grupo/b", "feature/x");
    manifesto("c", "pyproject.toml");
    manifesto("a/pacote-interno"); // dentro de projeto já achado: ignorado
    const { achados } = await achar();
    const por = Object.fromEntries(achados.map((x) => [x.nome, x]));
    expect(Object.keys(por).sort()).toEqual(["a", "b", "c"]);
    expect(por.a).toMatchObject({ e_git: true, branch: "main", manifesto: null });
    expect(por.b).toMatchObject({ e_git: true, branch: "feature/x" });
    expect(por.c).toMatchObject({ e_git: false, branch: null, manifesto: "pyproject.toml" });
  });
  it("respeita a profundidade (raiz com profundidade 1 só examina as filhas)", async () => {
    repo("filha");
    repo("x/y/neta");
    const { achados } = await achar({ raizes: [{ caminho: raiz, profundidade: 1 }] });
    expect(achados.map((a) => a.nome)).toEqual(["filha"]);
  });
  it("profundidade ≤ 3: o 4º nível não é visto", async () => {
    repo("n1/n2/n3");
    repo("n1/n2/n3/../n3b/n4x");
    mkdirSync(join(raiz, "p1", "p2", "p3"), { recursive: true });
    repo("p1/p2/p3/p4");
    const { achados } = await achar();
    expect(achados.map((a) => a.nome).sort()).toEqual(["n3"]); // n3b/n4x está no nível 4
  });
  it("ignora node_modules, .git, Library, dist, .venv e pastas ocultas", async () => {
    for (const d of ["node_modules/x", "dist/x", ".venv/x", "Library/x", ".oculta/x", "build/x", "target/x"]) repo(d);
    repo("ok");
    const { achados } = await achar();
    expect(achados.map((a) => a.nome)).toEqual(["ok"]);
  });
  it("não segue link simbólico", async () => {
    repo("real");
    mkdirSync(join(raiz, "pasta"));
    symlinkSync(join(raiz, "real"), join(raiz, "pasta", "elo"));
    const { achados } = await achar();
    expect(achados.map((a) => a.caminho)).toEqual([join(raiz, "real")]);
  });
  it("limite de diretórios visitados", async () => {
    for (let i = 0; i < 30; i++) mkdirSync(join(raiz, `d${i}`));
    const { resumo } = await achar({ max: 10 });
    expect(resumo.limiteAtingido).toBe(true);
    expect(resumo.visitados).toBe(10);
  });
  it("o limite padrão é 2 000", async () => {
    const { MAX_DIRETORIOS } = await import("./varredura");
    expect(MAX_DIRETORIOS).toBe(2000);
  });
  it("cancelável: para entre diretórios e informa", async () => {
    for (let i = 0; i < 50; i++) repo(`r${i}`);
    const ctl = new AbortController();
    let n = 0;
    const { resumo, achados } = await achar({ sinal: ctl.signal, ceder: async () => { if (++n === 1) ctl.abort(); }, agora: (() => { let t = 0; return () => (t += 20); })() });
    expect(resumo.cancelada).toBe(true);
    expect(achados.length).toBeLessThan(50);
  });
  it("cede o event loop (nunca segura o main por mais que o orçamento)", async () => {
    for (let i = 0; i < 40; i++) repo(`r${i}`);
    let cedeu = 0;
    await achar({ ceder: async () => { cedeu++; }, agora: (() => { let t = 0; return () => (t += 15); })() });
    expect(cedeu).toBeGreaterThan(5);
  });
  it("entrega em lotes pequenos e não repete achado em raízes sobrepostas", async () => {
    for (let i = 0; i < 25; i++) repo(`r${String(i).padStart(2, "0")}`);
    const { achados, lotes } = await achar({ raizes: [{ caminho: raiz, profundidade: 3 }, { caminho: raiz, profundidade: 3 }] });
    expect(achados).toHaveLength(25);
    expect(Math.max(...lotes)).toBeLessThanOrEqual(10);
  });
  it("raiz inexistente é pulada sem erro", async () => {
    repo("a");
    const { achados } = await achar({ raizes: [{ caminho: join(raiz, "nao-existe"), profundidade: 3 }, { caminho: raiz, profundidade: 3 }] });
    expect(achados).toHaveLength(1);
  });
  it("na pasta pessoal, pastas protegidas do macOS não são lidas", async () => {
    repo("Documents/Projetos/x"); // filha protegida: não entra como filha da casa
    repo("meu-projeto");
    const { achados } = await achar({ raizes: [{ caminho: raiz, profundidade: 1, casa: true }] });
    expect(achados.map((a) => a.nome)).toEqual(["meu-projeto"]);
  });
});

describe("lerBranch / raizesPadrao", () => {
  it("HEAD detached, worktree (.git arquivo) e pasta sem git", async () => {
    mkdirSync(join(raiz, "det", ".git"), { recursive: true });
    writeFileSync(join(raiz, "det", ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    expect(await lerBranch(join(raiz, "det"))).toEqual({ e_git: true, branch: null });
    mkdirSync(join(raiz, "gitdir-real"));
    writeFileSync(join(raiz, "gitdir-real", "HEAD"), "ref: refs/heads/wt\n");
    mkdirSync(join(raiz, "wt"));
    writeFileSync(join(raiz, "wt", ".git"), `gitdir: ${join(raiz, "gitdir-real")}\n`);
    expect(await lerBranch(join(raiz, "wt"))).toEqual({ e_git: true, branch: "wt" });
    mkdirSync(join(raiz, "sem"));
    expect(await lerBranch(join(raiz, "sem"))).toEqual({ e_git: false, branch: null });
  });
  it("locais comuns + ~ (profundidade 1)", () => {
    const r = raizesPadrao("/home/x");
    expect(r.map((x) => x.caminho)).toEqual(["/home/x/orca/projects", "/home/x/Developer", "/home/x/Projetos", "/home/x/Documents/Projetos", "/home/x/code", "/home/x/dev", "/home/x/src", "/home/x/workspace", "/home/x"]);
    expect(r.at(-1)).toMatchObject({ profundidade: 1, casa: true });
    expect(r.slice(0, -1).every((x) => x.profundidade === 3)).toBe(true);
  });
});
