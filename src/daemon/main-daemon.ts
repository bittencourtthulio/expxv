// Entrada do processo do daemon de PTY: `main-daemon.js --dir <pasta> --socket <caminho> [--ocioso-ms n]`.
// Roda como Node puro (ELECTRON_RUN_AS_NODE), desligado do app.

import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AdaptadorNodePty } from "../nucleo/terminais/adaptador-node-pty";
import { iniciarServidor } from "./servidor";

function argumento(nome: string): string {
  const i = process.argv.indexOf(nome);
  const valor = i >= 0 ? process.argv[i + 1] : undefined;
  if (valor === undefined) throw new Error(`falta ${nome}`);
  return valor;
}

const dir = argumento("--dir");
const socket = argumento("--socket");
const ociosoMs = process.argv.includes("--ocioso-ms") ? Number(argumento("--ocioso-ms")) : undefined;
const registrar = (texto: string): void => {
  try { appendFileSync(join(dir, "daemon.log"), `${new Date().toISOString()} ${texto}\n`); } catch { /* sem log, sem problema */ }
};

// erro num pedido não pode derrubar o daemon: dentro dele estão as sessões dos outros
process.on("uncaughtException", (e) => registrar(`uncaughtException: ${e.stack ?? e.message}`));
process.on("unhandledRejection", (e) => registrar(`unhandledRejection: ${String(e)}`));
process.on("SIGHUP", () => undefined);

iniciarServidor({
  dir,
  socket,
  token: readFileSync(join(dir, "token"), "utf8").trim(),
  adaptador: new AdaptadorNodePty(),
  ...(ociosoMs === undefined ? {} : { ociosoMs }),
  aoEncerrar: () => process.exit(0),
}).catch((e: NodeJS.ErrnoException) => {
  // outro daemon ganhou a corrida pelo mesmo socket: este é redundante
  registrar(`não subiu: ${e.code ?? ""} ${e.message}`);
  process.exit(e.code === "EADDRINUSE" ? 0 : 1);
});
