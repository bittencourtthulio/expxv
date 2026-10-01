import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { carregarRevogados, carregarSegredoPersistente, criarEmissorDeTokens, criarGravadorRevogados, TTL_PADRAO_MS } from "./tokens";

const base = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_1", role: "piloto" as const, mode: "agentico" as const };

describe("tokens de Pane", () => {
  it("emite e verifica com as claims do contrato", () => {
    const e = criarEmissorDeTokens();
    const c = e.verificar(e.emitir(base));
    expect(c).toMatchObject({ workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_1", role: "piloto", mode: "agentico" });
    expect(c?.tools_allow).toContain("pane_spawn");
  });

  it("adulterado, truncado, de outro processo ou lixo → null", () => {
    const e = criarEmissorDeTokens();
    const outro = criarEmissorDeTokens();
    const t = e.emitir(base);
    const [corpo, assinatura] = t.split(".") as [string, string];
    const adulterado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, "base64url").toString()), role: "executor", pane_id: "pane_2" })).toString("base64url");
    expect(e.verificar(`${adulterado}.${assinatura}`)).toBeNull();
    expect(e.verificar(t.slice(0, -3))).toBeNull();
    expect(outro.verificar(t)).toBeNull();
    for (const lixo of ["", "a", "a.b", "a.b.c", "x".repeat(5000)]) expect(e.verificar(lixo)).toBeNull();
  });

  it("expira", () => {
    let agora = 1_000_000;
    const e = criarEmissorDeTokens({ relogio: { agora: () => agora }, ttlMs: 60_000 });
    const t = e.emitir(base);
    expect(e.verificar(t)).not.toBeNull();
    agora += 60_001;
    expect(e.verificar(t)).toBeNull();
  });

  it("revogar invalida o anterior mas o token novo do MESMO pane_id vale (respawn)", () => {
    const e = criarEmissorDeTokens();
    const velho = e.emitir(base);
    e.revogar("pane_1");
    const novo = e.emitir(base);
    expect(e.verificar(velho)).toBeNull();
    expect(e.verificar(novo)?.pane_id).toBe("pane_1");
  });

  it("tools_allow só restringe, nunca amplia", () => {
    const e = criarEmissorDeTokens();
    const c = e.verificar(e.emitir({ ...base, role: "executor", tools_allow: ["pane_spawn", "handoff_submit"] }));
    expect(c?.tools_allow).toEqual(["handoff_submit"]);
  });
});

describe("tokens que sobrevivem a reinício", () => {
  const pastas: string[] = [];
  const nova = async (): Promise<string> => { const d = await mkdtemp(join(tmpdir(), "mcp-tok-")); pastas.push(d); return d; };
  afterEach(async () => { while (pastas.length) await rm(pastas.pop()!, { recursive: true, force: true }); });

  it("o segredo nasce sob demanda (32 bytes, 0600), é reaproveitado e arquivo inválido é substituído", async () => {
    const dir = await nova();
    const a = await carregarSegredoPersistente(dir);
    expect(a).toHaveLength(32);
    expect((await stat(join(dir, "mcp-segredo"))).mode & 0o777).toBe(0o600);
    expect((await carregarSegredoPersistente(dir)).equals(a)).toBe(true);
    await writeFile(join(dir, "mcp-segredo"), "curto");
    const b = await carregarSegredoPersistente(dir);
    expect(b).toHaveLength(32);
    expect(b.equals(a)).toBe(false);
  });

  it("um emissor novo com o mesmo segredo aceita o token antigo; com outro segredo, não", async () => {
    const dir = await nova();
    const antes = criarEmissorDeTokens({ segredo: await carregarSegredoPersistente(dir) });
    const token = antes.emitir(base);
    const depois = criarEmissorDeTokens({ segredo: await carregarSegredoPersistente(dir) });
    expect(depois.verificar(token)?.pane_id).toBe("pane_1");
    expect(criarEmissorDeTokens().verificar(token)).toBeNull();
  });

  it("exp padrão de 24 h (AUD-04)", () => {
    const e = criarEmissorDeTokens({ relogio: { agora: () => 1_000_000 } });
    expect(e.verificar(e.emitir(base))?.exp).toBe(Math.floor((1_000_000 + TTL_PADRAO_MS) / 1000));
    expect(TTL_PADRAO_MS).toBe(24 * 3600 * 1000);
  });

  it("a revogação persiste entre reinícios, o token novo do mesmo pane vale e a lista é podada por exp", async () => {
    const dir = await nova();
    let agora = 5_000_000;
    const relogio = { agora: () => agora };
    const segredo = await carregarSegredoPersistente(dir);
    const gravador = criarGravadorRevogados(dir);
    const e1 = criarEmissorDeTokens({ segredo, relogio, ttlMs: 60_000, aoRevogar: (r) => gravador.gravar(r) });
    const velho = e1.emitir(base);
    const outro = e1.emitir({ ...base, pane_id: "pane_2" });
    e1.revogar("pane_1");
    await gravador.aguardar();
    expect((await stat(join(dir, "mcp-revogados.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(dir, "mcp-revogados.json"), "utf8"))).toHaveProperty("pane_1");

    // "reinício": processo novo, contador do zero
    const e2 = criarEmissorDeTokens({ segredo, relogio, ttlMs: 60_000, revogados: await carregarRevogados(dir, relogio) });
    expect(e2.verificar(velho)).toBeNull();
    expect(e2.verificar(outro)?.pane_id).toBe("pane_2");
    const novo = e2.emitir(base);
    expect(e2.verificar(novo)?.pane_id).toBe("pane_1");

    // passou o exp do último token anterior: o registro sai do disco
    agora += 120_000;
    expect(await carregarRevogados(dir, relogio)).toEqual({});
  });

  it("revogados ausentes ou corrompidos viram lista vazia; o segredo nunca vai para o arquivo de revogados", async () => {
    const dir = await nova();
    expect(await carregarRevogados(dir)).toEqual({});
    await writeFile(join(dir, "mcp-revogados.json"), "{lixo");
    expect(await carregarRevogados(dir)).toEqual({});
    const g = criarGravadorRevogados(dir);
    const e = criarEmissorDeTokens({ aoRevogar: (r) => g.gravar(r) });
    e.revogar("pane_9");
    await g.aguardar();
    const segredo = await carregarSegredoPersistente(dir);
    expect((await readFile(join(dir, "mcp-revogados.json"), "utf8")).includes(segredo.toString("base64"))).toBe(false);
  });
});
