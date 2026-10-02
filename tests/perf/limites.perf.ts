// Orçamentos da Fase 9 que a área A (limites) permite medir sem Electron (03/fase-09 §Orçamentos). Node puro, sem rede,
// sem ler credencial: fixtures sintéticas em pasta temporária.
//  - P-100: ciclo de leitura de 5 contas (2 Codex com 50 MB de rollouts + 3 Claude com statusline) ≤ 150 ms POR CONTA,
//    e nenhuma tarefa do event loop > 50 ms durante o ciclo (histograma de atraso do loop).
//  - P-104: intervalo mínimo entre leituras de uma conta ≥ 60 s com relógio acelerado (ciclo + rajada de "sujo");
//    sem foco = 0 leituras; CPU do serviço com 5 contas em 60 s ≤ 0,5% de um núcleo (CPU de um ciclo ÷ 60 s).
//  - LIM-01: normalizar + derivar + agregar 200 contas ≤ 5 ms (mediana).
//  - LIM-02: detecção de limite no PTY ≤ 0,2 ms por chunk de 64 KB (mediana).
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";
import type { LimitSnapshot } from "../../src/compartilhado/limites";
import type { AdaptadorLimite, ContaLimite } from "../../src/nucleo/limites/adaptadores/adaptador";
import { caminhoStatusline, criarAdaptadorClaudeStatusline } from "../../src/nucleo/limites/adaptadores/claude-statusline";
import { criarAdaptadorCodexRollout } from "../../src/nucleo/limites/adaptadores/codex-rollout";
import { agregarCotas } from "../../src/nucleo/limites/agregar";
import { derivarUso } from "../../src/nucleo/limites/derivar";
import { criarDetectorLimite } from "../../src/nucleo/limites/padroes-limite";
import { criarLimitsService, type Agendador } from "../../src/nucleo/limites/servico";
import { normalizarSnapshot } from "../../src/nucleo/limites/validar";
import { gravarMedicoes, percentil, registrar } from "./registro";

const pastas: string[] = [];
afterAll(() => {
  gravarMedicoes();
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});
const tmp = (): string => {
  const p = mkdtempSync(join(tmpdir(), "ade-perf-limites-"));
  pastas.push(p);
  return p;
};

/** ~50 MB de rollouts (3 arquivos) com o `rate_limits` perto do final de cada um. */
function gerarCodex(raiz: string): void {
  const ruido = JSON.stringify({ timestamp: "2026-09-28T13:00:00.000Z", type: "response_item", payload: { type: "message", content: [{ text: "x".repeat(900) }] } }) + "\n";
  const bloco = ruido.repeat(1000);
  const modelo = join(raiz, "modelo.jsonl");
  writeFileSync(modelo, "");
  for (let i = 0; i < 18; i++) appendFileSync(modelo, bloco); // ~17 MB
  appendFileSync(modelo, JSON.stringify({ timestamp: "2026-09-28T14:00:00.000Z", type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: 61, window_minutes: 300, resets_at: 1790900000 }, secondary: { used_percent: 20, window_minutes: 10080, resets_at: 1791058572 } } } }) + "\n");
  appendFileSync(modelo, ruido.repeat(20));
  for (const dia of ["26", "27", "28"]) {
    const dir = join(raiz, "sessions/2026/09", dia);
    mkdirSync(dir, { recursive: true });
    copyFileSync(modelo, join(dir, `rollout-2026-09-${dia}T10-00-00-perf.jsonl`));
  }
  rmSync(modelo);
}

const contaCodex = (id: string, dir: string): ContaLimite => ({ id, provedor: "codex", rotulo: id, config_dir: dir, habilitada: true });
const contaClaude = (id: string): ContaLimite => ({ id, provedor: "claude", rotulo: id, config_dir: null, habilitada: true });

