import { afterEach, describe, expect, it } from "vitest";
import type { Faixa, Politica, PoliticaEntrada } from "../../compartilhado/harness";
import { PADRAO } from "../../../tests/fixtures/harness/construtores";
import { abrirBanco, migrar, type Banco } from "../banco/index";
import { criarRepositorios } from "../banco/repos/index";
import { montarEquivalencia } from "./equivalencia";
import { gerarSemente, ordenarProvedores } from "./semente";
import { FAIXA_PADRAO_POR_TASK_TYPE, GESTO_PARA_TASK_TYPE, OUTRO_PROVEDOR_QUE, TASK_TYPES_EMBUTIDOS, taskTypeDoGesto } from "./task-types";
import { validarPolitica, type ContextoPolitica } from "./politica";

const por = (s: PoliticaEntrada[], slug: string): PoliticaEntrada => s.find((p) => p.task_type === slug) as PoliticaEntrada;
const TODOS = ["claude", "codex", "gemini", "opencode", "aider", "qwen", "kilo", "grok", "openrouter"];

describe("TaskTypes embutidos (T-09.10)", () => {
  it("os 14 embutidos do plano, por categoria", () => {
    const porCategoria: Record<string, string[]> = {};
    for (const t of TASK_TYPES_EMBUTIDOS) (porCategoria[t.categoria] ??= []).push(t.slug);
    expect(porCategoria).toEqual({
      desenvolvimento: ["implementar", "bug-fix", "bug-profundo", "refatorar", "front"],
      revisao: ["auditar", "qa", "revisar-pr"],
      planejamento: ["triar", "planejar", "descobrir"],
      docs: ["docs"],
      seguranca: ["pentest"],
      geral: ["geral"],
    });
    for (const t of TASK_TYPES_EMBUTIDOS) expect(t.slug).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
  });
  it("gesto do método → TaskType (D-103); desconhecido ⇒ geral", () => {
    expect(GESTO_PARA_TASK_TYPE).toMatchObject({ nova_feature: "planejar", "sprintx-auditoria": "auditar", "runx-qa": "qa", nova_ocorrencia: "bug-fix", pedido_cru: "triar", projeto: "planejar" });
    expect(taskTypeDoGesto("executar_task")).toBe("implementar");
    expect(taskTypeDoGesto("xyz")).toBe("geral");
  });
  it("toda faixa padrão é conhecida e todo embutido tem faixa", () => {
    for (const t of TASK_TYPES_EMBUTIDOS) expect(["topo", "alto", "medio", "rapido"]).toContain(FAIXA_PADRAO_POR_TASK_TYPE[t.slug]);
    expect(OUTRO_PROVEDOR_QUE).toEqual({ auditar: "implementar" });
  });
});

