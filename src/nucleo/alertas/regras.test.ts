import { describe, expect, it } from "vitest";
import type { AlertaVisao, CanalRegistro, Regra } from "../../compartilhado/alertas";
import { avaliar, casaFiltros } from "./regras";
import { avaliarSilencio, fimDaJanela, partesNoFuso, type ResolverLocal } from "./silencio";
import { decidirAgrupamento, liberarLotes, proximaHoraDigest, tituloDoLote } from "./agrupar";

const MIN = 60_000;
/** relógio "local" simples: UTC como se fosse o fuso (sem DST), para tabelas determinísticas. */
const utc: ResolverLocal = (ms) => {
  const d = new Date(ms);
  return { dia: d.getUTCDay(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const em = (iso: string): number => Date.parse(iso);

const alerta = (p: Partial<AlertaVisao> = {}): AlertaVisao => ({
  id: "a1", tipo: "tarefa_concluida", severidade: "sucesso", fonte: "metodo", workspace_id: "w1", mission_id: "m1", entidade_tipo: "task", entidade_id: "T-1", titulo: "x", dados: { story_points: 3 },
  dedupe_chave: "k", contagem: 1, criado_em: "2026-10-01T12:00:00.000Z", atualizado_em: "2026-10-01T12:00:00.000Z", lido_em: null, silenciado_ate: null, arquivado_em: null, ...p,
});
const canal = (p: Partial<CanalRegistro> = {}): CanalRegistro => ({ id: "c1", tipo: "telegram", nome: "tg", estado: "ativo", saida_ligada: true, entrada_ligada: false, consentimento: { versao_texto: "v1", hash_texto: "h", aceito_em: "2026-09-30T00:00:00Z", host: "api.telegram.org", itens_enviados: [] }, silenciado_ate: null, erro_codigo: null, ...p });
const regra = (p: Partial<Regra> = {}): Regra => ({ id: "r1", nome: "r", ativa: true, tipos: ["*"], canal_id: "c1", filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "minimo", efemera_ate: null, origem: "usuario", ...p });
const ctx = (agora = em("2026-10-01T12:00:00Z")) => ({ agora, resolver: utc });

describe("silêncio (T-20.11)", () => {
  const noite = { inicio: "22:00", fim: "07:00" };
  it.each([
    ["21:59", false], ["22:00", true], ["23:59", true], ["00:00", true], ["06:59", true], ["07:00", false], ["12:00", false],
  ])("janela 22:00-07:00 às %s => %s", (hhmm, esperado) => {
    expect(avaliarSilencio({ regra: noite }, "info", em(`2026-10-01T${hhmm}:00Z`), utc).silenciado).toBe(esperado);
  });
  it("crítico atravessa o silêncio por padrão; excecao_critico:false bloqueia", () => {
    const t = em("2026-10-01T23:00:00Z");
    expect(avaliarSilencio({ regra: noite }, "critico", t, utc).silenciado).toBe(false);
    expect(avaliarSilencio({ regra: { ...noite, excecao_critico: false } }, "critico", t, utc).silenciado).toBe(true);
  });
  it("dias da semana: a madrugada pertence ao dia em que a janela COMEÇOU", () => {
    // 2026-10-02 é sexta (5); janela só nas quintas (4): sexta 02:00 está dentro, sexta 23:00 não.
    const quintas = { ...noite, dias: [4] };
    expect(avaliarSilencio({ regra: quintas }, "info", em("2026-10-02T02:00:00Z"), utc).silenciado).toBe(true);
    expect(avaliarSilencio({ regra: quintas }, "info", em("2026-10-02T23:00:00Z"), utc).silenciado).toBe(false);
    expect(avaliarSilencio({ regra: quintas }, "info", em("2026-10-01T23:00:00Z"), utc).silenciado).toBe(true);
  });
  it("janela no mesmo dia e janela vazia/inválida", () => {
    const tarde = { inicio: "13:00", fim: "14:00" };
    expect(avaliarSilencio({ regra: tarde }, "info", em("2026-10-01T13:30:00Z"), utc).silenciado).toBe(true);
    expect(avaliarSilencio({ regra: { inicio: "10:00", fim: "10:00" } }, "info", em("2026-10-01T10:00:00Z"), utc).silenciado).toBe(false);
    expect(avaliarSilencio({ regra: { inicio: "25:00", fim: "10:00" } }, "info", em("2026-10-01T05:00:00Z"), utc).silenciado).toBe(false);
  });
  it("fim da janela calculado (cruzando meia-noite)", () => {
    expect(fimDaJanela(noite, em("2026-10-01T23:10:00Z"), utc)).toBe(em("2026-10-02T07:00:00Z"));
  });
  it("janela de quase o dia inteiro (00:00-23:59): o fim é achado (lacuna de 1 minuto não é pulada)", () => {
    const def = { inicio: "00:00", fim: "23:59" };
    expect(fimDaJanela(def, em("2026-10-01T12:00:00Z"), utc)).toBe(em("2026-10-01T23:59:00Z"));
    expect(avaliarSilencio({ regra: def }, "info", em("2026-10-01T12:00:00Z"), utc).ate_ms).toBe(em("2026-10-01T23:59:00Z"));
  });
  it("horário de verão: janela 02:00-04:00 em Nova York no dia da virada", () => {
    const ny = partesNoFuso("America/New_York");
    const def = { inicio: "01:00", fim: "03:00" };
    // 2026-03-08: 02:00 -> 03:00 (pula uma hora). 06:30Z = 01:30 EST (dentro); 07:30Z = 03:30 EDT (fora).
    expect(avaliarSilencio({ regra: def }, "info", em("2026-03-08T06:30:00Z"), ny).silenciado).toBe(true);
    expect(avaliarSilencio({ regra: def }, "info", em("2026-03-08T07:30:00Z"), ny).silenciado).toBe(false);
    expect(fimDaJanela(def, em("2026-03-08T06:30:00Z"), ny)).toBe(em("2026-03-08T07:00:00Z")); // 03:00 EDT
  });
  it("silêncio de canal (/silenciar 2h): críticos continuam; 'tudo 2h' inclui críticos; expira", () => {
    const ate = new Date(em("2026-10-01T14:00:00Z")).toISOString();
    const t = em("2026-10-01T12:00:00Z");
    expect(avaliarSilencio({ canal: { ate, incluir_criticos: false } }, "info", t, utc).silenciado).toBe(true);
    expect(avaliarSilencio({ canal: { ate, incluir_criticos: false } }, "critico", t, utc).silenciado).toBe(false);
    expect(avaliarSilencio({ canal: { ate, incluir_criticos: true } }, "critico", t, utc).silenciado).toBe(true);
    expect(avaliarSilencio({ canal: { ate, incluir_criticos: true } }, "critico", em("2026-10-01T14:00:01Z"), utc).silenciado).toBe(false);
    expect(avaliarSilencio({ global_temporario: { ate, incluir_criticos: true } }, "critico", t, utc).origem).toBe("global_temporario");
  });
});

describe("agrupamento", () => {
  it("imediato; lote (janela 5 s); digest na próxima hora local; crítico nunca agrupa", () => {
    const t = em("2026-10-01T12:00:00Z");
    expect(decidirAgrupamento({ modo: "imediato" }, alerta(), t, utc)).toEqual({ estado: "pendente", liberar_em: null, motivo: "imediato" });
    expect(decidirAgrupamento({ modo: "lote" }, alerta(), t, utc)).toEqual({ estado: "agrupado", liberar_em: t + 5000, motivo: "lote" });
    expect(decidirAgrupamento({ modo: "digest", hora_digest: "18:00" }, alerta(), t, utc).liberar_em).toBe(em("2026-10-01T18:00:00Z"));
    expect(decidirAgrupamento({ modo: "digest", hora_digest: "09:00" }, alerta(), t, utc).liberar_em).toBe(em("2026-10-02T09:00:00Z"));
    expect(decidirAgrupamento({ modo: "digest", hora_digest: "18:00" }, alerta({ severidade: "critico" }), t, utc).estado).toBe("pendente");
    expect(proximaHoraDigest("12:00", t, utc)).toBe(t + 24 * 60 * MIN);
    expect(proximaHoraDigest("xx", t, utc)).toBeNull();
  });
  it("título do lote e liberação em UM lote por canal/regra", () => {
    const as = [alerta({ id: "1" }), alerta({ id: "2" }), alerta({ id: "3", tipo: "tarefa_bloqueada" })];
    expect(tituloDoLote(as)).toBe("2 × Tarefa concluída, 1 × Tarefa bloqueada");
    const t = em("2026-10-01T12:00:10Z");
    const mk = (id: string, em_: string | null) => ({ id: `e${id}`, alerta_id: id, canal_id: "c1", regra_id: "r1", estado: "agrupado" as const, tentativas: 0, proxima_tentativa_em: em_, erro_codigo: null, lote_id: null, mensagem_externa_id: null, enviado_em: null, criado_em: "x", nivel: "minimo" as const, chat_ref: null });
    const lotes = liberarLotes([mk("1", "2026-10-01T12:00:05Z"), mk("2", "2026-10-01T12:00:05Z"), mk("3", "2026-10-01T12:30:00Z")], new Map(as.map((a) => [a.id, a])), t);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]?.alerta_ids).toEqual(["1", "2"]);
  });
});

describe("avaliar regras (tabela)", () => {
  it("nenhuma regra => nenhum envio externo", () => {
    expect(avaliar(alerta(), [], [canal()], ctx())).toEqual([]);
  });
  it.each([
    ["regra ativa casa", regra(), canal(), 1],
    ["regra inativa", regra({ ativa: false }), canal(), 0],
    ["canal sem consentimento", regra(), canal({ consentimento: null }), 0],
    ["canal desligado (saida_ligada=0)", regra(), canal({ saida_ligada: false }), 0],
    ["canal em erro", regra(), canal({ estado: "erro" }), 0],
    ["canal em conflito", regra(), canal({ estado: "conflito" }), 0],
    ["canal SO não precisa de consentimento", regra({ canal_id: "so" }), canal({ id: "so", tipo: "so", consentimento: null }), 1],
    ["tipo na lista", regra({ tipos: ["tarefa_concluida"] }), canal(), 1],
    ["tipo fora da lista", regra({ tipos: ["tarefa_bloqueada"] }), canal(), 0],
    ["regra efêmera vencida", regra({ efemera_ate: "2026-10-01T11:00:00Z" }), canal(), 0],
    ["regra efêmera vigente", regra({ efemera_ate: "2026-10-01T13:00:00Z" }), canal(), 1],
    ["canal inexistente", regra({ canal_id: "zz" }), canal(), 0],
  ])("%s", (_n, r, c, esperado) => {
    expect(avaliar(alerta(), [r], [c], ctx())).toHaveLength(esperado);
  });
  it("filtros: workspace, Missão, severidade mínima, SP mínimo e só atrasadas", () => {
    const a = alerta();
    expect(casaFiltros({ workspace_ids: ["w1"] }, a)).toBe(true);
    expect(casaFiltros({ workspace_ids: ["w2"] }, a)).toBe(false);
    expect(casaFiltros({ mission_ids: ["m2"] }, a)).toBe(false);
    expect(casaFiltros({ severidade_min: "aviso" }, a)).toBe(false);
    expect(casaFiltros({ severidade_min: "info" }, a)).toBe(true);
    expect(casaFiltros({ sp_min: 5 }, a)).toBe(false);
    expect(casaFiltros({ sp_min: 3 }, a)).toBe(true);
    expect(casaFiltros({ sp_min: 1 }, alerta({ dados: { story_points: null } }))).toBe(false);
    expect(casaFiltros({ so_atrasadas: true }, a)).toBe(false);
    expect(casaFiltros({ so_atrasadas: true }, alerta({ tipo: "tarefa_atrasada" }))).toBe(true);
  });
  it("curinga '*' nunca leva agente_mensagem a canal externo (AB-12); regra explícita leva", () => {
    const a = alerta({ tipo: "agente_mensagem", severidade: "info" });
    expect(avaliar(a, [regra({ tipos: ["*"] })], [canal()], ctx())).toHaveLength(0);
    expect(avaliar(a, [regra({ tipos: ["agente_mensagem"] })], [canal()], ctx())).toHaveLength(1);
    expect(avaliar(a, [regra({ tipos: ["*"], canal_id: "so" })], [canal({ id: "so", tipo: "so", consentimento: null })], ctx())).toHaveLength(1);
  });
  it("silêncio => entrega agrupada até o fim da janela; crítico atravessa", () => {
    const r = regra({ silencio: { inicio: "22:00", fim: "07:00" } });
    const noite = ctx(em("2026-10-01T23:00:00Z"));
    const [e] = avaliar(alerta(), [r], [canal()], noite);
    expect(e).toMatchObject({ estado: "agrupado", motivo: "silencio", liberar_em: em("2026-10-02T07:00:00Z") });
    expect(avaliar(alerta({ severidade: "critico" }), [r], [canal()], noite)[0]?.estado).toBe("pendente");
  });
  it("silêncio de canal /silenciar e global entram na avaliação", () => {
    const ate = new Date(em("2026-10-01T14:00:00Z")).toISOString();
    expect(avaliar(alerta(), [regra()], [canal({ silenciado_ate: ate })], ctx())[0]?.estado).toBe("agrupado");
    expect(avaliar(alerta(), [regra()], [canal()], { ...ctx(), silencio_global_temporario: { ate, incluir_criticos: false } })[0]?.estado).toBe("agrupado");
    expect(avaliar(alerta(), [regra()], [canal()], { ...ctx(), silencio_global: { inicio: "11:00", fim: "13:00" } })[0]?.estado).toBe("agrupado");
  });
  it("determinístico e idempotente por (alerta, canal, regra): regra duplicada não gera duas entregas", () => {
    const r = regra();
    const a = avaliar(alerta(), [r, r], [canal()], ctx());
    expect(a).toHaveLength(1);
    expect(avaliar(alerta(), [r], [canal()], ctx())).toEqual(avaliar(alerta(), [r], [canal()], ctx()));
  });
  it("alerta 'somente_app' (dia vazio) nunca vai a canal", () => {
    expect(avaliar(alerta({ dados: { somente_app: true } }), [regra()], [canal()], ctx())).toEqual([]);
  });
  it("regra efêmera de pedido remoto carrega o destino (chat_ref)", () => {
    expect(avaliar(alerta(), [regra({ origem: "pedido_remoto", chat_ref: "chat:42" })], [canal()], ctx())[0]?.chat_ref).toBe("chat:42");
  });
});
