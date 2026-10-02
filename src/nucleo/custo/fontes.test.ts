import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mundoIngestao } from "../../../tests/fixtures/custo/mundo-ingestao";
import { CLIS_SEM_LEITOR, fsReal, relativoDentro, type FsFontes } from "./fontes";
import { criarFontes } from "./fontes";

const abertos: Array<{ fechar(): Promise<void> }> = [];
afterEach(async () => {
  for (const m of abertos.splice(0)) await m.fechar();
});
const novo = () => {
  const m = mundoIngestao();
  abertos.push(m);
  return m;
};
const ID = "3ebe51c8-83df-4fb4-b2a0-16dfa7cd5f6f";
const pane = (m: ReturnType<typeof novo>) => ({ id: m.pane.id, cli: "claude", conta_id: m.conta.id, mission_id: m.mis.id, workspace_id: m.ws.id });

describe("relativoDentro (puro)", () => {
  it("aceita só .jsonl absoluto dentro da base", () => {
    expect(relativoDentro("/b", "/b/projects/p/x.jsonl")).toBe("projects/p/x.jsonl");
    expect(relativoDentro("/b", "/b/../x.jsonl")).toBeNull();
    expect(relativoDentro("/b", "/outro/x.jsonl")).toBeNull();
    expect(relativoDentro("/b", "/b/projects/x.json")).toBeNull();
    expect(relativoDentro("/b", "projects/x.jsonl")).toBeNull();
    expect(relativoDentro("/b", "/b")).toBeNull();
  });
});

