// Statusline do Claude por Pane (T-09.06). Roda DENTRO do Pane, como `statusLine.command`.
// Lê o JSON da CLI no stdin e grava SÓ `{v:1, recebido_em, rate_limits, model}` no arquivo apontado pela variável de
// ambiente cujo NOME vem em argv[2] (0600, atômico). Imprime uma linha curta (`5h 62% · 7d 31%`).
// Sem rede; não lê arquivo algum além do stdin; nunca quebra a CLI (sai sempre com 0); sem `rate_limits` não grava nada.
import { mkdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

const MAX_STDIN = 1024 * 1024;
const MAX_SAIDA = 8 * 1024;

function lerStdin() {
  return new Promise((resolver) => {
    const pedacos = [];
    let total = 0;
    process.stdin.on("data", (c) => {
      total += c.length;
      if (total <= MAX_STDIN) pedacos.push(c);
    });
    process.stdin.on("end", () => resolver(total <= MAX_STDIN ? Buffer.concat(pedacos).toString("utf8") : ""));
    process.stdin.on("error", () => resolver(""));
  });
}

const ehObjeto = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const pct = (j) => {
  const v = ehObjeto(j) ? (j.used_percentage ?? j.used_percent ?? j.utilization) : undefined;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? `${Math.round(v)}%` : null;
};

function linhaCurta(rl) {
  const partes = [];
  const cinco = pct(rl.five_hour);
  const sete = pct(rl.seven_day);
  if (cinco !== null) partes.push(`5h ${cinco}`);
  if (sete !== null) partes.push(`7d ${sete}`);
  return partes.join(" · ");
}

async function principal() {
  let saida = "";
  try {
    const bruto = await lerStdin();
    const entrada = JSON.parse(bruto);
    if (!ehObjeto(entrada) || !ehObjeto(entrada.rate_limits)) return;
    const rl = entrada.rate_limits;
    saida = linhaCurta(rl);
    const caminho = process.env[process.argv[2] ?? ""];
    if (typeof caminho !== "string" || caminho === "" || !isAbsolute(caminho)) return;
    const modelo = ehObjeto(entrada.model) ? { id: typeof entrada.model.id === "string" ? entrada.model.id.slice(0, 80) : null, display_name: typeof entrada.model.display_name === "string" ? entrada.model.display_name.slice(0, 80) : null } : null;
    const texto = JSON.stringify({ v: 1, recebido_em: new Date().toISOString(), rate_limits: rl, model: modelo });
    if (texto.length > MAX_SAIDA) return; // formato inesperado: não grava lixo
    mkdirSync(dirname(caminho), { recursive: true, mode: 0o700 });
    const tmp = `${caminho}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`; // dois Panes da mesma conta não se pisam
    try {
      writeFileSync(tmp, texto, { mode: 0o600 });
      renameSync(tmp, caminho);
    } catch {
      try { rmSync(tmp, { force: true }); } catch { /* nada a fazer */ }
    }
  } catch {
    /* a statusline nunca quebra a CLI */
  } finally {
    process.stdout.write(`${saida}\n`);
  }
}

await principal();
process.exit(0);
