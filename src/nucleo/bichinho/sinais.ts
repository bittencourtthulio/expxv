// Sinais baratos e locais do projeto (D-462): arquivos-marca, extensões em pastas rasas e, se já indexado, o mapa de código (Fase 17).
// NUNCA lê arquivo de ambiente nem segredo, nunca desce além de 1 nível das pastas listadas e nunca conta mais de 600 itens.
// Caminhos sempre relativos. Funções puras sobre um `LeitorProjeto` (injetado: disco no main, objeto nos testes).

export type LinguagemId = "rust" | "python" | "go" | "javascript" | "typescript" | "java" | "kotlin" | "csharp" | "php" | "ruby" | "c" | "cpp" | "swift" | "dart" | "shell" | "hcl" | "markdown";
export type TipoProjeto = "web" | "api" | "cli" | "biblioteca" | "dados" | "mobile" | "infra" | "docs";

export interface LeitorProjeto {
  /** conteúdo (texto, até ~128 KB) ou `null`; o leitor real recusa arquivos de ambiente e segredos. */
  ler(rel: string): string | null;
  existe(rel: string): boolean;
  /** nomes dos itens de uma pasta relativa à raiz ("" = raiz); [] se não existe. */
  listar(rel: string): string[];
}

export interface SinaisProjeto {
  /** peso relativo: a dominante vale 1. Ordenado do maior para o menor. */
  linguagens: Array<{ id: LinguagemId; peso: number }>;
  frameworks: string[];
  /** `forca` 4 (indício) ou 12 (certeza); só dados, infra, docs e mobile mudam a espécie. */
  tipos: Array<{ tipo: TipoProjeto; forca: number; por: string }>;
}

const EXT: Record<string, LinguagemId> = {
  rs: "rust", py: "python", go: "go", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", mts: "typescript",
  java: "java", kt: "kotlin", kts: "kotlin", cs: "csharp", php: "php", rb: "ruby", c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", swift: "swift", dart: "dart",
  sh: "shell", tf: "hcl", md: "markdown", mdx: "markdown",
};

const NOMES_MAPA: Record<string, LinguagemId> = {
  rust: "rust", python: "python", go: "go", javascript: "javascript", typescript: "typescript", tsx: "typescript", java: "java", kotlin: "kotlin", "c#": "csharp", csharp: "csharp",
  php: "php", ruby: "ruby", c: "c", "c++": "cpp", cpp: "cpp", swift: "swift", dart: "dart", shell: "shell", bash: "shell", hcl: "hcl", terraform: "hcl", markdown: "markdown",
};

/** Arquivo-marca → linguagem e peso inicial (em "arquivos equivalentes"). */
const MARCAS: Array<[string, LinguagemId, number]> = [
  ["Cargo.toml", "rust", 8], ["pyproject.toml", "python", 8], ["requirements.txt", "python", 6], ["Pipfile", "python", 6], ["setup.py", "python", 6], ["go.mod", "go", 8],
  ["package.json", "javascript", 4], ["tsconfig.json", "typescript", 8], ["pom.xml", "java", 8], ["build.gradle", "java", 6], ["build.gradle.kts", "kotlin", 6],
  ["composer.json", "php", 8], ["Gemfile", "ruby", 8], ["CMakeLists.txt", "cpp", 6], ["Makefile", "c", 1], ["Package.swift", "swift", 8], ["pubspec.yaml", "dart", 8],
  ["main.tf", "hcl", 6], ["mkdocs.yml", "markdown", 6],
];

const PASTAS = ["", "src", "app", "lib", "cmd", "pkg", "internal", "docs", "notebooks", "infra", "terraform", "k8s", "android", "ios"];
const LIMITE_ITENS = 600;
/** Nomes que o leitor nunca abre nem conta: ambiente, chaves e credenciais. */
const SECRETO = /^\.env|\.pem$|\.key$|^id_(rsa|ed25519)|credential|secret/i;

