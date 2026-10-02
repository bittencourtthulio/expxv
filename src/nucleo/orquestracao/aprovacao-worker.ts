/**
 * Política de aprovações dos workers (D-640 em diante). FUNÇÃO PURA: dado (CLI, nível, cwd, worktree?, tools do MCP do app) devolve o que muda no lançamento
 * do worker — argv, `settings` do Claude, ambiente — mais o selo honesto (`garantido` | `parcial` | `pergunta`) e os avisos para a UI.
 *
 * Princípios (docs/ade/AUDITORIA-APROVACAO-WORKERS.md):
 * - o piso é a ALLOWLIST: no `automatico_seguro` só o que está na lista roda sem perguntar; o `deny` é sempre emitido e vence qualquer allow/bypass;
 * - bypass total (`--dangerously-skip-permissions`) só no nível `total`, só no Claude, só em worktree isolado e com a confirmação digitada já registrada;
 *   NUNCA `--always-approve`, `bypassPermissions` nem `--dangerously-bypass-approvals-and-sandbox`;
 * - a política automática só vale com o cwd isolado (worktree/pasta do worker); na raiz do projeto do dono só com a opção explícita `permitirNaRaiz`
 *   (e nunca o `total`); projeto NÃO confiável rebaixa para `perguntar` (`npm run` executa código do repositório);
 * - nada aqui lê arquivo, segredo nem ambiente do processo: tudo entra pela entrada.
 *
 * O que NUNCA muda (D-21): assinatura do prodx, aprovação de raio ALTO, `mergex-revisar` e merge continuam humanos; esta política só trata a
 * aprovação de ferramentas da CLI, e as regras de papel do MCP seguem valendo (o worker só tem `handoff_submit` e opt-ins).
 */
import { isAbsolute, resolve } from "node:path";
import { menorNivelAprovacao, type NivelAprovacaoWorker, type SeloAprovacao } from "../../compartilhado/aprovacao-workers";

export type { NivelAprovacaoWorker, SeloAprovacao };

export interface EntradaAprovacaoWorker {
  /** id da ferramenta no catálogo (`claude`, `codex`, `opencode`, `grok`…) */
  cli: string;
  /** nível CONFIGURADO (já limitado por `pane_spawn.aprovacao`, que só abaixa) */
  nivel: NivelAprovacaoWorker;
  /** cwd absoluto em que a CLI vai abrir */
  cwd: string;
  /** raiz absoluta do projeto principal do dono */
  raiz: string;
  /** o cwd é um worktree/pasta PRÓPRIA do worker (nunca a árvore principal do dono) */
  isolado: boolean;
  /** o dono marcou "permitir também na raiz" (com confirmação); vale só para o `automatico_seguro` */
  permitirNaRaiz?: boolean;
  /** `false` = projeto NÃO confiável: o nível cai para `perguntar`. Ausente = confiável (o dono adicionou o workspace). */
  projetoConfiavel?: boolean;
  /** a palavra `liberar tudo` foi digitada ao configurar o nível `total` */
  totalConfirmado?: boolean;
  /** nome do servidor MCP injetado pelo app (`mcp__<servidor>__<tool>`) */
  servidorMcp: string;
  /** tools do app que o token deste worker enxerga (matriz por papel, `ferramentasPermitidas`) */
  toolsMcp: readonly string[];
  /** padrão `process.platform`-agnóstico: só decide o caminho nulo do git (`NUL` no Windows) */
  plataforma?: "win32" | "posix";
}

export interface SettingsPermissoesClaude {
  permissions: { defaultMode?: "acceptEdits"; allow: string[]; deny: string[] };
}

export interface ResultadoAprovacaoWorker {
  /** nível EFETIVO depois dos rebaixamentos de segurança */
  nivel: NivelAprovacaoWorker;
  /** nível pedido (configurado) — difere do efetivo quando houve rebaixamento */
  nivel_pedido: NivelAprovacaoWorker;
  /** argv extra (antes do prompt posicional); vazio quando a CLI não tem allowlist */
  argumentos: string[];
  /** objeto para `--settings` (Claude); `null` nas demais CLIs */
  settings: SettingsPermissoesClaude | null;
  /** ambiente extra (git sem hooks, `OPENCODE_CONFIG_CONTENT` com `permission`) */
  env: Record<string, string>;
  selo: SeloAprovacao;
  avisos: string[];
}

