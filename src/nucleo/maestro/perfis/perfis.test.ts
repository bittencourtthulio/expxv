import { describe, expect, it, vi } from "vitest";
import { ETAPA_IDS, type EtapaConfig, type EtapaId } from "../../../compartilhado/maestro";
import { PRODUTO } from "../../produto";
import { ETAPAS, etapaDef } from "../etapas/catalogo";
import { aplicarPerfilProntoAsEtapas, CLI_PADRAO_DO_METODO, configDeFabrica, configsDeFabrica, perfisProntosDoMaestro, ID_ECONOMICO, ID_EQUILIBRADO, ID_MAXIMA_QUALIDADE } from "./padroes";
import { CHAVE_DE_VERSAO, CAMINHO_DE_EXPORTACAO, exportarConfig, importarPrevia } from "./portabilidade";
import { CARGO_POR_TIPO, perfilDaEtapa, PerfilIndisponivelErro, resolverPerfilEfetivo, resumoDoPerfil, type PortaHarnessDeEtapa } from "./resolver";
import { temErro, validarConfig, validarPerfilDeEtapa, type ContextoValidacao } from "./validar";


const CLIS: Record<string, { modelos: string[] | null; niveis: string[] | null; modo: "flag" | "config" | "indicativo" | "nenhum" | null; provedor: string }> = {
  claude: { modelos: ["opus", "sonnet", "haiku", "default"], niveis: ["low", "medium", "high", "xhigh", "max"], modo: "flag", provedor: "anthropic" },
  opencode: { modelos: null, niveis: null, modo: "indicativo", provedor: "multi" },
  codex: { modelos: ["gpt-5"], niveis: ["minimal", "low", "medium", "high", "xhigh"], modo: "config", provedor: "openai" },
  gemini: { modelos: null, niveis: null, modo: "nenhum", provedor: "google" },
  aider: { modelos: null, niveis: null, modo: "flag", provedor: "multi" },
};
const ctx = (extra: Partial<ContextoValidacao> = {}): ContextoValidacao => ({
  cli: (c) => (CLIS[c] === undefined ? null : { modelos: CLIS[c]?.modelos ?? null, niveis_esforco: CLIS[c]?.niveis ?? null, modo_esforco: CLIS[c]?.modo ?? null }),
  provedorDaCli: (c) => CLIS[c]?.provedor ?? null,
  ...extra,
});
const cfg = (etapa: EtapaId, perfil: Partial<EtapaConfig["perfil"]> = {}, resto: Partial<EtapaConfig> = {}): EtapaConfig => {
  const f = configDeFabrica(etapa);
  return { ...f, ...resto, perfil: { ...f.perfil, esforco: null, ...perfil } };
};
const codigos = (a: ReturnType<typeof validarConfig>) => a.map((x) => `${x.codigo}:${x.severidade}`);

