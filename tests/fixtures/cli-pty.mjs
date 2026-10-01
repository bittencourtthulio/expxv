// CLI falsa para os testes de PTY real. Comandos (uma linha cada):
//   <texto>          -> eco:<texto>
//   tamanho          -> tamanho:<colunas>x<linhas>
//   flood <bytes>    -> imprime texto em massa (linhas de 79 caracteres) e termina com flood-fim
//   sair [codigo]    -> termina com o código
// Ctrl+C (SIGINT) imprime "interrompido" e termina com 0.
import { createInterface } from "node:readline";

process.on("SIGINT", () => {
  process.stdout.write("interrompido\n");
  process.exit(0);
});

async function flood(total) {
  const linha = `${"x".repeat(78)}\n`;
  let restante = total;
  while (restante > 0) {
    const pedaco = linha.repeat(Math.min(Math.ceil(restante / linha.length), 512)).slice(0, restante);
    restante -= pedaco.length;
    if (!process.stdout.write(pedaco)) await new Promise((r) => process.stdout.once("drain", r));
  }
  process.stdout.write("\nflood-fim\n");
}

const entrada = createInterface({ input: process.stdin, terminal: false });
process.stdout.write("\u001b[36mpty> \u001b[0m");
entrada.on("line", (linha) => {
  const [comando, argumento] = linha.trim().split(/\s+/);
  if (comando === "tamanho") {
    process.stdout.write(`tamanho:${process.stdout.columns}x${process.stdout.rows}\n`);
  } else if (comando === "flood") {
    void flood(Number(argumento) || 0);
  } else if (comando === "sair") {
    process.exit(Number(argumento) || 0);
  } else {
    process.stdout.write(`eco:${linha}\n`);
  }
});
