// P-101 (Fase 9): decisão determinística em microssegundos. Funções puras, sem I/O, sem Electron.
//  - P-101a: `pickAccount` com 50 contas, 10 000 chamadas, p95 ≤ 1 ms.
//  - P-101b: `pickModel` com 5 provedores × 12 contas (troca com busca em todos os níveis), 10 000 chamadas, p95 ≤ 2 ms.
//  - P-101c: `pickModel` com 50 contas num provedor (pior caso de uma troca de conta), p95 ≤ 1 ms.
//  - P-102a/b/c (onda 3-B): `rotear` (política + faixa + pickModel + recibo, sem banco/rede) p95 ≤ 1 ms; `explicar` p95 ≤ 0,05 ms.
import { afterAll, describe, expect, it } from "vitest";
import type { CandidataConta } from "../../src/compartilhado/harness";
import { pickModel } from "../../src/nucleo/harness/escolher-modelo";
import { pickAccount } from "../../src/nucleo/harness/escolher-conta";
import { AGORA, PADRAO, conta, opcoesConta, opcoesModelo, prng } from "../fixtures/harness/construtores";
import { config, decisaoEntrada, deps, politicasGlobais } from "../fixtures/harness/rotas";
import { explicar } from "../../src/nucleo/harness/decisoes";
import { rotear } from "../../src/nucleo/harness/roteador";
import { classificar } from "../../src/nucleo/harness/classificar";
import { avaliarTroca, criarExecutorTroca, type PaneParaTroca } from "../../src/nucleo/harness/troca";
import { mundoT, paneT, type SpecConta } from "../fixtures/harness/troca";
import type { ExtraConta } from "../fixtures/harness/construtores";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());

const CHAMADAS = 10_000;
const AQUECIMENTO = 500;

function contasAleatorias(prov: string, n: number, r: () => number): CandidataConta[] {
  return Array.from({ length: n }, (_, i) => conta(`${prov}${String(i).padStart(2, "0")}`, prov, { w: [["five_hour", Math.round(r() * 100), r() * 5], ["weekly", Math.round(r() * 100), r() * 120]], baldes: { opus: [Math.round(r() * 100), r() * 120] } }));
}
function medir(f: () => void): number[] {
  for (let i = 0; i < AQUECIMENTO; i++) f();
  const t: number[] = [];
  for (let i = 0; i < CHAMADAS; i++) {
    const a = performance.now();
    f();
    t.push(performance.now() - a);
  }
  return t;
}

describe("P-101: pickAccount e pickModel", () => {
  it("pickAccount com 50 contas: p95 ≤ 1 ms", () => {
    const cands = contasAleatorias("claude", 50, prng(1));
    const o = opcoesConta({ modelo: "opus", agora: AGORA });
    const t = medir(() => void pickAccount(cands, o));
    const p95 = percentil(t, 95);
    const r = registrar({ id: "P-101a", descricao: "pickAccount, 50 contas, 10 000 chamadas (p95)", valor: p95, limite: 1, unidade: "ms", pior: Math.max(...t) });
    console.log(`P-101a: p95 ${p95.toFixed(4)} ms, mediana ${percentil(t, 50).toFixed(4)} ms, máx ${Math.max(...t).toFixed(3)} ms`);
    expect(r.ok).toBe(true);
  });
  it("pickModel com 5 provedores × 12 contas: p95 ≤ 2 ms", () => {
    const r0 = prng(2);
    const mundo: Record<string, CandidataConta[]> = {};
    for (const p of ["claude", "codex", "gemini", "opencode", "aider"]) mundo[p] = contasAleatorias(p, 12, r0);
    // força a busca a atravessar todos os níveis: a atual e as outras do provedor quentes
    mundo["claude"] = mundo["claude"]!.map((c, i) => conta(c.conta_id, "claude", { w: [["five_hour", 88 + (i % 10), 2 + i]] }));
    const o = opcoesModelo({ provedores_viaveis: ["claude", "codex", "gemini", "opencode", "aider"], faixa_minima: "qualquer", atual: { provedor: "claude", conta_id: "claude00", modelo: "opus", faixa: "topo" } });
    const t = medir(() => void pickModel(mundo, PADRAO, o));
    const p95 = percentil(t, 95);
    const r = registrar({ id: "P-101b", descricao: "pickModel, 5 provedores × 12 contas, 10 000 chamadas (p95)", valor: p95, limite: 2, unidade: "ms", pior: Math.max(...t) });
    console.log(`P-101b: p95 ${p95.toFixed(4)} ms, mediana ${percentil(t, 50).toFixed(4)} ms, máx ${Math.max(...t).toFixed(3)} ms`);
    expect(r.ok).toBe(true);
  });
  it("pickModel com 50 contas no provedor (troca de conta): p95 ≤ 1 ms", () => {
    const cands = contasAleatorias("claude", 50, prng(3)).map((c, i) => (i === 0 ? conta("claude00", "claude", { w: [["five_hour", 90, 1]] }) : c));
    const o = opcoesModelo({ provedores_viaveis: ["claude"], atual: { provedor: "claude", conta_id: "claude00", modelo: "opus", faixa: "topo" } });
    const t = medir(() => void pickModel({ claude: cands }, PADRAO, o));
    const p95 = percentil(t, 95);
    const r = registrar({ id: "P-101c", descricao: "pickModel, 50 contas num provedor, 10 000 chamadas (p95)", valor: p95, limite: 1, unidade: "ms", pior: Math.max(...t) });
    console.log(`P-101c: p95 ${p95.toFixed(4)} ms, mediana ${percentil(t, 50).toFixed(4)} ms`);
    expect(r.ok).toBe(true);
  });
});