describe("gerarSemente: tabela por faixa", () => {
  const sem = gerarSemente(TODOS, ["claude", "codex"], PADRAO);
  const faixas: Array<[string, Faixa]> = [["planejar", "topo"], ["auditar", "topo"], ["implementar", "alto"], ["bug-profundo", "alto"], ["bug-fix", "medio"], ["refatorar", "medio"], ["front", "medio"], ["qa", "medio"], ["triar", "rapido"], ["docs", "rapido"]];
  it.each(faixas)("%s → faixa %s (sem nome de modelo na política)", (slug, faixa) => {
    const p = por(sem, slug);
    expect(p.executor.faixa).toBe(faixa);
    expect(p.executor.model).toBeNull();
    expect(p.executor.effort).toBeNull();
    expect(p.workspace_id).toBeNull();
    expect(p.habilitada).toBe(true);
    expect(p.evitar_reservadas).toBe(true);
  });
  it("uma política por tipo embutido", () => expect(sem.map((p) => p.task_type)).toEqual(TASK_TYPES_EMBUTIDOS.map((t) => t.slug)));
  it("executor = primeiro da preferência; alternativas = os demais com a mesma faixa", () => {
    const p = por(sem, "implementar");
    expect(p.executor).toMatchObject({ provider: "claude", cli: "claude" });
    expect(p.alternativas.map((a) => a.provider)).toEqual(["codex", "gemini", "opencode", "aider", "qwen", "kilo", "grok"]);
    expect(p.alternativas.every((a) => a.faixa === "alto")).toBe(true);
  });
  it("fallback = faixa topo do primeiro provedor habilitado; nunca vazio", () => {
    for (const p of sem) expect(p.fallback).toEqual([{ provider: "claude", cli: "claude", model: null, effort: null, faixa: "topo" }]);
  });
  it("auditar escolhe provedor DIFERENTE do de implementar quando há ≥ 2", () => {
    expect(por(sem, "implementar").executor.provider).toBe("claude");
    expect(por(sem, "auditar").executor.provider).toBe("codex");
    expect(por(sem, "auditar").alternativas.map((a) => a.provider)).toContain("claude");
  });
  it("com um único provedor, auditar usa o mesmo", () => {
    const s = gerarSemente(["claude"], ["claude"], PADRAO);
    expect(por(s, "auditar").executor.provider).toBe("claude");
    expect(por(s, "auditar").alternativas).toEqual([]);
  });
  it("sem Claude instalado a semente usa o que existe", () => {
    const s = gerarSemente(["codex", "gemini"], ["claude", "codex", "gemini"], PADRAO);
    expect(por(s, "implementar").executor.provider).toBe("codex");
    expect(por(s, "auditar").executor.provider).toBe("gemini");
    expect(por(s, "triar").fallback[0]?.provider).toBe("codex");
    expect(s.every((p) => p.fallback.length >= 1)).toBe(true);
  });
  it("nenhum provedor ⇒ semente vazia (nada a gravar)", () => {
    expect(gerarSemente([], ["claude"], PADRAO)).toEqual([]);
  });
  it("faixa vazia pula o provedor; se nenhum tem a faixa, usa a mais próxima", () => {
    const eq = montarEquivalencia(PADRAO, { claude: { topo: [] }, codex: { topo: [] }, gemini: { topo: [] }, opencode: { topo: [] }, aider: { topo: [] }, qwen: { topo: [] }, kilo: { topo: [] }, grok: { topo: [] } }).efetiva;
    const s = gerarSemente(TODOS, ["claude", "codex"], eq);
    expect(por(s, "planejar").executor.faixa).toBe("alto");
    expect(por(s, "planejar").fallback[0]?.faixa).toBe("alto");
    const eq2 = montarEquivalencia(PADRAO, { claude: { topo: [] } }).efetiva;
    const s2 = gerarSemente(TODOS, ["claude", "codex"], eq2);
    expect(por(s2, "planejar").executor.provider).toBe("codex");
    expect(por(s2, "planejar").alternativas.map((a) => a.provider)).not.toContain("claude");
  });
  it("openrouter só entra com modelos habilitados e vem por último (cli null: escolhida na hora)", () => {
    const vazio = gerarSemente(["openrouter"], ["openrouter"], PADRAO);
    expect(vazio).toEqual([]);
    const eq = montarEquivalencia(PADRAO, undefined, { habilitado: true, consentido: true, modelos: [{ id: "v/m", nome: "m", contexto: null, suporta_tools: null, preco_entrada_por_mtok: null, preco_saida_por_mtok: null, habilitado: true, faixa: "alto", ordem: 1, tipos_permitidos: [] }] }).efetiva;
    const s = gerarSemente(["openrouter", "claude"], ["claude"], eq);
    expect(por(s, "implementar").executor.provider).toBe("claude");
    expect(por(s, "implementar").alternativas.at(-1)).toMatchObject({ provider: "openrouter", cli: null, faixa: "alto" });
  });
  it("é determinística (mesma entrada ⇒ mesma saída) e não muta a tabela", () => {
    const antes = JSON.stringify(PADRAO);
    expect(gerarSemente(TODOS, ["codex", "claude"], PADRAO)).toEqual(gerarSemente(TODOS, ["codex", "claude"], PADRAO));
    expect(JSON.stringify(PADRAO)).toBe(antes);
  });
  it("ordenarProvedores: preferência ∩ catálogo, resto do catálogo, openrouter por último; sem duplicatas", () => {
    expect(ordenarProvedores(["openrouter", "gemini", "claude"], ["claude", "claude", "x", "openrouter"])).toEqual(["claude", "openrouter", "gemini"]);
    expect(ordenarProvedores(["openrouter", "gemini", "claude"], [])).toEqual(["gemini", "claude", "openrouter"]);
  });
});

describe("semente × validação × banco real", () => {
  const abertos: Banco[] = [];
  afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
  const ctx = (): ContextoPolitica => ({
    taskTypes: new Set(TASK_TYPES_EMBUTIDOS.map((t) => t.slug)),
    provedoresHabilitados: new Set(["claude", "codex", "gemini"]),
    contasHabilitadas: new Map(),
    clisInstaladas: new Set(["claude", "codex", "gemini"]),
    openrouter: { consentido: false, modelosHabilitados: new Set(), clisCompativeis: [] },
    esforcoDe: () => [],
  });
  it("toda política da semente é válida e grava no repositório real (FK de task_type, fallback não vazio)", () => {
    const b = abrirBanco(":memory:");
    abertos.push(b);
    migrar(b);
    const r = criarRepositorios(b);
    r.taskType.semear([...TASK_TYPES_EMBUTIDOS]);
    const sem = gerarSemente(["claude", "codex", "gemini"], ["claude", "codex", "gemini"], PADRAO);
    for (const p of sem) {
      const v = validarPolitica(p, ctx());
      expect(v.ok, JSON.stringify(v)).toBe(true);
      expect(r.politica.gravar(p, "semente").atualizado_por).toBe("semente");
    }
    const efetivas: Politica[] = r.politica.efetivas(null);
    expect(efetivas).toHaveLength(TASK_TYPES_EMBUTIDOS.length);
    expect(efetivas.every((p) => p.fallback.length >= 1)).toBe(true);
  });
});
