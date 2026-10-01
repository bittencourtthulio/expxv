import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp as criarTmpProjeto, limparTmps } from "../../../tests/fixtures/metodo/util";
import { gerarProjetoExpx } from "../../../tests/fixtures/metodo/gerar";
import { alertasDeSchema, lerInstalacao } from "./instalacao";
import type { IndiceProjeto } from "./tipos";

afterEach(limparTmps);

function escrever(raiz: string, rel: string, conteudo: string): void {
  const abs = join(raiz, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, conteudo);
}

describe("instalação do método numa pasta", () => {
  it("pasta sem .expx/: nada instalado, tudo faltando, com a instrução de como começar", async () => {
    const raiz = criarTmpProjeto();
    const r = await lerInstalacao(raiz);
    expect(r.tem_expx).toBe(false);
    expect(r.lock).toMatchObject({ presente: false, skills: [], harness: [], versao_cli: null });
    expect(r.camadas.every((c) => !c.instalada)).toBe(true);
    expect(r.hooks).toMatchObject({ presente: false, origem: "padrao" });
    expect(r.faltando.map((f) => f.camada)).toEqual(expect.arrayContaining(["lock", "convencoes", "perfil_legado", "design_system", "produto", "memoria"]));
    expect(r.comando_onboarding).toBe("/expx:onboarding");
    expect(r.alertas.join(" ")).toMatch(/\.expx/);
  });

  it("com lock: versões, harness, skills e commit de cada uma", async () => {
    const raiz = criarTmpProjeto();
    escrever(raiz, ".expx/expx-lock.json", JSON.stringify({ lock_version: 1, cli_version: "0.9.0", harness: ["claude", "opencode"], skills: { sprintx: { commit: "6b846ae3404d", resolvido_em: "2026-09-30" }, runx: { commit: "4480d7817da7" } } }));
    const r = await lerInstalacao(raiz);
    expect(r.tem_expx).toBe(true);
    expect(r.lock).toMatchObject({ presente: true, legivel: true, versao_cli: "0.9.0", harness: ["claude", "opencode"], versao_lock: 1 });
    expect(r.lock.skills.map((s) => s.nome)).toEqual(["runx", "sprintx"]);
    expect(r.lock.skills.find((s) => s.nome === "sprintx")?.commit).toBe("6b846ae3404d");
    expect(r.faltando.map((f) => f.camada)).not.toContain("lock");
  });

  it("aceita o lock no formato do contrato (expx_lock) e ignora chave desconhecida", async () => {
    const raiz = criarTmpProjeto();
    escrever(raiz, ".expx/expx-lock.json", JSON.stringify({ expx_lock: 1, cli_version: "0.9.0", harness: ["claude"], skills: { sprintx: { commit: "abc" } }, futuro: { x: 1 } }));
    const r = await lerInstalacao(raiz);
    expect(r.lock).toMatchObject({ legivel: true, versao_lock: 1, harness: ["claude"] });
    expect(r.lock.skills).toHaveLength(1);
  });

  it("lock ilegível ou de versão mais nova gera alerta, nunca exceção", async () => {
    const a = criarTmpProjeto();
    escrever(a, ".expx/expx-lock.json", "{ quebrado");
    const ra = await lerInstalacao(a);
    expect(ra.lock).toMatchObject({ presente: true, legivel: false });
    expect(ra.alertas.join(" ")).toMatch(/ilegível/);
    const b = criarTmpProjeto();
    escrever(b, ".expx/expx-lock.json", JSON.stringify({ lock_version: 7, cli_version: "9.0.0", harness: [], skills: {} }));
    const rb = await lerInstalacao(b);
    expect(rb.alertas.join(" ")).toMatch(/mais nova/);
  });

  it("camadas instaladas pelos arquivos e o comando de cada uma que falta", async () => {
    const raiz = criarTmpProjeto();
    escrever(raiz, ".expx/expx-lock.json", JSON.stringify({ lock_version: 1, cli_version: "0.9.0", harness: ["claude"], skills: {} }));
    escrever(raiz, "docs/stack/CONVENCOES.md", "# Convenções\n");
    escrever(raiz, "docs/produto/PRODUTO.md", "# Produto\n");
    const r = await lerInstalacao(raiz);
    const por = Object.fromEntries(r.camadas.map((c) => [c.id, c]));
    expect(por["convencoes"]).toMatchObject({ instalada: true, arquivo: "docs/stack/CONVENCOES.md" });
    expect(por["produto"]?.instalada).toBe(true);
    expect(por["perfil_legado"]).toMatchObject({ instalada: false, comando: "/expx:legadox-perfil", skill: "legadox-perfil" });
    expect(por["design_system"]).toMatchObject({ instalada: false, comando: "/expx:designx-cartography" });
    expect(por["memoria"]).toMatchObject({ instalada: false, comando: "/expx:memox-indexar" });
    expect(r.faltando.find((f) => f.camada === "perfil_legado")?.comando).toBe("/expx:legadox-perfil");
    expect(r.faltando.map((f) => f.camada)).not.toContain("convencoes");
  });

  it("o prefixo do comando segue o harness do lock (OpenCode sem /expx:)", async () => {
    const raiz = criarTmpProjeto();
    escrever(raiz, ".expx/expx-lock.json", JSON.stringify({ lock_version: 1, cli_version: "0.9.0", harness: ["opencode"], skills: {} }));
    const r = await lerInstalacao(raiz);
    expect(r.harness_padrao).toBe("opencode");
    expect(r.comando_onboarding).toBe("/onboarding");
    expect(r.camadas.find((c) => c.id === "convencoes")?.comando).toBe("/stackx-detectar");
  });

  it("sem hooks.json: padrões de nascimento; com hooks.json: modos lidos (somente leitura)", async () => {
    const raiz = criarTmpProjeto();
    escrever(raiz, ".expx/expx-lock.json", JSON.stringify({ lock_version: 1, cli_version: "0.9.0", harness: ["claude"], skills: {} }));
    const sem = await lerInstalacao(raiz);
    expect(sem.hooks.presente).toBe(false);
    expect(sem.faltando.find((f) => f.camada === "hooks")).toMatchObject({ obrigatorio: false });
    escrever(raiz, ".expx/hooks.json", JSON.stringify({ hooks: { "task-so-fecha-verde": "bloqueio" } }));
    const com = await lerInstalacao(raiz);
    expect(com.hooks.presente).toBe(true);
    expect(com.hooks.hooks.find((h) => h.nome === "task-so-fecha-verde")?.modo).toBe("bloqueio");
    expect(com.faltando.map((f) => f.camada)).not.toContain("hooks");
  });

  it("projeto Expx sintético completo não tem camada faltando além do que a fixture não cria", async () => {
    const raiz = criarTmpProjeto();
    gerarProjetoExpx(raiz);
    const r = await lerInstalacao(raiz);
    expect(r.tem_expx).toBe(true);
    const por = Object.fromEntries(r.camadas.map((c) => [c.id, c.instalada]));
    expect(por).toMatchObject({ convencoes: true, perfil_legado: true, design_system: true, memoria: true });
    expect(r.hooks.presente).toBe(true);
  });

  it("este próprio repositório: o lock real mostra as 9 skills e o que falta (docs/, hooks.json)", async () => {
    const raiz = process.cwd();
    if (!existsSync(join(raiz, ".expx", "expx-lock.json"))) return;
    const r = await lerInstalacao(raiz);
    expect(r.lock.skills.map((s) => s.nome).sort()).toEqual(["buildx", "designx", "legadox", "memox", "mergex", "prodx", "runx", "sprintx", "stackx"]);
    expect(r.lock.harness).toEqual(["claude", "opencode"]);
    if (!existsSync(join(raiz, ".expx", "hooks.json"))) expect(r.hooks.presente).toBe(false);
  });

  it("não escreve nada na pasta", async () => {
    const raiz = criarTmpProjeto();
    await lerInstalacao(raiz);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(raiz)).toEqual([]);
  });
});

describe("alertas de schema", () => {
  const indice = (rejeicoes: Array<{ caminho: string; motivo: string }>): IndiceProjeto => ({ rejeicoes }) as unknown as IndiceProjeto;

  it("arquivos com expx_schema maior que o suportado viram alerta com a contagem", () => {
    expect(alertasDeSchema(indice([]))).toEqual([]);
    const a = alertasDeSchema(indice([{ caminho: "docs/a.md", motivo: "schema_maior" }, { caminho: "docs/b.md", motivo: "schema_maior" }, { caminho: "docs/c.md", motivo: "yaml_invalido" }]));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/2 arquivos/);
    expect(a[0]).toMatch(/expx_schema/);
  });
});
