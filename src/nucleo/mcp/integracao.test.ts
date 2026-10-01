/**
 * Integração em Node (sem Electron): servidor MCP REAL + portas falsas + serviços reais de handoff,
 * fila de wake e ganchos, falando com a CLI falsa (`tests/fixtures/mcp/cli-mcp.mjs`), que usa o
 * cliente MCP real e lê URL/token do ambiente. Cobre a delegação 1+1 e as regras do contrato.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarMundo, type Mundo } from "../../../tests/fixtures/mcp/dubles";
import type { Papel, StatusHandoff } from "../dominio";
import { criarGanchosClaude } from "../orquestracao/hooks/claude";
import { criarServicoHandoff, type PersistenciaHandoff } from "../orquestracao/handoff";
import { VARIAVEL_TOKEN, VARIAVEL_URL_GANCHOS } from "../orquestracao/piloto";
import { criarFilaWake } from "../orquestracao/wake";
import { PRODUTO } from "../produto";
import type { MissaoInfo, PortaPanes } from "./portas";
import { iniciarServidorMcp, type ServidorMcp } from "./servidor";
import { criarEmissorDeTokens } from "./tokens";

const RAIZ_REPO = join(__dirname, "..", "..", "..");
const CLI = join(RAIZ_REPO, "tests", "fixtures", "mcp", "cli-mcp.mjs");
const GANCHO = join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs");

interface SaidaCli {
  ok: boolean;
  resultado?: unknown;
  erro?: { code: string; subcode?: string; message: string };
}

function executar(args: string[], env: Record<string, string>, entrada?: string): Promise<{ saida: string; codigo: number | null }> {
  return new Promise((ok, erro) => {
    const filho = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let saida = "";
    filho.stdout.on("data", (d: Buffer) => (saida += d.toString()));
    filho.on("error", erro);
    filho.on("close", (codigo) => ok({ saida, codigo }));
    filho.stdin.end(entrada ?? "");
  });
}

async function rodarCli(servidor: ServidorMcp, token: string, ...args: string[]): Promise<SaidaCli> {
  const { saida } = await executar([CLI, ...args], { CLI_MCP_URL: servidor.url, CLI_MCP_TOKEN: token });
  return JSON.parse(saida.trim().split("\n").pop() ?? "{}") as SaidaCli;
}

interface Ambiente {
  mundo: Mundo;
  servidor: ServidorMcp;
  emissor: ReturnType<typeof criarEmissorDeTokens>;
  fila: ReturnType<typeof criarFilaWake>;
  gravacoes: Array<{ t: number; status: StatusHandoff; task_id: string; pane_id: string }>;
  wakes: Array<{ t: number; pane_id: string; texto: string }>;
  workers: Array<Promise<SaidaCli>>;
  tokenPiloto(): string;
  tokenDe(pane_id: string, role: Papel): string;
}

const abertos: ServidorMcp[] = [];
afterEach(async () => {
  while (abertos.length > 0) await abertos.pop()?.fechar();
});

async function montar(opcoes: { modo?: "livre" | "squad" | "agentico"; portoes?: MissaoInfo["portoes_liberados"]; lancarWorkers?: boolean; atrasoWorkerMs?: number } = {}): Promise<Ambiente> {
  const mundo = criarMundo({ modo: opcoes.modo ?? "agentico", ...(opcoes.portoes === undefined ? {} : { portoes: opcoes.portoes }) });
  const emissor = criarEmissorDeTokens();
  const gravacoes: Ambiente["gravacoes"] = [];
  const wakes: Ambiente["wakes"] = [];
  const workers: Array<Promise<SaidaCli>> = [];
  const tarefas = new Map<string, string>();

  const persistencia: PersistenciaHandoff = {
    async gravar(d) {
      gravacoes.push({ t: Date.now(), status: d.status, task_id: d.task_id, pane_id: d.de_pane_id });
      mundo.handoffs.set(d.de_pane_id, { handoff_id: `hof_${gravacoes.length}`, relatorio_path: d.relatorio_path, status: d.status });
      return { handoff_id: `hof_${gravacoes.length}`, para_pane_id: "pane_p", task_ref: "T-01.01" };
    },
    doPane: async (id) => mundo.handoffs.get(id) ?? null,
    temRevisorOk: async () => mundo.revisorOk,
  };
  const fila = criarFilaWake({ enviar: async (pane_id, texto) => { wakes.push({ t: Date.now(), pane_id, texto }); return true; } });
  fila.aoMudarEstado("pane_p", "pronto");
  const servicoHandoff = criarServicoHandoff({
    raiz: async () => mundo.raiz,
    persistencia,
    fila,
    fecharPane: (p, motivo) => mundo.deps.panes.fechar(p, motivo),
    agendar: (fn) => { setTimeout(fn, 10); },
  });
  const ganchos = criarGanchosClaude({
    handoff: servicoHandoff,
    fila,
    contexto: async (pane_id) => {
      const p = mundo.panes.get(pane_id);
      return p === undefined ? null : { workspace_id: p.workspace_id, mission_id: p.mission_id, papel: p.papel, task_id: tarefas.get(pane_id) ?? null, task_ref: "T-01.01", briefing_path: null };
    },
    raiz: async () => mundo.raiz,
  });

  let servidor!: ServidorMcp;
  const tokenDe = (pane_id: string, role: Papel): string =>
    servidor.emitirToken({ workspace_id: "ws_1", mission_id: opcoes.modo === "livre" ? null : "mis_1", pane_id, role, mode: opcoes.modo ?? "agentico" });

  const basePanes = mundo.deps.panes;
  const panes: PortaPanes = {
    ...basePanes,
    async spawn(p) {
      const { pane_id } = await basePanes.spawn(p);
      const taskId = `tsk_${workers.length + 1}`;
      tarefas.set(pane_id, taskId);
      const pane = mundo.panes.get(pane_id);
      if (pane !== undefined) pane.task_id = taskId;
      if (opcoes.lancarWorkers !== false) {
        workers.push(
          executar([CLI, "worker", taskId, `${PRODUTO.pastaNoProjeto}/missoes/mis_1/relatorios/${taskId}.md`, "ok", "2"], {
            CLI_MCP_URL: servidor.url,
            CLI_MCP_TOKEN: tokenDe(pane_id, p.papel),
            CLI_MCP_RAIZ: mundo.raiz,
            CLI_MCP_ATRASO_MS: String(opcoes.atrasoWorkerMs ?? 300),
          }).then((r) => JSON.parse(r.saida.trim().split("\n").pop() ?? "{}") as SaidaCli),
        );
      }
      return { pane_id };
    },
  };

  servidor = await iniciarServidorMcp({ deps: { ...mundo.deps, panes, handoff: servicoHandoff }, emissor, ganchos });
  abertos.push(servidor);
  return {
    mundo, servidor, emissor, fila, gravacoes, wakes, workers,
    tokenPiloto: () => tokenDe("pane_p", opcoes.modo === "livre" ? "nenhum" : "piloto"),
    tokenDe,
  };
}

describe("integração: delegação 1+1", () => {
  it("pane_spawn → worker → handoff_submit → wake ao piloto (depois do handoff persistido), sem bloquear o piloto", async () => {
    const a = await montar({ atrasoWorkerMs: 3_000 });
    const inicio = Date.now();

    // o piloto delega e volta na hora
    const spawn = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "codex", role: "executor", briefing_path: "b.md" }));
    expect(spawn.ok).toBe(true);
    const { pane_id } = spawn.resultado as { pane_id: string };
    expect(Object.keys(spawn.resultado as object)).toEqual(["pane_id"]);

    // piloto NÃO bloqueado: o worker ainda não entregou e o piloto já consegue listar/ler
    expect(a.gravacoes).toHaveLength(0);
    const lista = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_list", "{}");
    expect(lista.ok).toBe(true);
    expect((lista.resultado as Array<{ pane_id: string }>).map((p) => p.pane_id)).toContain(pane_id);
    expect(a.wakes).toHaveLength(0);

    // o worker entrega
    const worker = await a.workers[0];
    expect(worker?.ok).toBe(true);
    expect(Object.keys(worker?.resultado as object)).toEqual(["handoff_id"]);
    await a.fila.ociosa();

    // ordem: relatório em disco → banco → wake
    const relatorio = join(a.mundo.raiz, PRODUTO.pastaNoProjeto, "missoes", "mis_1", "relatorios", "tsk_1.md");
    expect(existsSync(relatorio)).toBe(true);
    expect(readFileSync(relatorio, "utf8")).toContain("Resultado: 2");
    expect(a.gravacoes).toHaveLength(1);
    expect(a.wakes).toHaveLength(1);
    expect(a.wakes[0]?.pane_id).toBe("pane_p");
    expect(a.wakes[0]?.texto).toContain("T-01.01");
    expect(a.wakes[0]?.texto).toContain(": 2");

    // ordem: o wake só acontece DEPOIS do handoff persistido (a latência, P-15, é medida em tests/perf)
    expect(a.wakes[0]?.t ?? 0).toBeGreaterThanOrEqual(a.gravacoes[0]?.t ?? Infinity);
    expect(Date.now()).toBeGreaterThanOrEqual(inicio);

    // sem processo de worker sem Pane: o Pane do worker é fechado pelo sistema ao concluir
    await new Promise((r) => setTimeout(r, 60));
    expect(a.mundo.fechados).toEqual([{ pane_id, motivo: "handoff_done" }]);
  }, 30_000);

  it("AUD-04: porta preferida ocupada por OUTRO processo não é usada: o servidor sobe em outra e a porta nunca é a do intruso", async () => {
    const { createServer } = await import("node:net");
    const intruso = createServer();
    await new Promise<void>((ok) => intruso.listen(0, "127.0.0.1", () => ok()));
    const portaDoIntruso = (intruso.address() as { port: number }).port;
    try {
      const servidor = await iniciarServidorMcp({ deps: criarMundo().deps, emissor: criarEmissorDeTokens(), portaPreferida: portaDoIntruso });
      abertos.push(servidor);
      expect(servidor.porta).not.toBe(portaDoIntruso);
      expect(servidor.porta).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((ok) => intruso.close(() => ok()));
    }
  });

  it("piloto ocupado: o wake espera o próximo ponto seguro (Pane ocioso)", async () => {
    const a = await montar({ atrasoWorkerMs: 0 });
    a.fila.aoMudarEstado("pane_p", "trabalhando");
    await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude" }));
    await a.workers[0];
    await a.fila.ociosa();
    expect(a.gravacoes).toHaveLength(1);
    expect(a.wakes).toHaveLength(0);
    a.fila.aoMudarEstado("pane_p", "pronto");
    await a.fila.ociosa();
    expect(a.wakes).toHaveLength(1);
  }, 30_000);
});

describe("integração: regras do contrato via MCP real", () => {
  it("forbidden_role: worker não abre Pane; piloto não invoca o orquestrador", async () => {
    const a = await montar({ lancarWorkers: false });
    a.mundo.adicionarPane({ pane_id: "w_x", papel: "executor" });
    const worker = await rodarCli(a.servidor, a.tokenDe("w_x", "executor"), "chamar", "pane_spawn", JSON.stringify({ provider: "claude" }));
    expect(worker.erro).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    const orquestrador = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude", role: "orchestrator" }));
    expect(orquestrador.erro).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
  }, 30_000);

  it("gate_pending até o intake liberar", async () => {
    const a = await montar({ portoes: ["direction"], lancarWorkers: false });
    const r = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude", role: "executor" }));
    expect(r.erro).toMatchObject({ code: "rule_violation", subcode: "gate_pending" });
    const scout = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude", role: "scout" }));
    expect(scout.ok).toBe(true); // direction já liberado
  }, 30_000);

  it("reviewer_required: mission_complete só com revisor ok", async () => {
    const a = await montar({ lancarWorkers: false });
    const antes = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "mission_complete", "{}");
    expect(antes.erro).toMatchObject({ code: "rule_violation", subcode: "reviewer_required" });
    a.mundo.revisorOk = true;
    const depois = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "mission_complete", JSON.stringify({ mission_id: "mis_OUTRA" }));
    expect(depois).toEqual({ ok: true, resultado: { ok: true } });
    expect(a.mundo.concluidas).toEqual(["mis_1"]);
  }, 30_000);

  it("provider_disabled", async () => {
    const a = await montar({ lancarWorkers: false });
    const r = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "gemini" }));
    expect(r.erro).toMatchObject({ code: "rule_violation", subcode: "provider_disabled" });
    const m = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "model_list", JSON.stringify({ provider: "gemini" }));
    expect(m.erro).toMatchObject({ subcode: "provider_disabled" });
  }, 30_000);

  it("limit_reached no 9º worker, sem derrubar o servidor", async () => {
    const a = await montar({ lancarWorkers: false });
    for (let i = 0; i < 8; i++) {
      const r = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude" }));
      expect(r.ok).toBe(true);
    }
    const nono = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude" }));
    expect(nono.erro).toMatchObject({ code: "rule_violation", subcode: "limit_reached" });
    const ainda = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "provider_list", "{}");
    expect(ainda.ok).toBe(true);
  }, 60_000);

  it("token adulterado, expirado ou de outro processo → unauthorized", async () => {
    let agora = Date.now();
    const mundo = criarMundo();
    const emissor = criarEmissorDeTokens({ relogio: { agora: () => agora }, ttlMs: 5000 });
    const servidor = await iniciarServidorMcp({ deps: mundo.deps, emissor });
    abertos.push(servidor);
    const token = servidor.emitirToken({ workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_p", role: "piloto", mode: "agentico" });
    expect((await rodarCli(servidor, token, "listar")).ok).toBe(true);
    // AUD-13: o ÚLTIMO caractere da assinatura base64url só carrega 4 bits úteis (2 de preenchimento): trocá-lo às vezes
    // decodifica para os mesmos bytes. Altera um caractere do MEIO, que sempre muda a assinatura.
    const [corpoToken, assinaturaToken = ""] = token.split(".");
    const meio = Math.floor(assinaturaToken.length / 2);
    const adulterado = `${corpoToken}.${assinaturaToken.slice(0, meio)}${assinaturaToken[meio] === "A" ? "B" : "A"}${assinaturaToken.slice(meio + 1)}`;
    expect((await rodarCli(servidor, adulterado, "listar")).erro?.code).toBe("unauthorized");
    const outro = criarEmissorDeTokens().emitir({ workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_p", role: "piloto", mode: "agentico" });
    expect((await rodarCli(servidor, outro, "listar")).erro?.code).toBe("unauthorized");
    agora += 6000;
    expect((await rodarCli(servidor, token, "listar")).erro?.code).toBe("unauthorized");
  }, 30_000);

  it("tool fora da lista do token nem aparece em tools/list", async () => {
    const a = await montar({ lancarWorkers: false });
    const worker = await rodarCli(a.servidor, a.tokenDe("w_x", "executor"), "listar");
    expect(worker.resultado).toEqual(["handoff_submit"]);
    const piloto = await rodarCli(a.servidor, a.tokenPiloto(), "listar");
    expect(piloto.resultado).toContain("mission_complete");
    const livre = await montar({ modo: "livre", lancarWorkers: false });
    const l = (await rodarCli(livre.servidor, livre.tokenPiloto(), "listar")).resultado as string[];
    expect(l).toContain("pane_spawn");
    expect(l).not.toContain("mission_complete");
    expect(l).not.toContain("catalog_list");
  }, 30_000);

  it("Host não-loopback recusado (DNS rebinding)", async () => {
    const a = await montar({ lancarWorkers: false });
    const corpo = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const status = await new Promise<number>((ok, erro) => {
      const r = request(
        { host: "127.0.0.1", port: a.servidor.porta, path: "/mcp", method: "POST", headers: { host: "atacante.example.com", authorization: `Bearer ${a.tokenPiloto()}`, "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": Buffer.byteLength(corpo) } },
        (res) => { res.resume(); ok(res.statusCode ?? 0); },
      );
      r.on("error", erro);
      r.end(corpo);
    });
    expect(status).toBe(403);
  });

  it("identidade vem do token: pane_spawn e handoff ignoram mission_id/pane_id/role de argumento", async () => {
    const a = await montar({ lancarWorkers: false });
    const r = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude", mission_id: "mis_OUTRA", pane_id: "pane_fake", role_do_token: "x" }));
    expect(r.ok).toBe(true);
    expect(a.mundo.spawns[0]).toMatchObject({ mission_id: "mis_1", pedido_por_pane_id: "pane_p" });
  }, 30_000);

  it("handoff_submit sem relatório → handoff_missing, sem banco e sem wake", async () => {
    const a = await montar({ lancarWorkers: false });
    const w = a.mundo.adicionarPane({ pane_id: "w_y", papel: "executor", task_id: "tsk_9" });
    const r = await rodarCli(a.servidor, a.tokenDe(w.pane_id, "executor"), "chamar", "handoff_submit", JSON.stringify({ task_id: "tsk_9", summary: "pronto", report_path: "nao/existe.md", status: "ok" }));
    expect(r.erro).toMatchObject({ code: "rule_violation", subcode: "handoff_missing" });
    const longo = await rodarCli(a.servidor, a.tokenDe(w.pane_id, "executor"), "chamar", "handoff_submit", JSON.stringify({ task_id: "tsk_9", summary: "x".repeat(401), report_path: "a.md", status: "ok" }));
    expect(longo.erro).toMatchObject({ code: "invalid_argument", subcode: "summary_too_long" });
    await a.fila.ociosa();
    expect(a.gravacoes).toHaveLength(0);
    expect(a.wakes).toHaveLength(0);
  }, 30_000);
});

describe("integração: stop hook (script real → servidor real)", () => {
  async function gancho(a: Ambiente, pane_id: string, evento: string, corpo: unknown): Promise<string> {
    const { saida } = await executar([GANCHO, evento, VARIAVEL_URL_GANCHOS, VARIAVEL_TOKEN], { [VARIAVEL_URL_GANCHOS]: a.servidor.urlGanchos, [VARIAVEL_TOKEN]: a.tokenDe(pane_id, "executor") }, JSON.stringify(corpo));
    return saida.trim();
  }

  it("barra o encerramento sem handoff, libera após 3 e marca failed (piloto é acordado)", async () => {
    const a = await montar({ lancarWorkers: false });
    const s = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude" }));
    const pane_id = (s.resultado as { pane_id: string }).pane_id;
    for (let i = 0; i < 3; i++) {
      const saida = JSON.parse(await gancho(a, pane_id, "stop-handoff", { hook_event_name: "Stop" })) as { decision: string; reason: string };
      expect(saida.decision).toBe("block");
      expect(saida.reason).toContain("handoff_submit");
    }
    expect(a.gravacoes).toHaveLength(0);
    expect(await gancho(a, pane_id, "stop-handoff", { hook_event_name: "Stop" })).toBe(""); // 4ª: libera
    await a.fila.ociosa();
    expect(a.gravacoes).toHaveLength(1);
    expect(a.gravacoes[0]?.status).toBe("falhou");
    expect(a.wakes[0]?.texto).toContain("falhou");
  }, 30_000);

  it("com o handoff feito o stop hook libera na hora", async () => {
    const a = await montar({ atrasoWorkerMs: 0 });
    const s = await rodarCli(a.servidor, a.tokenPiloto(), "chamar", "pane_spawn", JSON.stringify({ provider: "claude" }));
    await a.workers[0];
    const pane_id = (s.resultado as { pane_id: string }).pane_id;
    expect(await gancho(a, pane_id, "stop-handoff", { hook_event_name: "Stop" })).toBe("");
    expect(await gancho(a, pane_id, "stop-relatorio", { hook_event_name: "Stop" })).toBe("");
  }, 30_000);

  it("sem token o script libera (falha aberta) e o guarda do piloto falha fechado", async () => {
    const a = await montar({ lancarWorkers: false });
    const aberto = await executar([GANCHO, "stop-handoff", "NAO_EXISTE_URL", "NAO_EXISTE_TOKEN"], {}, "{}");
    expect(aberto.codigo).toBe(0);
    const fechado = await executar([GANCHO, "pre-tool-use", "NAO_EXISTE_URL", "NAO_EXISTE_TOKEN"], {}, "{}");
    expect(fechado.codigo).toBe(2);
    expect(a.servidor.porta).toBeGreaterThan(0);
  }, 30_000);
});
