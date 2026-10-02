import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ModeloOpenRouter } from "../../compartilhado/harness";
import { CATALOGO_TERMINAIS } from "../terminais/catalogo";
import { ARQUIVO_EQUIVALENCIA, PADRAO } from "../../../tests/fixtures/harness/construtores";
import { PROVEDORES_ROTEAVEIS, carregarEquivalenciaPadrao, equivalenciaMinima, equivalentes, faixaDe, montarEquivalencia, resolverFaixa, validarDiferencas, validarEquivalencia } from "./equivalencia";
import { lerEquivalenciaDeArquivo } from "./equivalencia-arquivo";

const orMod = (id: string, faixa: ModeloOpenRouter["faixa"], x: Partial<ModeloOpenRouter> = {}): ModeloOpenRouter => ({ id, nome: id, contexto: null, suporta_tools: null, preco_entrada_por_mtok: null, preco_saida_por_mtok: null, habilitado: true, faixa, ordem: 100, tipos_permitidos: [], ...x });

describe("equivalencia.json: contrato do arquivo versionado", () => {
  const bruto = JSON.parse(readFileSync(ARQUIVO_EQUIVALENCIA, "utf8")) as unknown;
  it("passa na validação estrita e traz TODOS os provedores do catálogo (menos o shell) + openrouter", () => {
    const r = validarEquivalencia(bruto);
    expect(r.ok).toBe(true);
    for (const f of CATALOGO_TERMINAIS) if (f.id !== "terminal") expect(Object.keys((bruto as { provedores: object }).provedores)).toContain(f.id);
    expect(Object.keys((bruto as { provedores: object }).provedores)).toContain("openrouter");
    expect(PROVEDORES_ROTEAVEIS).toContain("openrouter");
  });
  it("só usa nomes confirmados (opus/sonnet/haiku do Claude; ids de `grok models`) ou `default` com confirmado:false", () => {
    const prov = (bruto as { provedores: Record<string, Record<string, Array<{ modelo: string; confirmado?: boolean }>>> }).provedores;
    for (const [p, faixas] of Object.entries(prov)) {
      for (const lista of Object.values(faixas)) {
        for (const e of lista) {
          if (p === "claude") expect(["opus", "sonnet", "haiku"]).toContain(e.modelo);
          else if (p === "grok" && e.modelo !== "default") {
            // ids listados por `grok models` (grok 1.0.46, 2026-10-01): confirmados na própria CLI
            expect(["grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5"]).toContain(e.modelo);
            expect(e.confirmado).toBe(true);
          } else {
            expect(e.modelo).toBe("default");
            expect(e.confirmado).toBe(false);
          }
        }
      }
    }
  });
  it("openrouter nasce vazio (as faixas vêm dos modelos habilitados)", () => {
    for (const f of ["topo", "alto", "medio", "rapido"] as const) expect(resolverFaixa(PADRAO, "openrouter", f)).toEqual([]);
  });
  it("nenhum nome de modelo concreto fora de equivalencia.json/catalogo.ts nos módulos do harness (varredura)", () => {
    const dir = join(__dirname);
    const arquivos = ["equivalencia.ts", "semente.ts", "politica.ts", "escolher-conta.ts", "escolher-modelo.ts", "recibo.ts", "task-types.ts"];
    for (const a of arquivos) expect(readFileSync(join(dir, a), "utf8"), a).not.toMatch(/\b(opus|sonnet|haiku|gpt-|gemini-\d|o3|o4-mini)\b/);
  });
});

