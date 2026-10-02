// Contas de provedor (T-02.04): rótulo + config dir ISOLADO por conta, guardado como REFERÊNCIA relativa
// à pasta de dados (`contas/<id>`), nunca segredo. O login é da própria CLI: a pasta só dá a cada conta
// o seu CLAUDE_CONFIG_DIR / CODEX_HOME. A pasta nasce com modo 0700.
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { Banco } from "../banco";
import type { Repositorios } from "../banco/repos";
import { DuplicadoErro, ValorInvalidoErro, type Conta } from "../dominio";
import { CATALOGO_TERMINAIS } from "../terminais/catalogo";

const PROVEDORES: readonly string[] = CATALOGO_TERMINAIS.filter((f) => f.id !== "terminal").map((f) => f.id);
/** Variável de ambiente que aponta a CLI para o config dir da conta. */
const VARIAVEL_CONFIG: Readonly<Record<string, string>> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" };
const ROTULO_MAX = 60;

/**
 * Conta padrão (login existente): só para provedores com pasta de config PADRÃO CONFIRMADA e variável que a
 * sobrescreve. A conta usa o ambiente normal da CLI (`config_dir_ref` NULL, sem exportar a variável). O sinal de
 * login é SÓ a existência (stat) de pasta/arquivo: nunca se lê auth.json, credencial, token ou arquivo de ambiente.
 */
interface PadraoDoProvedor {
  variavel: string;
  /** Pasta padrão relativa à casa. */
  pasta: string;
  /** Marcas de login/uso dentro da pasta efetiva (basta uma existir). */
  sinais: readonly string[];
}
const PADRAO: Readonly<Record<string, PadraoDoProvedor>> = {
  claude: { variavel: "CLAUDE_CONFIG_DIR", pasta: ".claude", sinais: [".credentials.json", "history.jsonl", "projects"] },
  codex: { variavel: "CODEX_HOME", pasta: ".codex", sinais: ["auth.json", "sessions"] },
  // Grok: GROK_HOME sobrescreve ~/.grok (docs do Grok, 05-configuration); `auth.json` é o login (só stat, nunca lido); `sessions` não conta: o `grok logout` não o apaga.
  grok: { variavel: "GROK_HOME", pasta: ".grok", sinais: ["auth.json"] },
};
export const ROTULO_CONTA_PADRAO = "Conta padrão";
export const PROVEDORES_COM_PADRAO: readonly string[] = Object.keys(PADRAO);
export type LoginDaConta = "autenticada" | "nao_autenticada" | "nao_aplicavel";

export interface DependenciasContas {
  banco: Banco;
  repos: Pick<Repositorios, "conta">;
  /** pasta de dados do app (userData). */
  pastaDeDados: string;
  /** Casa do usuário (padrão: `os.homedir()`); injetável em teste. */
  casa?: string;
  /** Ambiente do usuário (padrão: `process.env`); só se lê `CODEX_HOME`/`CLAUDE_CONFIG_DIR`. */
  env?: NodeJS.ProcessEnv;
  /** Existência de pasta/arquivo (stat; NUNCA leitura de conteúdo). */
  existe?: (caminho: string) => boolean;
}

export interface ServicoContas {
  criar(provedor: string, rotulo: string): Conta;
  habilitar(contaId: string, habilitada: boolean): Conta | null;
  listar(): Conta[];
  obter(contaId: string): Conta | undefined;
  /** Caminho absoluto do config dir; null se a conta não tem (ou a referência é suspeita). */
  configDirAbsoluto(conta: Pick<Conta, "config_dir_ref">): string | null;
  /** Variáveis de ambiente da conta para a sessão da CLI (só o apontamento do config dir). */
  ambienteDaConta(conta: Pick<Conta, "provedor" | "config_dir_ref">): Record<string, string>;
  /** Pasta de config EFETIVA para leitura de uso (a da conta; a da CLI para a conta padrão). Nunca vai para o ambiente da sessão. */
  configDirEfetivo(conta: Pick<Conta, "provedor" | "config_dir_ref">): string | null;
  /** A conta é a padrão (login existente da CLI)? */
  ehPadrao(conta: Pick<Conta, "provedor" | "config_dir_ref">): boolean;
  /** Há conta padrão cadastrada (habilitada ou não) para o provedor? Uma desabilitada pelo usuário conta como existente. */
  temPadrao(provedor: string): boolean;
  /** Cria a conta padrão do provedor; idempotente (devolve a existente). `null` se o provedor não suporta. */
  criarPadrao(provedor: string): Conta | null;
  /** Só por stat: a CLI tem sinal de login/uso na pasta efetiva? Contas isoladas: `nao_aplicavel`. */
  loginDaConta(conta: Pick<Conta, "provedor" | "config_dir_ref">): LoginDaConta;
}

function rotuloValido(rotulo: unknown): string {
  if (typeof rotulo !== "string") throw new ValorInvalidoErro("rotulo", rotulo);
  const limpo = rotulo.trim();
  // eslint-disable-next-line no-control-regex
  if (limpo === "" || [...limpo].length > ROTULO_MAX || /[\u0000-\u001f\u007f]/.test(limpo)) throw new ValorInvalidoErro("rotulo", rotulo);
  return limpo;
}

