// Servidor falso que (mal) escreve o valor de FALSO_API_KEY no stderr: o log do app tem de redigir.
import { iniciarServidor } from "./_base.mjs";
process.stderr.write(`iniciando com chave=${process.env.FALSO_API_KEY ?? "(vazia)"}\n`);
await iniciarServidor({ nome: "falso-segredo-no-stderr" });
