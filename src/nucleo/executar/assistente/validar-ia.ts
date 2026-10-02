// Validação RÍGIDA da saída da IA (D-585). A IA é uma fonte NÃO CONFIÁVEL: nada do que ela diz é executado nem salvo sem passar por aqui e pela revisão
// humana. Itens inválidos são DESCARTADOS com o motivo; o que passa ainda é revalidado por `validarConfig` (o mesmo validador do editor). "Usar shell" nunca é gerado.
// Camadas por item: forma do JSON → sem shell → executável numa lista de programas plausíveis (sem `sh -c`, `sudo`, `rm`, `curl`…) → nenhum metacaractere
// de shell em nenhum argumento → nenhum caminho absoluto fora do workspace nem `..` → regra POR PROGRAMA (subcomando, script/alvo/arquivo que existe) →
// cwd existente dentro do workspace (sem symlink para fora) → ambiente sem segredo → `validarConfig`.
import { alvosDeMake, leitorEm, type LeitorProjeto, type ResultadoDeteccao } from "../detectar";
import { globsDeWorkspaces, pacotesDosGlobs } from "../monorepo";
import { LIMITES_EXECUTAR, TIPOS_EXECUCAO, type ConfigExecucao, type PassoExecucao, type TipoExecucao } from "../modelo";
import { ambienteSeguroConfig, argumentosSeguros, caminhoRelativoSeguro, executavelSeguro, porta as validarPorta, urlLoopbackSegura, validarConfig } from "../validacao";

export const LIMITES_IA = { configuracoes: 12, pre_passos: 4, justificativa: 300, aviso: 240, avisos: 10, nome: 60 } as const;

export interface ContextoValidacao {
  /** leitor confinado da RAIZ do workspace */
  leitor: LeitorProjeto;
  /** raiz absoluta (só para aceitar argumento absoluto que COMECE nela); ausente = nenhum caminho absoluto é aceito */
  raiz?: string;
  /** `null` = a pasta existe, é pasta e está dentro do workspace (realpath, sem symlink para fora); senão o motivo */
  verificarCwd: (relativo: string) => string | null;
  /** detecção determinística (para marcar o que é novo) */
  deteccao?: ResultadoDeteccao;
}

export interface ItemValidado {
  config: ConfigExecucao;
  justificativa: string;
  confianca: number;
  padrao: boolean;
  novo: boolean;
  /** correções silenciosas que o usuário deve saber (variável descartada, porta ignorada…) */
  notas: string[];
}

export interface ResultadoValidacao {
  itens: ItemValidado[];
  avisos: string[];
  descartados: Array<{ nome: string; motivo: string }>;
  /** o JSON não tem a forma pedida (vira retentativa) */
  erro_formato: string | null;
}

// ---------------------------------------------------------------- tokens perigosos
const META_SHELL = /[;&|`<>]|\$\(|\$\{|\r|\n/;
const PERIGOSOS = new Set([
  "sudo", "su", "doas", "rm", "rmdir", "dd", "mkfs", "chmod", "chown", "curl", "wget", "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "powershell", "pwsh", "cmd", "cmd.exe",
  "eval", "nc", "ncat", "netcat", "ssh", "scp", "sftp", "ftp", "telnet", "kill", "killall", "pkill", "launchctl", "osascript", "crontab", "-rf", "-fr", "--no-preserve-root", "mv", "shutdown", "reboot",
]);
const ABSOLUTO = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

function tokenPerigoso(t: string, raiz: string | undefined, ehExecutavel: boolean): string | null {
  if (META_SHELL.test(t)) return "metacaractere de shell (; & | ` < > $( )) não é permitido";
  const base = t.replace(/^.*[\\/]/, "").toLowerCase();
  // o nome do binário só conta no executável ou em caminho absoluto (`./cmd` num `go run` não é o comando `cmd`)
  if (PERIGOSOS.has(t.toLowerCase()) || ((ehExecutavel || ABSOLUTO.test(t)) && PERIGOSOS.has(base))) return `comando ou argumento perigoso: ${t.slice(0, 40)}`;
  if (t.startsWith("~")) return "caminho fora do workspace (~)";
  if (/(^|[\\/=])\.\.([\\/]|$)/.test(t)) return "caminho com .. (sai do workspace)";
  if (ABSOLUTO.test(t) || /=(\/|[A-Za-z]:[\\/])/.test(t)) {
    const caminho = t.includes("=") && !ABSOLUTO.test(t) ? t.slice(t.indexOf("=") + 1) : t;
    if (raiz === undefined || !(caminho === raiz || caminho.startsWith(`${raiz}/`))) return "caminho absoluto fora do workspace";
  }
  return null;
}

// ---------------------------------------------------------------- utilidades
const json = (t: string | null): Record<string, unknown> | null => {
  if (t === null) return null;
  try { const v = JSON.parse(t) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
};
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const slug = (t: string): string => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36).replace(/-+$/g, "") || "config";
// eslint-disable-next-line no-control-regex
const limparTexto = (t: string, max: number): string => t.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const NOME_SIMPLES = /^[A-Za-z0-9][A-Za-z0-9_.:@/+-]*$/;

