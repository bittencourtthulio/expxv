import { describe, expect, it } from "vitest";
import type { ConfigHarness } from "../../compartilhado/harness";
import { AGORA, H, embaralhar, prng, type ExtraConta } from "../../../tests/fixtures/harness/construtores";
import { PADRAO, mundoT, paneT, quente, type SpecConta } from "../../../tests/fixtures/harness/troca";
import { config } from "../../../tests/fixtures/harness/rotas";
import { montarEquivalencia } from "./equivalencia";
import { avaliarTroca, bloqueioDoPane, type EstadoDoMundo, type PaneParaTroca, type Proposta } from "./troca";

const cl = (id: string, x: ExtraConta = {}): SpecConta => [id, "claude", x];
const cx = (id: string, x: ExtraConta = {}): SpecConta => [id, "codex", x];
const MIN = 60_000;

interface Esperado {
  pane_id?: string;
  acao: Proposta["acao"];
  situacao: Proposta["situacao"];
  adiada_por?: Proposta["adiada_por"];
  /** `provedor/conta` ou null. */
  para?: string | null;
  urgencia?: Proposta["urgencia"];
  motivo?: Proposta["motivo"];
  vencida?: boolean;
  tipo?: Proposta["tipo_troca"];
  erro?: Proposta["erro"];
  bloqueio?: Proposta["bloqueio"];
}
interface Caso {
  nome: string;
  contas: SpecConta[];
  panes?: Array<Partial<PaneParaTroca>>;
  cfg?: Partial<ConfigHarness>;
  mundo?: Partial<EstadoDoMundo>;
  /** `[]` = nenhuma proposta. */
  esperado: Esperado[];
}
const E = (e: Esperado): Esperado => e;
const PRONTA_AUTO = (para: string, extra: Partial<Esperado> = {}): Esperado => E({ acao: "executar", situacao: "pronta", para, ...extra });
const ADIA = (por: NonNullable<Proposta["adiada_por"]>, extra: Partial<Esperado> = {}): Esperado => E({ acao: "adiar", situacao: "adiada", adiada_por: por, ...extra });

const desdeAntes = (ms: number): Partial<EstadoDoMundo> => ({ gatilhoDesde: { p1: AGORA - ms } });

