// Contrato do isolamento (Fase 7, T-07.25) com CLI FALSA (sem CLI real, sem rede, sem custo): settings gerado -> hook real (`gancho.mjs`) -> servidor MCP real em
// loopback -> gate. Premissa quebrada = teste vermelho com a mensagem dizendo qual premissa mudou. `EXPXV_TESTE_CLI_REAL=1` (nunca no piloto automático) fica para o dono.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decidirGate, type SnapshotPane } from "../../src/nucleo/catalogo/gate";
import { montarIsolamentoClaude } from "../../src/nucleo/catalogo/isolamento/claude";
import { NIVEL_POR_CLI, resolverPolitica } from "../../src/nucleo/catalogo/politica";
import { criarEmissorDeTokens } from "../../src/nucleo/mcp/tokens";
import { iniciarServidorMcp, type ServidorMcp } from "../../src/nucleo/mcp/servidor";
import { criarGanchosClaude, gerarSettingsDoPane } from "../../src/nucleo/orquestracao/hooks/claude";
import { PRODUTO } from "../../src/nucleo/produto";
import { criarMundo } from "../fixtures/mcp/dubles";

const CLI = join(__dirname, "..", "fixtures", "cli-catalogo.mjs");
const GANCHO = join(__dirname, "..", "..", "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs");
const URL_VAR = "TESTE_GANCHOS_URL";
const TOKEN_VAR = "TESTE_MCP_TOKEN";
const abertos: ServidorMcp[] = [];
afterEach(async () => { while (abertos.length) await abertos.pop()?.fechar(); });

const CATALOGO = ["a1", "a2", "a3", "a4"].map((n) => ({ nome_normalizado: n, nome: n, origem: "usuario" as const, plugin: null }));

