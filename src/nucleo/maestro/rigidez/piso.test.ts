import { describe, expect, it } from "vitest";
import { trab, tk } from "../../../../tests/fixtures/metodo/construtores";
import type { TrabalhoParaMaestro } from "../etapas/conclusao";
import { DENY_GIT, isolamentoDoPiso, lerRelatorioRapido, redigirSegredosNoTexto, resumoDoPiso, varrerDiff, varrerSegredosNoDiff, verificarPiso, type EntradaPiso, type IdPiso } from "./piso";
import { EVIDENCIA_VAZIA } from "./plano-de-etapas";

// Credenciais de MENTIRA montadas em tempo de execução: o arquivo não carrega nenhum literal com cara de segredo.
const j = (...partes: string[]): string => partes.join("");
const SENTINELA = j("sk", "-or-v1-", "SENTINELA9f8e7d6c5b4a39281716151413121110ab");
const TOKEN_GH = j("gh", "p_", "abcdefghijklmnopqrstuvwxyz0123456789");
const CHAVE_AWS = j("AK", "IA", "ABCDEFGHIJKLMNOP");
const JWT = j("ey", "JhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NTY3ODkwIn0.", "dBjftJeZ4CVPmB92K27uhbUJU1p1r");
const CABECALHO_PRIVADO = j("-----BEGIN ", "RSA PRIVATE", " KEY-----");
const ALTA_ENTROPIA = "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC2eF4hJ6kL8n";

const t = (tasks = [tk("T-01", { status: "concluida", suite: "verde" })]): TrabalhoParaMaestro => trab({}, tasks);
const base = (o: Partial<EntradaPiso> = {}): EntradaPiso => ({ pipeline_id: "sprintx", nivel: 3, evidencia: EVIDENCIA_VAZIA, trabalho: t(), plano: [{ etapa_id: "sprintx.f6", estado_inicial: "pendente", comando: "/expx:sprintx-executar <id>" }], ...o });
const item = (e: EntradaPiso, id: IdPiso) => verificarPiso(e).find((i) => i.id === id)!;