// TABELA DE DECISÃO de avaliarTroca (T-09.19, CT-9.18..9.22). Modo padrão do fixture: automático.
const TABELA: Caso[] = [
  // ---- gatilho ----
  { nome: "01 84%: abaixo do gatilho, nada", contas: [cl("c1", quente(84)), cl("c2", quente(10))], esperado: [] },
  { nome: "02 85% (= limiar): gatilho, executa na outra conta", contas: [cl("c1", quente(85)), cl("c2", quente(10))], esperado: [PRONTA_AUTO("claude/c2", { motivo: "consumo_alto", urgencia: "normal" })] },
  { nome: "03 5 h baixa, semanal a 88%: o gargalo é o semanal", contas: [cl("c1", { w: [["five_hour", 30, 2], ["weekly", 88, 80]] }), cl("c2", quente(10))], esperado: [PRONTA_AUTO("claude/c2")] },
  { nome: "04 limiar configurado a 70%: 72% já troca", contas: [cl("c1", quente(72)), cl("c2", quente(10))], cfg: { limiar_troca_pct: 70 }, esperado: [PRONTA_AUTO("claude/c2")] },
  { nome: "05 balde do modelo (opus) a 90% com janelas baixas", contas: [cl("c1", { w: [["five_hour", 20, 3]], baldes: { opus: [90, 50] } }), cl("c2", quente(10))], esperado: [PRONTA_AUTO("claude/c2")] },
  { nome: "06 crédito OpenRouter a 87% troca para outra conta de crédito", contas: [["or1", "openrouter", { fonte: "openrouter_api", w: [["credit", 87, null]] }], ["or2", "openrouter", { fonte: "openrouter_api", w: [["credit", 10, null]] }]], panes: [{ provedor: "openrouter", conta_id: "or1", modelo: "vendor/modelo" }], mundo: { provedoresViaveis: ["claude", "openrouter"] }, esperado: [PRONTA_AUTO("openrouter/or2")] },
  { nome: "07 conta sem dado de limite: sem gatilho", contas: [cl("c1", { semUso: true }), cl("c2", quente(10))], esperado: [] },
  { nome: "08 janela vencida (90% de ciclo passado) é desconhecida: sem gatilho", contas: [cl("c1", quente(90, -1)), cl("c2", quente(10))], esperado: [] },
  { nome: "09 Pane sem conta e sem frase de limite: sem gatilho", contas: [cl("c2", quente(10))], panes: [{ conta_id: null }], esperado: [] },
  { nome: "10 100%: limite atingido, urgência alta", contas: [cl("c1", quente(100)), cl("c2", quente(10))], esperado: [PRONTA_AUTO("claude/c2", { motivo: "limite_atingido", urgencia: "alta" })] },
  { nome: "11 CLI parada no limite (frase vista, 50% medido): ponto seguro mesmo `trabalhando`", contas: [cl("c1", quente(50)), cl("c2", quente(10))], panes: [{ estado: "trabalhando", limite_detectado: true }], esperado: [PRONTA_AUTO("claude/c2", { motivo: "limite_atingido", urgencia: "alta" })] },
  // ---- modos (P-28) ----
  { nome: "12 manual: nada sugere, mesmo a 95%", contas: [cl("c1", quente(95)), cl("c2", quente(10))], cfg: { modo_troca: "manual" }, esperado: [] },
  { nome: "13 só sugerir: propõe, não executa", contas: [cl("c1", quente(87)), cl("c2", quente(10))], cfg: { modo_troca: "so_sugerir" }, esperado: [E({ acao: "sugerir", situacao: "pronta", para: "claude/c2" })] },
  { nome: "14 modo NULL + permissão automatica: automático", contas: [cl("c1", quente(87)), cl("c2", quente(10))], cfg: { modo_troca: null }, mundo: { permissaoWorkspace: "automatico" }, esperado: [PRONTA_AUTO("claude/c2")] },
  { nome: "15 modo NULL + permissão seguro: só sugerir", contas: [cl("c1", quente(87)), cl("c2", quente(10))], cfg: { modo_troca: null }, mundo: { permissaoWorkspace: "seguro" }, esperado: [E({ acao: "sugerir", situacao: "pronta" })] },
  // ---- ponto seguro e bloqueios (CT-9.20) ----
  { nome: "16 trabalhando: adia até o fim do turno", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ estado: "trabalhando" }], esperado: [ADIA("trabalhando", { para: "claude/c2" })] },
  { nome: "17 operação git em curso: adia mesmo `pronto`", contas: [cl("c1", quente(95)), cl("c2", quente(10))], mundo: { operacaoGit: new Set(["p1"]) }, esperado: [ADIA("operacao_git")] },
  { nome: "18 handoff em voo: adia", contas: [cl("c1", quente(87)), cl("c2", quente(10))], mundo: { handoffEmVoo: new Set(["p1"]) }, esperado: [ADIA("handoff_em_voo")] },
  { nome: "19 pergunta pendente ao humano: adia", contas: [cl("c1", quente(87)), cl("c2", quente(10))], mundo: { perguntaPendente: new Set(["p1"]) }, esperado: [ADIA("pergunta_pendente")] },
  { nome: "20 aguardando aprovação: nunca é ponto seguro, nem com frase de limite", contas: [cl("c1", quente(99)), cl("c2", quente(10))], panes: [{ estado: "aguardando", limite_detectado: true }], esperado: [ADIA("pergunta_pendente", { motivo: "limite_atingido" })] },
  { nome: "21 bloqueado: adia", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ estado: "bloqueado" }], esperado: [ADIA("pergunta_pendente")] },
  { nome: "22 espera de 599 s: ainda adia", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ estado: "trabalhando" }], mundo: desdeAntes(599_000), esperado: [ADIA("trabalhando")] },
  { nome: "23 espera de 600 s vencida: vira sugestão visível, nada é trocado", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ estado: "trabalhando" }], mundo: desdeAntes(600_000), esperado: [E({ acao: "sugerir", situacao: "adiada", adiada_por: "trabalhando", vencida: true })] },
  { nome: "24 git em curso com espera vencida: sugere, jamais executa", contas: [cl("c1", quente(95)), cl("c2", quente(10))], mundo: { ...desdeAntes(2 * H), operacaoGit: new Set(["p1"]) }, esperado: [E({ acao: "sugerir", situacao: "adiada", adiada_por: "operacao_git", vencida: true })] },
  { nome: "25 só sugerir + trabalhando: sugestão visível já, com o motivo do adiamento", contas: [cl("c1", quente(87)), cl("c2", quente(10))], cfg: { modo_troca: "so_sugerir" }, panes: [{ estado: "trabalhando" }], esperado: [E({ acao: "sugerir", situacao: "adiada", adiada_por: "trabalhando" })] },
  { nome: "26 Pane iniciando ou encerrado: ignorado", contas: [cl("c1", quente(95)), cl("c2", quente(10))], panes: [{ estado: "iniciando" }, { pane_id: "p2", estado: "encerrado" }], esperado: [] },
  // ---- destino (CT-9.18, 9.19, 9.21) ----
  { nome: "27 CT-9.18: Claude a 87% e outra Claude a 20%: outra conta", contas: [cl("c1", quente(87)), cl("c2", quente(20))], esperado: [PRONTA_AUTO("claude/c2", { tipo: "outra_conta" })] },
  { nome: "28 CT-9.19: só uma Claude; Codex com folga: modelo equivalente em outro provedor", contas: [cl("c1", quente(88)), cx("x1", quente(10))], esperado: [PRONTA_AUTO("codex/x1", { tipo: "outro_provedor" })] },
  { nome: "29 CT-9.21: nenhum outro provedor, 87% (não esgotada): permanece e avisa", contas: [cl("c1", quente(87))], mundo: { provedoresViaveis: ["claude"] }, esperado: [E({ acao: "avisar", situacao: "sem_alternativa", para: null, erro: null })] },
  { nome: "30 CT-9.21: esgotada e sem alternativa: no_capacity, Pane intacto", contas: [cl("c1", quente(100))], mundo: { provedoresViaveis: ["claude"] }, esperado: [E({ acao: "avisar", situacao: "sem_alternativa", para: null, erro: "no_capacity", urgencia: "alta" })] },
  { nome: "31 troca entre provedores desligada: Codex livre não é usado", contas: [cl("c1", quente(88)), cx("x1", quente(5))], cfg: { troca_entre_provedores: false }, esperado: [E({ acao: "avisar", situacao: "sem_alternativa", para: null })] },
  { nome: "32 destino a 80% com origem a 87%: sem a margem de 10 pontos, fica", contas: [cl("c1", quente(87)), cl("c2", quente(80))], mundo: { provedoresViaveis: ["claude"] }, esperado: [E({ acao: "avisar", situacao: "sem_alternativa" })] },
  { nome: "33 destino em cooldown não serve", contas: [cl("c1", quente(87)), cl("c2", { ...quente(10), cooldownH: 1 })], mundo: { provedoresViaveis: ["claude"] }, esperado: [E({ acao: "avisar", situacao: "sem_alternativa" })] },
  { nome: "34 expires_first: prefere a conta que reinicia antes", contas: [cl("c1", quente(87)), cl("c2", quente(30, 1)), cl("c3", quente(5, 4))], esperado: [PRONTA_AUTO("claude/c2")] },
  { nome: "35 faixa mínima `mesma`: provedor só com faixa inferior não serve", contas: [cl("c1", quente(88)), cx("x1", quente(5))], mundo: { equivalencia: montarEquivalencia(PADRAO, { codex: { topo: [], alto: [{ modelo: "default", esforco: null }] } }).efetiva }, esperado: [E({ acao: "avisar", situacao: "sem_alternativa" })] },
  { nome: "36 faixa mínima `descer_1`: desce uma faixa, com aviso", contas: [cl("c1", quente(88)), cx("x1", quente(5))], cfg: { faixa_minima_troca: "descer_1" }, mundo: { equivalencia: montarEquivalencia(PADRAO, { codex: { topo: [], alto: [{ modelo: "default", esforco: null }] } }).efetiva }, esperado: [PRONTA_AUTO("codex/x1", { tipo: "faixa_inferior" })] },
  // ---- anti vai-e-volta (CT-9.22) ----
  { nome: "37 troca há 5 min no mesmo Pane: espera o intervalo mínimo", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ ultima_troca_em: AGORA - 5 * MIN }], mundo: { provedoresViaveis: ["claude"] }, esperado: [E({ acao: "avisar", situacao: "sem_alternativa", bloqueio: "intervalo_entre_trocas" })] },
  { nome: "38 troca há 11 min: pode trocar de novo", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ ultima_troca_em: AGORA - 11 * MIN, saltos: 1 }], esperado: [PRONTA_AUTO("claude/c2")] },
  { nome: "39 saltos no teto (3): sem troca", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ saltos: 3 }], esperado: [E({ acao: "avisar", situacao: "sem_alternativa", bloqueio: "max_saltos" })] },
  { nome: "40 max_saltos configurado a 1 vale", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ saltos: 1 }], cfg: { max_saltos: 1 }, esperado: [E({ acao: "avisar", situacao: "sem_alternativa", bloqueio: "max_saltos" })] },
  { nome: "41 ignorar 30 min ativo: não reaparece", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ ignorar_sugestao_ate: AGORA + 10 * MIN }], esperado: [] },
  { nome: "42 ignorar vencido: volta a propor", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ ignorar_sugestao_ate: AGORA - 1 }], esperado: [PRONTA_AUTO("claude/c2")] },
  { nome: "43 ignorar não cala quando a CLI já parou no limite", contas: [cl("c1", quente(87)), cl("c2", quente(10))], panes: [{ ignorar_sugestao_ate: AGORA + 10 * MIN, limite_detectado: true }], esperado: [PRONTA_AUTO("claude/c2", { motivo: "limite_atingido" })] },
];

