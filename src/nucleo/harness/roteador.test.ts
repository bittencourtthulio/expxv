// T-09.15 · roteador: tabelas de decisão (política global × workspace, modos de troca, pin, exaustão, recibo sem segredo).
import { describe, expect, it } from "vitest";
import type { DecisaoEntrada } from "../../compartilhado/harness";
import { AGORA, prng, type ExtraConta } from "../../../tests/fixtures/harness/construtores";
import { WS, config, deps, politicaDoWorkspace, politicasGlobais } from "../../../tests/fixtures/harness/rotas";
import { rotear, type PedidoRoteador } from "./roteador";

const EXAUSTA: ExtraConta = { w: [["five_hour", 100, 3]] };
const QUENTE: ExtraConta = { w: [["five_hour", 92, 3]] };
const FRIA = (u = 10): ExtraConta => ({ w: [["five_hour", u, 4]] });
const MUNDO3: Array<[string, string, ExtraConta?]> = [["c1", "claude", FRIA()], ["x1", "codex", FRIA(20)], ["g1", "gemini", FRIA(30)]];
const ped = (sobre: Partial<PedidoRoteador> = {}): PedidoRoteador => ({ taskType: "implementar", workspace: WS, ...sobre });

describe("política por task_type (global × workspace)", () => {
  it("usa a política global: implementar → faixa alto, provedor preferido, recibo e fonte", () => {
    const r = rotear(ped(), deps(MUNDO3));
    expect(r.ok).toBe(true);
    expect(r.executor).toMatchObject({ provider: "claude", model: "sonnet", faixa: "alto" });
    expect(r.conta_id).toBe("c1");
    expect(r.fontes).toEqual({ task_type: "explicito", executor: "politica", conta: "regra" });
    expect(r.recibo).toMatch(/Mantido claude\/sonnet/);
    expect(r.aplicada).toBe(true);
    expect(r.requer_aprovacao).toBe(false);
  });
  it("a política do workspace vence a global; desabilitada herda a global", () => {
    const g = politicasGlobais();
    const base = g.find((p) => p.task_type === "implementar")!;
    const porWs = politicaDoWorkspace(base, { executor: { provider: "codex", cli: "codex", model: null, effort: null, faixa: "alto" }, alternativas: [] });
    const r = rotear(ped(), deps(MUNDO3, { politica: { globais: g, doWorkspace: [porWs] } }));
    expect(r.executor?.provider).toBe("codex");
    expect(r.conta_id).toBe("x1");
    const off = rotear(ped(), deps(MUNDO3, { politica: { globais: g, doWorkspace: [{ ...porWs, habilitada: false }] } }));
    expect(off.executor?.provider).toBe("claude");
  });
  it("política com provedor depois desabilitado resolve pelo fallback; skills da política vão na rota", () => {
    const g = politicasGlobais().map((p) => (p.task_type === "implementar" ? { ...p, skills: ["sprintx"] } : p));
    const r = rotear(ped(), deps(MUNDO3, { politica: { globais: g, doWorkspace: [] }, provedoresViaveis: ["codex", "gemini"] }));
    expect(r.ok).toBe(true);
    expect(r.executor?.provider).not.toBe("claude");
    expect(r.skills).toEqual(["sprintx"]);
    expect(r.skills_aplicadas).toBe(false);
  });
  it("sem nenhuma política para o tipo: usa a faixa padrão do tipo, com aviso", () => {
    const r = rotear(ped(), deps(MUNDO3, { politica: { globais: [], doWorkspace: [] } }));
    expect(r.ok).toBe(true);
    expect(r.executor?.faixa).toBe("alto");
    expect(r.avisos.join(" ")).toMatch(/sem_politica/);
  });
  it("task_type: nulo → classificador injetado (regra) ou geral (fallback com aviso); desconhecido → erro nominal", () => {
    const c = rotear(ped({ taskType: null, descricao: "arrumar botão" }), deps(MUNDO3, { classificar: () => ({ task_type: "front", confianca: 0.8 }) }));
    expect(c.task_type).toBe("front");
    expect(c.fontes.task_type).toBe("regra");
    const g = rotear(ped({ taskType: null }), deps(MUNDO3));
    expect(g.task_type).toBe("geral");
    expect(g.fontes.task_type).toBe("fallback");
    expect(g.avisos.join(" ")).toMatch(/task_type_nao_identificado/);
    const u = rotear(ped({ taskType: "inexistente" }), deps(MUNDO3, { taskTypes: new Set(["implementar", "geral"]) }));
    expect(u).toMatchObject({ ok: false, erro: "unknown_task_type" });
  });
});

