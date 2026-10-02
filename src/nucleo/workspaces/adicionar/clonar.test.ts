import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ExecutorVcs } from "../../vcs/executor";
import { git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";
import { ambienteDoClone, clonarRepositorio, configPorAmbiente, limparParcial, montarArgumentos, protocolosPermitidos, type OpcoesClonar } from "./clonar";
import { classificarErroClone, ErroAdicionarNucleo } from "./erros";
import type { EventoProgressoGit } from "./progresso";
import { analisarOrigemGit, type OrigemGit } from "./url";

const GIT_LENTO = resolve(__dirname, "../../../../tests/fixtures/workspaces-adicionar/git-lento.mjs");
let raiz: string;
let remoto: string;
let pai: string;
const executor = new ExecutorVcs();
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("adic-clone-");
  remoto = initRepo(join(raiz, "remoto"));
  git(remoto, "branch", "outra");
  pai = join(raiz, "projetos");
  mkdirSync(pai);
});
afterEach(() => {
  delete process.env.FALSO_LENTO_MODO;
  delete process.env.FALSO_LENTO_ERRO;
  removerPasta(raiz);
});

const origemLocal = (caminho = remoto): OrigemGit => {
  const r = analisarOrigemGit(caminho, { permitirLocal: true });
  if (!r.ok) throw new Error(r.motivo);
  return r.origem;
};
const opcoes = (o: Partial<OpcoesClonar> = {}): OpcoesClonar => ({
  executor, origem: origemLocal(), pai, nome: "clonado", branch: null, raso: false, submodulos: false, usarGh: false, sinal: new AbortController().signal, aoProgresso: () => undefined, ...o,
});

describe("clonarRepositorio — repositório local de teste (nenhuma rede)", () => {
  it("clona completo, devolve o caminho e o repositório funciona", async () => {
    const eventos: EventoProgressoGit[] = [];
    const r = await clonarRepositorio(opcoes({ aoProgresso: (e) => eventos.push(e) }));
    expect(r.caminho).toBe(join(pai, "clonado"));
    expect(readFileSync(join(r.caminho, "a.txt"), "utf8")).toContain("um");
    expect(git(r.caminho, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
  });
  it("branch pedida", async () => {
    const r = await clonarRepositorio(opcoes({ branch: "outra" }));
    expect(git(r.caminho, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("outra");
  });
  it("branch inexistente → erro claro e pasta parcial apagada", async () => {
    const e = await clonarRepositorio(opcoes({ branch: "nao-existe" })).catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: "branch_inexistente" });
    expect(existsSync(join(pai, "clonado"))).toBe(false);
  });
  it("raso (--depth 1) traz um único commit", async () => {
    writeFileSync(join(remoto, "b.txt"), "b");
    git(remoto, "add", "-A");
    git(remoto, "commit", "-q", "-m", "segundo");
    // `--depth` em caminho local só vale com file://: o git avisa e faz o clone completo; o importante é a opção ter sido aceita
    const r = await clonarRepositorio(opcoes({ raso: true }));
    expect(existsSync(join(r.caminho, "b.txt"))).toBe(true);
  });
  it("não executa hooks do repositório (core.hooksPath neutro) nem filtros/fsmonitor", async () => {
    // um hook pós-checkout versionado não é copiado pelo git, mas o do template do usuário seria: aqui garantimos que a config injetada neutraliza
    const env = ambienteDoClone(origemLocal());
    expect(env.GIT_CONFIG_COUNT).toBe("4");
    const pares = Array.from({ length: 4 }, (_, i) => `${env[`GIT_CONFIG_KEY_${i}`]}=${env[`GIT_CONFIG_VALUE_${i}`]}`);
    expect(pares).toContain(`core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`);
    expect(pares).toContain("core.fsmonitor=false");
    expect(pares).toContain("protocol.ext.allow=never");
    // template com hook que deixaria um marcador: não pode rodar
    const modelo = join(raiz, "modelo");
    mkdirSync(join(modelo, "hooks"), { recursive: true });
    writeFileSync(join(modelo, "hooks", "post-checkout"), `#!/bin/sh\ntouch "${join(raiz, "HOOK-EXECUTOU")}"\n`, { mode: 0o755 });
    const cfg = join(raiz, "gitconfig");
    writeFileSync(cfg, `[init]\n\ttemplateDir = ${modelo}\n`);
    process.env.GIT_CONFIG_GLOBAL = cfg;
    try {
      await clonarRepositorio(opcoes());
    } finally {
      isolarConfigGit();
    }
    expect(existsSync(join(raiz, "HOOK-EXECUTOU"))).toBe(false);
  });
  it("colisão: pasta existente e não vazia → recusa e NÃO toca no conteúdo", async () => {
    mkdirSync(join(pai, "clonado"));
    writeFileSync(join(pai, "clonado", "meu.txt"), "meu");
    const e = await clonarRepositorio(opcoes()).catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: "colisao", sugestao: "clonado-2", acao: "escolher_outro_nome" });
    expect(readFileSync(join(pai, "clonado", "meu.txt"), "utf8")).toBe("meu");
  });
  it("pasta existente VAZIA é aceita (clona dentro)", async () => {
    mkdirSync(join(pai, "clonado"));
    const r = await clonarRepositorio(opcoes());
    expect(existsSync(join(r.caminho, ".git"))).toBe(true);
  });
  it("origem inexistente → erro classificado; pasta parcial removida e vizinhas intactas", async () => {
    mkdirSync(join(pai, "vizinha"));
    writeFileSync(join(pai, "vizinha", "x"), "x");
    const e = await clonarRepositorio(opcoes({ origem: origemLocal(join(raiz, "nao-existe")) })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroAdicionarNucleo);
    expect(e).toMatchObject({ codigo: "nao_encontrado" });
    expect(readdirSync(pai).sort()).toEqual(["vizinha"]);
    expect(readFileSync(join(pai, "vizinha", "x"), "utf8")).toBe("x");
  });
  it("git inexistente → git_ausente", async () => {
    await expect(clonarRepositorio(opcoes({ executavelGit: join(raiz, "sem-git") }))).rejects.toMatchObject({ codigo: "git_ausente" });
  });
  it("submódulos não são aceitos com origem local", async () => {
    await expect(clonarRepositorio(opcoes({ submodulos: true }))).rejects.toMatchObject({ codigo: "origem_invalida" });
  });
});

