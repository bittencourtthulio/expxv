// T-09.16 · perfil do harness: porta real da Fase 14, etapas do Maestro e perfis prontos (P-311).
import { describe, expect, it } from "vitest";
import type { Membro } from "../../compartilhado/squads";
import { CliDesconhecidaErro, resolverEMontarComando, type PerfilCompleto, type PortaResolverPerfil, type RenderizadorDoPrompt } from "../squads/perfil";
import type { ExtraConta } from "../../../tests/fixtures/harness/construtores";
import { WS, config, deps } from "../../../tests/fixtures/harness/rotas";
import {
  aplicarPerfilPronto, criarResolvedorHarness, editarPerfilPronto, ETAPAS_PADRAO, etapaParaTipo, ID_ECONOMICO, ID_EQUILIBRADO, ID_MAXIMA_QUALIDADE, paraResultadoDeRota,
  perfisProntosDeFabrica, RotaIndisponivelErro, validarPerfilPronto, type EtapaAplicavel, type ResolvedorHarness,
} from "./perfil";
import type { DepsRoteador } from "./roteador";
import { FAIXA_PADRAO_POR_TASK_TYPE } from "./task-types";

const EXAUSTA: ExtraConta = { w: [["five_hour", 100, 3]] };
const FRIA = (u = 10): ExtraConta => ({ w: [["five_hour", u, 4]] });
const MUNDO: Array<[string, string, ExtraConta?]> = [["c1", "claude", FRIA()], ["x1", "codex", FRIA(20)], ["g1", "gemini", FRIA(30)]];
const CLAUDE_ESTOURADO: Array<[string, string, ExtraConta?]> = [["c1", "claude", EXAUSTA], ["x1", "codex", FRIA(20)], ["g1", "gemini", FRIA(30)]];
const resolvedor = (spec = MUNDO, sobre: Partial<DepsRoteador> = {}): ResolvedorHarness => criarResolvedorHarness({ contexto: () => deps(spec, sobre), ambienteDaConta: (id) => ({ CONTA: id }) });
const perfil = (p: Partial<PerfilCompleto> = {}): PerfilCompleto => ({ agente_id: "s.dev", cli: "claude", modelo: "opus", esforco: "alto", faixa: "topo", conta_preferida: null, permissao: null, ...p });
const ctx = { workspace_id: WS, papel: "executor" as const, mission_id: null };

