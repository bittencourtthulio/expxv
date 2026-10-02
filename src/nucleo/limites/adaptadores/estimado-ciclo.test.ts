// Fonte `estimado` por CICLO (Fase 10, T-10.22): ciclo inferido do último reset medido, consumo do agregado por conta, sem teto/reset ⇒ nada, nunca `medido`.
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../../banco";
import { criarRepositorios } from "../../banco/repos";
import { criarServicoCusto } from "../../custo/servico";
import { mesclarSnapshots } from "../servico";
import { criarAdaptadorEstimado, inicioDoCiclo, type FonteEstimativa } from "./estimado";
import { criarFonteEstimativaDoBanco } from "./estimado-fonte";
import type { ContaLimite } from "./adaptador";
import type { LimitSnapshot } from "../../../compartilhado/limites";

const H = 3_600_000;
const AGORA = Date.parse("2026-06-10T12:00:00.000Z");
const ctx = { sinal: new AbortController().signal, agora: AGORA };
const conta = (id: string): ContaLimite => ({ id, provedor: "claude", rotulo: "c", config_dir: null, habilitada: true });
const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

describe("inicioDoCiclo", () => {
  it("reset futuro: o ciclo corrente começou 1 duração antes; reset passado: avança em múltiplos da duração", () => {
    expect(inicioDoCiclo(AGORA + 1 * H, 5 * H, AGORA)).toBe(AGORA - 4 * H);
    expect(inicioDoCiclo(AGORA - 1 * H, 5 * H, AGORA)).toBe(AGORA - 1 * H);
    expect(inicioDoCiclo(AGORA - 12 * H, 5 * H, AGORA)).toBe(AGORA - 2 * H); // -12h, -7h, -2h
    expect(inicioDoCiclo(Number.NaN, 5 * H, AGORA)).toBeNull();
    expect(inicioDoCiclo(AGORA, 0, AGORA)).toBeNull();
  });
});

describe("modo por ciclo (adaptador)", () => {
  const base = (extra: Partial<FonteEstimativa>): FonteEstimativa => ({ tetos: () => ({ cinco_horas: 1000, semana: 10_000 }), consumo: () => 999_999, ...extra });
  it("sem reset conhecido a janela não produz nada (null), mesmo com teto e consumo", async () => {
    const ad = criarAdaptadorEstimado(base({ ultimoReset: () => null, consumoDesde: () => 500 }));
    expect(await ad.ler(conta("a"), ctx)).toBeNull();
  });
  it("com reset: soma desde o início do ciclo, `estimado` (nunca `medido`), sem resets_at inventado; não usa a janela móvel", async () => {
    const pedidos: number[] = [];
    const ad = criarAdaptadorEstimado(base({ ultimoReset: (_id, k) => (k === "five_hour" ? AGORA + 1 * H : null), consumoDesde: (_id, desde) => (pedidos.push(desde), 250) }));
    const s = (await ad.ler(conta("a"), ctx)) as LimitSnapshot;
    expect(s).toMatchObject({ fonte: "estimado", confianca: "estimado" });
    expect(s.windows).toEqual([{ kind: "five_hour", used_pct: 25, resets_at: null }]); // semana sem reset ⇒ ausente
    expect(pedidos).toEqual([AGORA - 4 * H]);
  });
  it("sem teto ⇒ null; consumo desconhecido ⇒ null (nunca 0%)", async () => {
    expect(await criarAdaptadorEstimado(base({ tetos: () => ({ cinco_horas: null, semana: null }), ultimoReset: () => AGORA + H, consumoDesde: () => 5 })).ler(conta("a"), ctx)).toBeNull();
    expect(await criarAdaptadorEstimado(base({ ultimoReset: () => AGORA + H, consumoDesde: () => null })).ler(conta("a"), ctx)).toBeNull();
  });
  it("estimativa nunca vence um dado medido válido no merge", () => {
    const estimado: LimitSnapshot = { account_id: "a", provider: "claude", fetched_at: new Date(AGORA).toISOString(), fonte: "estimado", confianca: "estimado", status: "ok", windows: [{ kind: "five_hour", used_pct: 90, resets_at: null }], model_buckets: {} };
    const medido: LimitSnapshot = { ...estimado, fetched_at: new Date(AGORA - 60_000).toISOString(), fonte: "claude_statusline" as never, confianca: "medido", windows: [{ kind: "five_hour", used_pct: 30, resets_at: new Date(AGORA + H).toISOString() }] };
    const m = mesclarSnapshots({ id: "a", provedor: "claude" }, [estimado, medido], AGORA);
    expect(m.windows[0]?.used_pct).toBe(30);
    expect(m.confianca).toBe("medido");
  });
});

