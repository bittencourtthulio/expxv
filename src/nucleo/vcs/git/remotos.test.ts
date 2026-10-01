import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classificarErroRemoto, criarFetchSegundoPlano, fetchRemoto, forceWithLease, listarRemotos, preferenciaPull, pullRemoto, pushRemoto, PushRejeitadoErro, RemotoAutenticacaoErro, RemotoSemRedeErro, semCredenciais } from "./remotos";
import { ExecutorVcs } from "../executor";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta, scriptExecutavel } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
let bare: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-rm-");
  repo = initRepo(join(raiz, "r"));
  bare = join(raiz, "remoto.git");
  git(raiz, "init", "-q", "--bare", "-b", "main", bare);
  git(repo, "remote", "add", "origin", `file://${bare}`);
  git(repo, "push", "-q", "-u", "origin", "main");
});
afterEach(() => removerPasta(raiz));

/** Clone "de outro usuário" que empurra um commit para o remoto. */
function outroEmpurra(arquivo = "o.txt", ramo = "main"): string {
  const outro = join(raiz, `outro-${Math.random().toString(36).slice(2, 6)}`);
  git(raiz, "clone", "-q", `file://${bare}`, outro);
  git(outro, "config", "user.name", "Outro");
  git(outro, "config", "user.email", "o@example.invalid");
  git(outro, "switch", "-q", ramo);
  escrever(outro, arquivo, "outro\n");
  commit(outro, "do outro");
  git(outro, "push", "-q", "origin", ramo);
  return git(outro, "rev-parse", "HEAD").trim();
}

describe("listar remotos e credenciais", () => {
  it("lista múltiplos remotos e remove credenciais das URLs (e avisa)", async () => {
    git(repo, "remote", "add", "up", "https://usuario:segredo123@exemplo.invalid/o/r.git");
    git(repo, "remote", "add", "tok", "https://ghp_TOKENXYZ@exemplo.invalid/o/r.git");
    git(repo, "remote", "set-url", "--push", "up", "ssh://git@exemplo.invalid/o/r.git");
    const l = await listarRemotos(repo);
    expect(l.map((r) => r.nome)).toEqual(["origin", "tok", "up"]);
    expect(JSON.stringify(l)).not.toMatch(/segredo123|ghp_TOKENXYZ/);
    expect(l.find((r) => r.nome === "up")).toMatchObject({ url: "https://exemplo.invalid/o/r.git", urlPush: "ssh://git@exemplo.invalid/o/r.git", credenciaisNaUrl: true });
    expect(l.find((r) => r.nome === "origin")?.credenciaisNaUrl).toBe(false);
    expect(semCredenciais("fatal: unable to access 'https://u:p@h.invalid/x.git/': no")).toBe("fatal: unable to access 'https://h.invalid/x.git/': no");
  });

  it("erro de autenticação vira erro nominal com instrução, sem vazar a senha da URL", async () => {
    const e = classificarErroRemoto("fatal: could not read Username for 'https://u:senhasecreta@github.com': terminal prompts disabled");
    expect(e).toBeInstanceOf(RemotoAutenticacaoErro);
    expect(e?.message).toMatch(/credential helper.*ssh-agent.*gh auth login/);
    expect(JSON.stringify([e?.message, e?.stderr])).not.toContain("senhasecreta");
    expect(classificarErroRemoto("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.")).toBeInstanceOf(RemotoAutenticacaoErro);
    expect(classificarErroRemoto("fatal: unable to access 'https://x/': Could not resolve host: x")).toBeInstanceOf(RemotoSemRedeErro);
  });
});

