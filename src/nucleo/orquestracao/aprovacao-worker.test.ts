import { describe, expect, it } from "vitest";
import { confirmacaoTotalValida, menorNivelAprovacao, seloAprovacaoDaCli, type NivelAprovacaoWorker } from "../../compartilhado/aprovacao-workers";
import {
  ARGUMENTOS_DE_BYPASS, aprovacaoDoWorker, mesclarPermissoesNoSettings, negativasDoClaude, nivelDoPedido, nivelEfetivoDoWorker, permissoesMcpDoApp,
  type EntradaAprovacaoWorker,
} from "./aprovacao-worker";

const base: EntradaAprovacaoWorker = {
  cli: "claude", nivel: "automatico_seguro", cwd: "/p/wt/t-1", raiz: "/p", isolado: true, servidorMcp: "app", toolsMcp: ["handoff_submit"],
};
const com = (o: Partial<EntradaAprovacaoWorker>): EntradaAprovacaoWorker => ({ ...base, ...o });
const CLIS = ["claude", "codex", "opencode", "grok", "gemini", "qwen", "aider", "kilo", "terminal"];
const NIVEIS: NivelAprovacaoWorker[] = ["perguntar", "automatico_seguro", "total"];

const texto = (e: EntradaAprovacaoWorker): string => {
  const r = aprovacaoDoWorker(e);
  return JSON.stringify({ a: r.argumentos, s: r.settings, v: r.env });
};
const contemBypass = (e: EntradaAprovacaoWorker): string[] => {
  const r = aprovacaoDoWorker(e);
  const palavras = [...r.argumentos, ...Object.values(r.env), JSON.stringify(r.settings ?? {})];
  return ARGUMENTOS_DE_BYPASS.filter((b) => palavras.some((p) => p === b || p.includes(`"${b}"`) || p.includes(b)));
};

describe("tabela CLI x nível x worktree/raiz: nunca bypass fora do Total no Claude em worktree com confirmação", () => {
  const casos: Array<[string, NivelAprovacaoWorker, boolean, boolean]> = [];
  for (const cli of CLIS) for (const nivel of NIVEIS) for (const isolado of [true, false]) for (const conf of [true, false]) casos.push([cli, nivel, isolado, conf]);
  it.each(casos)("%s / %s / worktree=%s / confirmado=%s", (cli, nivel, isolado, conf) => {
    const e = com({ cli, nivel, isolado, totalConfirmado: conf, permitirNaRaiz: true });
    const bypassPermitido = cli === "claude" && nivel === "total" && isolado && conf;
    const achados = contemBypass(e);
    if (bypassPermitido) expect(achados).toEqual(["--dangerously-skip-permissions"]);
    else expect(achados).toEqual([]);
    // o ambiente nunca promete bypass; o deny do Claude está sempre presente quando há settings
    const r = aprovacaoDoWorker(e);
    if (r.settings !== null) expect(r.settings.permissions.deny).toEqual(negativasDoClaude());
  });
});

