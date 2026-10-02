import { describe, expect, it } from "vitest";
import { barramentoFalso, idSeq, relogioFalso } from "../../../tests/fixtures/alertas/ajudas";
import { SK_ANT } from "../../../tests/fixtures/alertas/sentinelas";
import type { CanalRegistro } from "../../compartilhado/alertas";
import { criarAlertRaise, ErroAlertRaise } from "./alert-raise";
import { criarEmissor } from "./emissor";
import { criarRepoAlertasMemoria, criarRepoEntregasMemoria } from "./memoria";
import { criarRegraDePreset } from "./presets";
import { avaliar } from "./regras";
import { executarRetencao } from "./retencao";
import { CONFIG_ALERTAS_PADRAO } from "../../compartilhado/alertas";
import { executarRetencaoTelegram } from "../telegram/retencao";
import { criarRepoTelegramMemoria } from "../telegram/repo";

const montar = () => {
  const relogio = relogioFalso();
  const repo = criarRepoAlertasMemoria();
  const emissor = criarEmissor({ repo, barramento: barramentoFalso(), relogio, novoId: idSeq("x") });
  return { relogio, repo, ar: criarAlertRaise({ emissor, relogio }) };
};
const ctx = { pane_id: "pan_1", mission_id: "m1", workspace_id: "w1", role: "piloto" as const };

describe("alert_raise (T-20.15)", () => {
  it("piloto levanta alerta `agente_mensagem` com texto redigido; ids vêm do contexto (token), nunca dos args", () => {
    const { ar, repo } = montar();
    const r = ar.executar({ kind: "attention", title: "preciso de ajuda " + SK_ANT, detail: "veja /Users/ana/x", task_id: "T-1" }, ctx);
    expect(r.queued).toBe(true);
    const a = repo.obter(r.alert_id);
    expect(a).toMatchObject({ tipo: "agente_mensagem", severidade: "aviso", mission_id: "m1", workspace_id: "w1", entidade_id: "pan_1" });
    expect(JSON.stringify(a)).not.toMatch(/sk-ant|\/Users/);
  });
  it("worker sem permissão => forbidden; habilitado pelo workspace passa", () => {
    const { ar } = montar();
    expect(() => ar.executar({ kind: "info", title: "x" }, { ...ctx, role: "worker" })).toThrow(expect.objectContaining({ codigo: "forbidden" }));
    expect(ar.executar({ kind: "info", title: "x" }, { ...ctx, role: "worker", worker_habilitado: true }).queued).toBe(true);
  });
  it("4ª chamada na hora => rate_limited (por Pane); outra hora libera; outro Pane tem cota própria", () => {
    const { ar, relogio } = montar();
    for (let i = 0; i < 3; i++) ar.executar({ kind: "info", title: `t${i}` }, ctx);
    expect(() => ar.executar({ kind: "info", title: "t3" }, ctx)).toThrow(expect.objectContaining({ codigo: "rate_limited" }));
    expect(ar.executar({ kind: "info", title: "x" }, { ...ctx, pane_id: "pan_2" }).queued).toBe(true);
    relogio.avancar(3_600_001);
    expect(ar.executar({ kind: "done", title: "ok" }, ctx).queued).toBe(true);
  });
  it("teto GLOBAL de 30/h: respawnar painéis não contorna o limite por Pane (auditoria B7)", () => {
    const { ar, relogio } = montar();
    for (let i = 0; i < 30; i++) ar.executar({ kind: "info", title: `g${i}` }, { ...ctx, pane_id: `pan_${i}` });
    expect(() => ar.executar({ kind: "info", title: "g31" }, { ...ctx, pane_id: "pan_novo" })).toThrow(expect.objectContaining({ codigo: "rate_limited" }));
    relogio.avancar(3_600_001);
    expect(ar.executar({ kind: "info", title: "de novo" }, { ...ctx, pane_id: "pan_novo" }).queued).toBe(true);
  });
  it.each([
    [null], [{}], [{ kind: "x", title: "t" }], [{ kind: "info" }], [{ kind: "info", title: "" }], [{ kind: "info", title: "x".repeat(81) }], [{ kind: "info", title: "t", detail: "d".repeat(281) }], [{ kind: "info", title: "t", extra: 1 }], [{ kind: "info", title: "t", task_id: "../etc" }], [{ kind: "info", title: 5 }],
  ])("args inválidos %#", (args) => {
    const { ar } = montar();
    expect(() => ar.executar(args, ctx)).toThrow(ErroAlertRaise);
    try {
      ar.executar(args, ctx);
    } catch (e) {
      expect((e as ErroAlertRaise).codigo).toBe("invalid_args");
    }
  });
  it("agente_mensagem NÃO sai a canal externo pelo curinga (AB-12)", () => {
    const { ar, repo } = montar();
    const a = repo.obter(ar.executar({ kind: "info", title: "oi" }, ctx).alert_id);
    const canal: CanalRegistro = { id: "c", tipo: "telegram", nome: "t", estado: "ativo", saida_ligada: true, entrada_ligada: false, consentimento: { versao_texto: "v", hash_texto: "h", aceito_em: "2026-01-01T00:00:00Z", host: "api.telegram.org", itens_enviados: [] }, silenciado_ate: null, erro_codigo: null };
    expect(avaliar(a!, [criarRegraDePreset("tudo_no_app", "c", "r")], [canal], { agora: Date.now() })).toHaveLength(0);
  });
});