describe("fontes por Pane (T-10.06)", () => {
  it("Claude: transcript_path dentro da base vira base+relativo (nunca caminho absoluto no banco)", async () => {
    const m = novo();
    const abs = m.escrever(`projects/p/${ID}.jsonl`, "");
    const f = await m.fontes.registrarClaude(pane(m), abs);
    expect(f).toMatchObject({ base: "claude_config", relativo: `projects/p/${ID}.jsonl`, cli: "claude", pane_id: m.pane.id });
    expect(JSON.stringify(m.banco.consultar("SELECT * FROM uso_fonte"))).not.toContain(m.base);
    expect(m.fontes.resolver(f!)).toBe(abs);
  });
  it("caminho fora da base, não-.jsonl e symlink para fora são recusados", async () => {
    const m = novo();
    const fora = mkdtempSync(join(tmpdir(), "fora-"));
    try {
      writeFileSync(join(fora, "x.jsonl"), "");
      expect(await m.fontes.registrarClaude(pane(m), join(fora, "x.jsonl"))).toBeNull();
      m.escrever("projects/p/a.txt", "");
      expect(await m.fontes.registrarClaude(pane(m), join(m.base, "claude/projects/p/a.txt"))).toBeNull();
      mkdirSync(join(m.base, "claude/projects/q"), { recursive: true });
      symlinkSync(join(fora, "x.jsonl"), join(m.base, "claude/projects/q/link.jsonl"));
      expect(await m.fontes.registrarClaude(pane(m), join(m.base, "claude/projects/q/link.jsonl"))).toBeNull();
      expect(m.banco.consultar("SELECT id FROM uso_fonte")).toHaveLength(0);
    } finally {
      rmSync(fora, { recursive: true, force: true });
    }
  });
  it("/clear (nova conversa) cria a 2ª fonte do mesmo Pane; a mesma conversa não duplica", async () => {
    const m = novo();
    const a = await m.fontes.registrarClaude(pane(m), m.escrever(`projects/p/${ID}.jsonl`, ""));
    const b = await m.fontes.registrarClaude(pane(m), m.escrever("projects/p/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", ""));
    const a2 = await m.fontes.registrarClaude(pane(m), join(m.base, `claude/projects/p/${ID}.jsonl`));
    expect(a!.id).not.toBe(b!.id);
    expect(a2!.id).toBe(a!.id);
    expect(m.s.repo.fontes.porPane(m.pane.id)).toHaveLength(2);
  });
  it("subagentes: lista só <sessão>/subagents e registra agent-*.jsonl no mesmo Pane", async () => {
    const m = novo();
    const abs = m.escrever(`projects/p/${ID}.jsonl`, "");
    m.escrever(`projects/p/${ID}/subagents/agent-a1.jsonl`, "");
    m.escrever(`projects/p/${ID}/subagents/agent-a1.meta.json`, "{}");
    m.escrever(`projects/p/${ID}/subagents/outro.jsonl`, "");
    const subs = await m.fontes.descobrirSubagentes(pane(m), abs);
    expect(subs.map((s) => s.relativo)).toEqual([`projects/p/${ID}/subagents/agent-a1.jsonl`]);
    expect(subs[0]?.pane_id).toBe(m.pane.id);
  });
  it("Claude sem hook: acha <id>.jsonl nas pastas de projects/ (id inválido recusado)", async () => {
    const m = novo();
    m.escrever(`projects/outro/${ID}.jsonl`, "");
    expect((await m.fontes.localizarClaudePorConversa(pane(m), ID))?.relativo).toBe(`projects/outro/${ID}.jsonl`);
    expect(await m.fontes.localizarClaudePorConversa(pane(m), "../etc/passwd")).toBeNull();
    expect(await m.fontes.localizarClaudePorConversa(pane(m), "nao-existe-0000")).toBeNull();
  });
  it("Codex: acha o rollout pelo id em sessions/AAAA/MM/DD do CODEX_HOME", async () => {
    const m = novo();
    m.escrever(`sessions/2026/09/27/rollout-2026-09-27T18-43-01-${ID}.jsonl`, "", "codex");
    m.escrever("sessions/2026/09/26/rollout-2026-09-26T10-00-00-outro-id-0001.jsonl", "", "codex");
    const f = await m.fontes.localizarCodex({ ...pane(m), id: m.codexPane.id, cli: "codex" }, ID);
    expect(f).toMatchObject({ base: "codex_home", cli: "codex", relativo: `sessions/2026/09/27/rollout-2026-09-27T18-43-01-${ID}.jsonl` });
    expect(await m.fontes.localizarCodex({ ...pane(m), cli: "codex" }, "sem-rollout-9999")).toBeNull();
  });
  it("nunca varre o home: toda chamada ao fs fica dentro da base (teste espia o fs)", async () => {
    const m = novo();
    m.escrever(`projects/p/${ID}.jsonl`, "");
    m.escrever(`sessions/2026/09/27/rollout-x-${ID}.jsonl`, "", "codex");
    const vistos: string[] = [];
    const espia: FsFontes = {
      realpath: (p) => (vistos.push(p), fsReal.realpath(p)),
      eArquivo: (p) => (vistos.push(p), fsReal.eArquivo(p)),
      listar: (p) => (vistos.push(p), fsReal.listar(p)),
    };
    const f = criarFontes({ servico: m.s, bases: { absoluto: (b) => join(m.base, b === "claude_config" ? "claude" : "codex") }, fs: espia });
    await f.localizarClaudePorConversa(pane(m), ID);
    await f.localizarCodex({ ...pane(m), cli: "codex" }, ID);
    await f.descobrirSubagentes(pane(m), join(m.base, `claude/projects/p/${ID}.jsonl`));
    expect(vistos.length).toBeGreaterThan(0);
    for (const v of vistos) expect(v.startsWith(m.base)).toBe(true);
    expect(dirname(m.base)).not.toBe(m.base);
  });
  it("CLI sem leitor (gemini, opencode, aider, qwen, kilo, grok) ⇒ sem_fonte visível e UM aviso por Pane; claude/codex não", () => {
    const m = novo();
    expect([...CLIS_SEM_LEITOR].sort()).toEqual(["aider", "gemini", "grok", "kilo", "opencode", "qwen"]);
    const f = m.fontes.registrarSemLeitor({ ...pane(m), cli: "gemini" });
    expect(f).toMatchObject({ estado: "sem_fonte", base: "nenhuma", cli: "gemini" });
    expect(m.s.fontesEstado().find((x) => x.cli === "gemini")?.estado).toBe("sem_fonte");
    expect(m.fontes.registrarSemLeitor({ ...pane(m), cli: "claude" })).toBeNull();
    expect(m.fontes.registrarSemLeitor({ ...pane(m), cli: null })).toBeNull();
    const resumo = m.s.resumo("pane", m.pane.id);
    expect(resumo.usd).toBeNull();
    expect(resumo.incompleto).toBe(true);
  });
});
