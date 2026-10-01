// CLI falsa que fala MCP de verdade. Lê a URL e o token do AMBIENTE e executa um cenário pedido por argumento.
//   CLI_MCP_URL, CLI_MCP_TOKEN   (obrigatórios)
//   CLI_MCP_RAIZ                 (cenário "worker": onde gravar o relatório)
//   CLI_MCP_ATRASO_MS            (cenário "worker": trabalho simulado antes do handoff)
//
// Cenários:
//   listar                                   -> imprime os nomes das tools de tools/list
//   chamar <tool> '<json dos argumentos>'    -> chama a tool; imprime { ok, resultado } ou { ok:false, erro }
//   worker <task_id> <relatorio_rel> <status> <resumo>
//                                            -> (atraso) grava o relatório e chama handoff_submit
//   sem-handoff                              -> conecta, lista e sai sem entregar (worker que "esquece")
// Saída: UMA linha JSON no stdout.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [cenario, ...resto] = process.argv.slice(2);
const url = process.env.CLI_MCP_URL;
const token = process.env.CLI_MCP_TOKEN;
if (!url || !token) {
  process.stdout.write(`${JSON.stringify({ ok: false, erro: { code: "unauthorized", message: "sem URL ou token no ambiente" } })}\n`);
  process.exit(3);
}

const cliente = new Client({ name: "cli-mcp-falsa", version: "1.0.0" });
const transporte = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });

function imprimir(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function chamar(nome, args) {
  const r = await cliente.callTool({ name: nome, arguments: args });
  const texto = r.content?.[0]?.text ?? "null";
  const dados = JSON.parse(texto);
  return r.isError ? { ok: false, erro: dados } : { ok: true, resultado: dados };
}

try {
  await cliente.connect(transporte);
  if (cenario === "listar") {
    const { tools } = await cliente.listTools();
    imprimir({ ok: true, resultado: tools.map((t) => t.name) });
  } else if (cenario === "chamar") {
    imprimir(await chamar(resto[0], JSON.parse(resto[1] ?? "{}")));
  } else if (cenario === "worker") {
    const [taskId, relatorioRel, status, resumo] = resto;
    await new Promise((ok) => setTimeout(ok, Number(process.env.CLI_MCP_ATRASO_MS ?? 0)));
    const caminho = join(process.env.CLI_MCP_RAIZ ?? ".", relatorioRel);
    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, `# Relatório\n\nResultado: ${resumo}\n`, "utf8");
    imprimir(await chamar("handoff_submit", { task_id: taskId, summary: resumo, report_path: relatorioRel, status }));
  } else if (cenario === "sem-handoff") {
    const { tools } = await cliente.listTools();
    imprimir({ ok: true, resultado: tools.map((t) => t.name) });
  } else {
    imprimir({ ok: false, erro: { code: "invalid_argument", message: `cenário desconhecido: ${cenario}` } });
  }
  await cliente.close().catch(() => undefined);
  process.exit(0);
} catch (e) {
  const nao = e?.code === 401 || e?.name === "UnauthorizedError" || /\b401\b/.test(String(e?.message));
  imprimir({ ok: false, erro: { code: nao ? "unauthorized" : "transport", message: String(e?.message ?? e) } });
  process.exit(2);
}