const minusculo = (t: string): string => t.toLowerCase();
const extensao = (nome: string): string => (nome.lastIndexOf(".") > 0 ? minusculo(nome.slice(nome.lastIndexOf(".") + 1)) : "");

export const nomeSeguro = (nome: string): boolean => !SECRETO.test(nome);

function dependenciasNode(leitor: LeitorProjeto): { deps: Set<string>; bin: boolean; main: boolean } {
  const bruto = leitor.ler("package.json");
  const vazio = { deps: new Set<string>(), bin: false, main: false };
  if (bruto === null) return vazio;
  try {
    const j = JSON.parse(bruto) as Record<string, unknown>;
    const deps = new Set<string>();
    for (const k of ["dependencies", "devDependencies", "peerDependencies"]) {
      const o = j[k];
      if (typeof o === "object" && o !== null) for (const n of Object.keys(o)) deps.add(n);
    }
    return { deps, bin: j["bin"] !== undefined, main: j["main"] !== undefined || j["exports"] !== undefined };
  } catch {
    return vazio;
  }
}

/** Texto minúsculo concatenado de manifestos (só para casar palavras-chave de framework). */
function textoManifestos(leitor: LeitorProjeto, nomes: string[]): string {
  let t = "";
  for (const n of nomes) t += `\n${minusculo(leitor.ler(n) ?? "")}`;
  return t;
}

const FW_DADOS = ["PyTorch", "TensorFlow", "pandas", "NumPy", "scikit-learn", "Jupyter"];
const FW_MOBILE = ["React Native", "Expo", "Flutter", "Android"];
const FW_WEB = ["React", "Next.js", "Vue", "Svelte", "Angular"];
const FW_API = ["Express", "Fastify", "NestJS", "Django", "Flask", "FastAPI", "Spring", "Laravel", "Symfony"];

