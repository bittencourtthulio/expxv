import { spawn } from "node:child_process";

/**
 * Sobe o daemon como processo independente: sem stdio e desligado do pai (`detached` + `unref`), então
 * continua vivo quando o app fecha. Roda o mesmo executável do app em modo Node (ELECTRON_RUN_AS_NODE),
 * com o node-pty já compatível com ele.
 */
export function lancarDaemon(op: {
  executavel: string;
  script: string;
  dir: string;
  socket: string;
  ocioso_ms?: number;
  ambiente?: NodeJS.ProcessEnv;
}): void {
  const argumentos = [op.script, "--dir", op.dir, "--socket", op.socket, ...(op.ocioso_ms === undefined ? [] : ["--ocioso-ms", String(op.ocioso_ms)])];
  const filho = spawn(op.executavel, argumentos, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...(op.ambiente ?? process.env), ELECTRON_RUN_AS_NODE: "1" },
  });
  filho.on("error", () => { /* o cliente percebe pela falta de resposta e cai na reserva */ });
  filho.unref();
}
