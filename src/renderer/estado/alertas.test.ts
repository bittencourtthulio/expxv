import { describe, expect, it, vi } from "vitest";
import type { AlertaVisao, ApiAlertas, CanalVisao } from "../../compartilhado/alertas";
import { criarStoreAlertas, MAX_RECENTES } from "./alertas";
import { filtrosParaPedido, FILTROS_VAZIOS, formatarCodigoPareamento, formatarContagem, formatarDuracao, formatarTokens, indicadoresDeCanais, restanteAte, rotuloBadge, tempoRelativo } from "./alertas-formato";

const alerta = (id: string, extra: Partial<AlertaVisao> = {}): AlertaVisao => ({ id, tipo: "tarefa_concluida", severidade: "sucesso", fonte: "metodo", workspace_id: null, mission_id: null, entidade_tipo: null, entidade_id: null, titulo: id, dados: {}, dedupe_chave: id, contagem: 1, criado_em: "2026-10-01T10:00:00.000Z", atualizado_em: "2026-10-01T10:00:00.000Z", lido_em: null, silenciado_ate: null, arquivado_em: null, ...extra });
const canal = (extra: Partial<CanalVisao>): CanalVisao => ({ id: "c1", tipo: "telegram", nome: "Telegram", estado: "ativo", resumo: "", saida_ligada: true, entrada_ligada: false, consentimento: null, silenciado_ate: null, erro_codigo: null, capacidades: { entrada: true, botoes: true, formato: "html", precisa_consentimento: true }, ...extra });

