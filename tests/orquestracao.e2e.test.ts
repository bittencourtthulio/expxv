// E2E da orquestração no Electron real (T-03.08): o piloto e os workers são a CLI falsa
// `tests/fixtures/mcp/cli-orq.mjs`, que fala MCP de verdade com o servidor do app (worker thread) e roda os
// hooks do settings de cada Pane como o Claude Code faria. A pasta de CLIs falsas entra pelo gancho de teste
// (só existe com a variável E2E do produto): é a ÚNICA detecção, então a CLI real da pessoa nunca é lançada.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PRODUTO, variavelDeAmbiente } from "../src/nucleo/produto";
import { criarAmbienteOrq, esperar, processosDeWorker, type AmbienteOrq, type JanelaOrq } from "./fixtures/mcp/ambiente-orq";

let amb: AmbienteOrq;
let a: AmbienteOrq["app"];
let raiz: string;

beforeAll(async () => {
  amb = await criarAmbienteOrq();
  a = amb.app;
  raiz = amb.raiz;
}, 120_000);

afterEach(async () => {
  await amb.abortarCriadas();
});

afterAll(async () => {
  await amb?.fechar();
});

const iniciarMissao = (...args: Parameters<AmbienteOrq["iniciarMissao"]>) => amb.iniciarMissao(...args);
const spawnWorker = (...args: Parameters<AmbienteOrq["spawnWorker"]>) => amb.spawnWorker(...args);
const eventos = (id: string) => amb.eventos(id);
const chamadasDoPiloto = (id: string) => amb.chamadasDoPiloto(id);
const detalhe = (id: string) => amb.detalhe(id);
type JanelaTeste = JanelaOrq;

