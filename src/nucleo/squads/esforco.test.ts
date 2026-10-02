import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIS_CATALOGO } from "../../compartilhado/squads";
import { lerTabelaEsforcoDeArquivo } from "./esforco-arquivo";
import {
  carregarTabelaEsforco,
  CliDesconhecidaErro,
  esforcoParaCli,
  EsforcoInvalidoErro,
  esforcoSugeridoDaFaixa,
  NIVEIS_ESFORCO,
  niveisDaCli,
  normalizarNivel,
  TABELA_ESFORCO_PADRAO,
  validarTabelaEsforco,
} from "./esforco";

const JSON_PATH = resolve(__dirname, "../../../resources/squads/esforco-por-cli.json");

describe("esforcoParaCli: tabela de decisão por CLI × nível", () => {
  const casos: Array<[string, string, string, string[] | null]> = [
    // cli, nível, tipo, argv
    ["claude", "minimo", "flag", ["--effort", "low"]],
    ["claude", "baixo", "flag", ["--effort", "low"]],
    ["claude", "medio", "flag", ["--effort", "medium"]],
    ["claude", "alto", "flag", ["--effort", "high"]],
    ["claude", "maximo", "flag", ["--effort", "max"]],
    ["claude", "xhigh", "flag", ["--effort", "xhigh"]], // nativo da CLI vale como está
    ["codex", "minimo", "config", ["-c", 'model_reasoning_effort="minimal"']],
    ["codex", "baixo", "config", ["-c", 'model_reasoning_effort="low"']],
    ["codex", "medio", "config", ["-c", 'model_reasoning_effort="medium"']],
    ["codex", "alto", "config", ["-c", 'model_reasoning_effort="high"']],
    ["codex", "maximo", "config", ["-c", 'model_reasoning_effort="xhigh"']],
    ["aider", "medio", "flag", ["--reasoning-effort", "medium"]],
    ["aider", "maximo", "flag", ["--reasoning-effort", "high"]],
    ["opencode", "alto", "indicativo", null],
    ["kilo", "baixo", "indicativo", null],
    ["grok", "alto", "indicativo", null], // --reasoning-effort existe, mas a ajuda não lista os níveis: indicativo (D-443)
    ["gemini", "maximo", "indicativo", null],
    ["qwen", "medio", "indicativo", null],
  ];
  it.each(casos)("%s × %s => %s", (cli, nivel, tipo, argv) => {
    const r = esforcoParaCli(cli, nivel);
    expect(r.tipo).toBe(tipo);
    if (argv === null) {
      expect(r.argv).toBeUndefined();
      expect(r.texto).toContain("## Nível de esforço desejado");
      expect(r.confiavel).toBe(false);
    } else {
      expect(r.argv).toEqual(argv);
      expect(r.texto).toBeUndefined();
      expect(r.confiavel).toBe(true);
    }
  });

  it("nomes nativos de outras CLIs normalizam (low, high, xhigh, minimal)", () => {
    expect(normalizarNivel("low")).toBe("baixo");
    expect(normalizarNivel("xhigh")).toBe("maximo");
    expect(esforcoParaCli("opencode", "high").nivel).toBe("alto");
    expect(esforcoParaCli("claude", "minimal").argv).toEqual(["--effort", "low"]);
  });

  it("nível inválido e CLI desconhecida viram erro nominal; nível nunca vira flag", () => {
    expect(() => esforcoParaCli("claude", "--evil")).toThrow(EsforcoInvalidoErro);
    expect(() => esforcoParaCli("claude", "")).toThrow(EsforcoInvalidoErro);
    expect(() => esforcoParaCli("claude", "ultra")).toThrow(EsforcoInvalidoErro);
    expect(() => esforcoParaCli("nada", "alto")).toThrow(CliDesconhecidaErro);
    expect(() => esforcoParaCli("__proto__", "alto")).toThrow(CliDesconhecidaErro);
  });

  it("nenhum valor gerado começa com '-' além da flag da tabela, e não há espaço em argumento de flag", () => {
    for (const cli of CLIS_CATALOGO) for (const n of NIVEIS_ESFORCO) {
      const r = esforcoParaCli(cli, n);
      if (r.tipo === "flag") { expect(r.argv).toHaveLength(2); expect(r.argv?.[1]).not.toMatch(/^-|\s/); }
      if (r.tipo === "config") expect(r.argv?.[0]).toBe("-c");
    }
  });

  it("entrada não confirmada vira indicativo (nunca inventa flag)", () => {
    const tabela = { ...TABELA_ESFORCO_PADRAO, clis: { ...TABELA_ESFORCO_PADRAO.clis, claude: { ...TABELA_ESFORCO_PADRAO.clis.claude!, confirmado: false } } };
    const r = esforcoParaCli("claude", "alto", { tabela });
    expect(r.tipo).toBe("indicativo");
    expect(r.confiavel).toBe(false);
    expect(r.aviso).toContain("não confirmado");
  });

  it("--help detectado sem a flag => indicativo com aviso; com a flag => flag; sem detecção => tabela", () => {
    expect(esforcoParaCli("claude", "alto", { flagsDetectadas: "Usage: claude [options]\n  --model <m>" }).tipo).toBe("indicativo");
    expect(esforcoParaCli("claude", "alto", { flagsDetectadas: new Set(["--effort"]) }).tipo).toBe("flag");
    expect(esforcoParaCli("claude", "alto", { flagsDetectadas: "  --effort <level>" }).argv).toEqual(["--effort", "high"]);
    expect(esforcoParaCli("claude", "alto", { flagsDetectadas: null }).tipo).toBe("flag");
    expect(esforcoParaCli("claude", "alto", { flagsDetectadas: "x" }).aviso).toContain("--effort");
  });

  it("mapa neutro faixa → esforço; niveisDaCli", () => {
    expect(["topo", "alto", "medio", "rapido"].map((f) => esforcoSugeridoDaFaixa(f as "topo"))).toEqual(["alto", "alto", "medio", "baixo"]);
    expect(niveisDaCli("claude")).toEqual({ niveis: ["low", "medium", "high", "xhigh", "max"], modo: "flag" });
    expect(niveisDaCli("opencode").modo).toBe("indicativo");
    expect(niveisDaCli("opencode").niveis).toEqual([...NIVEIS_ESFORCO]);
  });

  it("cobre todas as CLIs do catálogo e só as confirmadas têm mecanismo", () => {
    expect(Object.keys(TABELA_ESFORCO_PADRAO.clis).sort()).toEqual([...CLIS_CATALOGO].sort());
    for (const e of Object.values(TABELA_ESFORCO_PADRAO.clis)) if (e.tipo !== "indicativo") expect(e.confirmado).toBe(true);
  });
});

