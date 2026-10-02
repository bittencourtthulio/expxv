// Histórico de consumo no main (Fase 9, T-09.09) com SQLite real em memória: grava só mudanças, prevê, mede a eficiência semanal e alerta; tudo sem timer nem rede.
import { afterEach, describe, expect, it } from "vitest";
import type { AccountUsage, RespostaLimites } from "../compartilhado/limites";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { criarHistoricoLimites } from "./limites-historico";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const MIN = 60_000;
const H = 3_600_000;
const bancos: Banco[] = [];
afterEach(() => bancos.splice(0).forEach((b) => b.fechar()));

function montar(inicial: { five?: number | null; weekly?: number | null; reset5?: number; resetSemana?: number } = {}) {
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  const repos = criarRepositorios(banco);
  const conta = repos.conta.criar({ provedor: "claude", rotulo: "pessoal" });
  let agora = T0;
  const estado = { five: inicial.five === undefined ? 10 : inicial.five, weekly: inicial.weekly === undefined ? 20 : inicial.weekly, reset5: inicial.reset5 ?? T0 + 4 * H, resetSemana: inicial.resetSemana ?? T0 + 5 * 24 * H, semUso: false };
  const uso = (): AccountUsage => ({
    account_id: conta.id, provider: "claude", fetched_at: new Date(agora).toISOString(), fonte: "claude_statusline", confianca: "medido", status: "ok",
    windows: [{ kind: "five_hour", used_pct: estado.five, resets_at: new Date(estado.reset5).toISOString() }, { kind: "weekly", used_pct: estado.weekly, resets_at: new Date(estado.resetSemana).toISOString() }],
    model_buckets: {}, bottleneck: "five_hour", slack_pct: 50, idade_s: 0, vencidas: [],
  });
  const snapshot = (): RespostaLimites => ({ contas: estado.semUso ? [] : [uso()], geral: { pior: null, folga_media_pct: null, cobertura: { com_dado: 1, total: 1 }, em_alerta: 0, esgotadas: 0 } });
  const h = criarHistoricoLimites({ repo: repos.limiteAmostra, snapshot, rotulos: () => ({ [conta.id]: "pessoal" }), agora: () => agora });
  return { banco, repos, conta, h, estado, avancar: (ms: number) => void (agora += ms), agora: () => agora };
}
const linhas = (m: ReturnType<typeof montar>, janela = "five_hour"): number => m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM limite_amostra WHERE janela = ?", [janela])?.n ?? 0;

