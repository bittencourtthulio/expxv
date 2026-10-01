import { createInterface } from "node:readline";

process.on("SIGINT", () => {
  process.stdout.write("interrompido\n");
  process.exit(0);
});
const entrada = createInterface({ input: process.stdin, terminal: false });
process.stdout.write("\u001b[36mpty> \u001b[0m");
entrada.on("line", (linha) => {
  if (linha === "tamanho") {
    process.stdout.write(`tamanho:${process.stdout.columns}x${process.stdout.rows}\n`);
    return;
  }
  process.stdout.write(`eco:${linha}\n`);
});

