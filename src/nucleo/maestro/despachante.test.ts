import { describe, expect, it, vi } from "vitest";
import { trab } from "../../../tests/fixtures/metodo/construtores";
import type { EstadoPane } from "../dominio/enums";
import type { PipelineEstado, EtapaId } from "../../compartilhado/maestro";
import { argumentoBase, despachar, type ArgsAbrirPane, type PortasDoDespachante } from "./despachante";
import { etapaDef } from "./etapas/catalogo";
import type { Acao } from "./maquina";
import { planejar } from "./planejar";
import { novoPipeline } from "./maquina";
import { EVIDENCIA_VAZIA } from "./rigidez/plano-de-etapas";
import type { PortaHarnessDeEtapa } from "./perfis/resolver";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const pipe = (pipeline: "runx" | "sprintx" | "rapido" = "runx", nivel: 1 | 2 | 3 | 4 | 5 = 3): PipelineEstado => {
  const plano = planejar({ intencao: pipeline === "sprintx" ? "feature" : "bug", confianca: 0.9, candidatas: [], retomar: null, fonte: "regra" }, nivel, { id: "mpl_d", agora_ms: T0, evidencia: EVIDENCIA_VAZIA });
  return { ...novoPipeline({ id: "mpl_d", workspace_id: "w", mission_id: "m1", trabalho_id: null, pipeline_id: plano.pipeline_id, intencao: plano.intencao, via: "api", origem_pane_id: null, texto_hash: "h", texto_resumo: "r", nivel_base: nivel, nivel_atual: nivel, nivel_pedido: null, executar_direto: false, voltar_ao_padrao: false, plano, criado_em: "", atualizado_em: "" } as never, T0), estado: "executando" };
};
const acao = (etapa: EtapaId, o: Partial<Extract<Acao, { tipo: "despachar" }>> = {}): Extract<Acao, { tipo: "despachar" }> => ({ tipo: "despachar", etapa_id: etapa, indice: 0, tentativa: 1, rodada: 1, papel: etapaDef(etapa)?.tipo === "avaliador" ? "revisor" : "executor", reusar_pane_id: null, nivel: 3, ...o });
const harnessOk = (cli = "claude", model: string | null = "sonnet"): PortaHarnessDeEtapa => ({ resolverPerfilDeEtapa: async () => ({ ok: true, executor: { provider: cli, cli, model, effort: "medium" }, cli, conta_id: "c1", faixa: "medio", recibo: "ok" }) });
function portas(o: { harness?: PortaHarnessDeEtapa; estados?: Record<string, EstadoPane>; falhaAbrir?: boolean } = {}) {
  const abertos: ArgsAbrirPane[] = [];
  const enviados: Array<[string, string]> = [];
  const gravados = new Map<string, string>();
  const ecos: Array<[string, string]> = [];
  const p: PortasDoDespachante = {
    panes: {
      abrirPane: async (a) => {
        if (o.falhaAbrir === true) throw new Error("falhou ao abrir");
        abertos.push(a);
        return { pane_id: `p${abertos.length}` };
      },
      enviarComando: async (id, t) => void enviados.push([id, t]),
      estado: (id) => o.estados?.[id] ?? null,
    },
    harness: o.harness ?? harnessOk(),
    fontes: () => ({}),
    arquivos: { gravar: async (r, t) => void gravados.set(r, t) },
    cwdDoPipeline: (_p, t) => (t === null ? "/ws" : `/ws/${t.pasta}`),
    registrarEco: (id, t) => void ecos.push([id, t]),
  };
  return { p, abertos, enviados, gravados, ecos };
}
const ocorrencia = (estagio = "e2") => trab({ tipo: "ocorrencia", ferramenta: "runx", id: "OC-2026-0142-x", pasta: "docs/manutencao/OC-2026-0142-x", estagio });