describe("padrões de fábrica", () => {
  it("toda etapa tem padrão; humanas ficam fora de configsDeFabrica", () => {
    for (const id of ETAPA_IDS) expect(configDeFabrica(id).etapa_id).toBe(id);
    expect(configsDeFabrica().map((c) => c.etapa_id)).not.toContain("prodx.assinatura");
    expect(configsDeFabrica().map((c) => c.etapa_id)).not.toContain("mergex.revisar");
    expect(configsDeFabrica().length).toBe(ETAPAS.filter((e) => !e.humano).length);
  });
  it("tabela do plano: investigação no topo/alto, execução em medio, mecânicas no rapido", () => {
    expect(configDeFabrica("runx.e1").perfil).toMatchObject({ faixa: "topo", esforco: "alto", cli: "claude" });
    expect(configDeFabrica("sprintx.f3").perfil).toMatchObject({ faixa: "topo", esforco: "alto" });
    expect(configDeFabrica("sprintx.f2").perfil).toMatchObject({ faixa: "topo", esforco: "medio" });
    expect(configDeFabrica("runx.e3").perfil).toMatchObject({ faixa: "medio", esforco: "medio" });
    expect(configDeFabrica("sprintx.f6").perfil).toMatchObject({ faixa: "medio", esforco: "medio" });
    for (const e of ["mergex.check", "mergex.qa", "mergex.pr", "prodx.p0", "sprintx.f35"] as const) expect(configDeFabrica(e).perfil).toMatchObject({ faixa: "rapido", esforco: "baixo" });
    expect(configDeFabrica("buildx.condutor").perfil).toMatchObject({ faixa: "topo", esforco: "alto" });
    expect(configDeFabrica("rapido.executar").perfil).toMatchObject({ faixa: "medio", esforco: "medio" });
  });
  it("só modelos confirmados por nome (nenhum por padrão); atualizado_por fábrica; CLI padrão claude", () => {
    for (const c of configsDeFabrica()) {
      expect(c.perfil.modelo).toBeNull();
      expect(c.atualizado_por).toBe("fabrica");
      expect(c.perfil.origem_modelo).toBe("cli");
      expect(["claude", "auto"]).toContain(c.perfil.cli);
    }
    expect(CLI_PADRAO_DO_METODO).toBe("claude");
  });
  it("avaliadores nascem em `auto` e a fábrica inteira valida sem ERRO (V1..V9)", () => {
    for (const e of ["runx.e4", "sprintx.f5", "mergex.atencao", "stackx.check", "designx.audit"] as const) expect(configDeFabrica(e).perfil.cli).toBe("auto");
    const a = validarConfig(configsDeFabrica(), ctx());
    expect(a.filter((x) => x.severidade === "erro")).toEqual([]);
  });
  it("cada etapa de método traz a própria skill nas permitidas (V7 por construção)", () => {
    for (const c of configsDeFabrica()) {
      const d = etapaDef(c.etapa_id);
      if (d?.comando != null) expect(c.skills).toContain(d.comando);
    }
  });
  it("cópia nova a cada chamada (editar não altera a fábrica)", () => {
    const a = configDeFabrica("runx.e3");
    a.perfil.faixa = "topo";
    a.skills.push("x");
    expect(configDeFabrica("runx.e3").perfil.faixa).toBe("medio");
    expect(configDeFabrica("runx.e3").skills).not.toContain("x");
  });
});

describe("perfis prontos em lote (Econômico, Equilibrado, Máxima qualidade)", () => {
  it("os três existem", () => expect(perfisProntosDoMaestro().map((p) => p.id)).toEqual([ID_ECONOMICO, ID_EQUILIBRADO, ID_MAXIMA_QUALIDADE]));
  it("Econômico desce uma faixa, Máxima qualidade sobe, Equilibrado mantém os padrões por tipo", () => {
    const base = configsDeFabrica();
    const [eco, equi, max] = perfisProntosDoMaestro();
    const ordem = ["topo", "alto", "medio", "rapido"];
    const pos = (c: EtapaConfig[], e: EtapaId): number => ordem.indexOf(c.find((x) => x.etapa_id === e)?.perfil.faixa as string);
    const ecoC = aplicarPerfilProntoAsEtapas(eco!, base);
    const maxC = aplicarPerfilProntoAsEtapas(max!, base);
    const equiC = aplicarPerfilProntoAsEtapas(equi!, base);
    expect(pos(ecoC, "sprintx.f3")).toBeGreaterThan(pos(equiC, "sprintx.f3"));
    expect(pos(maxC, "runx.e3")).toBeLessThan(pos(equiC, "runx.e3"));
    for (const c of ecoC) expect(c.atualizado_por).toBe("usuario");
  });
  it("não muta a entrada, preserva CLI (manter) ou entrega ao harness (auto) e não toca etapas desligadas", () => {
    const base = configsDeFabrica();
    base[0] = { ...(base[0] as EtapaConfig), modo_execucao: "desligada" };
    const copia = JSON.stringify(base);
    const [eco] = perfisProntosDoMaestro();
    const m = aplicarPerfilProntoAsEtapas(eco!, base);
    expect(JSON.stringify(base)).toBe(copia);
    expect(m[0]).toEqual(base[0]);
    expect(m.find((c) => c.etapa_id === "runx.e3")?.perfil.cli).toBe("claude");
    expect(aplicarPerfilProntoAsEtapas(eco!, base, { cli: "auto" }).find((c) => c.etapa_id === "runx.e3")?.perfil.cli).toBe("auto");
    expect(aplicarPerfilProntoAsEtapas(eco!, base).every((c) => c.perfil.modelo === null || c === m[0])).toBe(true);
  });
});