// ---------------------------------------------------------------- cenários
describe("orquestração no Electron real", () => {
  it("delegação 1+1: worker entrega pelo handoff, o piloto recebe o wake em < 2 s e segue livre; Pane do worker na UI; nenhum processo órfão", async () => {
    await a.pagina.evaluate(() => {
      const w = window as unknown as JanelaTeste;
      w.__mudancas = 0;
      w.ade.missoes.assinar(() => { w.__mudancas = (w.__mudancas ?? 0) + 1; });
    });
    const missao = await iniciarMissao("Somar", {
      esperar_wake: true,
      chamadas: [spawnWorker({ worker: "handoff", resumo: "2" })],
    });

    const wake = await esperar(async () => (await eventos(missao.id)).find((l) => l.evento === "wake"), 30_000);
    const ev = await eventos(missao.id);
    const spawn = ev.find((l) => l.evento === "chamada" && l.tool === "pane_spawn")!;
    const handoff = ev.find((l) => l.evento === "handoff")!;
    expect(spawn.ok).toBe(true);
    expect(handoff.ok).toBe(true);
    expect(String(wake["texto"])).toMatch(new RegExp(`^\\[wake\\] Worker pane_\\w+ entregou o card t-1 \\(ok\\): 2 Relatório: ${PRODUTO.pastaNoProjeto.replace(".", "\\.")}/relatorios/task_\\w+\\.md`));
    expect(wake.t - (handoff["t1"] as number)).toBeLessThan(2000); // aceite T-03.03
    // o piloto segue livre depois do wake
    const livre = await esperar(async () => (await eventos(missao.id)).find((l) => l.evento === "livre"));
    expect(livre["ok"]).toBe(true);

    // o que cada lado viu: piloto com todas as tools do modo agêntico; worker só com handoff_submit
    expect((ev.find((l) => l.quem === "piloto" && l.evento === "tools")?.["tools"] as string[]).sort()).toEqual(
      ["catalog_list", "handoff_submit", "mission_complete", "mission_list", "model_list", "pane_close", "pane_list", "pane_read", "pane_send", "pane_spawn", "provider_list"],
    );
    expect(ev.find((l) => l.quem === "worker" && l.evento === "tools")?.["tools"]).toEqual(["handoff_submit"]);
    // SessionStart entregou instruções + briefing ao worker
    expect(ev.find((l) => l.quem === "worker" && l.evento === "session_start")).toMatchObject({ tem_briefing: true });

    // estado que a UI lê: Pane do worker com papel e CLI certos, card entregue, handoff apontando para o piloto
    const d = (await detalhe(missao.id))!;
    const pilotoPane = d.panes.find((p) => p.eh_piloto)!;
    const workerPane = d.panes.find((p) => !p.eh_piloto)!;
    expect(pilotoPane).toMatchObject({ papel: "piloto", cli: "claude", display_id: 1 });
    expect(workerPane).toMatchObject({ papel: "executor", cli: "claude", display_id: 2 });
    expect(d.tasks[0]).toMatchObject({ task_ref: "t-1", estado: "entregue", pane_id: workerPane.id });
    expect(d.handoffs[0]).toMatchObject({ status: "ok", resumo: "2", para_pane_id: pilotoPane.id, de_pane_id: workerPane.id });
    expect(existsSync(join(raiz, d.handoffs[0]!.relatorio_path!))).toBe(true);
    expect(d.mission.estado).toBe("executando");
    expect(await a.pagina.evaluate(() => (window as unknown as JanelaTeste).__mudancas)).toBeGreaterThan(0); // a UI foi avisada

    // o sistema fecha o Pane do worker depois do handoff: sem Pane ativo, sem processo
    await esperar(async () => (await detalhe(missao.id))?.panes.find((p) => p.id === workerPane.id)?.estado === "encerrado", 15_000);
    await esperar(() => processosDeWorker() === 0, 10_000);
    const sessoes = await a.pagina.evaluate(() => (window as unknown as JanelaTeste).ade.terminais.listarSessoes());
    expect(sessoes.filter((s) => s.estado === "executando")).toHaveLength(1); // só o piloto

    // segurança: settings e token ficam no diretório do app, 0600; nada em .claude do projeto
    const pasta = join(a.pastaDados, "panes", workerPane.id);
    expect(statSync(join(pasta, "mcp.json")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(pasta, "claude-settings.json"))).toBe(true);
    expect(existsSync(join(raiz, ".claude"))).toBe(false);
  });

  it("stop hook barra o worker sem handoff e libera na 3ª tentativa marcando failed", async () => {
    const missao = await iniciarMissao("Sem entrega", {
      esperar_wake: true,
      chamadas: [spawnWorker({ worker: "sem-handoff" })],
    });
    await esperar(async () => (await eventos(missao.id)).find((l) => l.evento === "wake"), 30_000);
    const stops = await esperar(async () => {
      const s = (await eventos(missao.id)).filter((l) => l.evento === "stop").map((l) => l["bloqueado"]);
      return s.length >= 4 ? s : undefined;
    });
    expect(stops.slice(0, 4)).toEqual([true, true, true, false]); // max_stop_retries = 3
    const d = (await detalhe(missao.id))!;
    expect(d.handoffs[0]).toMatchObject({ status: "falhou" });
    expect(d.tasks[0]).toMatchObject({ estado: "reivindicada" }); // falhou não entrega o card
    expect(existsSync(join(raiz, d.handoffs[0]!.relatorio_path!))).toBe(true); // relatório-stub gravado
    const wake = (await eventos(missao.id)).find((l) => l.evento === "wake")!;
    expect(String(wake["texto"])).toContain("(falhou)");
    await esperar(async () => (await detalhe(missao.id))?.panes.filter((p) => !p.eh_piloto).every((p) => p.estado === "encerrado"), 15_000);
    await esperar(() => processosDeWorker() === 0, 10_000);
  });

  it("forbidden_role: o worker não abre Panes (a tool nem existe para ele)", async () => {
    const missao = await iniciarMissao("Worker abelhudo", { chamadas: [spawnWorker({ worker: "handoff", resumo: "x", tentar_spawn: true })] });
    const tentativa = await esperar(async () => (await eventos(missao.id)).find((l) => l.evento === "spawn_do_worker"), 30_000);
    expect(tentativa).toMatchObject({ ok: false, erro: { code: "rule_violation", subcode: "forbidden_role" } });
  });

  it("gate_pending: sem o portão do intake liberado nenhum worker nasce (sem card, sem processo)", async () => {
    const missao = await iniciarMissao("Sem portão", { chamadas: [spawnWorker({ worker: "ocioso" })] }, []);
    const r = await esperar(async () => (await chamadasDoPiloto(missao.id))[0], 30_000);
    expect(r).toMatchObject({ ok: false, erro: { code: "rule_violation", subcode: "gate_pending" } });
    const d = (await detalhe(missao.id))!;
    expect(d.tasks).toHaveLength(0);
    expect(d.panes).toHaveLength(1);
    expect(processosDeWorker()).toBe(0);
  });

  it("reviewer_required: mission_complete exige handoff ok de revisor", async () => {
    const missao = await iniciarMissao("Sem revisor", { chamadas: [{ tool: "mission_complete", args: {} }] });
    const r = await esperar(async () => (await chamadasDoPiloto(missao.id))[0], 30_000);
    expect(r).toMatchObject({ ok: false, erro: { code: "rule_violation", subcode: "reviewer_required" } });
    expect((await detalhe(missao.id))?.mission.estado).not.toBe("concluida");
  });

  it("provider_disabled: provedor com todas as contas desabilitadas ou não instalado não abre worker", async () => {
    const conta = await a.pagina.evaluate(() => (window as unknown as JanelaTeste).ade.provedores.criarConta("codex", "Teste"));
    await a.pagina.evaluate((id) => (window as unknown as JanelaTeste).ade.provedores.habilitarConta(id, false), conta.id);
    const missao = await iniciarMissao("Provedor fora", {
      chamadas: [
        { tool: "pane_spawn", args: { provider: "codex", role: "executor" } },
        { tool: "pane_spawn", args: { provider: "gemini", role: "executor" } },
        { tool: "provider_list", args: {} },
      ],
    });
    const chamadas = await esperar(async () => {
      const c = await chamadasDoPiloto(missao.id);
      return c.length === 3 ? c : undefined;
    }, 30_000);
    expect(chamadas[0]).toMatchObject({ ok: false, erro: { subcode: "provider_disabled" } });
    expect(chamadas[1]).toMatchObject({ ok: false, erro: { subcode: "provider_disabled" } });
    expect((chamadas[2]?.["resultado"] as Array<{ provider: string }>).map((p) => p.provider)).toEqual(["claude"]); // só os habilitados
    expect((await detalhe(missao.id))?.tasks).toHaveLength(0);
  });

  it("limit_reached: o 9º worker é recusado sem derrubar nada; abortar a Missão limpa todos os processos", async () => {
    const chamadas = Array.from({ length: 9 }, () => spawnWorker({ worker: "ocioso" }));
    const missao = await iniciarMissao("Muitos workers", { chamadas });
    const feitas = await esperar(async () => {
      const c = await chamadasDoPiloto(missao.id);
      return c.length === 9 ? c : undefined;
    }, 60_000);
    expect(feitas.slice(0, 8).every((c) => c["ok"] === true)).toBe(true);
    expect(feitas[8]).toMatchObject({ ok: false, erro: { code: "rule_violation", subcode: "limit_reached" } });
    const d = (await detalhe(missao.id))!;
    expect(d.panes.filter((p) => !p.eh_piloto && p.estado !== "encerrado")).toHaveLength(8);
    expect(d.tasks.filter((t) => t.estado !== "descartada")).toHaveLength(8);
    await esperar(() => processosDeWorker() === 8, 15_000); // cada worker vivo tem um Pane
    await a.pagina.evaluate((m) => (window as unknown as JanelaTeste).ade.missoes.abortar(m), missao.id);
    await esperar(() => processosDeWorker() === 0, 15_000);
  }, 120_000);

  it("token adulterado → unauthorized; o guarda do piloto barra escrita fora da pasta do produto", async () => {
    const missao = await iniciarMissao("Segurança", { adulterar: true, guarda: ["src/x.ts", ".expxv/ok.md"] });
    const adulterado = await esperar(async () => (await eventos(missao.id)).find((l) => l.evento === "adulterado"), 30_000);
    expect(adulterado["status"]).toBe(401);
    const guardas = await esperar(async () => {
      const g = (await eventos(missao.id)).filter((l) => l.evento === "guarda");
      return g.length === 2 ? g : undefined;
    });
    expect(guardas[0]).toMatchObject({ caminho: "src/x.ts", decisao: "deny" });
    expect(guardas[1]).toMatchObject({ caminho: ".expxv/ok.md", decisao: "allow" });
  });

  it("sem a variável E2E do produto a pasta de CLIs falsas não vale (a CLI real nunca é trocada)", async () => {
    const { criarGanchoE2E } = await import("../src/main/gancho-e2e");
    expect(criarGanchoE2E({ [variavelDeAmbiente("E2E_CLIS")]: "/tmp/x" })).toBeNull();
  });

  it("token sobrevive a reinício do app: o worker recuperado do daemon ainda entrega o handoff; depois de encerrar o Pane o mesmo token vira unauthorized", async () => {
    const liberarEntrega = ".e2e-entrega-tardia";
    const missao = await iniciarMissao("Reinício", {
      chamadas: [
        spawnWorker({ worker: "handoff", resumo: "depois do reinício", esperar: liberarEntrega }),
        spawnWorker({ worker: "ocioso" }),
      ],
    });
    const workers = await esperar(async () => {
      const d = await detalhe(missao.id);
      const w = d?.panes.filter((p) => !p.eh_piloto && p.estado !== "encerrado") ?? [];
      return w.length === 2 ? w : undefined;
    }, 30_000);
    // os dois workers já subiram e leram o token (o log registra as tools que cada um viu)
    await esperar(async () => (await eventos(missao.id)).filter((l) => l.quem === "worker" && l.evento === "tools").length === 2, 30_000);
    const credencial = (paneId: string): { url: string; token: string } => {
      const cfg = JSON.parse(readFileSync(join(amb.app.pastaDados, "panes", paneId, "mcp.json"), "utf8")) as { mcpServers: Record<string, { url: string; headers: { Authorization: string } }> };
      const srv = Object.values(cfg.mcpServers)[0]!;
      return { url: srv.url, token: srv.headers.Authorization.replace(/^Bearer\s+/i, "") };
    };
    const status = async (c: { url: string; token: string }): Promise<number> => {
      const r = await fetch(c.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${c.token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } }),
      });
      await r.text();
      return r.status;
    };
    // o worker que entrega depois é o do briefing com `esperar`: identifica pelo log da CLI falsa
    const logTardio = amb.linhasDoLog().find((l) => l.quem === "worker" && l.evento === "inicio" && JSON.stringify(l["diretiva"]).includes(liberarEntrega));
    const idTardio = logTardio!.pane;
    const idOcioso = workers.find((w) => w.id !== idTardio)!.id;
    const credTardio = credencial(idTardio);
    const credOcioso = credencial(idOcioso);
    expect(await status(credTardio)).toBe(200);
    const antes = (await detalhe(missao.id))!.panes.find((p) => p.id === idOcioso)!;
    expect(antes.estado).not.toBe("encerrado");

    // reinício: o app fecha SEM descartar as sessões (o daemon e as CLIs ficam vivas) e reabre na mesma pasta
    const reaberto = await amb.reiniciar();
    expect(reaberto.pastaDados).toBe(amb.app.pastaDados);
    const recuperados = await esperar(async () => {
      const d = await detalhe(missao.id);
      const vivos = d?.panes.filter((p) => !p.eh_piloto && p.estado !== "encerrado").map((p) => p.id).sort() ?? [];
      return vivos.length === 2 ? vivos : undefined;
    }, 30_000);
    expect(recuperados).toEqual([idTardio, idOcioso].sort());

    // com o token ANTIGO (mesma URL, porta reaproveitada) o servidor novo aceita os dois
    // (o servidor novo sobe na onda 2 do boot: espera aceitar conexões)
    const statusQuandoNoAr = (c: { url: string; token: string }) => esperar(async () => status(c).catch(() => undefined), 30_000);
    expect(await statusQuandoNoAr(credTardio)).toBe(200);
    expect(await statusQuandoNoAr(credOcioso)).toBe(200);

    // o worker recuperado entrega o handoff com o token antigo
    writeFileSync(join(raiz, liberarEntrega), "");
    const entrega = await esperar(async () => (await eventos(missao.id)).find((l) => l.evento === "handoff"), 30_000);
    expect(entrega["ok"]).toBe(true);
    const d = (await detalhe(missao.id))!;
    expect(d.handoffs.find((h) => h.de_pane_id === idTardio)).toMatchObject({ status: "ok", resumo: "depois do reinício" });

    // encerrar o Pane ocioso (a Missão é abortada: o serviço encerra os Panes): o mesmo token vira unauthorized
    expect(await status(credOcioso)).toBe(200);
    await amb.app.pagina.evaluate((m) => (window as unknown as JanelaTeste).ade.missoes.abortar(m), missao.id);
    await esperar(async () => (await detalhe(missao.id))?.panes.find((p) => p.id === idOcioso)?.estado === "encerrado", 15_000);
    await esperar(async () => (await status(credOcioso)) === 401, 10_000);
    expect(await status(credOcioso)).toBe(401);
  }, 180_000);
});
