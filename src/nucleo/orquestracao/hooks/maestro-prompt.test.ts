// Script `maestro-prompt.mjs` (T-16.28) contra um servidor LOOPBACK de teste: bloqueio, falha aberta, teto de 400 ms. Nenhuma rede externa.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "scripts", "maestro-prompt.mjs");
const FIXTURE = readFileSync(join(__dirname, "../../../../tests/fixtures/maestro/claude-UserPromptSubmit.json"), "utf8");
const servidores: Server[] = [];
afterEach(async () => {
  while (servidores.length) await new Promise<void>((ok) => { const s = servidores.pop() as Server; s.closeAllConnections(); s.close(() => ok()); });
});

interface Visto { metodo: string | undefined; url: string | undefined; auth: string | undefined; corpo: string }
async function subir(h: (req: IncomingMessage, res: ServerResponse, corpo: string) => void): Promise<{ url: string; vistos: Visto[] }> {
  const vistos: Visto[] = [];
  const s = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (p: Buffer) => partes.push(p));
    req.on("end", () => {
      const corpo = Buffer.concat(partes).toString("utf8");
      vistos.push({ metodo: req.method, url: req.url, auth: req.headers.authorization, corpo });
      h(req, res, corpo);
    });
  });
  servidores.push(s);
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/hooks`, vistos };
}

function rodar(env: Record<string, string>, entrada: string): Promise<{ codigo: number | null; saida: string; erro: string; ms: number }> {
  return new Promise((resolver) => {
    const t0 = Date.now();
    const f = spawn(process.execPath, [SCRIPT, "T_URL", "T_TOKEN"], { env: { PATH: process.env["PATH"] ?? "", ...env } });
    let saida = "";
    let erro = "";
    f.stdout.on("data", (d: Buffer) => (saida += d.toString()));
    f.stderr.on("data", (d: Buffer) => (erro += d.toString()));
    f.on("close", (codigo) => resolver({ codigo, saida, erro, ms: Date.now() - t0 }));
    f.stdin.end(entrada);
  });
}

describe("maestro-prompt.mjs", () => {
  it("posta o payload ao /maestro-prompt com o token do Pane e imprime SÓ o bloqueio do Maestro", async () => {
    const { url, vistos } = await subir((_q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ decision: "block", reason: "Maestro: encaminhado como bug", extra: "ignorado" })); });
    const r = await rodar({ T_URL: url, T_TOKEN: "tok-do-pane" }, FIXTURE);
    expect(r.codigo).toBe(0);
    expect(JSON.parse(r.saida)).toEqual({ decision: "block", reason: "Maestro: encaminhado como bug" });
    expect(vistos).toHaveLength(1);
    expect(vistos[0]).toMatchObject({ metodo: "POST", url: "/hooks/maestro-prompt", auth: "Bearer tok-do-pane" });
    expect(JSON.parse(vistos[0]!.corpo)).toMatchObject({ hook_event_name: "UserPromptSubmit", prompt: expect.stringContaining("corrige") });
  });
  it("resposta vazia, {} ou sem bloqueio => saída vazia (o prompt segue)", async () => {
    for (const corpo of ["{}", "null", "", '{"hookSpecificOutput":{"additionalContext":"x"}}', "não é json", '{"decision":"block"}']) {
      const { url } = await subir((_q, r) => { r.writeHead(200); r.end(corpo); });
      const r = await rodar({ T_URL: url, T_TOKEN: "t" }, FIXTURE);
      expect(r, corpo).toMatchObject({ codigo: 0, saida: "" });
    }
  });
  it("falha aberta: 401, 500, conexão recusada e variáveis ausentes => saída vazia, código 0", async () => {
    for (const status of [401, 500]) {
      const { url } = await subir((_q, r) => { r.writeHead(status); r.end('{"decision":"block","reason":"x"}'); });
      expect(await rodar({ T_URL: url, T_TOKEN: "t" }, FIXTURE)).toMatchObject({ codigo: 0, saida: "" });
    }
    expect(await rodar({ T_URL: "http://127.0.0.1:1/hooks", T_TOKEN: "t" }, FIXTURE)).toMatchObject({ codigo: 0, saida: "" });
    expect(await rodar({}, FIXTURE)).toMatchObject({ codigo: 0, saida: "" });
    expect(await rodar({ T_URL: "http://127.0.0.1:1/hooks" }, FIXTURE)).toMatchObject({ codigo: 0, saida: "" });
  });
  it("teto duro de 400 ms: servidor lento => o prompt segue sem esperar", async () => {
    const { url } = await subir((_q, r) => { setTimeout(() => { try { r.writeHead(200); r.end('{"decision":"block","reason":"tarde"}'); } catch { /* fechado */ } }, 3000); });
    const r = await rodar({ T_URL: url, T_TOKEN: "t" }, FIXTURE);
    expect(r.codigo).toBe(0);
    expect(r.saida).toBe("");
    expect(r.ms).toBeLessThan(1500);
  });
  it("stdin vazio: posta {} e não quebra; nunca escreve o token no stderr/stdout", async () => {
    const { url, vistos } = await subir((_q, r) => { r.writeHead(200); r.end("{}"); });
    const r = await rodar({ T_URL: url, T_TOKEN: "SEGREDO-TOKEN" }, "");
    expect(vistos[0]!.corpo).toBe("{}");
    expect(r.saida + r.erro).not.toContain("SEGREDO-TOKEN");
  });
  it("fonte: URL e token só por variável de ambiente (nunca argv) e sem fetch/rede externa", () => {
    const fonte = readFileSync(SCRIPT, "utf8");
    expect(fonte).toContain("AbortSignal.timeout(TETO_MS)");
    expect(fonte).toMatch(/TETO_MS = 400/);
    expect(fonte).not.toMatch(/https:\/\/|fetch\(/);
  });
});