interface Cmd { exe: string; args: string[] }
type Res = string | null;

// ---------------------------------------------------------------- executáveis plausíveis
const EXECUTAVEIS = new Set(["npm", "pnpm", "yarn", "bun", "node", "deno", "python", "python3", "uv", "poetry", "pip", "pip3", "cargo", "go", "dotnet", "mvn", "gradle", "docker", "docker-compose", "make", "just", "php", "composer", "ruby", "bundle", "flutter", "dart", "swift", "java"]);
const ENVOLTORIOS = new Set(["gradlew", "mvnw", "bin/rails"]);
const ehPython = (e: string): boolean => /^python(3(\.\d+)?)?$/.test(e);

function normalizarExecutavel(bruto: string, cwd: string, ctx: ContextoValidacao): { exe: string } | { erro: string } {
  const e = executavelSeguro(bruto);
  if (!e.ok) return { erro: `executável inválido: ${e.erro}` };
  const exe = e.valor;
  if (exe.includes("/")) {
    const limpo = exe.replace(/^\.\//, "");
    for (const c of cwd === "." ? [limpo] : [limpo, `${cwd}/${limpo}`]) {
      const ehEnvoltorio = [...ENVOLTORIOS].some((w) => c === w || c.endsWith(`/${w}`));
      if (ehEnvoltorio && ctx.leitor.existe(c)) return { exe: `./${c}` };
    }
    return { erro: `executável relativo não permitido ou inexistente: ${exe}` };
  }
  if (ENVOLTORIOS.has(exe)) return { erro: `use ./${exe} (wrapper do projeto)` };
  if (!EXECUTAVEIS.has(exe) && !ehPython(exe)) return { erro: `programa fora da lista de execução plausível: ${exe}` };
  return { exe };
}

const baseDoWrapper = (exe: string): string => exe.replace(/^.*\//, "");

// ---------------------------------------------------------------- regras por programa
const PM = new Set(["npm", "pnpm", "yarn", "bun"]);
const PM_OPCOES_PROIBIDAS = new Set(["-g", "--global", "--script-shell", "--shell", "--userconfig", "--globalconfig", "--registry", "--node-options", "--otp", "--auth-type", "--location", "--ignore-workspace-root-check", "--allow-scripts"]);
const PM_COM_VALOR = new Set(["--prefix", "-C", "--cwd", "--workspace", "-w", "--filter", "-F", "--dir", "--reporter", "--loglevel", "--workspace-concurrency"]);
const PM_FILTROS = new Set(["--workspace", "-w", "--filter", "-F", "--workspaces", "-ws", "-r", "--recursive", "--parallel", "--stream", "--include-workspace-root", "-iwr"]);
const PM_SUBS_PROIBIDOS = new Set(["exec", "x", "dlx", "create", "init", "add", "remove", "rm", "uninstall", "un", "update", "upgrade", "up", "link", "ln", "unlink", "publish", "login", "logout", "adduser", "config", "set", "get", "cache", "store", "dedupe", "audit", "prune", "patch", "pack", "version", "whoami", "rebuild", "fetch", "import", "self-update", "global", "pkg", "explain", "outdated", "dlx", "install-test", "npx", "run-all"]);

function scriptsDe(l: LeitorProjeto): Record<string, unknown> | null {
  const p = json(l.ler("package.json"));
  return p === null ? null : obj(p["scripts"]);
}

function scriptExisteEmQualquerPacote(nome: string, ctx: ContextoValidacao, aqui: LeitorProjeto): boolean {
  if (typeof scriptsDe(aqui)?.[nome] === "string" || typeof scriptsDe(ctx.leitor)?.[nome] === "string") return true;
  try {
    for (const p of pacotesDosGlobs(ctx.leitor, globsDeWorkspaces(ctx.leitor))) if (typeof scriptsDe(leitorEm(ctx.leitor, p))?.[nome] === "string") return true;
  } catch { /* sem workspaces */ }
  return false;
}

function regraGerenciador(c: Cmd, L: LeitorProjeto, ctx: ContextoValidacao): Res {
  const pos: string[] = [];
  let filtros = false;
  let i = 0;
  for (; i < c.args.length; i += 1) {
    const a = c.args[i]!;
    if (a === "--") break;
    if (a.startsWith("-")) {
      const nome = a.split("=")[0]!;
      if (PM_OPCOES_PROIBIDAS.has(nome)) return `opção não permitida: ${nome}`;
      if (PM_FILTROS.has(nome)) filtros = true;
      if (PM_COM_VALOR.has(nome) && !a.includes("=")) i += 1;
      continue;
    }
    pos.push(a);
  }
  const sub = pos[0];
  if (sub === undefined) return c.exe === "yarn" ? null : `faltou o subcomando do ${c.exe}`;
  if (["install", "i", "ci"].includes(sub)) return pos.length === 1 ? null : "instalar pacote novo não é permitido (só instalar o que o projeto já declara)";
  const existe = (nome: string): boolean => typeof scriptsDe(L)?.[nome] === "string" || (filtros && scriptExisteEmQualquerPacote(nome, ctx, L));
  const exigir = (nome: string | undefined): Res => {
    if (nome === undefined) return "faltou o nome do script";
    if (existe(nome)) return null;
    if (c.exe === "bun" && L.ler(nome) !== null) return null; // bun run arquivo.ts
    return scriptsDe(L) === null && !filtros ? "package.json não existe na pasta" : `o script "${nome}" não existe no package.json`;
  };
  if (["run", "run-script", "rum", "urn"].includes(sub)) return exigir(pos[1]);
  if (sub === "workspace" && c.exe === "yarn") return exigir(pos[2] === "run" ? pos[3] : pos[2]);
  if (sub === "start") return existe("start") || (c.exe === "npm" && L.existe("server.js")) ? null : 'o script "start" não existe no package.json';
  if (sub === "test" || sub === "t") return exigir("test");
  if (PM_SUBS_PROIBIDOS.has(sub)) return `subcomando não permitido: ${sub}`;
  if (c.exe === "npm") return `subcomando não permitido: ${sub}`;
  return exigir(sub); // pnpm/yarn/bun: `pnpm dev` = script
}

const MODULOS_PY = new Set(["http.server", "uvicorn", "flask", "pytest", "unittest", "django", "gunicorn", "streamlit", "fastapi", "celery", "hypercorn", "daphne", "ruff", "mypy"]);
const UV_RUN_OK = new Set(["python", "python3", "pytest", "uvicorn", "flask", "gunicorn", "streamlit", "fastapi", "django-admin", "ruff", "mypy", "hypercorn", "daphne"]);

function regraPython(args: string[], L: LeitorProjeto): Res {
  let i = 0;
  while (i < args.length && args[i]!.startsWith("-") && args[i] !== "-m") {
    const a = args[i]!;
    if (a === "-c" || a === "-" || a === "-i" || /^-[a-zA-Z]*c/.test(a)) return "python -c / stdin não é permitido";
    i += ["-W", "-X"].includes(a) ? 2 : 1;
  }
  const a = args[i];
  if (a === undefined) return "faltou o módulo ou arquivo a executar";
  if (a === "-m") {
    const m = args[i + 1];
    if (m === undefined || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(m)) return "módulo inválido";
    if (m === "venv") return args[i + 2] === ".venv" || args[i + 2] === "venv" ? null : "python -m venv só para .venv ou venv";
    if (MODULOS_PY.has(m)) return null;
    const caminho = m.replaceAll(".", "/");
    if (L.existe(`${caminho}/__main__.py`) || L.existe(`${caminho}.py`) || L.existe(`src/${caminho}/__main__.py`)) return null;
    return `módulo "${m}" não está entre os conhecidos nem existe no projeto`;
  }
  if (!/\.py$/.test(a)) return "só é permitido rodar arquivo .py ou python -m módulo";
  return L.ler(a) !== null || L.existe(a) ? null : `o arquivo ${a} não existe`;
}

function primeiroPosicional(args: string[], comecoEm: number, comValor: ReadonlySet<string> = new Set()): { valor: string | undefined; indice: number } {
  for (let i = comecoEm; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--") continue;
    if (a.startsWith("-")) { if (comValor.has(a) && !a.includes("=")) i += 1; continue; }
    return { valor: a, indice: i };
  }
  return { valor: undefined, indice: -1 };
}

function regraUv(c: Cmd, L: LeitorProjeto): Res {
  const { valor: sub, indice } = primeiroPosicional(c.args, 0, new Set(["--directory", "--project"]));
  if (sub === undefined) return "faltou o subcomando do uv";
  if (sub === "sync" || sub === "venv") return null;
  if (sub === "pip") {
    const resto = c.args.slice(indice + 1);
    return resto.length === 3 && resto[0] === "install" && resto[1] === "-r" && L.existe(resto[2]!) ? null : "uv pip: só `install -r <arquivo existente>`";
  }
  if (sub !== "run") return `subcomando do uv não permitido: ${sub}`;
  const resto = c.args.slice(indice + 1);
  const { valor: cmd, indice: j } = primeiroPosicional(resto, 0, new Set(["--with", "--python", "-p", "--directory", "--project", "--group"]));
  if (cmd === undefined) return "uv run sem comando";
  if (resto.some((a) => a === "--with" || a.startsWith("--with="))) return "uv run --with instala pacote: não permitido";
  if (ehPython(cmd) || cmd === "python") return regraPython(resto.slice(j + 1), L);
  if (UV_RUN_OK.has(cmd)) return null;
  if (/\.py$/.test(cmd)) return L.existe(cmd) ? null : `o arquivo ${cmd} não existe`;
  const py = L.ler("pyproject.toml") ?? "";
  return new RegExp(`^\\s*${cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`, "m").test(py) ? null : `comando "${cmd}" não é conhecido nem está em [project.scripts]`;
}

function regraPoetry(c: Cmd, L: LeitorProjeto): Res {
  const { valor: sub, indice } = primeiroPosicional(c.args, 0);
  if (sub === "install") return c.args.filter((a) => !a.startsWith("-")).length === 1 ? null : "poetry install com pacote novo";
  if (sub !== "run") return `subcomando do poetry não permitido: ${sub ?? "(nenhum)"}`;
  const resto = c.args.slice(indice + 1);
  const cmd = resto[0];
  if (cmd === undefined) return "poetry run sem comando";
  if (ehPython(cmd)) return regraPython(resto.slice(1), L);
  return UV_RUN_OK.has(cmd) ? null : `comando "${cmd}" não permitido em poetry run`;
}

function regraPip(c: Cmd, L: LeitorProjeto): Res {
  const a = c.args;
  if (a.length === 3 && a[0] === "install" && a[1] === "-r" && L.existe(a[2]!)) return null;
  if (a.length === 3 && a[0] === "install" && a[1] === "-e" && a[2] === ".") return null;
  return "pip: só `install -r <arquivo existente>` ou `install -e .`";
}

function regraNode(args: string[], L: LeitorProjeto): Res {
  let i = 0;
  for (; i < args.length; i += 1) {
    const a = args[i]!;
    if (!a.startsWith("-")) break;
    const nome = a.split("=")[0]!;
    if (["-e", "--eval", "-p", "--print", "-i", "--interactive", "--experimental-eval"].includes(nome) || /^-[a-z]*e$/.test(a)) return "node -e / --eval não é permitido";
    if (["-r", "--require", "--import", "--loader", "--experimental-loader", "--env-file"].includes(nome) && !a.includes("=")) i += 1;
    if (nome === "--test") return null;
  }
  const arq = args[i];
  if (arq === undefined) return "faltou o arquivo a executar";
  if (!/\.(c|m)?[jt]s$/.test(arq)) return "só é permitido rodar um arquivo .js/.mjs/.cjs/.ts";
  return L.existe(arq) ? null : `o arquivo ${arq} não existe`;
}

function regraDeno(args: string[], L: LeitorProjeto): Res {
  const { valor: sub, indice } = primeiroPosicional(args, 0);
  if (sub === "task") {
    const nome = args[indice + 1];
    const arq = ["deno.json", "deno.jsonc"].find((n) => L.existe(n));
    const tarefas = arq === undefined ? {} : obj(json(L.ler(arq))?.["tasks"]);
    return nome !== undefined && typeof tarefas[nome] === "string" ? null : `a tarefa "${nome ?? ""}" não existe no deno.json`;
  }
  if (sub === "run") {
    const alvo = primeiroPosicional(args, indice + 1).valor;
    return alvo !== undefined && /\.(c|m)?[jt]s$/.test(alvo) && L.existe(alvo) ? null : "deno run: arquivo inexistente ou inválido";
  }
  return `subcomando do deno não permitido: ${sub ?? "(nenhum)"}`;
}

function regraCargo(args: string[]): Res {
  const { valor: sub } = primeiroPosicional(args, 0, new Set(["--manifest-path", "-p", "--package", "--bin", "--example", "--features", "-F", "--target"]));
  return sub !== undefined && ["run", "build", "test", "check", "clippy", "watch", "bench", "doc"].includes(sub) ? null : `subcomando do cargo não permitido: ${sub ?? "(nenhum)"}`;
}

function regraGo(args: string[], L: LeitorProjeto): Res {
  const { valor: sub, indice } = primeiroPosicional(args, 0);
  if (sub === "mod") return ["tidy", "download"].includes(args[indice + 1] ?? "") ? null : "go mod: só tidy ou download";
  if (sub === "build" || sub === "test" || sub === "vet") return null;
  if (sub !== "run") return `subcomando do go não permitido: ${sub ?? "(nenhum)"}`;
  const alvo = primeiroPosicional(args, indice + 1).valor;
  if (alvo === undefined) return "go run sem alvo";
  if (alvo === "." || alvo === "./...") return L.existe("main.go") || L.existe("go.mod") ? null : "go run .: não há main.go nem go.mod";
  if (!alvo.startsWith(".") && !alvo.endsWith(".go")) return "go run só aceita alvo local (./pasta ou arquivo.go)";
  return L.existe(alvo.replace(/^\.\//, "")) ? null : `o alvo ${alvo} não existe`;
}

function regraDotnet(args: string[], L: LeitorProjeto): Res {
  const { valor: sub } = primeiroPosicional(args, 0, new Set(["--project", "-p", "-c", "--configuration", "--launch-profile"]));
  if (sub === undefined || !["run", "build", "test", "watch", "restore"].includes(sub)) return `subcomando do dotnet não permitido: ${sub ?? "(nenhum)"}`;
  const i = args.findIndex((a) => a === "--project" || a === "-p");
  if (i >= 0) { const p = args[i + 1]; if (p === undefined || !L.existe(p)) return `o projeto ${p ?? ""} não existe`; }
  return null;
}

function regraMaven(c: Cmd, L: LeitorProjeto): Res {
  if (c.exe === "mvn" && !L.existe("pom.xml")) return "não há pom.xml na pasta";
  const metas = c.args.filter((a) => !a.startsWith("-"));
  if (metas.length === 0) return "faltou o objetivo do Maven";
  for (const m of metas) {
    if (!/^[A-Za-z][A-Za-z0-9.:_-]*$/.test(m)) return `objetivo inválido: ${m}`;
    if (/^(deploy|release:|exec:exec|site-deploy)/.test(m)) return `objetivo do Maven não permitido: ${m}`;
  }
  const i = c.args.findIndex((a) => a === "-f" || a === "--file");
  if (i >= 0 && !L.existe(c.args[i + 1] ?? "")) return "o arquivo do -f não existe";
  return null;
}

function regraGradle(c: Cmd, L: LeitorProjeto): Res {
  if (c.exe === "gradle" && !["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"].some((n) => L.existe(n))) return "não há build.gradle na pasta";
  const tarefas = c.args.filter((a) => !a.startsWith("-"));
  if (tarefas.length === 0) return "faltou a tarefa do Gradle";
  for (const t of tarefas) {
    if (!/^[:A-Za-z0-9_.-]+$/.test(t)) return `tarefa inválida: ${t}`;
    if (/^(.*:)?(publish|upload|release|deploy)/i.test(t)) return `tarefa do Gradle não permitida: ${t}`;
  }
  return null;
}

const COMPOSE_SUBS = new Set(["up", "down", "build", "start", "stop", "restart", "logs", "ps", "pull", "watch", "config"]);
const COMPOSE_OPCOES = new Set(["-f", "--file", "-p", "--project-name", "--profile", "-d", "--detach", "--build", "--no-build", "--force-recreate", "--remove-orphans", "--wait", "--watch", "--follow", "-f", "--tail", "--no-color", "--abort-on-container-exit", "--env-file", "--quiet-pull", "--no-recreate"]);

function regraDocker(c: Cmd, L: LeitorProjeto): Res {
  const args = c.exe === "docker" ? c.args.slice(0, 1)[0] === "compose" ? c.args.slice(1) : null : c.args;
  if (args === null) return "docker: só `docker compose` é permitido (nada de run, exec, build avulso)";
  const { valor: sub, indice } = primeiroPosicional(args, 0, new Set(["-f", "--file", "-p", "--project-name", "--profile", "--env-file"]));
  if (sub === undefined || !COMPOSE_SUBS.has(sub)) return `subcomando do docker compose não permitido: ${sub ?? "(nenhum)"}`;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (!a.startsWith("-")) {
      if (i > indice && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(a)) return `nome de serviço inválido: ${a}`;
      continue;
    }
    const nome = a.split("=")[0]!;
    if (!COMPOSE_OPCOES.has(nome)) return `opção não permitida no docker compose: ${nome}`;
    if (nome === "-f" || nome === "--file") {
      const v = a.includes("=") ? a.split("=")[1]! : args[i + 1];
      if (v === undefined || !L.existe(v)) return `o arquivo ${v ?? ""} não existe`;
    }
    if (["-f", "--file", "-p", "--project-name", "--profile", "--env-file", "--tail"].includes(nome) && !a.includes("=")) i += 1;
  }
  if (!["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"].some((n) => L.existe(n)) && !args.some((a) => a === "-f" || a === "--file" || a.startsWith("--file="))) return "não há arquivo de compose na pasta";
  return null;
}

function regraMake(args: string[], L: LeitorProjeto, cwdBase: LeitorProjeto): Res {
  let alvoLeitor = L;
  const alvos: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "-C" || a === "--directory") {
      const d = args[i + 1];
      if (d === undefined || cwdBase.listar(d).length === 0) return "a pasta do -C não existe";
      alvoLeitor = leitorEm(cwdBase, d);
      i += 1;
    } else if (a === "-f" || a === "--file") {
      if (!L.existe(args[i + 1] ?? "")) return "o arquivo do -f não existe";
      i += 1;
    } else if (a === "-j") { if (/^\d+$/.test(args[i + 1] ?? "")) i += 1; }
    else if (/^-(j\d*|k|s|n|w)$/.test(a) || a === "--no-print-directory") continue;
    else if (a.startsWith("-")) return `opção do make não permitida: ${a}`;
    else if (a.includes("=")) return "atribuição de variável no make não é permitida";
    else if (!/^[A-Za-z0-9_.-]+$/.test(a)) return `alvo inválido: ${a}`;
    else alvos.push(a);
  }
  const arq = ["Makefile", "makefile", "GNUmakefile"].find((n) => alvoLeitor.existe(n));
  if (arq === undefined) return "não há Makefile na pasta";
  const existentes = alvosDeMake(alvoLeitor.ler(arq) ?? "");
  for (const t of alvos) if (!existentes.has(t)) return `o alvo "${t}" não existe no Makefile`;
  return null;
}

function regraJust(args: string[], L: LeitorProjeto): Res {
  const arq = ["justfile", "Justfile", ".justfile"].find((n) => L.existe(n));
  if (arq === undefined) return "não há justfile na pasta";
  const texto = L.ler(arq) ?? "";
  for (const a of args) {
    if (a.startsWith("-")) return `opção do just não permitida: ${a}`;
    if (!new RegExp(`^@?${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s[^:\\n]*)?:`, "m").test(texto)) return `a receita "${a}" não existe no justfile`;
  }
  return null;
}

function regraPhp(c: Cmd, L: LeitorProjeto): Res {
  if (c.exe === "composer") {
    const { valor: sub, indice } = primeiroPosicional(c.args, 0);
    if (sub === "install" || sub === "dump-autoload") return null;
    if (sub === "run-script" || sub === "run") {
      const nome = c.args[indice + 1];
      return nome !== undefined && typeof obj(json(L.ler("composer.json"))?.["scripts"])[nome] !== "undefined" ? null : `o script "${nome ?? ""}" não existe no composer.json`;
    }
    return `subcomando do composer não permitido: ${sub ?? "(nenhum)"}`;
  }
  if (c.args[0] === "artisan") return L.existe("artisan") ? null : "não há artisan na pasta";
  const s = c.args.indexOf("-S");
  if (s >= 0 && /^[A-Za-z0-9.\-[\]]+:\d{2,5}$/.test(c.args[s + 1] ?? "")) {
    const t = c.args.indexOf("-t");
    return t < 0 || L.listar(c.args[t + 1] ?? "").length > 0 ? null : "a pasta do -t não existe";
  }
  return "php: só `artisan <comando>` ou `-S host:porta [-t pasta]`";
}

function regraRuby(c: Cmd, L: LeitorProjeto): Res {
  if (c.exe === "ruby") return /\.rb$/.test(c.args[0] ?? "") && L.existe(c.args[0]!) ? null : "ruby: só arquivo .rb existente";
  if (c.exe === "bundle") {
    if (c.args[0] === "install") return c.args.length === 1 ? null : "bundle install com opção ou pacote";
    return c.args[0] === "exec" && ["rails", "rackup", "puma", "jekyll", "rake", "sidekiq"].includes(c.args[1] ?? "") ? null : "bundle: só install ou exec rails|rackup|puma|jekyll|rake|sidekiq";
  }
  // ./bin/rails
  return ["server", "s", "test", "db:migrate", "db:setup", "db:prepare"].includes(c.args[0] ?? "") ? null : `rails: subcomando não permitido: ${c.args[0] ?? "(nenhum)"}`;
}

function regraFlutterDart(c: Cmd): Res {
  const sub = c.args[0];
  if (c.exe === "flutter") return sub !== undefined && (["run", "test", "build", "analyze"].includes(sub) || (sub === "pub" && c.args[1] === "get")) ? null : `flutter: subcomando não permitido: ${sub ?? "(nenhum)"}`;
  return sub !== undefined && (["run", "test", "analyze"].includes(sub) || (sub === "pub" && c.args[1] === "get")) ? null : `dart: subcomando não permitido: ${sub ?? "(nenhum)"}`;
}

function regraJava(args: string[], L: LeitorProjeto): Res {
  const opcoes = args.filter((a) => a.startsWith("-") && a !== "-jar");
  if (opcoes.some((a) => !/^-Xm[sx]\d+[mMgG]$/.test(a) && !/^-Dserver\.port=\d+$/.test(a))) return "java: opção não permitida";
  const i = args.indexOf("-jar");
  const jar = i >= 0 ? args[i + 1] : undefined;
  return jar !== undefined && /\.jar$/.test(jar) && L.existe(jar) ? null : "java: só `-jar <arquivo .jar existente>`";
}

function regraDoPrograma(c: Cmd, L: LeitorProjeto, ctx: ContextoValidacao): Res {
  const e = c.exe;
  if (PM.has(e)) return regraGerenciador(c, L, ctx);
  if (e === "node") return regraNode(c.args, L);
  if (e === "deno") return regraDeno(c.args, L);
  if (ehPython(e)) return regraPython(c.args, L);
  if (e === "uv") return regraUv(c, L);
  if (e === "poetry") return regraPoetry(c, L);
  if (e === "pip" || e === "pip3") return regraPip(c, L);
  if (e === "cargo") return regraCargo(c.args);
  if (e === "go") return regraGo(c.args, L);
  if (e === "dotnet") return regraDotnet(c.args, L);
  if (e === "mvn" || baseDoWrapper(e) === "mvnw") return regraMaven(c, L);
  if (e === "gradle" || baseDoWrapper(e) === "gradlew") return regraGradle(c, L);
  if (e === "docker" || e === "docker-compose") return regraDocker(c, L);
  if (e === "make") return regraMake(c.args, L, L);
  if (e === "just") return regraJust(c.args, L);
  if (e === "php" || e === "composer") return regraPhp(c, L);
  if (e === "ruby" || e === "bundle" || baseDoWrapper(e) === "rails") return regraRuby({ exe: baseDoWrapper(e) === "rails" ? "rails" : e, args: c.args }, L);
  if (e === "flutter" || e === "dart") return regraFlutterDart(c);
  if (e === "swift") return ["run", "build", "test"].includes(c.args[0] ?? "") ? null : `swift: subcomando não permitido: ${c.args[0] ?? "(nenhum)"}`;
  if (e === "java") return regraJava(c.args, L);
  return `programa sem regra: ${e}`;
}

/** Valida um comando (executável + argumentos separados) contra todas as camadas. Devolve o passo normalizado ou o motivo. */
export function validarComandoIa(bruto: { executavel: unknown; argumentos: unknown }, cwd: string, ctx: ContextoValidacao): { ok: true; passo: PassoExecucao } | { ok: false; motivo: string } {
  if (typeof bruto.executavel !== "string") return { ok: false, motivo: "executável ausente" };
  if (bruto.executavel.trim() !== bruto.executavel || /\s/.test(bruto.executavel)) return { ok: false, motivo: "executável com espaço: separe os argumentos (nada de linha de shell)" };
  const exeTok = tokenPerigoso(bruto.executavel, ctx.raiz, true);
  if (exeTok !== null) return { ok: false, motivo: exeTok };
  const args = argumentosSeguros(bruto.argumentos);
  if (!args.ok) return { ok: false, motivo: args.erro };
  for (const a of args.valor) {
    const m = tokenPerigoso(a, ctx.raiz, false);
    if (m !== null) return { ok: false, motivo: m };
  }
  const n = normalizarExecutavel(bruto.executavel, cwd, ctx);
  if ("erro" in n) return { ok: false, motivo: n.erro };
  const L = cwd === "." ? ctx.leitor : leitorEm(ctx.leitor, cwd);
  const motivo = regraDoPrograma({ exe: n.exe, args: args.valor }, L, ctx);
  return motivo === null ? { ok: true, passo: { executavel: n.exe, argumentos: args.valor } } : { ok: false, motivo };
}

// ---------------------------------------------------------------- itens
function validarAmbiente(bruto: unknown, notas: string[]): Record<string, string> {
  const saida: Record<string, string> = {};
  if (bruto === undefined || bruto === null) return saida;
  if (typeof bruto !== "object" || Array.isArray(bruto)) { notas.push("ambiente ignorado: formato inesperado"); return saida; }
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>).slice(0, LIMITES_EXECUTAR.ambiente)) {
    const valor = typeof v === "number" || typeof v === "boolean" ? String(v) : v;
    if (typeof valor !== "string") { notas.push(`variável ${k.slice(0, 40)} ignorada: valor inválido`); continue; }
    if (valor.includes("{{vault:")) { notas.push(`variável ${k.slice(0, 40)} ignorada: a IA não define referências ao cofre`); continue; }
    const r = ambienteSeguroConfig({ [k]: valor });
    if (r.ok) saida[k] = valor;
    else notas.push(`variável ${k.slice(0, 40)} descartada: ${/segredo/.test(r.erro) ? "parece segredo (configure pelo cofre, nunca pela IA)" : r.erro}`);
  }
  return saida;
}