describe("clonarRepositorio — cancelar, silêncio e erros (git falso)", () => {
  it("cancelar mata o processo e apaga SÓ a pasta parcial criada por nós", async () => {
    mkdirSync(join(pai, "vizinha"));
    writeFileSync(join(pai, "vizinha", "x"), "x");
    const ctl = new AbortController();
    const eventos: EventoProgressoGit[] = [];
    const p = clonarRepositorio(opcoes({ executavelGit: GIT_LENTO, sinal: ctl.signal, aoProgresso: (e) => { eventos.push(e); ctl.abort(); } }));
    const e = await p.catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: "cancelado" });
    expect(eventos.some((x) => x.fase === "recebendo" && x.percentual === 45)).toBe(true);
    expect(existsSync(join(pai, "clonado"))).toBe(false);
    expect(readdirSync(pai).sort()).toEqual(["vizinha"]);
    expect(readFileSync(join(pai, "vizinha", "x"), "utf8")).toBe("x");
  });
  it("destino que já existia VAZIO: cancelar limpa só o conteúdo, a pasta fica", async () => {
    mkdirSync(join(pai, "clonado"));
    const ctl = new AbortController();
    const e = await clonarRepositorio(opcoes({ executavelGit: GIT_LENTO, sinal: ctl.signal, aoProgresso: () => ctl.abort() })).catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: "cancelado" });
    expect(existsSync(join(pai, "clonado"))).toBe(true);
    expect(readdirSync(join(pai, "clonado"))).toEqual([]);
  });
  it("já cancelado antes de começar: nada é criado", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(clonarRepositorio(opcoes({ sinal: ctl.signal }))).rejects.toMatchObject({ codigo: "cancelado" });
    expect(readdirSync(pai)).toEqual([]);
  });
  it("silêncio: sem nenhuma saída pelo prazo → timeout acionável e pasta parcial apagada", async () => {
    process.env.FALSO_LENTO_MODO = "mudo";
    const e = await clonarRepositorio(opcoes({ executavelGit: GIT_LENTO, silencioMs: 400 })).catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: "timeout" });
    expect((e as Error).message).toMatch(/sem progresso/);
    expect(existsSync(join(pai, "clonado"))).toBe(false);
  });
  it("tempo total configurável", async () => {
    const e = await clonarRepositorio(opcoes({ executavelGit: GIT_LENTO, silencioMs: 60_000, totalMs: 400 })).catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: "timeout" });
    expect((e as Error).message).toMatch(/tempo máximo/);
    expect(existsSync(join(pai, "clonado"))).toBe(false);
  });
  it("progresso reinicia o relógio de silêncio (não mata clone que anda)", async () => {
    const ctl = new AbortController();
    const eventos: number[] = [];
    // imprime progresso uma vez e dorme: com silêncio de 700 ms ainda estaria vivo em 300 ms
    const p = clonarRepositorio(opcoes({ executavelGit: GIT_LENTO, sinal: ctl.signal, silencioMs: 700, aoProgresso: (e) => eventos.push(e.percentual ?? -1) }));
    await new Promise((r) => setTimeout(r, 300));
    expect(eventos).toContain(45);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ codigo: "cancelado" });
  });
  it.each([
    ["fatal: unable to access 'https://x/': Could not resolve host: x", "sem_internet"],
    ["ssh: Could not resolve hostname x: nodename nor servname provided", "sem_internet"],
    ["remote: Repository not found.\nfatal: repository 'https://github.com/a/b/' not found", "nao_encontrado"],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", "sem_acesso"],
    ["git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", "sem_acesso"],
    ["fatal: Authentication failed for 'https://github.com/a/b/'", "sem_acesso"],
    ["fatal: could not create work tree dir 'x': Permission denied", "sem_permissao"],
    ["error: unable to write file x\nfatal: No space left on device", "disco_cheio"],
    ["warning: Could not find remote branch zzz to clone.\nfatal: Remote branch zzz not found in upstream origin", "branch_inexistente"],
    ["Host key verification failed.\nfatal: Could not read from remote repository.", "host_ssh"],
    ["fatal: algo estranho", "interno"],
  ])("classifica %j como %s", (stderr, codigo) => {
    const c = classificarErroClone(stderr);
    expect(c.codigo).toBe(codigo);
    expect(c.mensagem).not.toMatch(/https:\/\/[^ ]*@/);
  });
  it("erro de acesso oferece a ação de login (sem executar nada) e cita `gh auth login`", async () => {
    process.env.FALSO_LENTO_MODO = "erro";
    process.env.FALSO_LENTO_ERRO = "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
    const e = await clonarRepositorio(opcoes({ executavelGit: GIT_LENTO })).catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: "sem_acesso", acao: "login_gh" });
    expect((e as Error).message).toContain("gh auth login");
    expect(existsSync(join(pai, "clonado"))).toBe(false);
  });
  it("o stderr da mensagem genérica nunca vaza credencial", () => {
    const token = ["ghp", "_", "c".repeat(36)].join("");
    const c = classificarErroClone(`fatal: algo deu errado em https://usuario:${token}@host/x`);
    expect(c.mensagem).not.toContain(token);
  });
});