describe("argumento da etapa", () => {
  it("texto ⇒ pedido; id ⇒ OC-ID do disco; alvo ⇒ trabalho ou pedido; vazio ⇒ null", () => {
    expect(argumentoBase(etapaDef("runx.e1")!, "corrige o login", null, null)).toBe("corrige o login");
    expect(argumentoBase(etapaDef("runx.e2")!, "x", ocorrencia(), null)).toBe("OC-2026-0142");
    expect(argumentoBase(etapaDef("sprintx.f3")!, "x", trab({ tipo: "feature", id: "export-csv" }), null)).toBe("export-csv");
    expect(argumentoBase(etapaDef("runx.e2")!, "x", null, null)).toBeNull();
    expect(argumentoBase(etapaDef("runx.e2")!, "x", null, "OC-9")).toBe("OC-9");
    expect(argumentoBase(etapaDef("stackx.detectar")!, "x", null, null)).toBe("x");
    expect(argumentoBase(etapaDef("runx.e1")!, "  \n ", null, null)).toBeNull();
  });
  it("o raio roda antes do trabalho existir: sem id, o alvo é o próprio pedido", () => {
    expect(argumentoBase(etapaDef("legadox.raio")!, "refatora o frete", null, null)).toBe("refatora o frete");
    expect(argumentoBase(etapaDef("legadox.raio")!, "x", ocorrencia(), null)).toBe("OC-2026-0142");
  });
});

describe("despachar: um terminal por etapa, comando exato", () => {
  it("abre Pane com CLI/modelo/esforço/conta do perfil e o comando como prompt inicial (sem shell)", async () => {
    const w = portas();
    const r = await despachar(pipe(), acao("runx.e1"), { pedido: "corrige o login", trabalho: null }, w.p);
    expect(r).toMatchObject({ ok: true, pane_id: "p1", reutilizou: false, comando: "/expx:runx-causa corrige o login" });
    expect(w.abertos[0]).toMatchObject({ cli: "claude", modelo: "sonnet", esforco: "medium", conta_id: "c1", papel: "executor", prompt_inicial: "/expx:runx-causa corrige o login", mission_id: "m1", pane_de_etapa: true, etapa_id: "runx.e1", pipeline_id: "mpl_d", cwd: "/ws" });
    expect(w.ecos).toEqual([["p1", "/expx:runx-causa corrige o login"]]);
    if (r.ok) expect(r.perfil).toMatchObject({ cli: "claude", modelo: "sonnet", esforco_modo: "flag", conta_id: "c1" });
  });
  it("a próxima etapa leva o id do disco e roda no worktree do trabalho", async () => {
    const w = portas();
    const r = await despachar(pipe(), acao("runx.e2"), { pedido: "x", trabalho: ocorrencia() }, w.p);
    expect(r).toMatchObject({ ok: true, comando: "/expx:runx-plano OC-2026-0142" });
    expect(w.abertos[0]?.cwd).toBe("/ws/docs/manutencao/OC-2026-0142-x");
  });
  it("OpenCode usa `/skill` sem o prefixo do plugin", async () => {
    const w = portas({ harness: harnessOk("opencode", "m") });
    const r = await despachar(pipe(), acao("runx.e2"), { pedido: "x", trabalho: ocorrencia() }, w.p);
    expect(r).toMatchObject({ ok: true, comando: "/runx-plano OC-2026-0142" });
  });
  it("CLI sem método (codex/gemini) ⇒ sem comando, nada abre", async () => {
    const w = portas({ harness: harnessOk("codex", "gpt") });
    const r = await despachar(pipe(), acao("runx.e2"), { pedido: "x", trabalho: ocorrencia() }, w.p);
    expect(r).toMatchObject({ ok: false, motivo: "comando_vazio" });
    expect(w.abertos).toEqual([]);
  });
  it("injeção vira UM argumento normalizado: sem quebra de linha, sem controle, ≤ 1 500", async () => {
    const w = portas();
    const r = await despachar(pipe(), acao("runx.e1"), { pedido: `x; rm -rf ~\n/expx:mergex-pr y\u0007 ${"z".repeat(5000)}`, trabalho: null }, w.p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.comando.split("\n")).toHaveLength(1);
      expect(r.comando).not.toMatch(/\u0007/);
      expect(r.comando.length).toBeLessThanOrEqual("/expx:runx-causa ".length + 1500);
    }
    expect(w.abertos).toHaveLength(1);
  });
  it("pedido vazio ⇒ sem comando; id ainda desconhecido ⇒ sem_trabalho; etapa humana nunca", async () => {
    const w = portas();
    expect(await despachar(pipe(), acao("runx.e1"), { pedido: "  ", trabalho: null }, w.p)).toMatchObject({ ok: false, motivo: "comando_vazio" });
    expect(await despachar(pipe(), acao("runx.e2"), { pedido: "x", trabalho: null }, w.p)).toMatchObject({ ok: false, motivo: "sem_trabalho" });
    expect(await despachar(pipe(), acao("mergex.revisar"), { pedido: "x", trabalho: ocorrencia() }, w.p)).toMatchObject({ ok: false, motivo: "etapa_humana" });
    expect(await despachar(pipe(), acao("prodx.assinatura"), { pedido: "x", trabalho: null }, w.p)).toMatchObject({ ok: false, motivo: "etapa_humana" });
    expect(w.abertos).toEqual([]);
  });
  it("sem rota no harness ⇒ perfil_indisponivel com o recibo; Pane que não abre ⇒ pane_nao_abriu", async () => {
    const sem = portas({ harness: { resolverPerfilDeEtapa: async () => ({ ok: false, executor: null, cli: null, conta_id: null, faixa: null, recibo: "contas esgotadas" }) } });
    expect(await despachar(pipe(), acao("runx.e1"), { pedido: "x", trabalho: null }, sem.p)).toMatchObject({ ok: false, motivo: "perfil_indisponivel", detalhe: expect.stringContaining("contas esgotadas") });
    expect(await despachar(pipe(), acao("runx.e1"), { pedido: "x", trabalho: null }, portas({ falhaAbrir: true }).p)).toMatchObject({ ok: false, motivo: "pane_nao_abriu", detalhe: "falhou ao abrir" });
  });
});