describe("registrar: só mudanças, em lote", () => {
  it("a 1ª leitura grava as janelas com valor; repetir sem mudança não grava; mudança de ≥ 1 ponto depois de 60 s grava", () => {
    const m = montar();
    expect(m.h.registrar()).toBe(2);
    expect(m.h.registrar()).toBe(0);
    m.avancar(2 * MIN);
    expect(m.h.registrar()).toBe(0); // nada mudou
    m.estado.five = 12;
    m.avancar(MIN);
    expect(m.h.registrar()).toBe(1);
    expect(linhas(m)).toBe(2);
  });
  it("no máximo 1 gravação por série a cada 60 s, mesmo que o valor pule", () => {
    const m = montar();
    m.h.registrar();
    m.estado.five = 30;
    m.avancar(20_000);
    expect(m.h.registrar()).toBe(0);
    expect(linhas(m)).toBe(1);
  });
  it("valor desconhecido nunca vira amostra 0", () => {
    const m = montar({ five: null, weekly: null });
    expect(m.h.registrar()).toBe(0);
    expect(linhas(m, "five_hour") + linhas(m, "weekly")).toBe(0);
  });
  it("retenção: poda amostras com mais de 90 dias na primeira gravação do dia", () => {
    const m = montar();
    m.banco.executar("INSERT INTO limite_amostra (conta_id,janela,balde,ts,usado_pct,reinicia_em,fonte) VALUES (?,?,?,?,?,?,?)", [m.conta.id, "five_hour", "", new Date(T0 - 120 * 24 * H).toISOString(), 5, null, "manual"]);
    m.h.registrar();
    expect(m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM limite_amostra WHERE ts < ?", [new Date(T0 - 90 * 24 * H).toISOString()])?.n).toBe(0);
  });
});

describe("historico, previsão, eficiência e alertas pelo banco", () => {
  it("historico devolve a série pedida (≤ 300 pontos) e previsão usa o ciclo atual", () => {
    const m = montar({ five: 10 });
    // 8 leituras a cada 10 min subindo 2 pontos (≈ 12 pt/h)
    for (let i = 0; i < 8; i++) {
      m.estado.five = 10 + i * 2;
      m.h.registrar();
      m.avancar(10 * MIN);
    }
    const serie = m.h.historico({ conta_id: m.conta.id, janela: "five_hour", desde: new Date(T0 - H).toISOString(), ate: new Date(m.agora() + H).toISOString(), max_pontos: 300 }) as Array<{ usado_pct: number }>;
    expect(serie.map((a) => a.usado_pct)).toEqual([10, 12, 14, 16, 18, 20, 22, 24]);
    const previsao = m.h.previsao(m.conta.id) as Array<{ janela: string; zera_em: string | null; confianca: string }>;
    const cinco = previsao.find((p) => p.janela === "five_hour");
    expect(cinco?.zera_em).not.toBeNull();
    expect(cinco?.confianca).not.toBe("insuficiente");
    // semanal sem variação: poucas amostras (só a 1ª + carimbos) ⇒ insuficiente, nunca previsão inventada
    expect(previsao.find((p) => p.janela === "weekly")?.confianca).toBe("insuficiente");
  });
  it("eficiência semanal: pico, estouro e estouro precoce acumulam em limite_semana; meta de 90% (padrão)", () => {
    const m = montar({ weekly: 50 });
    m.h.registrar();
    m.estado.weekly = 93;
    m.avancar(5 * MIN);
    m.h.registrar();
    let e = m.h.eficiencia(4) as Array<{ pico_pct: number; estourou: boolean; estouro_precoce: boolean; meta_atingida: boolean; semana_inicio: string }>;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ pico_pct: 93, estourou: false, estouro_precoce: false, meta_atingida: true, semana_inicio: "2026-09-28" });
    m.estado.weekly = 100; // 5 dias antes do reset: estouro precoce
    m.avancar(5 * MIN);
    m.h.registrar();
    e = m.h.eficiencia(4, m.conta.id) as typeof e;
    expect(e[0]).toMatchObject({ pico_pct: 100, estourou: true, estouro_precoce: true, meta_atingida: false });
    expect(m.h.eficiencia(4, "conta_inexistente")).toEqual([]);
  });
  it("alertas: consumo alto, sem dado e `desde` estável entre consultas; some quando a condição acaba", () => {
    const m = montar({ five: 91 });
    m.h.registrar();
    const a1 = m.h.alertas() as Array<{ tipo: string; desde: string }>;
    expect(a1.map((x) => x.tipo)).toContain("consumo_alto");
    m.avancar(30 * MIN);
    const a2 = m.h.alertas() as typeof a1;
    expect(a2.find((x) => x.tipo === "consumo_alto")?.desde).toBe(a1.find((x) => x.tipo === "consumo_alto")?.desde);
    m.estado.five = 20;
    expect((m.h.alertas() as typeof a1).map((x) => x.tipo)).not.toContain("consumo_alto");
    m.estado.five = 95;
    m.avancar(MIN);
    expect((m.h.alertas() as typeof a1).find((x) => x.tipo === "consumo_alto")?.desde).not.toBe(a1[0]?.desde);
  });
  it("registrar nunca lança (banco falhando) e avisa", () => {
    const m = montar();
    const avisos: string[] = [];
    const h = criarHistoricoLimites({ repo: { ...m.repos.limiteAmostra, gravarLote: () => { throw new Error("disco cheio /Users/x"); } }, snapshot: () => ({ contas: [{ account_id: m.conta.id, provider: "claude", fetched_at: "t", fonte: "manual", confianca: "manual", status: "ok", windows: [{ kind: "five_hour", used_pct: 5, resets_at: null }], model_buckets: {}, bottleneck: "five_hour", slack_pct: 95, idade_s: 0, vencidas: [] }], geral: { pior: null, folga_media_pct: null, cobertura: { com_dado: 1, total: 1 }, em_alerta: 0, esgotadas: 0 } }), rotulos: () => ({}), aviso: (x) => void avisos.push(x), agora: () => T0 });
    expect(h.registrar()).toBe(0);
    expect(avisos.join(" ")).not.toContain("/Users");
  });
});
