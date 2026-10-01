// Ambiente do processo filho: sem a identidade de uma sessão do Claude Code que tenha aberto o app
// e com o PATH completado (apps GUI do macOS/Windows não herdam o PATH do shell de login).

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { ExecutavelPty } from "./lancamento";

/**
 * Identidade de uma sessão do Claude Code que tenha aberto o app (ex.: `npm run dev` num terminal do
 * Claude). Herdada, faz a CLI filha se achar sessão-filha e não gravar transcript. Só a identidade
 * sai; a configuração da pessoa (ex.: CLAUDE_CODE_USE_BEDROCK) fica. `ELECTRON_RUN_AS_NODE` também
 * sai: o daemon nasce com ele e a CLI filha não pode herdá-lo.
 */
export const VARIAVEIS_DE_IDENTIDADE: readonly string[] = [
  "CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_EXECPATH", "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_PID", "ELECTRON_RUN_AS_NODE",
];

export interface OpcoesAmbiente {
  /** Ambiente de origem (padrão: o do processo). */
  origem?: NodeJS.ProcessEnv;
  inicio?: string;
  plataforma?: NodeJS.Platform;
}

export function ambienteSeguro(executavel: Pick<ExecutavelPty, "caminho">, opcoes: OpcoesAmbiente = {}): Record<string, string> {
  const origem = opcoes.origem ?? process.env;
  const inicio = opcoes.inicio ?? homedir();
  const plataforma = opcoes.plataforma ?? process.platform;
  const barra = plataforma === "win32" ? "\\" : "/";
  const ambiente = Object.fromEntries(
    Object.entries(origem).filter((par): par is [string, string] =>
      typeof par[1] === "string" && !VARIAVEIS_DE_IDENTIDADE.includes(par[0])),
  );
  const pastas = [
    (ambiente["PATH"] ?? ambiente["Path"] ?? "").split(delimiter),
    [dirname(executavel.caminho), join(inicio, ".local", "bin"), join(inicio, ".volta", "bin"), join(inicio, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"],
  ].flat();
  const raizNvm = join(inicio, ".nvm", "versions", "node");
  try { for (const versao of readdirSync(raizNvm)) pastas.push(join(raizNvm, versao, "bin")); } catch { /* NVM opcional */ }
  const marcador = `${barra}versions${barra}node${barra}`;
  const indice = executavel.caminho.indexOf(marcador);
  if (indice >= 0) {
    const versao = executavel.caminho.slice(indice + marcador.length).split(/[\\/]/)[0];
    if (versao) pastas.unshift(join(executavel.caminho.slice(0, indice), "versions", "node", versao, "bin"));
  }
  ambiente["PATH"] = [...new Set(pastas.filter(Boolean))].join(delimiter);
  if (plataforma === "win32") ambiente["Path"] = ambiente["PATH"];
  return ambiente;
}

/** Junta dois ambientes; `OPENCODE_CONFIG_CONTENT` (JSON) dos dois é somado, não sobrescrito. */
export function combinarAmbiente(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  const saida = { ...a, ...b };
  const chave = "OPENCODE_CONFIG_CONTENT";
  const ca = a[chave];
  const cb = b[chave];
  if (ca !== undefined && cb !== undefined) {
    try { saida[chave] = JSON.stringify({ ...JSON.parse(ca), ...JSON.parse(cb) }); } catch { saida[chave] = cb; }
  }
  return saida;
}