export function detectarSinais(leitor: LeitorProjeto, mapa?: ReadonlyArray<{ linguagem: string; arquivos: number; loc: number }>): SinaisProjeto {
  const pesos = new Map<LinguagemId, number>();
  const somar = (l: LinguagemId, n: number): void => void pesos.set(l, (pesos.get(l) ?? 0) + n);
  const nomesRaiz = leitor.listar("").filter(nomeSeguro);
  const raiz = new Set(nomesRaiz);

  for (const [arq, ling, p] of MARCAS) if (raiz.has(arq)) somar(ling, p);
  if (nomesRaiz.some((n) => /\.(csproj|sln|fsproj)$/.test(n))) somar("csharp", 8);
  if (nomesRaiz.some((n) => /\.xcodeproj$/.test(n))) somar("swift", 6);

  let itens = 0;
  let notebooks = 0;
  let temHtml = false;
  for (const pasta of PASTAS) {
    for (const nome of leitor.listar(pasta)) {
      if (itens++ >= LIMITE_ITENS) break;
      if (!nomeSeguro(nome) || nome === "node_modules" || nome === "target" || nome === ".git") continue;
      const e = extensao(nome);
      const l = EXT[e];
      if (l !== undefined) somar(l, 1);
      if (e === "ipynb") notebooks++;
      if (e === "html" && pasta === "") temHtml = true;
    }
  }

  // o mapa de código (Fase 17), se já indexado, é mais fiel que a contagem rasa: o LOC por linguagem substitui o peso
  if (mapa !== undefined && mapa.length > 0) {
    pesos.clear();
    for (const m of mapa) {
      const l = NOMES_MAPA[minusculo(m.linguagem)];
      if (l !== undefined) somar(l, Math.max(1, m.loc));
    }
  }

  const node = dependenciasNode(leitor);
  const py = textoManifestos(leitor, ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"]);
  const jvm = textoManifestos(leitor, ["pom.xml", "build.gradle", "build.gradle.kts"]);
  const php = textoManifestos(leitor, ["composer.json"]);
  const pub = textoManifestos(leitor, ["pubspec.yaml"]);
  const frameworks: string[] = [];
  const temF = (f: string): void => void (frameworks.includes(f) || frameworks.push(f));
  for (const [dep, rot] of [["react", "React"], ["next", "Next.js"], ["vue", "Vue"], ["svelte", "Svelte"], ["@angular/core", "Angular"], ["vite", "Vite"], ["express", "Express"], ["fastify", "Fastify"], ["@nestjs/core", "NestJS"], ["electron", "Electron"], ["react-native", "React Native"], ["expo", "Expo"]] as const) if (node.deps.has(dep)) temF(rot);
  for (const [palavra, rot] of [["django", "Django"], ["flask", "Flask"], ["fastapi", "FastAPI"], ["pandas", "pandas"], ["numpy", "NumPy"], ["torch", "PyTorch"], ["tensorflow", "TensorFlow"], ["scikit", "scikit-learn"], ["jupyter", "Jupyter"]] as const) if (py.includes(palavra)) temF(rot);
  if (jvm.includes("spring")) temF("Spring");
  if (jvm.includes("com.android") || jvm.includes("androidx")) temF("Android");
  if (php.includes("laravel")) temF("Laravel");
  else if (php.includes("symfony")) temF("Symfony");
  if (pub.includes("flutter")) temF("Flutter");

  const tipos: SinaisProjeto["tipos"] = [];
  const tipo = (t: TipoProjeto, forca: number, por: string): void => void tipos.push({ tipo: t, forca, por });
  const fwDados = frameworks.find((f) => FW_DADOS.includes(f));
  if (fwDados !== undefined) tipo("dados", 12, fwDados);
  else if (notebooks >= 2 || raiz.has("dbt_project.yml")) tipo("dados", 12, notebooks >= 2 ? "notebooks" : "dbt");
  else if (notebooks === 1) tipo("dados", 4, "notebook");
  const iac = (pesos.get("hcl") ?? 0) >= 2 || ["Chart.yaml", "Pulumi.yaml", "ansible.cfg", "kustomization.yaml"].some((n) => raiz.has(n));
  if (iac) tipo("infra", 12, raiz.has("Chart.yaml") ? "Helm" : raiz.has("Pulumi.yaml") ? "Pulumi" : raiz.has("ansible.cfg") ? "Ansible" : raiz.has("kustomization.yaml") ? "Kustomize" : "Terraform");
  else if (raiz.has("Dockerfile") && ["docker-compose.yml", "compose.yaml", "docker-compose.yaml"].some((n) => raiz.has(n))) tipo("infra", 4, "Docker Compose");
  const fwMobile = frameworks.find((f) => FW_MOBILE.includes(f));
  if (fwMobile !== undefined || raiz.has("Package.swift") || nomesRaiz.some((n) => /\.xcodeproj$/.test(n))) tipo("mobile", 12, fwMobile ?? "Swift/Xcode");
  const codigo = [...pesos.entries()].filter(([l]) => l !== "markdown").reduce((s, [, n]) => s + n, 0);
  const md = pesos.get("markdown") ?? 0;
  if (raiz.has("mkdocs.yml") || raiz.has("docusaurus.config.js") || (md >= 4 && md > codigo * 2)) tipo("docs", 12, "predomina Markdown");
  else if (md >= 4 && md > codigo) tipo("docs", 4, "muito Markdown");
  if (frameworks.some((f) => FW_WEB.includes(f)) || temHtml) tipo("web", 4, "interface web");
  if (frameworks.some((f) => FW_API.includes(f))) tipo("api", 4, "framework de servidor");
  if (node.bin || raiz.has("cmd")) tipo("cli", 4, "executável de linha de comando");
  else if (node.main) tipo("biblioteca", 4, "pacote reutilizável");

  const maior = Math.max(0, ...pesos.values());
  const linguagens = [...pesos.entries()]
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, peso: Math.round((n / maior) * 100) / 100 }))
    .sort((a, b) => b.peso - a.peso || (a.id < b.id ? -1 : 1));
  return { linguagens, frameworks, tipos };
}
