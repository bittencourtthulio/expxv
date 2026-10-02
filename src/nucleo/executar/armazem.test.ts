import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarArmazemExecutar, leitorDeDisco } from "./armazem";
import type { ConfigExecucao } from "./modelo";

let raiz: string;
let dados: string;
let fora: string;
beforeEach(() => {
  raiz = realpathSync(mkdtempSync(join(tmpdir(), "exec-raiz-")));
  dados = realpathSync(mkdtempSync(join(tmpdir(), "exec-dados-")));
  fora = realpathSync(mkdtempSync(join(tmpdir(), "exec-fora-")));
});
afterEach(() => { for (const d of [raiz, dados, fora]) { try { chmodSync(d, 0o755); } catch { /* ok */ } rmSync(d, { recursive: true, force: true }); } });

const cfg = (id = "dev"): ConfigExecucao => ({
  id, nome: "Rodar", tipo: "rodar", executavel: "npm", argumentos: ["run", "dev"], cwd: ".", ambiente: {}, pre_passos: [], porta: null, url: null,
  abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null, origem: "usuario",
});

describe("configurações do usuário em .expxv/executar.json", () => {
  it("grava no repositório (relativo, versionável) e relê; nunca em docs/", () => {
    const a = criarArmazemExecutar(dados);
    expect(a.gravarConfig("ws_1", raiz, { versao: 1, padrao: "dev", configuracoes: [cfg()] })).toBe("arquivo");
    const texto = readFileSync(join(raiz, ".expxv/executar.json"), "utf8");
    expect(JSON.parse(texto)).toMatchObject({ versao: 1, padrao: "dev", configuracoes: [{ id: "dev", executavel: "npm" }] });
    expect(texto).not.toContain("origem");
    expect(texto).not.toContain(raiz); // nada de caminho absoluto
    expect(existsSync(join(raiz, "docs"))).toBe(false);
    const lida = a.lerConfig("ws_1", raiz);
    expect(lida.onde).toBe("arquivo");
    expect(lida.arquivo.padrao).toBe("dev");
    expect(lida.arquivo.configuracoes[0]).toMatchObject({ id: "dev", origem: "usuario" });
  });

  it("sem arquivo e sem fallback: nenhuma", () => {
    expect(criarArmazemExecutar(dados).lerConfig("ws_1", raiz).onde).toBe("nenhum");
  });

  it("pasta não gravável: cai para os dados do app e relê de lá", () => {
    const a = criarArmazemExecutar(dados);
    chmodSync(raiz, 0o555);
    if (process.getuid?.() === 0) return; // root escreve em tudo
    expect(a.gravarConfig("ws_1", raiz, { versao: 1, padrao: null, configuracoes: [cfg("api")] })).toBe("app");
    expect(existsSync(join(raiz, ".expxv"))).toBe(false);
    const lida = a.lerConfig("ws_1", raiz);
    expect(lida.onde).toBe("app");
    expect(lida.arquivo.configuracoes.map((c) => c.id)).toEqual(["api"]);
  });

  it(".expxv como symlink para fora: não escreve fora, usa o fallback", () => {
    symlinkSync(fora, join(raiz, ".expxv"));
    const a = criarArmazemExecutar(dados);
    expect(a.gravarConfig("ws_1", raiz, { versao: 1, padrao: null, configuracoes: [cfg()] })).toBe("app");
    expect(readdirSync(fora)).toEqual([]);
  });

  it("executar.json symlink para fora: não é lido nem sobrescrito", () => {
    writeFileSync(join(fora, "alvo.json"), JSON.stringify({ versao: 1, padrao: null, configuracoes: [{ ...cfg("invasor"), origem: undefined }] }));
    mkdirSync(join(raiz, ".expxv"));
    symlinkSync(join(fora, "alvo.json"), join(raiz, ".expxv/executar.json"));
    const a = criarArmazemExecutar(dados);
    expect(a.lerConfig("ws_1", raiz).arquivo.configuracoes).toEqual([]);
    expect(a.gravarConfig("ws_1", raiz, { versao: 1, padrao: null, configuracoes: [cfg()] })).toBe("app");
    expect(readFileSync(join(fora, "alvo.json"), "utf8")).toContain("invasor");
  });

  it("arquivo corrompido vira vazio, sem lançar", () => {
    mkdirSync(join(raiz, ".expxv"));
    writeFileSync(join(raiz, ".expxv/executar.json"), "{ não é json");
    expect(criarArmazemExecutar(dados).lerConfig("ws_1", raiz).arquivo.configuracoes).toEqual([]);
  });
});

