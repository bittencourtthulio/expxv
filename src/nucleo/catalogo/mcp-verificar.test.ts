import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { lerConfigBruta, verificarServidor, type ConfigMcpBruta } from "./mcp-verificar";

const FALSO = join(__dirname, "..", "..", "..", "tests", "fixtures", "catalogo", "mcp-falso.mjs");
const dir = mkdtempSync(join(tmpdir(), "cat-mcpv-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("lerConfigBruta (relida na hora, em memória)", () => {
  it("lê claude/opencode/codex e devolve null para ausente", async () => {
    writeFileSync(join(dir, "c.json"), JSON.stringify({ mcpServers: { a: { command: "node", args: ["x"], env: { K: "v" } } }, projects: { "/p": { mcpServers: { b: { type: "http", url: "http://127.0.0.1:1/mcp", headers: { H: "1" } } } } } }));
    expect(await lerConfigBruta({ cli: "claude", nome: "a", arquivoAbs: join(dir, "c.json") })).toMatchObject({ transporte: "stdio", command: "node", env: { K: "v" } });
    expect(await lerConfigBruta({ cli: "claude", nome: "b", arquivoAbs: join(dir, "c.json") })).toMatchObject({ transporte: "http", headers: { H: "1" } });
    writeFileSync(join(dir, "o.json"), JSON.stringify({ mcp: { o: { type: "local", command: ["node", "y"], environment: { E: "1" } } } }));
    expect(await lerConfigBruta({ cli: "opencode", nome: "o", arquivoAbs: join(dir, "o.json") })).toMatchObject({ command: "node", args: ["y"], env: { E: "1" } });
    writeFileSync(join(dir, "c.toml"), `[mcp_servers.t]\ncommand = "node"\n[mcp_servers.t.env]\nA = "1"\n`);
    expect(await lerConfigBruta({ cli: "codex", nome: "t", arquivoAbs: join(dir, "c.toml") })).toMatchObject({ env: { A: "1" } });
    expect(await lerConfigBruta({ cli: "claude", nome: "zzz", arquivoAbs: join(dir, "c.json") })).toBeNull();
    expect(await lerConfigBruta({ cli: "claude", nome: "a", arquivoAbs: join(dir, "nao-existe.json") })).toBeNull();
  });
});

describe("verificarServidor", () => {
  it("stdio real (servidor falso, sem shell): lista as ferramentas com descrição saneada", async () => {
    const cfg: ConfigMcpBruta = { transporte: "stdio", command: process.execPath, args: [FALSO], env: { SEGREDO_TESTE: "valor-secreto-xyz" }, headers: {} };
    const r = await verificarServidor(cfg);
    expect(r.estado).toBe("ok");
    expect(r.lista.map((f) => f.nome)).toEqual(["ler_x", "gravar_y"]);
    expect(r.lista[0]?.descricao).not.toMatch(/‮/);
    expect(JSON.stringify(r)).not.toContain("valor-secreto-xyz");
  }, 15000);
  it("servidor offline/inexistente = indisponivel sem lançar e sem vazar a mensagem crua", async () => {
    const r = await verificarServidor({ transporte: "stdio", command: "/nao/existe/binario-x", args: [], env: {}, headers: {} });
    expect(r).toMatchObject({ estado: "indisponivel", ferramentas: 0 });
    expect(r.erro).toMatch(/^(falha_ao_listar|tempo_esgotado)$/);
    expect((await verificarServidor(null)).erro).toBe("configuracao_nao_encontrada");
  }, 15000);
  it("timeout: servidor que não responde é encerrado", async () => {
    const t0 = Date.now();
    const r = await verificarServidor({ transporte: "stdio", command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], env: {}, headers: {} }, undefined, 600);
    expect(r.erro).toBe("tempo_esgotado");
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it("http só em loopback: remoto é recusado sem tráfego", async () => {
    const r = await verificarServidor({ transporte: "http", url: "https://exemplo.com/mcp", env: {}, headers: { Authorization: "S" } });
    expect(r.erro).toBe("remoto_nao_suportado");
  });
  it("http em loopback com servidor que não fala MCP = indisponivel", async () => {
    const srv = createServer((_q, s) => { s.writeHead(500); s.end("x"); });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    const porta = (srv.address() as { port: number }).port;
    const r = await verificarServidor({ transporte: "http", url: `http://127.0.0.1:${porta}/mcp`, env: {}, headers: {} });
    srv.close();
    expect(r.estado).toBe("indisponivel");
  }, 15000);
});
