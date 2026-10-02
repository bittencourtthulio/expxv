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

// ---- herança de outros apps (Orca) ----
/**
 * Quem abre o app a partir de um terminal do Orca (`npm run dev`) herda o ambiente dele: variáveis `ORCA_*` (hooks, tokens de
 * "agent teams"), `CODEX_HOME` apontando para a pasta de contas do Orca e pastas `.orca`/`Orca.app` no PATH, onde mora o atalho que
 * intercepta o `claude`. Herdado, o Codex/Claude abertos aqui usariam a conta e os hooks do Orca. Isto tira só o que o Orca injeta;
 * a configuração da pessoa (ex.: um `CODEX_HOME` próprio) fica.
 */
const PASTA_DO_ORCA = /[\\/](\.orca|Orca\.app)([\\/]|$)/i;
const CONTAS_DO_ORCA = /[\\/]orca[\\/]codex-accounts[\\/]/i;

export function limparHerancaDoOrca(origem: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const saida: NodeJS.ProcessEnv = {};
  for (const [nome, valor] of Object.entries(origem)) {
    if (valor === undefined || /^ORCA_/i.test(nome)) continue;
    if (nome === "CODEX_HOME" && (valor === origem["ORCA_CODEX_HOME"] || CONTAS_DO_ORCA.test(valor) || PASTA_DO_ORCA.test(valor))) continue;
    if (nome === "PATH" || nome === "Path") {
      saida[nome] = valor.split(delimiter).filter((p) => p !== "" && !PASTA_DO_ORCA.test(p)).join(delimiter);
      continue;
    }
    saida[nome] = valor;
  }
  return saida;
}

/** Aplica `limparHerancaDoOrca` ao ambiente do próprio processo (chamado no começo do main: daemon, detector e contas passam a ver o ambiente limpo). */
export function limparHerancaDoOrcaNoProcesso(ambiente: NodeJS.ProcessEnv = process.env): void {
  const limpo = limparHerancaDoOrca(ambiente);
  for (const nome of Object.keys(ambiente)) if (!(nome in limpo)) delete ambiente[nome];
  for (const [nome, valor] of Object.entries(limpo)) if (ambiente[nome] !== valor) ambiente[nome] = valor;
}

// ---- cofre (Fase 9, T-09.22): ponto de montagem das variáveis dos Panes ----
/** Superfície mínima do cofre que este módulo usa (o `Cofre` real satisfaz; o main injeta, aqui nada importa o cofre). */
export interface CofreDoAmbiente {
  ambienteDoPane(workspace_id: string | null, injetar: boolean): Promise<Record<string, string>>;
}

/**
 * Variáveis do cofre para um Pane: SÓ entradas NÃO sensíveis e SÓ se o workspace habilitou `injetar_cofre_no_env` (padrão não).
 * Entrada sensível NUNCA vira variável: o cofre já não a devolve e `removerSegredosDoAmbiente` é o cinto e suspensório.
 * Sem `injetar`, o cofre nem é consultado.
 */
export async function ambienteDoCofre(cofre: CofreDoAmbiente, o: { workspace_id: string | null; injetar: boolean }): Promise<Record<string, string>> {
  if (!o.injetar) return {};
  return cofre.ambienteDoPane(o.workspace_id, true);
}

/** Tira do conjunto toda variável cujo valor o scrubber do cofre reconhece (valor do cofre vazado de fora). Pura; nunca lança. */
export function removerSegredosDoAmbiente(vars: Record<string, string>, scrub: (texto: string) => string): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(vars)) {
    let limpo = true;
    try {
      limpo = scrub(valor) === valor;
    } catch {
      limpo = true; // o scrubber nunca derruba o lançamento
    }
    if (limpo) saida[nome] = valor;
  }
  return saida;
}

let scrubDoAmbiente: ((texto: string) => string) | null = null;
/**
 * O main liga o `scrubSincrono` do cofre aqui (e desliga com `null`): a partir daí `ambienteSeguro` tira do filho toda variável
 * herdada que contenha um valor do cofre. Sem cofre aberto não há o que remover (o scrubber só conhece valores carregados).
 */
export function definirScrubDoAmbiente(scrub: ((texto: string) => string) | null): void {
  scrubDoAmbiente = scrub;
}

export interface OpcoesAmbiente {
  /** Ambiente de origem (padrão: o do processo). */
  origem?: NodeJS.ProcessEnv;
  /** Scrubber do cofre (padrão: o ligado por `definirScrubDoAmbiente`; `null` = nenhum). */
  scrub?: ((texto: string) => string) | null;
  inicio?: string;
  plataforma?: NodeJS.Platform;
}

export function ambienteSeguro(executavel: Pick<ExecutavelPty, "caminho">, opcoes: OpcoesAmbiente = {}): Record<string, string> {
  const origem = opcoes.origem ?? process.env;
  const inicio = opcoes.inicio ?? homedir();
  const plataforma = opcoes.plataforma ?? process.platform;
  const barra = plataforma === "win32" ? "\\" : "/";
  const scrub = opcoes.scrub === undefined ? scrubDoAmbiente : opcoes.scrub;
  const filtrado = Object.fromEntries(
    Object.entries(limparHerancaDoOrca(origem)).filter((par): par is [string, string] =>
      typeof par[1] === "string" && !VARIAVEIS_DE_IDENTIDADE.includes(par[0])),
  );
  const ambiente = scrub === null ? filtrado : removerSegredosDoAmbiente(filtrado, scrub);
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
