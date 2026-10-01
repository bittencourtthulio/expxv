// Gancho (hook) por Pane do Claude Code. Repassa o JSON do hook ao app por HTTP loopback e imprime
// a resposta. Uso: node gancho.mjs <evento> <VARIAVEL_URL> <VARIAVEL_TOKEN>
// A URL dos ganchos e o token do Pane chegam por variáveis de ambiente (nunca em argv).
// Falha de rede libera (saída 0), exceto no guarda de escrita do piloto (pre-tool-use), que falha fechado.
import http from "node:http";

const [evento, nomeUrl, nomeToken] = process.argv.slice(2);
const FALHA_FECHADA = evento === "pre-tool-use";

function encerrar(codigo, erro) {
  if (erro) process.stderr.write(`${erro}\n`);
  process.exit(codigo);
}

function lerEntrada() {
  return new Promise((resolver) => {
    const pedacos = [];
    process.stdin.on("data", (p) => pedacos.push(p));
    process.stdin.on("end", () => resolver(Buffer.concat(pedacos).toString("utf8")));
    process.stdin.on("error", () => resolver(""));
    if (process.stdin.isTTY) resolver("");
  });
}

function enviar(url, token, corpo) {
  return new Promise((resolver, rejeitar) => {
    const requisicao = http.request(
      url,
      { method: "POST", timeout: 8000, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(corpo), authorization: `Bearer ${token}` } },
      (resposta) => {
        const pedacos = [];
        resposta.on("data", (p) => pedacos.push(p));
        resposta.on("end", () => resolver({ status: resposta.statusCode ?? 0, texto: Buffer.concat(pedacos).toString("utf8") }));
      },
    );
    requisicao.on("timeout", () => requisicao.destroy(new Error("tempo esgotado")));
    requisicao.on("error", rejeitar);
    requisicao.end(corpo);
  });
}

const base = process.env[nomeUrl ?? ""];
const token = process.env[nomeToken ?? ""];
if (!evento || !base || !token) {
  encerrar(FALHA_FECHADA ? 2 : 0, FALHA_FECHADA ? "Gancho sem configuração: escrita bloqueada." : undefined);
}

try {
  const entrada = await lerEntrada();
  const resposta = await enviar(`${base.replace(/\/+$/, "")}/${evento}`, token, entrada.trim() === "" ? "{}" : entrada);
  if (resposta.status !== 200) encerrar(FALHA_FECHADA ? 2 : 0, FALHA_FECHADA ? "Gancho recusado: escrita bloqueada." : undefined);
  const saida = resposta.texto.trim();
  if (saida !== "" && saida !== "{}" && saida !== "null") process.stdout.write(`${saida}\n`);
  encerrar(0);
} catch {
  encerrar(FALHA_FECHADA ? 2 : 0, FALHA_FECHADA ? "App indisponível: escrita bloqueada." : undefined);
}