describe("P-102: rotear (decisão do roteador, sem banco e sem rede)", () => {
  const provs = ["claude", "codex", "gemini", "opencode", "aider"];
  const mundo = (quente: boolean): Array<[string, string, ExtraConta]> => {
    const r = prng(4);
    const spec: Array<[string, string, ExtraConta]> = [];
    for (const p of provs) for (let i = 0; i < 12; i++) spec.push([`${p}${String(i).padStart(2, "0")}`, p, { w: [["five_hour", p === "claude" && quente ? 88 + (i % 10) : Math.round(r() * 80), 1 + r() * 4], ["weekly", Math.round(r() * 80), 10 + r() * 100]] }]);
    return spec;
  };
  const med = (f: () => void): number[] => medir(f);
  it("rotear por política (5 provedores × 12 contas): p95 ≤ 1 ms", () => {
    const d = deps(mundo(false), { provedoresViaveis: provs, politica: { globais: politicasGlobais(provs), doWorkspace: [] } });
    const t = med(() => void rotear({ taskType: "implementar", workspace: "ws1" }, d));
    const p95 = percentil(t, 95);
    const r = registrar({ id: "P-102a", descricao: "rotear por política, 5 provedores × 12 contas, 10 000 chamadas (p95)", valor: p95, limite: 1, unidade: "ms", pior: Math.max(...t) });
    console.log(`P-102a: p95 ${p95.toFixed(4)} ms, mediana ${percentil(t, 50).toFixed(4)} ms, máx ${Math.max(...t).toFixed(3)} ms`);
    expect(r.ok).toBe(true);
  });
  it("rotear perfil com o provedor quente (busca por equivalentes, modo automático): p95 ≤ 1 ms", () => {
    const d = deps(mundo(true), { provedoresViaveis: provs, config: config({ modo_troca: "automatico", faixa_minima_troca: "descer_1" }) });
    const t = med(() => void rotear({ taskType: "implementar", workspace: "ws1", perfil: { cli: "claude", modelo: "opus", esforco: null, faixa: "topo" } }, d));
    const p95 = percentil(t, 95);
    const r = registrar({ id: "P-102b", descricao: "rotear perfil com provedor quente, 5 × 12 contas, 10 000 chamadas (p95)", valor: p95, limite: 1, unidade: "ms", pior: Math.max(...t) });
    console.log(`P-102b: p95 ${p95.toFixed(4)} ms, mediana ${percentil(t, 50).toFixed(4)} ms, máx ${Math.max(...t).toFixed(3)} ms`);
    expect(r.ok).toBe(true);
  });
  it("rotear com Decisão registrada (função de gravação em memória): p95 ≤ 1 ms; explicar p95 ≤ 0,05 ms", () => {
    const lixo: unknown[] = [];
    const d = deps(mundo(false), { provedoresViaveis: provs, politica: { globais: politicasGlobais(provs), doWorkspace: [] }, registrar: (x) => void (lixo.length = 0, lixo.push(x)) });
    const t = med(() => void rotear({ taskType: "bug-fix", workspace: "ws1" }, d));
    const p95 = percentil(t, 95);
    const r = registrar({ id: "P-102c", descricao: "rotear + montar e entregar a Decisão (sem banco), 10 000 chamadas (p95)", valor: p95, limite: 1, unidade: "ms", pior: Math.max(...t) });
    console.log(`P-102c: p95 ${p95.toFixed(4)} ms, mediana ${percentil(t, 50).toFixed(4)} ms`);
    expect(r.ok).toBe(true);
    const dec = { ...decisaoEntrada(), id: "dec_1", criado_em: new Date(AGORA).toISOString() };
    const te = medir(() => void explicar(dec));
    const pe = percentil(te, 95);
    const re = registrar({ id: "P-102d", descricao: "explicar(decisão), 10 000 chamadas (p95)", valor: pe, limite: 0.05, unidade: "ms", pior: Math.max(...te) });
    console.log(`P-102d: p95 ${pe.toFixed(5)} ms`);
    expect(re.ok).toBe(true);
  });
});

