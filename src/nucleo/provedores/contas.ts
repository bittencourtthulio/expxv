// Contas de provedor (T-02.04): rótulo + config dir ISOLADO por conta, guardado como REFERÊNCIA relativa
// à pasta de dados (`contas/<id>`), nunca segredo. O login é da própria CLI: a pasta só dá a cada conta
// o seu CLAUDE_CONFIG_DIR / CODEX_HOME. A pasta nasce com modo 0700.
import { chmodSync, mkdirSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { Banco } from "../banco";
import type { Repositorios } from "../banco/repos";
import { DuplicadoErro, ValorInvalidoErro, type Conta } from "../dominio";
import { CATALOGO_TERMINAIS } from "../terminais/catalogo";

const PROVEDORES: readonly string[] = CATALOGO_TERMINAIS.filter((f) => f.id !== "terminal").map((f) => f.id);
/** Variável de ambiente que aponta a CLI para o config dir da conta. */
const VARIAVEL_CONFIG: Readonly<Record<string, string>> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" };
const ROTULO_MAX = 60;

export interface DependenciasContas {
  banco: Banco;
  repos: Pick<Repositorios, "conta">;
  /** pasta de dados do app (userData). */
  pastaDeDados: string;
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
}

function rotuloValido(rotulo: unknown): string {
  if (typeof rotulo !== "string") throw new ValorInvalidoErro("rotulo", rotulo);
  const limpo = rotulo.trim();
  // eslint-disable-next-line no-control-regex
  if (limpo === "" || [...limpo].length > ROTULO_MAX || /[\u0000-\u001f\u007f]/.test(limpo)) throw new ValorInvalidoErro("rotulo", rotulo);
  return limpo;
}

export function criarServicoContas(deps: DependenciasContas): ServicoContas {
  const { banco, repos } = deps;
  const repo = repos.conta;

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

    ambienteDaConta(conta) {
      const variavel = VARIAVEL_CONFIG[conta.provedor];
      const dir = configDirAbsoluto(conta);
      return variavel !== undefined && dir !== null ? { [variavel]: dir } : {};
    },
  };
}
