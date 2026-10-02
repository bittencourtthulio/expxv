// Orçamentos da gestão ágil (Fase 18; núcleo puro, sem Electron): P-180, P-181, P-185, P-186, P-187, P-188, P-190.
// Dados sintéticos determinísticos (tests/fixtures/agil/gerar.ts: 200 trabalhos × 25 tasks = 5 000 tasks, 40 sprints). Banco em memória (a latência de SQLite entra na medição do coordenador).
// P-182 a P-184 e P-189 dependem de UI/main e ficam para a onda de ligação.
import { afterAll, describe, expect, it } from "vitest";
import { criarAgil, type Agil } from "../../src/nucleo/agil/agil";
import { configPadrao } from "../../src/nucleo/agil/config/padroes";
import { estimarHeuristica, type EntradaEstimativa } from "../../src/nucleo/agil/estimativa/heuristica";
import { estimarComIa, iniciarJobEstimativa } from "../../src/nucleo/agil/estimativa/ia";
import { gerarDaily } from "../../src/nucleo/agil/cerimonias/daily";
import { montarItensMetrica } from "../../src/nucleo/agil/metricas/dados";
import { FILTROS_VAZIOS, criarPainelComCache, montarPainel } from "../../src/nucleo/agil/metricas/painel";
import { preverTermino } from "../../src/nucleo/agil/metricas/previsao";
import { gravarSnapshots, serieSnapshots, snapshotsDoPainel } from "../../src/nucleo/agil/metricas/snapshots";
import { processarRetrabalho } from "../../src/nucleo/agil/retrabalho/processar";
import { sincronizar } from "../../src/nucleo/agil/fatos/sincronizar";
import { candidatosDoBacklog, sugerirCompromisso } from "../../src/nucleo/agil/sprint/planejamento";
import { prng } from "../../src/nucleo/agil/util";
import { gerarVolumeAgil, somaDias, WS } from "../fixtures/agil/gerar";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());
const mediana = (xs: number[]): number => percentil(xs, 50);
const agoraFixo = Date.parse("2027-12-01T12:00:00Z");

function novo(): Agil {
  const a = criarAgil({ relogio: () => agoraFixo });
  a.config.gravar(WS, {});
  return a;
}
const fontes = gerarVolumeAgil();
const deps = (a: Agil) => ({ banco: a.banco, metodo: a.portas.metodo, relogio: a.relogio, id: a.id, config: a.config.ler(WS) });

describe("P-180: sincronização dos fatos (5 000 tasks em 200 trabalhos)", () => {
  it("inicial ≤ 1,5 s; incremental de 1 trabalho alterado ≤ 80 ms", async () => {
    const a = novo();
    const t0 = performance.now();
    await sincronizar(deps(a), WS, { fontes });
    const inicial = performance.now() - t0;
    registrar({ id: "P-180a", descricao: "Sincronização inicial dos fatos agil (5 000 tasks, 200 trabalhos), núcleo", valor: inicial, limite: 1500, unidade: "ms" });
    expect(a.banco.fatos.valores()).toHaveLength(5000);
    const tempos: number[] = [];
    let atual = fontes;
    for (let k = 0; k < 7; k++) {
      const alterada = atual.map((f, i) => (i === k * 11 ? { ...f, versao_origem: `${f.versao_origem}-alt${k}` } : f));
      atual = alterada;
      const t1 = performance.now();
      const r = await sincronizar(deps(a), WS, { fontes: alterada });
      tempos.push(performance.now() - t1);
      expect(r.trabalhos_pulados).toBe(199);
    }
    registrar({ id: "P-180b", descricao: "Sincronização incremental (1 trabalho alterado de 200), mediana de 7", valor: mediana(tempos), limite: 80, unidade: "ms", pior: Math.max(...tempos) });
  });
});

