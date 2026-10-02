import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventoLimites } from "../compartilhado/limites";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { caminhoStatusline } from "../nucleo/limites/adaptadores/claude-statusline";
import { VERSAO_CONSENTIMENTO_PRECISAO, chaveConfigPrecisao } from "../nucleo/limites/adaptadores/precisao-maxima";
import type { Agendador } from "../nucleo/limites/servico";
import { criarBarramento } from "./barramento";
import { criarLimitesMain, type DependenciasLimitesMain, type ObservarPasta } from "./limites";

const FIX = resolve(__dirname, "../../tests/fixtures/limites");
const T0 = Date.parse("2026-10-01T12:00:00.000Z");

function relogio() {
  let agora = T0;
  const gancho: { esperar: () => Promise<void> } = { esperar: async () => undefined };
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
    for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
    await gancho.esperar(); // leituras de arquivo de verdade terminam em tempo imprevisível
    for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
  };
  return {
    gancho,
    agendador,
    agora: () => agora,
    pendentes: () => timers.size,
    assentar,
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

const bancos: Banco[] = [];
const pastas: string[] = [];
afterEach(() => {
  bancos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

function montar(opc: { foco?: boolean; banco?: Banco; pastaDeDados?: string; extra?: Partial<DependenciasLimitesMain> } = {}) {
  const banco = opc.banco ?? abrirBanco(":memory:");
  if (opc.banco === undefined) {
    bancos.push(banco);
    migrar(banco);
  }
  const repos = criarRepositorios(banco);
  const pastaDeDados = opc.pastaDeDados ?? mkdtempSync(join(tmpdir(), "ade-limites-main-"));
  if (opc.pastaDeDados === undefined) pastas.push(pastaDeDados);
  const rel = relogio();
  const barramento = criarBarramento(rel.agendador);
  const noBarramento: Array<[string, unknown]> = [];
  for (const t of ["limits.updated", "limit.high", "limit.reached"]) barramento.assinar(t, (p) => noBarramento.push([t, p]));
  const noRenderer: EventoLimites[] = [];
  const foco = { v: opc.foco ?? true };
  const observadores: Array<{ dir: string; aoArquivo: (n: string) => void; fechado: boolean }> = [];
  const observarPasta: ObservarPasta = (dir, aoArquivo) => {
    const o = { dir, aoArquivo, fechado: false };
    observadores.push(o);
    return { fechar: () => void (o.fechado = true) };
  };
  const contasRepo = repos.conta;
  const configs = new Map<string, string | null>();
  const contas = {
    listar: () => contasRepo.listar({ limite: 500 }).itens,
    configDirAbsoluto: (c: { config_dir_ref: string | null }) => configs.get(c.config_dir_ref ?? "") ?? null,
  };
  const lm = criarLimitesMain({ repos, contas, barramento, emitirRenderer: (e) => noRenderer.push(e), pastaDeDados, foco: () => foco.v, agora: rel.agora, agendador: rel.agendador, observarPasta, ...opc.extra });
  rel.gancho.esperar = () => lm.servico.aguardarLeituras();
  return { banco, repos, pastaDeDados, rel, lm, barramento, noBarramento, noRenderer, foco, observadores, configs };
}

const instalarStatusline = (pastaDeDados: string, contaId: string, fixture = "statusline-completo.json"): void => {
  const alvo = caminhoStatusline(pastaDeDados, contaId)!;
  mkdirSync(join(alvo, ".."), { recursive: true });
  copyFileSync(join(FIX, "claude", fixture), alvo);
};

describe("limites no main (T-09.08)", () => {
  it("watcher só marca suja (debounce 300 ms); a leitura acontece e o `atualizado` chega em ≤ 600 ms ao renderer e ao barramento", async () => {
    const m = montar();
    m.lm.iniciar();
    await m.rel.assentar();
    const c = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" }); // nasce depois do boot: sem leitura recente
    expect(m.observadores).toHaveLength(1);
    expect(m.observadores[0]?.dir).toBe(join(m.pastaDeDados, "limites", "claude"));
    instalarStatusline(m.pastaDeDados, c.id);
    // rajada de eventos do SO para o mesmo arquivo + o .tmp do script (ignorado)
    for (let i = 0; i < 10; i++) m.observadores[0]?.aoArquivo(`${c.id}.json`);
    m.observadores[0]?.aoArquivo(`${c.id}.json.123.abc.tmp`);
    m.observadores[0]?.aoArquivo("../fora.json");
    await m.rel.avancar(299);
    expect(m.lm.servico.snapshot().contas[0]?.slack_pct).toBeNull(); // ainda no debounce
    await m.rel.avancar(2);
    expect(m.lm.servico.snapshot().contas[0]?.bottleneck).toBe("five_hour");
    const t0 = m.rel.agora();
    await m.rel.avancar(600 - (m.rel.agora() - t0));
    expect(m.noRenderer.filter((e) => e.tipo === "atualizado")).toEqual([{ tipo: "atualizado", contas: [c.id] }]);
    expect(m.noBarramento.filter(([t]) => t === "limits.updated")).toEqual([["limits.updated", { contas: [c.id] }]]);
    m.lm.encerrar();
  });

  it("sem foco: zero leituras; ao voltar o foco lê", async () => {
    const m = montar({ foco: false });
    const c = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
    instalarStatusline(m.pastaDeDados, c.id);
    m.lm.iniciar();
    m.observadores[0]?.aoArquivo(`${c.id}.json`);
    await m.rel.avancar(5 * 60_000);
    expect(m.lm.servico.estatisticas().leituras).toBe(0);
    expect(m.lm.servico.snapshot().contas[0]?.slack_pct).toBeNull();
    m.foco.v = true;
    m.lm.aoFocoMudar(true);
    await m.rel.assentar();
    expect(m.lm.servico.snapshot().contas[0]?.bottleneck).toBe("five_hour");
    m.lm.encerrar();
  });

  it("encerrar fecha o watcher e não deixa timer pendente", async () => {
    const m = montar();
    const c = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
    m.lm.iniciar();
    m.observadores[0]?.aoArquivo(`${c.id}.json`);
    m.lm.encerrar();
    expect(m.observadores[0]?.fechado).toBe(true);
    await m.rel.assentar(); // leituras em voo terminam e soltam o timer de timeout
    expect(m.rel.pendentes()).toBe(0);
  });

  it("Codex: lê o rollout do config dir da conta; conta sem pasta fica sem dado", async () => {
    const m = montar();
    const c = m.repos.conta.criar({ provedor: "codex", rotulo: "cx·1", config_dir_ref: "ref1" });
    const sem = m.repos.conta.criar({ provedor: "codex", rotulo: "cx·2", config_dir_ref: "ref2" });
    m.configs.set("ref1", join(FIX, "codex/conta-ok"));
    m.configs.set("ref2", null);
    await m.lm.servico.atualizar();
    const r = m.lm.servico.snapshot();
    const por = Object.fromEntries(r.contas.map((u) => [u.account_id, u]));
    expect(por[c.id]?.fonte).toBe("codex_rollout");
    expect(por[c.id]?.windows.find((j) => j.kind === "weekly")?.used_pct).toBe(46.5);
    expect(por[sem.id]?.slack_pct).toBeNull();
    expect(r.geral.cobertura).toEqual({ com_dado: 1, total: 2 });
  });

  it("limite manual: sobrevive a reinício, e some do merge quando um medido mais novo chega", async () => {
    const m = montar();
    const c = m.repos.conta.criar({ provedor: "gemini", rotulo: "gm·1" });
    const reinicia = new Date(T0 + 3 * 3_600_000).toISOString();
    m.repos.limiteManual.definir(c.id, "five_hour", 70, reinicia, new Date(T0 - 1000).toISOString());
    await m.lm.servico.recarregarFonte(c.id, "manual");
    expect(m.lm.servico.usoDe(c.id)).toMatchObject({ confianca: "manual", bottleneck: "five_hour", slack_pct: 30 });
    // "reinício": novo main sobre o mesmo banco
    const m2 = montar({ banco: m.banco, pastaDeDados: m.pastaDeDados });
    await m2.lm.servico.atualizar();
    expect(m2.lm.servico.usoDe(c.id)).toMatchObject({ confianca: "manual", slack_pct: 30 });
    // medido mais novo (Claude statusline na mesma conta de teste simulada com provedor claude)
    const cl = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
    m.repos.limiteManual.definir(cl.id, "five_hour", 99, reinicia, new Date(T0 - 3_600_000).toISOString());
    instalarStatusline(m.pastaDeDados, cl.id); // recebido_em 11:58 → mais novo que o manual das 11:00
    await m.rel.avancar(6_000);
    await m.lm.servico.atualizar(cl.id);
    expect(m.lm.servico.usoDe(cl.id)).toMatchObject({ confianca: "medido" });
    expect(m.lm.servico.usoDe(cl.id).windows.find((j) => j.kind === "five_hour")?.used_pct).toBe(62);
  });

  it("valor manual expira quando reinicia_em passa (e some do banco no próximo boot)", async () => {
    const m = montar();
    const c = m.repos.conta.criar({ provedor: "gemini", rotulo: "gm·1" });
    m.repos.limiteManual.definir(c.id, "five_hour", 70, new Date(T0 + 60_000).toISOString());
    await m.lm.servico.atualizar();
    expect(m.lm.servico.usoDe(c.id).slack_pct).toBe(30);
    await m.rel.avancar(120_000);
    await m.lm.servico.recarregarFonte(c.id, "manual");
    expect(m.lm.servico.usoDe(c.id).slack_pct).toBeNull();
    m.lm.iniciar();
    expect(m.repos.limiteManual.listar(c.id)).toEqual([]);
    m.lm.encerrar();
  });

  it("consumo_alto vira `limit.high` no barramento (alimenta a troca automática); limiar configurável", async () => {
    const m = montar();
    const c = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
    instalarStatusline(m.pastaDeDados, c.id); // 62%
    await m.lm.servico.atualizar();
    expect(m.noBarramento.filter(([t]) => t === "limit.high")).toEqual([]);
    m.repos.config.definir("limites.limiar_troca_pct", 60);
    await m.rel.avancar(61_000);
    m.repos.limiteManual.definir(c.id, "five_hour", 99, new Date(T0 + 3_600_000).toISOString(), new Date(m.rel.agora()).toISOString());
    await m.lm.servico.recarregarFonte(c.id, "manual");
    expect(m.noBarramento.some(([t, p]) => t === "limit.high" && (p as { conta_id: string }).conta_id === c.id)).toBe(true);
    expect(m.noBarramento.some(([t]) => t === "limit.reached")).toBe(false);
  });

  it("frase de limite no PTY: limit.reached no barramento e cooldown gravado (+5 min); eco do prompt não conta", async () => {
    const m = montar();
    const c = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
    const pane = { pane_id: "pane_1", conta_id: c.id, provedor: "claude" };
    m.lm.aoEnvioAoPane("pane_1", "explique usage limit reached");
    m.lm.aoSaidaDoPane(pane, "> explique usage limit reached\r\n");
    expect(m.noBarramento.filter(([t]) => t === "limit.reached")).toEqual([]);
    m.lm.aoSaidaDoPane(pane, "Claude usage limit reached. Your limit will reset at 3pm (UTC)\r\n");
    expect(m.noBarramento.filter(([t]) => t === "limit.reached")).toEqual([["limit.reached", { conta_id: c.id, janela: "five_hour", pane_id: "pane_1", fonte: "saida_do_pty" }]]);
    expect(m.repos.contaRoteamento.obter(c.id)?.em_cooldown_ate).toBe("2026-10-01T15:00:00.000Z");
    expect(m.noRenderer.some((e) => e.tipo === "limite_atingido" && e.fonte === "saida_do_pty")).toBe(true);
    m.lm.liberarPane("pane_1");
    m.lm.aoSaidaDoPane({ pane_id: "p2", conta_id: null, provedor: "claude" }, "Claude usage limit reached.\r\n"); // sem conta: ignora
    m.lm.aoSaidaDoPane({ pane_id: "p3", conta_id: c.id, provedor: "gemini" }, "usage limit reached\r\n"); // sem detector
    expect(m.noBarramento.filter(([t]) => t === "limit.reached")).toHaveLength(1);
  });

  it("opt-out da statusline (`limites.claude_statusline=false`) desliga a fonte", async () => {
    const m = montar();
    const c = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
    instalarStatusline(m.pastaDeDados, c.id);
    m.repos.config.definir("limites.claude_statusline", false);
    await m.lm.servico.atualizar();
    expect(m.lm.servico.usoDe(c.id).slack_pct).toBeNull();
  });

  it("Precisão máxima: padrão desligado = a fonte oficial nunca é chamada; ligada com consentimento versionado, é", async () => {
    let chamadas = 0;
    const fonteOficial = { claude: { obter: async () => { chamadas++; return { five_hour: { used_percentage: 41, resets_at: Math.floor(T0 / 1000) + 3600 } }; } } };
    const m = montar({ extra: { fonteOficial } });
    const c = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
    await m.lm.servico.atualizar();
    expect(chamadas).toBe(0);
    m.repos.config.definir(chaveConfigPrecisao("claude"), { ativo: true, versao: VERSAO_CONSENTIMENTO_PRECISAO - 1, em: "2026-10-01T00:00:00.000Z" });
    await m.rel.avancar(6_000);
    await m.lm.servico.atualizar();
    expect(chamadas).toBe(0); // consentimento de versão antiga do texto não vale
    m.repos.config.definir(chaveConfigPrecisao("claude"), { ativo: true, versao: VERSAO_CONSENTIMENTO_PRECISAO, em: "2026-10-01T00:00:00.000Z" });
    await m.rel.avancar(6_000);
    await m.lm.servico.atualizar();
    expect(chamadas).toBe(1);
    expect(m.lm.servico.usoDe(c.id).windows[0]?.used_pct).toBe(41);
  });

  it("nenhum token ou credencial aparece no snapshot (varredura por sentinela)", async () => {
    const SENT = "sk-ant-SENTINELA-123456";
    const m = montar();
    const c = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
    const alvo = caminhoStatusline(m.pastaDeDados, c.id)!;
    mkdirSync(join(alvo, ".."), { recursive: true });
    writeFileSync(alvo, JSON.stringify({ v: 1, recebido_em: "2026-10-01T11:58:00.000Z", token: SENT, rate_limits: { five_hour: { used_percentage: 20, resets_at: 1790860800 }, access_token: SENT }, model: { id: "x", key: SENT } }));
    await m.lm.servico.atualizar();
    expect(JSON.stringify(m.lm.servico.snapshot())).not.toContain(SENT);
    expect(JSON.stringify(m.noRenderer)).not.toContain(SENT);
  });
});
