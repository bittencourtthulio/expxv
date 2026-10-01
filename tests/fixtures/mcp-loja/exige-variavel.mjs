// Servidor falso que pede variável de ambiente: sem FALSO_API_KEY sai com 2 e uma mensagem só com o NOME;
// com valor diferente de "chave-valida" responde 401 em tools/list (sem repetir o valor).
import { iniciarServidor } from "./_base.mjs";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
const chave = process.env.FALSO_API_KEY;
if (!chave) {
  process.stderr.write("variavel de ambiente obrigatoria ausente: FALSO_API_KEY\n");
  process.exit(2);
}
await iniciarServidor({
  nome: "falso-exige-variavel",
  aoListar: () => { if (chave !== "chave-valida") throw new McpError(-32001, "401 Unauthorized: chave invalida"); },
  chamar: () => "autenticado",
});
