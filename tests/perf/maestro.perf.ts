// Orçamentos do Maestro, parte NÚCLEO PURO (Fase 16; 03-ORCAMENTOS-DESEMPENHO.md, faixa P-200+): Node puro, sem Electron, sem rede.
//  - P-210: `classificarIntencao` (1 000 chars): p95 ≤ 5 ms, p99 ≤ 8 ms; carga única do léxico ≤ 10 ms; acurácia ≥ 90% no corpus.
//  - P-211: pedir → plano proposto (regras + planoDeEtapas + perfis + gravar plano e recibo em memória): p95 ≤ 50 ms; `planejar` p95 ≤ 5 ms.
//  - P-212: decisor desligado = 0 chamadas e 0 instâncias; decisor ligado e sem resposta: ≤ 2 100 ms (timeout 2 000).
//  - P-217: `planoDeEtapas` ≤ 5 ms; `verificarPiso` ≤ 20 ms; `etapaConcluida` ≤ 2 ms.
//  - P-218: decisão da máquina de estados (`avancar`) ≤ 100 ms.
//  - P-219: mesclar 50 chaves do hooks.json ≤ 10 ms; backup + escrita atômica ≤ 50 ms (disco real).
//  - P-221: memória de 10 pipelines ativos + léxico ≤ 5 MB (estimada por serialização; o RSS é do e2e).
//  - P-224: importar/exportar a configuração de 45 etapas ≤ 50 ms.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { trab } from "../fixtures/metodo/construtores";
import { criarMundo, ocorrencia, WS } from "../fixtures/maestro/mundo";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());

const AQUECIMENTO = 200;
function medir(f: () => void, n: number): number[] {
  for (let i = 0; i < AQUECIMENTO; i++) f();
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    f();
    t.push(performance.now() - a);
  }
  return t;
}

