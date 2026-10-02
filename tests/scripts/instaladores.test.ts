// T-21.08 · macOS: DMG/ZIP verificados de forma estática, sem instalar e sem deixar nada montado (AU-20, P-157).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUTO } from "../../src/nucleo/produto";
import { conferirApp, conferirInfoPlist, lerPlist, lerProduto, verificarMac, comDmgMontado } from "../../scripts/lib/instaladores.mjs";
import { DUPLES, HDIUTIL_FALSO, RAIZ, VERSAO, cli, criarApp, criarDistMac, escrever, tmp } from "./instaladores-ajuda";

const lipo = join(DUPLES, "lipo");
const produto = { nome: PRODUTO.nome, id: PRODUTO.id, appId: PRODUTO.appId, prefixoEnv: PRODUTO.prefixoEnv };
const montadosAgora = (): string => {
  try {
    return execFileSync("mount", { encoding: "utf8" });
  } catch {
    return "";
  }
};

afterEach(() => {
  for (const k of ["FALSO_APP_DIR", "FALSO_LOG", "FALSO_FALHA_ATTACH"]) delete process.env[k];
});

describe("produto e plist", () => {
  it("o produto lido de produto.ts (sem executar TS) bate com PRODUTO", () => {
    expect(lerProduto(RAIZ)).toEqual(produto);
  });

  it("plist válido passa nos quatro itens; inválido cita cada item errado", () => {
    const ok = tmp();
    const app = criarApp(ok);
    const plist = lerPlist(join(app, "Contents", "Info.plist"));
    expect(plist.NSMicrophoneUsageDescription).toBe("Para o ditado & mais nada.");
    expect(plist.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false });
    const bons = conferirInfoPlist(plist, { appId: PRODUTO.appId, versao: VERSAO });
    expect(bons.every((i: { ok: boolean }) => i.ok)).toBe(true);

    const ruim = tmp();
    const appRuim = criarApp(ruim, { plist: "plist-invalido.plist" });
    const falhas = conferirInfoPlist(lerPlist(join(appRuim, "Contents", "Info.plist")), { appId: PRODUTO.appId, versao: VERSAO }).filter((i: { ok: boolean }) => !i.ok).map((i: { id: string }) => i.id);
    expect(falhas).toEqual(["plist:CFBundleIdentifier", "plist:versao", "plist:LSMinimumSystemVersion", "plist:NSMicrophoneUsageDescription"]);
  });
});

describe("conferirApp (lipo dublê)", () => {
  it("universal em executável e node-pty passa", () => {
    const app = criarApp(tmp());
    const itens = conferirApp(app, { appId: PRODUTO.appId, versao: VERSAO, ferramentas: { lipo } });
    expect(itens.filter((i: { ok: boolean }) => !i.ok)).toEqual([]);
  });

  it("executável sem x86_64 falha citando a arquitetura", () => {
    const app = criarApp(tmp(), { arquiteturasExe: "arm64" });
    const falhas = conferirApp(app, { appId: PRODUTO.appId, versao: VERSAO, ferramentas: { lipo } }).filter((i: { ok: boolean }) => !i.ok);
    expect(falhas.map((f: { id: string }) => f.id)).toEqual(["arch:executavel"]);
    expect(falhas[0]?.mensagem).toContain("x86_64");
  });

  it("node-pty sem uma das arquiteturas falha; sem microfone falha pelo item", () => {
    const app = criarApp(tmp(), { pty: ["arm64"], microfone: false });
    const falhas = conferirApp(app, { appId: PRODUTO.appId, versao: VERSAO, ferramentas: { lipo } }).filter((i: { ok: boolean }) => !i.ok);
    expect(falhas.map((f: { id: string }) => f.id).sort()).toEqual(["arch:node-pty", "plist:NSMicrophoneUsageDescription"]);
    expect(falhas.find((f: { id: string }) => f.id === "arch:node-pty")?.mensagem).toContain("x86_64");
  });
});