type CasoV = [nome: string, config: EtapaConfig[], esperado: string[], c?: Partial<ContextoValidacao>];
const impl = (perfil: Partial<EtapaConfig["perfil"]> = {}) => cfg("runx.e3", perfil);
const aval = (perfil: Partial<EtapaConfig["perfil"]> = {}) => cfg("runx.e4", perfil);
const CASOS: CasoV[] = [
  ["V1: (cli,modelo) iguais ⇒ erro", [impl({ cli: "claude", modelo: "sonnet" }), aval({ cli: "claude", modelo: "sonnet" })], ["V1:erro"]],
  ["V1: iguais com modelo null ⇒ erro", [impl({ cli: "claude" }), aval({ cli: "claude" })], ["V1:erro"]],
  ["V1: só o provedor igual ⇒ aviso", [impl({ cli: "claude", modelo: "sonnet" }), aval({ cli: "claude", modelo: "opus" })], ["V1:aviso"]],
  ["V1: provedor diferente ⇒ ok", [impl({ cli: "claude", modelo: "sonnet" }), aval({ cli: "opencode", modelo: null })], []],
  ["V1: auto não prova igualdade ⇒ ok", [impl({ cli: "claude" }), aval({ cli: "auto" })], []],
  ["V1: nível 4 com ≥ 2 provedores e mesmo provedor ⇒ erro", [impl({ cli: "claude", modelo: "sonnet" }), aval({ cli: "claude", modelo: "opus" })], ["V1:erro"], { nivel: 4, provedoresHabilitados: 2 }],
  ["V1: nível 4 com 1 provedor só ⇒ aviso", [impl({ cli: "claude", modelo: "sonnet" }), aval({ cli: "claude", modelo: "opus" })], ["V1:aviso"], { nivel: 4, provedoresHabilitados: 1 }],
  ["V1: sprintx.f5 igual a sprintx.f6 ⇒ erro", [cfg("sprintx.f6", { cli: "claude", modelo: "opus" }), cfg("sprintx.f5", { cli: "claude", modelo: "opus" })], ["V1:erro"]],
  ["V1: mergex.atencao igual a runx.e3 ⇒ erro", [impl({ cli: "claude", modelo: "haiku" }), cfg("mergex.atencao", { cli: "claude", modelo: "haiku" })], ["V1:erro"]],
  ["V2: codex em etapa do método ⇒ erro", [cfg("runx.e3", { cli: "codex" })], ["V2:erro"]],
  ["V2: gemini em etapa do método ⇒ erro", [cfg("sprintx.f1", { cli: "gemini" })], ["V2:erro"]],
  ["V2: opencode ok", [cfg("runx.e3", { cli: "opencode" })], []],
  ["V2: auto ok", [cfg("runx.e3", { cli: "auto" })], []],
  ["V2: codex no rápido (sem comando do método) ok", [cfg("rapido.executar", { cli: "codex" })], []],
  ["V2: aider na consulta ok", [cfg("consulta.rag", { cli: "aider" })], []],
  ["V3: modelo existe", [cfg("runx.e3", { cli: "claude", modelo: "opus" })], []],
  ["V3: modelo fora da lista ⇒ erro", [cfg("runx.e3", { cli: "claude", modelo: "gpt-9" })], ["V3:erro"]],
  ["V3: default ok", [cfg("runx.e3", { cli: "claude", modelo: "default" })], []],
  ["V3: modelo com flag ⇒ erro", [cfg("runx.e3", { cli: "claude", modelo: "--dangerous" })], ["V3:erro"]],
  ["V3: lista desconhecida não valida", [cfg("runx.e3", { cli: "opencode", modelo: "qualquer/coisa" })], []],
  ["V3: openrouter habilitado ok (+ aviso de autenticação)", [cfg("runx.e3", { cli: "opencode", modelo: "anthropic/claude-sonnet-4", origem_modelo: "openrouter" })], ["V8:aviso"], { modelosOpenRouter: new Set(["anthropic/claude-sonnet-4"]) }],
  ["V3: openrouter não habilitado ⇒ erro", [cfg("runx.e3", { cli: "opencode", modelo: "x/y", origem_modelo: "openrouter" })], ["V3:erro", "V8:aviso"], { modelosOpenRouter: new Set(["a/b"]) }],
  ["V3: openrouter sem modelo ⇒ erro", [cfg("runx.e3", { cli: "opencode", modelo: null, origem_modelo: "openrouter" })], ["V3:erro", "V8:aviso"]],
  ["V4: esforço da CLI ok", [cfg("runx.e3", { cli: "claude", esforco: "high" })], []],
  ["V4: neutro ok", [cfg("runx.e3", { cli: "claude", esforco: "medio" })], []],
  ["V4: esforço inexistente ⇒ erro", [cfg("runx.e3", { cli: "claude", esforco: "turbo" })], ["V4:erro"]],
  ["V4: formato inválido ⇒ erro", [cfg("runx.e3", { cli: "claude", esforco: "--max" })], ["V4:erro"]],
  ["V4: CLI sem flag ⇒ aviso indicativo", [cfg("runx.e3", { cli: "opencode", esforco: "alto" })], ["V4:aviso"]],
  ["V4: null ok", [cfg("runx.e3", { cli: "claude", esforco: null })], []],
  ["V5: desligar etapa de piso ⇒ erro", [cfg("legadox.raio", {}, { modo_execucao: "desligada" })], ["V5:erro"]],
  ["V5: desligar rapido.executar ⇒ erro", [cfg("rapido.executar", {}, { modo_execucao: "desligada" })], ["V5:erro"]],
  ["V5: desligar etapa comum ok", [cfg("sprintx.f35", {}, { modo_execucao: "desligada" })], []],
  ["V6: config para etapa humana ⇒ erro", [{ ...cfg("runx.e3"), etapa_id: "prodx.assinatura" }], ["V6:erro"]],
  ["V6: mergex.revisar ⇒ erro", [{ ...cfg("runx.e3"), etapa_id: "mergex.revisar" }], ["V6:erro"]],
  ["V7: sem a skill da etapa ⇒ erro", [cfg("runx.e3", {}, { skills: ["outra"] })], ["V7:erro"]],
  ["V7: grupo da skill basta", [cfg("runx.e3", {}, { skills: ["runx"] })], []],
  ["V7: lista vazia ⇒ erro", [cfg("sprintx.f5", {}, { skills: [] })], ["V7:erro"]],
  ["V8: openrouter com codex em etapa do método ⇒ erro", [cfg("runx.e3", { cli: "codex", modelo: "a/b", origem_modelo: "openrouter" })], ["V2:erro", "V8:erro", "V8:aviso"]],
  ["V8: openrouter com claude (gateway) ok + aviso", [cfg("runx.e3", { cli: "claude", modelo: "a/b", origem_modelo: "openrouter" })], ["V8:aviso"]],
  ["V8: openrouter com aider fora do método ok + aviso", [cfg("rapido.executar", { cli: "aider", modelo: "a/b", origem_modelo: "openrouter" })], ["V8:aviso"]],
  ["V8: openrouter com gemini fora do método ⇒ erro", [cfg("rapido.executar", { cli: "gemini", modelo: "a/b", origem_modelo: "openrouter" })], ["V8:erro", "V8:aviso"]],
  ["V9: reusar terminal em avaliador ⇒ erro", [cfg("runx.e4", {}, { modo_execucao: "reusar_terminal" })], ["V9:erro"]],
  ["V9: reusar entre implementadores do mesmo perfil ok", [cfg("runx.e2", { cli: "claude", esforco: "medio", faixa: "alto" }), cfg("runx.e3", { cli: "claude", esforco: "medio" }, { modo_execucao: "reusar_terminal" })], [], {}],
  ["V9: reusar sem etapa anterior do mesmo perfil ⇒ erro", [cfg("runx.e3", { cli: "claude" }, { modo_execucao: "reusar_terminal" })], ["V9:erro"]],
  ["V9: perfis diferentes ⇒ erro", [cfg("runx.e2", { cli: "claude" }), cfg("runx.e3", { cli: "opencode" }, { modo_execucao: "reusar_terminal" })], ["V9:erro"]],
  ["V0: etapa desconhecida ⇒ erro", [{ ...cfg("runx.e3"), etapa_id: "x.y" }], ["V0:erro"]],
  ["V0: agente inexistente ⇒ aviso", [cfg("runx.e3", { agente_id: "fantasma" })], ["V0:aviso"], { agentesExistentes: new Set(["real"]) }],
  ["fábrica de uma etapa só passa", [configDeFabrica("sprintx.f1")], []],
];
describe("validação V1..V9 (45 casos)", () => {
  it("tem ≥ 45 casos", () => expect(CASOS.length).toBeGreaterThanOrEqual(45));
  it.each(CASOS)("%s", (_n, configs, esperado, c = {}) => {
    const r = validarConfig(configs, ctx(c));
    expect(codigos(r).sort()).toEqual([...esperado].sort());
  });
  it("V9: mesmo perfil consecutivo passa (e2→e3 iguais)", () => {
    const e2 = cfg("runx.e2", { cli: "claude", modelo: null, esforco: "medio" });
    const e3 = cfg("runx.e3", { cli: "claude", modelo: null, esforco: "medio" }, { modo_execucao: "reusar_terminal" });
    expect(validarConfig([e2, e3], ctx()).filter((a) => a.codigo === "V9")).toEqual([]);
  });
  it("erro nomeia as etapas do par (V1) e temErro separa erro de aviso", () => {
    const r = validarConfig([impl({ cli: "claude", modelo: "sonnet" }), aval({ cli: "claude", modelo: "sonnet" })], ctx());
    expect(r[0]?.relacionadas).toEqual(["runx.e3"]);
    expect(temErro(r)).toBe(true);
    expect(temErro([{ codigo: "V4", severidade: "aviso", etapa_id: "x", mensagem: "" }])).toBe(false);
  });
  it("validarPerfilDeEtapa isolada não faz o cruzamento V1", () => {
    expect(validarPerfilDeEtapa(aval({ cli: "claude", modelo: "sonnet" }), ctx())).toEqual([]);
  });
});