describe("presets e retenção", () => {
  it("presets: tudo no app (curinga), atrasadas e erros (lista), resumo diário (digest na hora)", () => {
    expect(criarRegraDePreset("tudo_no_app", "c", "r1").tipos).toEqual(["*"]);
    expect(criarRegraDePreset("atrasadas_e_erros_no_telegram", "c", "r2").tipos).toContain("tarefa_atrasada");
    expect(criarRegraDePreset("resumo_diario", "c", "r3", "19:30").agrupamento).toEqual({ modo: "digest", hora_digest: "19:30" });
    expect(criarRegraDePreset("tarefas_do_telegram", "c", "r4").origem).toBe("padrao");
  });
  it("retenção: alertas 90 d, entregas 30 d, update_visto 48 h, auditoria 90 d — apaga só o vencido", () => {
    const agora = Date.parse("2026-10-01T00:00:00Z");
    const dia = 86_400_000;
    const alertas = criarRepoAlertasMemoria();
    const entregas = criarRepoEntregasMemoria();
    const mk = (id: string, dias: number) => ({ id, tipo: "erro_sistema" as const, severidade: "info" as const, fonte: "sistema" as const, workspace_id: null, mission_id: null, entidade_tipo: null, entidade_id: null, titulo: id, dados: {}, dedupe_chave: id, contagem: 1, criado_em: new Date(agora - dias * dia).toISOString(), atualizado_em: "x", lido_em: null, silenciado_ate: null, arquivado_em: null });
    alertas.inserir(mk("velho", 91));
    alertas.inserir(mk("novo", 89));
    const ent = (id: string, dias: number) => ({ id, alerta_id: id, canal_id: "c", regra_id: "r", estado: "enviado" as const, tentativas: 1, proxima_tentativa_em: null, erro_codigo: null, lote_id: null, mensagem_externa_id: null, enviado_em: null, criado_em: new Date(agora - dias * dia).toISOString(), nivel: "minimo" as const, chat_ref: null });
    entregas.inserir(ent("e1", 31));
    entregas.inserir(ent("e2", 29));
    expect(executarRetencao({ alertas, entregas }, agora, CONFIG_ALERTAS_PADRAO)).toEqual({ alertas: 1, entregas: 1 });
    expect(alertas.obter("novo")).not.toBeNull();
    expect(alertas.obter("velho")).toBeNull();
    const tg = criarRepoTelegramMemoria();
    tg.marcarVisto(1, new Date(agora - 49 * 3_600_000).toISOString());
    tg.marcarVisto(2, new Date(agora - 47 * 3_600_000).toISOString());
    tg.inserirAuditoria({ id: "a1", ts: new Date(agora - 91 * dia).toISOString(), canal_id: "c", evento: "panico", user_id: null, workspace_id: null, plano_id: null, mensagem_entrada_id: null, args_hash: null, resultado: null, detalhe: {} });
    tg.inserirAuditoria({ id: "a2", ts: new Date(agora - 10 * dia).toISOString(), canal_id: "c", evento: "panico", user_id: null, workspace_id: null, plano_id: null, mensagem_entrada_id: null, args_hash: null, resultado: null, detalhe: {} });
    expect(executarRetencaoTelegram(tg, agora)).toEqual({ vistos: 1, auditoria: 1, entradas: 0 });
    expect(tg.updateVisto(2)).toBe(true);
    expect(tg.updateVisto(1)).toBe(false);
  });
});