describe("validarEquivalencia: tabela de recusas (estrita, com o campo)", () => {
  const base = (): Record<string, unknown> => JSON.parse(readFileSync(ARQUIVO_EQUIVALENCIA, "utf8")) as Record<string, unknown>;
  const muda = (f: (o: any) => void): unknown => {
    const o = base();
    f(o);
    return o;
  };
  const casos: Array<[string, unknown, string]> = [
    ["não objeto", 5, "$"],
    ["campo desconhecido no topo", muda((o) => (o["extra"] = 1)), "extra"],
    ["versão inválida", muda((o) => (o["versao"] = 0)), "versao"],
    ["faixas incompletas", muda((o) => (o["faixas"] = ["topo"])), "faixas"],
    ["ordem_de_descida repetida", muda((o) => (o["ordem_de_descida"] = ["topo", "topo", "alto", "medio"])), "ordem_de_descida"],
    ["provedor fora do catálogo", muda((o) => (o.provedores["inventado"] = { topo: [] })), "provedores.inventado"],
    ["faixa desconhecida", muda((o) => (o.provedores.claude["supremo"] = [])), "provedores.claude.supremo"],
    ["faixa não é lista", muda((o) => (o.provedores.claude.topo = "opus")), "provedores.claude.topo"],
    ["entrada não é objeto", muda((o) => (o.provedores.claude.topo = ["opus"])), "provedores.claude.topo[0]"],
    ["campo desconhecido na entrada", muda((o) => (o.provedores.claude.topo[0].preco = 3)), "provedores.claude.topo[0].preco"],
    ["nome de modelo inválido (começa com hífen)", muda((o) => (o.provedores.claude.topo[0].modelo = "-x")), "provedores.claude.topo[0].modelo"],
    ["nome de modelo com espaço", muda((o) => (o.provedores.claude.topo[0].modelo = "a b")), "provedores.claude.topo[0].modelo"],
    ["modelo não é texto", muda((o) => (o.provedores.claude.topo[0].modelo = 3)), "provedores.claude.topo[0].modelo"],
    ["esforço fora dos níveis da CLI (todos vazios hoje)", muda((o) => (o.provedores.claude.topo[0].esforco = "high")), "provedores.claude.topo[0].esforco"],
    ["confirmado não booleano", muda((o) => (o.provedores.claude.topo[0].confirmado = "sim")), "provedores.claude.topo[0].confirmado"],
    ["entrada duplicada na faixa", muda((o) => o.provedores.claude.topo.push({ modelo: "opus", esforco: null })), "provedores.claude.topo[1]"],
    ["tipos_permitidos fora do openrouter", muda((o) => (o.provedores.claude.topo[0].tipos_permitidos = ["auditar"])), "provedores.claude.topo[0].tipos_permitidos"],
    ["openrouter exige id vendor/modelo", muda((o) => (o.provedores.openrouter.topo = [{ modelo: "semvendor", esforco: null }])), "provedores.openrouter.topo[0].modelo"],
    ["lista grande demais", muda((o) => (o.provedores.claude.topo = Array.from({ length: 21 }, (_, i) => ({ modelo: `m${i}`, esforco: null })))), "provedores.claude.topo"],
  ];
  it.each(casos)("recusa: %s", (_n, entrada, campo) => {
    const r = validarEquivalencia(entrada);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.map((e) => e.campo)).toContain(campo);
  });
  it("aceita modelo null e nome de modelo `default`", () => {
    expect(validarEquivalencia(muda((o) => (o.provedores.codex.topo = [{ modelo: null, esforco: null }, { modelo: "default", esforco: null }])) ).ok).toBe(false); // duplicata null/default só quando idênticos
    expect(validarEquivalencia(muda((o) => (o.provedores.codex.topo = [{ modelo: null, esforco: null }]))).ok).toBe(true);
  });
});

