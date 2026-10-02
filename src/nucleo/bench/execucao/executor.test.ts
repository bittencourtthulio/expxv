import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { consultarProcesso, criarExecutor, criarRegistroPidsArquivo, criarRegistroPidsMemoria, limparOrfaos } from "./executor";

const CLI = resolve(__dirname, "../../../../tests/fixtures/cli-bench.mjs");
const base = realpathSync(mkdtempSync(join(tmpdir(), "bench-ex-")));
const filhosVivos: number[] = [];
afterEach(() => { for (const p of filhosVivos.splice(0)) { try { process.kill(-p, "SIGKILL"); } catch { /* morto */ } } });
afterAll(() => rmSync(base, { recursive: true, force: true }));
const env = { PATH: process.env["PATH"] ?? "", ELECTRON_RUN_AS_NODE: "1" };
let n = 0;
const novoCwd = (): string => { const d = join(base, `c${++n}`); mkdirSync(d, { recursive: true }); return d; };
const vivo = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pedido = (cwd: string, prompt: string, extra: Record<string, unknown> = {}) => ({ executavel: process.execPath, args: [CLI, "-p"], cwd, env, stdin: prompt, logAbs: join(base, `log${n}.txt`), ...extra });

describe("executor", () => {
  it("conclui, escreve o artefato no cwd, manda stdout para o ARQUIVO de log e mede a duração", async () => {
    const ex = criarExecutor();
    const cwd = novoCwd();
    const r = await ex.executar(pedido(cwd, "faça algo"));
    expect(r.estado).toBe("concluido");
    expect(r.codigo).toBe(0);
    expect(existsSync(join(cwd, "index.html"))).toBe(true);
    expect(readFileSync(join(base, `log${n}.txt`), "utf8")).toContain('"type":"result"');
    expect(r.duracao_s).toBeGreaterThan(0);
    expect(ex.vivos()).toBe(0);
  });
  it("saída ≠ 0 vira falhou, sem retentativa", async () => {
    const r = await criarExecutor().executar(pedido(novoCwd(), "MODO:FALHA"));
    expect(r.estado).toBe("falhou");
    expect(r.codigo).toBe(2);
    expect(readFileSync(join(base, `log${n}.txt`), "utf8")).toContain("falha simulada");
  });
  it("timeout → tempo_esgotado e o artefato PARCIAL é preservado", async () => {
    const cwd = novoCwd();
    const r = await criarExecutor().executar(pedido(cwd, "MODO:TIMEOUT", { timeoutMs: 700 }));
    expect(r.estado).toBe("tempo_esgotado");
    expect(readFileSync(join(cwd, "parcial.html"), "utf8")).toContain("parcial");
  });
  it("executável inexistente falha limpo (sem lançar)", async () => {
    const r = await criarExecutor().executar({ ...pedido(novoCwd(), ""), executavel: "/nao/existe/bin" });
    expect(r.estado).toBe("falhou");
    expect(r.erro).toBeTruthy();
  });
  it("cancelar mata a ÁRVORE (inclusive o neto) em ≤ 2 s e deixa 0 vivos", async () => {
    const ex = criarExecutor();
    const cwd = novoCwd();
    const ac = new AbortController();
    const promessa = ex.executar(pedido(cwd, "MODO:FILHO"), ac.signal);
    const t0 = Date.now();
    while (!existsSync(join(cwd, "filhos.json")) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 25));
    const { pid, neto } = JSON.parse(readFileSync(join(cwd, "filhos.json"), "utf8")) as { pid: number; neto: number };
    expect(vivo(neto)).toBe(true);
    const c0 = Date.now();
    ac.abort();
    const r = await promessa;
    expect(r.estado).toBe("cancelado");
    expect(Date.now() - c0).toBeLessThan(2000);
    await new Promise((r2) => setTimeout(r2, 100));
    expect(vivo(pid)).toBe(false);
    expect(vivo(neto)).toBe(false);
    expect(ex.vivos()).toBe(0);
  });
  it("cancelarTodos mata 3 execuções presas de uma vez", async () => {
    const ex = criarExecutor();
    const ps = [1, 2, 3].map(() => ex.executar(pedido(novoCwd(), "MODO:PRESO")));
    await new Promise((r) => setTimeout(r, 300));
    expect(ex.vivos()).toBe(3);
    const t0 = Date.now();
    await ex.cancelarTodos();
    expect((await Promise.all(ps)).every((r) => r.estado === "cancelado")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(ex.vivos()).toBe(0);
  });
  it("saída acima do teto é marcada como truncada e a execução é encerrada", async () => {
    const r = await criarExecutor().executar(pedido(novoCwd(), "MODO:GRANDE:6", { tetoSaidaBytes: 1024 * 1024 }));
    expect(r.truncado).toBe(true);
    expect(r.estado).toBe("falhou");
  });
  it("o stdin entrega o prompt à CLI (e não vai no argv)", async () => {
    const cwd = novoCwd();
    const reg = join(cwd, "reg.json");
    await criarExecutor().executar(pedido(cwd, "meu prompt secreto", { env: { ...env, CLI_FALSA_REGISTRO: reg } }));
    const o = JSON.parse(readFileSync(reg, "utf8")) as { args: string[]; stdin: string };
    expect(o.stdin).toBe("meu prompt secreto");
    expect(JSON.stringify(o.args)).not.toContain("secreto");
  });
});