describe("confiança por hash e histórico (dados do app, nunca no repositório)", () => {
  it("confiar, ler, revogar uma e revogar todas", () => {
    const a = criarArmazemExecutar(dados);
    expect(a.hashConfiado("ws_1", "dev")).toBeNull();
    a.confiar("ws_1", "dev", "h1");
    a.confiar("ws_1", "build", "h2");
    a.confiar("ws_2", "dev", "h3");
    expect(a.hashConfiado("ws_1", "dev")).toBe("h1");
    a.revogar("ws_1", "dev");
    expect(a.hashConfiado("ws_1", "dev")).toBeNull();
    expect(a.hashConfiado("ws_1", "build")).toBe("h2");
    a.revogar("ws_1");
    expect(a.hashConfiado("ws_1", "build")).toBeNull();
    expect(a.hashConfiado("ws_2", "dev")).toBe("h3");
    expect(existsSync(join(raiz, ".expxv"))).toBe(false);
  });
  it("o arquivo de confiança do repositório não existe: um repo malicioso não consegue se autoconfiar", () => {
    mkdirSync(join(raiz, ".expxv"));
    writeFileSync(join(raiz, ".expxv/confianca.json"), JSON.stringify({ ws_1: { dev: "x" } }));
    expect(criarArmazemExecutar(dados).hashConfiado("ws_1", "dev")).toBeNull();
  });
  it("histórico guarda as últimas 20, mais novas primeiro", () => {
    const a = criarArmazemExecutar(dados);
    for (let i = 0; i < 25; i += 1) a.registrarHistorico("ws_1", { execucao_id: `e${i}`, config_id: "dev", nome: "Rodar", comando: "npm run dev", iniciado_em: "2026-01-01T00:00:00.000Z", duracao_ms: i, codigo: 0, sinal: null, resultado: "sucesso" });
    const h = a.historico("ws_1");
    expect(h).toHaveLength(20);
    expect(h[0]!.execucao_id).toBe("e24");
    expect(a.historico("ws_9")).toEqual([]);
  });
});

describe("leitor de disco confinado", () => {
  it("lê arquivos da raiz; symlink para fora e '..' são invisíveis", () => {
    writeFileSync(join(raiz, "package.json"), "{}");
    writeFileSync(join(fora, "segredo.txt"), "s");
    symlinkSync(join(fora, "segredo.txt"), join(raiz, "atalho.txt"));
    symlinkSync(fora, join(raiz, "pastafora"));
    const l = leitorDeDisco(raiz);
    expect(l.ler("package.json")).toBe("{}");
    expect(l.existe("package.json")).toBe(true);
    expect(l.ler("atalho.txt")).toBeNull();
    expect(l.existe("atalho.txt")).toBe(false);
    expect(l.listar("pastafora")).toEqual([]);
    expect(l.ler("../x")).toBeNull();
    expect(l.ler(join(fora, "segredo.txt"))).toBeNull();
  });
  it("arquivo maior que 1 MiB não é lido", () => {
    writeFileSync(join(raiz, "grande.json"), "x".repeat(1024 * 1024 + 1));
    expect(leitorDeDisco(raiz).ler("grande.json")).toBeNull();
  });
});