describe("avaliarTroca: tabela de decisão (CT-9.18 a 9.22)", () => {
  it("tem pelo menos 35 casos", () => expect(TABELA.length).toBeGreaterThanOrEqual(35));
  for (const c of TABELA) {
    it(c.nome, () => {
      const { usos, mundo } = mundoT(c.contas, c.mundo);
      const panes = (c.panes ?? [{}]).map((p) => paneT(p));
      const r = avaliarTroca(panes, usos, config(c.cfg), mundo, AGORA);
      expect(r).toHaveLength(c.esperado.length);
      c.esperado.forEach((e, i) => {
        const p = r[i] as Proposta;
        expect(p.acao).toBe(e.acao);
        expect(p.situacao).toBe(e.situacao);
        if (e.adiada_por !== undefined) expect(p.adiada_por).toBe(e.adiada_por);
        else if (e.acao === "executar") expect(p.adiada_por).toBeNull();
        if (e.para !== undefined) expect(p.para === null ? null : `${p.para.provedor}/${p.para.conta_id}`).toBe(e.para);
        if (e.urgencia) expect(p.urgencia).toBe(e.urgencia);
        if (e.motivo) expect(p.motivo).toBe(e.motivo);
        if (e.vencida !== undefined) expect(p.espera_vencida).toBe(e.vencida);
        if (e.tipo !== undefined) expect(p.tipo_troca).toBe(e.tipo);
        if (e.erro !== undefined) expect(p.erro).toBe(e.erro);
        if (e.bloqueio !== undefined) expect(p.bloqueio).toBe(e.bloqueio);
        // invariante: o destino nunca é a origem e o recibo nunca fica vazio
        if (p.para) expect(p.para.conta_id === p.de.conta_id && p.para.provedor === p.de.provedor).toBe(false);
        expect(p.recibo.length).toBeGreaterThan(0);
      });
    });
  }
});

