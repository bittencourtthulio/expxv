// Roda DENTRO do app empacotado (ELECTRON_RUN_AS_NODE=1). Prova que o servidor MCP empacotado sobe numa
// worker thread fora do asar, lista as tools do papel com um token de teste, recusa token adulterado,
// que o gancho.mjs empacotado fala com ele e que o worker de indexação carrega com a dependência `yaml`.
// Uso: <executavel> pacote-orquestracao.cjs <pasta Resources>
const { execFile } = require("node:child_process");
const { mkdtempSync, existsSync, readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Worker } = require("node:worker_threads");

const recursos = process.argv[2];
const asar = join(recursos, "app.asar");
const fora = join(recursos, "app.asar.unpacked");
const falhar = (m) => { console.error(JSON.stringify({ ok: false, erro: m })); process.exit(1); };

(async () => {
  for (const c of ["dist/main/mcp-worker.js", "dist/nucleo/orquestracao/hooks/scripts/gancho.mjs", "dist/nucleo/orquestracao/prompts/piloto.md", "dist/nucleo/metodo/worker.js", "node_modules/yaml/package.json", "node_modules/@modelcontextprotocol/sdk/package.json", "node_modules/zod/package.json"]) {
    if (!existsSync(join(fora, c))) falhar(`fora do asar faltando: ${c}`);
  }
  const prompts = readdirSync(join(fora, "dist/nucleo/orquestracao/prompts")).sort();
  if (prompts.join() !== "intake.md,piloto.md,revisor.md,worker.md") falhar(`prompts inesperados: ${prompts.join()}`);

  const { iniciarServidorRemoto } = require(join(asar, "dist/main/mcp-remoto.js"));
  const { Client } = require(join(asar, "node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js"));
  const { StreamableHTTPClientTransport } = require(join(asar, "node_modules/@modelcontextprotocol/sdk/dist/cjs/client/streamableHttp.js"));
  const chamadas = [];
  const deps = {
    panes: { spawn: async () => ({ pane_id: "pane_x" }), listar: async () => [], obter: async () => null, ler: async () => null, enviar: async () => true, fechar: async () => true },
    missoes: { obter: async () => null, listar: async () => [], concluir: async () => undefined },
    provedores: { listar: async () => [{ provedor: "claude", cli: "claude", contas: [], habilitado: true }], modelos: async () => [] },
    handoff: { registrar: async () => ({ handoff_id: "hof_x" }), doPane: async () => null, temRevisorOk: async () => false },
    raiz: async () => tmpdir(),
    maxPanesParalelos: 8,
    avisar: (m) => chamadas.push(m),
  };
  const ganchos = { tratar: async (evento) => ({ saida: { recebido: evento } }) };
  const t0 = Date.now();
  const servidor = await iniciarServidorRemoto({ caminhoWorker: join(fora, "dist/main/mcp-worker.js"), deps, ganchos });
  const subiuEmMs = Date.now() - t0;
  const token = servidor.emitirToken({ workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_p", role: "piloto", mode: "agentico" });
  const conectar = async (t) => {
    const c = new Client({ name: "pacote", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(servidor.url), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
    return c;
  };
  const cliente = await conectar(token);
  const tools = (await cliente.listTools()).tools.map((t) => t.name);
  if (!tools.includes("pane_spawn") || !tools.includes("handoff_submit")) falhar(`tools inesperadas: ${tools.join()}`);
  const r = await cliente.callTool({ name: "provider_list", arguments: {} });
  const provedores = JSON.parse(r.content[0].text);
  if (provedores[0]?.provider !== "claude") falhar("provider_list via RPC falhou");
  await cliente.close();
  let recusou = false;
  try { await conectar(`${token}x`); } catch { recusou = true; }
  if (!recusou) falhar("token adulterado foi aceito");

  // gancho.mjs empacotado, com o executável do app como Node (como o Claude Code o chamaria)
  // (assíncrono de propósito: as portas do servidor respondem NESTA thread; um spawnSync a travaria)
  const saida = await new Promise((ok, erro) => {
    const filho = execFile(process.execPath, [join(fora, "dist/nucleo/orquestracao/hooks/scripts/gancho.mjs"), "session-start", "URL_GANCHOS", "TOKEN_MCP"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", URL_GANCHOS: servidor.urlGanchos, TOKEN_MCP: token },
      encoding: "utf8", timeout: 15000,
    }, (e, stdout) => (e ? erro(e) : ok(stdout)));
    filho.stdin.end("{}");
  });
  if (JSON.parse(saida).recebido !== "session-start") falhar(`gancho devolveu: ${saida}`);
  await servidor.fechar();

  // worker de indexação do método (carrega `yaml` de node_modules desempacotado)
  const indexacao = await new Promise((ok, erro) => {
    const w = new Worker(join(fora, "dist/nucleo/metodo/worker.js"));
    const t = setTimeout(() => erro(new Error("worker do método não respondeu")), 15000);
    w.on("error", erro);
    w.on("message", (m) => { clearTimeout(t); w.terminate(); ok(m); });
    w.postMessage({ id: 1, tipo: "indexar", raiz: mkdtempSync(join(tmpdir(), "pacote-idx-")) });
  });
  if (indexacao.ok !== true) falhar(`indexação falhou: ${JSON.stringify(indexacao)}`);
  console.log(JSON.stringify({ ok: true, tools: tools.length, subiuEmMs }));
  process.exit(0);
})().catch((e) => falhar(String(e && e.stack || e)));