describe("tabela editável (resources/squads/esforco-por-cli.json)", () => {
  it("o arquivo é válido e idêntico ao espelho embutido", () => {
    const bruto: unknown = JSON.parse(readFileSync(JSON_PATH, "utf8"));
    const v = validarTabelaEsforco(bruto);
    expect(v.ok).toBe(true);
    expect(bruto).toEqual(TABELA_ESFORCO_PADRAO);
    expect(lerTabelaEsforcoDeArquivo(JSON_PATH)).toEqual({ tabela: TABELA_ESFORCO_PADRAO, avisos: [] });
  });

  it("arquivo ausente/corrompido/inválido cai no padrão com aviso (nunca lança)", () => {
    expect(carregarTabelaEsforco(null).avisos).toEqual([]);
    expect(carregarTabelaEsforco("{nao-json").avisos[0]).toContain("ilegível");
    const ruim = JSON.stringify({ versao: 1, clis: { claude: { tipo: "flag", confirmado: true, fonte: "x", flag: "--effort; rm", mapa: {} } } });
    const r = carregarTabelaEsforco(ruim);
    expect(r.tabela).toBe(TABELA_ESFORCO_PADRAO);
    expect(r.avisos.length).toBeGreaterThan(0);
    expect(lerTabelaEsforcoDeArquivo("/nao/existe.json").tabela).toBe(TABELA_ESFORCO_PADRAO);
  });

  it("o usuário completa uma CLI e as omitidas seguem no padrão; valor começando com '-' é recusado", () => {
    const custom = { versao: 2, clis: { gemini: { tipo: "flag", confirmado: true, fonte: "doc", flag: "--thinking", niveis_nativos: ["low", "high"], mapa: { minimo: "low", baixo: "low", medio: "high", alto: "high", maximo: "high" } } } };
    const r = carregarTabelaEsforco(JSON.stringify(custom));
    expect(r.avisos).toEqual([]);
    expect(esforcoParaCli("gemini", "alto", { tabela: r.tabela }).argv).toEqual(["--thinking", "high"]);
    expect(esforcoParaCli("claude", "alto", { tabela: r.tabela }).tipo).toBe("flag");
    custom.clis.gemini.mapa.alto = "-x";
    expect(validarTabelaEsforco(custom).ok).toBe(false);
    expect(validarTabelaEsforco({ versao: 1, clis: { naoexiste: {} } }).ok).toBe(false);
  });
});
