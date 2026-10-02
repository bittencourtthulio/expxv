// Detecção AUTOMÁTICA das configurações de execução a partir do projeto (SÓ LEITURA, nunca executa nada).
// Cobre: Node (npm/pnpm/yarn/bun) + Next/Vite/CRA/Nuxt/Astro/Angular/Electron, Makefile, justfile, Cargo, Go, Python (Django, FastAPI, Flask,
// `python -m`, pytest), Docker Compose, Maven, Gradle (Spring Boot), .NET, Flutter, Deno, PHP/Laravel, Ruby/Rails e site estático.
// Monorepos (D-580…): também varre subpastas com manifesto próprio (profundidade ≤ 3, ≤ 400 entradas) e gera configurações com `cwd` relativo, rotuladas com a pasta.
// Nome de script/alvo vem do REPOSITÓRIO (não confiável): só entra se casar com um padrão estrito e nunca começa com `-`.
import type { ConfigExecucao, PassoExecucao, TipoExecucao } from "./modelo";
import { ferramentasMonorepo, globsDeWorkspaces, pacotesDosGlobs, varrerPastas } from "./monorepo";

/** Leitura confinada do projeto (o main implementa com `lstat`+`realpath`; o teste usa um mapa em memória). */
export interface LeitorProjeto {
  /** conteúdo de um arquivo regular dentro da raiz (até 1 MiB) ou `null`. */
  ler(rel: string): string | null;
  existe(rel: string): boolean;
  /** nomes dos itens de uma pasta da raiz (sem recursão). */
  listar(rel: string): string[];
}

export interface ResultadoDeteccao {
  configuracoes: ConfigExecucao[];
  /** corpo do script que cada configuração dispara (id → texto): entra no hash de confiança e no diálogo */
  corpos: Record<string, string>;
  /** ecossistemas reconhecidos (`node`, `cargo`…) */
  ecossistemas: string[];
  padrao_sugerido: string | null;
  /** monorepo: pastas com projeto próprio (ordenadas da mais provável à menos) e ferramentas de workspace; `[]` quando é um projeto simples */
  pastas?: Array<{ pasta: string; ecossistemas: string[]; configuracoes: number; pontuacao: number }>;
  ferramentas?: string[];
}

/** Leitor com prefixo: `leitorEm(l, "desktop").ler("package.json")` lê `desktop/package.json`. */
export function leitorEm(l: LeitorProjeto, sub: string): LeitorProjeto {
  const j = (rel: string): string => (rel === "." || rel === "" ? sub : `${sub}/${rel.replace(/^\.\//, "")}`);
  return { ler: (r) => l.ler(j(r)), existe: (r) => l.existe(j(r)), listar: (r) => l.listar(j(r)) };
}

const NOME_SEGURO = /^[A-Za-z0-9][A-Za-z0-9:_.@/-]{0,59}$/;
const SCRIPT_NODE = /^(dev|start|serve|build|test|preview|watch|lint|typecheck|electron|electron:dev|storybook|e2e|test:e2e|start:dev|inicio|iniciar|rodar|dev:[A-Za-z0-9_-]+|build:[A-Za-z0-9_-]+)$/;

const base = (p: Partial<ConfigExecucao> & Pick<ConfigExecucao, "id" | "nome" | "executavel" | "argumentos">): ConfigExecucao => ({
  tipo: "rodar", cwd: ".", ambiente: {}, pre_passos: [], porta: null, url: null, abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null, origem: "detectada", ...p,
});

