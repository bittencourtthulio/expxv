import { describe, expect, it } from "vitest";
import { SKILLS_DA_SUITE, nodeAtende } from "./modelo";
import {
  ambienteDoInstalador, ambienteNpm, argumentosDownload, argumentosInit, comandoExibido, extrasSeguros, montarPlano, skillsParaInstalar, verificarRequisitosLocais, type SondasRequisitos,
} from "./plano";

const sondas = (o: Partial<{ node: string | null; npm: string | null; gravavel: boolean; git: { alteracoes: number } | null; versaoGit: string | null }> = {}): SondasRequisitos => ({
  versaoNode: async () => (o.node === undefined ? "v22.1.0" : o.node), versaoNpm: async () => (o.npm === undefined ? "10.5.0" : o.npm),
  gravavel: async () => o.gravavel ?? true, statusGit: async () => (o.git === undefined ? { alteracoes: 0 } : o.git),
  versaoGit: async () => (o.versaoGit === undefined ? "git version 2.45.1" : o.versaoGit),
});
const plano = (r: Awaited<ReturnType<typeof verificarRequisitosLocais>>) => montarPlano({ workspace_id: "w", raiz: "/p", modo: "instalar", versao: "0.9.0", requisitos: r, existentes: [] });

describe("requisitos do primeiro passo", () => {
  it("tudo certo: node, npm, pasta e git ok; internet pendente (sem rede antes do clique)", async () => {
    const r = await verificarRequisitosLocais("/p", sondas());
    expect(r.map((x) => [x.id, x.situacao])).toEqual([["node", "ok"], ["npm", "ok"], ["internet", "pendente"], ["pasta", "ok"], ["git", "ok"]]);
    expect(r.find((x) => x.id === "internet")!.detalhe).toMatch(/não acessa a rede antes/);
    expect(plano(r).pode_instalar).toBe(true);
  });
  it.each([
    ["node ausente", { node: null }, "node", /Instale o Node/],
    ["node antigo (18)", { node: "v18.19.0" }, "node", /Atualize o Node/],
    ["node 20.18 (abaixo do engines 20.19)", { node: "v20.18.3" }, "node", /Atualize o Node/],
    ["npm ausente", { npm: null }, "npm", /reinstale o Node/],
    ["pasta sem escrita", { gravavel: false }, "pasta", /permissões/],
    ["git ausente (o init usa git clone)", { versaoGit: null }, "git", /Instale o Git/],
  ] as const)("%s bloqueia e sugere a correção", async (_n, o, id, correcao) => {
    const r = await verificarRequisitosLocais("/p", sondas(o));
    const x = r.find((q) => q.id === id)!;
    expect(x.situacao).toBe("falha");
    expect(x.correcao).toMatch(correcao);
    expect(plano(r).pode_instalar).toBe(false);
  });
  it("árvore do git suja ou pasta sem git é só informação no detalhe e nunca bloqueia", async () => {
    for (const git of [{ alteracoes: 4 }, null]) {
      const r = await verificarRequisitosLocais("/p", sondas({ git }));
      expect(r.find((x) => x.id === "git")).toMatchObject({ situacao: "ok", bloqueante: true });
      expect(plano(r).pode_instalar).toBe(true);
    }
    expect((await verificarRequisitosLocais("/p", sondas({ git: { alteracoes: 4 } }))).find((x) => x.id === "git")!.detalhe).toMatch(/4 alteração/);
  });
  it("Node: o engines do pacote é >= 20.19.0", () => {
    for (const ok of ["v20.19.0", "v22.1.0", "v21.0.0", "20.19.1"]) expect(nodeAtende(ok), ok).toBe(true);
    for (const ruim of ["v18.20.0", "v20.18.9", "v16.0.0", "x"]) expect(nodeAtende(ruim), ruim).toBe(false);
  });
});

describe("plano do passo 1", () => {
  it("lista as nove skills com o papel de cada uma (informação, sem seleção), os efeitos fora do projeto e a rede", async () => {
    const p = plano(await verificarRequisitosLocais("/p", sondas()));
    expect(p.skills.map((s) => s.nome)).toEqual([...SKILLS_DA_SUITE]);
    expect(p.skills.every((s) => s.papel.length > 5)).toBe(true);
    expect(p.efeitos_fora.join(" ")).toMatch(/claude plugin marketplace add/);
    expect(p.efeitos_fora.join(" ")).toMatch(/troca a pasta \.expx inteira/);
    expect(p.rede).toMatch(/git/);
  });
});