describe("fonte sobre o banco (agregado por conta)", () => {
  function montar() {
    const b = abrirBanco(":memory:");
    abertos.push(b);
    migrar(b);
    const r = criarRepositorios(b);
    const s = criarServicoCusto({ banco: b, relogio: () => new Date(AGORA) });
    s.iniciarPrecos();
    const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
    const c = r.conta.criar({ provedor: "claude", rotulo: "c1" });
    const mis = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M", trabalho_id: "T1" });
    const pane = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", conta_id: c.id, papel: "executor" });
    const f = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "a.jsonl", conta_id: c.id, pane_id: pane.id, mission_id: mis.id, workspace_id: ws.id });
    const uso = (chave: string, ts: string, entrada: number, saida = 0, cacheLeitura = 0) => s.ingerir(f.id, [{ chave, ts, modelo: "claude-sonnet-4-5", tokens: { entrada, cache_escrita: 0, cache_leitura: cacheLeitura, saida } }]);
    return { b, r, s, c, uso, fonte: criarFonteEstimativaDoBanco({ banco: b, agora: () => AGORA }) };
  }
  it("tetos vêm de conta_roteamento; sem teto ⇒ nulls", () => {
    const m = montar();
    expect(m.fonte.tetos(m.c.id)).toEqual({ cinco_horas: null, semana: null });
    m.r.contaRoteamento.gravarConfig({ conta_id: m.c.id, reservada_modelos: [], reservada_papeis: [], workspaces_fixados: [], teto_tokens_5h: 1000, teto_tokens_semana: 9000 });
    expect(m.fonte.tetos(m.c.id)).toEqual({ cinco_horas: 1000, semana: 9000 });
  });
  it("consumoDesde: bruto no dia parcial + agregado nos dias cheios; leitura de cache fica fora; sem uso ⇒ null", () => {
    const m = montar();
    expect(m.fonte.consumoDesde?.(m.c.id, AGORA - 5 * H)).toBeNull();
    m.uso("a", "2026-06-07T10:00:00.000Z", 100, 10); // dia cheio dentro do ciclo semanal (desde 06-05 08:00)
    m.uso("b", "2026-06-05T07:00:00.000Z", 5000); // ANTES do início do ciclo, no mesmo dia: fica fora
    m.uso("c", "2026-06-05T09:00:00.000Z", 1000, 0, 777_777); // dia parcial depois do início: entra (cache de leitura não)
    m.uso("d", "2026-06-10T11:00:00.000Z", 40, 2);
    const desde = Date.parse("2026-06-05T08:00:00.000Z");
    expect(m.fonte.consumoDesde?.(m.c.id, desde)).toBe(110 + 1000 + 42);
    // janela de 5 h do mesmo dia: só o último registro
    expect(m.fonte.consumoDesde?.(m.c.id, AGORA - 5 * H)).toBe(42);
  });
  it("ultimoReset: só amostra medida/manual, a mais recente; a do próprio estimado é ignorada", () => {
    const m = montar();
    expect(m.fonte.ultimoReset?.(m.c.id, "five_hour")).toBeNull();
    const ins = (ts: string, reinicia: string | null, fonte: string) => m.b.executar("INSERT INTO limite_amostra (conta_id,janela,balde,ts,usado_pct,reinicia_em,fonte) VALUES (?,?,?,?,?,?,?)", [m.c.id, "five_hour", "", ts, 10, reinicia, fonte]);
    ins("2026-06-10T09:00:00.000Z", "2026-06-10T13:00:00.000Z", "claude_statusline");
    ins("2026-06-10T10:00:00.000Z", "2026-06-10T15:00:00.000Z", "estimado");
    ins("2026-06-10T11:00:00.000Z", null, "claude_statusline");
    expect(m.fonte.ultimoReset?.(m.c.id, "five_hour")).toBe(Date.parse("2026-06-10T13:00:00.000Z"));
  });
  it("ponta a ponta: teto + reset medido + uso ⇒ ≈ x% `estimado` pelo adaptador", async () => {
    const m = montar();
    m.r.contaRoteamento.gravarConfig({ conta_id: m.c.id, reservada_modelos: [], reservada_papeis: [], workspaces_fixados: [], teto_tokens_5h: 1000 });
    m.b.executar("INSERT INTO limite_amostra (conta_id,janela,balde,ts,usado_pct,reinicia_em,fonte) VALUES (?,?,?,?,?,?,?)", [m.c.id, "five_hour", "", "2026-06-10T11:00:00.000Z", 10, "2026-06-10T14:00:00.000Z", "claude_statusline"]);
    m.uso("a", "2026-06-10T10:30:00.000Z", 300, 100); // ciclo: 09:00–14:00 ⇒ entra
    m.uso("b", "2026-06-10T08:00:00.000Z", 9999); // antes do ciclo
    const s = (await criarAdaptadorEstimado(m.fonte).ler(conta(m.c.id), ctx)) as LimitSnapshot;
    expect(s.windows).toEqual([{ kind: "five_hour", used_pct: 40, resets_at: null }]);
    expect(s.confianca).toBe("estimado");
  });
});
