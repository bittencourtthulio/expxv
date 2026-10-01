// CLI falsa de ORQUESTRAÇÃO para o e2e no Electron real (piloto e worker). Faz o que o Claude Code faz com o
// que o app entrega: lê `--mcp-config` (URL + credencial do Pane), executa os hooks de `--settings` como
// comandos de shell (SessionStart, PreToolUse, PostToolUse, Stop), fala MCP por HTTP e lê o que é digitado
// no terminal. O cenário vem do TEXTO que o app entrega (prompt do piloto = pedido da Missão; prompt do
// worker aponta o briefing): uma linha `E2E:{json}`. Cada passo vai como uma linha JSON para CLI_ORQ_LOG.
//
// Diretiva do piloto: { esperar?: arquivo, chamadas?: [{tool,args,briefing?:{caminho,texto},ate_ok?:bool}], esperar_wake?: bool,
//                       adulterar?: bool, guarda?: [caminhos] }
//   `ate_ok`: repete a chamada (a cada 250 ms, até 60 s) enquanto falhar, registrando cada tentativa.
// Diretiva do worker (no briefing): { worker: "handoff"|"sem-handoff"|"ocioso", resumo?, status?, tentar_spawn?, esperar?: arquivo }
//   `esperar`: o worker só entrega o handoff depois que o arquivo (relativo ao cwd) existir.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  process.stdout.write("1.0.0-falsa\n");
  process.exit(0);
}

const valorDe = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const mcpArquivo = valorDe("--mcp-config");
const settingsArquivo = valorDe("--settings");
const prompt = argv[argv.length - 1] ?? "";
const ehWorker = prompt.startsWith("Execute o card");
const paneId = mcpArquivo ? basename(dirname(mcpArquivo)) : "sem-pane";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("uncaughtException", (e) => {
  try { appendFileSync(process.env.CLI_ORQ_LOG ?? "/dev/null", JSON.stringify({ t: Date.now(), quem: ehWorker ? "worker" : "piloto", pane: paneId, evento: "erro", mensagem: String(e?.stack ?? e) }) + "\n"); } catch {}
  process.exit(1);
});

function log(evento, extra = {}) {
  const arquivo = process.env.CLI_ORQ_LOG;
  if (!arquivo) return;
  appendFileSync(arquivo, `${JSON.stringify({ t: Date.now(), quem: ehWorker ? "worker" : "piloto", pane: paneId, evento, ...extra })}\n`);
}

// ---- entrada do terminal (o wake chega aqui, digitado pelo app)
const linhas = [];
const esperandoLinha = [];
createInterface({ input: process.stdin, terminal: false }).on("line", (l) => {
  linhas.push(l);
  log("entrada", { texto: l });
  for (const f of esperandoLinha.splice(0)) f();
});
async function esperarLinha(pred, limiteMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const achada = linhas.find(pred);
    if (achada !== undefined) return achada;
    if (Date.now() - t0 > limiteMs) return null;
    await new Promise((r) => {
      esperandoLinha.push(r);
      setTimeout(r, 100);
    });
  }
}

// ---- MCP mínimo por HTTP (initialize + tools/*), com a credencial do arquivo de config
log("boot");
const cfg = mcpArquivo ? JSON.parse(readFileSync(mcpArquivo, "utf8")) : null;
const servidorCfg = cfg ? Object.values(cfg.mcpServers)[0] : null;
const URL_MCP = servidorCfg?.url;
const CREDENCIAL = (servidorCfg?.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
let idRpc = 0;
async function rpc(metodo, params, credencial = CREDENCIAL) {
  const r = await fetch(URL_MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + credencial, "mcp-protocol-version": "2025-03-26" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++idRpc, method: metodo, params }),
  });
  if (r.status === 401) return { status: 401 };
  const texto = await r.text();
  const corpo = texto.trim().startsWith("{") ? JSON.parse(texto) : JSON.parse(/data: (.*)/.exec(texto)?.[1] ?? "{}");
  return { status: r.status, corpo };
}
async function iniciarMcp() {
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cli-orq", version: "1" } });
  const tools = await rpc("tools/list", {});
  return (tools.corpo?.result?.tools ?? []).map((t) => t.name);
}
async function chamar(nome, args) {
  const r = await rpc("tools/call", { name: nome, arguments: args });
  const conteudo = r.corpo?.result?.content?.[0]?.text;
  const dados = conteudo === undefined ? null : JSON.parse(conteudo);
  return r.corpo?.result?.isError ? { ok: false, erro: dados } : { ok: true, resultado: dados };
}

// ---- hooks do settings do Pane, como o Claude Code os roda (comando de shell, JSON no stdin)
function gruposDe(evento) {
  try {
    return JSON.parse(readFileSync(settingsArquivo, "utf8")).hooks?.[evento] ?? [];
  } catch {
    return [];
  }
}
function executarComando(comando, entrada) {
  return new Promise((ok) => {
    const f = spawn("sh", ["-c", comando], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    f.stdout.on("data", (d) => (out += d));
    f.stderr.on("data", (d) => (err += d));
    f.on("close", (codigo) => ok({ codigo, stdout: out, stderr: err }));
    f.stdin.end(entrada);
  });
}
async function rodarGanchos(evento, entrada, ferramenta = "") {
  const saidas = [];
  for (const grupo of gruposDe(evento)) {
    if (grupo.matcher && !new RegExp("^(" + grupo.matcher + ")$").test(ferramenta)) continue;
    for (const h of grupo.hooks ?? []) if (h.type === "command") saidas.push(await executarComando(h.command, JSON.stringify(entrada)));
  }
  return saidas;
}
const json = (texto) => {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};

async function esperarArquivo(nome, limiteMs = 30_000) {
  const t0 = Date.now();
  while (!existsSync(join(process.cwd(), nome))) {
    if (Date.now() - t0 > limiteMs) return false;
    await espera(30);
  }
  return true;
}

function gravar(caminho, texto) {
  const abs = join(process.cwd(), caminho);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, texto, "utf8");
}