describe("avaliarTroca: invariantes", () => {
  const contasVarias: SpecConta[] = [cl("c1", quente(90)), cl("c2", quente(20)), cl("c3", quente(88)), cx("x1", quente(40)), cx("x2", quente(95)), ["g1", "gemini", quente(10)]];
  const painel = (): PaneParaTroca[] => [
    paneT({ pane_id: "p1", conta_id: "c1" }),
    paneT({ pane_id: "p2", conta_id: "c3", estado: "trabalhando" }),
    paneT({ pane_id: "p3", conta_id: "x2", provedor: "codex", modelo: null, estado: "pronto" }),
    paneT({ pane_id: "p4", conta_id: "c1", estado: "aguardando" }),
    paneT({ pane_id: "p5", conta_id: "c2", estado: "pronto" }),
    paneT({ pane_id: "p6", conta_id: "c3", limite_detectado: true }),
  ];
  const mundoPainel = () => mundoT(contasVarias, { operacaoGit: new Set(["p6"]), perguntaPendente: new Set(["p1"]) });

  it("permutar a ordem dos Panes não muda o resultado (200 permutações)", () => {
    const { usos, mundo } = mundoPainel();
    const base = avaliarTroca(painel(), usos, config(), mundo, AGORA);
    expect(base.length).toBeGreaterThan(0);
    const r = prng(7);
    for (let i = 0; i < 200; i++) {
      expect(avaliarTroca(embaralhar(painel(), r), usos, config(), mundo, AGORA)).toEqual(base);
    }
  });
  it("permutar a ordem das contas e dos usos também não muda o resultado", () => {
    const { usos, mundo } = mundoPainel();
    const base = avaliarTroca(painel(), usos, config(), mundo, AGORA);
    const r = prng(11);
    for (let i = 0; i < 100; i++) {
      const m2: EstadoDoMundo = { ...mundo, contas: embaralhar(mundo.contas, r) };
      expect(avaliarTroca(painel(), embaralhar(usos, r), config(), m2, AGORA)).toEqual(base);
    }
  });
  it("determinística: mesma entrada, mesmo JSON; entradas não são alteradas", () => {
    const { usos, mundo } = mundoPainel();
    const panes = painel();
    const antes = JSON.stringify({ panes, usos, c: mundo.contas });
    const a = JSON.stringify(avaliarTroca(panes, usos, config(), mundo, AGORA));
    const b = JSON.stringify(avaliarTroca(panes, usos, config(), mundo, AGORA));
    expect(a).toBe(b);
    expect(JSON.stringify({ panes, usos, c: mundo.contas })).toBe(antes);
  });
  it("nunca executa com operação git, handoff em voo, pergunta pendente, aguardando ou bloqueado (aleatório, 400 mundos)", () => {
    const r = prng(99);
    const estados = ["pronto", "trabalhando", "aguardando", "bloqueado"] as const;
    for (let i = 0; i < 400; i++) {
      const panes = Array.from({ length: 5 }, (_, k) => paneT({ pane_id: `p${k}`, conta_id: k % 2 === 0 ? "c1" : "c3", estado: estados[Math.floor(r() * 4)] as PaneParaTroca["estado"], limite_detectado: r() < 0.3 }));
      const sets = (): Set<string> => new Set(panes.filter(() => r() < 0.3).map((p) => p.pane_id));
      const { usos, mundo } = mundoT(contasVarias, { operacaoGit: sets(), handoffEmVoo: sets(), perguntaPendente: sets() });
      for (const p of avaliarTroca(panes, usos, config(), mundo, AGORA)) {
        if (p.acao !== "executar") continue;
        const pane = panes.find((x) => x.pane_id === p.pane_id) as PaneParaTroca;
        expect(bloqueioDoPane(pane, mundo)).toBeNull();
        expect(mundo.operacaoGit?.has(p.pane_id)).toBeFalsy();
        expect(mundo.handoffEmVoo?.has(p.pane_id)).toBeFalsy();
        expect(mundo.perguntaPendente?.has(p.pane_id)).toBeFalsy();
        expect(["aguardando", "bloqueado"]).not.toContain(pane.estado);
      }
    }
  });
  it("modo só sugerir nunca devolve `executar`", () => {
    const { usos, mundo } = mundoPainel();
    for (const p of avaliarTroca(painel(), usos, config({ modo_troca: "so_sugerir" }), mundo, AGORA)) expect(p.acao).not.toBe("executar");
  });
  it("urgência alta vem primeiro; empate por pane_id", () => {
    const { usos, mundo } = mundoPainel();
    const r = avaliarTroca(painel(), usos, config(), mundo, AGORA);
    const alt = r.map((p) => p.urgencia === "alta");
    expect(alt).toEqual([...alt].sort((a, b) => Number(b) - Number(a)));
  });
  it("CT-9.22 sem loop: 3 contas entre 86% e 90% nunca trocam (cada Pane fica onde está)", () => {
    const contas = [cl("c1", quente(90)), cl("c2", quente(88)), cl("c3", quente(86))];
    const { usos, mundo } = mundoT(contas, { provedoresViaveis: ["claude"] });
    const panes = ["c1", "c2", "c3"].map((c, i) => paneT({ pane_id: `p${i + 1}`, conta_id: c }));
    const r = avaliarTroca(panes, usos, config(), mundo, AGORA);
    expect(r).toHaveLength(3);
    for (const p of r) {
      expect(p.acao).toBe("avisar");
      expect(p.para).toBeNull();
    }
  });
  it("CT-9.22 simulação: depois da troca (antiga 90%, nova 86%) não volta (margem, intervalo e saltos ≤ 3)", () => {
    // o Pane foi de c1 (90%) para c3 (20% → agora 86%); o destino "c1 a 90%" não tem folga e o intervalo de 10 min ainda vale
    const contas = [cl("c1", quente(90)), cl("c3", quente(86))];
    const { usos, mundo } = mundoT(contas, { provedoresViaveis: ["claude"] });
    for (const minutos of [1, 5, 9, 11, 60]) {
      const r = avaliarTroca([paneT({ conta_id: "c3", saltos: 1, ultima_troca_em: AGORA - minutos * MIN })], usos, config(), mundo, AGORA);
      expect(r[0]?.para ?? null).toBeNull();
    }
  });
  it("cenário de 20 Panes × 10 contas roda e é estável", () => {
    const contas: SpecConta[] = [];
    for (let i = 0; i < 10; i++) contas.push(cl(`c${i}`, quente(i * 10 + 5)));
    const { usos, mundo } = mundoT(contas, { provedoresViaveis: ["claude"] });
    const panes = Array.from({ length: 20 }, (_, i) => paneT({ pane_id: `p${String(i).padStart(2, "0")}`, conta_id: `c${i % 10}` }));
    const r = avaliarTroca(panes, usos, config(), mundo, AGORA);
    expect(r.every((p) => (p.de.used_pct ?? 0) >= 85)).toBe(true);
    expect(r.length).toBe(4); // c8 (85%) e c9 (95%), 2 Panes cada
  });
});