/** Tools MCP do app que o worker SEMPRE pode chamar sem perguntar (entregar o trabalho nunca pode travar). */
export const TOOLS_MCP_SEMPRE_PRE_APROVADAS: readonly string[] = ["handoff_submit"];

// ---------------------------------------------------------------------------------------------------------------------------------- Claude Code
/** Leitura e navegação: sem efeito colateral. As negativas de caminho (`DENY_LEITURA`) valem sobre elas. */
const ALLOW_LEITURA: readonly string[] = ["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite"];

/**
 * Bash por prefixo (`Bash(<prefixo>:*)`). Só entra o que é comum E não abre porta para o resto:
 * - sem `cat/head/tail/grep/rg/sed/find`: as regras `Read(...)` negam arquivos de ambiente e chaves só nas tools do Claude, NÃO em subprocessos do Bash
 *   (`cat .env` passaria); `Read/Grep/Glob` já cobrem a leitura com as negativas. `find` ainda tem `-exec`/`-delete`;
 * - sem `node`/`python` genéricos: um interpretador executa qualquer coisa e anula todo o `deny` (só `node --test`, `python -m pytest`);
 * - `cp/mv/mkdir/touch` NÃO precisam de regra: o `acceptEdits` do Claude os aprova só com caminhos DENTRO do diretório de trabalho (a CLI confere o caminho; um prefixo não confere).
 */
const ALLOW_BASH: readonly string[] = [
  "git status", "git diff", "git log", "git show", "git add", "git commit", "git branch", "git checkout", "git switch", "git restore --staged", "git rev-parse", "git ls-files",
  "npm test", "npm run test", "npm run lint", "npm run build", "npm run typecheck", "npm run check", "npm run format:check",
  "pnpm test", "pnpm run test", "pnpm run lint", "pnpm run build", "pnpm run typecheck", "pnpm run check",
  "yarn test", "yarn run test", "yarn run lint", "yarn run build", "yarn run typecheck", "yarn run check",
  "bun test", "bun run test", "bun run lint", "bun run build", "bun run typecheck", "bun run check",
  "npx vitest", "npx jest", "npx tsc", "npx eslint", "npx prettier --check",
  "node --test", "node --version", "node -v",
  "python -m pytest", "python3 -m pytest", "pytest",
  "go test", "go build", "go vet",
  "cargo test", "cargo build", "cargo check", "cargo clippy",
  "make test", "make build", "make check", "make lint",
  "ls", "pwd", "wc",
];

/** Negativas de Bash: escalonamento, destruição, rede, publicação, execução arbitrária e mudança de configuração do git (hooks/aliases). Vencem allow e bypass. */
const DENY_BASH: readonly string[] = [
  "rm -rf", "rm -fr", "rm -Rf", "rm -fR",
  "sudo", "su", "doas",
  "curl", "wget", "nc", "ncat", "ssh", "scp", "sftp", "rsync", "ftp", "telnet",
  "git push", "git reset --hard", "git clean", "git config", "git -c", "git -C", "git remote", "git filter-branch", "git update-ref", "git rebase", "git branch -D",
  "git checkout -f", "git checkout --force", "git worktree remove", "git gc", "git submodule",
  "gh", "chmod -R", "chown", "chgrp", "dd", "mkfs", "diskutil", "launchctl", "crontab", "kill -9", "killall", "pkill",
  "eval", "exec", "bash -c", "sh -c", "zsh -c", "node -e", "node --eval", "node -p", "python -c", "python3 -c", "perl -e", "ruby -e",
  "npm publish", "npm install -g", "npm i -g", "npm login", "npm adduser", "npm token", "pnpm publish", "yarn publish",
  "printenv", "env", "export", "security", "open",
];

const DENY_LEITURA: readonly string[] = [
  "**/.env*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/id_rsa*", "**/id_ed25519*", "**/id_ecdsa*", "**/.npmrc", "**/.netrc", "**/.pypirc",
  "**/credentials.json", "**/.credentials*", "**/*.keystore", "**/secrets/**",
  "~/.ssh/**", "~/.aws/**", "~/.gnupg/**", "~/.config/gh/**", "~/.docker/**", "~/.kube/**", "~/.npmrc", "~/.netrc", "~/.config/gcloud/**", "~/.azure/**",
  "~/.claude.json", "~/.claude/.credentials*", "~/.codex/auth.json", "~/Library/Keychains/**",
];

