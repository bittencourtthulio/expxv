import { describe, expect, it, vi } from "vitest";
import type { AmostraSistema } from "../../compartilhado/sistema";
import type { TemposNucleo } from "./cpu";
import { criarServicoSistema, PRIMEIRA_AMOSTRA_MS, type DependenciasServicoSistema } from "./servico";

/** relógio e agendador falsos: `avancar` dispara os timers vencidos, em ordem. */
function montar(extra: Partial<DependenciasServicoSistema> = {}) {
  let agora = 1_000_000;
  const timers: Array<{ em: number; fn: () => void; vivo: boolean }> = [];
  let cpuTotal = 0;
  const publicadas: AmostraSistema[] = [];
  const lerMemoria = vi.fn(async () => ({ total: 1000, usada: 600, disponivel: 400 }));
  const lerTempos = vi.fn((): TemposNucleo[] => { cpuTotal += 100; return [{ ocioso: cpuTotal * 0.5, total: cpuTotal }]; });
  const s = criarServicoSistema({
    lerTempos, lerMemoria, publicar: (a) => publicadas.push(a), agora: () => agora,
    agendar: (fn, ms) => { const t = { em: agora + ms, fn, vivo: true }; timers.push(t); return { cancelar: () => { t.vivo = false; } }; },
    ...extra,
  });
  const vivos = () => timers.filter((t) => t.vivo).length;
  const avancar = async (ms: number): Promise<void> => {
    const alvo = agora + ms;
    for (let guarda = 0; guarda < 1000; guarda++) {
      const prox = timers.filter((t) => t.vivo && t.em <= alvo).sort((a, b) => a.em - b.em)[0];
      if (prox === undefined) break;
      prox.vivo = false; agora = prox.em; prox.fn();
      await new Promise((r) => setImmediate(r));
    }
    agora = alvo;
  };
  return { s, publicadas, lerMemoria, lerTempos, vivos, avancar };
}

