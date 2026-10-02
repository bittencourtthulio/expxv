import { delimiter, isAbsolute } from "node:path";

// Ambiente do processo filho por ALLOWLIST (nunca herdado). Sem token do app, sem MCP do app, sem chave, sem SSH_AUTH_SOCK. `HOME` e o diretório de config vêm da conta DEDICADA do Bench.
// Mesmo o que está na allowlist é recusado se o NOME parecer segredo ou se o VALOR contiver um valor conhecido pelo scrubber do cofre.

const PERMITIDAS: readonly string[] = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "COMSPEC", "PATHEXT"];
const PADRAO_SEGREDO = /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|_KEY$|^KEY$|AUTH|SESSION|COOKIE|SSH_|GPG|AWS_|AZURE_|GCP_|GOOGLE_APPLICATION)/i;
/** Nomes que a CLI do alvo precisa para achar a config da CONTA dedicada (valor = pasta dessa conta). */
const CONFIG_DA_CLI: readonly string[] = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"];

export interface EntradaAmbiente {
  /** ambiente do processo pai (só lido, nunca copiado por inteiro). */
  pai: Readonly<Record<string, string | undefined>>;
  /** HOME da conta dedicada. */
  home: string;
  /** variáveis de config da CLI apontando para a pasta da conta dedicada (ex.: `CLAUDE_CONFIG_DIR`). */
  configCli?: Readonly<Record<string, string>>;
  /** scrubber do cofre: valor mudado ⇒ continha segredo conhecido ⇒ descartado. */
  scrub?: (texto: string) => string;
  /** só para teste: variáveis fixas extras (ex.: registro da CLI falsa). Passam pelo mesmo filtro de nome. */
  extra?: Readonly<Record<string, string>>;
}

/**
 * PATH só com entradas ABSOLUTAS: uma entrada vazia ou relativa (`.`, `bin`) resolveria executável a partir do `cwd` (o workdir descartável), onde o código gerado pela IA poderia plantar
 * um `claude`, `node` ou `git` falso e rodá-lo fora do esperado (achado A-04 da AUDITORIA-BENCH).
 */
export function sanearPath(valor: string): string {
  return valor.split(delimiter).filter((p) => p !== "" && isAbsolute(p) && !p.includes("\0")).join(delimiter);
}

export function nomeSensivel(nome: string): boolean {
  return PADRAO_SEGREDO.test(nome);
}

export function montarAmbiente(e: EntradaAmbiente): Record<string, string> {
  const saida: Record<string, string> = {};
  const limpo = (v: string): boolean => {
    if (e.scrub === undefined) return true;
    try { return e.scrub(v) === v; } catch { return true; }
  };
  for (const nome of PERMITIDAS) {
    const v = e.pai[nome];
    if (typeof v === "string" && v !== "" && !nomeSensivel(nome) && limpo(v)) {
      const final = nome === "PATH" ? sanearPath(v) : v;
      if (final !== "") saida[nome] = final;
    }
  }
  saida["HOME"] = e.home;
  saida["USERPROFILE"] = e.home;
  for (const [nome, v] of Object.entries(e.configCli ?? {})) {
    if (CONFIG_DA_CLI.includes(nome) && typeof v === "string" && v !== "") saida[nome] = v;
  }
  for (const [nome, v] of Object.entries(e.extra ?? {})) {
    if (!nomeSensivel(nome) && limpo(v)) saida[nome] = v;
  }
  return saida;
}