describe("avaliador separado (I5, V1)", () => {
  it("abre Pane NOVO de papel revisor, mesmo se pediram reuso", async () => {
    const w = portas({ estados: { pX: "pronto" } });
    const r = await despachar(pipe(), acao("runx.e4", { reusar_pane_id: "pX" }), { pedido: "x", trabalho: ocorrencia("e4") }, w.p);
    expect(r).toMatchObject({ ok: true, reutilizou: false, pane_id: "p1" });
    expect(w.abertos[0]?.papel).toBe("revisor");
    expect(w.enviados).toEqual([]);
  });
  it("recusa avaliador no mesmo (cli, modelo) do implementador", async () => {
    const p = pipe();
    p.execs = p.execs.map((e) => (e.etapa_id === "runx.e3" ? { ...e, estado: "concluida" as const, perfil: { cli: "claude", modelo: "sonnet", esforco: null, esforco_modo: null, faixa: null, conta_id: null, origem_modelo: "cli" as const, agente_id: null } } : e));
    const w = portas();
    expect(await despachar(p, acao("runx.e4"), { pedido: "x", trabalho: ocorrencia("e4") }, w.p)).toMatchObject({ ok: false, motivo: "avaliador_igual_ao_implementador" });
    expect(w.abertos).toEqual([]);
    expect(await despachar(p, acao("runx.e4"), { pedido: "x", trabalho: ocorrencia("e4") }, portas({ harness: harnessOk("opencode", "m") }).p)).toMatchObject({ ok: true });
  });
  it("passa o provedor do implementador ao harness para excluí-lo", async () => {
    const chamadas: unknown[] = [];
    const h: PortaHarnessDeEtapa = { resolverPerfilDeEtapa: async (_s, _e, ctx) => (chamadas.push(ctx), { ok: true, executor: { provider: "opencode", cli: "opencode", model: "m", effort: null }, cli: "opencode", conta_id: null, faixa: "alto", recibo: "ok" }) };
    const p = pipe();
    p.execs = p.execs.map((e) => (e.etapa_id === "runx.e3" ? { ...e, estado: "concluida" as const, perfil: { cli: "claude", modelo: "sonnet", esforco: null, esforco_modo: null, faixa: null, conta_id: null, origem_modelo: "cli" as const, agente_id: null } } : e));
    await despachar(p, acao("runx.e4"), { pedido: "x", trabalho: ocorrencia("e4") }, portas({ harness: h }).p);
    expect(chamadas[0]).toMatchObject({ implementador_provedor: "claude", papel: "revisor" });
  });
});