const chaveDoComando = (c: Pick<ConfigExecucao, "cwd" | "executavel" | "argumentos">): string => `${c.cwd}|${c.executavel}|${c.argumentos.join(" ")}`;

function validarItem(bruto: unknown, ctx: ContextoValidacao, ids: Set<string>): { ok: true; item: ItemValidado } | { ok: false; nome: string; motivo: string } {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return { ok: false, nome: "(item)", motivo: "o item não é um objeto" };
  const o = bruto as Record<string, unknown>;
  const nomeBruto = typeof o["nome"] === "string" ? limparTexto(o["nome"], LIMITES_IA.nome) : "";
  const nome = nomeBruto === "" ? "(sem nome)" : nomeBruto;
  const rejeitar = (motivo: string): { ok: false; nome: string; motivo: string } => ({ ok: false, nome, motivo });
  if (nomeBruto === "") return rejeitar("sem nome");

  if (o["shell"] !== undefined && o["shell"] !== null && o["shell"] !== "") return rejeitar("usar shell não é permitido em configuração gerada por IA");
  const cwdR = caminhoRelativoSeguro(o["cwd"] === undefined || o["cwd"] === null ? "." : o["cwd"]);
  if (!cwdR.ok) return rejeitar(`pasta inválida: ${cwdR.erro}`);
  const cwd = cwdR.valor;
  const motivoCwd = ctx.verificarCwd(cwd);
  if (motivoCwd !== null) return rejeitar(`pasta inválida: ${motivoCwd}`);

  const principal = validarComandoIa({ executavel: o["executavel"], argumentos: o["argumentos"] ?? [] }, cwd, ctx);
  if (!principal.ok) return rejeitar(principal.motivo);

  const brutosPre = o["pre_passos"] === undefined || o["pre_passos"] === null ? [] : o["pre_passos"];
  if (!Array.isArray(brutosPre)) return rejeitar("pré-passos: esperado lista");
  if (brutosPre.length > LIMITES_IA.pre_passos) return rejeitar("pré-passos demais");
  const pre: PassoExecucao[] = [];
  for (const [i, p] of brutosPre.entries()) {
    if (typeof p !== "object" || p === null || Array.isArray(p)) return rejeitar(`pré-passo ${i + 1}: esperado objeto`);
    const r = validarComandoIa({ executavel: (p as Record<string, unknown>)["executavel"], argumentos: (p as Record<string, unknown>)["argumentos"] ?? [] }, cwd, ctx);
    if (!r.ok) return rejeitar(`pré-passo ${i + 1}: ${r.motivo}`);
    pre.push(r.passo);
  }

  const notas: string[] = [];
  const ambiente = validarAmbiente(o["ambiente"], notas);

  let portaV: number | null = null;
  if (o["porta"] !== undefined && o["porta"] !== null) {
    const p = validarPorta(typeof o["porta"] === "string" && /^\d+$/.test(o["porta"]) ? Number(o["porta"]) : o["porta"]);
    if (p.ok) portaV = p.valor; else notas.push("porta ignorada: fora de 1–65535");
  }
  let url: string | null = null;
  if (o["url"] !== undefined && o["url"] !== null && o["url"] !== "") {
    const u = urlLoopbackSegura(o["url"]);
    if (u.ok) url = u.valor; else notas.push(`URL ignorada: ${u.erro}`);
  }
  const tipo = (typeof o["tipo"] === "string" && (TIPOS_EXECUCAO as readonly string[]).includes(o["tipo"]) ? o["tipo"] : "outro") as TipoExecucao;
  const abrir = o["abrir_navegador"] === true && tipo === "rodar" && (portaV !== null || url !== null);

  const base = slug(nome);
  let id = base;
  for (let n = 2; ids.has(id); n += 1) id = `${base.slice(0, 33)}-${n}`;

  const montada = {
    id, nome, tipo, executavel: principal.passo.executavel, argumentos: principal.passo.argumentos, cwd, ambiente, pre_passos: pre, porta: portaV, url,
    abrir_navegador: abrir, reiniciar_ao_salvar: false, grupo: null, shell: null,
  };
  const final = validarConfig(montada, "usuario");
  if (!final.ok) return rejeitar(final.erro);
  ids.add(id);

  const just = typeof o["justificativa"] === "string" ? limparTexto(o["justificativa"], LIMITES_IA.justificativa) : "";
  const conf = typeof o["confianca"] === "number" && Number.isFinite(o["confianca"]) ? Math.min(1, Math.max(0, o["confianca"])) : 0.5;
  const det = new Set((ctx.deteccao?.configuracoes ?? []).map(chaveDoComando));
  return { ok: true, item: { config: final.valor, justificativa: just, confianca: Math.round(conf * 100) / 100, padrao: o["padrao"] === true, novo: !det.has(chaveDoComando(final.valor)), notas } };
}