describe("capacidade, pin e exaustão", () => {
  it("provedor da política esgotado → mesmo nível de faixa em outro provedor", () => {
    const r = rotear(ped(), deps([["c1", "claude", EXAUSTA], ["x1", "codex", FRIA(20)], ["g1", "gemini", FRIA(30)]]));
    expect(r.ok).toBe(true);
    expect(r.executor?.provider).toBe("codex");
    expect(r.conta_id).toBe("x1");
    expect(r.fontes.executor).toBe("fallback");
  });
  it("pin do workspace é DURO: pinada exaurida → passa ao próximo executor, nunca a outra conta do mesmo provedor", () => {
    const g = politicasGlobais();
    const base = g.find((p) => p.task_type === "implementar")!;
    const porWs = politicaDoWorkspace(base, { conta_fixa_id: "c2" });
    const r = rotear(ped(), deps([["c1", "claude", FRIA(5)], ["c2", "claude", EXAUSTA], ["x1", "codex", FRIA(20)]], { politica: { globais: g, doWorkspace: [porWs] } }));
    expect(r.executor?.provider).toBe("codex");
    expect(r.conta_id).toBe("x1");
    const viva = rotear(ped(), deps([["c1", "claude", FRIA(5)], ["c2", "claude", FRIA(50)]], { politica: { globais: g, doWorkspace: [porWs] } }));
    expect(viva.conta_id).toBe("c2");
  });
  it("conta pinada em OUTRO workspace é descartada; a pinada neste workspace manda", () => {
    const outra = rotear(ped(), deps([["c1", "claude", { ...FRIA(1), fixadaEm: ["wsX"] }], ["c2", "claude", FRIA(50)]]));
    expect(outra.conta_id).toBe("c2");
    const minha = rotear(ped(), deps([["c1", "claude", { ...FRIA(1), fixadaEm: [WS] }], ["c2", "claude", FRIA(0)]]));
    expect(minha.conta_id).toBe("c1");
  });
  it("sem capacidade em lugar nenhum: ok:false, no_capacity, sem conta e com recibo", () => {
    const r = rotear(ped(), deps([["c1", "claude", EXAUSTA], ["x1", "codex", EXAUSTA], ["g1", "gemini", { hab: false }]]));
    expect(r).toMatchObject({ ok: false, erro: "no_capacity", conta_id: null, executor: null, aplicada: false });
    expect(r.recibo.length).toBeGreaterThan(5);
  });
  it("propriedade: em 300 mundos aleatórios NENHUM caminho devolve conta exaurida, desabilitada, em cooldown ou de outro pin", () => {
    const rnd = prng(2026);
    const pedidos: PedidoRoteador[] = [
      ped(),
      ped({ perfil: { cli: "claude", modelo: "opus", esforco: null, faixa: "topo" } }),
      ped({ perfil: { cli: "auto", modelo: null, esforco: null, faixa: "alto" } }),
      ped({ explicito: { provider: "codex" } }),
    ];
    for (let n = 0; n < 300; n++) {
      const spec: Array<[string, string, ExtraConta]> = [];
      const ruins = new Set<string>();
      for (const prov of ["claude", "codex", "gemini"]) {
        for (let i = 0; i < 3; i++) {
          const id = `${prov}${i}`;
          const u = Math.round(rnd() * 110);
          const x: ExtraConta = { w: [["five_hour", u, 1 + rnd() * 4]] };
          if (rnd() < 0.2) x.hab = false;
          if (rnd() < 0.15) x.cooldownH = 2;
          if (rnd() < 0.1) x.fixadaEm = ["wsX"];
          if (rnd() < 0.1) x.auth = "expirada";
          if (u >= 100 || x.hab === false || x.cooldownH !== undefined || x.fixadaEm !== undefined || x.auth === "expirada") ruins.add(id);
          spec.push([id, prov, x]);
        }
      }
      for (const modo of ["automatico", "so_sugerir", "manual"] as const) {
        for (const p of pedidos) {
          const r = rotear(p, deps(spec, { config: config({ modo_troca: modo, faixa_minima_troca: "qualquer" }) }));
          if (r.conta_id !== null) expect(ruins.has(r.conta_id), `${modo} ${JSON.stringify(p)} → ${r.conta_id}`).toBe(false);
          if (r.sugestao) expect(ruins.has(r.sugestao.conta_id)).toBe(false);
        }
      }
    }
  });
});