describe("resolução do perfil da etapa", () => {
  const ws = (e: EtapaId): EtapaConfig | null => (e === "runx.e3" ? cfg("runx.e3", { cli: "opencode", modelo: "ws" }, { atualizado_por: "usuario" }) : null);
  const gl = (e: EtapaId): EtapaConfig | null => (e === "runx.e3" ? cfg("runx.e3", { cli: "claude", modelo: "gl" }, { atualizado_por: "usuario" }) : e === "runx.e2" ? cfg("runx.e2", { modelo: "gl2" }, { atualizado_por: "usuario" }) : null);
  it("override do workspace vence o global, que vence a fábrica", () => {
    expect(perfilDaEtapa("runx.e3", { workspace: ws, global: gl })).toMatchObject({ origem: "workspace", config: { perfil: { modelo: "ws" } } });
    expect(perfilDaEtapa("runx.e2", { workspace: ws, global: gl })).toMatchObject({ origem: "global", config: { perfil: { modelo: "gl2" } } });
    expect(perfilDaEtapa("runx.e1", { workspace: ws, global: gl })).toMatchObject({ origem: "fabrica" });
  });
  it("restaurar = remover o override: volta à fábrica", () => {
    expect(perfilDaEtapa("runx.e3", { workspace: () => null, global: () => null }).config).toEqual(configDeFabrica("runx.e3"));
  });
  it("agente_id aponta para o membro da squad (Fase 14)", () => {
    const f = { workspace: (e: EtapaId) => (e === "runx.e3" ? cfg("runx.e3", { agente_id: "executor-1" }, { atualizado_por: "usuario" }) : null), membro: (id: string) => (id === "executor-1" ? { agente_id: id, cli: "opencode", modelo: "m1", esforco: "alto", faixa: "alto" as const, conta_preferida: null, permissao: null } : null) };
    expect(perfilDaEtapa("runx.e3", f)).toMatchObject({ origem: "agente", config: { perfil: { cli: "opencode", modelo: "m1", agente_id: "executor-1" } } });
    expect(perfilDaEtapa("runx.e3", { ...f, membro: () => null }).origem).toBe("workspace");
  });
  it("squad do Maestro por cargo só cede lugar à FÁBRICA (a configuração do usuário vence)", () => {
    const squadPorCargo = vi.fn((cargo: string) => ({ agente_id: `m-${cargo}`, perfil: { agente_id: `m-${cargo}`, cli: "opencode", modelo: "sq", esforco: "alto", faixa: "alto" as const, conta_preferida: null, permissao: null } }));
    expect(perfilDaEtapa("runx.e4", { squadPorCargo })).toMatchObject({ origem: "squad", config: { perfil: { agente_id: "m-reviewer" } } });
    expect(perfilDaEtapa("runx.e3", { squadPorCargo, workspace: ws }).origem).toBe("workspace");
    expect(CARGO_POR_TIPO).toEqual({ investigador: "scout", planejador: "orchestrator", implementador: "executor", avaliador: "reviewer" });
  });
  it("resumo do perfil", () => expect(resumoDoPerfil({ cli: "claude", modelo: null, esforco: "alto" })).toBe("claude·padrão·alto"));
});