/** Valida a proposta INTEIRA da IA. `bruto` é o JSON já extraído (qualquer coisa; nada é confiável). */
export function validarPropostaIa(bruto: unknown, ctx: ContextoValidacao): ResultadoValidacao {
  const vazio = (erro: string): ResultadoValidacao => ({ itens: [], avisos: [], descartados: [], erro_formato: erro });
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return vazio("a resposta não é um objeto JSON");
  const o = bruto as Record<string, unknown>;
  if (!Array.isArray(o["configuracoes"])) return vazio('faltou a lista "configuracoes"');
  const descartados: ResultadoValidacao["descartados"] = [];
  const itens: ItemValidado[] = [];
  const ids = new Set<string>();
  for (const [i, b] of o["configuracoes"].entries()) {
    if (i >= LIMITES_IA.configuracoes) {
      descartados.push({ nome: `(item ${i + 1})`, motivo: `além do limite de ${LIMITES_IA.configuracoes} configurações` });
      continue;
    }
    const r = validarItem(b, ctx, ids);
    if (r.ok) itens.push(r.item); else descartados.push({ nome: r.nome, motivo: r.motivo });
  }
  // uma só padrão: a primeira marcada; sem marca, a de maior confiança entre as "rodar"
  const marcadas = itens.filter((x) => x.padrao);
  const escolhida = marcadas[0] ?? [...itens].filter((x) => x.config.tipo === "rodar").sort((a, b) => b.confianca - a.confianca)[0] ?? null;
  for (const x of itens) x.padrao = x === escolhida;
  const avisos = Array.isArray(o["avisos"]) ? o["avisos"].filter((a): a is string => typeof a === "string").map((a) => limparTexto(a, LIMITES_IA.aviso)).filter((a) => a !== "").slice(0, LIMITES_IA.avisos) : [];
  return { itens, avisos, descartados, erro_formato: null };
}

/** Resumo do que falhou, curto e sem eco do conteúdo da IA, para a retentativa. */
export function resumirErros(r: ResultadoValidacao): string {
  if (r.erro_formato !== null) return r.erro_formato;
  return r.descartados.slice(0, 5).map((d) => `"${d.nome.slice(0, 40)}": ${d.motivo.slice(0, 120)}`).join("; ") || "nenhuma configuração válida";
}

