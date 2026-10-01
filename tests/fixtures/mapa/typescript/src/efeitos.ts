// @ts-nocheck
import cron from "node-cron";
import { ipcMain } from "electron";

export function iniciar(): void {
  ipcMain.handle("app:versao", versao);
  ipcMain.on("app:fechar", () => {});
  cron.schedule("*/5 * * * *", limpar);
  const porta = process.env.PORTA;
  const host = process.env["HOST"];
  console.log(porta, host);
}

function versao(): string {
  return "1";
}