describe("resolverPerfil = implementação real da PortaResolverPerfil", () => {
  it("satisfaz a interface da Fase 14 e devolve conta/modelo/cli/motivo/ambiente", async () => {
    const porta: PortaResolverPerfil = resolvedor();
    const r = await porta.resolverPerfil(perfil(), ctx);
    expect(r).toMatchObject({ cli: "claude", modelo: "opus", conta: "c1", ambiente: { CONTA: "c1" } });
    expect(r.motivo).toMatch(/Mantido claude\/opus/);
    expect(r).toMatchObject({ requer_aprovacao: false, aplicada: true, faixa: "topo", esforco: "alto" });
  });
  it("modo automático: perfil topo com conta estourada → topo de OUTRO provedor, aplicado", async () => {
    const r = await resolvedor(CLAUDE_ESTOURADO, { config: config({ modo_troca: "automatico" }) }).resolverPerfil(perfil(), ctx);
    expect(r.cli).not.toBe("claude");
    expect(r).toMatchObject({ requer_aprovacao: false, aplicada: true, faixa: "topo" });
  });
  it("modo só sugerir: devolve a sugestão marcada requer_aprovacao (nunca troca sozinho)", async () => {
    const r = await resolvedor(CLAUDE_ESTOURADO, { config: config({ modo_troca: "so_sugerir" }) }).resolverPerfil(perfil(), ctx);
    expect(r).toMatchObject({ requer_aprovacao: true, aplicada: false });
    expect(r.cli).not.toBe("claude");
  });
  it("modo manual: NUNCA troca (erro nominal com a sugestão separada); perfil saudável segue igual", async () => {
    const manual = { config: config({ modo_troca: "manual" as const }) };
    const erro = await resolvedor(CLAUDE_ESTOURADO, manual).resolverPerfil(perfil(), ctx).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(RotaIndisponivelErro);
    expect((erro as RotaIndisponivelErro).codigo).toBe("no_capacity");
    expect((erro as RotaIndisponivelErro).rota.sugestao).not.toBeNull();
    expect(await resolvedor(MUNDO, manual).resolverPerfil(perfil(), ctx)).toMatchObject({ cli: "claude", modelo: "opus", conta: "c1" });
  });
  it("CLI inexistente → CliDesconhecidaErro; nada em lugar nenhum → RotaIndisponivelErro; esforço 'rápido' não sobe de faixa", async () => {
    await expect(resolvedor().resolverPerfil(perfil({ cli: "nao-existe" }), ctx)).rejects.toBeInstanceOf(CliDesconhecidaErro);
    await expect(resolvedor([["c1", "claude", EXAUSTA]]).resolverPerfil(perfil(), ctx)).rejects.toBeInstanceOf(RotaIndisponivelErro);
    const r = await resolvedor(CLAUDE_ESTOURADO).resolverPerfil(perfil({ modelo: "haiku", faixa: "rapido" }), ctx);
    expect(r.faixa).toBe("rapido");
  });
  it("CLI auto: a faixa escolhe o provedor pela política; conta preferida respeitada; `excluir` vale para provedor e conta", async () => {
    const auto = await resolvedor().resolverPerfil(perfil({ cli: "auto", modelo: null, faixa: "alto" }), ctx);
    expect(auto).toMatchObject({ cli: "claude", modelo: "sonnet", faixa: "alto" });
    const pref = await resolvedor([["c1", "claude", FRIA(5)], ["c2", "claude", FRIA(40)]]).resolverPerfil(perfil({ conta_preferida: "c2" }), ctx);
    expect(pref.conta).toBe("c2");
    const exc = await resolvedor().resolverPerfil(perfil({ cli: "auto", modelo: null, faixa: "alto" }), { ...ctx, excluir: ["claude"] });
    expect(exc.cli).not.toBe("claude");
  });
  it("papel revisor com implementador conhecido: provedor DIFERENTE do implementador quando há ≥ 2 viáveis (D-21)", async () => {
    const ctxRev = { ...ctx, papel: "revisor" as const, implementador_provedor: "claude" };
    const r = await resolvedor().resolverPerfil(perfil({ cli: "auto", modelo: null, faixa: "topo" }), ctxRev);
    expect(r.cli).not.toBe("claude");
    const so = await resolvedor([["c1", "claude", FRIA()]]).resolverPerfil(perfil({ cli: "auto", modelo: null, faixa: "topo" }), ctxRev);
    expect(so.cli).toBe("claude");
  });
  it("integra com resolverEMontarComando da Fase 14 (conta e CLI resolvidas viram ambiente e ferramenta)", async () => {
    const membro: Membro = {
      slug: "dev", papel: "executor", rotulo: "Dev", descricao: "d", prompt: "membros/dev.md", perfil: { cli: "claude", modelo: "opus", esforco: "alto", faixa: "topo" },
      skills_permitidas: [], mcps_permitidos: [], hooks: [], max_instancias: 1, orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null,
    };
    const renderizador: RenderizadorDoPrompt = { renderizar: () => "PROMPT" };
    const c = await resolverEMontarComando(resolvedor(CLAUDE_ESTOURADO, { config: config({ modo_troca: "automatico" }) }), membro, {
      squad_slug: "s", executavel: "/x/cli", permissao_workspace: "seguro", rigidez: 3, renderizador, workspace_id: WS,
    });
    expect(c.ferramenta).not.toBe("claude");
    expect(c.ambiente).toMatchObject({ CONTA: expect.stringMatching(/^(x1|g1)$/) });
    expect(c.perfil_efetivo.conta_id).toMatch(/^(x1|g1)$/);
  });
});

