#!/usr/bin/env node
// `git` falso para testar cancelar/silêncio: cria a pasta de destino (último argumento), imprime progresso e fica dormindo.
//   FALSO_LENTO_MODO: progresso (imprime e dorme) | mudo (dorme sem imprimir) | erro (imprime a mensagem de FALSO_LENTO_ERRO e sai 128) | rajada (200 linhas de progresso e sai 0)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const destino = args[args.length - 1];
const modo = process.env.FALSO_LENTO_MODO ?? "progresso";
if (modo === "erro") {
  process.stderr.write(`${process.env.FALSO_LENTO_ERRO ?? "fatal: erro"}\n`);
  process.exit(128);
}
mkdirSync(destino, { recursive: true });
writeFileSync(join(destino, "parcial.txt"), "metade do clone");
if (modo === "progresso") {
  process.stderr.write("Cloning into 'x'...\n");
  process.stderr.write("Receiving objects:  45% (555/1234), 1.20 MiB | 2.40 MiB/s\r");
}
if (modo === "rajada") {
  for (let i = 1; i <= 200; i++) process.stderr.write(`Receiving objects: ${Math.min(100, Math.floor(i / 2))}% (${i}/200), ${i} KiB | 1.00 MiB/s\r`);
  process.exit(0);
}
setInterval(() => undefined, 1000);
