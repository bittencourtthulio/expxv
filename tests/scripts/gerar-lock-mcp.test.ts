import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { argvNpmLock, argvUvCompile, gerarLocks, lerArgumentos, normalizarLockNpm, nomeNpmNaUrl, type ExecutorLock } from "../../scripts/gerar-lock-mcp.mjs";
import { iniciarRegistroFalso, type RegistroFalso } from "../fixtures/mcp-loja/registro-falso";

const RAIZ = join(__dirname, "..", "..");
const SCRIPT = join(RAIZ, "scripts", "gerar-lock-mcp.mjs");
const SEED_REAL = join(RAIZ, "resources", "mcp", "catalogo-mcps.json");

const INTEG_A = `sha512-${"A".repeat(86)}==`;
const INTEG_B = `sha512-${"B".repeat(86)}==`;
const SHA_PY = "e".repeat(64);

function seedFalso(): object {
  const base = (id: string, metodo: string, pacote: string | null, versao: string | null, integridade: string | null, extra: object = {}): object => ({
    id, nome: id, descricao_pt: "x", categoria: "codigo_repositorios", classificacao: "opcional", motivo_classificacao: "x", mantenedor: "oficial",
    mantenedor_nome: "x", licenca_spdx: "MIT", gratuito: "gratis_open_source", plano_gratis_detalhe: null,
    instalacao: { metodo, pacote, versao, integridade, data_versao: "2026-10-01" }, transporte: "stdio", comando: "node", bin: id, args: [], url: null,
    autenticacao: "nenhuma", variaveis: [], tools_principais: [], riscos: [], riscos_texto: "x",
    maturidade: { ultima_release: null, status: "ativo", arquivado: false }, escopos_recomendados: ["workspace"], links: { repo: null, docs: null },
    fontes: [{ url: "https://exemplo.com", consultado_em: "2026-10-01", para: "versão" }], confirmado: true, observacoes: null, ...extra,
  });
  return {
    schema_version: 1, seed_versao: "teste.1", gerado_em: "2026-10-01", fonte: "teste",
    entradas: [
      base("zeta-npm", "npm", "@falso/zeta", "1.0.0", INTEG_A),
      base("alfa-npm", "npm", "alfa", "2.0.0", INTEG_A),
      base("diverge-npm", "npm", "diverge", "3.0.0", INTEG_B),
      base("py-uvx", "uvx", "pacote-py", "0.5.0", `sha256:${SHA_PY}`, { comando: "uvx" }),
      base("nao-confirmado", "npm", null, null, null, { confirmado: false }),
      base("remoto", "remoto", null, null, null, { transporte: "streamable_http", comando: null, bin: null, url: "https://exemplo.com/mcp" }),
    ],
  };
}

const lockFalso: ExecutorLock = async ({ pacote, versao }) =>
  JSON.stringify({ name: "nome-aleatorio-do-tmp", lockfileVersion: 3, packages: { "": { name: "nome-aleatorio-do-tmp", dependencies: { [pacote]: versao } }, [`node_modules/${pacote}`]: { version: versao } } });
const reqFalso: ExecutorLock = async ({ pacote, versao }) => `${pacote}==${versao} \\\n    --hash=sha256:${"1".repeat(64)}\n`;

let registro: RegistroFalso | null = null;
afterEach(async () => { await registro?.fechar(); registro = null; });

function ambiente(): { dir: string; seed: string; locks: string; relatorio: string; embarcado: string } {
  const dir = mkdtempSync(join(tmpdir(), "gerar-lock-"));
  const seed = join(dir, "seed.json");
  writeFileSync(seed, `${JSON.stringify(seedFalso(), null, 2)}\n`);
  return { dir, seed, locks: join(dir, "locks"), relatorio: join(dir, "relatorio.md"), embarcado: join(dir, "embarcado", "catalogo.json") };
}

async function registroPadrao(): Promise<RegistroFalso> {
  return (registro = await iniciarRegistroFalso(
    [{ pacote: "@falso/zeta", versao: "1.0.0", integridade: INTEG_A }, { pacote: "alfa", versao: "2.0.0", integridade: INTEG_A }, { pacote: "diverge", versao: "3.0.0", integridade: INTEG_A }],
    [{ pacote: "pacote-py", versao: "0.5.0", sha256: SHA_PY }],
  ));
}

