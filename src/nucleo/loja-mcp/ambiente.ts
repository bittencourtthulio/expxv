// Ambiente de um servidor MCP da Loja por allowlist (Fase 7B, T-07B.08): o servidor NUNCA herda o ambiente
// do app nem o da CLI. Entram só (1) as variáveis básicas do sistema que existem, (2) um PATH mínimo,
// (3) um HOME isolado opcional e (4) as variáveis que o catálogo declara — secretas só vindas do cofre.
// Variáveis reservadas (chaves de provedor, injeção de código, ambiente do produto) nunca entram,
// nem quando "declaradas". Lógica pura.

import { win32 } from "node:path";
import { PRODUTO } from "../produto";
import type { VariavelMcp } from "./esquema";

/** Variáveis do sistema repassadas quando existem na origem. */
export const VARIAVEIS_BASE_POSIX: readonly string[] = ["LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ", "USER", "LOGNAME"];
export const VARIAVEIS_BASE_WINDOWS: readonly string[] = ["SystemRoot", "SystemDrive", "ComSpec", "PATHEXT", "TEMP", "TMP", "windir", "LANG", "TZ"];

/** Nomes (e prefixos) que um servidor não recebe nem declarando: segredos de provedor e vetores de injeção. */
const RESERVADAS_EXATAS = new Set([
  "PATH", "HOME", "USERPROFILE", "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "ELECTRON_RUN_AS_NODE",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH", "PYTHONSTARTUP", "PYTHONHOME", "BASH_ENV", "ENV", "IFS",
  "NPM_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
]);
const RESERVADOS_PREFIXOS: readonly string[] = [
  "ANTHROPIC_", "OPENAI_", "CODEX_", "CLAUDE", "OPENCODE_", "DYLD_", "LD_", "ELECTRON_", "NPM_CONFIG_", "NODE_", PRODUTO.prefixoEnv,
];

export function variavelReservada(nome: string): boolean {
  const n = nome.toUpperCase();
  return RESERVADAS_EXATAS.has(n) || RESERVADOS_PREFIXOS.some((p) => n.startsWith(p));
}

export interface OpcoesAmbienteMcp {
  /** Origem das variáveis (padrão: o ambiente do processo). Só as básicas e as declaradas não secretas são lidas dela. */
  origem?: NodeJS.ProcessEnv;
  /** Variáveis declaradas pelo catálogo. */
  declaradas?: readonly VariavelMcp[];
  /** Valores informados pela pessoa (cofre), por nome. Só nomes declarados entram. */
  valores?: Readonly<Record<string, string>>;
  /** HOME isolado (pasta própria do servidor). Sem ele, HOME/USERPROFILE não são repassados. */
  homeIsolado?: string;
  /** Pastas extras no PATH (ex.: dirname do Node). */
  pathExtra?: readonly string[];
  plataforma?: NodeJS.Platform;
}

export interface AmbienteMcp {
  /** Variáveis do processo filho (o único conjunto que o servidor enxerga). */
  variaveis: Record<string, string>;
  /** Nomes repassados (nunca valores), em ordem alfabética: é o que o consentimento mostra. */
  nomes: string[];
  /** Declaradas recusadas por serem reservadas ou inválidas (aviso ao curador). */
  recusadas: string[];
}

export function pathMinimo(plataforma: NodeJS.Platform, origem: NodeJS.ProcessEnv, extra: readonly string[] = []): string {
  if (plataforma === "win32") {
    const raiz = origem["SystemRoot"] ?? "C:\\Windows";
    return [...extra, win32.join(raiz, "System32"), raiz].join(";");
  }
  return [...extra, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
}

const RE_NOME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const valorValido = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && !v.includes("\0");

/** Monta o ambiente por allowlist. Nunca devolve variável fora da lista, ainda que presente na origem. */
export function montarAmbienteServidor(opcoes: OpcoesAmbienteMcp = {}): AmbienteMcp {
  const origem = opcoes.origem ?? process.env;
  const plataforma = opcoes.plataforma ?? process.platform;
  const saida: Record<string, string> = {};
  const recusadas: string[] = [];

  for (const nome of plataforma === "win32" ? VARIAVEIS_BASE_WINDOWS : VARIAVEIS_BASE_POSIX) {
    const v = origem[nome];
    if (valorValido(v)) saida[nome] = v;
  }
  const path = pathMinimo(plataforma, origem, opcoes.pathExtra);
  saida["PATH"] = path;
  if (plataforma === "win32") saida["Path"] = path;
  if (opcoes.homeIsolado) {
    saida["HOME"] = opcoes.homeIsolado;
    if (plataforma === "win32") saida["USERPROFILE"] = opcoes.homeIsolado;
  }

  for (const decl of opcoes.declaradas ?? []) {
    const nome = decl.nome;
    if (!RE_NOME.test(nome) || variavelReservada(nome)) { recusadas.push(nome); continue; }
    const doCofre = opcoes.valores?.[nome];
    if (valorValido(doCofre)) { saida[nome] = doCofre; continue; }
    // Só variável NÃO secreta pode vir da origem (ex.: AWS_PROFILE, KUBECONFIG); segredo só do cofre.
    if (!decl.secreta) { const v = origem[nome]; if (valorValido(v)) saida[nome] = v; }
  }
  return { variaveis: saida, nomes: Object.keys(saida).sort(), recusadas };
}