describe("fetch", () => {
  it("traz commits do remoto sem mexer na árvore; remoto inexistente e nome malicioso viram erro", async () => {
    outroEmpurra();
    const r = await fetchRemoto(repo, {});
    expect(r.atualizacoes).toBeGreaterThan(0);
    expect(git(repo, "log", "--format=%s", "origin/main", "-1").trim()).toBe("do outro");
    expect(git(repo, "status", "--porcelain").trim()).toBe("");
    await expect(fetchRemoto(repo, { remoto: "nao-existe" })).rejects.toMatchObject({ name: "RemotoInexistenteErro" });
    for (const n of ["--all", "-x", "--upload-pack=touch /tmp/pwn-rm", "origin;touch"]) await expect(fetchRemoto(repo, { remoto: n })).rejects.toThrow();
  });

  it("sem rede: erro nominal rápido (conexão recusada) e por tempo limite configurável (servidor mudo)", async () => {
    git(repo, "remote", "add", "morto", "http://127.0.0.1:1/x.git");
    const t0 = performance.now();
    await expect(fetchRemoto(repo, { remoto: "morto" })).rejects.toBeInstanceOf(RemotoSemRedeErro);
    expect(performance.now() - t0).toBeLessThan(5000);

    const mudo: Server = createServer(() => undefined);
    await new Promise<void>((ok) => mudo.listen(0, "127.0.0.1", ok));
    const porta = (mudo.address() as { port: number }).port;
    git(repo, "remote", "add", "mudo", `http://127.0.0.1:${porta}/x.git`);
    const t1 = performance.now();
    try {
      await expect(fetchRemoto(repo, { remoto: "mudo", timeoutMs: 600 })).rejects.toBeInstanceOf(RemotoSemRedeErro);
      expect(performance.now() - t1).toBeLessThan(4000);
    } finally {
      (mudo as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      mudo.close();
    }
  });

  it("segundo plano: só com a janela em foco, 1 por vez, pausável, sem bloquear o main", async () => {
    outroEmpurra();
    let foco = false;
    const bg = criarFetchSegundoPlano({ janelaEmFoco: () => foco });
    expect(await bg.tentar(repo)).toEqual({ executado: false, motivo: "sem-foco" });
    foco = true;
    bg.pausar();
    expect(await bg.tentar(repo)).toEqual({ executado: false, motivo: "pausado" });
    bg.retomar();
    // mede o atraso máximo do event loop enquanto o fetch roda
    let maxAtraso = 0;
    let ultimo = performance.now();
    const t = setInterval(() => {
      const agora = performance.now();
      maxAtraso = Math.max(maxAtraso, agora - ultimo - 5);
      ultimo = agora;
    }, 5);
    const [a, b] = await Promise.all([bg.tentar(repo), bg.tentar(repo)]);
    clearInterval(t);
    const motivos = [a, b].map((x) => (x.executado ? "ok" : x.motivo)).sort();
    expect(motivos).toEqual(["ocupado", "ok"].sort());
    expect(maxAtraso).toBeLessThan(50);
    expect(bg.ativo()).toBe(false);
    expect(git(repo, "log", "--format=%s", "origin/main", "-1").trim()).toBe("do outro");
  });

  it("pausar aborta o fetch em curso", async () => {
    const mudo: Server = createServer(() => undefined);
    await new Promise<void>((ok) => mudo.listen(0, "127.0.0.1", ok));
    git(repo, "remote", "add", "mudo", `http://127.0.0.1:${(mudo.address() as { port: number }).port}/x.git`);
    const bg = criarFetchSegundoPlano({ janelaEmFoco: () => true, timeoutMs: 20_000 });
    const p = bg.tentar(repo, "mudo");
    await new Promise((r) => setTimeout(r, 300));
    expect(bg.ativo()).toBe(true);
    bg.pausar();
    expect(await p).toEqual({ executado: false, motivo: "pausado" });
    expect(bg.ativo()).toBe(false);
    (mudo as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    mudo.close();
  });
});

describe("pull", () => {
  it("--ff-only por padrão; divergência vira erro com opções; merge/rebase por escolha; config respeitada e não escrita", async () => {
    git(repo, "switch", "-q", "-c", "trabalho");
    git(repo, "branch", "-q", "-u", "origin/main");
    outroEmpurra();
    escrever(repo, "local.txt", "l\n");
    commit(repo, "local");
    expect(await preferenciaPull(repo)).toBeNull();
    await expect(pullRemoto(repo, { origem: "usuario" })).rejects.toMatchObject({ name: "PullDivergenteErro", opcoes: expect.any(Array) });
    const r = await pullRemoto(repo, { origem: "usuario", modo: "rebase" });
    expect(r).toMatchObject({ resultado: "ok", modoUsado: "rebase" });
    expect(git(repo, "log", "--format=%s", "-2").trim().split("\n")).toEqual(["local", "do outro"]);
    expect(() => git(repo, "config", "--local", "--get", "pull.rebase")).toThrow(); // nunca escrito

    git(repo, "config", "pull.rebase", "false");
    expect(await preferenciaPull(repo)).toBe("false");
    outroEmpurra("o2.txt");
    const m = await pullRemoto(repo, { origem: "usuario" }); // sem modo + config => respeita a config (merge)
    expect(m).toMatchObject({ resultado: "ok", modoUsado: "config" });
    expect(git(repo, "log", "-1", "--format=%P").trim().split(" ")).toHaveLength(2);
    expect(git(repo, "config", "--local", "--get", "pull.rebase").trim()).toBe("false");
    expect((await pullRemoto(repo, { origem: "usuario" })).resultado).toBe("ja-atualizado");
  });

  it("automação na branch padrão é recusada; simular lista o que entraria; conflito devolve estado", async () => {
    await expect(pullRemoto(repo, { origem: "automacao" })).rejects.toMatchObject({ motivo: "automacao-ramo-padrao" });
    git(repo, "switch", "-q", "-c", "trabalho");
    git(repo, "branch", "-q", "-u", "origin/main");
    outroEmpurra("a.txt");
    git(repo, "fetch", "-q");
    const sim = await pullRemoto(repo, { origem: "automacao", simular: true });
    expect(sim.entrariam?.map((c) => c.assunto)).toEqual(["do outro"]);
    escrever(repo, "a.txt", "local conflitante\n");
    commit(repo, "conflita");
    const c = await pullRemoto(repo, { origem: "usuario", modo: "merge" });
    expect(c).toMatchObject({ resultado: "conflito", estado: { operacao: "merge", conflitos: ["a.txt"] } });
    git(repo, "merge", "--abort");
  });
});

describe("push", () => {
  it("upstream automático só quando não há; nunca --force; múltiplos remotos", async () => {
    git(repo, "switch", "-q", "-c", "feature/x");
    escrever(repo, "x.txt", "x\n");
    commit(repo, "x");
    const r = await pushRemoto(repo, { origem: "usuario" });
    expect(r).toMatchObject({ remoto: "origin", ramo: "feature/x", upstreamDefinido: true });
    expect(git(repo, "rev-parse", "--abbrev-ref", "feature/x@{upstream}").trim()).toBe("origin/feature/x");
    escrever(repo, "y.txt", "y\n");
    commit(repo, "y");
    expect(await pushRemoto(repo, { origem: "usuario" })).toMatchObject({ upstreamDefinido: false });
    expect(git(bare, "log", "--format=%s", "-1", "feature/x").trim()).toBe("y");
    const bare2 = join(raiz, "remoto2.git");
    git(raiz, "init", "-q", "--bare", "-b", "main", bare2);
    git(repo, "remote", "add", "espelho", `file://${bare2}`);
    expect(await pushRemoto(repo, { origem: "usuario", remoto: "espelho" })).toMatchObject({ remoto: "espelho" });
    expect(git(bare2, "log", "--format=%s", "-1", "feature/x").trim()).toBe("y");
    await expect(pushRemoto(repo, { origem: "usuario", remoto: "--force" })).rejects.toThrow();
    await expect(pushRemoto(repo, { origem: "usuario", ramo: "--delete" })).rejects.toThrow();
  });

  it("automação não envia para a branch padrão nem com ramo explícito", async () => {
    await expect(pushRemoto(repo, { origem: "automacao" })).rejects.toMatchObject({ motivo: "automacao-ramo-padrao" });
    git(repo, "switch", "-q", "-c", "t");
    await expect(pushRemoto(repo, { origem: "automacao", ramo: "main" })).rejects.toMatchObject({ motivo: "automacao-ramo-padrao" });
  });

  it("rejeitado (não fast-forward): explica o porquê e devolve as opções seguras", async () => {
    outroEmpurra();
    escrever(repo, "mine.txt", "m\n");
    commit(repo, "meu");
    const e = await pushRemoto(repo, { origem: "usuario" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PushRejeitadoErro);
    const rej = e as PushRejeitadoErro;
    expect(rej.motivo).toBe("nao-fast-forward");
    expect(rej.explicacao).toMatch(/commits que você não tem/);
    expect(rej.opcoes.join(" ")).toMatch(/pull --ff-only.*merge\/rebase/);
    expect(rej.opcoes.join(" ")).toMatch(/lease/);
    expect(git(bare, "log", "--format=%s", "-1", "main").trim()).toBe("do outro"); // nada foi sobrescrito
  });

  it("hook do remoto que recusa vira PushRejeitado(hook)", async () => {
    scriptExecutavel(join(bare, "hooks/pre-receive"), "echo 'bloqueado pela politica' >&2\nexit 1");
    git(repo, "switch", "-q", "-c", "h");
    escrever(repo, "h.txt", "h\n");
    commit(repo, "h");
    await expect(pushRemoto(repo, { origem: "usuario" })).rejects.toMatchObject({ name: "PushRejeitadoErro", motivo: "hook" });
  });

  it("sem rede e autenticação: erros nominais; GIT_TERMINAL_PROMPT=0 (nunca trava esperando senha)", async () => {
    git(repo, "switch", "-q", "-c", "n");
    git(repo, "remote", "add", "morto", "http://127.0.0.1:1/x.git");
    await expect(pushRemoto(repo, { origem: "usuario", remoto: "morto" })).rejects.toBeInstanceOf(RemotoSemRedeErro);
    const cap = join(raiz, "env.txt");
    const fake = scriptExecutavel(join(raiz, "git-espiao"), `echo "$GIT_TERMINAL_PROMPT" > '${cap}'\nexec git "$@"`);
    await fetchRemoto(repo, { executavel: fake });
    expect(readFileSync(cap, "utf8").trim()).toBe("0");
  });
});

describe("force-with-lease (manual)", () => {
  /** Remoto tem 1 commit do outro além do que eu tenho; reescrevo minha branch `rascunho`. */
  async function cenario(): Promise<{ esperado: string }> {
    git(repo, "switch", "-q", "-c", "rascunho");
    escrever(repo, "r.txt", "r1\n");
    commit(repo, "r1");
    git(repo, "push", "-q", "-u", "origin", "rascunho");
    const esperado = outroEmpurra("o.txt", "rascunho");
    git(repo, "fetch", "-q");
    git(repo, "reset", "-q", "--hard", "HEAD~0");
    escrever(repo, "r2.txt", "r2\n");
    commit(repo, "r2 meu");
    return { esperado };
  }

  it("simula (lista commits remotos que seriam sobrescritos) e só executa com a confirmação digitada igual ao nome", async () => {
    const { esperado } = await cenario();
    const sim = await forceWithLease(repo, { ramo: "rascunho", refEsperada: esperado, origem: "usuario", simular: true });
    expect(sim).toMatchObject({ simulado: true, enviado: false });
    expect(sim.sobrescreveria.map((c) => c.assunto)).toEqual(["do outro"]);
    await expect(forceWithLease(repo, { ramo: "rascunho", refEsperada: esperado, origem: "usuario" })).rejects.toMatchObject({ motivo: "confirmacao-invalida" });
    await expect(forceWithLease(repo, { ramo: "rascunho", refEsperada: esperado, origem: "usuario", confirmacao: "outro-nome" })).rejects.toMatchObject({ motivo: "confirmacao-invalida" });
    expect(git(bare, "log", "--format=%s", "-1", "rascunho").trim()).toBe("do outro");
    const r = await forceWithLease(repo, { ramo: "rascunho", refEsperada: esperado, origem: "usuario", confirmacao: "rascunho" });
    expect(r).toMatchObject({ simulado: false, enviado: true });
    expect(r.sobrescreveria.map((c) => c.assunto)).toEqual(["do outro"]);
    expect(git(bare, "log", "--format=%s", "-1", "rascunho").trim()).toBe("r2 meu");
  });

  it("recusa: automação, branch padrão (mesmo digitando), hash inválido; lease desatualizado é rejeitado pelo remoto", async () => {
    const { esperado } = await cenario();
    await expect(forceWithLease(repo, { ramo: "rascunho", refEsperada: esperado, origem: "automacao", confirmacao: "rascunho" })).rejects.toMatchObject({ motivo: "origem-invalida" });
    await expect(forceWithLease(repo, { ramo: "main", refEsperada: esperado, origem: "usuario", confirmacao: "main" })).rejects.toMatchObject({ motivo: "ramo-padrao" });
    await expect(forceWithLease(repo, { ramo: "main", refEsperada: esperado, origem: "usuario", simular: true })).rejects.toMatchObject({ motivo: "ramo-padrao" });
    await expect(forceWithLease(repo, { ramo: "rascunho", refEsperada: "--force", origem: "usuario", confirmacao: "rascunho" })).rejects.toMatchObject({ motivo: "confirmacao-invalida" });
    await expect(forceWithLease(repo, { ramo: "--force", refEsperada: esperado, origem: "usuario", confirmacao: "--force" })).rejects.toThrow();
    // o remoto mudou de novo depois que o usuário viu `esperado`
    outroEmpurra("o3.txt", "rascunho");
    await expect(forceWithLease(repo, { ramo: "rascunho", refEsperada: esperado, origem: "usuario", confirmacao: "rascunho" })).rejects.toMatchObject({ name: "PushRejeitadoErro", motivo: "lease" });
  });
});

describe("executor cru continua sem push forçado", () => {
  it("rodarGit recusa push (a única via é remotos.ts)", async () => {
    const { rodarGit } = await import("./comum");
    expect(() => rodarGit(repo, ["push", "--force", "origin", "main"])).toThrow();
    void new ExecutorVcs();
  });
});