describe("P-181, P-186, P-190: painel, retrabalho e snapshots (5 000 tasks, 40 sprints)", () => {
  let a: Agil;
  it("monta o mundo (sprints fechadas, estimativas, classificações)", async () => {
    a = novo();
    await sincronizar(deps(a), WS, { fontes });
    const itens = a.banco.itens.valores();
    const r = prng(11);
    itens.forEach((it, i) => {
      a.banco.estimativas.set(`e${i}`, { id: `e${i}`, item_id: it.id, versao: 1, pontos: [1, 2, 3, 5, 8][Math.floor(r() * 5)] as number, rotulo: null, escala_id: "fibonacci", min_h: null, max_h: null, origem: "ia", motor: "heuristica", confianca: 0.5, fatores: [], estado: "sugerida", ativa: true, nota: null, criado_em: "" });
      a.banco.classificacoes.set(`c${i}`, { id: `c${i}`, item_id: it.id, versao: 1, categoria: ["feature", "bug", "refator"][i % 3] as string, risco: ["baixo", "medio", "alto"][i % 3] as string as never, criticidade: "media", tipo_task: null, risco_fatores: [], origem: "ia", motor: "heuristica", confianca: 0.5, estado: "sugerida", ativa: true, criado_em: "" });
    });
    for (let s = 0; s < 40; s++) {
      const ini = somaDias("2026-01-05", s * 14);
      const id = `spr${s}`;
      a.banco.sprints.set(id, { id, workspace_id: WS, nome: `S${s}`, meta: null, inicio: ini, fim: somaDias(ini, 11), estado: s < 39 ? "fechada" : "ativa", capacidade_pontos: 40, compromisso_pontos: 40, iniciada_em: ini, fechada_em: s < 39 ? `${somaDias(ini, 12)}T12:00:00.000Z` : null, versao_lancamento: null, resumo_fechamento: null, criado_em: ini, atualizado_em: ini });
      itens.slice(s * 125, s * 125 + 125).forEach((it) => a.banco.sprintItens.set(`${id}|${it.id}`, { sprint_id: id, item_id: it.id, adicionado_em: `${ini}T00:00:00.000Z`, removido_em: null, pontos_compromisso: 3, no_compromisso_inicial: true, motivo: null, resultado: null }));
    }
    processarRetrabalho({ banco: a.banco, relogio: a.relogio, id: a.id, config: a.config.ler(WS) }, WS, fontes, []);
    expect(a.banco.sprints.valores()).toHaveLength(40);
  });
  it("P-181: painel com snapshot válido ≤ 150 ms; recomputando ≤ 400 ms", () => {
    const deps_ = { banco: a.banco, config: a.config.ler(WS), relogio: a.relogio };
    const frios: number[] = [];
    for (let k = 0; k < 7; k++) { const t = performance.now(); const p = montarPainel(deps_, WS, FILTROS_VAZIOS); frios.push(performance.now() - t); expect(p.base.tasks).toBe(5000); }
    registrar({ id: "P-181b", descricao: "Painel agil (16 séries) recomputando dos fatos, 5 000 tasks e 40 sprints, mediana de 7", valor: mediana(frios), limite: 400, unidade: "ms", pior: Math.max(...frios) });
    const cache = criarPainelComCache(deps_);
    cache.obter(WS);
    const quentes: number[] = [];
    for (let k = 0; k < 7; k++) { const t = performance.now(); const r = cache.obter(WS); quentes.push(performance.now() - t); expect(r.do_cache).toBe(true); }
    registrar({ id: "P-181a", descricao: "Painel agil com cache válido (a versão dos dados é conferida a cada pedido), mediana de 7", valor: mediana(quentes), limite: 150, unidade: "ms", pior: Math.max(...quentes) });
  });
  it("P-186: reavaliar 1 task após evento ≤ 20 ms; varredura completa de 5 000 tasks ≤ 400 ms", () => {
    const d = { banco: a.banco, relogio: a.relogio, id: a.id, config: a.config.ler(WS) };
    const uma: number[] = [];
    for (let k = 0; k < 9; k++) { const t = performance.now(); processarRetrabalho(d, WS, [fontes[k * 3] as (typeof fontes)[number]], []); uma.push(performance.now() - t); }
    registrar({ id: "P-186a", descricao: "Retrabalho: reavaliar 1 trabalho (25 tasks) após evento, mediana de 9", valor: mediana(uma), limite: 20, unidade: "ms", pior: Math.max(...uma) });
    const todas: number[] = [];
    for (let k = 0; k < 5; k++) { const t = performance.now(); processarRetrabalho(d, WS, fontes, []); todas.push(performance.now() - t); }
    registrar({ id: "P-186b", descricao: "Retrabalho: varredura completa de 5 000 tasks, mediana de 5", valor: mediana(todas), limite: 400, unidade: "ms", pior: Math.max(...todas) });
  });
  it("P-190: snapshot diário (gravação) ≤ 30 ms; série de 40 sprints ≤ 10 ms", () => {
    const p = montarPainel({ banco: a.banco, config: a.config.ler(WS), relogio: a.relogio }, WS, FILTROS_VAZIOS);
    const grav: number[] = [];
    for (let k = 0; k < 9; k++) { const t = performance.now(); gravarSnapshots(a.banco, snapshotsDoPainel(WS, somaDias("2027-01-01", k), p)); grav.push(performance.now() - t); }
    registrar({ id: "P-190a", descricao: "Snapshot diário do painel (gravação), mediana de 9", valor: mediana(grav), limite: 30, unidade: "ms", pior: Math.max(...grav) });
    for (let s = 0; s < 40; s++) gravarSnapshots(a.banco, [{ workspace_id: WS, escopo: "sprint", chave: `spr${s}`, dia: somaDias("2026-01-05", s * 14), metrica: "concluido", valor: s }]);
    const ser: number[] = [];
    for (let k = 0; k < 9; k++) { const t = performance.now(); for (let s = 0; s < 40; s++) serieSnapshots(a.banco, WS, "sprint", `spr${s}`, "concluido"); ser.push(performance.now() - t); }
    registrar({ id: "P-190b", descricao: "Consulta da série de 40 sprints (snapshots), mediana de 9", valor: mediana(ser), limite: 10, unidade: "ms", pior: Math.max(...ser) });
  });
  it("P-188: daily de uma sprint de 200 tasks e planejamento sugerido ≤ 100 ms", () => {
    const itens = montarItensMetrica(a.banco, WS).filter((i) => i.participacoes.some((p) => p.sprint_id === "spr39")).slice(0, 200);
    const d: number[] = [];
    for (let k = 0; k < 9; k++) { const t = performance.now(); gerarDaily({ itens, membros: [], rastro: [], bloqueios_abertos: [], agora: agoraFixo, config: configPadrao() }); d.push(performance.now() - t); }
    registrar({ id: "P-188a", descricao: "Daily gerada dos fatos (sprint de 200 tasks), mediana de 9", valor: mediana(d), limite: 100, unidade: "ms", pior: Math.max(...d) });
    const cand = candidatosDoBacklog(itens);
    const p: number[] = [];
    for (let k = 0; k < 9; k++) { const t = performance.now(); sugerirCompromisso({ candidatos: cand, concluidos: new Set(), capacidade: 300, config: configPadrao() }); p.push(performance.now() - t); }
    registrar({ id: "P-188b", descricao: "Planejamento sugerido (200 candidatos), mediana de 9", valor: mediana(p), limite: 100, unidade: "ms", pior: Math.max(...p) });
  });
});

