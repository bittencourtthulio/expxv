import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verificarSquads } from "../../scripts/verificar-squads.mjs";
import { PRODUTO } from "../../src/nucleo/produto";

const RAIZ = join(__dirname, "..", "..");
const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Raiz temporária: `src` e `node_modules` por symlink (só leitura), `resources/` copiada para poder adulterar. */
function raizAdulteravel(): string {
  const r = mkdtempSync(join(tmpdir(), "verif-squads-"));
  tmps.push(r);
  symlinkSync(join(RAIZ, "src"), join(r, "src"));
  symlinkSync(join(RAIZ, "node_modules"), join(r, "node_modules"));
  cpSync(join(RAIZ, "resources"), join(r, "resources"), { recursive: true });
  return r;
}
const res = (r: string, ...p: string[]): string => join(r, "resources", "squads", ...p);
const lerJson = (c: string): Record<string, any> => JSON.parse(readFileSync(c, "utf8"));

describe("squads de fábrica (T-14.08)", () => {
  it("as squads reais do repositório passam no validador: 17 squads (13 do plano + 4 extras), 81 prompts", async () => {
    const r = await verificarSquads({ raiz: RAIZ });
    expect(r.erros).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.resumo).toMatchObject({ squads: 17, membros: 81 });
    const ids = readdirSync(join(RAIZ, "resources", "squads")).filter((n) => !n.includes("."));
    for (const extra of ["api-contratos", "acessibilidade-ux", "dados-migracoes", "observabilidade"]) expect(ids).toContain(extra);
  }, 60_000);

  it("scripts/verificar-squads.mjs roda como CLI e sai com 0", () => {
    const p = spawnSync(process.execPath, [join(RAIZ, "scripts", "verificar-squads.mjs")], { encoding: "utf8" });
    expect(p.status, p.stderr).toBe(0);
    expect(p.stdout).toContain("squads de fábrica OK");
  }, 60_000);

  it("manifesto confere os hashes e lista exatamente as squads; modelos só opus|sonnet|haiku; MCPs vêm do seed confirmado", () => {
    const manifesto = lerJson(join(RAIZ, "resources", "squads", "manifesto.json"));
    const seed = lerJson(join(RAIZ, "resources", "mcp", "catalogo-mcps.json"));
    const confirmados = new Set((seed["entradas"] as Array<{ id: string; confirmado: boolean }>).filter((e) => e.confirmado).map((e) => e.id));
    expect(manifesto["squads"]).toHaveLength(17);
    for (const s of manifesto["squads"] as Array<{ id: string; arquivos: Record<string, string> }>) {
      const sq = lerJson(join(RAIZ, "resources", "squads", s.id, "squad.json"));
      expect(Object.keys(s.arquivos)).toHaveLength(sq["membros"].length + 1);
      for (const m of sq["membros"]) {
        expect(["opus", "sonnet", "haiku", "default", null]).toContain(m.perfil.modelo);
        for (const mcp of m.mcps_permitidos) expect(confirmados.has(mcp), `${s.id}/${m.slug}: ${mcp}`).toBe(true);
        expect(m.skills_permitidas.length).toBeGreaterThan(0);
      }
    }
  });

  it("MCPs padrão: docs (context7) nas de código, playwright na de QA e de frontend, git/filesystem restritos", () => {
    const mcpsDe = (id: string): string[] => lerJson(join(RAIZ, "resources", "squads", id, "squad.json"))["membros"].flatMap((m: any) => m.mcps_permitidos);
    for (const id of ["feature-fullstack", "correcao-de-bug", "api-contratos", "dados-migracoes", "refatoracao-legado"]) expect(mcpsDe(id), id).toContain("context7");
    expect(mcpsDe("testes-qa")).toContain("playwright-mcp");
    expect(mcpsDe("feature-fullstack")).toContain("playwright-mcp");
    expect(mcpsDe("acessibilidade-ux")).toContain("playwright-mcp");
    const comGit = readdirSync(join(RAIZ, "resources", "squads")).filter((n) => !n.includes(".") && n !== "arquetipos" && mcpsDe(n).includes("git"));
    expect(comGit.length).toBeLessThanOrEqual(3);
    expect(mcpsDe("auditoria-seguranca")).toEqual([]);
  });

  it("os 5 níveis de rigor do plano estão em rigor.json", () => {
    const rigor = lerJson(join(RAIZ, "resources", "squads", "rigor.json"));
    expect(rigor["niveis"].map((n: any) => n.nivel)).toEqual([1, 2, 3, 4, 5]);
    expect(rigor["niveis"][2].texto).toContain("dois testes por card");
  });

  it("falha quando uma squad perde o orquestrador, e --gerar restaura (hashes idênticos a cada geração)", async () => {
    const r = raizAdulteravel();
    const antes = readFileSync(res(r, "manifesto.json"), "utf8");
    const arq = res(r, "dupla-rapida", "squad.json");
    const sq = lerJson(arq);
    sq["membros"] = sq["membros"].filter((m: any) => m.papel !== "orchestrator");
    writeFileSync(arq, JSON.stringify(sq));
    const ruim = await verificarSquads({ raiz: r });
    expect(ruim.ok).toBe(false);
    expect(ruim.erros.join("\n")).toMatch(/sem_orquestrador|poucos_membros/);
    const regenerado = await verificarSquads({ raiz: r, gerar: true });
    expect(regenerado.erros).toEqual([]);
    expect(readFileSync(res(r, "manifesto.json"), "utf8")).toBe(antes);
    await verificarSquads({ raiz: r, gerar: true });
    expect(readFileSync(res(r, "manifesto.json"), "utf8")).toBe(antes);
  }, 60_000);

  it("esforco-por-cli.json: --gerar nunca o apaga nem sobrescreve (é dado do usuário), recria se faltar; verificação exige arquivo válido", async () => {
    const r = raizAdulteravel();
    const arq = res(r, "esforco-por-cli.json");
    const editado = { ...lerJson(arq), versao: 7 };
    writeFileSync(arq, `${JSON.stringify(editado, null, 2)}\n`);
    expect((await verificarSquads({ raiz: r, gerar: true })).erros).toEqual([]);
    expect(lerJson(arq)["versao"]).toBe(7); // preservado
    expect(existsSync(res(r, "arquetipos", "revisor.md"))).toBe(true);
    rmSync(arq);
    expect((await verificarSquads({ raiz: r })).erros.join("\n")).toContain("esforco-por-cli.json");
    expect((await verificarSquads({ raiz: r, gerar: true })).ok).toBe(true);
    expect(lerJson(arq)["versao"]).toBe(1); // recriado do padrão
    writeFileSync(arq, JSON.stringify({ versao: 1, clis: { claude: { tipo: "flag", confirmado: true, fonte: "x", flag: "--x; rm", mapa: {} } } }));
    expect((await verificarSquads({ raiz: r })).ok).toBe(false);
  }, 60_000);

  it("falha com variável desconhecida, segredo, caminho absoluto, nome do produto e prompt adulterado", async () => {
    const r = raizAdulteravel();
    const md = res(r, "dupla-rapida", "membros", "implementador.md");
    const original = readFileSync(md, "utf8");
    const casos: Array<[string, string]> = [
      ["variável desconhecida", `${original}\n{{foo}}`],
      ["segredo", `${original}\nAPI_KEY=abcdef123456`],
      ["caminho absoluto", `${original}\nveja /Users/fulano/x`],
      ["nome do produto", `${original}\nusa o ${PRODUTO.nome}`],
      ["adulterado sem regenerar", `${original}\nlinha a mais`],
    ];
    for (const [nome, conteudo] of casos) {
      writeFileSync(md, conteudo);
      const v = await verificarSquads({ raiz: r });
      expect(v.ok, nome).toBe(false);
    }
    writeFileSync(md, original);
    expect((await verificarSquads({ raiz: r })).ok).toBe(true);
  }, 60_000);

  it("falha quando o manifesto some ou uma squad do plano é removida", async () => {
    const r = raizAdulteravel();
    rmSync(res(r, "manifesto.json"));
    expect((await verificarSquads({ raiz: r })).erros.join()).toContain("manifesto");
    rmSync(res(r, "testes-qa"), { recursive: true });
    expect((await verificarSquads({ raiz: r })).erros.join()).toContain("testes-qa");
  }, 60_000);
});