async function montar(opcoes: { politicas?: Parameters<typeof resolverPolitica>[0]["politicas"] } = {}) {
  const r = resolverPolitica({ modo: "squad", papel: "executor", agente_id: null, mission_id: "mis_1", cli: "claude", pedidas: null, politicas: opcoes.politicas ?? [{ id: "p", workspace_id: "ws_1", alvo_tipo: "papel", alvo_valor: "executor", skills: ["a1", "a2", "a3"], mcp_do_usuario: "nenhum", servidores_mcp: [], atualizado_em: "t" }], skillsDoCatalogo: CATALOGO, metodoInstalado: false });
  const snapshot: SnapshotPane = { cli: "claude", nivel: "duro", skills: r.skills, mcp_do_usuario: r.mcp_do_usuario, servidores_mcp: r.servidores_mcp };
  const emissor = criarEmissorDeTokens();
  const eventos: Array<[string, unknown]> = [];
  const mundo = criarMundo();
  const ganchos = criarGanchosClaude({
    handoff: {} as never, fila: {} as never, contexto: async () => null, raiz: async () => "/r",
    gatePolitica: (_p, tipo, nome) => decidirGate({ tipo, nome, snapshot }),
    emitir: (t, p) => eventos.push([t, p]),
  });
  const servidor = await iniciarServidorMcp({ deps: mundo.deps, emissor, ganchos });
  abertos.push(servidor);
  const token = servidor.emitirToken({ workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_w1", role: "executor", mode: "squad" });
  const dirApp = mkdtempSync(join(tmpdir(), "contrato-iso-"));
  const iso = montarIsolamentoClaude({ politica: r, skillsConhecidas: CATALOGO.map((c) => c.nome), servidoresUsuario: ["github"], dirApp, pane_id: "pane_w1", temPluginEfemero: true });
  const s = gerarSettingsDoPane({ dirApp, pane_id: "pane_w1", papel: "executor", nomeServidor: PRODUTO.id, executavelNode: process.execPath, script: GANCHO, variavelUrl: URL_VAR, variavelToken: TOKEN_VAR, isolamento: iso });
  mkdirSync(join(s.caminho, ".."), { recursive: true });
  writeFileSync(s.caminho, s.conteudo);
  const env = { ...process.env, [URL_VAR]: servidor.urlGanchos, [TOKEN_VAR]: token };
  // ASSÍNCRONO de propósito: o servidor MCP roda neste mesmo processo e `spawnSync` o travaria
  const rodar = (ferramenta: string, entrada: unknown, extra: string[] = [], ambiente: NodeJS.ProcessEnv = env): Promise<{ blocked: boolean; by: string | null; reason: string | null }> =>
    new Promise((ok, erro) => {
      const f = spawn(process.execPath, [CLI, "--settings", s.caminho, "--tool", ferramenta, "--input", JSON.stringify(entrada), ...extra], { env: ambiente });
      let saida = "";
      f.stdout.on("data", (b: Buffer) => { saida += b.toString("utf8"); });
      const t = setTimeout(() => { f.kill("SIGKILL"); erro(new Error("CLI falsa travou")); }, 30_000);
      f.on("close", () => { clearTimeout(t); try { ok(JSON.parse(saida.trim()) as never); } catch (e) { erro(e); } });
    });
  return { rodar, servidor, eventos, iso, s, env };
}

describe("contrato: premissas do Claude Code que o isolamento usa", () => {
  it("nomes das flags e do settings (se a CLI mudar, ESTE teste fica vermelho e diz qual premissa quebrou)", async () => {
    const { iso, s } = await montar();
    expect(iso.argumentos, "PREMISSA: `--strict-mcp-config` isola os MCP de usuário").toContain("--strict-mcp-config");
    expect(iso.argumentos, "PREMISSA: `--plugin-dir <pasta>` carrega o plugin efêmero").toContain("--plugin-dir");
    const j = JSON.parse(s.conteudo) as { permissions: { deny: string[] }; hooks: { PreToolUse: Array<{ matcher: string }> } };
    expect(j.permissions.deny, "PREMISSA: `permissions.deny` aceita a regra `Skill(<nome>)`").toContain("Skill(a4)");
    expect(j.hooks.PreToolUse.map((x) => x.matcher), "PREMISSA: hook PreToolUse com matcher `Skill` e `mcp__.*`").toEqual(["Skill", "mcp__.*"]);
    expect(NIVEL_POR_CLI.claude).toBe("duro");
    expect(NIVEL_POR_CLI.codex).toBe("parcial");
  });
});

describe("ciclo settings -> hook -> gate (CLI falsa)", () => {
  it("3 skills permitidas passam; a 4ª é bloqueada (pelo deny E, sem o deny, pelo gate); vale em modo automático", async () => {
    const m = await montar();
    // a CLI falsa usa o settings completo: a 4ª cai no `permissions.deny`
    expect(await m.rodar("Skill", { skill: "a4" }, ["--dangerously-skip-permissions"])).toMatchObject({ blocked: true, by: "deny" });
    for (const s of ["a1", "a2", "a3"]) expect((await m.rodar("Skill", { skill: s }, ["--dangerously-skip-permissions"])).blocked).toBe(false);
    // sem o deny (o teto de 500 regras deixa excedente só no gate): o hook bloqueia
    const sem = JSON.parse(m.s.conteudo) as Record<string, unknown>;
    delete sem["permissions"];
    writeFileSync(m.s.caminho, JSON.stringify(sem));
    const r = await m.rodar("Skill", { skill: "a4" }, ["--dangerously-skip-permissions"]);
    expect(r).toMatchObject({ blocked: true, by: "hook" });
    expect(r.reason).toContain("skill_not_allowed: a4");
    expect(m.eventos).toContainEqual(["skill.blocked", { pane_id: "pane_w1", skill: "a4" }]);
  });
  it("MCP de usuário negado pelo hook; o servidor do app passa", async () => {
    const m = await montar();
    expect(await m.rodar("mcp__github__create_issue", {})).toMatchObject({ blocked: true });
    expect((await m.rodar(`mcp__${PRODUTO.id}__pane_list`, {})).blocked).toBe(false);
  });
  it("FALHA FECHADA: app fora do ar = bloqueia (skill e MCP); token errado = bloqueia", async () => {
    const m = await montar();
    await m.servidor.fechar();
    abertos.pop();
    const sem = JSON.parse(m.s.conteudo) as Record<string, unknown>;
    delete sem["permissions"];
    writeFileSync(m.s.caminho, JSON.stringify(sem));
    expect(await m.rodar("Skill", { skill: "a1" })).toMatchObject({ blocked: true, by: "hook" });
    expect(await m.rodar("mcp__github__x", {})).toMatchObject({ blocked: true, by: "hook" });
  });
  it("token errado: bloqueia", async () => {
    const m = await montar();
    const sem = JSON.parse(m.s.conteudo) as Record<string, unknown>;
    delete sem["permissions"];
    writeFileSync(m.s.caminho, JSON.stringify(sem));
    expect(await m.rodar("Skill", { skill: "a1" }, [], { ...m.env, [TOKEN_VAR]: "invalido" })).toMatchObject({ blocked: true, by: "hook" });
  });
  it("gancho sem variáveis de ambiente: bloqueia", async () => {
    const m = await montar();
    const env = { ...process.env };
    delete env[URL_VAR];
    delete env[TOKEN_VAR];
    const sem = JSON.parse(m.s.conteudo) as Record<string, unknown>;
    delete sem["permissions"];
    writeFileSync(m.s.caminho, JSON.stringify(sem));
    expect(await m.rodar("Skill", { skill: "a1" }, [], env)).toMatchObject({ blocked: true, by: "hook" });
  });
  it("latência do hook (ida e volta pelo gancho.mjs): p95 < 800 ms com 2 processos novos por chamada (o gate puro é medido em ≤ 80 ms no teste unitário)", async () => {
    const m = await montar();
    const sem = JSON.parse(m.s.conteudo) as Record<string, unknown>;
    delete sem["permissions"];
    writeFileSync(m.s.caminho, JSON.stringify(sem));
    const medidas: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = performance.now();
      await m.rodar("Skill", { skill: "a1" });
      medidas.push(performance.now() - t);
    }
    medidas.sort((a, b) => a - b);
    const p95 = medidas[Math.floor(medidas.length * 0.95) - 1] ?? 0;
    expect(p95, "o custo é dominado pelo `node` novo (2 spawns: CLI falsa + gancho); aqui só confere que não explode").toBeLessThan(800);
  });
});