function existeStat(caminho: string): boolean {
  try {
    statSync(caminho);
    return true;
  } catch {
    return false;
  }
}

export function criarServicoContas(deps: DependenciasContas): ServicoContas {
  const { banco, repos } = deps;
  const repo = repos.conta;
  const existe = deps.existe ?? existeStat;

  const ehPadrao: ServicoContas["ehPadrao"] = (conta) => conta.config_dir_ref === null && conta.provedor in PADRAO;

  /** Pasta efetiva da CLI: variável do usuário (se absoluta) ou a pasta padrão na casa. */
  const pastaPadrao = (provedor: string): { dir: string; sobrescrita: boolean } | null => {
    const p = PADRAO[provedor];
    if (p === undefined) return null;
    const v = (deps.env ?? process.env)[p.variavel];
    if (typeof v === "string" && v !== "" && isAbsolute(v) && !v.includes("\0")) return { dir: v, sobrescrita: true };
    return { dir: join(deps.casa ?? homedir(), p.pasta), sobrescrita: false };
  };

  const configDirAbsoluto: ServicoContas["configDirAbsoluto"] = (conta) => {
    const ref = conta.config_dir_ref;
    if (ref === null || ref === "" || isAbsolute(ref) || ref.includes("\0")) return null;
    const limpa = normalize(ref);
    if (limpa === ".." || limpa.startsWith(`..${sep}`) || limpa.split(/[\\/]/).includes("..")) return null;
    return join(deps.pastaDeDados, limpa);
  };

  return {
    criar(provedor, rotulo) {
      if (typeof provedor !== "string" || !PROVEDORES.includes(provedor)) throw new ValorInvalidoErro("provedor", provedor);
      const nome = rotuloValido(rotulo);
      const comDir = provedor in VARIAVEL_CONFIG;
      return banco.transacao((tx) => {
        // comparação em JS: o lower() do SQLite só conhece ASCII ("Única" x "única")
        const existentes = tx.consultar<{ rotulo: string }>("SELECT rotulo FROM conta WHERE provedor = ?", [provedor]);
        if (existentes.some((c) => c.rotulo.toLocaleLowerCase() === nome.toLocaleLowerCase())) throw new DuplicadoErro("Conta", `${provedor}/${nome}`);
        const criada = repo.criar({ provedor, rotulo: nome });
        if (!comDir) return criada;
        const ref = `contas/${criada.id}`;
        const abs = join(deps.pastaDeDados, "contas", criada.id);
        mkdirSync(abs, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") chmodSync(abs, 0o700); // o umask pode ter tirado bits
        tx.executar("UPDATE conta SET config_dir_ref = ? WHERE id = ?", [ref, criada.id]);
        return repo.exigir(criada.id);
      });
    },

    habilitar(contaId, habilitada) {
      if (repo.obter(contaId) === undefined) return null;
      return repo.definirHabilitada(contaId, habilitada);
    },

    listar: () => repo.listar({ limite: 500 }).itens,
    obter: (id) => repo.obter(id),
    configDirAbsoluto,

    ehPadrao,

    configDirEfetivo(conta) {
      const isolado = configDirAbsoluto(conta);
      if (isolado !== null) return isolado;
      return ehPadrao(conta) ? (pastaPadrao(conta.provedor)?.dir ?? null) : null;
    },

    temPadrao: (provedor) => repo.listar({ limite: 500 }).itens.some((c) => c.provedor === provedor && ehPadrao(c)),

    criarPadrao(provedor) {
      if (!(provedor in PADRAO)) return null;
      return banco.transacao((tx) => {
        const existente = tx.consultar<{ id: string }>("SELECT id FROM conta WHERE provedor = ? AND config_dir_ref IS NULL ORDER BY criado_em LIMIT 1", [provedor])[0];
        if (existente !== undefined) return repo.exigir(existente.id);
        const rotulos = tx.consultar<{ rotulo: string }>("SELECT rotulo FROM conta WHERE provedor = ?", [provedor]).map((c) => c.rotulo.toLocaleLowerCase());
        let rotulo = ROTULO_CONTA_PADRAO;
        for (let n = 2; rotulos.includes(rotulo.toLocaleLowerCase()); n++) rotulo = `${ROTULO_CONTA_PADRAO} ${n}`;
        return repo.criar({ provedor, rotulo });
      });
    },

    loginDaConta(conta) {
      const p = PADRAO[conta.provedor];
      const pasta = pastaPadrao(conta.provedor);
      if (!ehPadrao(conta) || p === undefined || pasta === null) return "nao_aplicavel";
      if (p.sinais.some((s) => existe(join(pasta.dir, s)))) return "autenticada";
      return "nao_autenticada";
    },

    ambienteDaConta(conta) {
      const variavel = VARIAVEL_CONFIG[conta.provedor];
      const dir = configDirAbsoluto(conta);
      return variavel !== undefined && dir !== null ? { [variavel]: dir } : {};
    },
  };
}