describe("piso invariante: I1..I10 (ok · violado · não comprovado)", () => {
  it("devolve exatamente I1..I10, em ordem", () => expect(verificarPiso(base()).map((i) => i.id)).toEqual(["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9", "I10"]));

  it("I1 ok / violado / não comprovado (feature)", () => {
    expect(item(base(), "I1").estado).toBe("ok");
    expect(item(base({ violacoes: [{ tipo: "teste_ausente", alvo: "T-01" }] }), "I1")).toMatchObject({ estado: "violado" });
    expect(item(base({ trabalho: t([tk("T-02", { status: "concluida", teste_integracao: null, teste_funcional: null, teste_regressao: null })]) }), "I1").estado).toBe("violado");
    expect(item(base({ trabalho: t([tk("T-03", { status: "pendente" })]) }), "I1").estado).toBe("nao_comprovado");
    expect(item(base({ trabalho: null }), "I1").estado).toBe("nao_comprovado");
  });
  it("I1 no rápido depende do relatório", () => {
    const r = (rapido: EntradaPiso["rapido"]) => item(base({ pipeline_id: "rapido", rapido }), "I1").estado;
    expect(r({ teste_criado: true, suite: "verde" })).toBe("ok");
    expect(r({ teste_criado: false, suite: "verde" })).toBe("violado");
    expect(r(null)).toBe("nao_comprovado");
    expect(r(undefined)).toBe("nao_comprovado");
  });
  it("I2 ok / violado / não comprovado", () => {
    expect(item(base({ rastro: { suite_ok_apos_ultima_alteracao: true } }), "I2").estado).toBe("ok");
    expect(item(base({ rastro: { suite_ok_apos_ultima_alteracao: false } }), "I2").estado).toBe("violado");
    expect(item(base({ trabalho: t([tk("T-01", { status: "concluida", suite: "vermelha" })]), rastro: { suite_ok_apos_ultima_alteracao: true } }), "I2").estado).toBe("violado");
    expect(item(base({ trabalho: t([tk("T-01", { status: "concluida", suite: "nao_executada" })]) }), "I2").estado).toBe("violado");
    expect(item(base({ trabalho: t([tk("T-01", { status: "concluida", suite: "parcial" })]), rastro: { suite_ok_apos_ultima_alteracao: true } }), "I2").estado).toBe("ok");
    expect(item(base(), "I2").estado).toBe("nao_comprovado");
    expect(item(base({ pipeline_id: "rapido", rapido: { teste_criado: true, suite: "vermelha" } }), "I2").estado).toBe("violado");
    expect(item(base({ pipeline_id: "rapido", rapido: { teste_criado: true, suite: "verde" } }), "I2").estado).toBe("ok");
  });
  it("I3: segredo no diff ⇒ violado (arquivo e padrão, nunca o valor); não varrido ⇒ não comprovado", () => {
    expect(item(base({ segredos: [] }), "I3").estado).toBe("ok");
    expect(item(base(), "I3").estado).toBe("nao_comprovado");
    expect(item(base({ segredos: null }), "I3").estado).toBe("nao_comprovado");
    const v = item(base({ segredos: [{ arquivo: "src/a.ts", padrao: "chave sk-" }] }), "I3");
    expect(v.estado).toBe("violado");
    expect(v.detalhe).toContain("src/a.ts");
    expect(v.detalhe).not.toContain("SENTINELA");
  });
  it("I4: Claude ⇒ isolamento duro (ok); demais CLIs ⇒ parcial (nunca afirma duro)", () => {
    expect(isolamentoDoPiso("claude")).toBe("duro");
    for (const c of ["codex", "opencode", "gemini", "aider", null, undefined]) expect(isolamentoDoPiso(c)).toBe("parcial");
    expect(item(base({ cli_implementador: "claude" }), "I4").estado).toBe("ok");
    expect(item(base({ cli_implementador: "codex" }), "I4").estado).toBe("nao_comprovado");
    expect(DENY_GIT).toEqual(expect.arrayContaining(["Bash(git push --force*)", "Bash(git reset --hard*)", "Bash(git clean -f*)", "Bash(git checkout .)", "Bash(git branch -D*)", "Bash(git push origin :*)"]));
  });
  it("I5: avaliador separado do implementador", () => {
    const impl = { etapa_id: "runx.e3" as const, tipo: "implementador" as const, pane_id: "p1", reutilizou_pane: false, perfil: { cli: "claude", modelo: "sonnet" } };
    const av = (o = {}) => ({ etapa_id: "runx.e4" as const, tipo: "avaliador" as const, pane_id: "p2", reutilizou_pane: false, perfil: { cli: "claude", modelo: "opus" }, ...o });
    expect(item(base({ execs: [impl, av()] }), "I5").estado).toBe("ok");
    expect(item(base({ execs: [impl, av({ reutilizou_pane: true })] }), "I5").estado).toBe("violado");
    expect(item(base({ execs: [impl, av({ perfil: { cli: "claude", modelo: "sonnet" } })] }), "I5").estado).toBe("violado");
    expect(item(base({ execs: [impl, av({ perfil: null })] }), "I5").estado).toBe("nao_comprovado");
    expect(item(base({ execs: [impl] }), "I5").estado).toBe("ok");
    expect(item(base(), "I5").estado).toBe("ok");
  });
  it("I6: ações humanas continuam humanas", () => {
    expect(item(base(), "I6").estado).toBe("ok");
    expect(item(base({ plano: [{ etapa_id: "mergex.revisar", estado_inicial: "humano", comando: null }] }), "I6").estado).toBe("ok");
    expect(item(base({ plano: [{ etapa_id: "mergex.revisar", estado_inicial: "pendente", comando: "/expx:mergex-revisar x" }] }), "I6").estado).toBe("violado");
    expect(item(base({ plano: [{ etapa_id: "prodx.assinatura", estado_inicial: "humano", comando: "/x" }] }), "I6").estado).toBe("violado");
    expect(item(base({ escritas: ["docs/produto/pedidos/PD-1/aprovado.md"] }), "I6").estado).toBe("violado");
  });
  it("I7: escrita só na pasta do produto e em .expx/hooks.json", () => {
    expect(item(base({ escritas: [".outra-pasta/a"] }), "I7").estado).toBe("violado");
    expect(item(base({ escritas: ["docs/x.md"] }), "I7").estado).toBe("violado");
    expect(item(base({ escritas: [".expx/estado.json"] }), "I7").estado).toBe("violado");
    expect(item(base({ escritas: [".expx/hooks.json"] }), "I7").estado).toBe("ok");
    expect(item(base({ escritas: [] }), "I7").estado).toBe("ok");
    expect(item(base({ escritas: ["../fora"] }), "I7").estado).toBe("violado");
  });
  it("I8: o ADE nunca escreve hook de segurança; o usuário rebaixar só gera aviso", () => {
    expect(item(base({ hooks_escritos: ["task-so-fecha-verde"] }), "I8").estado).toBe("ok");
    expect(item(base({ hooks_escritos: ["segredo-no-commit"] }), "I8").estado).toBe("violado");
    const u = item(base({ seguranca_rebaixada_pelo_usuario: ["git-perigoso"] }), "I8");
    expect(u.estado).toBe("nao_comprovado");
    expect(u.detalhe).toMatch(/piso comprometido: git-perigoso desligado por você/);
  });
  it("I9: push/PR só com consentimento em seguro/equilibrado", () => {
    const pr = { etapa_id: "mergex.pr" as const, tipo: "utilitario" as const, pane_id: "p", reutilizou_pane: false, perfil: null, despachada: true };
    expect(item(base({ execs: [pr], permissao: "seguro" }), "I9").estado).toBe("violado");
    expect(item(base({ execs: [pr], permissao: "equilibrado" }), "I9").estado).toBe("violado");
    expect(item(base({ execs: [pr], permissao: "seguro", pr_confirmado: true }), "I9").estado).toBe("ok");
    expect(item(base({ execs: [pr], permissao: "automatico" }), "I9").estado).toBe("ok");
    expect(item(base(), "I9").estado).toBe("ok");
  });
  it("I10: etapa de piso omitida do plano ⇒ violado", () => {
    const legado = { ...EVIDENCIA_VAZIA, legado: true };
    expect(item(base({ pipeline_id: "runx", evidencia: legado, plano: [{ etapa_id: "runx.e1", estado_inicial: "pendente", comando: "x" }] }), "I10").estado).toBe("violado");
    expect(item(base({ pipeline_id: "runx", evidencia: legado, plano: [{ etapa_id: "legadox.raio", estado_inicial: "pendente", comando: "x" }] }), "I10").estado).toBe("ok");
    expect(item(base({ pipeline_id: "runx", evidencia: legado, plano: [{ etapa_id: "legadox.raio", estado_inicial: "pulada_nivel", comando: null }] }), "I10").estado).toBe("violado");
    expect(item(base({ pipeline_id: "runx", nivel: 1, plano: [{ etapa_id: "rapido.executar", estado_inicial: "pendente", comando: null }] }), "I10").estado).toBe("ok");
    expect(item(base({ pipeline_id: "sprintx", plano: [] }), "I10").estado).toBe("ok");
  });
  it("resumo: violado > não comprovado > ok", () => {
    expect(resumoDoPiso([{ id: "I1", titulo: "", estado: "ok", detalhe: "" }])).toBe("ok");
    expect(resumoDoPiso([{ id: "I1", titulo: "", estado: "ok", detalhe: "" }, { id: "I2", titulo: "", estado: "nao_comprovado", detalhe: "" }])).toBe("nao_comprovado");
    expect(resumoDoPiso([{ id: "I1", titulo: "", estado: "nao_comprovado", detalhe: "" }, { id: "I2", titulo: "", estado: "violado", detalhe: "" }])).toBe("violado");
  });
  it("verificarPiso ≤ 20 ms (P-217)", () => {
    const e = base({ rastro: { suite_ok_apos_ultima_alteracao: true }, segredos: [] });
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) verificarPiso(e);
    expect((performance.now() - t0) / 200).toBeLessThan(20);
  });
  it("a sentinela de segredo nunca aparece no resultado", () => {
    const r = JSON.stringify(verificarPiso(base({ segredos: varrerDiff(`diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n+const k = "${SENTINELA}";\n`) })));
    expect(r).not.toContain("SENTINELA");
    expect(r).toContain("src/a.ts");
  });
});

