// "Também instalar na minha CLI" (Fase 7B, T-07B.23): OPÇÃO EXPLÍCITA, nunca automática. Gera a PRÉVIA do
// comando (`claude|codex|gemini mcp add … ev_<id>`), só executa com confirmação DIGITADA (o nome `ev_<id>`),
// sem shell, escopo `user`, e remove apenas o que o app criou (nome com prefixo `ev_` registrado no repositório).
// Segredo NUNCA é copiado: servidor que exige segredo em args é recusado; variável secreta declarada vira
// aviso ("defina no seu ambiente"). OpenCode não tem `mcp add` não interativo: só orientação.

import { montarComando, type ContextoComando } from "./comando";
import type { EntradaMcp } from "./esquema";
import type { Executor } from "./executor";
import { localizarExecutavel } from "./instalar";
import { nomeNaCli, PREFIXO_NOME_CLI } from "./injecao";
import type { CliLoja, RepoLojaMcp } from "./repositorio";

export type CodigoCliUsuario = "cli_sem_suporte" | "exige_segredo_em_args" | "confirmacao_invalida" | "cli_nao_encontrada" | "falha" | "nao_criado_pelo_app" | "comando_invalido";

export interface PreviaCli {
  cli: CliLoja;
  nome_na_cli: string;
  /** argv exato (executável separado dos argumentos). */
  argv: string[];
  /** Texto para a pessoa conferir. */
  texto: string;
  avisos: string[];
}

export type ResultadoPrevia = { ok: true; previa: PreviaCli } | { ok: false; codigo: CodigoCliUsuario; motivo: string };

const citar = (a: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);

export function previaCliUsuario(e: EntradaMcp, cli: CliLoja, ctx: Pick<ContextoComando, "userData" | "workspace" | "plataforma" | "node" | "nodeEhElectron"> & { publicos?: Record<string, string> }): ResultadoPrevia {
  if (cli === "opencode") return { ok: false, codigo: "cli_sem_suporte", motivo: "O OpenCode não tem comando 'mcp add' não interativo: edite a configuração dele à mão (a Loja já injeta por Pane sem isso)." };
  const nome = nomeNaCli(e.id);
  const avisos: string[] = [];
  let c;
  try { c = montarComando(e, { ...ctx, ...(ctx.publicos ? { variaveis: ctx.publicos } : {}), modo: "execucao" }); } catch (x) { return { ok: false, codigo: "comando_invalido", motivo: (x as Error).message }; }
  if (c.args.some((a) => /\{\{SEGREDO:/.test(a))) return { ok: false, codigo: "exige_segredo_em_args", motivo: "Este servidor recebe a chave como argumento: o app não grava segredo na configuração global da sua CLI." };
  for (const v of e.variaveis) if (v.secreta) avisos.push(`Defina ${v.nome} no seu próprio ambiente: o app não grava segredo na sua CLI.`);
  let argv: string[];
  if (c.tipo === "remoto") {
    argv = cli === "claude" ? ["claude", "mcp", "add", "--scope", "user", "--transport", "http", nome, c.url!]
      : cli === "codex" ? ["codex", "mcp", "add", nome, "--url", c.url!]
        : ["gemini", "mcp", "add", "-s", "user", "--transport", "http", nome, c.url!];
  } else {
    const cmd = [c.executavel!, ...c.args];
    argv = cli === "claude" ? ["claude", "mcp", "add", "--scope", "user", "--transport", "stdio", nome, "--", ...cmd]
      : cli === "codex" ? ["codex", "mcp", "add", nome, "--", ...cmd]
        : ["gemini", "mcp", "add", "-s", "user", nome, ...cmd];
    if (Object.keys(c.env_fixas).length > 0) avisos.push("Este servidor precisa de variáveis fixas (ex.: ELECTRON_RUN_AS_NODE) que a sua CLI global não receberá: prefira o Node do sistema.");
  }
  return { ok: true, previa: { cli, nome_na_cli: nome, argv, texto: argv.map(citar).join(" "), avisos } };
}

export interface OpcoesCliUsuario {
  repo: RepoLojaMcp;
  executor: Executor;
  agora?: () => string;
  /** Ambiente da CLI do usuário (precisa de HOME/PATH: é a CLI DELE). Padrão: HOME, PATH e afins do processo. */
  ambiente?: () => Record<string, string>;
  localizar?: (nome: string) => string | null;
  timeoutMs?: number;
  registrarConsentimento?: (id: string, nome: string, cli: CliLoja) => void;
}

function ambientePadrao(): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const k of ["HOME", "USERPROFILE", "PATH", "Path", "LANG", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "SystemRoot"]) { const v = process.env[k]; if (v) saida[k] = v; }
  return saida;
}

export interface ServicoCliUsuario {
  instalar(e: EntradaMcp, previa: PreviaCli, confirmacao: string): Promise<{ ok: true } | { ok: false; codigo: CodigoCliUsuario; motivo: string }>;
  remover(servidorId: string, cli: CliLoja): Promise<{ ok: true } | { ok: false; codigo: CodigoCliUsuario; motivo: string }>;
}

export function criarServicoCliUsuario(o: OpcoesCliUsuario): ServicoCliUsuario {
  const agora = o.agora ?? ((): string => new Date().toISOString());
  const localizar = o.localizar ?? ((n: string): string | null => localizarExecutavel(n));
  const rodar = async (argv: string[]): Promise<{ ok: true } | { ok: false; codigo: CodigoCliUsuario; motivo: string }> => {
    const exe = localizar(argv[0]!);
    if (!exe) return { ok: false, codigo: "cli_nao_encontrada", motivo: `${argv[0]} não encontrada no PATH` };
    const r = await o.executor.rodar({ exe, args: argv.slice(1), env: (o.ambiente ?? ambientePadrao)(), timeoutMs: o.timeoutMs ?? 30_000 });
    if (r.codigo !== 0) return { ok: false, codigo: "falha", motivo: `${argv[0]} terminou com código ${r.codigo}` };
    return { ok: true };
  };
  return {
    async instalar(e, previa, confirmacao) {
      // Sem a confirmação digitada exata, NADA roda.
      if (confirmacao !== previa.nome_na_cli) return { ok: false, codigo: "confirmacao_invalida", motivo: `Digite ${previa.nome_na_cli} para confirmar.` };
      const r = await rodar(previa.argv);
      if (!r.ok) return r;
      o.repo.cliInstalacaoGravar({ servidor_id: e.id, cli: previa.cli, nome_na_cli: previa.nome_na_cli, escopo: "user", criado_em: agora() });
      o.registrarConsentimento?.(e.id, previa.nome_na_cli, previa.cli);
      return { ok: true };
    },
    async remover(servidorId, cli) {
      const reg = o.repo.cliInstalacoesDe(servidorId).find((x) => x.cli === cli);
      if (!reg || !reg.nome_na_cli.startsWith(PREFIXO_NOME_CLI)) return { ok: false, codigo: "nao_criado_pelo_app", motivo: "O app só remove o que ele mesmo criou (nome ev_*)." };
      const n = reg.nome_na_cli;
      const argv = cli === "claude" ? ["claude", "mcp", "remove", "--scope", "user", n] : cli === "codex" ? ["codex", "mcp", "remove", n] : cli === "gemini" ? ["gemini", "mcp", "remove", "-s", "user", n] : null;
      if (!argv) return { ok: false, codigo: "cli_sem_suporte", motivo: "sem comando de remoção" };
      const r = await rodar(argv);
      if (r.ok) o.repo.cliInstalacaoRemover(servidorId, cli);
      return r;
    },
  };
}