describe("verificarMac com hdiutil dublê", () => {
  it("monta, confere e DESMONTA; hash, zip e tamanho conferidos", async () => {
    const dist = criarDistMac(tmp());
    const log = join(tmp(), "log");
    escrever(log, "");
    process.env.FALSO_APP_DIR = tmp("app-");
    criarApp(process.env.FALSO_APP_DIR);
    process.env.FALSO_LOG = log;
    const itens = await verificarMac({ dir: dist, produto, versao: VERSAO, ferramentas: { hdiutil: HDIUTIL_FALSO, lipo } });
    expect(itens.filter((i: { ok: boolean }) => !i.ok)).toEqual([]);
    expect(itens.some((i: { id: string }) => i.id === "hash:ExpxV-universal.dmg")).toBe(true);
    expect(itens.some((i: { id: string }) => i.id.startsWith("zip:"))).toBe(true);
    const linhas = readFileSync(log, "utf8").trim().split("\n");
    expect(linhas[0]).toMatch(/^attach /);
    expect(linhas.some((l) => l.startsWith("detach "))).toBe(true);
  });

  it("desmonta mesmo quando a conferência lança exceção (finally)", async () => {
    const log = join(tmp(), "log");
    escrever(log, "");
    process.env.FALSO_APP_DIR = criarApp(tmp()).replace(/\/ExpxV\.app$/, "");
    process.env.FALSO_LOG = log;
    const r = comDmgMontado(join(criarDistMac(tmp()), "ExpxV-universal.dmg"), HDIUTIL_FALSO, () => {
      throw new Error("explodiu");
    });
    await expect(r).rejects.toThrow("explodiu");
    expect(readFileSync(log, "utf8")).toContain("detach ");
  });

  it("DMG que não monta falha citando a montagem, sem deixar volume", async () => {
    const dist = criarDistMac(tmp());
    process.env.FALSO_FALHA_ATTACH = "1";
    const itens = await verificarMac({ dir: dist, produto, versao: VERSAO, ferramentas: { hdiutil: HDIUTIL_FALSO, lipo } });
    const falha = itens.find((i: { id: string }) => i.id === "dmg:montagem");
    expect(falha?.ok).toBe(false);
    expect(falha?.mensagem).toContain("DMG não monta");
  });

  it("yml adulterado falha no hash do artefato citado", async () => {
    const dist = criarDistMac(tmp(), { adulterar: "ExpxV-universal.zip" });
    const itens = await verificarMac({ dir: dist, produto, versao: VERSAO, ferramentas: { hdiutil: join(tmp(), "nao-existe"), lipo } });
    const f = itens.find((i: { id: string }) => i.id === "hash:ExpxV-universal.zip");
    expect(f?.ok).toBe(false);
    expect(f?.mensagem).toContain("sha512 difere");
  });

  it("sem hdiutil pula SÓ a montagem: o hash segue conferido e adulteração ainda falha", async () => {
    const bom = criarDistMac(tmp());
    const itens = await verificarMac({ dir: bom, produto, versao: VERSAO, ferramentas: { hdiutil: join(tmp(), "nao-existe"), lipo } });
    const pulado = itens.find((i: { id: string }) => i.id === "dmg:montagem");
    expect(pulado?.pulado).toBe(true);
    expect(itens.filter((i: { id: string; ok: boolean }) => i.id.startsWith("hash:") && i.ok)).toHaveLength(2);
    expect(itens.every((i: { ok: boolean }) => i.ok)).toBe(true);
    const ruim = criarDistMac(tmp(), { adulterar: "ExpxV-universal.dmg" });
    const r = await verificarMac({ dir: ruim, produto, versao: VERSAO, ferramentas: { hdiutil: join(tmp(), "nao-existe"), lipo } });
    expect(r.some((i: { ok: boolean; id: string }) => !i.ok && i.id === "hash:ExpxV-universal.dmg")).toBe(true);
  });

  it("versão do yml diferente do package.json, ZIP corrompido e tamanho acima do teto falham", async () => {
    const dist = criarDistMac(tmp(), { versao: "9.9.9" });
    const ferramentas = { hdiutil: join(tmp(), "nao-existe"), lipo };
    const v = await verificarMac({ dir: dist, produto, versao: VERSAO, ferramentas });
    expect(v.find((i: { id: string }) => i.id === "yml:versao")?.ok).toBe(false);

    const corr = criarDistMac(tmp());
    const buf = readFileSync(join(corr, "ExpxV-universal.zip"));
    escrever(join(corr, "ExpxV-universal.zip"), buf.subarray(0, buf.length - 30)); // sem diretório central
    const z = await verificarMac({ dir: corr, produto, versao: VERSAO, ferramentas });
    expect(z.some((i: { id: string; ok: boolean }) => i.id.startsWith("zip:") && !i.ok)).toBe(true);

    const grande = await verificarMac({ dir: criarDistMac(tmp()), produto, versao: VERSAO, ferramentas, limiteMb: 0.00001 });
    expect(grande.filter((i: { id: string; ok: boolean }) => i.id.startsWith("tamanho:") && !i.ok).length).toBe(2);
  });
});

describe("CLI verificar-instaladores", () => {
  it("passa com dublês, grava o relatório em --saida (nunca em dist-app) e não deixa nada montado", () => {
    const dist = criarDistMac(tmp());
    const appDir = tmp("app-");
    criarApp(appDir);
    const saida = join(tmp(), "rel", "instaladores.json");
    const antes = montadosAgora();
    const r = cli("scripts/verificar-instaladores.mjs", [`--dist=${dist}`, "--plataforma=mac", `--saida=${saida}`, `--hdiutil=${HDIUTIL_FALSO}`, `--lipo=${lipo}`], { FALSO_APP_DIR: appDir, FALSO_LOG: join(tmp(), "l") });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const rel = JSON.parse(readFileSync(saida, "utf8"));
    expect(rel.ok).toBe(true);
    expect(rel.segundos).toBeLessThan(60);
    expect(existsSync(join(dist, "relatorio-verificacao.json"))).toBe(false);
    expect(montadosAgora()).toBe(antes);
  });

  it("falha (exit 1) com yml adulterado e cita o item; sem artefatos também falha", () => {
    const dist = criarDistMac(tmp(), { adulterar: "ExpxV-universal.dmg" });
    const r = cli("scripts/verificar-instaladores.mjs", [`--dist=${dist}`, "--plataforma=mac", `--hdiutil=${join(tmp(), "x")}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ExpxV-universal.dmg: sha512 difere do yml");
    const vazio = cli("scripts/verificar-instaladores.mjs", [`--dist=${tmp()}`]);
    expect(vazio.status).toBe(1);
  });
});

const real = join(RAIZ, "dist-app");
describe.skipIf(!existsSync(join(real, "ExpxV-universal.dmg")) || process.platform !== "darwin")("pacote real em dist-app/ (somente leitura)", () => {
  it("passa em até 60 s e nada fica montado (P-157)", () => {
    const antes = montadosAgora();
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(RAIZ, "scripts", "verificar-instaladores.mjs"), "--plataforma=mac"], { encoding: "utf8", timeout: 120000 });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(Date.now() - t0).toBeLessThan(60000);
    expect(montadosAgora()).toBe(antes);
    expect(montadosAgora().toLowerCase()).not.toContain("instaladores-");
  }, 120000);
});