describe("P-185: estimador heurístico e IA fora do caminho crítico", () => {
  const entrada = (i: number): EntradaEstimativa => ({ ref: `r${i}`, titulo: `Integrar pagamento ${i} com gateway e cadastro`, descricao: "x".repeat(200), criterios: ["a", "b", "c"], tipo_task: null, arquivos: ["src/a.ts", "src/b.ts", `migrations/${i}.sql`], depende_de: i % 4 === 0 ? ["a", "b", "c"] : [], origem: "metodo", ocorrencia_tipo: null, valor: 5, urgencia: 5, sinais: i % 3 === 0 ? { raio_alto: true } : {}, ftr_area: null, similar_sem_retrabalho: null });
  it("1 item ≤ 5 ms; lote de 500 ≤ 300 ms", () => {
    const c = configPadrao();
    for (let k = 0; k < 200; k++) estimarHeuristica(entrada(k), c);
    const um: number[] = [];
    for (let k = 0; k < 200; k++) { const t = performance.now(); estimarHeuristica(entrada(k), c); um.push(performance.now() - t); }
    registrar({ id: "P-185a", descricao: "Estimador heurístico, 1 item (p95 de 200)", valor: percentil(um, 95), limite: 5, unidade: "ms" });
    const lote: number[] = [];
    for (let k = 0; k < 5; k++) { const t = performance.now(); for (let i = 0; i < 500; i++) estimarHeuristica(entrada(i), c); lote.push(performance.now() - t); }
    registrar({ id: "P-185b", descricao: "Estimador heurístico, lote de 500 itens, mediana de 5", valor: mediana(lote), limite: 300, unidade: "ms" });
  });
  it("com CLI headless falsa LENTA (3 s) a ação devolve em ≤ 50 ms e o main nunca fica ocupado", async () => {
    const a = novo();
    const portas = { consentimento: { estimativaPorIa: async () => true }, perfil: { resolver: async () => ({ cli: "falsa", modelo: null, faixa: "rapido" }) }, headless: { executar: () => new Promise<{ texto: string; tokens: null }>((res) => setTimeout(() => res({ texto: "[]", tokens: null }), 3000)) } };
    let maiorAtraso = 0;
    let ultimo = performance.now();
    const timer = setInterval(() => { const n = performance.now(); maiorAtraso = Math.max(maiorAtraso, n - ultimo - 10); ultimo = n; }, 10);
    const t0 = performance.now();
    const job = iniciarJobEstimativa(() => estimarComIa({ banco: a.banco, portas, relogio: a.relogio, config: a.config.ler(WS) }, WS, [entrada(1)], () => ({ tem_criterio: true, similares: 0, n_calibracao: 0 })));
    const retorno = performance.now() - t0;
    const resultado = await job.concluido;
    clearInterval(timer);
    registrar({ id: "P-185c", descricao: "Ação de estimar por IA devolve o controle (CLI headless falsa de 3 s)", valor: retorno, limite: 50, unidade: "ms" });
    registrar({ id: "P-185d", descricao: "Maior atraso do event loop durante a chamada lenta da IA", valor: Math.max(0, maiorAtraso), limite: 50, unidade: "ms" });
    expect(resultado.chamadas).toBe(1); // a CLI lenta respondeu uma vez (saída válida e vazia: a ref fica com a heurística)
  }, 20_000);
});

describe("P-187: previsão Monte Carlo (10 000 simulações, 500 itens restantes)", () => {
  it("≤ 250 ms", () => {
    const amostra = Array.from({ length: 40 }, (_, i) => (i * 7) % 5);
    const base = { amostra, restante: 500, iteracoes: 10_000, semente: 1, dias_uteis_restantes: 10, hoje: "2027-12-01", config: configPadrao() };
    preverTermino({ ...base, iteracoes: 500 });
    const t: number[] = [];
    for (let k = 0; k < 7; k++) { const t0 = performance.now(); const r = preverTermino({ ...base, semente: k + 1 }); t.push(performance.now() - t0); expect(r.estado).toBe("ok"); }
    registrar({ id: "P-187", descricao: "Previsão Monte Carlo (10 000 simulações × 500 itens), mediana de 7", valor: mediana(t), limite: 250, unidade: "ms", pior: Math.max(...t) });
  });
});
