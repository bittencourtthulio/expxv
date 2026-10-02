// Orçamentos do medidor de CPU e memória (D-530…), Node puro, sem Electron e sem rede. Mede o custo REAL no processo (user + system de
// `process.cpuUsage()`, que inclui o spawn do `vm_stat` no macOS) de amostras consecutivas do serviço de produção:
//  - P-431: custo médio por amostra no main ≤ 1 ms (CPU + memória do sistema; no macOS a memória é lida a cada 2ª amostra).
//  - P-432: CPU do próprio medidor ≤ 0,3% de um núcleo (custo por amostra ÷ intervalo de 2 s).
//  - P-433: ociosidade: 60 s simulados com o medidor oculto (sem assinante) = 0 leituras e 0 timers.
import { cpus, platform } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { INTERVALO_AMOSTRA_MS } from "../../src/compartilhado/sistema";
import { temposDe } from "../../src/nucleo/sistema/cpu";
import { executarReal } from "../../src/nucleo/sistema/executar";
import { fontesReais, lerMemoriaSistema } from "../../src/nucleo/sistema/leitores";
import { criarServicoSistema } from "../../src/nucleo/sistema/servico";
import { gravarMedicoes, registrar } from "./registro";

afterAll(() => gravarMedicoes());

const AMOSTRAS = 40;

describe("P-431/P-432: custo do medidor por amostra", () => {
  it("≤ 1 ms por amostra no main e ≤ 0,3% de CPU", async () => {
    const fontes = fontesReais(executarReal);
    const s = criarServicoSistema({
      lerTempos: () => temposDe(cpus()),
      lerMemoria: () => lerMemoriaSistema(fontes),
      memoriaACada: platform() === "darwin" ? 2 : 1,
      publicar: () => undefined,
      agendar: () => ({ cancelar: () => undefined }),
      agora: Date.now,
    });
    await s.amostrarAgora(); // leitura-base (primeira amostra não mede)
    for (let i = 0; i < 4; i++) await s.amostrarAgora(); // aquecimento (JIT, primeiro spawn)
    const antes = process.cpuUsage();
    const t0 = performance.now();
    let ultima = null;
    for (let i = 0; i < AMOSTRAS; i++) ultima = await s.amostrarAgora();
    const uso = process.cpuUsage(antes);
    const cpuMs = (uso.user + uso.system) / 1000;
    const porAmostraMs = cpuMs / AMOSTRAS;
    const pct = (porAmostraMs / INTERVALO_AMOSTRA_MS) * 100;
    const r1 = registrar({ id: "P-431", descricao: "Medidor de CPU/RAM: custo médio por amostra no main (CPU do processo, inclui o spawn do vm_stat no macOS)", valor: porAmostraMs, limite: 1, unidade: "ms" });
    const r2 = registrar({ id: "P-432", descricao: "Medidor de CPU/RAM: CPU do próprio medidor a 1 amostra por 2 s", valor: pct, limite: 0.3, unidade: "% de um núcleo" });
    expect(ultima).not.toBeNull();
    expect(Number.isInteger(ultima!.cpu) && Number.isInteger(ultima!.ram)).toBe(true);
    expect(performance.now() - t0).toBeGreaterThan(0);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });
});

describe("P-433: medidor oculto não custa nada", () => {
  it("sem assinante: nenhuma leitura e nenhum timer em 60 s de relógio acelerado", async () => {
    let leituras = 0;
    let timers = 0;
    const s = criarServicoSistema({
      lerTempos: () => { leituras++; return temposDe(cpus()); },
      lerMemoria: async () => { leituras++; return { total: 1, usada: 0, disponivel: 1 }; },
      publicar: () => undefined,
      agendar: () => { timers++; return { cancelar: () => undefined }; },
      agora: () => 0,
    });
    s.definirAssinatura(false);
    s.aoJanela({ focada: true });
    s.aoJanela({ visivel: true });
    await s.detalhe(false);
    registrar({ id: "P-433", descricao: "Medidor de CPU/RAM oculto (preferência): timers + leituras em 60 s", valor: timers + leituras, limite: 0, unidade: "ocorrências" });
    expect(timers + leituras).toBe(0);
    expect(s.ativo()).toBe(false);
  });
});