describe("perfil efetivo pelo harness (Fase 9)", () => {
  const harness = (r: Partial<Awaited<ReturnType<PortaHarnessDeEtapa["resolverPerfilDeEtapa"]>>> = {}): PortaHarnessDeEtapa & { chamadas: unknown[][] } => {
    const chamadas: unknown[][] = [];
    return { chamadas, resolverPerfilDeEtapa: async (...a) => (chamadas.push(a), { ok: true, executor: { provider: "claude", cli: "claude", model: "sonnet", effort: "medium" }, cli: "claude", conta_id: "acc1", faixa: "medio", recibo: "ok", ...r }) };
  };
  it("devolve conta/modelo efetivos e o modo do esforço (flag no Claude)", async () => {
    const h = harness();
    const p = await resolverPerfilEfetivo("runx.e3", configDeFabrica("runx.e3"), h, { workspace_id: "w1", mission_id: null });
    expect(p).toMatchObject({ cli: "claude", modelo: "sonnet", esforco: "medium", esforco_modo: "flag", conta_id: "acc1", faixa: "medio" });
    expect(h.chamadas[0]?.[0]).toBe("runx");
    expect(h.chamadas[0]?.[1]).toBe("e3");
    expect(h.chamadas[0]?.[2]).toMatchObject({ papel: "executor", workspace_id: "w1" });
  });
  it("papel do avaliador é revisor; do investigador, explorador", async () => {
    const h = harness();
    await resolverPerfilEfetivo("runx.e4", configDeFabrica("runx.e4"), h, { workspace_id: "w1", mission_id: null });
    await resolverPerfilEfetivo("runx.e1", configDeFabrica("runx.e1"), h, { workspace_id: "w1", mission_id: null });
    expect(h.chamadas.map((c) => (c[2] as { papel: string }).papel)).toEqual(["revisor", "explorador"]);
  });
  it("sem rota ⇒ PerfilIndisponivelErro (o chamador vira aguardando_usuario)", async () => {
    await expect(resolverPerfilEfetivo("runx.e3", configDeFabrica("runx.e3"), harness({ ok: false, executor: null, recibo: "tudo esgotado" }), { workspace_id: "w1", mission_id: null })).rejects.toBeInstanceOf(PerfilIndisponivelErro);
  });
});