const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "x";
const json = (t: string | null): Record<string, unknown> | null => {
  if (t === null) return null;
  try { const v = JSON.parse(t) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
};
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function tipoDoScript(nome: string): TipoExecucao {
  if (nome.startsWith("build")) return "build";
  if (/^(test|e2e|lint|typecheck)/.test(nome)) return "teste";
  return "rodar";
}

interface Coletor {
  lista: ConfigExecucao[];
  corpos: Record<string, string>;
  ecossistemas: string[];
  /** leitor da RAIZ do workspace quando o coletor é de uma subpasta (lockfile e `node_modules` sobem para a raiz em workspaces) */
  raiz?: LeitorProjeto;
}

function adicionar(c: Coletor, eco: string, cfg: ConfigExecucao, corpo?: string): void {
  let id = cfg.id;
  if (c.lista.some((x) => x.id === id)) id = `${eco}-${cfg.id}`.slice(0, 40);
  for (let n = 2; c.lista.some((x) => x.id === id); n += 1) id = `${eco}-${cfg.id}`.slice(0, 36) + `-${n}`;
  c.lista.push({ ...cfg, id });
  if (corpo !== undefined && corpo.trim() !== "") c.corpos[id] = corpo.slice(0, 2_000);
}

// ---------------------------------------------------------------- Node
function gerenciadorNode(l: LeitorProjeto, pkg: Record<string, unknown>, raiz?: LeitorProjeto): string {
  const campo = typeof pkg["packageManager"] === "string" ? pkg["packageManager"].split("@")[0] : null;
  if (campo === "pnpm" || campo === "yarn" || campo === "bun" || campo === "npm") return campo;
  for (const leitor of raiz === undefined ? [l] : [l, raiz]) {
    if (leitor.existe("pnpm-lock.yaml")) return "pnpm";
    if (leitor.existe("yarn.lock")) return "yarn";
    if (leitor.existe("bun.lockb") || leitor.existe("bun.lock")) return "bun";
    if (leitor.existe("package-lock.json")) return "npm";
  }
  return "npm";
}

const PORTAS_QUADROS: Array<{ dep: RegExp; nome: string; porta: number; preview?: number }> = [
  { dep: /^next$/, nome: "Next.js", porta: 3000 },
  { dep: /^nuxt$/, nome: "Nuxt", porta: 3000 },
  { dep: /^astro$/, nome: "Astro", porta: 4321, preview: 4321 },
  { dep: /^react-scripts$/, nome: "Create React App", porta: 3000 },
  { dep: /^@angular\/cli$/, nome: "Angular", porta: 4200 },
  { dep: /^(@sveltejs\/kit|vite)$/, nome: "Vite", porta: 5173, preview: 4173 },
  { dep: /^@remix-run\/dev$/, nome: "Remix", porta: 3000 },
];

function detectarNode(l: LeitorProjeto, c: Coletor): void {
  const pkg = json(l.ler("package.json"));
  if (pkg === null) return;
  c.ecossistemas.push("node");
  const pm = gerenciadorNode(l, pkg, c.raiz);
  const scripts = obj(pkg["scripts"]);
  const deps = { ...obj(pkg["dependencies"]), ...obj(pkg["devDependencies"]) };
  const quadro = PORTAS_QUADROS.find((q) => Object.keys(deps).some((d) => q.dep.test(d)));
  const electron = "electron" in deps;
  const cmd = (nome: string): PassoExecucao => ({ executavel: pm, argumentos: ["run", nome] });
  const rotulos: Record<string, string> = {
    dev: "Rodar (dev)", start: "Iniciar", serve: "Servir", build: "Build completo", test: "Testes", preview: "Preview", watch: "Observar (watch)", lint: "Lint",
    typecheck: "Verificar tipos", electron: "Rodar (Electron)", "electron:dev": "Rodar (Electron, dev)", storybook: "Storybook", e2e: "Testes e2e", "test:e2e": "Testes e2e",
    "start:dev": "Iniciar (dev)", inicio: electron ? "Iniciar (build + Electron)" : "Iniciar", iniciar: "Iniciar", rodar: "Rodar",
  };
  const nomes = Object.keys(scripts).filter((n) => NOME_SEGURO.test(n) && SCRIPT_NODE.test(n) && typeof scripts[n] === "string").slice(0, 14);
  const temBuild = nomes.includes("build");
  for (const nome of nomes) {
    const tipo = tipoDoScript(nome);
    const web = quadro !== undefined && !electron && tipo === "rodar" && /^(dev|start|serve|preview|start:dev|dev:.+)$/.test(nome);
    const porta = web ? (nome === "preview" && quadro.preview !== undefined ? quadro.preview : nome === "start" && quadro.nome === "Vite" ? null : quadro.porta) : null;
    const rotulo = nome === "start" && temBuild && quadro !== undefined ? "Iniciar (produção)" : (rotulos[nome] ?? `Script: ${nome}`);
    adicionar(c, "node", base({ id: slug(nome), nome: rotulo, tipo, executavel: pm, argumentos: ["run", nome], porta, abrir_navegador: web && porta !== null }), String(scripts[nome]));
  }
  if (temBuild && nomes.includes("start")) {
    const web = quadro !== undefined && !electron;
    adicionar(c, "node", base({
      id: "build-e-rodar", nome: "Build e rodar", pre_passos: [cmd("build")], executavel: pm, argumentos: ["run", "start"],
      porta: web ? quadro.porta : null, abrir_navegador: web,
    }), `${String(scripts["build"])}\n${String(scripts["start"])}`);
  }
  if (c.raiz === undefined) detectarWorkspacesDaRaiz(l, c, pm, nomes);
  if (nomes.length === 0 && electron && typeof pkg["main"] === "string") {
    adicionar(c, "node", base({ id: "electron", nome: "Rodar (Electron)", executavel: pm === "npm" ? "npx" : pm, argumentos: pm === "npm" ? ["electron", "."] : ["exec", "electron", "."] }));
  }
}

// ---------------------------------------------------------------- Makefile / justfile
const ALVOS_COMUNS = ["run", "dev", "serve", "start", "build", "test", "all", "check", "up"];
export function alvosDeMake(texto: string): Map<string, string> {
  const alvos = new Map<string, string>();
  const linhas = texto.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i += 1) {
    const m = /^([A-Za-z][A-Za-z0-9_.-]{0,40})\s*:(?!=)/.exec(linhas[i]!);
    if (m === null || m[1]!.startsWith(".")) continue;
    const receita: string[] = [];
    for (let j = i + 1; j < linhas.length && /^[\t ]/.test(linhas[j]!); j += 1) receita.push(linhas[j]!.trim());
    alvos.set(m[1]!, receita.join("\n"));
  }
  return alvos;
}
function detectarMake(l: LeitorProjeto, c: Coletor): void {
  const arq = ["Makefile", "makefile", "GNUmakefile"].find((n) => l.existe(n));
  if (arq === undefined) return;
  const alvos = alvosDeMake(l.ler(arq) ?? "");
  c.ecossistemas.push("make");
  for (const nome of ALVOS_COMUNS) {
    if (!alvos.has(nome) || !NOME_SEGURO.test(nome)) continue;
    const tipo: TipoExecucao = nome === "build" || nome === "all" ? "build" : nome === "test" || nome === "check" ? "teste" : "rodar";
    adicionar(c, "make", base({ id: slug(nome), nome: `make ${nome}`, tipo, executavel: "make", argumentos: [nome] }), alvos.get(nome));
  }
}
function detectarJust(l: LeitorProjeto, c: Coletor): void {
  const arq = ["justfile", "Justfile", ".justfile"].find((n) => l.existe(n));
  if (arq === undefined) return;
  const texto = l.ler(arq) ?? "";
  c.ecossistemas.push("just");
  for (const nome of ALVOS_COMUNS) {
    if (!new RegExp(`^${nome}(?:\\s[^:\\n]*)?:`, "m").test(texto) || !NOME_SEGURO.test(nome)) continue;
    const tipo: TipoExecucao = nome === "build" ? "build" : nome === "test" || nome === "check" ? "teste" : "rodar";
    adicionar(c, "just", base({ id: slug(nome), nome: `just ${nome}`, tipo, executavel: "just", argumentos: [nome] }));
  }
}

