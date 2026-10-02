// Hook UserPromptSubmit do Maestro (painel livre do Claude Code). Lê o JSON do hook no stdin, posta ao loopback do app (`<URL>/maestro-prompt`)
// e imprime a resposta (`{"decision":"block","reason":...}`) só quando o Maestro encaminhou o pedido. Uso: node maestro-prompt.mjs <VARIAVEL_URL> <VARIAVEL_TOKEN>
// URL e token chegam por variáveis de ambiente (nunca em argv). FALHA ABERTA: qualquer erro, recusa ou estouro dos 400 ms ⇒ saída vazia, código 0 e o prompt segue.
import http from "node:http";

const [nomeUrl, nomeToken] = process.argv.slice(2);
const TETO_MS = 400;
const sair = () => process.exit(0);

function lerEntrada() {
  return new Promise((resolver) => {
    const pedacos = [];
    process.stdin.on("data", (p) => pedacos.push(p));
    process.stdin.on("end", () => resolver(Buffer.concat(pedacos).toString("utf8")));
    process.stdin.on("error", () => resolver(""));
    if (process.stdin.isTTY) resolver("");
  });
}

function enviar(url, token, corpo, sinal) {
  return new Promise((resolver, rejeitar) => {
    const requisicao = http.request(
      url,
      { method: "POST", signal: sinal, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(corpo), authorization: `Bearer ${token}` } },
      (resposta) => {
        const pedacos = [];
        resposta.on("data", (p) => pedacos.push(p));
        resposta.on("end", () => resolver({ status: resposta.statusCode ?? 0, texto: Buffer.concat(pedacos).toString("utf8") }));
        resposta.on("error", rejeitar);
      },
    );
    requisicao.on("error", rejeitar);
    requisicao.end(corpo);
  });
}

const base = process.env[nomeUrl ?? ""];
const token = process.env[nomeToken ?? ""];
if (!base || !token) sair();

// teto duro independente da rede (o hook do Claude também tem o `timeout` do settings)
const relogio = setTimeout(sair, TETO_MS + 100);
relogio.unref?.();
try {
  const entrada = (await lerEntrada()).trim();
  const resposta = await enviar(`${base.replace(/\/+$/, "")}/maestro-prompt`, token, entrada === "" ? "{}" : entrada, AbortSignal.timeout(TETO_MS));
  if (resposta.status === 200) {
    const saida = resposta.texto.trim();
    let obj = null;
    try {
      obj = JSON.parse(saida);
    } catch {
      /* resposta inválida: segue */
    }
    // só o bloqueio do Maestro é impresso; qualquer outra coisa é ignorada (o prompt segue)
    if (obj && obj.decision === "block" && typeof obj.reason === "string") process.stdout.write(`${JSON.stringify({ decision: "block", reason: obj.reason })}\n`);
  }
} catch {
  /* falha aberta */
}
sair();