async function tentarEncerrar() {
  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    const saidas = await rodarGanchos("Stop", { hook_event_name: "Stop", stop_hook_active: tentativa > 1 });
    const bloqueado = saidas.some((s) => json(s.stdout)?.decision === "block");
    log("stop", { tentativa, bloqueado });
    if (!bloqueado) {
      log("saiu");
      process.exit(0);
    }
    await espera(150);
  }
  log("preso");
}

async function piloto() {
  const diretiva = json(/E2E:(\{[^\n]*\})/.exec(prompt)?.[1] ?? "null") ?? {};
  log("inicio", { diretiva });
  const sessao = await rodarGanchos("SessionStart", { hook_event_name: "SessionStart" });
  log("session_start", { contexto: json(sessao[0]?.stdout ?? "")?.hookSpecificOutput?.additionalContext?.length ?? 0 });
  if (diretiva.esperar) await esperarArquivo(diretiva.esperar);
  const tools = await iniciarMcp();
  log("tools", { tools });
  if (diretiva.adulterar) {
    const r = await rpc("tools/list", {}, CREDENCIAL + "x");
    log("adulterado", { status: r.status });
  }
  for (const guarda of diretiva.guarda ?? []) {
    const saidas = await rodarGanchos("PreToolUse", { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(process.cwd(), guarda) }, cwd: process.cwd() }, "Write");
    const d = json(saidas[0]?.stdout ?? "")?.hookSpecificOutput;
    log("guarda", { caminho: guarda, decisao: d?.permissionDecision ?? "allow", codigo: saidas[0]?.codigo });
  }
  for (const c of diretiva.chamadas ?? []) {
    if (c.briefing) gravar(c.briefing.caminho, "# Card\n\n" + c.briefing.texto + "\n");
    for (let tentativa = 1; ; tentativa++) {
      const t0 = Date.now();
      const r = await chamar(c.tool, c.args ?? {});
      log("chamada", { tool: c.tool, t0, t1: Date.now(), tentativa, ...r });
      if (!c.ate_ok || r.ok || Date.now() - t0 > 60_000 || tentativa >= 240) break;
      await espera(250);
    }
  }
  if (diretiva.esperar_wake) {
    const l = await esperarLinha((x) => x.includes("[wake]"));
    log("wake", { texto: l });
    const r = await chamar("pane_list", {});
    log("livre", { ...r });
  }
  await new Promise(() => setInterval(() => undefined, 1 << 30));
}

async function worker() {
  const briefing = /Briefing: ([^\s]+?)\.(?:\s|$)/.exec(prompt)?.[1];
  const textoBriefing = briefing ? readFileSync(join(process.cwd(), briefing), "utf8") : "";
  const diretiva = json(/E2E:(\{[^\n]*\})/.exec(textoBriefing)?.[1] ?? "null") ?? { worker: "ocioso" };
  const taskId = /task_id: ([^)\s]+)/.exec(prompt)?.[1];
  log("inicio", { diretiva, task_id: taskId });
  const sessao = await rodarGanchos("SessionStart", { hook_event_name: "SessionStart" });
  const contexto = json(sessao[0]?.stdout ?? "")?.hookSpecificOutput?.additionalContext ?? "";
  log("session_start", { contexto: contexto.length, tem_briefing: contexto.includes("## Briefing do card") });
  const tools = await iniciarMcp();
  log("tools", { tools });
  if (diretiva.tentar_spawn) {
    const r = await chamar("pane_spawn", { provider: "claude" });
    log("spawn_do_worker", { ...r });
  }
  if (diretiva.esperar) await esperarArquivo(diretiva.esperar, 180_000);
  if (diretiva.worker === "handoff") {
    const relatorio = ".expxv/relatorios/" + taskId + ".md";
    gravar(relatorio, "# Relatório\n\nResultado: " + (diretiva.resumo ?? "ok") + "\n");
    const t0 = Date.now();
    const r = await chamar("handoff_submit", { task_id: taskId, summary: diretiva.resumo ?? "ok", report_path: relatorio, status: diretiva.status ?? "ok" });
    log("handoff", { t0, t1: Date.now(), ...r });
    // o matcher do PostToolUse do settings é o nome da tool como a CLI a enxerga (mcp__<servidor>__handoff_submit)
    const nomeDaTool = gruposDe("PostToolUse")[0]?.matcher ?? "";
    await rodarGanchos("PostToolUse", { hook_event_name: "PostToolUse", tool_name: nomeDaTool }, nomeDaTool);
    await tentarEncerrar();
  } else if (diretiva.worker === "sem-handoff") {
    await tentarEncerrar();
  }
  await new Promise(() => setInterval(() => undefined, 1 << 30));
}

process.on("SIGTERM", () => {
  log("sigterm");
  process.exit(0);
});
(ehWorker ? worker() : piloto()).catch((e) => {
  log("erro", { mensagem: String(e?.stack ?? e) });
  process.exit(1);
});
