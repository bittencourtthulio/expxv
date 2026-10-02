// Lançador `mcp-run` + rota `POST /loja/segredos` de ponta a ponta (T-07B.21): servidor MCP do app REAL em loopback, cofre real
// (cifrador falso), servidor MCP FALSO `eco-ambiente`. Nenhum pacote real, nenhuma rede externa.
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { variavelDeAmbiente } from "../produto";
import { iniciarServidorMcp, type ServidorMcp } from "../mcp/servidor";
import { criarEmissorDeTokens } from "../mcp/tokens";
import type { DepsTools } from "../mcp/tools/comum";
import { handshake, SessaoStdio } from "./verificacao";
import { montarLancamento } from "./lancamento";
import { criarSegredosMcp, criarServicoSegredos } from "./segredos";
import { criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { catalogoFalso, cofreDeTeste, entradaNpmFalsa, limparPastas, novaPasta } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";
import { caminhoFalso } from "../../../tests/fixtures/mcp-loja/servidores";

const RUN = join(__dirname, "..", "..", "..", "resources", "mcp", "mcp-run.mjs");
const SEGREDO = "SENTINELA-lancador-4f2a-nunca-vazar";
let servidor: ServidorMcp | null = null;
const sessoes: SessaoStdio[] = [];
afterEach(async () => {
  await Promise.all(sessoes.splice(0).map((s) => s.encerrar()));
  await servidor?.fechar();
  servidor = null;
  limparPastas();
});

async function montar(opcoes: { limite?: number } = {}) {
  const userData = novaPasta("ud-");
  const eco = entradaNpmFalsa("falso-eco-chave", "@falso/eco", {
    autenticacao: "chave_api",
    variaveis: [{ nome: "FALSO_API_KEY", obrigatoria: true, secreta: true, ajuda: "chave de teste", onde_conseguir: null }],
  });
  const catalogo = catalogoFalso([eco]);
  const bin = join(userData, "mcp", "falso-eco-chave", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "servidor.mjs"), `import ${JSON.stringify(pathToFileURL(caminhoFalso("eco-ambiente")).href)};\n`);
  const segredos = criarSegredosMcp(cofreDeTeste(novaPasta("cofre-")));
  await segredos.gravar(catalogo.porId.get("falso-eco-chave")!.entrada, "FALSO_API_KEY", SEGREDO);
  const permitidos = new Map<string, Set<string>>([["pane_com", new Set(["falso-eco-chave"])], ["pane_sem", new Set()]]);
  const svc = criarServicoSegredos({
    segredos, catalogo, permitidosDoToken: (p) => permitidos.get(p) ?? null, ...(opcoes.limite ? { limitePorMinuto: opcoes.limite } : {}),
    comando: (e, v) => montarLancamento(e, v, { userData, node: process.execPath, nodeEhElectron: false }),
  });
  const deps: DepsTools = {
    ...criarMundo().deps,
    loja: {
      async segredos(paneId, srv) {
        const r = await svc.resolver(paneId, srv);
        return r.status === 200 ? { status: 200, corpo: { comando: r.comando } } : { status: r.status, corpo: { erro: r.erro } };
      },
    },
  };
  const emissor = criarEmissorDeTokens();
  servidor = await iniciarServidorMcp({ deps, emissor });
  const token = (pane: string): string => emissor.emitir({ aud: ["loja-launcher"], workspace_id: "ws_1", mission_id: null, pane_id: pane, role: "nenhum", mode: "livre", tools_allow: [] });
  return { servidor, token, url: `http://127.0.0.1:${servidor.porta}/loja/segredos` };
}

function post(porta: number, corpo: unknown, headers: Record<string, string> = {}): Promise<{ status: number; corpo: string; cabecalhos: Record<string, unknown> }> {
  const texto = JSON.stringify(corpo);
  return new Promise((ok, erro) => {
    const r = request({ host: "127.0.0.1", port: porta, path: "/loja/segredos", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(texto), ...headers } }, (res) => {
      const p: Buffer[] = [];
      res.on("data", (d: Buffer) => p.push(d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, corpo: Buffer.concat(p).toString(), cabecalhos: res.headers }));
    });
    r.on("error", erro);
    r.end(texto);
  });
}

function sessaoPeloLancador(url: string, token: string, id = "falso-eco-chave"): SessaoStdio {
  const s = new SessaoStdio({
    executavel: process.execPath, args: [RUN, "--servidor", id],
    // o ambiente do Pane tem chave de provedor e o token: nada disso pode chegar ao servidor real
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", [variavelDeAmbiente("LOJA_URL")]: url, [variavelDeAmbiente("LOJA_TOKEN")]: token, ANTHROPIC_API_KEY: "sk-ant-NUNCA-NO-SERVIDOR" },
  });
  sessoes.push(s);
  return s;
}

