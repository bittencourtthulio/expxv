// Execução de binários do SO para o medidor: caminho ABSOLUTO, argumentos fixos e SEPARADOS (nunca shell), ambiente mínimo
// (sem nenhuma variável do usuário: nada de segredo chega ao filho), timeout curto e saída limitada.
import { execFile } from "node:child_process";

export type Executar = (binario: string, argumentos: readonly string[], timeoutMs: number) => Promise<string>;

export function ambienteMinimo(plataforma: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (plataforma === "win32") {
    return { SystemRoot: env["SystemRoot"] ?? "C:\\Windows", PATH: env["SystemRoot"] === undefined ? "C:\\Windows\\System32" : `${env["SystemRoot"]}\\System32` };
  }
  return { LC_ALL: "C", LANG: "C", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
}

export const executarReal: Executar = (binario, argumentos, timeoutMs) =>
  new Promise<string>((resolver, rejeitar) => {
    execFile(binario, [...argumentos], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: "utf8", env: ambienteMinimo() }, (erro, saida) => {
      if (erro !== null) rejeitar(new Error("falha ao consultar o sistema"));
      else resolver(saida);
    });
  });