describe("carregarEquivalenciaPadrao: arquivo ausente/corrompido ⇒ tabela mínima embutida + aviso", () => {
  it("texto null", () => {
    const r = carregarEquivalenciaPadrao(null);
    expect(r.origem).toBe("embutido");
    expect(r.avisos[0]).toMatch(/ausente/);
    for (const p of PROVEDORES_ROTEAVEIS) expect(r.padrao.provedores[p]).toBeDefined();
  });
  it("JSON inválido", () => {
    const r = carregarEquivalenciaPadrao("{ nao eh json");
    expect(r.origem).toBe("embutido");
    expect(r.avisos[0]).toMatch(/corrompido/);
  });
  it("conteúdo inválido (estrutura): usa o embutido e cita o campo", () => {
    const r = carregarEquivalenciaPadrao(JSON.stringify({ versao: 1, faixas: ["topo", "alto", "medio", "rapido"], ordem_de_descida: ["topo", "alto", "medio", "rapido"], provedores: { claude: { topo: [{ modelo: "-" }] } } }));
    expect(r.origem).toBe("embutido");
    expect(r.avisos[0]).toMatch(/claude\.topo\[0\]\.modelo/);
  });
  it("a tabela mínima usa só `default` não confirmado (nenhum nome concreto) e valida", () => {
    const m = equivalenciaMinima();
    for (const [p, fs] of Object.entries(m.provedores)) for (const l of Object.values(fs)) for (const e of l ?? []) expect([p, e.modelo, (e as { confirmado?: boolean }).confirmado]).toEqual([p, "default", false]);
    expect(validarEquivalencia({ versao: 1, ...m }).ok).toBe(true);
  });
  it("arquivo válido: origem 'arquivo', sem aviso; provedor do catálogo faltando vira faixas vazias (pulado)", () => {
    const bruto = JSON.parse(readFileSync(ARQUIVO_EQUIVALENCIA, "utf8")) as { provedores: Record<string, unknown> };
    delete bruto.provedores["kilo"];
    const r = carregarEquivalenciaPadrao(JSON.stringify(bruto));
    expect(r.origem).toBe("arquivo");
    expect(resolverFaixa(r.padrao, "kilo", "topo")).toEqual([]);
    expect(carregarEquivalenciaPadrao(readFileSync(ARQUIVO_EQUIVALENCIA, "utf8")).avisos).toEqual([]);
  });
  it("lerEquivalenciaDeArquivo: caminho inexistente e arquivo corrompido em disco nunca lançam", () => {
    expect(lerEquivalenciaDeArquivo("/caminho/que/nao/existe.json").origem).toBe("embutido");
    const dir = mkdtempSync(join(tmpdir(), "eqv-"));
    try {
      const f = join(dir, "e.json");
      writeFileSync(f, "{{{");
      expect(lerEquivalenciaDeArquivo(f).origem).toBe("embutido");
      writeFileSync(f, readFileSync(ARQUIVO_EQUIVALENCIA));
      expect(lerEquivalenciaDeArquivo(f).origem).toBe("arquivo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("override do usuário e OpenRouter (montarEquivalencia)", () => {
  it("override vence o arquivo; só as diferenças ficam em `diferencas`; padrão intacto", () => {
    const m = montarEquivalencia(PADRAO, { claude: { topo: [{ modelo: "sonnet", esforco: null }] } });
    expect(resolverFaixa(m.efetiva, "claude", "topo")[0]?.modelo).toBe("sonnet");
    expect(resolverFaixa(m.padrao, "claude", "topo")[0]?.modelo).toBe("opus");
    expect(Object.keys(m.diferencas)).toEqual(["claude"]);
    expect(m.avisos).toEqual([]);
  });
  it("override inválido é recusado com o campo (validarDiferencas) e ignorado com aviso ao montar", () => {
    const ruim = { claude: { topo: [{ modelo: "-x", esforco: null }] } };
    const v = validarDiferencas(ruim);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.erros[0]?.campo).toBe("provedores.claude.topo[0].modelo");
    const m = montarEquivalencia(PADRAO, ruim);
    expect(resolverFaixa(m.efetiva, "claude", "topo")[0]?.modelo).toBe("opus");
    expect(m.avisos[0]).toMatch(/ignorado/);
  });
  it("override não aceita openrouter nem provedor/faixa desconhecidos", () => {
    expect(validarDiferencas({ openrouter: { topo: [] } }).ok).toBe(false);
    expect(validarDiferencas({ x: {} }).ok).toBe(false);
    expect(validarDiferencas({ claude: { supremo: [] } }).ok).toBe(false);
  });
  it("faixa vazia no override pula o provedor naquela faixa", () => {
    const m = montarEquivalencia(PADRAO, { codex: { topo: [] } });
    expect(resolverFaixa(m.efetiva, "codex", "topo")).toEqual([]);
    expect(equivalentes(m.efetiva, { provedor: "claude", modelo: "opus" }, "mesma", ["codex"])).toEqual([]);
  });
  it('"restaurar padrão" = montar sem override', () => {
    const m = montarEquivalencia(PADRAO, undefined);
    expect(m.efetiva.provedores).toEqual(PADRAO.provedores);
    expect(m.diferencas).toEqual({});
  });
  it("modelos OpenRouter habilitados entram por faixa e ordem; só com habilitado E consentimento", () => {
    const modelos = [orMod("v/b", "topo", { ordem: 2 }), orMod("v/a", "topo", { ordem: 1 }), orMod("v/c", "medio", { tipos_permitidos: ["auditar"] }), orMod("v/off", "topo", { habilitado: false }), orMod("v/semfaixa", null)];
    const com = montarEquivalencia(PADRAO, undefined, { habilitado: true, consentido: true, modelos });
    expect(resolverFaixa(com.efetiva, "openrouter", "topo").map((e) => e.modelo)).toEqual(["v/a", "v/b"]);
    expect(resolverFaixa(com.efetiva, "openrouter", "medio")[0]).toMatchObject({ modelo: "v/c", tipos_permitidos: ["auditar"] });
    for (const sem of [{ habilitado: false, consentido: true }, { habilitado: true, consentido: false }]) {
      const m = montarEquivalencia(PADRAO, undefined, { ...sem, modelos });
      expect(resolverFaixa(m.efetiva, "openrouter", "topo")).toEqual([]);
    }
  });
  it("modelo OpenRouter desabilitado some da tabela efetiva", () => {
    const m = montarEquivalencia(PADRAO, undefined, { habilitado: true, consentido: true, modelos: [orMod("v/a", "topo", { habilitado: false })] });
    expect(resolverFaixa(m.efetiva, "openrouter", "topo")).toEqual([]);
  });
});

describe("consulta: resolverFaixa, faixaDe e equivalentes", () => {
  it("faixaDe devolve a faixa mais alta onde o modelo aparece; desconhecido = null; null/default = padrão da CLI", () => {
    expect(faixaDe(PADRAO, "claude", "opus")).toBe("topo");
    expect(faixaDe(PADRAO, "claude", "sonnet")).toBe("alto");
    expect(faixaDe(PADRAO, "claude", "haiku")).toBe("rapido");
    expect(faixaDe(PADRAO, "claude", "nada")).toBeNull();
    expect(faixaDe(PADRAO, "codex", null)).toBe("topo");
    expect(faixaDe(PADRAO, "inexistente", "x")).toBeNull();
  });
  const todos = ["claude", "codex", "gemini"];
  it("mesma: só a mesma faixa, sem a própria origem", () => {
    const r = equivalentes(PADRAO, { provedor: "claude", modelo: "opus" }, "mesma", todos);
    expect(r.map((e) => `${e.provedor}:${e.faixa}:${e.descida}`)).toEqual(["codex:topo:0", "gemini:topo:0"]);
    expect(r.every((e) => e.confirmado === false)).toBe(true);
    expect(r[0]?.modelo).toBeNull();
  });
  it("descer_1: mesma faixa e UMA abaixo (aviso fica com quem chama); dedupe do mesmo modelo", () => {
    const r = equivalentes(PADRAO, { provedor: "claude", modelo: "opus" }, "descer_1", todos);
    expect(r.map((e) => `${e.provedor}:${e.modelo}:${e.faixa}`)).toEqual(["codex:null:topo", "gemini:null:topo", "claude:sonnet:alto"]);
    expect(r.at(-1)?.descida).toBe(1);
  });
  it("qualquer: todas as faixas abaixo, em ordem de descida", () => {
    const r = equivalentes(PADRAO, { provedor: "claude", modelo: "opus" }, "qualquer", ["claude"]);
    expect(r.map((e) => `${e.modelo}:${e.faixa}`)).toEqual(["sonnet:alto", "haiku:rapido"]);
  });
  it("nunca sobe de faixa", () => {
    const r = equivalentes(PADRAO, { provedor: "claude", modelo: "haiku" }, "qualquer", todos);
    expect(r.every((e) => e.faixa === "rapido")).toBe(true);
  });
  it("origem desconhecida e sem faixa explícita ⇒ nada; faixa explícita basta", () => {
    expect(equivalentes(PADRAO, { provedor: "claude", modelo: "xyz" }, "qualquer", todos)).toEqual([]);
    expect(equivalentes(PADRAO, { provedor: "claude", modelo: "xyz", faixa: "alto" }, "mesma", ["codex"])).toHaveLength(1);
  });
  it("respeita a ordem e o conjunto dos provedores habilitados", () => {
    const r = equivalentes(PADRAO, { provedor: "claude", modelo: "opus" }, "mesma", ["gemini", "codex"]);
    expect(r.map((e) => e.provedor)).toEqual(["gemini", "codex"]);
    expect(equivalentes(PADRAO, { provedor: "claude", modelo: "opus" }, "mesma", [])).toEqual([]);
  });
  it("é pura: não muta a tabela", () => {
    const antes = JSON.stringify(PADRAO);
    equivalentes(PADRAO, { provedor: "claude", modelo: "opus" }, "qualquer", todos);
    montarEquivalencia(PADRAO, { claude: { topo: [] } });
    expect(JSON.stringify(PADRAO)).toBe(antes);
  });
});