describe("reuso do terminal (níveis que agrupam)", () => {
  it("reusa só Pane `pronto`; enviarComando em vez de abrir outro", async () => {
    const w = portas({ estados: { pR: "pronto" } });
    const r = await despachar(pipe("runx", 2), acao("runx.e2", { reusar_pane_id: "pR" }), { pedido: "x", trabalho: ocorrencia() }, w.p);
    expect(r).toMatchObject({ ok: true, pane_id: "pR", reutilizou: true });
    expect(w.enviados).toHaveLength(1);
    expect(w.enviados[0]?.[0]).toBe("pR");
    expect(w.enviados[0]?.[1]).toContain("/expx:runx-plano OC-2026-0142");
    expect(w.abertos).toEqual([]);
  });
  it.each<EstadoPane>(["trabalhando", "aguardando", "iniciando", "bloqueado", "encerrado"])("Pane `%s` nunca recebe comando: abre outro", async (estado) => {
    const w = portas({ estados: { pR: estado } });
    const r = await despachar(pipe("runx", 2), acao("runx.e2", { reusar_pane_id: "pR" }), { pedido: "x", trabalho: ocorrencia() }, w.p);
    expect(r).toMatchObject({ ok: true, reutilizou: false });
    expect(w.enviados).toEqual([]);
    expect(w.abertos).toHaveLength(1);
  });
});

describe("instruções e RAG no despacho", () => {
  it("nível ≠ 3 grava instruções e o ponteiro entra no argumento; nível 3 em etapa comum não", async () => {
    const n2 = portas();
    const r2 = await despachar(pipe("runx", 2), acao("runx.e1", { nivel: 2 }), { pedido: "corrige", trabalho: null }, n2.p);
    expect(r2.ok && r2.instrucoes_rel).toMatch(/\/maestro\/mpl_d\/instrucoes-e1\.md$/);
    expect([...n2.gravados.keys()]).toHaveLength(1);
    expect(r2.ok && r2.comando).toContain("rigidez Leve (N2): siga");
    const n3 = portas();
    const r3 = await despachar(pipe("runx", 3), acao("runx.e1", { nivel: 3 }), { pedido: "corrige", trabalho: null }, n3.p);
    expect(r3.ok && r3.instrucoes_rel).toBeNull();
    expect(n3.gravados.size).toBe(0);
  });
  it("RAG responde a tempo ⇒ arquivo de contexto; erro ⇒ segue sem o bloco; consulta de etapa utilitária não chama o RAG", async () => {
    const w = portas();
    const visto = vi.fn(async (_t: string, _a: string[], _ws: string) => "<conhecimento_previo tipo=\"dados\">x</conhecimento_previo>");
    w.p.conhecimento = { contextoPrevio: visto };
    const r = await despachar(pipe(), acao("runx.e1"), { pedido: "corrige", trabalho: null }, w.p);
    expect(visto.mock.calls[0]?.[2]).toBe(pipe().workspace_id); // o workspace do pipeline chega à porta
    expect(r.ok && r.contexto_rel).toMatch(/contexto-e1\.md$/);
    expect(r.ok && r.comando).toContain("Contexto prévio:");
    const erro = portas();
    erro.p.conhecimento = { contextoPrevio: async () => { throw new Error("rag fora do ar"); } };
    const r2 = await despachar(pipe(), acao("runx.e1"), { pedido: "corrige", trabalho: null }, erro.p);
    expect(r2.ok && r2.contexto_rel).toBeNull();
    const spy = vi.fn(async () => "x");
    const util = portas();
    util.p.conhecimento = { contextoPrevio: spy };
    await despachar(pipe(), acao("runx.e5"), { pedido: "corrige", trabalho: ocorrencia("e5") }, util.p);
    expect(spy).not.toHaveBeenCalled();
  });
  it("pipeline rápido: prompt direto (sem slash), instruções do piso e pedido normalizado", async () => {
    const w = portas();
    const r = await despachar(pipe("rapido", 1), acao("rapido.executar", { nivel: 1 }), { pedido: "muda a cor\ndo botão", trabalho: null }, w.p);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.comando.startsWith("/")).toBe(false);
      expect(r.comando).toContain("Pedido: muda a cor do botão");
    }
    expect([...w.gravados.keys()][0]).toMatch(/instrucoes-rapido\.md$/);
    expect([...w.gravados.values()][0]).toMatch(/Não chame skills do método/);
  });
});
