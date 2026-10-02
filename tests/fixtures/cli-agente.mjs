// CLI falsa de AGENTE DE SQUAD (Fase 14, T-14.28). Estende `tests/fixtures/mcp/cli-orq.mjs` (que fala MCP por HTTP, roda os hooks e
// segue a diretiva `E2E:{json}` do pedido/briefing) com a prova do que o app ENTREGOU a cada Pane: argv completo, variáveis de
// ambiente (valores de chave/token/senha redigidos), cwd e o conteúdo de todo arquivo de texto citado no argv ou no ambiente
// (instruções do agente, `--settings`, `--mcp-config`). Um JSON por Pane em `CLI_AGENTE_DIR/<pane>.json`.
//   CLI_AGENTE_DIR   pasta onde gravar (obrigatória; sem ela só delega)
// O comportamento de MCP/handoff é o de cli-orq.mjs: aqui não se reinventa nada.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const dir = process.env.CLI_AGENTE_DIR;
const SEGREDO = /(KEY|TOKEN|SECRET|PASSWORD|SENHA|CREDENTIAL)/i;

function lerSeTexto(caminho) {
  try {
    const abs = isAbsolute(caminho) ? caminho : resolve(process.cwd(), caminho);
    const st = statSync(abs);
    if (!st.isFile() || st.size > 256 * 1024) return null;
    const t = readFileSync(abs, "utf8");
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u0008\u000e-\u001f]/.test(t) ? null : t;
  } catch {
    return null;
  }
}

if (dir && !argv.includes("--version")) {
  try {
    const mcp = argv[argv.indexOf("--mcp-config") + 1];
    const pane = mcp ? basename(dirname(mcp)) : `sem-pane-${process.pid}`;
    const candidatos = new Set([...argv, ...Object.values(process.env)].filter((v) => typeof v === "string" && v.length < 400 && !v.includes("\n") && (v.startsWith("/") || v.startsWith("./") || v.startsWith(".expxv"))));
    const arquivos = {};
    for (const c of candidatos) {
      const t = lerSeTexto(c);
      if (t !== null) arquivos[c] = t;
    }
    const ambiente = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("npm_")).map(([k, v]) => [k, SEGREDO.test(k) ? "[omitido]" : v]));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${pane}.json`), JSON.stringify({ pane, t: Date.now(), cwd: process.cwd(), argv, ambiente, arquivos }, null, 2));
  } catch {
    // o registro nunca derruba a CLI falsa
  }
}

await import(join(dirname(fileURLToPath(import.meta.url)), "mcp", "cli-orq.mjs"));
