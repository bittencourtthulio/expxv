// CLI FALSA de forge (gh/glab) para testes: responde o que o cenário manda, grava o argv e NUNCA fala com a rede.
import { appendFileSync, readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let stdin = "";
try {
  stdin = readFileSync(0, "utf8");
} catch {
  /* sem stdin */
}
const log = process.env.FORGE_FAKE_LOG;
if (log) appendFileSync(log, JSON.stringify({ nome: process.env.FORGE_FAKE_NOME, argv, stdin, promptOff: process.env.GH_PROMPT_DISABLED === "1", semCor: process.env.NO_COLOR === "1" }) + "\n");
const cenario = process.env.FORGE_FAKE_CENARIO ? JSON.parse(readFileSync(process.env.FORGE_FAKE_CENARIO, "utf8")) : { regras: [] };
const linha = argv.join(" ");
const escrever = (texto) => {
  const b = Buffer.from(texto);
  let off = 0;
  while (off < b.length) {
    try {
      off += writeSync(1, b, off, b.length - off);
    } catch (e) {
      if (e.code !== "EAGAIN") throw e;
    }
  }
};
for (const r of cenario.regras) {
  const bate = r.quando ? r.quando.every((p, i) => argv[i] === p) : r.regex ? new RegExp(r.regex).test(linha) : true;
  if (!bate) continue;
  if (r.stdinContem && !stdin.includes(r.stdinContem)) continue;
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.bytes) {
    const bloco = Buffer.alloc(1024 * 1024, "linha de log do passo 1234567890abcdefghijklmnopqrstuvwxyz\n");
    let falta = r.bytes;
    while (falta > 0) {
      const n = Math.min(falta, bloco.length);
      let off = 0;
      while (off < n) {
        try {
          off += writeSync(1, bloco, off, n - off);
        } catch (e) {
          if (e.code !== "EAGAIN") throw e;
        }
      }
      falta -= n;
    }
  } else if (r.arquivo) escrever(readFileSync(join(aqui, r.arquivo), "utf8"));
  else if (r.saida !== undefined) escrever(typeof r.saida === "string" ? r.saida : JSON.stringify(r.saida));
  process.exitCode = r.codigo ?? 0;
  process.exit(r.codigo ?? 0);
}
process.stderr.write(`fake: sem regra para: ${linha}\n`);
process.exit(99);