/** Escrita: caminhos de sistema e de configuração do usuário, a pasta `.git` (hooks/config) e a configuração do próprio agente. Fora do cwd a CLI já não aprova sozinha. */
const DENY_ESCRITA: readonly string[] = [
  "**/.git/**", "**/.claude/settings*.json", "**/.claude/hooks/**", "**/.mcp.json", "**/.env*",
  "//etc/**", "//usr/**", "//bin/**", "//sbin/**", "//System/**", "//Library/**", "//private/etc/**",
  "~/.ssh/**", "~/.aws/**", "~/.gnupg/**", "~/.config/**", "~/.zshrc", "~/.zprofile", "~/.bashrc", "~/.bash_profile", "~/.profile", "~/.gitconfig", "~/.claude/**", "~/.codex/**",
];

/** O worker não abre workers (profundidade 1) nem usa subagentes internos. */
const DENY_AGENTES: readonly string[] = ["Agent", "Task"];

const FERRAMENTAS_DE_ESCRITA = ["Edit", "Write", "MultiEdit", "NotebookEdit"] as const;

const bash = (prefixo: string): string => `Bash(${prefixo}:*)`;

function caminhoParaRegra(cwd: string): string {
  const abs = isAbsolute(cwd) ? resolve(cwd) : resolve("/", cwd);
  const posix = abs.replace(/\\/g, "/");
  return posix.startsWith("/") ? `/${posix}` : `//${posix}`;
}

/** Lista de negativas COMPLETA do Claude (a mesma em `automatico_seguro` e `total`). */
export function negativasDoClaude(): string[] {
  const deny: string[] = [];
  for (const p of DENY_BASH) deny.push(bash(p));
  for (const p of DENY_LEITURA) deny.push(`Read(${p})`);
  for (const f of FERRAMENTAS_DE_ESCRITA) for (const p of DENY_ESCRITA) deny.push(`${f}(${p})`);
  for (const a of DENY_AGENTES) deny.push(a);
  return deny;
}

/** `mcp__<servidor>__<tool>` de cada tool do app (sempre inclui `handoff_submit`). Servidor com caracteres fora de [a-z0-9-] não gera regra. */
export function permissoesMcpDoApp(servidor: string, tools: readonly string[]): string[] {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(servidor)) return [];
  const nomes = [...new Set([...TOOLS_MCP_SEMPRE_PRE_APROVADAS, ...tools.filter((t) => /^[a-z][a-z0-9_]{0,63}$/.test(t))])];
  return nomes.map((t) => `mcp__${servidor}__${t}`);
}

function allowDoClaude(e: EntradaAprovacaoWorker): string[] {
  const alvo = caminhoParaRegra(e.cwd);
  const allow = [...permissoesMcpDoApp(e.servidorMcp, e.toolsMcp), ...ALLOW_LEITURA];
  for (const f of FERRAMENTAS_DE_ESCRITA) allow.push(`${f}(${alvo}/**)`);
  for (const p of ALLOW_BASH) allow.push(bash(p));
  return allow;
}

// ------------------------------------------------------------------------------------------------------------------------------------ git sem hooks
/**
 * `core.hooksPath` neutro e `core.fsmonitor` vazio por ambiente (`GIT_CONFIG_COUNT`, git >= 2.31): hooks e fsmonitor de um repositório clonado/alheio são execução
 * de código. Vale para o `git commit` do worker; commits do dono continuam com os hooks dele. Sem pager nem prompt de credencial.
 */
export function ambienteGitNeutro(plataforma: "win32" | "posix" = "posix"): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: plataforma === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "false",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
  };
}

// ------------------------------------------------------------------------------------------------------------------------------------ OpenCode
function permissaoOpencode(): Record<string, unknown> {
  const bashRegras: Record<string, string> = { "*": "ask" };
  for (const p of ALLOW_BASH) { bashRegras[p] = "allow"; bashRegras[`${p} *`] = "allow"; }
  // negativas por ÚLTIMO: no OpenCode a última regra que casa vence
  for (const p of DENY_BASH) { bashRegras[p] = "deny"; bashRegras[`${p} *`] = "deny"; }
  const leitura: Record<string, string> = { "*": "allow" };
  for (const p of DENY_LEITURA) leitura[p] = "deny";
  return {
    edit: "allow",
    read: leitura,
    glob: "allow",
    grep: "allow",
    list: "allow",
    bash: bashRegras,
    task: "deny",
    external_directory: "deny",
    webfetch: "ask",
    websearch: "ask",
  };
}

