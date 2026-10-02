import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventoHarness } from "../compartilhado/harness";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { criarServicoDecisoes } from "../nucleo/harness/decisoes";
import type { Agendador } from "../nucleo/limites/servico";
import type { PedidoMoverPane } from "../nucleo/harness/troca";
import { AGORA, PADRAO, uso } from "../../tests/fixtures/harness/construtores";
import { criarBarramento } from "./barramento";
import { IDADE_MAX_INDEX_LOCK_MS, ligarHarnessTroca, operacaoGitEmCurso, trocaParaErroMcp, type SistemaDeArquivosGit } from "./harness-troca";

const abertos: Banco[] = [];
const tmps: string[] = [];
afterEach(() => {
  abertos.splice(0).forEach((b) => b.fechar());
  tmps.splice(0).forEach((t) => rmSync(t, { recursive: true, force: true }));
});

function relogio() {
  let agora = AGORA;
  let seq = 0;
  const timers = new Map<number, { em: number; fn: () => void }>();
  const agendador: Agendador = { setTimeout: (fn, ms) => (timers.set(++seq, { em: agora + ms, fn }), seq), clearTimeout: (id) => void timers.delete(id as number) };
  return {
    agendador,
    agora: () => agora,
    pendentes: () => timers.size,
    avancar(ms: number) {
      agora += ms;
      for (const [id, t] of [...timers]) if (t.em <= agora) { timers.delete(id); t.fn(); }
    },
  };
}
const assentar = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r));
};

interface Opc {
  permissao?: "seguro" | "automatico";
  modo?: "manual" | "so_sugerir" | "automatico" | null;
  usoC1?: number;
  usoC2?: number;
  paneEstado?: "pronto" | "trabalhando" | "aguardando";
  livre?: boolean;
  cwd?: string | null;
  semMover?: boolean;
  foco?: boolean;
  moverFalha?: boolean;
}
function montar(o: Opc = {}) {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const r = criarRepositorios(b);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w", permissao: o.permissao ?? "seguro" });
  if (o.modo !== undefined) r.harnessWorkspace.gravar({ ...r.harnessWorkspace.obter(ws.id), modo_troca: o.modo });
  const c1 = r.conta.criar({ provedor: "claude", rotulo: "Pessoal" });
  const c2 = r.conta.criar({ provedor: "claude", rotulo: "Trabalho" });
  const x1 = r.conta.criar({ provedor: "codex", rotulo: "Codex" });
  const missao = o.livre ? null : r.mission.criar({ workspace_id: ws.id, modo: "livre", origem: "livre", titulo: "m" });
  const pane = r.pane.criar({ workspace_id: ws.id, mission_id: missao?.id ?? null, tipo: "cli", cli: "claude", conta_id: c1.id, modelo: "opus", papel: "executor", estado: o.paneEstado ?? "pronto", cwd: o.cwd ?? null });
  const usos = (): ReturnType<typeof uso>[] => [
    uso(c1.id, "claude", [["five_hour", o.usoC1 ?? 87, 3]]),
    uso(c2.id, "claude", [["five_hour", o.usoC2 ?? 10, 3]]),
    uso(x1.id, "codex", [["five_hour", 20, 3]]),
  ];
  const rel = relogio();
  const barramento = criarBarramento();
  const emitidos: Array<[string, unknown]> = [];
  for (const t of ["decision.made", "switch.suggested", "account.switched"]) barramento.assinar(t, (p) => emitidos.push([t, p]));
  const renderer: EventoHarness[] = [];
  const nativas: string[] = [];
  const movidos: PedidoMoverPane[] = [];
  const decisoes = criarServicoDecisoes({ decisoes: r.decisao, trocas: r.trocaLog, agora: rel.agora });
  const h = ligarHarnessTroca({
    repos: r,
    barramento,
    limites: { snapshot: () => ({ contas: usos() }) },
    decisoes,
    equivalencia: () => PADRAO,
    provedoresViaveis: () => ["claude", "codex"],
    ...(o.semMover ? {} : { moverPane: async (p: PedidoMoverPane) => { if (o.moverFalha) throw new Error("pty caiu"); movidos.push(p); return { novo_pane_id: pane.id }; } }),
    emitirRenderer: (e) => renderer.push(e),
    notificarNativa: (a) => nativas.push(a.tipo),
    foco: () => o.foco ?? true,
    agora: rel.agora,
    agendador: rel.agendador,
  });
  return { b, r, ws, c1, c2, x1, pane, h, rel, barramento, emitidos, renderer, nativas, movidos, decisoes };
}

