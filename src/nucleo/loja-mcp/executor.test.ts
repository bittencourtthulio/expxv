import { describe, expect, it } from "vitest";
import { criarExecutorProcesso } from "./executor";
import { pidVivo } from "../../../tests/fixtures/mcp-loja/servidores";

const ex = criarExecutorProcesso();
const env = { PATH: process.env["PATH"] ?? "/usr/bin:/bin" };
const node = process.execPath;

describe("executor sem shell", () => {
  it("roda e captura saída e código", async () => {
    const r = await ex.rodar({ exe: node, args: ["-e", "console.log('oi'); console.error('x'); process.exit(3)"], env, timeoutMs: 5000 });
    expect(r).toMatchObject({ codigo: 3, saida: "oi\n", erro: "x\n", timeout: false, abortado: false });
  });

  it("argumentos com metacaracteres de shell chegam literais (nunca interpretados)", async () => {
    const r = await ex.rodar({ exe: node, args: ["-e", "console.log(process.argv.slice(1).join('|'))", "a;b", "$(echo x)", "`id`", "&& ls"], env, timeoutMs: 5000 });
    expect(r.saida.trim()).toBe("a;b|$(echo x)|`id`|&& ls");
  });

  it("o filho só enxerga o ambiente informado", async () => {
    const r = await ex.rodar({ exe: node, args: ["-e", "console.log(Object.keys(process.env).filter(k=>k!=='PATH'&&k!=='__CF_USER_TEXT_ENCODING').join(','))"], env: { ...env, SO_ESTA: "1" }, timeoutMs: 5000 });
    expect(r.saida.trim()).toBe("SO_ESTA"); // (o macOS injeta __CF_USER_TEXT_ENCODING sozinho)
  });

  it("timeout mata a árvore (inclusive o neto)", async () => {
    const t0 = Date.now();
    const r = await ex.rodar({ exe: node, args: ["-e", "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(c.pid);setInterval(()=>{},1000)"], env, timeoutMs: 400 });
    expect(r.timeout).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3000);
    const neto = Number(r.saida.trim());
    await new Promise((ok) => setTimeout(ok, 200));
    expect(pidVivo(neto)).toBe(false);
  });

  it("cancelar (AbortSignal) mata e sinaliza abortado; sinal já abortado nem inicia", async () => {
    const c = new AbortController();
    const p = ex.rodar({ exe: node, args: ["-e", "setInterval(()=>{},1000)"], env, timeoutMs: 10_000, sinal: c.signal });
    setTimeout(() => c.abort(), 150);
    expect((await p).abortado).toBe(true);
    const ja = await ex.rodar({ exe: node, args: ["-e", "1"], env, timeoutMs: 1000, sinal: AbortSignal.abort() });
    expect(ja).toMatchObject({ abortado: true, codigo: null, saida: "" });
  });

  it("limita a saída e executável inexistente vira nao_iniciou", async () => {
    const r = await ex.rodar({ exe: node, args: ["-e", "process.stdout.write('x'.repeat(50000)); setInterval(()=>{},1000)"], env, timeoutMs: 5000, limiteSaida: 1000 });
    expect(r.excedeu_saida).toBe(true);
    expect(r.saida.length).toBeLessThanOrEqual(1000);
    const nada = await ex.rodar({ exe: "/nao/existe/xyz", args: [], env, timeoutMs: 1000 });
    expect(nada.nao_iniciou).toBe(true);
  });
});