describe("explícito, CLI preferida e conta preferida", () => {
  it("explicito.provider vence a política e só resolve a conta; rota 'nenhuma' sem provedor é erro nominal", () => {
    const r = rotear(ped({ explicito: { provider: "gemini" } }), deps(MUNDO3));
    expect(r).toMatchObject({ ok: true, conta_id: "g1" });
    expect(r.fontes.executor).toBe("explicito");
    expect(rotear(ped({ modoRota: "nenhuma" }), deps(MUNDO3))).toMatchObject({ ok: false, erro: "provider_unavailable" });
    expect(rotear(ped({ explicito: { provider: "aider" } }), deps(MUNDO3))).toMatchObject({ ok: false, erro: "provider_unavailable" });
    expect(rotear(ped({ explicito: { provider: "claude" } }), deps([["c1", "claude", EXAUSTA]]))).toMatchObject({ ok: false, erro: "no_capacity" });
  });
  it("explicito.account_id é pin duro; conta de outro provedor não serve", () => {
    const m: Array<[string, string, ExtraConta?]> = [["c1", "claude", FRIA(1)], ["c2", "claude", FRIA(60)]];
    expect(rotear(ped({ explicito: { provider: "claude", account_id: "c2" } }), deps(m)).conta_id).toBe("c2");
  });
  it("cliPreferida sobe ao topo (se viável); conta preferida só vale se não for pior", () => {
    expect(rotear(ped({ cliPreferida: "codex" }), deps(MUNDO3)).executor?.provider).toBe("codex");
    expect(rotear(ped({ cliPreferida: "aider" }), deps(MUNDO3)).executor?.provider).toBe("claude");
    const m: Array<[string, string, ExtraConta?]> = [["c1", "claude", FRIA(5)], ["c2", "claude", FRIA(40)], ["c3", "claude", EXAUSTA]];
    expect(rotear(ped({ contaPreferida: "c2" }), deps(m)).conta_id).toBe("c2");
    expect(rotear(ped({ contaPreferida: "c3" }), deps(m)).conta_id).not.toBe("c3");
  });
});