describe("gerar-lock-mcp: dry-run (padrão) não faz rede nem escreve", () => {
  it("sem --executar: lista o que faria, zero requisições e zero arquivos", async () => {
    const a = ambiente();
    const reg = await registroPadrao();
    let chamadas = 0;
    const r = await gerarLocks({ seed: a.seed, locks: a.locks, relatorio: a.relatorio, registroNpm: reg.url, registroPypi: reg.url, fetch: (async () => { chamadas++; throw new Error("rede!"); }) as unknown as typeof fetch });
    expect(r.executou).toBe(false);
    expect(chamadas).toBe(0);
    expect(reg.requisicoes).toEqual([]);
    expect(r.itens.map((x) => x.id)).toEqual(["alfa-npm", "diverge-npm", "py-uvx", "zeta-npm"]);
    expect(r.itens.every((x) => x.status === "dry_run" && /^faria: GET /.test(x.detalhe))).toBe(true);
    expect(existsSync(a.locks)).toBe(false);
    expect(existsSync(a.relatorio)).toBe(false);
    expect(r.relatorio).toMatch(/dry-run/);
  });

  it("CLI sem flags no seed real: dry-run, nada gravado, saída lista só entradas confirmadas npm/uvx", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-lock-"));
    const saida = spawnSync(process.execPath, [SCRIPT, "--seed", SEED_REAL, "--locks", join(dir, "l"), "--relatorio", join(dir, "r.md")], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } });
    expect(saida.status).toBe(0);
    expect(saida.stdout).toMatch(/dry-run/);
    expect(saida.stdout).toMatch(/\| context7 \| npm \| @upstash\/context7-mcp@4\.1\.1 /);
    expect(saida.stdout).not.toMatch(/\| deepwiki /);
    expect(existsSync(join(dir, "l"))).toBe(false);
    expect(existsSync(join(dir, "r.md"))).toBe(false);
  });

  it("CLI --ajuda e argumento desconhecido", () => {
    const ajuda = spawnSync(process.execPath, [SCRIPT, "--ajuda"], { encoding: "utf8" });
    expect(ajuda.stdout).toMatch(/--executar/);
    const ruim = spawnSync(process.execPath, [SCRIPT, "--nada"], { encoding: "utf8" });
    expect(ruim.status).toBe(2);
    expect(ruim.stderr).toMatch(/desconhecido/);
  });
});

describe("gerar-lock-mcp: --executar contra o registro falso local", () => {
  it("gera locks, confere integridade, só faz GET no registro falso e preenche lock_sha256", async () => {
    const a = ambiente();
    const reg = await registroPadrao();
    const r = await gerarLocks({ seed: a.seed, locks: a.locks, relatorio: a.relatorio, seedEmbarcado: a.embarcado, executar: true, atualizarSeed: true, registroNpm: reg.url, registroPypi: reg.url, executorNpm: lockFalso, executorPython: reqFalso });
    const porId = Object.fromEntries(r.itens.map((x) => [x.id, x]));
    expect(porId["alfa-npm"]).toMatchObject({ status: "gerado", integridade: "ok" });
    expect(porId["zeta-npm"]).toMatchObject({ status: "gerado", integridade: "ok" });
    expect(porId["py-uvx"]).toMatchObject({ status: "gerado", integridade: "ok" });
    expect(porId["diverge-npm"]).toMatchObject({ status: "erro", integridade: "divergente" });
    expect(porId["diverge-npm"]!.detalhe).toMatch(/integridade_divergente/);
    expect(reg.requisicoes.length).toBe(4);
    expect(reg.requisicoes.every((q) => q.metodo === "GET")).toBe(true);
    expect(reg.requisicoes.map((q) => q.caminho)).toEqual(expect.arrayContaining(["/@falso/zeta/1.0.0", "/alfa/2.0.0", "/pypi/pacote-py/0.5.0/json"]));
    expect(readdirSync(a.locks).sort()).toEqual(["alfa-npm.package-lock.json", "py-uvx.requirements.txt", "zeta-npm.package-lock.json"]);
    const lockTexto = readFileSync(join(a.locks, "alfa-npm.package-lock.json"), "utf8");
    expect(JSON.parse(lockTexto).name).toBe("mcp-alfa-npm");
    const seed = JSON.parse(readFileSync(a.seed, "utf8"));
    const alfa = seed.entradas.find((e: { id: string }) => e.id === "alfa-npm");
    expect(alfa.instalacao.lock_sha256).toBe(createHash("sha256").update(lockTexto).digest("hex"));
    expect(seed.entradas.find((e: { id: string }) => e.id === "diverge-npm").instalacao.lock_sha256).toBeUndefined();
    expect(readFileSync(a.embarcado, "utf8")).toBe(readFileSync(a.seed, "utf8"));
    const rel = readFileSync(a.relatorio, "utf8");
    expect(rel).toMatch(/\| diverge-npm \| npm \| diverge@3\.0\.0 \| divergente \| erro: /);
    expect(rel).toMatch(/gerados: 3 · erros: 1/);
  });

  it("rodar duas vezes dá hashes, locks e relatório idênticos", async () => {
    const a = ambiente();
    const reg = await registroPadrao();
    const opcoes = { seed: a.seed, locks: a.locks, relatorio: a.relatorio, executar: true, registroNpm: reg.url, registroPypi: reg.url, executorNpm: lockFalso, executorPython: reqFalso };
    const um = await gerarLocks(opcoes);
    const arquivosUm = readdirSync(a.locks).map((f) => [f, readFileSync(join(a.locks, f), "utf8")]);
    const relatorioUm = readFileSync(a.relatorio, "utf8");
    const dois = await gerarLocks(opcoes);
    expect(dois.itens).toEqual(um.itens);
    expect(readdirSync(a.locks).map((f) => [f, readFileSync(join(a.locks, f), "utf8")])).toEqual(arquivosUm);
    expect(readFileSync(a.relatorio, "utf8")).toBe(relatorioUm);
  });

  it("registro fora do ar ou 404 vira erro nominal por entrada, sem derrubar as demais", async () => {
    const a = ambiente();
    const reg = (registro = await iniciarRegistroFalso([{ pacote: "alfa", versao: "2.0.0", integridade: INTEG_A }], []));
    const r = await gerarLocks({ seed: a.seed, locks: a.locks, relatorio: a.relatorio, executar: true, registroNpm: reg.url, registroPypi: reg.url, executorNpm: lockFalso, executorPython: reqFalso });
    const porId = Object.fromEntries(r.itens.map((x) => [x.id, x]));
    expect(porId["alfa-npm"]!.status).toBe("gerado");
    expect(porId["zeta-npm"]).toMatchObject({ status: "erro" });
    expect(porId["zeta-npm"]!.detalhe).toMatch(/registro_http/);
    expect(porId["py-uvx"]!.status).toBe("erro");
  });

  it("requirements sem hash é recusado; --id limita o conjunto; executor que falha vira erro", async () => {
    const a = ambiente();
    const reg = await registroPadrao();
    const semHash: ExecutorLock = async ({ pacote, versao }) => `${pacote}==${versao}\n`;
    const r = await gerarLocks({ seed: a.seed, locks: a.locks, executar: true, ids: ["py-uvx", "alfa-npm"], registroNpm: reg.url, registroPypi: reg.url, executorNpm: async () => { throw Object.assign(new Error("npm quebrou"), { codigo: "falha" }); }, executorPython: semHash });
    expect(r.itens.map((x) => x.id)).toEqual(["alfa-npm", "py-uvx"]);
    expect(r.itens[0]).toMatchObject({ status: "erro" });
    expect(r.itens[0]!.detalhe).toMatch(/npm quebrou/);
    expect(r.itens[1]!.detalhe).toMatch(/sem hashes/);
    expect(existsSync(join(a.locks, "py-uvx.requirements.txt"))).toBe(false);
  });
});

