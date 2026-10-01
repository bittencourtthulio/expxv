import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ambienteGit, ExecutorVcs } from "./executor";
import { initRepo, isolarConfigGit, pastaTmp, removerPasta, scriptExecutavel, vivo, git } from "../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-exec-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

async function espera(cond: () => boolean, ms = 3000): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return cond();
}

describe("ambienteGit", () => {
  it("remove GIT_DIR/GIT_WORK_TREE, fixa locale e proíbe prompt; locks opcionais só em leitura", () => {
    const base = { GIT_DIR: "/x", GIT_WORK_TREE: "/y", GIT_OPTIONAL_LOCKS: "1", PATH: "/bin", GIT_SSH_COMMAND: "ssh -i k" };
    const l = ambienteGit(base, "leitura");
    expect(l.GIT_DIR).toBeUndefined();
    expect(l.GIT_WORK_TREE).toBeUndefined();
    expect(l.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(l.GIT_TERMINAL_PROMPT).toBe("0");
    expect(l.LC_ALL).toBe("C.UTF-8");
    expect(l.GIT_SSH_COMMAND).toBe("ssh -i k");
    expect(ambienteGit(base, "escrita").GIT_OPTIONAL_LOCKS).toBeUndefined();
  });

  it("o processo filho realmente não herda GIT_DIR do processo pai", async () => {
    process.env.GIT_DIR = join(raiz, "outro");
    try {
      const ex = new ExecutorVcs();
      const r = await ex.executar(["rev-parse", "--show-toplevel"], { cwd: repo });
      expect(r.stdout.trim()).toBe(repo);
    } finally {
      delete process.env.GIT_DIR;
    }
  });

  it("anexa -c core.quotepath=false: nomes com acento saem sem aspas", async () => {
    git(repo, "config", "core.quotepath", "true");
    const ex = new ExecutorVcs();
    const { escrever } = await import("../../../tests/fixtures/vcs/repos");
    escrever(repo, "ação.txt", "x");
    const r = await ex.executar(["status", "--porcelain=v1", "-z"], { cwd: repo });
    expect(r.stdout).toContain("ação.txt");
  });
});

describe("fila", () => {
  it("no máximo 4 leituras simultâneas por workspace; outro workspace não espera", async () => {
    const regLog = join(raiz, "conc.log");
    const falso = scriptExecutavel(
      join(raiz, "lento.sh"),
      `echo "i $$" >> "${regLog}"; sleep 0.25; echo "f $$" >> "${regLog}"`,
    );
    const ex = new ExecutorVcs();
    const outro = initRepo(join(raiz, "outro"));
    const mk = (cwd: string) => ex.executar(["x"], { cwd, executavel: falso, timeoutMs: 10_000 });
    await Promise.all([...Array.from({ length: 8 }, () => mk(repo)), mk(outro)]);
    const linhas = readFileSync(regLog, "utf8").trim().split("\n");
    let ativos = 0;
    let max = 0;
    for (const l of linhas) {
      ativos += l.startsWith("i") ? 1 : -1;
      max = Math.max(max, ativos);
    }
    // 8 em repo (4 + 4) e 1 em outro => no máximo 5 ao mesmo tempo, e o de "outro" não esperou os 8
    expect(max).toBeLessThanOrEqual(5);
    expect(max).toBeGreaterThanOrEqual(4);
    expect(ex.filasVivas()).toBe(0);
  });

  it("escritas do mesmo repositório rodam em série", async () => {
    const regLog = join(raiz, "ser.log");
    const falso = scriptExecutavel(join(raiz, "esc.sh"), `echo "i" >> "${regLog}"; sleep 0.1; echo "f" >> "${regLog}"`);
    const ex = new ExecutorVcs();
    await Promise.all(Array.from({ length: 4 }, () => ex.executar(["x"], { cwd: repo, executavel: falso, tipo: "escrita" })));
    expect(readFileSync(regLog, "utf8").trim().split("\n")).toEqual(["i", "f", "i", "f", "i", "f", "i", "f"]);
  });

  it("abortar enquanto espera na fila rejeita sem iniciar o processo", async () => {
    const marca = join(raiz, "rodou.log");
    const falso = scriptExecutavel(join(raiz, "m.sh"), `echo "x" >> "${marca}"; sleep 0.3`);
    const ex = new ExecutorVcs();
    const a = ex.executar(["x"], { cwd: repo, executavel: falso, tipo: "escrita" });
    const ac = new AbortController();
    const b = ex.executar(["x"], { cwd: repo, executavel: falso, tipo: "escrita", signal: ac.signal });
    ac.abort();
    await expect(b).rejects.toMatchObject({ name: "GitCanceladoErro" });
    await a;
    expect(readFileSync(marca, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("cancelar e timeout", () => {
  it("cancelar mata o processo E a árvore (neto do shell)", async () => {
    const pidArq = join(raiz, "neto.pid");
    const falso = scriptExecutavel(join(raiz, "arvore.sh"), `sleep 60 &\necho $! > "${pidArq}"\nwait`);
    const ex = new ExecutorVcs();
    const ac = new AbortController();
    const p = ex.executar(["x"], { cwd: repo, executavel: falso, signal: ac.signal, timeoutMs: 60_000 });
    expect(await espera(() => existsSync(pidArq) && readFileSync(pidArq, "utf8").trim() !== "")).toBe(true);
    const neto = Number(readFileSync(pidArq, "utf8").trim());
    expect(vivo(neto)).toBe(true);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "GitCanceladoErro" });
    expect(await espera(() => !vivo(neto))).toBe(true);
  });

  it("timeout mata a árvore e lança GitTimeoutErro", async () => {
    const pidArq = join(raiz, "neto2.pid");
    const falso = scriptExecutavel(join(raiz, "arvore2.sh"), `sleep 60 &\necho $! > "${pidArq}"\nwait`);
    const ex = new ExecutorVcs();
    await expect(ex.executar(["x"], { cwd: repo, executavel: falso, timeoutMs: 2500 })).rejects.toMatchObject({ name: "GitTimeoutErro" });
    const neto = Number(readFileSync(pidArq, "utf8").trim());
    expect(await espera(() => !vivo(neto))).toBe(true);
  });

  it("sinal já abortado nem inicia", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(new ExecutorVcs().executar(["status"], { cwd: repo, signal: ac.signal })).rejects.toMatchObject({ name: "GitCanceladoErro" });
  });
});

describe("saída", () => {
  it("streaming entrega pedaços e respeita o teto com truncamento explícito", async () => {
    const falso = scriptExecutavel(join(raiz, "grande.sh"), `head -c 200000 /dev/zero | tr '\\0' 'a'`);
    const ex = new ExecutorVcs();
    const pedacos: number[] = [];
    const r = await ex.executar(["x"], { cwd: repo, executavel: falso, maxBytes: 50_000, aoStdout: (b) => pedacos.push(b.length) });
    expect(r.truncado).toBe(true);
    expect(pedacos.reduce((a, b) => a + b, 0)).toBe(50_000);
    expect(r.stdout).toBe("");
  });

  it("encerrarNoLimite mata o processo que não para de escrever", async () => {
    const falso = scriptExecutavel(join(raiz, "infinito.sh"), `yes aaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
    const r = await new ExecutorVcs().executar(["x"], { cwd: repo, executavel: falso, maxBytes: 10_000, encerrarNoLimite: true, timeoutMs: 10_000 });
    expect(r.truncado).toBe(true);
    expect(r.encerradoPorLimite).toBe(true);
  });
});

describe("index.lock", () => {
  it("lock de outro processo vira GitIndexLockErro depois de tentativas curtas", async () => {
    const { escrever } = await import("../../../tests/fixtures/vcs/repos");
    escrever(repo, "novo.txt", "x");
    escrever(repo, ".git/index.lock", "");
    const ex = new ExecutorVcs({ esperaLockMs: [10, 20] });
    await expect(ex.executar(["add", "novo.txt"], { cwd: repo, tipo: "escrita" })).rejects.toMatchObject({ name: "GitIndexLockErro", tentativas: 3 });
  });

  it("lock liberado durante as tentativas: o comando acaba dando certo", async () => {
    const { escrever } = await import("../../../tests/fixtures/vcs/repos");
    const { rmSync } = await import("node:fs");
    escrever(repo, "novo.txt", "x");
    escrever(repo, ".git/index.lock", "");
    setTimeout(() => rmSync(join(repo, ".git/index.lock"), { force: true }), 60);
    const ex = new ExecutorVcs({ esperaLockMs: [40, 80, 160, 320] });
    const r = await ex.executar(["add", "novo.txt"], { cwd: repo, tipo: "escrita" });
    expect(r.codigo).toBe(0);
    expect(git(repo, "status", "--porcelain")).toContain("A  novo.txt");
  });
});

describe("P-12", () => {
  it("o event loop segue girando durante uma chamada lenta", async () => {
    const falso = scriptExecutavel(join(raiz, "lento2.sh"), `sleep 0.4`);
    let maiorAtraso = 0;
    let ultimo = performance.now();
    const t = setInterval(() => {
      const agora = performance.now();
      maiorAtraso = Math.max(maiorAtraso, agora - ultimo - 10);
      ultimo = agora;
    }, 10);
    await new ExecutorVcs().executar(["x"], { cwd: repo, executavel: falso });
    clearInterval(t);
    expect(maiorAtraso).toBeLessThan(50);
  });
});