// ---------------------------------------------------------------- linguagens
function detectarCargo(l: LeitorProjeto, c: Coletor): void {
  if (!l.existe("Cargo.toml")) return;
  c.ecossistemas.push("cargo");
  adicionar(c, "cargo", base({ id: "rodar-cargo", nome: "Rodar (cargo run)", executavel: "cargo", argumentos: ["run"] }));
  adicionar(c, "cargo", base({ id: "build-cargo", nome: "Build completo (cargo build)", tipo: "build", executavel: "cargo", argumentos: ["build", "--release"] }));
  adicionar(c, "cargo", base({ id: "test-cargo", nome: "Testes (cargo test)", tipo: "teste", executavel: "cargo", argumentos: ["test"] }));
  adicionar(c, "cargo", base({ id: "build-e-rodar-cargo", nome: "Build e rodar (cargo)", pre_passos: [{ executavel: "cargo", argumentos: ["build"] }], executavel: "cargo", argumentos: ["run"] }));
}

function detectarGo(l: LeitorProjeto, c: Coletor): void {
  if (!l.existe("go.mod")) return;
  c.ecossistemas.push("go");
  const cmds = l.existe("cmd") ? l.listar("cmd").filter((n) => NOME_SEGURO.test(n) && l.existe(`cmd/${n}/main.go`)) : [];
  const alvo = l.existe("main.go") ? "." : cmds[0] !== undefined ? `./cmd/${cmds[0]}` : null;
  if (alvo !== null) adicionar(c, "go", base({ id: "rodar-go", nome: "Rodar (go run)", executavel: "go", argumentos: ["run", alvo] }));
  adicionar(c, "go", base({ id: "build-go", nome: "Build completo (go build)", tipo: "build", executavel: "go", argumentos: ["build", "./..."] }));
  adicionar(c, "go", base({ id: "test-go", nome: "Testes (go test)", tipo: "teste", executavel: "go", argumentos: ["test", "./..."] }));
  if (alvo !== null) adicionar(c, "go", base({ id: "build-e-rodar-go", nome: "Build e rodar (go)", pre_passos: [{ executavel: "go", argumentos: ["build", "./..."] }], executavel: "go", argumentos: ["run", alvo] }));
}

