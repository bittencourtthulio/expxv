import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOGO_TERMINAIS } from "./catalogo";
import { DetectorFerramentas, RegistroExecutaveis, detectarFerramentas, diretoriosConvencionais, lerVersao, resolverPathDoShellDeLogin } from "./deteccao";

const temporarios: string[] = [];
function temporario(): string {
  const dir = mkdtempSync(join(tmpdir(), "expx-det-"));
  temporarios.push(dir);
  return dir;
}
afterEach(() => temporarios.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function executavel(dir: string, nome: string, corpo = "#!/bin/sh\n", modo = 0o755): string {
  mkdirSync(dir, { recursive: true });
  const caminho = join(dir, nome);
  writeFileSync(caminho, corpo);
  chmodSync(caminho, modo);
  return caminho;
}
const SEM_RECURSOS = { diretorios_convencionais: [] as string[] };

describe("detecção: PATH, candidatos e permissões", () => {
  it("resolve no PATH macOS (com espaço no caminho), sem executar nada, e distingue ausente/sem_permissao", () => {
    const dir = join(temporario(), "Aplicativos com espaço");
    executavel(dir, "codex", "#!/bin/sh\necho NAO_EXECUTAR > marcador\n");
    executavel(dir, "claude", "", 0o644);
    const r = detectarFerramentas({ plataforma: "darwin", path: dir, ...SEM_RECURSOS });
    expect(r.find((f) => f.id === "codex")).toMatchObject({ instalado: true, erro_codigo: null, modo_lancamento: "direto", versao: null });
    expect(r.find((f) => f.id === "claude")).toMatchObject({ instalado: false, erro_codigo: "sem_permissao", executavel_id: null });
    expect(r.find((f) => f.id === "gemini")).toMatchObject({ instalado: false, erro_codigo: "ausente" });
    expect(r.map((f) => f.id)).toEqual(CATALOGO_TERMINAIS.map((f) => f.id));
  });

  it("ordem: diretório do PATH antes do convencional; dentro do diretório, o primeiro nome candidato", () => {
    const a = temporario();
    const b = temporario();
    const c = temporario();
    const doA = executavel(a, "claude");
    executavel(b, "claude");
    const r = detectarFerramentas({ plataforma: "darwin", path: `${a}:${b}`, diretorios_convencionais: [c] });
    const reg = new RegistroExecutaveis({ plataforma: "darwin" });
    const r2 = detectarFerramentas({ plataforma: "darwin", path: `${a}:${b}`, diretorios_convencionais: [c], registro: reg });
    expect(reg.obter(r2.find((f) => f.id === "claude")!.executavel_id!)?.caminho).toBe(realpathSync(doA));
    expect(r.find((f) => f.id === "claude")?.instalado).toBe(true);
    // só no convencional: também é achado
    const so = detectarFerramentas({ plataforma: "darwin", path: "", diretorios_convencionais: [executavel(c, "kilocode") && c] });
    expect(so.find((f) => f.id === "kilo")?.instalado).toBe(true);
    // kilo vem antes de kilocode no mesmo diretório
    const d = temporario();
    const kilo = executavel(d, "kilo");
    executavel(d, "kilocode");
    const reg2 = new RegistroExecutaveis({ plataforma: "darwin" });
    const r3 = detectarFerramentas({ plataforma: "darwin", path: d, ...SEM_RECURSOS, registro: reg2 });
    expect(reg2.obter(r3.find((f) => f.id === "kilo")!.executavel_id!)?.caminho).toBe(realpathSync(kilo));
  });

  it("realpath: atalho simbólico aponta para o arquivo real", () => {
    const dir = temporario();
    const real = executavel(join(dir, "real"), "claude-real");
    mkdirSync(join(dir, "bin"));
    symlinkSync(real, join(dir, "bin", "claude"));
    const reg = new RegistroExecutaveis({ plataforma: "darwin" });
    const r = detectarFerramentas({ plataforma: "darwin", path: join(dir, "bin"), ...SEM_RECURSOS, registro: reg });
    expect(reg.obter(r.find((f) => f.id === "claude")!.executavel_id!)?.caminho).toBe(realpathSync(real));
  });

  it("Windows: respeita PATHEXT na ordem, reconhece wrappers .cmd e .ps1", () => {
    const dir = temporario();
    writeFileSync(join(dir, "gemini.cmd"), "@echo off\r\n");
    writeFileSync(join(dir, "gemini.ps1"), "");
    writeFileSync(join(dir, "codex.ps1"), "");
    writeFileSync(join(dir, "claude.exe"), "");
    writeFileSync(join(dir, "claude.cmd"), "");
    const reg = new RegistroExecutaveis({ plataforma: "win32" });
    const r = detectarFerramentas({ plataforma: "win32", path: dir, pathext: ".EXE;.CMD;.PS1", ...SEM_RECURSOS, registro: reg });
    expect(r.find((f) => f.id === "gemini")).toMatchObject({ instalado: true, modo_lancamento: "cmd_wrapper" });
    expect(r.find((f) => f.id === "codex")).toMatchObject({ instalado: true, modo_lancamento: "powershell_wrapper" });
    expect(r.find((f) => f.id === "claude")).toMatchObject({ instalado: true, modo_lancamento: "direto" });
    const invertido = detectarFerramentas({ plataforma: "win32", path: dir, pathext: ".CMD;.EXE", ...SEM_RECURSOS });
    expect(invertido.find((f) => f.id === "claude")?.modo_lancamento).toBe("cmd_wrapper");
  });

  it("diretórios convencionais: macOS (homebrew, local, volta, bun, todas as versões do nvm) e Windows (LOCALAPPDATA\\Programs, APPDATA\\npm)", () => {
    const casa = temporario();
    mkdirSync(join(casa, ".nvm", "versions", "node", "v18.0.0", "bin"), { recursive: true });
    mkdirSync(join(casa, ".nvm", "versions", "node", "v22.1.0", "bin"), { recursive: true });
    const mac = diretoriosConvencionais("darwin", { casa, env: {} });
    expect(mac.slice(0, 5)).toEqual(["/opt/homebrew/bin", "/usr/local/bin", join(casa, ".local", "bin"), join(casa, ".volta", "bin"), join(casa, ".bun", "bin")]);
    expect(mac).toContain(join(casa, ".nvm", "versions", "node", "v18.0.0", "bin"));
    expect(mac).toContain(join(casa, ".nvm", "versions", "node", "v22.1.0", "bin"));
    expect(mac.indexOf(join(casa, ".nvm", "versions", "node", "v22.1.0", "bin"))).toBeLessThan(mac.indexOf(join(casa, ".nvm", "versions", "node", "v18.0.0", "bin")));
    const win = diretoriosConvencionais("win32", { casa, env: { LOCALAPPDATA: "C:\\L", APPDATA: "C:\\R" } });
    expect(win).toEqual([join("C:\\L", "Programs"), join("C:\\R", "npm")]);
    expect(diretoriosConvencionais("win32", { casa, env: {} })).toEqual([]);
  });
});

describe("RegistroExecutaveis", () => {
  it("seleção manual exige caminho absoluto, existente e executável; cria id opaco", () => {
    const dir = temporario();
    const binario = executavel(dir, "minha-cli");
    const reg = new RegistroExecutaveis({ plataforma: "darwin", criar_id: () => "exe_teste123" });
    expect(reg.selecionar(binario, "personalizado")).toEqual({ ok: true, executavel_id: "exe_teste123" });
    expect(reg.obter("exe_teste123")).toMatchObject({ caminho: realpathSync(binario), ferramenta_id: "personalizado", modo_lancamento: "direto" });
    expect(reg.selecionar(join(dir, "ausente"), "personalizado")).toMatchObject({ ok: false, erro_codigo: "arquivo_ausente" });
    expect(reg.selecionar("relativo/cli", "personalizado")).toMatchObject({ ok: false, erro_codigo: "caminho_invalido" });
    expect(reg.selecionar(`${binario}\0x`, "personalizado")).toMatchObject({ ok: false, erro_codigo: "caminho_invalido" });
    expect(reg.selecionar(dir, "personalizado")).toMatchObject({ ok: false, erro_codigo: "arquivo_ausente" });
    const semX = executavel(dir, "sem-x", "", 0o644);
    expect(reg.selecionar(semX, "personalizado")).toMatchObject({ ok: false, erro_codigo: "sem_permissao" });
  });
  it("id desconhecido não resolve; o mesmo executável reaproveita o id", () => {
    const dir = temporario();
    const reg = new RegistroExecutaveis({ plataforma: "darwin" });
    expect(reg.obter("exe_inventado")).toBeUndefined();
    const c = executavel(dir, "claude");
    const a = reg.adicionar({ ferramenta_id: "claude", caminho: c, modo_lancamento: "direto" });
    const b = reg.adicionar({ ferramenta_id: "claude", caminho: c, modo_lancamento: "direto" });
    expect(a).toBe(b);
    reg.limpar();
    expect(reg.obter(a)).toBeUndefined();
  });
});

describe("versão (--version, timeout, sem shell)", () => {
  it("lê a primeira linha, extrai o número e limita o tamanho", async () => {
    const dir = temporario();
    const a = executavel(dir, "v1", '#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.286 (Claude Code)"\n');
    expect(await lerVersao(a, "direto")).toBe("2.1.286");
    const b = executavel(dir, "v2", "#!/bin/sh\necho codex-cli 0.157.1\n");
    expect(await lerVersao(b, "direto")).toBe("0.157.1");
    const g = executavel(dir, "v-grok", "#!/bin/sh\necho 'grok 1.0.46 (stable)'\n");
    expect(await lerVersao(g, "direto")).toBe("1.0.46");
    const c = executavel(dir, "v3", `#!/bin/sh\nprintf '%s' "${"x".repeat(5000)}"\n`);
    const v = await lerVersao(c, "direto");
    expect(v === null || v.length <= 80).toBe(true);
  });
  it("estoura o timeout e devolve null, sem deixar processo preso", async () => {
    const dir = temporario();
    const lento = executavel(dir, "lento", "#!/bin/sh\nexec sleep 5\n");
    const t0 = Date.now();
    expect(await lerVersao(lento, "direto", { timeout_ms: 150 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("falha e saída vazia viram null; o argumento é sempre só --version (sem interpolar shell)", async () => {
    const dir = temporario();
    expect(await lerVersao(executavel(dir, "falha", "#!/bin/sh\nexit 3\n"), "direto")).toBeNull();
    expect(await lerVersao(executavel(dir, "vazio", "#!/bin/sh\n"), "direto")).toBeNull();
    const eco = executavel(dir, "eco", '#!/bin/sh\necho "$# $1"\n');
    expect(await lerVersao(eco, "direto")).toBe("1 --version");
    expect(await lerVersao(join(dir, "não existe"), "direto")).toBeNull();
    expect(await lerVersao(executavel(dir, 'com"aspa'), "cmd_wrapper", { plataforma: "win32" })).toBeNull();
  });
});

describe("DetectorFerramentas: cache", () => {
  it("usa o cache até invalidar; achados novos só aparecem depois; a versão não roda de novo se o arquivo não mudou", async () => {
    const dir = temporario();
    executavel(dir, "claude");
    const chamadas: string[] = [];
    const detector = new DetectorFerramentas({
      plataforma: "darwin", path: dir, ...SEM_RECURSOS,
      lerVersao: async (caminho) => { chamadas.push(caminho); return "9.9.9"; },
    });
    const a = await detector.detectar();
    expect(a.find((f) => f.id === "claude")).toMatchObject({ instalado: true, versao: "9.9.9" });
    expect(a.find((f) => f.id === "codex")?.instalado).toBe(false);
    executavel(dir, "codex");
    expect((await detector.detectar()).find((f) => f.id === "codex")?.instalado).toBe(false); // cache
    detector.invalidar();
    const b = await detector.detectar();
    expect(b.find((f) => f.id === "codex")).toMatchObject({ instalado: true, versao: "9.9.9" });
    expect(chamadas.filter((c) => c.endsWith("/claude"))).toHaveLength(1);
    expect(b.find((f) => f.id === "claude")?.executavel_id).toBe(a.find((f) => f.id === "claude")?.executavel_id);
  });
  it("detecções concorrentes compartilham a mesma varredura", async () => {
    const dir = temporario();
    executavel(dir, "claude");
    let n = 0;
    const detector = new DetectorFerramentas({ plataforma: "darwin", path: dir, ...SEM_RECURSOS, lerVersao: async () => { n++; return null; } });
    await Promise.all([detector.detectar(), detector.detectar(), detector.detectar()]);
    expect(n).toBe(1);
  });
});

describe("DetectorFerramentas: spawns de versão não saem em rajada (P-12)", () => {
  it("no máximo um `--version` começa por volta do event loop; todos terminam e a lista sai completa", async () => {
    const dir = temporario();
    for (const nome of ["claude", "codex", "gemini", "opencode", "aider"]) executavel(dir, nome);
    const iniciadas: number[] = [];
    let voltas = 0;
    const contar = (): void => { voltas += 1; if (voltas < 200) setImmediate(contar); };
    setImmediate(contar);
    const detector = new DetectorFerramentas({ plataforma: "darwin", path: dir, ...SEM_RECURSOS, lerVersao: async () => { iniciadas.push(voltas); return "1.0.0"; } });
    const lista = await detector.detectar();
    expect(lista.filter((f) => f.instalado && f.id !== "terminal").every((f) => f.versao === "1.0.0")).toBe(true);
    expect(iniciadas).toHaveLength(5);
    // cada início caiu numa volta diferente do loop (nenhuma rajada na mesma volta)
    expect(new Set(iniciadas).size).toBe(iniciadas.length);
  });
});

describe("PATH do shell de login", () => {
  it("usa a saída do shell de login (ignorando lixo de perfil) e junta ao PATH atual sem duplicar", async () => {
    const dir = temporario();
    const dirA = join(dir, "a");
    const dirB = join(dir, "b");
    const shell = executavel(dir, "shell-falso", `#!/bin/sh\necho "bem-vindo ao zsh"\nprintf '__CAMINHO_INI__${dirA}:relativo:${dirB}__CAMINHO_FIM__'\n`);
    const r = await resolverPathDoShellDeLogin({ plataforma: "darwin", shell, path_atual: `${dirB}:/usr/bin` });
    expect(r.split(":")).toEqual([dirA, dirB, "/usr/bin"]);
  });
  it("não usa shell interpolado: o shell recebe -ilc e um único script fixo", async () => {
    const dir = temporario();
    const arq = join(dir, "args.txt");
    const shell = executavel(dir, "sh-args", `#!/bin/sh\nprintf '%s|' "$@" > "${arq}"\nprintf '__CAMINHO_INI__/x__CAMINHO_FIM__'\n`);
    await resolverPathDoShellDeLogin({ plataforma: "darwin", shell, path_atual: "" });
    const { readFileSync } = await import("node:fs");
    const partes = readFileSync(arq, "utf8").split("|");
    expect(partes[0]).toBe("-ilc");
    expect(partes).toHaveLength(3);
  });
  it("fallback para PATH atual + diretórios convencionais quando o shell falha, some ou estoura o tempo", async () => {
    const dir = temporario();
    const conv = ["/opt/homebrew/bin", "/usr/local/bin"];
    const falha = executavel(dir, "falha", "#!/bin/sh\nexit 1\n");
    const lento = executavel(dir, "lento", "#!/bin/sh\nexec sleep 5\n");
    for (const shell of [falha, lento, join(dir, "nao-existe"), null]) {
      const r = await resolverPathDoShellDeLogin({ plataforma: "darwin", shell, path_atual: "/usr/bin:/bin", diretorios_convencionais: conv, timeout_ms: 200 });
      expect(r.split(":")).toEqual(["/usr/bin", "/bin", ...conv]);
    }
  });
  it("no Windows devolve o PATH atual sem rodar shell", async () => {
    const r = await resolverPathDoShellDeLogin({ plataforma: "win32", path_atual: "C:\\a;C:\\b", shell: "/nao/roda" });
    expect(r).toBe("C:\\a;C:\\b");
  });
});

describe("integração opcional: CLIs reais desta máquina (só --version)", () => {
  it("detecta claude/codex se existirem; pula com aviso se não", async () => {
    const detector = new DetectorFerramentas({});
    const r = await detector.detectar();
    const achadas = r.filter((f) => (f.id === "claude" || f.id === "codex") && f.instalado);
    if (achadas.length === 0) {
      console.warn("[aviso] claude/codex não encontrados nesta máquina: integração pulada.");
      return;
    }
    for (const f of achadas) {
      expect(f.executavel_id).toMatch(/^exe_/);
      expect(f.versao === null || /\d/.test(f.versao)).toBe(true);
    }
  });
});