describe("importar/exportar", () => {
  const todas = configsDeFabrica();
  it("round-trip sem perda (marca importado); caminho de exportação dentro da pasta do produto", () => {
    const r = importarPrevia(exportarConfig(todas), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.configs).toHaveLength(todas.length);
      expect(r.configs.map((c) => ({ ...c, atualizado_por: "fabrica" }))).toEqual(todas);
      expect(r.achados.filter((a) => a.severidade === "erro")).toEqual([]);
      expect(r.configs.every((c) => c.atualizado_por === "importado")).toBe(true);
    }
    expect(CAMINHO_DE_EXPORTACAO).toBe(`${PRODUTO.pastaNoProjeto}/pipelines/pipelines.json`);
    expect(CHAVE_DE_VERSAO).toBe(`${PRODUTO.id}_pipelines`);
  });
  it("o exportado não tem caminho absoluto nem segredo", () => {
    const txt = exportarConfig(todas);
    expect(txt).not.toMatch(/\/Users\/|[A-Z]:\\|sk-/);
  });
  const mut = (f: (o: { etapas: Array<Record<string, unknown>> } & Record<string, unknown>) => void): string => {
    const o = JSON.parse(exportarConfig(todas)) as { etapas: Array<Record<string, unknown>> } & Record<string, unknown>;
    f(o);
    return JSON.stringify(o);
  };
  it.each([
    ["campo extra na raiz", mut((o) => { o.extra = 1; }), "extra"],
    ["campo extra na etapa", mut((o) => { (o.etapas[0] as Record<string, unknown>).extra = 1; }), "extra"],
    ["campo extra no perfil", mut((o) => { ((o.etapas[0] as { perfil: Record<string, unknown> }).perfil).extra = 1; }), "extra"],
    ["versão errada", mut((o) => { o[CHAVE_DE_VERSAO] = 99; }), CHAVE_DE_VERSAO],
    ["etapa fora do catálogo", mut((o) => { (o.etapas[0] as Record<string, unknown>).etapa_id = "nao.existe"; }), "etapa_id"],
    ["etapa repetida", mut((o) => { (o.etapas[1] as Record<string, unknown>).etapa_id = (o.etapas[0] as Record<string, unknown>).etapa_id; }), "etapa_id"],
    ["modelo com --flag", mut((o) => { ((o.etapas[0] as { perfil: Record<string, unknown> }).perfil).modelo = "--rm -rf"; }), "modelo"],
    ["modelo com ../", mut((o) => { ((o.etapas[0] as { perfil: Record<string, unknown> }).perfil).modelo = "../../etc/passwd"; }), "modelo"],
    ["modelo com espaço", mut((o) => { ((o.etapas[0] as { perfil: Record<string, unknown> }).perfil).modelo = "a b"; }), "modelo"],
    ["skill com ../", mut((o) => { (o.etapas[0] as Record<string, unknown>).skills = ["../x"]; }), "skills"],
    ["modo inválido", mut((o) => { (o.etapas[0] as Record<string, unknown>).modo_execucao = "rm"; }), "modo_execucao"],
    ["faixa inválida", mut((o) => { ((o.etapas[0] as { perfil: Record<string, unknown> }).perfil).faixa = "ultra"; }), "faixa"],
    ["cli com espaço", mut((o) => { ((o.etapas[0] as { perfil: Record<string, unknown> }).perfil).cli = "claude --x"; }), "cli"],
    ["lista gigante", mut((o) => { o.etapas = Array.from({ length: 101 }, () => ({})); }), "etapas"],
  ])("arquivo hostil: %s ⇒ recusado e nada aplicado", (_n, texto, campo) => {
    const r = importarPrevia(texto, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.erros)).toContain(campo);
  });
  it("JSON inválido, não-objeto e arquivo enorme", () => {
    expect(importarPrevia("{", ctx()).ok).toBe(false);
    expect(importarPrevia("[]", ctx()).ok).toBe(false);
    expect(importarPrevia(" ".repeat(300_000), ctx()).ok).toBe(false);
  });
  it("válida estruturalmente mas com erro de regra: a prévia traz os achados (V1..V9) e nada é aplicado", () => {
    const texto = mut((o) => { ((o.etapas.find((e) => e.etapa_id === "runx.e3") as { perfil: Record<string, unknown> }).perfil).cli = "codex"; });
    const r = importarPrevia(texto, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.achados.some((a) => a.codigo === "V2" && a.severidade === "erro")).toBe(true);
  });
  it("45 etapas em ≤ 50 ms (P-224)", () => {
    const t0 = performance.now();
    const r = importarPrevia(exportarConfig(todas), ctx());
    expect(performance.now() - t0).toBeLessThan(50);
    expect(r.ok).toBe(true);
  });
});
