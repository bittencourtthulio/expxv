// Hook UserPromptSubmit do RAG (Fase 15, DEC-4 camada c). Lê o JSON do hook no stdin, posta ao loopback do app (`<URL>/rag-contexto`) com o token do Pane e
// imprime `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":...}}` só quando o app devolveu o envelope de conhecimento prévio.
// Uso: node rag-contexto.mjs <VARIAVEL_URL> <VARIAVEL_TOKEN>. URL e token chegam por variáveis de ambiente (nunca em argv).
// FALHA ABERTA: qualquer erro, recusa, resposta inesperada ou estouro dos 400 ms ⇒ saída vazia, código 0 e o prompt segue sem contexto.
// Defesa em profundidade: só passa texto que COMEÇA com `<conhecimento_previo` e tem um único par de tags; nunca imprime `decision`.
import http from "node:http";

const [nomeUrl, nomeToken] = process.argv.slice(2);
const TETO_MS = 400;
const MAX_SAIDA = 12_000;
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
        let total = 0;
        resposta.on("data", (p) => {
          total += p.length;
          if (total > 64 * 1024) resposta.destroy(new Error("resposta grande demais"));
          else pedacos.push(p);
        });
        resposta.on("end", () => resolver({ status: resposta.statusCode ?? 0, texto: Buffer.concat(pedacos).toString("utf8") }));
        resposta.on("error", rejeitar);
      },
    );
    requisicao.on("error", rejeitar);
    requisicao.end(corpo);
  });
}

function contextoValido(texto) {
  if (typeof texto !== "string" || texto.length === 0 || texto.length > MAX_SAIDA) return false;
  if (!texto.startsWith("<conhecimento_previo")) return false;
  return texto.split("</conhecimento_previo>").length === 2 && texto.split("<conhecimento_previo").length === 2;
}

const base = process.env[nomeUrl ?? ""];
const token = process.env[nomeToken ?? ""];
if (!base || !token) sair();

// teto duro independente da rede (o hook do Claude também tem o `timeout` do settings)
const relogio = setTimeout(sair, TETO_MS + 100);
relogio.unref?.();
try {
  const entrada = (await lerEntrada()).trim();
  const resposta = await enviar(`${base.replace(/\/+$/, "")}/rag-contexto`, token, entrada === "" ? "{}" : entrada, AbortSignal.timeout(TETO_MS));
  if (resposta.status === 200) {
    let obj = null;
    try {
      obj = JSON.parse(resposta.texto.trim());
    } catch {
      /* resposta inválida: segue */
    }
    const contexto = obj?.hookSpecificOutput?.additionalContext;
    if (contextoValido(contexto)) {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: contexto } })}\n`);
    }
  }
} catch {
  /* falha aberta */
}
sair();
