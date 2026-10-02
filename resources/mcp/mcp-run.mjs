// Lançador `mcp-run` dos servidores MCP stdio da Loja que usam variável secreta (Fase 7B, D-132).
// A CLI do Pane executa só: <node> mcp-run.mjs --servidor <id>. Este script (sem dependências) busca por loopback o comando
// EXATO e o ambiente por allowlist do servidor (POST /loja/segredos, Bearer = token do Pane) e dá `spawn` nele com stdio herdado.
// O segredo vive só no processo do servidor real: nunca no argv do Pane, em arquivo ou no ambiente do Pane/Bash do agente.
// A URL e o token de loopback chegam por variáveis de ambiente do Pane (nomes terminados em _LOJA_URL e _LOJA_TOKEN) e NÃO são
// repassados ao filho (ele recebe somente o ambiente devolvido pelo app). Falha: mensagem clara no stderr e código 70.
import http from "node:http";
import { spawn } from "node:child_process";

const FALHA = 70;
const LIMITE_RESPOSTA = 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function falhar(mensagem) {
  process.stderr.write(`mcp-run: ${mensagem}\n`);
  process.exit(FALHA);
}

const argv = process.argv.slice(2);
const i = argv.indexOf("--servidor");
const servidor = i >= 0 ? argv[i + 1] : undefined;
if (typeof servidor !== "string" || !ID.test(servidor)) falhar("argumento --servidor ausente ou inválido");

const chaves = Object.keys(process.env);
const chaveUrl = chaves.find((k) => /_LOJA_URL$/.test(k));
const chaveToken = chaves.find((k) => /_LOJA_TOKEN$/.test(k));
const urlBruta = chaveUrl ? process.env[chaveUrl] : undefined;
const token = chaveToken ? process.env[chaveToken] : undefined;
if (!urlBruta || !token) falhar("o Pane não tem o endereço ou o token da Loja de MCPs (reabra o Pane)");

let url;
try {
  url = new URL(urlBruta);
} catch {
  falhar("endereço da Loja inválido");
}
if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) falhar("endereço da Loja recusado: só loopback");

function buscar() {
  return new Promise((resolver, rejeitar) => {
    const corpo = JSON.stringify({ servidor });
    const req = http.request(
      url,
      { method: "POST", timeout: 5000, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(corpo), authorization: `Bearer ${token}` } },
      (res) => {
        const pedacos = [];
        let total = 0;
        res.on("data", (p) => {
          total += p.length;
          if (total > LIMITE_RESPOSTA) { req.destroy(new Error("resposta grande demais")); return; }
          pedacos.push(p);
        });
        res.on("end", () => resolver({ status: res.statusCode ?? 0, texto: Buffer.concat(pedacos).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("tempo esgotado")));
    req.on("error", rejeitar);
    req.end(corpo);
  });
}

const ehTexto = (v) => typeof v === "string";
function comandoValido(c) {
  return (
    c !== null && typeof c === "object" && ehTexto(c.executavel) && c.executavel !== "" &&
    Array.isArray(c.args) && c.args.every(ehTexto) &&
    c.env !== null && typeof c.env === "object" && !Array.isArray(c.env) && Object.values(c.env).every(ehTexto) &&
    (c.cwd === null || ehTexto(c.cwd))
  );
}

let resposta;
try {
  resposta = await buscar();
} catch {
  falhar("o app não respondeu (está aberto?)");
}
if (resposta.status !== 200) {
  let motivo = "";
  try { const j = JSON.parse(resposta.texto); motivo = typeof j.erro === "string" ? j.erro : typeof j.code === "string" ? j.code : ""; } catch { /* sem corpo útil */ }
  falhar(`o app recusou o servidor ${servidor} (HTTP ${resposta.status}${motivo ? `: ${motivo}` : ""})`);
}
let comando;
try {
  comando = JSON.parse(resposta.texto).comando;
} catch {
  falhar("resposta inválida do app");
}
if (!comandoValido(comando)) falhar("resposta do app sem comando válido");

const filho = spawn(comando.executavel, comando.args, {
  env: comando.env,
  ...(comando.cwd ? { cwd: comando.cwd } : {}),
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});
filho.once("error", () => falhar(`não consegui iniciar o servidor ${servidor}`));
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => { try { filho.kill(sinal); } catch { /* já saiu */ } });
}
filho.once("exit", (codigo, sinal) => {
  if (codigo !== null) process.exit(codigo);
  process.exit(sinal === "SIGINT" ? 130 : sinal === "SIGTERM" ? 143 : 1);
});