function detectarPython(l: LeitorProjeto, c: Coletor): void {
  const pyproject = l.ler("pyproject.toml");
  const req = l.ler("requirements.txt") ?? "";
  const temPython = pyproject !== null || l.existe("requirements.txt") || l.existe("manage.py") || l.existe("setup.py") || l.existe("Pipfile");
  if (!temPython) return;
  c.ecossistemas.push("python");
  const dependencias = `${pyproject ?? ""}\n${req}`.toLowerCase();
  if (l.existe("manage.py")) {
    adicionar(c, "python", base({ id: "runserver", nome: "Rodar (Django runserver)", executavel: "python3", argumentos: ["manage.py", "runserver"], porta: 8000, abrir_navegador: true }));
    adicionar(c, "python", base({ id: "test-django", nome: "Testes (Django)", tipo: "teste", executavel: "python3", argumentos: ["manage.py", "test"] }));
  }
  for (const arq of ["main.py", "app.py", "app/main.py", "src/main.py"]) {
    const t = l.ler(arq);
    if (t === null) continue;
    const modulo = arq.replace(/\.py$/, "").replaceAll("/", ".");
    if (/FastAPI\s*\(/.test(t) || /\bfastapi\b/.test(dependencias)) {
      if (/FastAPI\s*\(/.test(t)) {
        adicionar(c, "python", base({ id: "uvicorn", nome: "Rodar (FastAPI/uvicorn)", executavel: "python3", argumentos: ["-m", "uvicorn", `${modulo}:app`, "--reload"], porta: 8000, abrir_navegador: true }));
        break;
      }
    }
    if (/Flask\s*\(/.test(t)) {
      adicionar(c, "python", base({ id: "flask", nome: "Rodar (Flask)", executavel: "python3", argumentos: ["-m", "flask", "--app", modulo, "run", "--debug"], porta: 5000, abrir_navegador: true }));
      break;
    }
  }
  for (const item of l.listar(".").filter((n) => NOME_SEGURO.test(n) && !n.includes(".")).slice(0, 60)) {
    if (l.existe(`${item}/__main__.py`)) { adicionar(c, "python", base({ id: "python-m", nome: `Rodar (python -m ${item})`, executavel: "python3", argumentos: ["-m", item] })); break; }
  }
  if (/pytest/.test(dependencias) || l.existe("tests") || l.existe("pytest.ini")) {
    adicionar(c, "python", base({ id: "pytest", nome: "Testes (pytest)", tipo: "teste", executavel: "python3", argumentos: ["-m", "pytest"] }));
  }
}

function detectarCompose(l: LeitorProjeto, c: Coletor): void {
  const arq = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"].find((n) => l.existe(n));
  if (arq === undefined) return;
  c.ecossistemas.push("docker");
  adicionar(c, "docker", base({ id: "compose-up", nome: "Subir (docker compose up)", executavel: "docker", argumentos: ["compose", "up"] }), l.ler(arq) ?? undefined);
  adicionar(c, "docker", base({ id: "compose-build-up", nome: "Build e subir (docker compose)", tipo: "rodar", executavel: "docker", argumentos: ["compose", "up", "--build"] }));
  adicionar(c, "docker", base({ id: "compose-down", nome: "Derrubar (docker compose down)", tipo: "outro", executavel: "docker", argumentos: ["compose", "down"] }));
}

function detectarMaven(l: LeitorProjeto, c: Coletor): void {
  const pom = l.ler("pom.xml");
  if (pom === null) return;
  c.ecossistemas.push("maven");
  const exe = l.existe("mvnw") ? "./mvnw" : "mvn";
  if (/spring-boot/.test(pom)) adicionar(c, "maven", base({ id: "spring-boot-run", nome: "Rodar (Spring Boot)", executavel: exe, argumentos: ["spring-boot:run"], porta: 8080, abrir_navegador: true }));
  adicionar(c, "maven", base({ id: "build-maven", nome: "Build completo (Maven)", tipo: "build", executavel: exe, argumentos: ["package"] }));
  adicionar(c, "maven", base({ id: "test-maven", nome: "Testes (Maven)", tipo: "teste", executavel: exe, argumentos: ["test"] }));
}

function detectarGradle(l: LeitorProjeto, c: Coletor): void {
  const arq = ["build.gradle.kts", "build.gradle"].find((n) => l.existe(n));
  if (arq === undefined) return;
  const t = l.ler(arq) ?? "";
  c.ecossistemas.push("gradle");
  const exe = l.existe("gradlew") ? "./gradlew" : "gradle";
  if (/org\.springframework\.boot|spring-boot/.test(t)) adicionar(c, "gradle", base({ id: "boot-run", nome: "Rodar (Spring Boot, bootRun)", executavel: exe, argumentos: ["bootRun"], porta: 8080, abrir_navegador: true }));
  else if (/\bapplication\b/.test(t)) adicionar(c, "gradle", base({ id: "gradle-run", nome: "Rodar (Gradle run)", executavel: exe, argumentos: ["run"] }));
  adicionar(c, "gradle", base({ id: "build-gradle", nome: "Build completo (Gradle)", tipo: "build", executavel: exe, argumentos: ["build"] }));
  adicionar(c, "gradle", base({ id: "test-gradle", nome: "Testes (Gradle)", tipo: "teste", executavel: exe, argumentos: ["test"] }));
}

function detectarDotnet(l: LeitorProjeto, c: Coletor): void {
  const itens = l.listar(".").filter((n) => /\.(csproj|fsproj|sln|slnx)$/i.test(n) && NOME_SEGURO.test(n));
  if (itens.length === 0) return;
  c.ecossistemas.push("dotnet");
  const projeto = itens.find((n) => /\.(csproj|fsproj)$/i.test(n));
  const web = projeto !== undefined && /Sdk="Microsoft\.NET\.Sdk\.Web"/.test(l.ler(projeto) ?? "");
  adicionar(c, "dotnet", base({ id: "dotnet-run", nome: "Rodar (dotnet run)", executavel: "dotnet", argumentos: projeto === undefined ? ["run"] : ["run", "--project", projeto], porta: web ? 5000 : null, abrir_navegador: web }));
  adicionar(c, "dotnet", base({ id: "build-dotnet", nome: "Build completo (dotnet build)", tipo: "build", executavel: "dotnet", argumentos: ["build"] }));
  adicionar(c, "dotnet", base({ id: "test-dotnet", nome: "Testes (dotnet test)", tipo: "teste", executavel: "dotnet", argumentos: ["test"] }));
}

function detectarFlutter(l: LeitorProjeto, c: Coletor): void {
  const t = l.ler("pubspec.yaml");
  if (t === null || !/^\s*flutter\s*:/m.test(t)) return;
  c.ecossistemas.push("flutter");
  adicionar(c, "flutter", base({ id: "flutter-run", nome: "Rodar (flutter run)", executavel: "flutter", argumentos: ["run"] }));
  adicionar(c, "flutter", base({ id: "test-flutter", nome: "Testes (flutter test)", tipo: "teste", executavel: "flutter", argumentos: ["test"] }));
}

function detectarDeno(l: LeitorProjeto, c: Coletor): void {
  const arq = ["deno.json", "deno.jsonc"].find((n) => l.existe(n));
  if (arq === undefined) return;
  const tarefas = obj(json(l.ler(arq))?.["tasks"]);
  c.ecossistemas.push("deno");
  for (const nome of Object.keys(tarefas).filter((n) => NOME_SEGURO.test(n) && SCRIPT_NODE.test(n)).slice(0, 8)) {
    adicionar(c, "deno", base({ id: slug(nome), nome: `deno task ${nome}`, tipo: tipoDoScript(nome), executavel: "deno", argumentos: ["task", nome] }), String(tarefas[nome]));
  }
}

function detectarPhp(l: LeitorProjeto, c: Coletor): void {
  if (!l.existe("artisan")) return;
  c.ecossistemas.push("php");
  adicionar(c, "php", base({ id: "artisan-serve", nome: "Rodar (Laravel serve)", executavel: "php", argumentos: ["artisan", "serve"], porta: 8000, abrir_navegador: true }));
  adicionar(c, "php", base({ id: "artisan-test", nome: "Testes (Laravel)", tipo: "teste", executavel: "php", argumentos: ["artisan", "test"] }));
}

function detectarRuby(l: LeitorProjeto, c: Coletor): void {
  if (!l.existe("Gemfile")) return;
  c.ecossistemas.push("ruby");
  if (l.existe("bin/rails")) {
    adicionar(c, "ruby", base({ id: "rails-server", nome: "Rodar (Rails server)", executavel: "./bin/rails", argumentos: ["server"], porta: 3000, abrir_navegador: true }));
    adicionar(c, "ruby", base({ id: "rails-test", nome: "Testes (Rails)", tipo: "teste", executavel: "./bin/rails", argumentos: ["test"] }));
  } else if (l.existe("config.ru")) {
    adicionar(c, "ruby", base({ id: "rackup", nome: "Rodar (rackup)", executavel: "bundle", argumentos: ["exec", "rackup"], porta: 9292, abrir_navegador: true }));
  }
}

function detectarEstatico(l: LeitorProjeto, c: Coletor): void {
  if (c.lista.some((x) => x.tipo === "rodar") || !l.existe("index.html")) return;
  c.ecossistemas.push("estatico");
  adicionar(c, "estatico", base({ id: "servir-pasta", nome: "Servir a pasta (site estático)", executavel: "python3", argumentos: ["-m", "http.server", "8080", "--bind", "127.0.0.1"], porta: 8080, abrir_navegador: true }));
}

const PREFERENCIA_PADRAO = ["dev", "runserver", "uvicorn", "flask", "spring-boot-run", "boot-run", "rails-server", "artisan-serve", "dotnet-run", "flutter-run", "rodar-cargo", "rodar-go", "electron-dev", "electron", "inicio", "start", "serve", "compose-up", "servir-pasta", "build-e-rodar"];

// ---------------------------------------------------------------- workspaces (raiz)
/**
 * Raiz de um monorepo JS: oferece "rodar na raiz" quando o `dev` da raiz não existe (turbo/nx/`-r`/`--workspaces`). "Rodar no pacote X" são as configurações
 * das subpastas (varredura abaixo). Só entra se algum pacote tem script `dev`.
 */
function detectarWorkspacesDaRaiz(l: LeitorProjeto, c: Coletor, pm: string, nomesRaiz: string[]): void {
  const globs = globsDeWorkspaces(l);
  const turbo = l.existe("turbo.json");
  const nx = l.existe("nx.json");
  if (globs.length === 0 && !turbo && !nx) return;
  const pacotes = pacotesDosGlobs(l, globs);
  const comDev = pacotes.filter((p) => typeof obj(json(l.ler(`${p}/package.json`))?.["scripts"])["dev"] === "string");
  if (nomesRaiz.includes("dev") || (comDev.length === 0 && !turbo && !nx)) return;
  if (turbo) {
    const [exe, args] = pm === "npm" ? ["npx", ["--no-install", "turbo", "run", "dev"]] : pm === "pnpm" ? ["pnpm", ["exec", "turbo", "run", "dev"]] : pm === "bun" ? ["bun", ["x", "turbo", "run", "dev"]] : ["yarn", ["turbo", "run", "dev"]];
    adicionar(c, "node", base({ id: "turbo-dev", nome: "Rodar tudo (turbo run dev)", executavel: exe as string, argumentos: args as string[] }), "turbo run dev");
  } else if (nx) {
    const [exe, args] = pm === "npm" ? ["npx", ["--no-install", "nx", "run-many", "-t", "dev"]] : pm === "pnpm" ? ["pnpm", ["exec", "nx", "run-many", "-t", "dev"]] : pm === "bun" ? ["bun", ["x", "nx", "run-many", "-t", "dev"]] : ["yarn", ["nx", "run-many", "-t", "dev"]];
    adicionar(c, "node", base({ id: "nx-dev", nome: "Rodar tudo (nx run-many dev)", executavel: exe as string, argumentos: args as string[] }), "nx run-many -t dev");
  } else if (pm === "pnpm") {
    adicionar(c, "node", base({ id: "workspaces-dev", nome: "Rodar todos os pacotes (dev)", executavel: "pnpm", argumentos: ["-r", "--parallel", "run", "dev"] }), "pnpm -r --parallel run dev");
  } else if (pm === "npm") {
    adicionar(c, "node", base({ id: "workspaces-dev", nome: "Rodar todos os pacotes (dev)", executavel: "npm", argumentos: ["run", "dev", "--workspaces", "--if-present"] }), "npm run dev --workspaces --if-present");
  } else if (pm === "bun") {
    adicionar(c, "node", base({ id: "workspaces-dev", nome: "Rodar todos os pacotes (dev)", executavel: "bun", argumentos: ["run", "--filter", "*", "dev"] }), "bun run --filter '*' dev");
  }
}

const DETECTORES = [detectarNode, detectarDeno, detectarCargo, detectarGo, detectarPython, detectarMaven, detectarGradle, detectarDotnet, detectarFlutter, detectarPhp, detectarRuby, detectarCompose, detectarMake, detectarJust, detectarEstatico];

function rodarDetectores(leitor: LeitorProjeto, c: Coletor): void {
  for (const f of DETECTORES) {
    try { f(leitor, c); } catch { /* um detector com erro nunca derruba os demais */ }
  }
}

function escolherPadraoLista(lista: ConfigExecucao[], soRodar: boolean): string | null {
  const pref = PREFERENCIA_PADRAO.map((id) => lista.find((x) => x.id === id || x.id.startsWith(`${id}-`))?.id).find((x) => x !== undefined);
  return pref ?? lista.find((x) => x.tipo === "rodar")?.id ?? (soRodar ? null : (lista[0]?.id ?? null));
}

const PASTAS_FRACAS = /^(examples?|exemplos?|docs?|sandbox|playground|scripts|tools|fixtures?|tests?|e2e|benchmarks?|samples?)$/i;
const PASTAS_APP = /^(desktop|app|apps|web|frontend|client|cliente|api|server|backend|ui|main)$/i;

/** Quanto a pasta parece "o app a rodar": script dev/start, app Electron, número de sinais e o nome da pasta. */
function pontuarPasta(pasta: string, lista: ConfigExecucao[], ecos: string[]): number {
  let pontos = lista.length;
  const idx = PREFERENCIA_PADRAO.map((id, i) => (lista.some((x) => x.tipo === "rodar" && (x.id === id || x.id.endsWith(`-${id}`) || x.id.startsWith(`${id}-`))) ? i : -1)).filter((i) => i >= 0);
  if (idx.length > 0) pontos += 100 - Math.min(...idx) * 3;
  else if (lista.some((x) => x.tipo === "rodar")) pontos += 20;
  if (lista.some((x) => /electron/i.test(x.nome) || /electron/i.test(x.id))) pontos += 25;
  if (ecos.includes("node") && lista.some((x) => x.tipo === "rodar" && x.porta !== null)) pontos += 10;
  const nome = pasta.split("/").pop() ?? pasta;
  if (PASTAS_APP.test(nome)) pontos += 5;
  if (pasta.split("/").some((p) => PASTAS_FRACAS.test(p))) pontos -= 30;
  pontos -= (pasta.split("/").length - 1) * 2;
  return pontos;
}

const MAX_PASTAS = 8;
const MAX_POR_PASTA = 5;
const slugPasta = (pasta: string): string => slug(pasta.replaceAll("/", "-")).slice(0, 14).replace(/-+$/, "") || "x";

/** Reescreve uma configuração detectada numa subpasta: `cwd` relativo à raiz, executável relativo (`./gradlew`) ancorado na raiz, rótulo com a pasta. */
function ancorarNaPasta(cfg: ConfigExecucao, pasta: string): ConfigExecucao {
  const ancora = (e: string): string => (e.startsWith("./") ? `./${pasta}/${e.slice(2)}` : e);
  const rotulo = `${pasta} · ${cfg.nome}`;
  return {
    ...cfg, id: `${slugPasta(pasta)}-${cfg.id}`.slice(0, 40).replace(/-+$/, ""), nome: rotulo.length > 60 ? `${rotulo.slice(0, 59)}…` : rotulo, cwd: pasta,
    executavel: ancora(cfg.executavel), pre_passos: cfg.pre_passos.map((p) => ({ ...p, executavel: ancora(p.executavel) })),
  };
}

const ORDEM_TIPO: Record<TipoExecucao, number> = { rodar: 0, build: 1, teste: 2, outro: 3 };

export function detectarConfiguracoes(leitor: LeitorProjeto): ResultadoDeteccao {
  const c: Coletor = { lista: [], corpos: {}, ecossistemas: [] };
  rodarDetectores(leitor, c);
  const raizLista = [...c.lista];
  const padraoRaiz = escolherPadraoLista(raizLista, true);

  // ---- subpastas com manifesto próprio (monorepos)
  const pastas: NonNullable<ResultadoDeteccao["pastas"]> = [];
  const candidatas: Array<{ pasta: string; lista: ConfigExecucao[]; corpos: Record<string, string>; ecos: string[]; pontos: number }> = [];
  try {
    for (const { pasta } of varrerPastas(leitor)) {
      const sub: Coletor = { lista: [], corpos: {}, ecossistemas: [], raiz: leitor };
      rodarDetectores(leitorEm(leitor, pasta), sub);
      if (sub.lista.length === 0) continue;
      candidatas.push({ pasta, lista: sub.lista, corpos: sub.corpos, ecos: sub.ecossistemas, pontos: pontuarPasta(pasta, sub.lista, sub.ecossistemas) });
    }
  } catch { /* varredura é cortesia: a raiz já foi detectada */ }
  candidatas.sort((a, b) => b.pontos - a.pontos);
  const escolhidas = candidatas.slice(0, MAX_PASTAS);
  const idsDaPasta = new Map<string, string[]>();
  for (const cand of escolhidas) {
    const ordenadas = [...cand.lista].sort((a, b) => ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]).slice(0, MAX_POR_PASTA);
    const ids: string[] = [];
    for (const cfg of ordenadas) {
      const nova = ancorarNaPasta(cfg, cand.pasta);
      const antes = c.lista.length;
      adicionar(c, "sub", nova, cand.corpos[cfg.id]);
      if (c.lista.length > antes) ids.push(c.lista[c.lista.length - 1]!.id);
    }
    idsDaPasta.set(cand.pasta, ids);
    pastas.push({ pasta: cand.pasta, ecossistemas: [...new Set(cand.ecos)], configuracoes: ids.length, pontuacao: cand.pontos });
  }
  for (const cand of escolhidas) for (const e of cand.ecos) if (!c.ecossistemas.includes(e)) c.ecossistemas.push(e);

  // ---- padrão: a raiz manda quando ela roda algo; senão a pasta mais provável; senão a primeira configuração
  let padrao = padraoRaiz;
  if (padrao === null && escolhidas.length > 0) {
    const melhor = escolhidas[0]!;
    const ids = idsDaPasta.get(melhor.pasta) ?? [];
    const dela = c.lista.filter((x) => ids.includes(x.id));
    const alvo = PREFERENCIA_PADRAO.map((id) => dela.find((x) => x.tipo === "rodar" && (x.id.endsWith(`-${id}`) || x.id.includes(`-${id}-`)))?.id).find((x) => x !== undefined);
    padrao = alvo ?? dela.find((x) => x.tipo === "rodar")?.id ?? dela[0]?.id ?? null;
  }
  padrao ??= c.lista[0]?.id ?? null;
  let ferramentas: string[] = [];
  try { ferramentas = ferramentasMonorepo(leitor); } catch { /* cortesia */ }
  return {
    configuracoes: c.lista.slice(0, 40), corpos: c.corpos, ecossistemas: c.ecossistemas, padrao_sugerido: padrao,
    ...(pastas.length > 0 ? { pastas } : {}), ...(ferramentas.length > 0 ? { ferramentas } : {}),
  };
}

const GERENCIADORES_NODE = ["npm", "pnpm", "yarn", "bun"];

/**
 * Texto do que o comando REALMENTE dispara no repositório (script do package.json, receita do Makefile, conteúdo do script relativo):
 * entra no hash de confiança, então mudar o script depois de confiar pede nova confirmação, e aparece no diálogo.
 */
export function corpoDaConfig(raizLeitor: LeitorProjeto, cfg: Pick<ConfigExecucao, "executavel" | "argumentos" | "pre_passos" | "shell"> & { cwd?: string }): string | null {
  const partes: string[] = [];
  // scripts do package.json e alvos do Makefile são os da PASTA de execução; executável relativo (`./x`) é ancorado na raiz do workspace
  const leitor: LeitorProjeto = cfg.cwd === undefined || cfg.cwd === "." || cfg.cwd === "" ? raizLeitor : leitorEm(raizLeitor, cfg.cwd);
  const passos: PassoExecucao[] = [...cfg.pre_passos, { executavel: cfg.executavel, argumentos: cfg.argumentos }];
  let pkg: Record<string, unknown> | null | undefined;
  for (const p of passos) {
    if (cfg.shell !== null && p === passos[passos.length - 1]) continue;
    const nome = p.executavel.replace(/^.*\//, "");
    if (GERENCIADORES_NODE.includes(p.executavel) || GERENCIADORES_NODE.includes(nome)) {
      pkg ??= json(leitor.ler("package.json"));
      const alvo = p.argumentos[0] === "run" || p.argumentos[0] === "run-script" ? p.argumentos[1] : p.argumentos[0];
      const scripts = obj(pkg?.["scripts"]);
      if (alvo !== undefined && typeof scripts[alvo] === "string") {
        partes.push(`${alvo}: ${scripts[alvo] as string}`);
        for (const pre of [`pre${alvo}`, `post${alvo}`]) if (typeof scripts[pre] === "string") partes.push(`${pre}: ${scripts[pre] as string}`);
      }
    } else if (p.executavel === "make") {
      const arq = ["Makefile", "makefile", "GNUmakefile"].find((n) => leitor.existe(n));
      const receita = arq === undefined || p.argumentos[0] === undefined ? undefined : alvosDeMake(leitor.ler(arq) ?? "").get(p.argumentos[0]);
      if (receita !== undefined) partes.push(`make ${p.argumentos[0]}: ${receita}`);
    } else if (p.executavel.includes("/")) {
      const t = raizLeitor.ler(p.executavel.replace(/^\.\//, ""));
      if (t !== null) partes.push(`${p.executavel}: ${t.slice(0, 4_000)}`);
    }
  }
  return partes.length === 0 ? null : partes.join("\n").slice(0, 8_000);
}