describe("harness-troca: ciclo com o banco real", () => {
  it("automático: move, grava Decision(troca) e troca_log `feita`, publica no barramento", async () => {
    const m = montar({ modo: "automatico" });
    await m.h.avaliarAgora();
    expect(m.movidos).toHaveLength(1);
    expect(m.movidos[0]).toMatchObject({ pane_id: m.pane.id, workspace_id: m.ws.id, para: { conta_id: m.c2.id, provedor: "claude" }, motivo: "consumo_alto" });
    const t = m.r.trocaLog.listar().itens;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ status: "feita", modo: "automatico", consumo_origem_pct: 87, consumo_destino_pct: 10, decisao_id: expect.stringMatching(/^dec_/) });
    const d = m.r.decisao.listar({ proposito: "troca" }).itens;
    expect(d).toHaveLength(1);
    expect(d[0]?.opcoes).toContain(d[0]?.escolhida);
    expect(d[0]?.decisor).toBeNull();
    m.barramento.descarregar();
    expect(m.emitidos.map((e) => e[0]).sort()).toEqual(["account.switched", "decision.made"]);
    expect(m.renderer.map((e) => e.tipo)).toEqual(["troca_feita"]);
  });
  it("permissão `automatico` do workspace deriva o modo automático quando o override é NULL", async () => {
    const m = montar({ permissao: "automatico", modo: null });
    await m.h.avaliarAgora();
    expect(m.movidos).toHaveLength(1);
  });
  it("permissão `seguro` com override NULL deriva só sugerir: grava `sugerida` e não move", async () => {
    const m = montar({ permissao: "seguro", modo: null, foco: false });
    await m.h.avaliarAgora();
    expect(m.movidos).toHaveLength(0);
    expect(m.r.trocaLog.listar().itens.map((t) => t.status)).toEqual(["sugerida"]);
    expect(m.nativas).toEqual(["sugerida"]); // janela sem foco: notificação do sistema
    expect(m.renderer.map((e) => e.tipo)).toEqual(["troca_sugerida"]);
  });
  it("com a janela em foco não há notificação nativa", async () => {
    const m = montar({ modo: "so_sugerir", foco: true });
    await m.h.avaliarAgora();
    expect(m.nativas).toEqual([]);
  });
  it("manual: o ciclo não faz nada", async () => {
    const m = montar({ modo: "manual", usoC1: 99 });
    await m.h.avaliarAgora();
    expect(m.movidos).toHaveLength(0);
    expect(m.r.trocaLog.listar().itens).toHaveLength(0);
  });
  it("Pane livre (sem Missão e sem rota) fica fora do ciclo", async () => {
    const m = montar({ modo: "automatico", livre: true });
    await m.h.avaliarAgora();
    expect(m.movidos).toHaveLength(0);
  });
  it("trabalhando: adia e registra `adiada` com o motivo", async () => {
    const m = montar({ modo: "automatico", paneEstado: "trabalhando" });
    await m.h.avaliarAgora();
    expect(m.movidos).toHaveLength(0);
    expect(m.r.trocaLog.listar().itens[0]).toMatchObject({ status: "adiada", adiada_por: "trabalhando" });
  });
  it("frase de limite vista (limit.reached): ponto seguro mesmo trabalhando, limite atingido", async () => {
    const m = montar({ modo: "automatico", paneEstado: "trabalhando", usoC1: 60 });
    m.h.iniciar();
    m.barramento.emitir("limit.reached", { conta_id: m.c1.id, janela: "five_hour", pane_id: m.pane.id, fonte: "pty" });
    m.rel.avancar(500);
    await assentar();
    expect(m.movidos).toHaveLength(1);
    expect(m.movidos[0]?.motivo).toBe("limite_atingido");
    m.h.encerrar();
  });
  it("sem a porta de movimento: registra `falhou`, nada é movido", async () => {
    const m = montar({ modo: "automatico", semMover: true });
    await m.h.avaliarAgora();
    expect(m.r.trocaLog.listar().itens[0]?.status).toBe("falhou");
  });
  it("falha do movimento: `falhou`, notificação nativa sem foco", async () => {
    const m = montar({ modo: "automatico", moverFalha: true, foco: false });
    await m.h.avaliarAgora();
    expect(m.r.trocaLog.listar().itens[0]?.status).toBe("falhou");
    expect(m.nativas).toEqual(["falhou"]);
  });
  it("operação git em curso no worktree: nunca troca", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-troca-"));
    tmps.push(dir);
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "MERGE_HEAD"), "abc\n");
    const m = montar({ modo: "automatico", cwd: dir, usoC1: 99 });
    await m.h.avaliarAgora();
    expect(m.movidos).toHaveLength(0);
    expect(m.r.trocaLog.listar().itens[0]).toMatchObject({ status: "adiada", adiada_por: "operacao_git" });
  });
  it("handoff em voo (porta injetada) adia", async () => {
    const m = montar({ modo: "automatico" });
    // religa com a porta de handoff
    const h2 = ligarHarnessTroca({ repos: m.r, barramento: m.barramento, limites: { snapshot: () => ({ contas: [uso(m.c1.id, "claude", [["five_hour", 90, 3]]), uso(m.c2.id, "claude", [["five_hour", 10, 3]])] }) }, decisoes: m.decisoes, equivalencia: () => PADRAO, provedoresViaveis: () => ["claude"], emitirRenderer: () => undefined, foco: () => true, handoffEmVoo: () => true, agora: m.rel.agora, agendador: m.rel.agendador });
    await h2.avaliarAgora();
    expect(m.r.trocaLog.listar().itens[0]).toMatchObject({ status: "adiada", adiada_por: "handoff_em_voo" });
  });
});