function apiFalsa() {
  const cbs: Record<string, (x: never) => void> = {};
  const assinar = (nome: string) => (cb: (x: never) => void) => { cbs[nome] = cb; return () => { delete cbs[nome]; }; };
  const api = {
    contar: vi.fn(async () => ({ nao_lidos: 3, criticos: 1 })),
    listar: vi.fn(async () => ({ itens: [alerta("a1")], proximo: null })),
    marcarTodosLidos: vi.fn(async () => ({ n: 1 })),
    canais: { listar: vi.fn(async () => [canal({})]) },
    assinarNovo: assinar("novo"), assinarContagem: assinar("contagem"), assinarMudou: assinar("mudou"), assinarCanal: assinar("canal"), assinarPareamento: assinar("par"), assinarTelegram: assinar("tg"), assinarPlanoPendente: assinar("plano"),
  } as unknown as ApiAlertas;
  return { api, cbs };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("formatadores", () => {
  it("badge 99+ e aria-label com plural", () => {
    expect(formatarContagem(150)).toBe("99+");
    expect(formatarContagem(3)).toBe("3");
    expect(rotuloBadge({ nao_lidos: 3, criticos: 1 })).toBe("Alertas, 3 não lidos, 1 crítico");
    expect(rotuloBadge({ nao_lidos: 1, criticos: 2 })).toBe("Alertas, 1 não lido, 2 críticos");
    expect(rotuloBadge({ nao_lidos: 0, criticos: 0 })).toBe("Alertas, nenhum não lido");
  });
  it("duração, tokens e tempo relativo: ausente nunca vira zero", () => {
    expect(formatarDuracao(4_320_000)).toBe("1 h 12 min");
    expect(formatarDuracao(45 * 60_000)).toBe("45 min");
    expect(formatarDuracao(null)).toBe("sem medição");
    expect(formatarTokens(null)).toBe("sem fonte");
    expect(formatarTokens(182340)).toMatch(/182\.340/);
    const agora = Date.parse("2026-10-01T10:10:00Z");
    expect(tempoRelativo("2026-10-01T10:00:00Z", agora)).toBe("há 10 min");
    expect(tempoRelativo("2026-10-01T10:09:50Z", agora)).toBe("agora");
  });
  it("indicador de canal: forma + texto; só externos", () => {
    expect(indicadoresDeCanais([canal({ entrada_ligada: true })])).toEqual([{ texto: "Telegram · entrada ativa", tom: "aviso", forma: "◆" }]);
    expect(indicadoresDeCanais([canal({})])[0]?.texto).toBe("Telegram · saída ativa");
    expect(indicadoresDeCanais([canal({ estado: "conflito" })])[0]?.texto).toBe("Telegram · conflito");
    expect(indicadoresDeCanais([canal({ estado: "erro" })])[0]?.texto).toBe("Telegram · erro");
    expect(indicadoresDeCanais([canal({ tipo: "so" })])).toEqual([]);
    expect(indicadoresDeCanais([canal({ estado: "desligado", saida_ligada: false })])).toEqual([]);
  });
  it("filtros viram pedido sem campos vazios; busca truncada", () => {
    const p = filtrosParaPedido({ ...FILTROS_VAZIOS, busca: "  x ".padEnd(200, "y") }, "id9");
    expect(p).toMatchObject({ estado: "nao_lidos", depois_id: "id9", limite: 100 });
    expect(p.busca?.length).toBe(80);
    expect("tipos" in p).toBe(false);
  });
  it("contagem regressiva e código", () => {
    const agora = Date.parse("2026-10-01T10:00:00Z");
    expect(restanteAte("2026-10-01T10:04:05Z", agora)).toBe("4:05");
    expect(restanteAte("2026-10-01T09:59:00Z", agora)).toBeNull();
    expect(formatarCodigoPareamento("ABCDE23456")).toBe("ABCDE-23456");
  });
});

describe("store de alertas", () => {
  it("só lê contar() no boot; canais só em ocioso; assina os eventos", async () => {
    const { api } = apiFalsa();
    let ociosoFn: (() => void) | null = null;
    const s = criarStoreAlertas({ api: () => api, ocioso: (f) => { ociosoFn = f; } });
    s.iniciar();
    await tick();
    expect(api.contar).toHaveBeenCalledTimes(1);
    expect(api.canais.listar).not.toHaveBeenCalled();
    expect(s.obter().contagem).toEqual({ nao_lidos: 3, criticos: 1 });
    ociosoFn!();
    await tick();
    expect(s.obter().canais).toHaveLength(1);
  });
  it("iniciar é idempotente e parar desliga", async () => {
    const { api, cbs } = apiFalsa();
    const s = criarStoreAlertas({ api: () => api, ocioso: () => undefined });
    s.iniciar(); s.iniciar();
    await tick();
    expect(api.contar).toHaveBeenCalledTimes(1);
    s.parar();
    expect(cbs["novo"]).toBeUndefined();
  });
  it("rajada de eventos vira UMA notificação e mantém só os últimos 50", async () => {
    const { api, cbs } = apiFalsa();
    const s = criarStoreAlertas({ api: () => api, ocioso: () => undefined });
    s.iniciar();
    await tick();
    const o = vi.fn();
    s.assinar(o);
    for (let i = 0; i < 80; i++) (cbs["novo"] as (a: AlertaVisao) => void)(alerta(`n${i}`));
    await tick();
    expect(o).toHaveBeenCalledTimes(1);
    expect(s.obter().recentes).toHaveLength(MAX_RECENTES);
    expect(s.obter().recentes[0]?.id).toBe("n79");
  });
  it("pareamento com pedido aparece; outro estado limpa; plano pendente acumula e remove", async () => {
    const { api, cbs } = apiFalsa();
    const s = criarStoreAlertas({ api: () => api, ocioso: () => undefined });
    s.iniciar();
    (cbs["par"] as (e: unknown) => void)({ estado: "pedido", pedido: { pedido_id: "p1", nome: "Ana", user_id: 7 } });
    await tick();
    expect(s.obter().pedidoPareamento?.nome).toBe("Ana");
    (cbs["par"] as (e: unknown) => void)({ estado: "pareado" });
    await tick();
    expect(s.obter().pedidoPareamento).toBeNull();
    (cbs["plano"] as (e: unknown) => void)({ plano_id: "pl1", resumo: "r", args_hash: "h", expira_em: "2026-10-01T10:10:00Z" });
    await tick();
    expect(s.obter().planosPendentes).toHaveLength(1);
    s.removerPlano("pl1");
    expect(s.obter().planosPendentes).toHaveLength(0);
  });
  it("marcarTodosLidos zera a contagem local e chama a API; sem API = indisponível", async () => {
    const { api } = apiFalsa();
    const s = criarStoreAlertas({ api: () => api, ocioso: () => undefined });
    s.iniciar();
    await tick();
    await s.marcarTodosLidos();
    expect(api.marcarTodosLidos).toHaveBeenCalled();
    expect(s.obter().contagem.nao_lidos).toBe(0);
    const v = criarStoreAlertas({ api: () => undefined });
    v.iniciar();
    expect(v.obter().disponivel).toBe(false);
  });
});