describe("perfil pedido × modo de troca do workspace (P-28)", () => {
  const perfilTopo = { cli: "claude", modelo: "opus", esforco: null, faixa: "topo" as const };
  const claudeEstourado: Array<[string, string, ExtraConta?]> = [["c1", "claude", EXAUSTA], ["x1", "codex", FRIA(20)], ["g1", "gemini", FRIA(30)]];
  const porModo = (modo: "manual" | "so_sugerir" | "automatico", mundo = claudeEstourado, extra: Partial<PedidoRoteador> = {}) =>
    rotear(ped({ perfil: perfilTopo, ...extra }), deps(mundo, { config: config({ modo_troca: modo }) }));

  it("perfil saudável: aplica em qualquer modo, sem aprovação", () => {
    for (const modo of ["manual", "so_sugerir", "automatico"] as const) {
      const r = porModo(modo, MUNDO3);
      expect(r).toMatchObject({ ok: true, aplicada: true, requer_aprovacao: false, mudou: false, conta_id: "c1" });
      expect(r.executor).toMatchObject({ provider: "claude", model: "opus", faixa: "topo" });
    }
  });
  it("automático: conta estourada → mesma faixa (topo) em outro provedor, aplicada", () => {
    const r = porModo("automatico");
    expect(r).toMatchObject({ ok: true, aplicada: true, requer_aprovacao: false, mudou: true, modo: "automatico" });
    expect(r.executor?.faixa).toBe("topo");
    expect(r.executor?.provider).not.toBe("claude");
    expect(r.fontes.executor).toBe("fallback");
  });
  it("só sugerir: devolve a sugestão marcada requer_aprovacao e NÃO aplicada", () => {
    const r = porModo("so_sugerir");
    expect(r).toMatchObject({ ok: true, aplicada: false, requer_aprovacao: true, mudou: true, modo: "so_sugerir" });
    expect(r.executor?.provider).not.toBe("claude");
  });
  it("manual: nunca troca de provedor; sem capacidade devolve no_capacity com a sugestão separada", () => {
    const r = porModo("manual");
    expect(r).toMatchObject({ ok: false, erro: "no_capacity", aplicada: false, executor: null, conta_id: null, modo: "manual" });
    expect(r.sugestao).not.toBeNull();
    expect(r.sugestao?.provedor).not.toBe("claude");
  });
  it("manual com outra conta viva do MESMO provedor: escolhe a conta, sem trocar de provedor/modelo", () => {
    const r = porModo("manual", [["c1", "claude", QUENTE], ["c2", "claude", FRIA(30)], ["x1", "codex", FRIA(5)]]);
    expect(r).toMatchObject({ ok: true, aplicada: true, conta_id: "c2" });
    expect(r.executor).toMatchObject({ provider: "claude", model: "opus" });
  });
  it("perfil 'rápido' nunca sobe de faixa; CLI inexistente é erro nominal; CLI auto usa a faixa nas contas", () => {
    const r = rotear(ped({ perfil: { cli: "claude", modelo: "haiku", esforco: null, faixa: "rapido" } }), deps(claudeEstourado));
    expect(r.ok).toBe(true);
    expect(r.executor?.faixa).toBe("rapido");
    expect(rotear(ped({ perfil: { cli: "nao-existe", modelo: null, esforco: null, faixa: "alto" } }), deps(MUNDO3))).toMatchObject({ ok: false, erro: "no_compatible_cli" });
    const a = rotear(ped({ perfil: { cli: "auto", modelo: null, esforco: null, faixa: "topo" } }), deps(MUNDO3));
    expect(a.executor).toMatchObject({ provider: "claude", model: "opus", faixa: "topo" });
  });
  it("faixa mínima: 'mesma' não desce; 'descer_1' desce UMA faixa com aviso (balde do modelo esgotado)", () => {
    const m: Array<[string, string, ExtraConta?]> = [["c1", "claude", { w: [["five_hour", 10, 4]], baldes: { opus: [100, 3] } }], ["x1", "codex", EXAUSTA], ["g1", "gemini", EXAUSTA]];
    expect(porModo("automatico", m)).toMatchObject({ ok: false, erro: "no_capacity" });
    const d = rotear(ped({ perfil: perfilTopo }), deps(m, { config: config({ faixa_minima_troca: "descer_1" }) }));
    expect(d).toMatchObject({ ok: true, mudou: true });
    expect(d.executor).toMatchObject({ provider: "claude", model: "sonnet", faixa: "alto" });
    expect(d.avisos).toContain("desceu_de_faixa");
    expect(d.confianca).toBe("baixa");
  });
  it("troca entre provedores desligada: o perfil não migra de provedor", () => {
    const r = rotear(ped({ perfil: perfilTopo }), deps(claudeEstourado, { config: config({ troca_entre_provedores: false }) }));
    expect(r).toMatchObject({ ok: false, erro: "no_capacity" });
  });
  it("conta preferida do perfil é respeitada quando boa", () => {
    const r = rotear(ped({ perfil: perfilTopo, contaPreferida: "c2" }), deps([["c1", "claude", FRIA(5)], ["c2", "claude", FRIA(40)]]));
    expect(r.conta_id).toBe("c2");
  });
});