// --------------------------------------------------------------------------------------------------------------------------- Grok (regras no estilo Claude)
function argumentosGrok(e: EntradaAprovacaoWorker): string[] {
  const args = ["--permission-mode", "acceptEdits"];
  for (const r of permissoesMcpDoApp(e.servidorMcp, e.toolsMcp)) args.push("--allow", r);
  for (const p of ALLOW_BASH) args.push("--allow", bash(p));
  for (const r of negativasDoClaude()) args.push("--deny", r);
  return args;
}

// ----------------------------------------------------------------------------------------------------------------------------------- decisão
const CLIS_COM_ALLOWLIST = ["claude", "codex", "opencode", "grok"];

interface Efetivo { nivel: NivelAprovacaoWorker; avisos: string[] }

/** Rebaixamentos de segurança: projeto não confiável, cwd na raiz, total sem worktree/confirmação/Claude. Nunca sobe de nível. */
export function nivelEfetivoDoWorker(e: EntradaAprovacaoWorker): Efetivo {
  const avisos: string[] = [];
  let nivel = e.nivel;
  if (nivel === "perguntar") return { nivel, avisos };
  if (e.projetoConfiavel === false) {
    return { nivel: "perguntar", avisos: ["Projeto marcado como não confiável: comandos como npm run executam código do repositório, então o worker pergunta tudo."] };
  }
  if (nivel === "total") {
    if (!e.isolado) {
      avisos.push("O nível Total só vale dentro de um worktree isolado: este worker não está em um, então roda no Automático seguro.");
      nivel = "automatico_seguro";
    } else if (e.totalConfirmado !== true) {
      avisos.push("O nível Total precisa da confirmação digitada (liberar tudo): sem ela o worker roda no Automático seguro.");
      nivel = "automatico_seguro";
    } else if (e.cli !== "claude") {
      avisos.push("Só o Claude Code tem bypass controlável; nesta CLI o nível Total vira Automático seguro (nunca o bypass total do sandbox).");
      nivel = "automatico_seguro";
    }
  }
  if (!e.isolado && e.permitirNaRaiz !== true) {
    return { nivel: "perguntar", avisos: [...avisos, "O worker abriu na raiz do projeto, não em um worktree: a aprovação automática só vale na pasta do próprio worker. Ele pergunta tudo (ou marque permitir também na raiz)."] };
  }
  if (!e.isolado) avisos.push("Aprovação automática na raiz do projeto, por opção sua: o worker edita a árvore principal (a allowlist e as negativas continuam valendo).");
  return { nivel, avisos };
}

const VAZIO = (nivel: NivelAprovacaoWorker, nivel_pedido: NivelAprovacaoWorker, avisos: string[], selo: SeloAprovacao = "pergunta"): ResultadoAprovacaoWorker =>
  ({ nivel, nivel_pedido, argumentos: [], settings: null, env: {}, selo, avisos });

/**
 * O que muda no lançamento do worker. `perguntar`, projeto não confiável, cwd na raiz e CLI sem allowlist devolvem o lançamento SEM nada extra (a CLI pergunta,
 * selo `pergunta`). Nunca devolve bypass fora de `total`+Claude+worktree+confirmação.
 */