describe("resolverPerfilDeEtapa (Maestro)", () => {
  it("(skill, etapa) → tipo: sprintx F1 planejar, F5 auditar avaliador, F6 implementar; runx E3 bug-fix, E4 qa avaliador; desconhecida → geral", () => {
    const t = (s: string, e: string) => etapaParaTipo(s, e);
    expect(t("sprintx", "F1")).toEqual({ task_type: "planejar", avaliador: false });
    expect(t("expx:sprintx", "f5")).toEqual({ task_type: "auditar", avaliador: true });
    expect(t("sprintx", "F6").task_type).toBe("implementar");
    expect(t("runx", "E1").task_type).toBe("bug-profundo");
    expect(t("runx", "E3").task_type).toBe("bug-fix");
    expect(t("runx", "E4")).toEqual({ task_type: "qa", avaliador: true });
    expect(t("prodx", "P0").task_type).toBe("triar");
    expect(t("mergex", "E3")).toEqual({ task_type: "revisar-pr", avaliador: true });
    expect(t("buildx", "x").task_type).toBe("planejar");
    expect(t("designx", "x").task_type).toBe("front");
    expect(t("stackx", "x").task_type).toBe("descobrir");
    expect(t("legadox", "x").task_type).toBe("descobrir");
    expect(t("memox", "x").task_type).toBe("docs");
    expect(t("sprintx-auditoria", "qualquer")).toEqual({ task_type: "auditar", avaliador: true });
    expect(t("desconhecida", "Z9")).toEqual({ task_type: "geral", avaliador: false });
    expect(Object.keys(ETAPAS_PADRAO).length).toBeGreaterThan(15);
  });
  it("roteia pelo tipo da etapa; o avaliador exclui o provedor do implementador; não cria Pane", async () => {
    const r = resolvedor();
    const f1 = await r.resolverPerfilDeEtapa("sprintx", "F1", ctx);
    expect(f1).toMatchObject({ ok: true, task_type: "planejar", avaliador: false, skill: "sprintx", etapa: "F1" });
    expect(f1.executor?.faixa).toBe("topo");
    const f5 = await r.resolverPerfilDeEtapa("sprintx", "F5", { ...ctx, implementador_provedor: "claude" });
    expect(f5).toMatchObject({ ok: true, task_type: "auditar", avaliador: true });
    expect(f5.executor?.provider).not.toBe("claude");
    const so = await resolvedor([["c1", "claude", FRIA()]]).resolverPerfilDeEtapa("sprintx", "F5", { ...ctx, implementador_provedor: "claude" });
    expect(so.executor?.provider).toBe("claude");
  });
  it("etapa sem capacidade devolve ok:false (sem lançar) e o contrato ResultadoDeRota só existe quando há rota", async () => {
    const r = await resolvedor([["c1", "claude", EXAUSTA]]).resolverPerfilDeEtapa("runx", "E3", ctx);
    expect(r).toMatchObject({ ok: false, erro: "no_capacity" });
    expect(paraResultadoDeRota(r)).toBeNull();
    const ok = paraResultadoDeRota(await resolvedor().resolverPerfilDeEtapa("runx", "E3", ctx));
    expect(ok).toMatchObject({ task_type: "bug-fix", skills_aplicadas: false });
    expect(ok?.executor.faixa).toBe("medio");
  });
  it("perfil explícito na etapa passa pelo modo de troca do workspace", async () => {
    const so = await resolvedor(CLAUDE_ESTOURADO, { config: config({ modo_troca: "so_sugerir" }) }).resolverPerfilDeEtapa("sprintx", "F6", ctx, perfil());
    expect(so).toMatchObject({ ok: true, requer_aprovacao: true, aplicada: false });
  });
});