describe("Pane em curso (troca): modos, margem, saltos e ponto seguro", () => {
  const atual = { provedor: "claude", conta_id: "c1", modelo: "opus", faixa: "topo" as const };
  const mQuente: Array<[string, string, ExtraConta?]> = [["c1", "claude", { w: [["five_hour", 90, 3]] }], ["c2", "claude", FRIA(10)], ["x1", "codex", FRIA(10)]];
  const t = (modo: "manual" | "so_sugerir" | "automatico", mundo = mQuente, extra: Partial<PedidoRoteador> = {}) => rotear(ped({ atual, ...extra }), deps(mundo, { config: config({ modo_troca: modo }) }));

  it("automático troca para outra conta; só sugerir sugere; manual NUNCA troca", () => {
    expect(t("automatico")).toMatchObject({ ok: true, aplicada: true, mudou: true, conta_id: "c2" });
    expect(t("so_sugerir")).toMatchObject({ ok: true, aplicada: false, requer_aprovacao: true, mudou: true, conta_id: "c2" });
    expect(t("manual")).toMatchObject({ ok: true, aplicada: true, mudou: false, conta_id: "c1" });
  });
  it("ação direta do usuário ignora o modo manual", () => {
    expect(t("manual", mQuente, { acaoDoUsuario: true })).toMatchObject({ aplicada: true, mudou: true, conta_id: "c2" });
  });
  it("conta atual saudável: mantém em qualquer modo", () => {
    for (const modo of ["manual", "so_sugerir", "automatico"] as const) expect(t(modo, [["c1", "claude", FRIA(20)], ["c2", "claude", FRIA(1)]])).toMatchObject({ conta_id: "c1", mudou: false, aplicada: true });
  });
  it("sem melhora pela margem não troca; conta atual exaurida e sem destino = no_capacity (nunca devolve a exaurida)", () => {
    expect(t("automatico", [["c1", "claude", { w: [["five_hour", 90, 3]] }], ["c2", "claude", FRIA(85)]])).toMatchObject({ conta_id: "c1", mudou: false });
    const r = t("automatico", [["c1", "claude", EXAUSTA], ["c2", "claude", EXAUSTA]]);
    expect(r).toMatchObject({ ok: false, erro: "no_capacity", conta_id: null });
    expect(t("manual", [["c1", "claude", EXAUSTA], ["c2", "claude", FRIA()]])).toMatchObject({ ok: false, erro: "no_capacity", conta_id: null });
  });
  it("operação não retomável adia a troca (mantém a atual, com aviso); com confirmação troca", () => {
    const r = t("automatico", mQuente, { operacaoNaoRetomavel: true });
    expect(r).toMatchObject({ conta_id: "c1", mudou: false });
    expect(r.avisos.join(" ")).toMatch(/operacao_nao_retomavel/);
    expect(t("automatico", mQuente, { operacaoNaoRetomavel: true, confirmouRisco: true })).toMatchObject({ conta_id: "c2", mudou: true });
  });
  it("teto de saltos (3) e intervalo mínimo entre trocas", () => {
    expect(t("automatico", mQuente, { saltos: 3 })).toMatchObject({ conta_id: "c1", mudou: false });
    expect(t("automatico", mQuente, { ultimaTrocaEm: AGORA - 60_000 })).toMatchObject({ conta_id: "c1", mudou: false });
    expect(t("automatico", mQuente, { ultimaTrocaEm: AGORA - 3_600_000 })).toMatchObject({ conta_id: "c2" });
  });
  it("modo derivado da permissão do workspace quando modo_troca é nulo: seguro → só sugerir; automatico → automático", () => {
    const base = { config: config({ modo_troca: null }) };
    expect(rotear(ped({ atual }), deps(mQuente, { ...base, permissaoWorkspace: "seguro" })).modo).toBe("so_sugerir");
    expect(rotear(ped({ atual }), deps(mQuente, { ...base, permissaoWorkspace: "automatico" })).modo).toBe("automatico");
    expect(rotear(ped({ atual }), deps(mQuente, base)).modo).toBe("so_sugerir");
  });
});