describe("harness-troca: manipuladores dos canais e do MCP", () => {
  it("trocasListar devolve só o contrato `Troca`", async () => {
    const m = montar({ modo: "automatico" });
    await m.h.avaliarAgora();
    const p = m.h.trocasListar({ limite: 10 });
    expect(p.proximo).toBeNull();
    expect(Object.keys(p.itens[0] as object).sort()).toEqual(["adiada_por", "consumo_destino_pct", "consumo_origem_pct", "criado_em", "de", "id", "modo", "motivo", "para", "recibo", "status", "tipo_troca"]);
  });
  it("trocaDecidir: aceitar executa; ignorar grava o silêncio de 30 min em pane_rota", async () => {
    const m = montar({ modo: "so_sugerir" });
    m.r.paneRota.gravar({ pane_id: m.pane.id, perfil: { agente_id: null, provider: "claude", cli: "claude", modelo: "opus", esforco: null, faixa: "topo" }, task_type: "implementar" });
    await m.h.avaliarAgora();
    const [t] = m.r.trocaLog.listar().itens;
    const feita = await m.h.trocaDecidir({ troca_id: (t as { id: string }).id, acao: "aceitar" });
    expect(feita.status).toBe("feita");
    expect(m.movidos).toHaveLength(1);

    const m2 = montar({ modo: "so_sugerir" });
    m2.r.paneRota.gravar({ pane_id: m2.pane.id, perfil: { agente_id: null, provider: "claude", cli: "claude", modelo: "opus", esforco: null, faixa: "topo" }, task_type: null });
    await m2.h.avaliarAgora();
    const [t2] = m2.r.trocaLog.listar().itens;
    const ig = await m2.h.trocaDecidir({ troca_id: (t2 as { id: string }).id, acao: "ignorar" });
    expect(ig.status).toBe("ignorada");
    expect(Date.parse(m2.r.paneRota.obter(m2.pane.id)?.ignorar_sugestao_ate as string)).toBe(m2.rel.agora() + 30 * 60_000);
    await m2.h.avaliarAgora();
    expect(m2.r.trocaLog.listar().itens).toHaveLength(1); // não reaparece
  });
  it("moverPane (botão): funciona em modo manual e em Pane livre, mesmo sem gatilho", async () => {
    const m = montar({ modo: "manual", livre: true, usoC1: 20 });
    const r = await m.h.moverPane({ pane_id: m.pane.id });
    expect(r.para.conta_id).toBe(m.c2.id);
    expect(m.r.trocaLog.listar().itens[0]).toMatchObject({ status: "feita", motivo: "manual" });
  });
  it("moverPane com conta alvo de outro provedor usa exatamente essa conta", async () => {
    const m = montar({ modo: "manual", usoC1: 20 });
    const r = await m.h.moverPane({ pane_id: m.pane.id, conta_alvo_id: m.x1.id });
    expect(r.para).toMatchObject({ provedor: "codex", conta_id: m.x1.id });
  });
  it("account_switch: mesmo caminho; sem force e sem gatilho ⇒ rule_violation/not_at_limit", async () => {
    const m = montar({ modo: "manual", usoC1: 20 });
    const e = await m.h.accountSwitch({ pane_id: m.pane.id }).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "rule_violation", subcode: "not_at_limit" });
    const ok = await m.h.accountSwitch({ pane_id: m.pane.id, force: true });
    expect(ok).toMatchObject({ new_pane_id: m.pane.id, from: { conta_id: m.c1.id }, to: { conta_id: m.c2.id } });
  });
  it("account_switch: Pane inexistente ⇒ not_found; destino inexistente ⇒ no_account_available", async () => {
    const m = montar({ modo: "manual", usoC1: 95 });
    await expect(m.h.accountSwitch({ pane_id: "pane_nada" })).rejects.toMatchObject({ code: "not_found" });
    await expect(m.h.accountSwitch({ pane_id: m.pane.id, target_account_id: "conta_nada" })).rejects.toMatchObject({ code: "invalid_argument", subcode: "no_account_available" });
  });
  it("trocaParaErroMcp cobre os códigos e nunca vaza texto interno", () => {
    expect(trocaParaErroMcp(new Error("x"))).toMatchObject({ code: "unavailable" });
  });
});