describe("órfãos (anti-pid-reaproveitado)", () => {
  it("mata o processo que confere (início + comando) e limpa o registro", async () => {
    const f = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore", env });
    f.unref();
    filhosVivos.push(f.pid as number);
    const proc = consultarProcesso(f.pid as number);
    expect(proc).not.toBeNull();
    const reg = criarRegistroPidsArquivo(join(base, "pids"));
    reg.registrar({ pid: f.pid as number, inicio: (proc as { inicio: string }).inicio, comando: (proc as { comando: string }).comando, rotulo: "x" });
    const mortos = limparOrfaos(reg);
    expect(mortos).toEqual([f.pid]);
    await new Promise((r) => setTimeout(r, 150));
    expect(vivo(f.pid as number)).toBe(false);
    expect(reg.listar()).toEqual([]);
  });
  it("pid reaproveitado por OUTRO processo (início ou comando diferentes) NÃO é morto", () => {
    const reg = criarRegistroPidsMemoria();
    const mortos: number[] = [];
    reg.registrar({ pid: 4242, inicio: "Mon Jan  1 00:00:00 2026", comando: "claude -p --output-format json", rotulo: "a" });
    reg.registrar({ pid: 4243, inicio: "Mon Jan  1 00:00:00 2026", comando: "claude -p --output-format json", rotulo: "b" });
    const consultar = (pid: number) => (pid === 4242 ? { inicio: "Tue Feb  2 10:00:00 2026", comando: "claude -p --output-format json" } : { inicio: "Mon Jan  1 00:00:00 2026", comando: "/usr/bin/vim notas.txt" });
    expect(limparOrfaos(reg, consultar, (p) => void mortos.push(p))).toEqual([]);
    expect(mortos).toEqual([]);
    expect(reg.listar()).toEqual([]);
  });
  it("processo que não existe mais só limpa o registro", () => {
    const reg = criarRegistroPidsMemoria();
    reg.registrar({ pid: 99999, inicio: "x", comando: "y", rotulo: "" });
    expect(limparOrfaos(reg, () => null, () => { throw new Error("não devia matar"); })).toEqual([]);
    expect(reg.listar()).toEqual([]);
  });
  it("registro em arquivo ignora arquivo corrompido", () => {
    const pasta = join(base, "pids2");
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, "12.json"), "{lixo");
    expect(criarRegistroPidsArquivo(pasta).listar()).toEqual([]);
  });
});