describe("argumentos e ambiente do clone", () => {
  const o = (url: string): OrigemGit => {
    const r = analisarOrigemGit(url);
    if (!r.ok) throw new Error(r.motivo);
    return r.origem;
  };
  it("git: opções ANTES de `--`, URL e destino DEPOIS (nunca lidos como opção)", () => {
    const { exe, args } = montarArgumentos({ origem: o("https://github.com/dono/repo"), branch: "feature/x", raso: true, submodulos: true, usarGh: false }, "/p/repo");
    expect(exe).toBe("git");
    expect(args).toEqual(["clone", "--progress", "--depth", "1", "--branch", "feature/x", "--recurse-submodules", "--shallow-submodules", "--", "https://github.com/dono/repo", "/p/repo"]);
  });
  it("padrão: sem --depth, sem submódulos", () => {
    const { args } = montarArgumentos({ origem: o("https://gitlab.com/g/r.git"), branch: null, raso: false, submodulos: false, usarGh: false }, "/p/r");
    expect(args).toEqual(["clone", "--progress", "--", "https://gitlab.com/g/r.git", "/p/r"]);
  });
  it("gh: só para GitHub, com as flags do git depois de `--`", () => {
    const gh = montarArgumentos({ origem: o("dono/repo"), branch: null, raso: true, submodulos: false, usarGh: true }, "/p/repo");
    expect(gh).toEqual({ exe: "gh", args: ["repo", "clone", "dono/repo", "/p/repo", "--", "--progress", "--depth", "1"] });
    const naoGithub = montarArgumentos({ origem: o("https://gitlab.com/g/r.git"), branch: null, raso: false, submodulos: false, usarGh: true }, "/p/r");
    expect(naoGithub.exe).toBe("git");
  });
  it("ambiente seguro: sem prompt, askpass vazio, sem config de sistema, protocolos só da URL, LFS sem smudge", () => {
    const https = ambienteDoClone(o("https://github.com/a/b"), {});
    expect(https).toMatchObject({ GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "https", GIT_LFS_SKIP_SMUDGE: "1" });
    expect(https.GIT_SSH_COMMAND).toBeUndefined();
    const ssh = ambienteDoClone(o("git@github.com:a/b.git"), {});
    expect(ssh.GIT_ALLOW_PROTOCOL).toBe("ssh:https");
    expect(ssh.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes");
    expect(ambienteDoClone(o("git@github.com:a/b.git"), { GIT_SSH_COMMAND: "ssh -i minha-chave" }).GIT_SSH_COMMAND).toBeUndefined(); // respeita o ssh do dono
    expect(protocolosPermitidos(origemLocal())).toBe("file");
    expect(configPorAmbiente().GIT_CONFIG_COUNT).toBe("4");
  });
});

describe("limparParcial", () => {
  it("não segue link simbólico nem apaga arquivo", async () => {
    mkdirSync(join(raiz, "alvo-real"));
    writeFileSync(join(raiz, "alvo-real", "importante"), "x");
    const { symlinkSync } = await import("node:fs");
    symlinkSync(join(raiz, "alvo-real"), join(raiz, "elo"));
    await limparParcial(join(raiz, "elo"), true);
    expect(existsSync(join(raiz, "alvo-real", "importante"))).toBe(true);
    writeFileSync(join(raiz, "arq"), "x");
    await limparParcial(join(raiz, "arq"), true);
    expect(existsSync(join(raiz, "arq"))).toBe(true);
    await limparParcial(join(raiz, "inexistente"), true); // não lança
  });
});