describe("varredura de segredo no diff (só arquivo e padrão)", () => {
  const diff = (arquivo: string, ...linhas: string[]): string => `diff --git a/${arquivo} b/${arquivo}\n--- a/${arquivo}\n+++ b/${arquivo}\n@@ -1 +1 @@\n${linhas.map((l) => `+${l}`).join("\n")}\n`;
  it("acha sk-, token do GitHub, AWS, JWT, chave privada e alta entropia", () => {
    const casos: Array<[string, string]> = [
      [`const a = "${SENTINELA}"`, "chave sk-"],
      [`token = '${TOKEN_GH}'`, "token GitHub"],
      [`aws = '${CHAVE_AWS}'`, "chave AWS"],
      [`jwt = '${JWT}'`, "JWT"],
      [CABECALHO_PRIVADO, "chave privada"],
      [`const x = '${ALTA_ENTROPIA}'`, "sequência de alta entropia"],
    ];
    for (const [linha, padrao] of casos) {
      const r = varrerDiff(diff("src/x.ts", linha));
      expect(r.map((a) => a.padrao), padrao).toContain(padrao);
      expect(JSON.stringify(r)).not.toContain("SENTINELA");
    }
  });
  it("arquivo sensível por nome (ambiente, pem, id_rsa), exceto exemplos", () => {
    expect(varrerDiff(diff(".env", "A=1")).map((a) => a.padrao)).toContain("arquivo sensível");
    expect(varrerDiff(diff("config/.env.production", "A=1")).map((a) => a.padrao)).toContain("arquivo sensível");
    expect(varrerDiff(diff("keys/server.pem", "x")).map((a) => a.padrao)).toContain("arquivo sensível");
    expect(varrerDiff(diff("home/id_rsa", "x")).map((a) => a.padrao)).toContain("arquivo sensível");
    expect(varrerDiff(diff(".env.example", "A=")).length).toBe(0);
  });
  it("só linhas adicionadas; hash hex longo e identificador comum não são segredo", () => {
    expect(varrerDiff(`diff --git a/a b/a\n+++ b/a\n-const k = "${SENTINELA}"\n`)).toEqual([]);
    expect(varrerDiff(diff("a.ts", "const sha = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'"))).toEqual([]);
    expect(varrerDiff(diff("a.ts", "export const nomeMuitoLongoDeUmaFuncaoQueNaoEhSegredo = 1;"))).toEqual([]);
  });
  it("dedup por arquivo+padrão e diff vazio", () => {
    const r = varrerDiff(diff("a.ts", `x="${SENTINELA}"`, `y="${SENTINELA}"`));
    expect(new Set(r.map((a) => `${a.arquivo}|${a.padrao}`)).size).toBe(r.length);
    expect(r.filter((a) => a.padrao === "chave sk-")).toHaveLength(1);
    expect(varrerDiff("")).toEqual([]);
  });
  it("porta de diff: falha de leitura ⇒ null (não comprovado), nunca lança", async () => {
    expect((await varrerSegredosNoDiff({ diff: async () => diff("a.ts", `x="${SENTINELA}"`) }))?.map((a) => a.padrao)).toContain("chave sk-");
    expect(await varrerSegredosNoDiff({ diff: async () => { throw new Error("git sumiu"); } })).toBeNull();
  });
  it("diff grande varre em tempo razoável", () => {
    const grande = diff("a.ts", ...Array.from({ length: 20000 }, (_, i) => `const v${i} = ${i};`));
    const t0 = performance.now();
    varrerDiff(grande);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("relatório do pipeline rápido", () => {
  it("lê teste_criado e suite; inválido ⇒ null", () => {
    expect(lerRelatorioRapido("teste_criado: sim\nsuite: verde\nresumo: x")).toEqual({ teste_criado: true, suite: "verde" });
    expect(lerRelatorioRapido("teste_criado: nao\nsuite: vermelha")).toEqual({ teste_criado: false, suite: "vermelha" });
    expect(lerRelatorioRapido("teste_criado: não\nsuite: verde")).toEqual({ teste_criado: false, suite: "verde" });
    expect(lerRelatorioRapido("suite: verde")).toBeNull();
    expect(lerRelatorioRapido("teste_criado: talvez\nsuite: verde")).toBeNull();
    expect(lerRelatorioRapido(null)).toBeNull();
    expect(lerRelatorioRapido("x".repeat(30_000))).toBeNull();
  });
});

describe("redação de segredo no texto do pedido (antes de virar argumento, arquivo ou registro)", () => {
  const sk = ["sk", "-or-v1-", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("");
  const gh = ["gh", "p_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
  it("troca chaves conhecidas, NOME_SECRETO=valor e blocos de chave privada; o resto do texto fica idêntico", () => {
    const r = redigirSegredosNoTexto(`corrige o login, a chave ${sk} e o token ${gh} vazaram. API_TOKEN=abc123xyz789 e senha: x\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\nfim`);
    expect(r.redigiu).toBe(true);
    expect(r.texto).not.toContain(sk);
    expect(r.texto).not.toContain(gh);
    expect(r.texto).not.toContain("abc123xyz789");
    expect(r.texto).not.toContain("MIIEvQIBADANBg");
    expect(r.texto).toContain("corrige o login, a chave [segredo] e o token [segredo] vazaram.");
    expect(r.texto).toContain("API_TOKEN=[segredo]");
    expect(r.texto.endsWith("fim")).toBe(true);
  });
  it("texto sem segredo não muda (nem espaço), e identificadores comuns/hashes/URLs não são tratados como segredo", () => {
    const t = "corrige o erro em src/login/Form.tsx linha 42; commit 0123456789abcdef0123456789abcdef01234567 e https://exemplo.com/a/b";
    expect(redigirSegredosNoTexto(t)).toEqual({ texto: t, redigiu: false });
    expect(redigirSegredosNoTexto("")).toEqual({ texto: "", redigiu: false });
  });
  it("é rápido mesmo com 4 000 caracteres hostis (sem regex catastrófica)", () => {
    const t0 = performance.now();
    redigirSegredosNoTexto(`${"a1B2".repeat(1000)} ${"=".repeat(500)} ${"KEY=".repeat(200)}`);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