describe("P-100: ciclo de leitura de 5 contas (50 MB de rollouts do Codex)", () => {
  it("≤ 150 ms por conta e nenhuma tarefa do loop > 50 ms", async () => {
    const base = tmp();
    const pastaDeDados = join(base, "dados");
    const cx = ["cx1", "cx2"].map((id) => {
      const dir = join(base, id);
      mkdirSync(dir, { recursive: true });
      gerarCodex(dir);
      return contaCodex(id, dir);
    });
    const cl = ["cl1", "cl2", "cl3"].map(contaClaude);
    for (const c of cl) {
      const alvo = caminhoStatusline(pastaDeDados, c.id)!;
      mkdirSync(join(alvo, ".."), { recursive: true });
      writeFileSync(alvo, JSON.stringify({ v: 1, recebido_em: new Date().toISOString(), rate_limits: { five_hour: { used_percentage: 40, resets_at: Math.floor(Date.now() / 1000) + 3600 }, seven_day: { used_percentage: 20, resets_at: Math.floor(Date.now() / 1000) + 86400 } } }));
    }
    const contas = [...cx, ...cl];
    const adaptadores = [criarAdaptadorCodexRollout(), criarAdaptadorClaudeStatusline({ pastaDeDados })];
    const porConta: number[] = [];
    const medidos = adaptadores.map<AdaptadorLimite>((a) => ({
      ...a,
      aplicavel: (c) => a.aplicavel(c),
      ler: async (c, ctx) => {
        const t0 = performance.now();
        const r = await a.ler(c, ctx);
        porConta.push(performance.now() - t0);
        return r;
      },
    }));
    let salto = 0; // relógio do serviço avança sem esperar (o botão do usuário só relê depois de 5 s)
    const svc = criarLimitsService({ contas: () => contas, adaptadores: medidos, agora: () => Date.now() + salto, foco: () => true, emitir: () => undefined });
    const loop = monitorEventLoopDelay({ resolution: 5 });
    loop.enable();
    const piores: number[] = [];
    for (let i = 0; i < 5; i++) {
      porConta.length = 0;
      loop.reset();
      await svc.atualizar();
      const r = svc.snapshot();
      expect(r.geral.cobertura.com_dado).toBe(5);
      piores.push(Math.max(...porConta));
      salto += 6_000;
    }
    loop.disable();
    const maxLoopMs = loop.max / 1e6;
    const pior = Math.max(...piores);
    const mediana = percentil(piores, 50);
    const r1 = registrar({ id: "P-100", descricao: "leitura de limites de 1 conta (Codex 50 MB / Claude statusline), mediana das rodadas", valor: mediana, limite: 150, unidade: "ms", pior });
    const r2 = registrar({ id: "P-100-loop", descricao: "maior atraso do event loop durante o ciclo de 5 contas", valor: maxLoopMs, limite: 50, unidade: "ms" });
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
  }, 90_000);
});