export function aprovacaoDoWorker(e: EntradaAprovacaoWorker): ResultadoAprovacaoWorker {
  const { nivel, avisos } = nivelEfetivoDoWorker(e);
  if (nivel === "perguntar") return VAZIO("perguntar", e.nivel, avisos);
  if (!CLIS_COM_ALLOWLIST.includes(e.cli)) {
    return VAZIO("perguntar", e.nivel, [...avisos, `${e.cli} não tem allowlist confiável: o worker continua perguntando (aprovações parciais não são prometidas).`]);
  }
  const plataforma = e.plataforma ?? "posix";
  const gitNeutro = ambienteGitNeutro(plataforma);

  if (e.cli === "claude") {
    const total = nivel === "total";
    const settings: SettingsPermissoesClaude = {
      permissions: { ...(total ? {} : { defaultMode: "acceptEdits" as const }), allow: allowDoClaude(e), deny: negativasDoClaude() },
    };
    const argumentos = total ? ["--dangerously-skip-permissions"] : ["--permission-mode", "acceptEdits"];
    const extra = total ? ["Total no Claude Code: as negativas (push, rm -rf, sudo, rede, ssh, chaves, agentes) continuam valendo mesmo sob o bypass."] : [];
    return { nivel, nivel_pedido: e.nivel, argumentos, settings, env: gitNeutro, selo: "garantido", avisos: [...avisos, ...extra] };
  }

  if (e.cli === "codex") {
    // sandbox do SO (workspace-write) + nunca perguntar + rede desligada; NUNCA `--dangerously-bypass-approvals-and-sandbox` nem danger-full-access.
    return {
      nivel, nivel_pedido: e.nivel,
      argumentos: ["-s", "workspace-write", "-a", "never", "-c", "sandbox_workspace_write.network_access=false"],
      settings: null,
      env: gitNeutro,
      selo: "parcial",
      avisos: [...avisos, "Codex: o sandbox do sistema limita a escrita à pasta do worker e desliga a rede (push falha), mas não há lista de comandos nem negativa de leitura de .env dentro da pasta."],
    };
  }

  if (e.cli === "opencode") {
    return {
      nivel, nivel_pedido: e.nivel,
      argumentos: [],
      settings: null,
      env: { ...gitNeutro, OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: permissaoOpencode() }) },
      selo: "parcial",
      avisos: [...avisos, "OpenCode: allow/deny por configuração do Pane; o app não confirmou o contrato dessas regras nesta versão da CLI, então o selo é parcial."],
    };
  }

  // grok
  return {
    nivel, nivel_pedido: e.nivel,
    argumentos: argumentosGrok(e),
    settings: null,
    env: gitNeutro,
    selo: "parcial",
    avisos: [...avisos, "Grok: modo acceptEdits com --allow/--deny; nunca bypassPermissions nem --always-approve. O Grok não fala com o MCP do app como worker, então o selo é parcial."],
  };
}

/** Nível efetivo do `pane_spawn`: o pedido só ABAIXA o configurado (e `total` nunca é pedido por agente). */
export function nivelDoPedido(configurado: NivelAprovacaoWorker, pedido: NivelAprovacaoWorker | null | undefined): NivelAprovacaoWorker {
  if (pedido === null || pedido === undefined || pedido === "total") return configurado;
  return menorNivelAprovacao(configurado, pedido);
}

/** Flags/valores que NUNCA podem aparecer fora do `total`+Claude (usado pelos testes e pelo guarda do lançamento). */
export const ARGUMENTOS_DE_BYPASS: readonly string[] = ["--dangerously-skip-permissions", "bypassPermissions", "--always-approve", "--yolo", "--dangerously-bypass-approvals-and-sandbox", "--approve-for-me", "--auto", "--approval-mode=yolo", "--yes-always", "danger-full-access"];

/** Soma `permissions` ao conteúdo de um settings do Claude (JSON): `allow`/`deny` somam sem repetir; o `deny` existente nunca é apagado. Conteúdo inválido volta intacto. */
export function mesclarPermissoesNoSettings(conteudo: string, extra: SettingsPermissoesClaude): string {
  try {
    const atual: unknown = JSON.parse(conteudo);
    if (typeof atual !== "object" || atual === null || Array.isArray(atual)) return conteudo;
    const o = atual as Record<string, unknown>;
    const p = typeof o["permissions"] === "object" && o["permissions"] !== null && !Array.isArray(o["permissions"]) ? (o["permissions"] as Record<string, unknown>) : {};
    const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const permissions: Record<string, unknown> = {
      ...p,
      ...(extra.permissions.defaultMode === undefined ? {} : { defaultMode: extra.permissions.defaultMode }),
      allow: [...new Set([...lista(p["allow"]), ...extra.permissions.allow])],
      deny: [...new Set([...lista(p["deny"]), ...extra.permissions.deny])],
    };
    return JSON.stringify({ ...o, permissions }, null, 2);
  } catch {
    return conteudo;
  }
}