describe("gerar-lock-mcp: peças puras", () => {
  it("argv do npm só lê o registro: package-lock-only, ignore-scripts, registro explícito, sem global", () => {
    const argv = argvNpmLock({ pacote: "@a/b", versao: "1.2.3", registro: "http://127.0.0.1:1", dir: "/t" });
    expect(argv).toEqual(expect.arrayContaining(["--package-lock-only", "--ignore-scripts", "--save-exact", "@a/b@1.2.3"]));
    expect(argv[argv.indexOf("--registry") + 1]).toBe("http://127.0.0.1:1");
    expect(argv).not.toContain("-g");
    expect(argv.join(" ")).not.toMatch(/publish|login|adduser|token/);
  });

  it("argv do uv compila com hashes a partir do índice informado", () => {
    const argv = argvUvCompile({ entrada: "/t/in", saida: "/t/out", registro: "http://127.0.0.1:2/" });
    expect(argv).toEqual(expect.arrayContaining(["pip", "compile", "--generate-hashes"]));
    expect(argv[argv.indexOf("--index-url") + 1]).toBe("http://127.0.0.1:2/simple");
  });

  it("nome npm com escopo é codificado; lock é normalizado com nome fixo", () => {
    expect(nomeNpmNaUrl("@upstash/context7-mcp")).toBe("@upstash%2Fcontext7-mcp");
    const n = normalizarLockNpm(JSON.stringify({ name: "tmp-123", packages: { "": { name: "tmp-123" } } }), "x");
    expect(JSON.parse(n)).toEqual({ name: "mcp-x", packages: { "": { name: "mcp-x" } } });
    expect(n.endsWith("\n")).toBe(true);
  });

  it("lerArgumentos: padrões, flags e valor faltando", () => {
    const o = lerArgumentos(["--executar", "--id", "a", "--id", "b", "--atualizar-seed"]);
    expect(o).toMatchObject({ executar: true, atualizarSeed: true, ids: ["a", "b"] });
    expect(lerArgumentos([]).executar).toBe(false);
    expect(() => lerArgumentos(["--seed"])).toThrow(/falta valor/);
  });
});