describe("P-104: no máximo 1 leitura por conta a cada 60 s, só com foco, CPU ocioso", () => {
  function relogio() {
    let agora = 1_800_000_000_000;
    let seq = 0;
    const timers = new Map<number, { em: number; fn: () => void }>();
    const agendador: Agendador = {
      setTimeout(fn, ms) {
        const id = ++seq;
        timers.set(id, { em: agora + ms, fn });
        return id;
      },
      clearTimeout: (id) => void timers.delete(id as number),
    };
    const assentar = async (): Promise<void> => {
      for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
    };
    return {
      agendador,
      agora: () => agora,
      async avancar(ms: number): Promise<void> {
        const alvo = agora + ms;
        for (;;) {
          const prox = [...timers.entries()].filter(([, t]) => t.em <= alvo).sort((a, b) => a[1].em - b[1].em || a[0] - b[0])[0];
          if (prox === undefined) break;
          timers.delete(prox[0]);
          agora = Math.max(agora, prox[1].em);
          prox[1].fn();
          await assentar();
        }
        agora = alvo;
        await assentar();
      },
    };
  }
  const snapDe = (c: ContaLimite, agora: number): LimitSnapshot => ({ account_id: c.id, provider: c.provedor, fetched_at: new Date(agora).toISOString(), fonte: "claude_statusline", confianca: "medido", status: "ok", windows: [{ kind: "five_hour", used_pct: 10, resets_at: new Date(agora + 3_600_000).toISOString() }], model_buckets: {} });

  it("intervalo mínimo entre leituras ≥ 60 s (ciclo + rajada de 'sujo'); sem foco = 0 leituras", async () => {
    const contas = ["a", "b", "c", "d", "e"].map(contaClaude);
    const rel = relogio();
    const instantes = new Map<string, number[]>();
    const ad: AdaptadorLimite = { id: "f", fonte: "claude_statusline", provedores: null, intervalo_min_s: 60, rede: false, aplicavel: () => true, ler: async (c) => { const l = instantes.get(c.id) ?? []; l.push(rel.agora()); instantes.set(c.id, l); return snapDe(c, rel.agora()); } };
    let foco = true;
    const svc = criarLimitsService({ contas: () => contas, adaptadores: [ad], agora: rel.agora, agendador: rel.agendador, foco: () => foco, emitir: () => undefined });
    svc.iniciar();
    for (let i = 0; i < 600; i++) {
      await rel.avancar(1_000);
      if (i % 3 === 0) for (const c of contas) svc.marcarSuja(c.id);
    }
    let menor = Number.POSITIVE_INFINITY;
    for (const l of instantes.values()) for (let i = 1; i < l.length; i++) menor = Math.min(menor, (l[i] as number) - (l[i - 1] as number));
    const r1 = registrar({ id: "P-104-intervalo", descricao: "menor intervalo entre leituras de uma conta (10 min simulados, rajada de sujo a cada 3 s)", valor: menor, limite: 60_000, unidade: "ms", sentido: "min", semFator: true });
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    // sem foco
    foco = false;
    const antes = svc.estatisticas().leituras;
    for (let i = 0; i < 300; i++) {
      await rel.avancar(1_000);
      for (const c of contas) svc.marcarSuja(c.id);
    }
    const r2 = registrar({ id: "P-104-semfoco", descricao: "leituras automáticas em 5 min sem foco", valor: svc.estatisticas().leituras - antes, limite: 0, unidade: "leituras", semFator: true });
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
    svc.parar();
  }, 60_000);

  it("CPU de 5 contas por ciclo de 60 s ≤ 0,5% de um núcleo", async () => {
    const base = tmp();
    const pastaDeDados = join(base, "dados");
    const cx = contaCodex("cx1", join(base, "cx1"));
    mkdirSync(cx.config_dir!, { recursive: true });
    gerarCodex(cx.config_dir!);
    const cl = ["cl1", "cl2", "cl3", "cl4"].map(contaClaude);
    for (const c of cl) {
      const alvo = caminhoStatusline(pastaDeDados, c.id)!;
      mkdirSync(join(alvo, ".."), { recursive: true });
      writeFileSync(alvo, JSON.stringify({ v: 1, recebido_em: new Date().toISOString(), rate_limits: { five_hour: { used_percentage: 40, resets_at: Math.floor(Date.now() / 1000) + 3600 } } }));
    }
    let salto = 0;
    const svc = criarLimitsService({ contas: () => [cx, ...cl], adaptadores: [criarAdaptadorCodexRollout(), criarAdaptadorClaudeStatusline({ pastaDeDados })], agora: () => Date.now() + salto, foco: () => true, emitir: () => undefined });
    await svc.atualizar(); // aquece o cache do SO e o JIT
    salto += 6_000;
    const cpu0 = process.cpuUsage();
    await svc.atualizar();
    const cpu = process.cpuUsage(cpu0);
    expect(svc.estatisticas().leituras).toBe(10); // 5 contas × 2 ciclos: o segundo ciclo leu de verdade
    const ms = (cpu.user + cpu.system) / 1000;
    const pct = (ms / 60_000) * 100; // um ciclo por minuto
    const r = registrar({ id: "P-104-cpu", descricao: "CPU de um ciclo de 5 contas ÷ 60 s (equivale ao uso ocioso)", valor: pct, limite: 0.5, unidade: "% de 1 núcleo" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }, 30_000);
});

describe("LIM-01: normalizar, derivar e agregar 200 contas", () => {
  it("≤ 5 ms (mediana de 50 execuções)", () => {
    const agora = Date.now();
    const brutos = Array.from({ length: 200 }, (_, i) => ({ recebido_em: new Date(agora - i * 1000).toISOString(), rate_limits: { five_hour: { used_percentage: (i * 7) % 100 || 3, resets_at: Math.floor(agora / 1000) + 3600 }, seven_day: { used_percentage: (i * 3) % 100 || 2, resets_at: Math.floor(agora / 1000) + 86400 }, seven_day_opus: { used_percentage: 50, resets_at: Math.floor(agora / 1000) + 86400 } } }));
    const rodar = (): number => {
      const t0 = performance.now();
      const usos = brutos.map((b, i) => derivarUso(normalizarSnapshot(b, { id: `conta_${i}`, provedor: "claude" }, { agora, fonte: "claude_statusline" }), agora));
      const g = agregarCotas(usos);
      expect(g.cobertura.total).toBe(200);
      return performance.now() - t0;
    };
    for (let i = 0; i < 10; i++) rodar();
    const amostras = Array.from({ length: 50 }, rodar);
    const r = registrar({ id: "LIM-01", descricao: "normalizar + derivar + agregar 200 contas", valor: percentil(amostras, 50), limite: 5, unidade: "ms", pior: Math.max(...amostras) });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe("LIM-02: detecção de limite no PTY", () => {
  it("≤ 0,2 ms por chunk de 64 KB (mediana)", () => {
    const linha = "const resultado = calcular(entrada, opcoes); // código comum sem nada especial\r\n";
    const chunk = linha.repeat(Math.ceil(65_536 / linha.length)).slice(0, 65_536);
    const d = criarDetectorLimite("claude")!;
    for (let i = 0; i < 50; i++) d.processar(chunk, i);
    const amostras: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t0 = performance.now();
      d.processar(chunk, 1_000 + i);
      amostras.push(performance.now() - t0);
    }
    const r = registrar({ id: "LIM-02", descricao: "padrões de limite em 1 chunk de 64 KB", valor: percentil(amostras, 50), limite: 0.2, unidade: "ms", pior: Math.max(...amostras) });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
