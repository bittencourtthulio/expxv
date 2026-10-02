import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calcularManifesto, textoDoManifesto } from "../../../../scripts/gerar-manifesto-skills.mjs";
import { abrirBanco, type Banco } from "../../banco/banco";
import { migrar } from "../../banco/migrar";
import { criarRepoCatalogo } from "../../banco/repos/catalogo";
import { lerFrontmatterSkill } from "../frontmatter";
import { definirOptOut, estadoEmbarcadas, hashesDasEmbarcadas, instalarEmbarcadas, lerManifesto, materializarEmbarcadasDoPane, resumoParaInstrucoes, type ContextoEmbarcadas, type Manifesto } from "./manifesto";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const SKILLS = join(RAIZ, "resources", "skills");
let dir: string;
let home: string;
let banco: Banco;
let manifesto: Manifesto;
let ctx: ContextoEmbarcadas;
let dirSkills: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cat-emb-"));
  home = join(dir, "home");
  mkdirSync(home);
  dirSkills = join(dir, "skills");
  cpSync(SKILLS, dirSkills, { recursive: true });
  banco = abrirBanco(":memory:");
  migrar(banco);
  manifesto = await lerManifesto(dirSkills);
  ctx = { repo: criarRepoCatalogo(banco), home, dirSkills, manifesto };
});
afterEach(() => {
  banco.fechar();
  rmSync(dir, { recursive: true, force: true });
});

describe("pacote das skills embarcadas", () => {
  it("o manifesto versionado confere com o disco (falha se uma skill mudou sem regerar)", () => {
    expect(readFileSync(join(SKILLS, "manifesto.json"), "utf8")).toBe(textoDoManifesto(RAIZ));
  });
  it("são 7 skills ev-*, frontmatter válido, corpo em PT-BR, sem segredo nem caminho absoluto nem nome de produto", () => {
    const m = calcularManifesto(RAIZ);
    expect(m.skills.map((s) => s.name)).toEqual(["ev-builder", "ev-evidence-before-done", "ev-guide", "ev-mcp", "ev-pilot", "ev-reviewer", "ev-scout"]);
    for (const s of m.skills) {
      const t = readFileSync(join(SKILLS, s.path), "utf8");
      const fm = lerFrontmatterSkill(t);
      expect(fm.name).toBe(s.name);
      expect((fm.description ?? "").length).toBeGreaterThan(20);
      expect((fm.description ?? "").length).toBeLessThanOrEqual(200);
      expect(t).not.toMatch(/\/Users\/|\/home\/|sk-[A-Za-z0-9]{10}|expxv|ExpxV/i);
      expect(t).not.toMatch(/ev-(guide|mcp|pilot|builder|scout|reviewer)[^ ]*\s+de terceiros/);
    }
  });
});

describe("materializar por Pane (D-43)", () => {
  it("copia só as permitidas e íntegras para o plugin efêmero do Pane", async () => {
    const r = await materializarEmbarcadasDoPane({ dirApp: dir, paneId: "pane_X1", nomes: ["ev-builder", "ev-scout", "nao-existe"], dirSkills, manifesto });
    expect(r.nomes.sort()).toEqual(["ev-builder", "ev-scout"]);
    expect(readdirSync(join(r.dir, "skills")).sort()).toEqual(["ev-builder", "ev-scout"]);
    expect(JSON.parse(readFileSync(join(r.dir, ".claude-plugin", "plugin.json"), "utf8")).name).toBe("ev-embarcadas");
    expect(r.dir).toBe(join(dir, "panes", "pane_X1", "plugin"));
    expect(readdirSync(home)).toEqual([]);
  });
  it("skill adulterada no pacote (hash diferente) não é entregue; pane_id com caminho é recusado", async () => {
    writeFileSync(join(dirSkills, "ev-builder", "SKILL.md"), "adulterada");
    const r = await materializarEmbarcadasDoPane({ dirApp: dir, paneId: "pane_X2", nomes: ["ev-builder", "ev-scout"], dirSkills, manifesto });
    expect(r.nomes).toEqual(["ev-scout"]);
    await expect(materializarEmbarcadasDoPane({ dirApp: dir, paneId: "../x", nomes: [], dirSkills, manifesto })).rejects.toThrow();
  });
  it("sem nenhuma permitida não cria o plugin; resumo para CLIs sem plugin só tem nome e descrição", async () => {
    const r = await materializarEmbarcadasDoPane({ dirApp: dir, paneId: "pane_X3", nomes: [], dirSkills, manifesto });
    expect(r.nomes).toEqual([]);
    expect(existsSync(join(r.dir, ".claude-plugin"))).toBe(false);
    const t = resumoParaInstrucoes(manifesto, ["ev-scout"]);
    expect(t).toContain("ev-scout");
    expect(t).not.toContain("Explorador\n");
  });
  it("hashes alimentam a origem embarcada", () => {
    expect(hashesDasEmbarcadas(manifesto).map(([n]) => n)).toContain("evguide");
  });
});