describe("serviço do medidor", () => {
  it("sem assinante: zero timers e zero leituras", async () => {
    const m = montar();
    await m.avancar(60_000);
    expect(m.vivos()).toBe(0);
    expect(m.lerTempos).not.toHaveBeenCalled();
  });

  it("assinar lê a base, publica o primeiro delta em ~0,7 s e depois a cada 2 s (inteiros)", async () => {
    const m = montar();
    m.s.definirAssinatura(true);
    expect(m.vivos()).toBe(1);
    expect(m.publicadas).toHaveLength(0); // primeira amostra: só a leitura-base
    await m.avancar(PRIMEIRA_AMOSTRA_MS);
    expect(m.publicadas).toEqual([{ cpu: 50, ram: 60 }]);
    await m.avancar(2_000);
    await m.avancar(2_000);
    expect(m.publicadas).toHaveLength(3);
    expect(Object.values(m.publicadas[0]!).every(Number.isInteger)).toBe(true);
  });

  it("coalescência: religar logo depois não publica mais de 1 por 2 s", async () => {
    const m = montar();
    m.s.definirAssinatura(true);
    await m.avancar(PRIMEIRA_AMOSTRA_MS);
    expect(m.publicadas).toHaveLength(1);
    m.s.aoJanela({ minimizada: true });
    m.s.aoJanela({ minimizada: false });
    await m.avancar(500);
    expect(m.publicadas).toHaveLength(1);
    await m.avancar(1_600);
    expect(m.publicadas).toHaveLength(2);
  });

  it("janela oculta ou minimizada pausa por inteiro (zero timers) e retoma ao voltar", async () => {
    const m = montar();
    m.s.definirAssinatura(true);
    await m.avancar(PRIMEIRA_AMOSTRA_MS);
    m.s.aoJanela({ visivel: false });
    expect(m.vivos()).toBe(0);
    const lidas = m.lerTempos.mock.calls.length;
    await m.avancar(30_000);
    expect(m.lerTempos.mock.calls.length).toBe(lidas);
    m.s.aoJanela({ visivel: true });
    expect(m.vivos()).toBe(1);
  });

  it("desfocada: continua por 10 s e pausa depois, sem timer; voltar o foco retoma", async () => {
    const m = montar();
    m.s.definirAssinatura(true);
    await m.avancar(PRIMEIRA_AMOSTRA_MS);
    m.s.aoJanela({ focada: false });
    await m.avancar(8_000);
    expect(m.vivos()).toBe(1);
    await m.avancar(6_000);
    expect(m.vivos()).toBe(0);
    const n = m.publicadas.length;
    await m.avancar(20_000);
    expect(m.publicadas.length).toBe(n);
    m.s.aoJanela({ focada: true });
    expect(m.vivos()).toBe(1);
  });

  it("desassinar (medidor oculto pela preferência) zera os timers", async () => {
    const m = montar();
    m.s.definirAssinatura(true);
    await m.avancar(3_000);
    m.s.definirAssinatura(false);
    expect(m.vivos()).toBe(0);
    expect(m.s.ultima()).toBeNull();
  });

  it("memória a cada N amostras (macOS gasta um vm_stat): lê na 1ª, 3ª, 5ª…", async () => {
    const m = montar({ memoriaACada: 2 });
    m.s.definirAssinatura(true);
    await m.avancar(PRIMEIRA_AMOSTRA_MS + 2_000 * 4);
    expect(m.publicadas).toHaveLength(5);
    expect(m.lerMemoria).toHaveBeenCalledTimes(3);
  });

  it("falha na leitura da memória mantém a última e nunca derruba o ciclo", async () => {
    let n = 0;
    const m = montar({ lerMemoria: async () => { if (++n > 1) throw new Error("x"); return { total: 100, usada: 40, disponivel: 60 }; } });
    m.s.definirAssinatura(true);
    await m.avancar(PRIMEIRA_AMOSTRA_MS + 4_000);
    expect(m.publicadas.map((p) => p.ram)).toEqual([40, 40, 40]);
  });

  it("alerta de carga alta só dispara com a preferência ligada", async () => {
    const aoCargaAlta = vi.fn();
    let ligado = false;
    const m = montar({ aoCargaAlta, alertaLigado: () => ligado, lerMemoria: async () => ({ total: 100, usada: 95, disponivel: 5 }) });
    m.s.definirAssinatura(true);
    await m.avancar(PRIMEIRA_AMOSTRA_MS + 2_000);
    expect(aoCargaAlta).not.toHaveBeenCalled();
    ligado = true;
    await m.avancar(2_000);
    expect(aoCargaAlta).toHaveBeenCalledWith({ cpu: 50, ram: 95, motivo: "ram" });
    await m.avancar(10_000);
    expect(aoCargaAlta).toHaveBeenCalledTimes(1);
  });

  it("detalhe: só responde com o popover aberto, reaproveita por 1,5 s e encerra com aberto:false", async () => {
    const montarDetalhe = vi.fn(async () => ({ cpu_total: 1 }) as never);
    const m = montar({ montarDetalhe });
    m.s.definirAssinatura(true);
    expect(await m.s.detalhe(false)).toBeNull();
    expect(montarDetalhe).not.toHaveBeenCalled();
    await m.s.detalhe(true);
    await m.s.detalhe(true);
    expect(montarDetalhe).toHaveBeenCalledTimes(1);
    await m.avancar(2_000);
    await m.s.detalhe(true);
    expect(montarDetalhe).toHaveBeenCalledTimes(2);
    expect(await m.s.detalhe(false)).toBeNull();
  });

  it("encerrar cancela tudo", () => {
    const m = montar();
    m.s.definirAssinatura(true);
    m.s.encerrar();
    expect(m.vivos()).toBe(0);
    m.s.definirAssinatura(true);
    expect(m.vivos()).toBe(0);
  });
});