describe("P-210: classificação de intenção", () => {
  it("p95 ≤ 5 ms, p99 ≤ 8 ms (1 000 chars); carga do léxico ≤ 10 ms; acurácia ≥ 90% no corpus", async () => {
    const t0 = performance.now();
    vi.resetModules();
    const { classificarIntencao } = await import("../../src/nucleo/maestro/intencao/classificar");
    const carga = performance.now() - t0;
    const texto = "corrige o erro do login depois da atualização, o botão de entrar não funciona e a tela fica carregando ".repeat(10).slice(0, 1000);
    const t = medir(() => void classificarIntencao(texto), 3000);
    const p95 = percentil(t, 95);
    const p99 = percentil(t, 99);
    const corpus = readFileSync(join(__dirname, "../fixtures/maestro/corpus.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { t: string; i: string; adv: boolean });
    const normais = corpus.filter((l) => !l.adv);
    const acertos = normais.filter((l) => classificarIntencao(l.t).intencao === l.i).length;
    const acuracia = (100 * acertos) / normais.length;
    console.log(`P-210: p95 ${p95.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, carga ${carga.toFixed(2)} ms, acurácia ${acuracia.toFixed(1)}% (${acertos}/${normais.length}), corpus ${corpus.length}`);
    expect(registrar({ id: "P-210a", descricao: "classificarIntencao 1 000 chars (p95)", valor: p95, limite: 5, unidade: "ms", pior: Math.max(...t) }).ok).toBe(true);
    expect(registrar({ id: "P-210b", descricao: "classificarIntencao 1 000 chars (p99)", valor: p99, limite: 8, unidade: "ms" }).ok).toBe(true);
    expect(registrar({ id: "P-210c", descricao: "carga única do léxico e do classificador", valor: carga, limite: 10, unidade: "ms", semFator: false }).ok).toBe(true);
    expect(registrar({ id: "P-210d", descricao: "acurácia top-1 no corpus de intenção", valor: acuracia, limite: 90, unidade: "%", sentido: "min", semFator: true }).ok).toBe(true);
  });
});

describe("P-211: pedir → plano proposto", () => {
  it("pedir (regras + plano + perfis + gravar) p95 ≤ 50 ms; planejar p95 ≤ 5 ms", async () => {
    const m = criarMundo();
    const pedido = { workspace_id: WS, texto: "corrige, estou com um problema no login: o botão de entrar não funciona", contexto: null, via: "api" as const, nivel_pedido: null, executar_direto: null };
    const t: number[] = [];
    for (let i = 0; i < 300; i++) {
      m.avancarTempo(200_000); // fora da janela de idempotência
      const a = performance.now();
      await m.servico.pedir({ ...pedido, texto: `${pedido.texto} ${i}` });
      t.push(performance.now() - a);
    }
    const p95 = percentil(t.slice(50), 95);
    console.log(`P-211: pedir p95 ${p95.toFixed(3)} ms`);
    expect(registrar({ id: "P-211a", descricao: "pedir → plano proposto, em memória (p95)", valor: p95, limite: 50, unidade: "ms", pior: Math.max(...t) }).ok).toBe(true);
    const { planejar } = await import("../../src/nucleo/maestro/planejar");
    const { EVIDENCIA_VAZIA } = await import("../../src/nucleo/maestro/rigidez/plano-de-etapas");
    const tp = medir(() => void planejar({ intencao: "bug", confianca: 0.9, candidatas: [], retomar: null, fonte: "regra" }, 4, { id: "x", agora_ms: 0, evidencia: { ...EVIDENCIA_VAZIA, legado: true, convencoes: true, design_system: true }, permissao: "equilibrado" }), 2000);
    expect(registrar({ id: "P-211b", descricao: "planejar (plano completo, nível 4) p95", valor: percentil(tp, 95), limite: 5, unidade: "ms" }).ok).toBe(true);
  });
});

describe("P-212: decisor", () => {
  it("desligado = 0 chamadas e 0 instâncias; ligado sem resposta ≤ 2 100 ms", async () => {
    const { CONFIG_DECISOR_PADRAO, criarDecisorDeIntencao } = await import("../../src/nucleo/maestro/decisor/cliente");
    const criar = vi.fn(() => ({ ask: async () => { throw new Error("rede tocada"); } }));
    const desligado = criarDecisorDeIntencao({ config: () => CONFIG_DECISOR_PADRAO, criarAsk: criar });
    for (let i = 0; i < 100; i++) await desligado.consultar("corrige o erro", "api");
    expect(registrar({ id: "P-212a", descricao: "decisor desligado: instâncias do cliente criadas", valor: criar.mock.calls.length, limite: 0, unidade: "instâncias", semFator: true }).ok).toBe(true);
    const ligado = criarDecisorDeIntencao({
      config: () => ({ ...CONFIG_DECISOR_PADRAO, habilitado: true, consentimento_em: "2026-10-01T00:00:00.000Z", fonte: "openrouter", timeout_ms: 2000 }),
      criarAsk: () => ({ ask: () => new Promise(() => undefined) }),
    });
    const a = performance.now();
    const r = await ligado.consultar("corrige o erro do login", "api");
    const ms = performance.now() - a;
    expect(r).toMatchObject({ ok: false, motivo: "timeout" });
    expect(registrar({ id: "P-212b", descricao: "decisor ligado sem resposta: tempo até seguir pela regra", valor: ms, limite: 2100, unidade: "ms" }).ok).toBe(true);
  }, 10_000);
});

describe("P-217 / P-218: plano de etapas, piso, conclusão e máquina de estados", () => {
  it("planoDeEtapas ≤ 5 ms; verificarPiso ≤ 20 ms; etapaConcluida ≤ 2 ms; avancar ≤ 100 ms", async () => {
    const { planoDeEtapas, EVIDENCIA_VAZIA } = await import("../../src/nucleo/maestro/rigidez/plano-de-etapas");
    const { verificarPiso } = await import("../../src/nucleo/maestro/rigidez/piso");
    const { etapaConcluida } = await import("../../src/nucleo/maestro/etapas/conclusao");
    const { avancar, novoPipeline } = await import("../../src/nucleo/maestro/maquina");
    const { planejar } = await import("../../src/nucleo/maestro/planejar");
    const ev = { ...EVIDENCIA_VAZIA, legado: true, convencoes: true, design_system: true };
    const pe = medir(() => void planoDeEtapas("sprintx_legadox", 5, { evidencia: ev, permissao: "seguro" }), 3000);
    expect(registrar({ id: "P-217a", descricao: "planoDeEtapas (sprintx_legadox, nível 5) p95", valor: percentil(pe, 95), limite: 5, unidade: "ms" }).ok).toBe(true);
    const plano = planejar({ intencao: "feature", confianca: 0.9, candidatas: [], retomar: null, fonte: "regra" }, 5, { id: "mpl_p", agora_ms: 0, evidencia: ev });
    const tr = trab({});
    const pv = medir(() => void verificarPiso({ pipeline_id: "sprintx", nivel: 5, evidencia: ev, trabalho: tr, plano: plano.etapas, rastro: { suite_ok_apos_ultima_alteracao: true }, segredos: [] }), 2000);
    expect(registrar({ id: "P-217b", descricao: "verificarPiso (I1..I10) p95", valor: percentil(pv, 95), limite: 20, unidade: "ms" }).ok).toBe(true);
    const pc = medir(() => void etapaConcluida("sprintx.f5", tr), 5000);
    expect(registrar({ id: "P-217c", descricao: "etapaConcluida p95", valor: percentil(pc, 95), limite: 2, unidade: "ms" }).ok).toBe(true);
    const base = novoPipeline({ id: "mpl_p", workspace_id: "w", mission_id: null, trabalho_id: null, pipeline_id: plano.pipeline_id, intencao: plano.intencao, via: "api", origem_pane_id: null, texto_hash: "h", texto_resumo: "r", nivel_base: 5, nivel_atual: 5, nivel_pedido: null, executar_direto: false, voltar_ao_padrao: false, plano, criado_em: "", atualizado_em: "", override_trava: false } as never, 0);
    const executando = { ...base, estado: "executando" as const };
    const pa = medir(() => void avancar(executando, { agora_ms: 1000, trabalho: ocorrencia("e1"), sondas: { existe: () => false, mtime: () => null }, panes: {}, max_terminais: 6, timeout_sem_progresso_ms: 1_800_000, fechar_concluidos: true }), 2000);
    console.log(`P-217/218: plano p95 ${percentil(pe, 95).toFixed(4)} ms, piso p95 ${percentil(pv, 95).toFixed(4)} ms, conclusão p95 ${percentil(pc, 95).toFixed(4)} ms, avancar p95 ${percentil(pa, 95).toFixed(4)} ms`);
    expect(registrar({ id: "P-218", descricao: "máquina de estados: decisão da próxima etapa (avancar) p95", valor: percentil(pa, 95), limite: 100, unidade: "ms" }).ok).toBe(true);
  });
});

describe("P-219: hooks.json no disco real", () => {
  it("mesclar 50 chaves ≤ 10 ms; backup + escrita atômica ≤ 50 ms", async () => {
    const { aplicarHooks, criarPortaArquivosHooksNode, hooksDoNivel, mesclar } = await import("../../src/nucleo/maestro/rigidez/hooks");
    const muitas: Record<string, string> = {};
    for (let i = 0; i < 50; i++) muitas[`hook-do-usuario-${i}`] = "aviso";
    const tm = medir(() => void mesclar({ hooks: muitas }, hooksDoNivel(4), { nivel: 4, agora: "t" }), 500);
    expect(registrar({ id: "P-219a", descricao: "ler + mesclar hooks.json (50 chaves) p95", valor: percentil(tm, 95), limite: 10, unidade: "ms" }).ok).toBe(true);
    const raiz = mkdtempSync(join(tmpdir(), "maestro-perf-"));
    try {
      mkdirSync(join(raiz, ".expx"));
      const porta = criarPortaArquivosHooksNode(raiz);
      const tw: number[] = [];
      for (let i = 0; i < 20; i++) {
        const a = performance.now();
        await aplicarHooks(porta, i % 2 === 0 ? 4 : 5, { agora: () => new Date(Date.UTC(2026, 9, 1, 12, i, 0)) });
        tw.push(performance.now() - a);
      }
      expect(registrar({ id: "P-219b", descricao: "backup + escrita atômica do hooks.json (mediana de 20)", valor: percentil(tw, 50), limite: 50, unidade: "ms", pior: Math.max(...tw) }).ok).toBe(true);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});

describe("P-221: memória do Maestro", () => {
  it("10 pipelines ativos + léxico ≤ 5 MB (estimativa por serialização)", async () => {
    const { LEXICO } = await import("../../src/nucleo/maestro/intencao/lexico");
    const m = criarMundo();
    for (let i = 0; i < 10; i++) {
      m.avancarTempo(200_000);
      const { plano } = await m.servico.pedir({ workspace_id: WS, texto: `corrige o erro do login numero ${i}`, contexto: null, via: "api", nivel_pedido: 5, executar_direto: null });
      await m.servico.confirmar(plano.id);
    }
    const bytes = JSON.stringify(m.persistencia.todos()).length + JSON.stringify(LEXICO).length;
    console.log(`P-221: ${(bytes / 1024).toFixed(0)} KB`);
    expect(registrar({ id: "P-221", descricao: "10 pipelines ativos + léxico (serializado)", valor: bytes / 1_048_576, limite: 5, unidade: "MB", semFator: true }).ok).toBe(true);
  });
});

describe("P-224: importar/exportar pipelines", () => {
  it("45 etapas ≤ 50 ms", async () => {
    const { exportarConfig, importarPrevia } = await import("../../src/nucleo/maestro/perfis/portabilidade");
    const { configsDeFabrica } = await import("../../src/nucleo/maestro/perfis/padroes");
    const ctx = { cli: () => null, provedorDaCli: () => null };
    const configs = configsDeFabrica();
    const t = medir(() => void importarPrevia(exportarConfig(configs), ctx), 300);
    expect(registrar({ id: "P-224", descricao: `exportar + importar (prévia) ${configs.length} etapas p95`, valor: percentil(t, 95), limite: 50, unidade: "ms" }).ok).toBe(true);
  });
});
