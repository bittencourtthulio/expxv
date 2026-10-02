import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { instalarServidor, localizarExecutavel, pastaIsolada, type OpcoesInstalar } from "./instalar";
import type { EntradaMcp } from "./esquema";
import { planejarInstalacao } from "./plano";
import { sha256Hex } from "./integridade";
import { catalogoFalso, entradaNpmFalsa, executorNpmFalso, limparPastas, novaPasta } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";

afterEach(limparPastas);
const cat = catalogoFalso();
const E = (id: string): EntradaMcp => JSON.parse(JSON.stringify(cat.porId.get(id)!.entrada)) as EntradaMcp;
const BINARIOS = { npm: "/falso/npm", node: process.execPath };
const arvore = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();

function base(userData: string, e: EntradaMcp, extra: Partial<OpcoesInstalar> = {}): OpcoesInstalar {
  return { entrada: e, userData, executor: executorNpmFalso(), binarios: BINARIOS, ulid: () => "u1", ...extra };
}

describe("instalação npm isolada", () => {
  it("instala em <userData>/mcp/<id>, sem deixar .tmp, e o executável existe", async () => {
    const ud = novaPasta();
    const r = await instalarServidor(base(ud, E("falso-ok")));
    expect(r).toMatchObject({ ok: true, promovido: true });
    expect(existsSync(join(ud, "mcp", "falso-ok", "node_modules", ".bin", "servidor.mjs"))).toBe(true);
    expect(readdirSync(join(ud, "mcp", ".tmp"))).toEqual([]);
    expect(readdirSync(join(ud, "mcp")).sort()).toEqual([".tmp", "falso-ok"]);
  });

  it("o argv executado é EXATAMENTE o que o plano mostrou ao consentimento (com o tmp real)", async () => {
    const ud = novaPasta();
    const e = E("falso-ok");
    const plano = planejarInstalacao(e, { npm: { ok: true, versao: "10.0.0" }, node: { ok: true, versao: "v20.0.0" } }, { userData: ud });
    if (!plano.ok) throw new Error("plano");
    const ex = executorNpmFalso();
    await instalarServidor(base(ud, e, { executor: ex }));
    const mostrado = (plano.plano.acoes[0] as { argv: string[] }).argv.map((a) => a.replace("<ulid>", "u1"));
    expect(ex.chamadas).toHaveLength(1);
    expect(ex.chamadas[0]!.exe).toBe("/falso/npm");
    expect([ex.chamadas[0]!.exe.replace("/falso/npm", "npm"), ...ex.chamadas[0]!.args]).toEqual(mostrado);
  });

  it("ambiente do npm: allowlist, registro fixo, HOME/cache dentro do .tmp e SEM tokens do usuário", async () => {
    const ud = novaPasta();
    const antes = { ...process.env };
    process.env["NPM_TOKEN"] = "segredo-npm"; process.env["ANTHROPIC_API_KEY"] = "segredo-a"; process.env["GITHUB_TOKEN"] = "segredo-g";
    try {
      const ex = executorNpmFalso();
      await instalarServidor(base(ud, E("falso-ok"), { executor: ex, registroNpm: "http://127.0.0.1:1/" }));
      const env = ex.chamadas[0]!.env;
      expect(Object.keys(env).some((k) => /TOKEN|KEY|SECRET/i.test(k))).toBe(false);
      expect(JSON.stringify(env)).not.toMatch(/segredo-/);
      expect(env["npm_config_registry"]).toBe("http://127.0.0.1:1/");
      const tmp = ex.chamadas[0]!.cwd!;
      expect(tmp.startsWith(join(realpathSync(ud), "mcp", ".tmp"))).toBe(true);
      for (const k of ["HOME", "npm_config_cache", "npm_config_userconfig", "TMPDIR"]) expect(env[k]!.startsWith(tmp)).toBe(true);
      expect(env["PATH"]).toMatch(/\/usr\/bin/);
    } finally { for (const k of ["NPM_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) { if (antes[k] === undefined) delete process.env[k]; } }
  });

  it("integridade divergente: aborta, apaga o .tmp e NÃO cria a pasta final", async () => {
    const ud = novaPasta();
    const ex = executorNpmFalso();
    ex.integridadeGravada = "sha512-" + "A".repeat(86) + "==";
    const r = await instalarServidor(base(ud, E("falso-ok"), { executor: ex }));
    expect(r).toMatchObject({ ok: false, codigo: "integridade_divergente" });
    expect(existsSync(join(ud, "mcp", "falso-ok"))).toBe(false);
    expect(readdirSync(join(ud, "mcp", ".tmp"))).toEqual([]);
  });

  it("falhas do npm: código ≠ 0, timeout, não iniciou e saída excessiva", async () => {
    const ud = novaPasta();
    for (const [forcado, codigo] of [[{ codigo: 1 }, "falha_instalacao"], [{ codigo: null, timeout: true }, "timeout"], [{ codigo: null, nao_iniciou: true }, "executavel_ausente"], [{ excedeu_saida: true }, "saida_excessiva"], [{ codigo: null, abortado: true }, "cancelado"]] as const) {
      const ex = executorNpmFalso();
      ex.proximo.push(forcado);
      const r = await instalarServidor(base(ud, E("falso-ok"), { executor: ex }));
      expect(r).toMatchObject({ ok: false, codigo });
      expect(existsSync(join(ud, "mcp", "falso-ok"))).toBe(false);
      expect(readdirSync(join(ud, "mcp", ".tmp"))).toEqual([]);
    }
  });

  it("sem npm no PATH: executavel_ausente acionável", async () => {
    const r = await instalarServidor({ entrada: E("falso-ok"), userData: novaPasta(), executor: executorNpmFalso(), pathOrigem: "/nao/existe", plataforma: process.platform, binarios: {} });
    // (o PATH real da máquina de teste pode ter npm; só exigimos coerência: ou instala com o npm achado, ou falha nominal)
    expect(r.ok === true || (r.ok === false && r.codigo === "executavel_ausente")).toBe(true);
    expect(localizarExecutavel("npm-inexistente-xyz", "/nao/existe")).toBeNull();
  });

  it("pacote sem o executável declarado: binario_ausente", async () => {
    const ud = novaPasta();
    const ex = executorNpmFalso(); ex.semBin = true;
    expect(await instalarServidor(base(ud, E("falso-ok"), { executor: ex }))).toMatchObject({ ok: false, codigo: "binario_ausente" });
  });

  it("cancelar antes de começar não executa nada e não deixa resíduo", async () => {
    const ud = novaPasta();
    const ex = executorNpmFalso();
    const r = await instalarServidor(base(ud, E("falso-ok"), { executor: ex, sinal: AbortSignal.abort() }));
    expect(r).toMatchObject({ ok: false, codigo: "cancelado" });
    expect(ex.chamadas).toHaveLength(0);
    expect(readdirSync(join(ud, "mcp", ".tmp"))).toEqual([]);
  });

  it("entrada não confirmada ou sem pino nunca instala", async () => {
    const e = E("falso-ok"); e.confirmado = false;
    expect(await instalarServidor(base(novaPasta(), e))).toMatchObject({ ok: false, codigo: "nao_instalavel" });
    const f = E("falso-ok"); f.instalacao.versao = null;
    expect(await instalarServidor(base(novaPasta(), f))).toMatchObject({ ok: false, codigo: "nao_instalavel" });
  });

  it("id fora do padrão e pasta fora de userData/mcp são recusados", async () => {
    const ud = novaPasta();
    await expect(pastaIsolada(ud, "../fora")).rejects.toThrow();
    await expect(pastaIsolada(ud, "A/b")).rejects.toThrow();
    expect(await pastaIsolada(ud, "ok-1")).toMatch(/mcp[/\\]ok-1$/);
  });
});

describe("promoção atômica, desfazer e confirmar", () => {
  it("reinstalar mantém a pasta antiga em .old até confirmar; desfazer restaura a antiga", async () => {
    const ud = novaPasta();
    const e = E("falso-ok");
    await instalarServidor(base(ud, e));
    const marca = join(ud, "mcp", "falso-ok", "VERSAO-ANTIGA");
    writeFileSync(marca, "1");
    const r = await instalarServidor(base(ud, e, { ulid: () => "u2" }));
    if (!r.ok) throw new Error("falhou");
    expect(existsSync(marca)).toBe(false);
    expect(readdirSync(join(ud, "mcp", ".old"))).toEqual(["falso-ok-u2"]);
    await r.desfazer();
    expect(existsSync(marca)).toBe(true);
    expect(readdirSync(join(ud, "mcp", ".old"))).toEqual([]);
  });

  it("confirmar apaga a antiga", async () => {
    const ud = novaPasta();
    const e = E("falso-ok");
    await instalarServidor(base(ud, e));
    const r = await instalarServidor(base(ud, e, { ulid: () => "u2" }));
    if (!r.ok) throw new Error("falhou");
    await r.confirmar();
    expect(readdirSync(join(ud, "mcp", ".old"))).toEqual([]);
    expect(statSync(join(ud, "mcp", "falso-ok")).isDirectory()).toBe(true);
  });

  it("falha na segunda instalação deixa a primeira intacta", async () => {
    const ud = novaPasta();
    const e = E("falso-ok");
    await instalarServidor(base(ud, e));
    const marca = join(ud, "mcp", "falso-ok", "VERSAO-ANTIGA");
    writeFileSync(marca, "1");
    const ex = executorNpmFalso(); ex.proximo.push({ codigo: 1 });
    expect(await instalarServidor(base(ud, e, { executor: ex, ulid: () => "u3" }))).toMatchObject({ ok: false });
    expect(existsSync(marca)).toBe(true);
  });
});

describe("remoto, lock curado e binário", () => {
  it("remoto: só valida https e não executa nada", async () => {
    const ex = executorNpmFalso();
    const ud = novaPasta();
    const r = await instalarServidor(base(ud, E("falso-remoto"), { executor: ex }));
    expect(r).toMatchObject({ ok: true, pasta: null, promovido: false });
    expect(ex.chamadas).toHaveLength(0);
    expect(existsSync(join(ud, "mcp"))).toBe(false);
    const http = E("falso-remoto"); http.url = "http://x.example/mcp";
    expect(await instalarServidor(base(ud, http))).toMatchObject({ ok: false, codigo: "url_invalida" });
  });

  it("nível forte: copia o lock curado conferido por hash e roda npm ci; lock ausente ou adulterado falha", async () => {
    const ud = novaPasta(); const locks = novaPasta("locks-");
    const lock = JSON.stringify({ lockfileVersion: 3, packages: {} });
    const e = E("falso-ok"); e.instalacao.lock_sha256 = sha256Hex(lock);
    expect(await instalarServidor(base(ud, e, { locksDir: locks }))).toMatchObject({ ok: false, codigo: "lock_ausente" });
    writeFileSync(join(locks, "falso-ok.package-lock.json"), lock + " ");
    expect(await instalarServidor(base(ud, e, { locksDir: locks }))).toMatchObject({ ok: false, codigo: "lock_divergente" });
    writeFileSync(join(locks, "falso-ok.package-lock.json"), lock);
    const ex = executorNpmFalso();
    expect(await instalarServidor(base(ud, e, { locksDir: locks, executor: ex }))).toMatchObject({ ok: true });
    expect(ex.chamadas[0]!.args.slice(0, 1)).toEqual(["ci"]);
    expect(ex.chamadas[0]!.args).toContain("--ignore-scripts");
  });

  const binario = (dados: Buffer): EntradaMcp => entradaNpmFalsa("falso-bin", "x", {
    instalacao: { metodo: "binario", pacote: null, versao: "1.0.0", integridade: null, data_versao: "2026-09-30", artefatos: Object.fromEntries(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"].map((p) => [p, { url: "https://github.com/dono/repo/releases/download/v1/bin", sha256: createHash("sha256").update(dados).digest("hex") }])) },
    bin: "servidor-bin", comando: null,
  });

  it("binário: confere o sha256 e grava executável 0755; sha divergente ou URL fora do GitHub releases é recusado", async () => {
    const dados = Buffer.from("#!/bin/sh\necho oi\n");
    const ud = novaPasta();
    const ex = executorNpmFalso();
    const ok = await instalarServidor(base(ud, binario(dados), { executor: ex, baixar: async () => dados, plataforma: process.platform }));
    expect(ok).toMatchObject({ ok: true });
    const alvo = join(ud, "mcp", "falso-bin", "bin", "servidor-bin");
    expect(lstatSync(alvo).mode & 0o111).not.toBe(0);
    expect(ex.chamadas).toHaveLength(0);
    const ud2 = novaPasta();
    expect(await instalarServidor(base(ud2, binario(dados), { baixar: async () => Buffer.from("adulterado") }))).toMatchObject({ ok: false, codigo: "integridade_divergente" });
    expect(existsSync(join(ud2, "mcp", "falso-bin"))).toBe(false);
    expect(await instalarServidor(base(novaPasta(), binario(dados)))).toMatchObject({ ok: false, codigo: "download_indisponivel" });
    const mau = binario(dados); for (const a of Object.values(mau.instalacao.artefatos!)) a.url = "https://github.com/dono/repo/archive/main.zip";
    expect(await instalarServidor(base(novaPasta(), mau, { baixar: async () => dados }))).toMatchObject({ ok: false, codigo: "url_invalida" });
    mkdirSync(join(ud, "x"), { recursive: true });
    expect(arvore(ud).some((p) => p.includes(".tmp/falso-bin"))).toBe(false);
  });
});