describe("P-107: avaliarTroca e troca ponta a ponta (sem a CLI)", () => {
  const cenario = (): { panes: PaneParaTroca[]; spec: SpecConta[] } => {
    const r = prng(5);
    const spec: SpecConta[] = [];
    for (let i = 0; i < 10; i++) spec.push([`c${i}`, i < 7 ? "claude" : "codex", { w: [["five_hour", i % 3 === 0 ? 86 + (i % 5) : Math.round(r() * 80), 1 + r() * 4], ["weekly", Math.round(r() * 80), 10 + r() * 100]] }]);
    const estados = ["pronto", "trabalhando", "aguardando", "pronto"] as const;
    const panes = Array.from({ length: 20 }, (_, i) => paneT({ pane_id: `p${String(i).padStart(2, "0")}`, conta_id: `c${i % 7}`, estado: estados[i % 4] as PaneParaTroca["estado"] }));
    return { panes, spec };
  };
  it("avaliarTroca com 20 Panes × 10 contas: p95 ≤ 1 ms", () => {
    const { panes, spec } = cenario();
    const { usos, mundo } = mundoT(spec, { operacaoGit: new Set(["p03"]), perguntaPendente: new Set(["p07"]) });
    const cfg = config({ modo_troca: "automatico" });
    expect(avaliarTroca(panes, usos, cfg, mundo, AGORA).length).toBeGreaterThan(0);
    const t = medir(() => void avaliarTroca(panes, usos, cfg, mundo, AGORA));
    const p95 = percentil(t, 95);
    const r = registrar({ id: "P-107a", descricao: "avaliarTroca, 20 Panes × 10 contas, 10 000 chamadas (p95)", valor: p95, limite: 1, unidade: "ms", pior: Math.max(...t) });
    console.log(`P-107a: p95 ${p95.toFixed(4)} ms, mediana ${percentil(t, 50).toFixed(4)} ms, máx ${Math.max(...t).toFixed(3)} ms`);
    expect(r.ok).toBe(true);
  });
  it("ciclo do executor até o movimento (portas falsas, sem CLI): p95 ≤ 1 s", async () => {
    const tempos: number[] = [];
    for (let i = 0; i < 200; i++) {
      const { usos, mundo } = mundoT([["c1", "claude", { w: [["five_hour", 88, 3]] }], ["c2", "claude", { w: [["five_hour", 10, 3]] }]]);
      let n = 0;
      const exec = criarExecutorTroca({
        agora: () => AGORA,
        lerMundo: () => ({ panes: [paneT()], usos, config: config({ modo_troca: "automatico" }), mundo }),
        registrarDecisao: () => ({ id: "dec_1" }),
        inserirTroca: (x) => ({ ...x, id: `trc_${++n}`, criado_em: "", adiada_por: null, mission_id: null, task_ref: null, pane_novo_id: null, faixa: null, decisao_id: null }) as unknown as ReturnType<Parameters<typeof criarExecutorTroca>[0]["inserirTroca"]>,
        atualizarTroca: (id) => ({ id }) as unknown as ReturnType<Parameters<typeof criarExecutorTroca>[0]["atualizarTroca"]>,
        obterTroca: () => undefined,
        moverPane: async () => ({ novo_pane_id: "p1" }),
        ignorarSugestaoAte: () => undefined,
        avisar: () => undefined,
        emitir: () => undefined,
      });
      const a = performance.now();
      await exec.ciclo("ws1");
      tempos.push(performance.now() - a);
    }
    const p95 = percentil(tempos, 95);
    const r = registrar({ id: "P-107b", descricao: "troca ponta a ponta (decisão → pedido de novo Pane), portas falsas, 200 ciclos (p95)", valor: p95, limite: 1000, unidade: "ms", pior: Math.max(...tempos) });
    console.log(`P-107b: p95 ${p95.toFixed(4)} ms, máx ${Math.max(...tempos).toFixed(3)} ms`);
    expect(r.ok).toBe(true);
  });
  it("classificar (task_type) com entrada de 2 000 caracteres: p95 ≤ 0,1 ms", () => {
    const base = "Investigar a causa raiz do erro intermitente no upload e depois refatorar o módulo de contas, ajustar o layout da tela e documentar no README. ";
    const texto = base.repeat(20).slice(0, 2000);
    const t = medir(() => void classificar(texto));
    const p95 = percentil(t, 95);
    const r = registrar({ id: "P-107c", descricao: "classificar task_type, 2 000 caracteres, 10 000 chamadas (p95)", valor: p95, limite: 0.1, unidade: "ms", pior: Math.max(...t) });
    console.log(`P-107c: p95 ${p95.toFixed(5)} ms, mediana ${percentil(t, 50).toFixed(5)} ms`);
    expect(r.ok).toBe(true);
  });
});