describe("recibo, decisão registrada e determinismo", () => {
  it("registra UMA decisão com escolhida ∈ opcoes, custo desconhecido (null) e sem texto livre do pedido", () => {
    const gravadas: DecisaoEntrada[] = [];
    const r = rotear(ped({ descricao: "texto livre do usuário SEGREDO-NO-PEDIDO", pane_id: "p1", mission_id: "m1" }), deps(MUNDO3, { registrar: (d) => void gravadas.push(d) }));
    expect(gravadas).toHaveLength(1);
    const d = gravadas[0]!;
    expect(d.opcoes).toContain(d.escolhida);
    expect(d).toMatchObject({ proposito: "selecao_conta", workspace_id: WS, pane_id: "p1", mission_id: "m1", custo_usd: null, resumo_enviado: null, fonte: "politica", recibo: r.recibo });
    expect(JSON.stringify(d)).not.toContain("SEGREDO-NO-PEDIDO");
  });
  it("no_capacity também é registrada; falha ao registrar nunca derruba a rota", () => {
    const g: DecisaoEntrada[] = [];
    rotear(ped(), deps([["c1", "claude", EXAUSTA]], { registrar: (d) => void g.push(d) }));
    expect(g[0]?.escolhida).toBe("nenhuma");
    const r = rotear(ped(), deps(MUNDO3, { registrar: () => { throw new Error("banco fora"); } }));
    expect(r.ok).toBe(true);
    expect(r.avisos).toContain("decisao_nao_registrada");
  });
  it("recibo sem segredo (sentinela): ids/nome com cara de chave saem [oculto]", () => {
    const SENT = "sk-SENTINELA0123456789abcdef";
    const g: DecisaoEntrada[] = [];
    const r = rotear(ped({ perfil: { cli: "claude", modelo: SENT, esforco: null, faixa: "alto" } }), deps([[SENT, "claude", FRIA()]], { registrar: (d) => void g.push(d) }));
    const tudo = JSON.stringify({ recibo: r.recibo, motivo: r.motivo, avisos: r.avisos, decisoes: g });
    expect(tudo).not.toContain("SENTINELA0123456789abcdef");
    const bearer = rotear(ped({ explicito: { provider: "claude" } }), deps([["Bearer abc.def.ghi-12345678", "claude", FRIA()]]));
    expect(bearer.recibo).not.toContain("abc.def.ghi");
  });
  it("determinístico: o mesmo pedido e os mesmos dados dão a mesma rota (e não muta a entrada)", () => {
    const d = deps(MUNDO3);
    const antes = JSON.stringify(d);
    const a = rotear(ped({ perfil: { cli: "auto", modelo: null, esforco: null, faixa: "alto" } }), d);
    const b = rotear(ped({ perfil: { cli: "auto", modelo: null, esforco: null, faixa: "alto" } }), d);
    expect(b).toEqual(a);
    expect(JSON.stringify(d)).toBe(antes);
  });
});