describe("Claude: automático seguro", () => {
  const r = aprovacaoDoWorker(base);
  it("usa acceptEdits e allowlist, sem bypass", () => {
    expect(r.nivel).toBe("automatico_seguro");
    expect(r.argumentos).toEqual(["--permission-mode", "acceptEdits"]);
    expect(r.settings?.permissions.defaultMode).toBe("acceptEdits");
    expect(r.selo).toBe("garantido");
  });
  it("pré-aprova handoff_submit e todas as tools MCP do app", () => {
    const x = aprovacaoDoWorker(com({ toolsMcp: ["handoff_submit", "memory_write", "memory_search", "rag_search", "map_query"] }));
    for (const t of ["handoff_submit", "memory_write", "memory_search", "rag_search", "map_query"]) expect(x.settings?.permissions.allow).toContain(`mcp__app__${t}`);
  });
  it("handoff_submit é pré-aprovado mesmo se a lista de tools vier vazia", () => {
    expect(aprovacaoDoWorker(com({ toolsMcp: [] })).settings?.permissions.allow).toContain("mcp__app__handoff_submit");
  });
  it("não gera regra para nome de servidor ou de tool inválido", () => {
    expect(permissoesMcpDoApp("App Mal", ["handoff_submit"])).toEqual([]);
    expect(permissoesMcpDoApp("app", ["ok_tool", "x y", "../z"])).toEqual(["mcp__app__handoff_submit", "mcp__app__ok_tool"]);
  });
  it("edição só dentro do cwd (caminho absoluto no padrão //)", () => {
    const allow = r.settings?.permissions.allow ?? [];
    for (const f of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(allow).toContain(`${f}(//p/wt/t-1/**)`);
    expect(allow).not.toContain("Edit");
    expect(allow).not.toContain("Write");
  });
  it("leitura e Bash comuns na allowlist", () => {
    const allow = r.settings?.permissions.allow ?? [];
    for (const x of ["Read", "Glob", "Grep", "LS", "Bash(git status:*)", "Bash(git commit:*)", "Bash(npm run test:*)", "Bash(npx vitest:*)", "Bash(python -m pytest:*)", "Bash(go test:*)", "Bash(cargo test:*)", "Bash(make build:*)", "Bash(ls:*)"]) expect(allow).toContain(x);
  });
  it("sem interpretadores nem leitores de arquivo por Bash (evitam burlar o deny)", () => {
    const allow = r.settings?.permissions.allow ?? [];
    for (const x of ["Bash(node:*)", "Bash(python:*)", "Bash(cat:*)", "Bash(grep:*)", "Bash(rg:*)", "Bash(find:*)", "Bash(sed:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(bash:*)", "Bash(sh:*)", "Bash(git:*)", "Bash(npm:*)", "Bash(curl:*)"]) expect(allow).not.toContain(x);
    expect(allow.filter((a) => a === "Bash" || a === "Bash(*)" || a === "Bash(:*)")).toEqual([]);
  });
  it("allow nunca contém uma regra que também está no deny", () => {
    const deny = new Set(r.settings?.permissions.deny);
    expect((r.settings?.permissions.allow ?? []).filter((a) => deny.has(a))).toEqual([]);
  });
  it("deny rígido: rm -rf, sudo, curl/wget, push, reset --hard, clean, chmod -R, ssh, agentes", () => {
    const deny = r.settings?.permissions.deny ?? [];
    for (const x of ["Bash(rm -rf:*)", "Bash(sudo:*)", "Bash(curl:*)", "Bash(wget:*)", "Bash(git push:*)", "Bash(git reset --hard:*)", "Bash(git clean:*)", "Bash(chmod -R:*)", "Bash(ssh:*)", "Agent", "Task", "Bash(git config:*)", "Bash(git -c:*)", "Bash(bash -c:*)", "Bash(node -e:*)", "Bash(gh:*)"]) expect(deny).toContain(x);
  });
  it("deny de leitura de ambiente e credenciais", () => {
    const deny = r.settings?.permissions.deny ?? [];
    for (const x of ["Read(**/.env*)", "Read(**/*.pem)", "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.gnupg/**)", "Read(**/id_rsa*)"]) expect(deny).toContain(x);
  });
  it("deny de escrita em .git (hooks/config), configuração do agente e sistema", () => {
    const deny = r.settings?.permissions.deny ?? [];
    for (const x of ["Edit(**/.git/**)", "Write(**/.git/**)", "Edit(**/.claude/settings*.json)", "Edit(//etc/**)", "Write(~/.zshrc)", "Edit(**/.mcp.json)"]) expect(deny).toContain(x);
  });
  it("git sem hooks nem fsmonitor por ambiente", () => {
    expect(r.env["GIT_CONFIG_COUNT"]).toBe("2");
    expect(r.env["GIT_CONFIG_KEY_0"]).toBe("core.hooksPath");
    expect(r.env["GIT_CONFIG_VALUE_0"]).toBe("/dev/null");
    expect(r.env["GIT_CONFIG_KEY_1"]).toBe("core.fsmonitor");
    expect(aprovacaoDoWorker(com({ plataforma: "win32" })).env["GIT_CONFIG_VALUE_0"]).toBe("NUL");
  });
  it("não vaza segredo: nenhum valor parecido com token no resultado", () => {
    expect(texto(base)).not.toMatch(/Bearer|MCP_TOKEN|sk-/);
  });
});

describe("Claude: total", () => {
  const e = com({ nivel: "total", totalConfirmado: true });
  const r = aprovacaoDoWorker(e);
  it("só aqui aparece o bypass, com o deny mantido", () => {
    expect(r.nivel).toBe("total");
    expect(r.argumentos).toEqual(["--dangerously-skip-permissions"]);
    expect(r.settings?.permissions.deny).toEqual(negativasDoClaude());
    expect(r.settings?.permissions.deny).toContain("Bash(git push:*)");
    expect(r.avisos.join(" ")).toMatch(/negativas/);
  });
  it("sem confirmação digitada vira automático seguro", () => {
    const x = aprovacaoDoWorker(com({ nivel: "total" }));
    expect(x.nivel).toBe("automatico_seguro");
    expect(x.nivel_pedido).toBe("total");
    expect(x.argumentos).toEqual(["--permission-mode", "acceptEdits"]);
    expect(x.avisos.join(" ")).toMatch(/liberar tudo/);
  });
  it("fora de worktree o total NUNCA vale, mesmo com 'permitir na raiz'", () => {
    const x = aprovacaoDoWorker(com({ nivel: "total", totalConfirmado: true, isolado: false, permitirNaRaiz: true }));
    expect(x.nivel).toBe("automatico_seguro");
    expect(x.argumentos).not.toContain("--dangerously-skip-permissions");
  });
  it("fora de worktree e sem permitir na raiz cai em perguntar", () => {
    const x = aprovacaoDoWorker(com({ nivel: "total", totalConfirmado: true, isolado: false }));
    expect(x.nivel).toBe("perguntar");
    expect(x.argumentos).toEqual([]);
    expect(x.settings).toBeNull();
  });
});

describe("rebaixamentos de segurança", () => {
  it("projeto não confiável: perguntar, sem nada extra, com aviso", () => {
    const x = aprovacaoDoWorker(com({ projetoConfiavel: false }));
    expect(x).toMatchObject({ nivel: "perguntar", argumentos: [], settings: null, env: {}, selo: "pergunta" });
    expect(x.avisos.join(" ")).toMatch(/não confiável/);
  });
  it("projeto não confiável rebaixa também o total", () => {
    expect(aprovacaoDoWorker(com({ nivel: "total", totalConfirmado: true, projetoConfiavel: false })).nivel).toBe("perguntar");
  });
  it("cwd na raiz do dono não recebe automático", () => {
    const x = aprovacaoDoWorker(com({ isolado: false, cwd: "/p" }));
    expect(x.nivel).toBe("perguntar");
    expect(x.argumentos).toEqual([]);
    expect(x.avisos.join(" ")).toMatch(/raiz/);
  });
  it("com 'permitir também na raiz' o automático seguro vale (com aviso), mas a allowlist continua", () => {
    const x = aprovacaoDoWorker(com({ isolado: false, cwd: "/p", permitirNaRaiz: true }));
    expect(x.nivel).toBe("automatico_seguro");
    expect(x.settings?.permissions.allow).toContain("Edit(//p/**)");
    expect(x.avisos.join(" ")).toMatch(/raiz/);
  });
  it("perguntar devolve o lançamento sem nada extra em qualquer CLI", () => {
    for (const cli of CLIS) expect(aprovacaoDoWorker(com({ cli, nivel: "perguntar" }))).toMatchObject({ nivel: "perguntar", argumentos: [], settings: null, env: {}, selo: "pergunta" });
  });
  it("nivelEfetivoDoWorker nunca sobe de nível", () => {
    for (const nivel of NIVEIS) for (const isolado of [true, false]) for (const c of [true, false]) for (const raiz of [true, false]) {
      const ef = nivelEfetivoDoWorker(com({ nivel, isolado, totalConfirmado: true, projetoConfiavel: c, permitirNaRaiz: raiz })).nivel;
      expect(menorNivelAprovacao(ef, nivel)).toBe(ef);
    }
  });
});

describe("demais CLIs", () => {
  it("Codex: sandbox workspace-write, nunca perguntar, rede desligada; selo parcial; jamais o bypass nem o danger-full-access", () => {
    const x = aprovacaoDoWorker(com({ cli: "codex" }));
    expect(x.argumentos).toEqual(["-s", "workspace-write", "-a", "never", "-c", "sandbox_workspace_write.network_access=false"]);
    expect(x.selo).toBe("parcial");
    expect(x.settings).toBeNull();
    expect(x.argumentos.join(" ")).not.toMatch(/dangerously|danger-full-access|approve-for-me/);
  });
  it("Codex no nível total continua sem bypass (vira automático seguro)", () => {
    const x = aprovacaoDoWorker(com({ cli: "codex", nivel: "total", totalConfirmado: true }));
    expect(x.nivel).toBe("automatico_seguro");
    expect(x.argumentos).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(x.avisos.join(" ")).toMatch(/bypass/);
  });
  it("OpenCode: permission allow/deny por OPENCODE_CONFIG_CONTENT; selo parcial", () => {
    const x = aprovacaoDoWorker(com({ cli: "opencode" }));
    const cfg = JSON.parse(x.env["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { permission: { bash: Record<string, string>; edit: string; task: string; read: Record<string, string> } };
    expect(cfg.permission.edit).toBe("allow");
    expect(cfg.permission.task).toBe("deny");
    expect(cfg.permission.bash["git status"]).toBe("allow");
    expect(cfg.permission.bash["git push"]).toBe("deny");
    expect(cfg.permission.bash["rm -rf *"]).toBe("deny");
    expect(cfg.permission.read["**/.env*"]).toBe("deny");
    expect(x.selo).toBe("parcial");
    expect(x.argumentos).toEqual([]);
  });
  it("Grok: acceptEdits com --allow/--deny; nunca bypassPermissions nem --always-approve", () => {
    const x = aprovacaoDoWorker(com({ cli: "grok" }));
    expect(x.argumentos.slice(0, 2)).toEqual(["--permission-mode", "acceptEdits"]);
    expect(x.argumentos).toContain("--allow");
    expect(x.argumentos).toContain("--deny");
    expect(x.argumentos).toContain("Bash(git push:*)");
    expect(x.argumentos).not.toContain("bypassPermissions");
    expect(x.argumentos).not.toContain("--always-approve");
    expect(x.selo).toBe("parcial");
  });
  it.each(["gemini", "qwen", "aider", "kilo", "terminal", "personalizado"])("%s: sem allowlist confiável, pergunta sempre (selo honesto)", (cli) => {
    const x = aprovacaoDoWorker(com({ cli }));
    expect(x).toMatchObject({ nivel: "perguntar", argumentos: [], settings: null, env: {}, selo: "pergunta" });
    expect(x.avisos.join(" ")).toMatch(/allowlist/);
  });
});

describe("pane_spawn só abaixa o nível", () => {
  it.each([
    ["total", "perguntar", "perguntar"], ["total", "automatico_seguro", "automatico_seguro"], ["total", "total", "total"],
    ["automatico_seguro", "perguntar", "perguntar"], ["automatico_seguro", "automatico_seguro", "automatico_seguro"], ["automatico_seguro", "total", "automatico_seguro"],
    ["perguntar", "automatico_seguro", "perguntar"], ["perguntar", "total", "perguntar"], ["perguntar", null, "perguntar"], ["automatico_seguro", undefined, "automatico_seguro"],
  ] as const)("configurado %s, pedido %s => %s", (cfg, pedido, esperado) => {
    expect(nivelDoPedido(cfg, pedido)).toBe(esperado);
  });
});

describe("mesclarPermissoesNoSettings", () => {
  const extra = { permissions: { defaultMode: "acceptEdits" as const, allow: ["Read", "X"], deny: ["Agent", "Bash(rm -rf:*)"] } };
  it("soma sem apagar o deny que já existia", () => {
    const original = JSON.stringify({ managed: true, hooks: { Stop: [] }, permissions: { deny: ["Skill(x)", "Agent"], allow: ["Read"] } });
    const m = JSON.parse(mesclarPermissoesNoSettings(original, extra)) as { managed: boolean; hooks: unknown; permissions: { deny: string[]; allow: string[]; defaultMode: string } };
    expect(m.managed).toBe(true);
    expect(m.hooks).toEqual({ Stop: [] });
    expect(m.permissions.deny).toEqual(["Skill(x)", "Agent", "Bash(rm -rf:*)"]);
    expect(m.permissions.allow).toEqual(["Read", "X"]);
    expect(m.permissions.defaultMode).toBe("acceptEdits");
  });
  it("sem permissions prévias cria; JSON inválido volta intacto", () => {
    expect((JSON.parse(mesclarPermissoesNoSettings("{}", extra)) as { permissions: { deny: string[] } }).permissions.deny).toEqual(["Agent", "Bash(rm -rf:*)"]);
    expect(mesclarPermissoesNoSettings("nao e json", extra)).toBe("nao e json");
  });
});

describe("confirmação digitada", () => {
  it.each([["liberar tudo", true], ["  Liberar Tudo ", true], ["liberar", false], ["", false], [null, false], [undefined, false], ["liberar tudo agora", false]] as const)("%s => %s", (t, ok) => {
    expect(confirmacaoTotalValida(t)).toBe(ok);
  });
});

describe("selo mostrado na UI = selo do núcleo", () => {
  it.each(CLIS)("%s", (cli) => {
    expect(seloAprovacaoDaCli(cli)).toBe(aprovacaoDoWorker(com({ cli })).selo);
  });
});