describe("perfis prontos (P-311): dados editáveis aplicáveis em lote", () => {
  type Etapa = EtapaAplicavel & { id: string; agente_id: string | null; conta_preferida: string | null; permissao: string | null; extra: { nota: string } };
  const etapas = (): Etapa[] => [
    { id: "a", skill: "sprintx", etapa: "F1", perfil: { cli: "claude", modelo: "opus", esforco: "alto", faixa: "topo" }, agente_id: "s.arq", conta_preferida: "c9", permissao: "seguro", extra: { nota: "x" } },
    { id: "b", skill: "sprintx", etapa: "F6", perfil: { cli: "codex", modelo: null, esforco: null, faixa: "alto" }, agente_id: null, conta_preferida: null, permissao: null, extra: { nota: "y" } },
    { id: "c", skill: "prodx", etapa: "P0", perfil: { cli: "auto", modelo: "haiku", esforco: "baixo", faixa: "rapido" }, agente_id: "s.t", conta_preferida: null, permissao: "equilibrado", extra: { nota: "z" } },
    { id: "d", task_type: "qa", perfil: { cli: "gemini", modelo: "x", esforco: "medio", faixa: "medio" }, agente_id: null, conta_preferida: null, permissao: null, extra: { nota: "w" } },
  ];
  const por = (id: string) => perfisProntosDeFabrica().find((p) => p.id === id)!;

  it("há exatamente três perfis nomeados e todos validam", () => {
    const f = perfisProntosDeFabrica();
    expect(f.map((p) => p.nome)).toEqual(["Econômico", "Equilibrado", "Máxima qualidade"]);
    expect(f.map((p) => p.id)).toEqual([ID_ECONOMICO, ID_EQUILIBRADO, ID_MAXIMA_QUALIDADE]);
    for (const p of f) expect(validarPerfilPronto(p).ok).toBe(true);
  });
  it("Equilibrado = faixas de fábrica; Econômico ≤ Equilibrado ≤ Máxima em TODOS os tipos (ordem das faixas)", () => {
    const ordem = ["topo", "alto", "medio", "rapido"];
    const [eco, eq, max] = [por(ID_ECONOMICO), por(ID_EQUILIBRADO), por(ID_MAXIMA_QUALIDADE)];
    expect(eq.faixas).toEqual(FAIXA_PADRAO_POR_TASK_TYPE);
    for (const t of Object.keys(FAIXA_PADRAO_POR_TASK_TYPE)) {
      expect(ordem.indexOf(eco.faixas[t]!)).toBeGreaterThanOrEqual(ordem.indexOf(eq.faixas[t]!));
      expect(ordem.indexOf(max.faixas[t]!)).toBeLessThanOrEqual(ordem.indexOf(eq.faixas[t]!));
    }
    expect(eco.faixas["planejar"]).toBe("alto");
    expect(max.faixas["implementar"]).toBe("topo");
    expect(max.faixas["planejar"]).toBe("topo");
  });
  it("aplica em lote SEM perder campos e sem mutar a entrada; só cli/modelo/esforco/faixa do perfil mudam", () => {
    const antes = etapas();
    const congelado = JSON.stringify(antes);
    const depois = aplicarPerfilPronto(por(ID_ECONOMICO), antes);
    expect(JSON.stringify(antes)).toBe(congelado);
    expect(depois).toHaveLength(4);
    for (const [i, d] of depois.entries()) {
      const o = antes[i]!;
      expect({ ...d, perfil: undefined }).toEqual({ ...o, perfil: undefined });
      expect(d.perfil.cli).toBe(o.perfil.cli);
      expect(d.perfil.modelo).toBeNull();
    }
    expect(depois.map((d) => d.perfil.faixa)).toEqual(["alto", "medio", "rapido", "rapido"]);
    expect(depois.map((d) => d.perfil.esforco)).toEqual(["baixo", "baixo", "minimo", "minimo"]);
    expect(depois[0]).not.toBe(antes[0]);
  });
  it("Máxima qualidade e Equilibrado; opção cli:auto e esforco:false", () => {
    expect(aplicarPerfilPronto(por(ID_MAXIMA_QUALIDADE), etapas()).map((d) => d.perfil.faixa)).toEqual(["topo", "topo", "medio", "alto"]);
    expect(aplicarPerfilPronto(por(ID_EQUILIBRADO), etapas()).map((d) => d.perfil.faixa)).toEqual(["topo", "alto", "rapido", "medio"]);
    const auto = aplicarPerfilPronto(por(ID_EQUILIBRADO), etapas(), { cli: "auto", esforco: false });
    expect(auto.map((d) => d.perfil.cli)).toEqual(["auto", "auto", "auto", "auto"]);
    expect(auto.map((d) => d.perfil.esforco)).toEqual(["alto", null, "baixo", "medio"]);
    expect(aplicarPerfilPronto(por(ID_EQUILIBRADO), [])).toEqual([]);
  });
  it("etapa sem tipo conhecido usa `geral`; tipo desconhecido do perfil usa a faixa padrão do perfil", () => {
    const [x] = aplicarPerfilPronto(por(ID_ECONOMICO), [{ perfil: { cli: "claude", modelo: null, esforco: null, faixa: "topo" } }]);
    expect(x?.perfil.faixa).toBe("medio");
    const [y] = aplicarPerfilPronto(por(ID_ECONOMICO), [{ task_type: "tipo-novo", perfil: { cli: "claude", modelo: null, esforco: null, faixa: "topo" } }]);
    expect(y?.perfil.faixa).toBe("medio");
  });
  it("editável: edição funde faixas/esforço e valida; fábrica intacta; entrada inválida vira erro por campo", () => {
    const eco = por(ID_ECONOMICO);
    const ed = editarPerfilPronto(eco, { nome: "Barato", faixas: { implementar: "topo" }, esforco_por_faixa: { topo: "maximo" } });
    expect(ed.ok).toBe(true);
    if (ed.ok) {
      expect(ed.valor).toMatchObject({ id: ID_ECONOMICO, nome: "Barato" });
      expect(ed.valor.faixas["implementar"]).toBe("topo");
      expect(ed.valor.faixas["planejar"]).toBe("alto");
      expect(aplicarPerfilPronto(ed.valor, etapas())[1]?.perfil.faixa).toBe("topo");
    }
    expect(perfisProntosDeFabrica()[0]!.faixas["implementar"]).toBe("medio");
    const ruim = validarPerfilPronto({ id: "Ruim Id", nome: "", descricao: "", faixa_padrao: "ultra", faixas: { x: "nada" }, esforco_por_faixa: { topo: "gigante" }, extra: 1 });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(ruim.erros.map((e) => e.campo).sort()).toEqual(["esforco_por_faixa.topo", "extra", "faixa_padrao", "faixas.x", "id", "nome"].sort());
    expect(validarPerfilPronto(null).ok).toBe(false);
  });
});