describe("rota /loja/segredos", () => {
  it("401 sem token, 403 fora da política, 400 corpo ruim, no-store sempre; o corpo do pedido nunca decide a identidade", async () => {
    const { servidor: s, token } = await montar();
    const h = (pane: string): Record<string, string> => ({ host: `127.0.0.1:${s.porta}`, authorization: `Bearer ${token(pane)}` });
    expect((await post(s.porta, { servidor: "falso-eco-chave" }, { host: `127.0.0.1:${s.porta}` })).status).toBe(401);
    const sem = await post(s.porta, { servidor: "falso-eco-chave" }, h("pane_sem"));
    expect(sem.status).toBe(403);
    expect(sem.cabecalhos["cache-control"]).toBe("no-store");
    expect(sem.corpo).not.toContain(SEGREDO);
    expect((await post(s.porta, { servidor: "../x" }, h("pane_com"))).status).toBe(400);
    expect((await post(s.porta, { servidor: "falso-eco-chave", pane_id: "pane_com" }, h("pane_sem"))).status).toBe(403);
    const ok = await post(s.porta, { servidor: "falso-eco-chave" }, h("pane_com"));
    expect(ok.status).toBe(200);
    expect(ok.cabecalhos["cache-control"]).toBe("no-store");
    expect(JSON.parse(ok.corpo).comando.env["FALSO_API_KEY"]).toBe(SEGREDO);
  });

  it("R-1: o token GERAL do Pane (ambiente do agente: audiência mcp/hooks) e o do gateway NÃO leem segredo; só o do lançador", async () => {
    const { servidor: s } = await montar();
    const geral = s.emitirToken({ workspace_id: "ws_1", mission_id: null, pane_id: "pane_com", role: "nenhum", mode: "livre", tools_allow: [] });
    const gateway = s.emitirToken({ aud: ["gateway"], workspace_id: "ws_1", mission_id: null, pane_id: "pane_com", role: "nenhum", mode: "livre", tools_allow: [] });
    for (const t of [geral, gateway]) {
      const r = await post(s.porta, { servidor: "falso-eco-chave" }, { host: `127.0.0.1:${s.porta}`, authorization: `Bearer ${t}` });
      expect(r.status).toBe(401);
      expect(r.corpo).not.toContain(SEGREDO);
    }
    const lanc = s.emitirToken({ aud: ["loja-launcher"], workspace_id: "ws_1", mission_id: null, pane_id: "pane_com", role: "nenhum", mode: "livre", tools_allow: [] });
    expect((await post(s.porta, { servidor: "falso-eco-chave" }, { host: `127.0.0.1:${s.porta}`, authorization: `Bearer ${lanc}` })).status).toBe(200);
  });

  it("R-1: teto de leituras do segredo de um servidor por Pane (preso ao snapshot; esgota rápido)", async () => {
    let t = 0;
    const catalogo = catalogoFalso([entradaNpmFalsa("falso-eco-chave", "@falso/eco", { autenticacao: "chave_api", variaveis: [{ nome: "FALSO_API_KEY", obrigatoria: true, secreta: true, ajuda: "chave de teste", onde_conseguir: null }] })]);
    const segredos = criarSegredosMcp(cofreDeTeste(novaPasta("cofre-")));
    await segredos.gravar(catalogo.porId.get("falso-eco-chave")!.entrada, "FALSO_API_KEY", SEGREDO);
    const svc = criarServicoSegredos({ segredos, catalogo, permitidosDoToken: () => new Set(["falso-eco-chave"]), agora: () => (t += 61_000), limiteTotalPorServidor: 3 });
    for (let i = 0; i < 3; i++) expect((await svc.resolver("pane_x", "falso-eco-chave")).status).toBe(200);
    expect((await svc.resolver("pane_x", "falso-eco-chave")).status).toBe(429);
    expect((await svc.resolver("pane_y", "falso-eco-chave")).status).toBe(200);
  });

  it("a 6ª chamada no minuto do mesmo Pane vira 429", async () => {
    const { servidor: s, token } = await montar();
    const h = { host: `127.0.0.1:${s.porta}`, authorization: `Bearer ${token("pane_com")}` };
    for (let i = 0; i < 5; i++) expect((await post(s.porta, { servidor: "falso-eco-chave" }, h)).status).toBe(200);
    expect((await post(s.porta, { servidor: "falso-eco-chave" }, h)).status).toBe(429);
  });
});

describe("lançador mcp-run", () => {
  it("sobe o servidor real com o segredo e SÓ a allowlist + declaradas (AC-11): sem ANTHROPIC_*, sem token nem URL de loopback", async () => {
    const { url, token } = await montar();
    const s = sessaoPeloLancador(url, token("pane_com"));
    await handshake(s);
    const r = (await s.pedir("tools/call", { name: "listar_ambiente", arguments: {} })) as { content: Array<{ text: string }> };
    const nomes = JSON.parse(r.content[0]!.text) as string[];
    expect(nomes).toContain("FALSO_API_KEY");
    expect(nomes).toContain("PATH");
    expect(nomes.filter((n) => /ANTHROPIC|LOJA|TOKEN/.test(n))).toEqual([]);
    expect(JSON.stringify(nomes)).not.toContain(SEGREDO);
  });

  it("Pane sem permissão: stderr claro, exit 70 e nenhum segredo", async () => {
    const { url, token } = await montar();
    const s = sessaoPeloLancador(url, token("pane_sem"));
    await expect(handshake(s)).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(s.stderr).toMatch(/mcp-run: .*403/);
    expect(s.stderr).not.toContain(SEGREDO);
    expect(s.filho.exitCode).toBe(70);
  });

  it("recusa endereço que não é loopback e argumento --servidor inválido (exit 70, sem rede)", async () => {
    const execs = async (url: string, id: string): Promise<{ codigo: number | null; erro: string }> => {
      const s = new SessaoStdio({ executavel: process.execPath, args: [RUN, "--servidor", id], env: { PATH: "/usr/bin:/bin", [variavelDeAmbiente("LOJA_URL")]: url, [variavelDeAmbiente("LOJA_TOKEN")]: "x" } });
      sessoes.push(s);
      await new Promise((r) => s.filho.once("exit", r));
      return { codigo: s.filho.exitCode, erro: s.stderr };
    };
    expect(await execs("http://exemplo.com/loja/segredos", "falso-eco-chave")).toMatchObject({ codigo: 70, erro: expect.stringContaining("loopback") });
    expect(await execs("http://127.0.0.1:1/loja/segredos", "../x")).toMatchObject({ codigo: 70, erro: expect.stringContaining("--servidor") });
  });
});