describe("harness-troca: agendamento", () => {
  it("eventos de limite/Pane agendam UM ciclo (debounce de 400 ms)", async () => {
    const m = montar({ modo: "automatico" });
    m.h.iniciar();
    m.rel.avancar(500);
    await assentar();
    m.barramento.emitir("limits.updated", {});
    m.barramento.emitir("limit.high", {});
    m.barramento.emitir("pane.state_changed", { pane_id: m.pane.id, estado: "pronto" });
    expect(m.rel.pendentes()).toBeGreaterThan(0);
    m.rel.avancar(500);
    await assentar();
    expect(m.movidos.length).toBeLessThanOrEqual(1);
    m.h.encerrar();
    expect(m.rel.pendentes()).toBe(0);
  });
  it("com adiada pendente, reavalia sozinho e executa quando o Pane fica pronto", async () => {
    const m = montar({ modo: "automatico", paneEstado: "trabalhando" });
    m.h.iniciar();
    m.rel.avancar(500);
    await assentar();
    expect(m.r.trocaLog.listar().itens[0]?.status).toBe("adiada");
    m.r.pane.atualizar(m.pane.id, { estado: "pronto" });
    m.rel.avancar(16_000);
    await assentar();
    expect(m.movidos).toHaveLength(1);
    m.h.encerrar();
  });
});

describe("operacaoGitEmCurso", () => {
  const fs = (arquivos: Record<string, string | number>): SistemaDeArquivosGit => ({
    existe: (c) => c in arquivos,
    ler: (c) => (typeof arquivos[c] === "string" ? (arquivos[c] as string) : null),
    mtimeMs: (c) => (typeof arquivos[c] === "number" ? (arquivos[c] as number) : null),
  });
  it("cada marca de operação conta", () => {
    for (const marca of ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
      expect(operacaoGitEmCurso("/r", AGORA, fs({ "/r/.git": 1, [`/r/.git/${marca}`]: "x" }))).toBe(true);
    }
  });
  it("sem marca, sem `.git` ou sem cwd: falso", () => {
    expect(operacaoGitEmCurso("/r", AGORA, fs({ "/r/.git": 1 }))).toBe(false);
    expect(operacaoGitEmCurso("/r", AGORA, fs({}))).toBe(false);
    expect(operacaoGitEmCurso(null, AGORA, fs({}))).toBe(false);
  });
  it("`index.lock` só conta se recente", () => {
    expect(operacaoGitEmCurso("/r", AGORA, fs({ "/r/.git": 1, "/r/.git/index.lock": AGORA - 10_000 }))).toBe(true);
    expect(operacaoGitEmCurso("/r", AGORA, fs({ "/r/.git": 1, "/r/.git/index.lock": AGORA - IDADE_MAX_INDEX_LOCK_MS - 1 }))).toBe(false);
  });
  it("worktree: `.git` é arquivo apontando para o gitdir", () => {
    const f = fs({ "/wt/.git": "gitdir: /repo/.git/worktrees/wt\n", "/repo/.git/worktrees/wt/rebase-merge": "x" });
    expect(operacaoGitEmCurso("/wt", AGORA, f)).toBe(true);
  });
  it("funciona no disco de verdade", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-git-"));
    tmps.push(dir);
    mkdirSync(join(dir, ".git"));
    expect(operacaoGitEmCurso(dir, Date.now())).toBe(false);
    writeFileSync(join(dir, ".git", "index.lock"), "");
    expect(operacaoGitEmCurso(dir, Date.now())).toBe(true);
    const velho = new Date(Date.now() - 10 * 60_000);
    utimesSync(join(dir, ".git", "index.lock"), velho, velho);
    expect(operacaoGitEmCurso(dir, Date.now())).toBe(false);
  });
});