describe("instalação global opt-in", () => {
  it("sem ação do usuário nenhum arquivo é criado na casa (snapshot)", async () => {
    await estadoEmbarcadas(ctx);
    expect(readdirSync(home)).toEqual([]);
  });
  it("instala por cópia (nunca symlink), registra e estado reflete", async () => {
    const r = await instalarEmbarcadas(ctx, null, "codex");
    expect(r.instaladas).toHaveLength(7);
    const e = await estadoEmbarcadas(ctx);
    expect(e.every((x) => x.clis.find((c) => c.cli === "codex")?.instalada === true)).toBe(true);
    expect(e[0]?.clis.find((c) => c.cli === "claude")?.instalada).toBe(false);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });
  it("matriz versão × edição × opt-out: editada é preservada; intacta com versão nova atualiza; opt-out nunca reinstala", async () => {
    await instalarEmbarcadas(ctx, null, "claude");
    writeFileSync(join(home, ".claude", "skills", "ev-scout", "SKILL.md"), "minha edição");
    const r2 = await instalarEmbarcadas(ctx, null, "claude");
    expect(r2.preservadas_editadas).toEqual(["ev-scout"]);
    expect(readFileSync(join(home, ".claude", "skills", "ev-scout", "SKILL.md"), "utf8")).toBe("minha edição");
    expect((await estadoEmbarcadas(ctx)).find((x) => x.nome === "ev-scout")?.clis.find((c) => c.cli === "claude")?.editada).toBe(true);

    // pacote novo: versão 2 com conteúdo diferente em ev-guide (intacta no usuário)
    const novo = join(dir, "skills2");
    cpSync(dirSkills, novo, { recursive: true });
    writeFileSync(join(novo, "ev-guide", "SKILL.md"), readFileSync(join(novo, "ev-guide", "SKILL.md"), "utf8") + "\nnovo\n");
    const guide = manifesto.skills.find((s) => s.name === "ev-guide")!;
    const { createHash } = await import("node:crypto");
    const h = createHash("sha256").update(readFileSync(join(novo, "ev-guide", "SKILL.md"))).digest("hex");
    const manifesto2: Manifesto = { ...manifesto, skills: manifesto.skills.map((s) => (s.name === "ev-guide" ? { ...guide, version: 2, sha256: h } : s)) };
    const r3 = await instalarEmbarcadas({ ...ctx, dirSkills: novo, manifesto: manifesto2 }, null, "claude");
    expect(r3.instaladas).toEqual(["ev-guide"]);
    expect(readFileSync(join(home, ".claude", "skills", "ev-guide", "SKILL.md"), "utf8")).toContain("novo");

    // opt-out persistente: remover e pedir "todas" não reinstala
    rmSync(join(home, ".claude", "skills", "ev-mcp"), { recursive: true });
    definirOptOut(ctx, "ev-mcp", "claude", true);
    const r4 = await instalarEmbarcadas(ctx, null, "claude");
    expect(r4.instaladas).not.toContain("ev-mcp");
    expect(existsSync(join(home, ".claude", "skills", "ev-mcp"))).toBe(false);
    expect(criarRepoCatalogo(banco).obterEmbarcada("ev-mcp", "claude")?.opt_out).toBe(true);
  });
  it("gemini não tem pasta de skills; pasta de outra coisa no destino é preservada", async () => {
    expect((await instalarEmbarcadas(ctx, null, "gemini")).instaladas).toEqual([]);
    mkdirSync(join(home, ".claude", "skills", "ev-guide"), { recursive: true });
    const r = await instalarEmbarcadas(ctx, "ev-guide", "claude");
    expect(r.preservadas_editadas).toEqual(["ev-guide"]);
  });
});