describe("comandos", () => {
  it("download usa versão fixada, registro explícito e --ignore-scripts; nunca npx nem latest", () => {
    const a = argumentosDownload("0.9.0", "/tmp/x");
    expect(a).toEqual(expect.arrayContaining(["--ignore-scripts", "--registry", "https://registry.npmjs.org/", "expxdev@0.9.0", "--prefix", "/tmp/x"]));
    expect(a.join(" ")).not.toMatch(/latest|npx/);
  });
  it("o init SEMPRE leva --yes e --skills (e --harness); sem skills o app nem monta o comando", () => {
    const a = argumentosInit("/b.js", "instalar", { skills: ["sprintx", "runx"] });
    expect(a).toEqual(["/b.js", "init", "--yes", "--skills", "sprintx,runx", "--harness", "claude,opencode"]);
    expect(argumentosInit("/b.js", "reparar", { skills: SKILLS_DA_SUITE })).toContain("--yes");
    for (const modo of ["instalar", "reparar"] as const) {
      const x = argumentosInit("/b.js", modo, { skills: SKILLS_DA_SUITE });
      expect(x.slice(0, 3)).toEqual(["/b.js", "init", "--yes"]);
      expect(x[x.indexOf("--skills") + 1]).toBe(SKILLS_DA_SUITE.join(","));
    }
    expect(() => argumentosInit("/b.js", "instalar", { skills: [] })).toThrow(/--skills/);
    expect(argumentosInit("/b.js", "instalar", { skills: ["runx"], harness: ["claude"] }).slice(-2)).toEqual(["--harness", "claude"]);
    expect(argumentosInit("/b.js", "instalar", { skills: ["runx"], harness: ["x"] }).slice(-1)).toEqual(["claude,opencode"]);
  });
  it("atualizar usa `update --yes` sem nomear skills", () => {
    expect(argumentosInit("/b.js", "atualizar", { skills: SKILLS_DA_SUITE })).toEqual(["/b.js", "update", "--yes"]);
  });
  it("extras do usuário nunca repetem as flags que o app controla", () => {
    expect(extrasSeguros(["--yes", "--skills=x", "--check", "--harness", "--outra"])).toEqual(["--outra"]);
    expect(argumentosInit("/b.js", "instalar", { skills: ["runx"], extras: ["--yes", "--outra"] }).filter((x) => x === "--yes")).toHaveLength(1);
  });
  it("o comando exibido mostra o que será rodado, com --yes e --skills", () => {
    const t = comandoExibido({ versao: "0.9.0", modo: "instalar", skills: SKILLS_DA_SUITE }).join("\n");
    expect(t).toContain("expxdev@0.9.0");
    expect(t).toContain("init --yes --skills sprintx,runx,legadox");
    expect(t).toContain("--harness claude,opencode");
  });
  it("interseção da lista conhecida com o catálogo da versão (ordem do catálogo conhecido)", () => {
    expect(skillsParaInstalar(SKILLS_DA_SUITE, ["designx", "runx", "outra"])).toEqual({ skills: ["runx", "designx"], ignoradas: ["sprintx", "legadox", "stackx", "mergex", "memox", "prodx", "buildx"] });
    expect(skillsParaInstalar(SKILLS_DA_SUITE, null)).toEqual({ skills: [...SKILLS_DA_SUITE], ignoradas: [] });
  });
});

describe("ambiente", () => {
  it("sem identidade, ORCA_, npm_config_, NODE_OPTIONS, segredos, EXPX_SKILLS_LOCAIS e GIT redirecionado; CI=1 e git sem prompt", () => {
    const e = ambienteDoInstalador({ origem: { PATH: "/usr/bin", HOME: "/h", ORCA_X: "1", CLAUDECODE: "1", npm_config_registry: "x", NODE_OPTIONS: "--r", GITHUB_TOKEN: "t", AWS_SECRET_ACCESS_KEY: "s", GIT_DIR: "/x", EXPX_SKILLS_LOCAIS: "/y", LANG: "pt_BR.UTF-8" }, inicio: "/h" });
    expect(Object.keys(e).filter((k) => /ORCA|CLAUDE|npm_config|NODE_OPTIONS|TOKEN|SECRET|GIT_DIR|EXPX_/i.test(k))).toEqual([]);
    expect(e["CI"]).toBe("1");
    expect(e["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(e["LANG"]).toBe("pt_BR.UTF-8");
    const n = ambienteNpm(e, "/t", "https://registry.npmjs.org/");
    expect(n["NPM_CONFIG_USERCONFIG"]).toBe("/t/npmrc-usuario-vazio");
    expect(n["NPM_CONFIG_IGNORE_SCRIPTS"]).toBe("true");
  });
});
