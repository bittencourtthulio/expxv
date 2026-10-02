import { LineCounter, parseDocument, isMap, isSeq, isScalar } from "yaml";
import { lerToml, type ValorToml } from "./toml-minimo";
import type { SubtipoExterno } from "./tipos";

// Manifestos e locks (T-17.15). ESTÁTICO: só lê texto; nenhum manifesto é executado e configs em JS
// (`webpack.config.js`, `.dependency-cruiser.js`…) NÃO são avaliadas (viram lacuna com aviso). Manifesto malformado
// vira lacuna, nunca exceção. Caminhos são relativos à raiz do workspace, com `/`.

export interface DepManifesto {
  nome: string;
  versao: string | null;
  /** Versão exata do lock, quando houver (`aplicarLocks`). */
  versao_lock: string | null;
  dev: boolean;
  eco: SubtipoExterno;
  linha: number;
}

export interface ComandoManifesto {
  nome: string;
  comando: string;
  arquivo: string;
  linha: number;
}

export interface MapeamentoPsr4 {
  prefixo: string;
  /** Pasta relativa à raiz do workspace (sem `/` final). */
  pasta: string;
  dev: boolean;
}

export interface Manifesto {
  /** Caminho do arquivo (relativo à raiz). */
  arquivo: string;
  tipo: string;
  eco: SubtipoExterno | null;
  /** Pasta do manifesto (`""` = raiz). */
  pasta: string;
  nome: string | null;
  deps: DepManifesto[];
  comandos: ComandoManifesto[];
  /** Subprojetos/membros (workspaces, módulos Maven/Gradle, `.csproj` de uma `.sln`, membros do Cargo). Relativos à raiz. */
  modulos: string[];
  /** `ProjectReference` (.csproj) resolvidos para caminhos relativos à raiz. */
  referencias: string[];
  main: string | null;
  bin: string[];
  /** Alvos de `exports` (package.json), achatados. */
  exports_alvos: string[];
  psr4: MapeamentoPsr4[];
  /** `classmap`/`files` do composer (relativos à raiz). */
  classmap: string[];
  /** `module` do go.mod e `replace` locais (`from` => pasta relativa à raiz). */
  go_modulo: string | null;
  go_replaces: Array<{ de: string; para: string }>;
  /** Raízes de busca de módulos Python declaradas (`packages from`, `where`). */
  raizes_python: string[];
  lacunas: string[];
}

function base(caminho: string): string {
  return caminho.slice(caminho.lastIndexOf("/") + 1);
}
function pastaDe(caminho: string): string {
  const i = caminho.lastIndexOf("/");
  return i < 0 ? "" : caminho.slice(0, i);
}
function juntar(pasta: string, rel: string): string | null {
  const partes = pasta === "" ? [] : pasta.split("/");
  for (const p of rel.replace(/\\/g, "/").split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (partes.length === 0) return null; // escapa da raiz
      partes.pop();
    } else partes.push(p);
  }
  return partes.join("/");
}
function novo(arquivo: string, tipo: string, eco: SubtipoExterno | null): Manifesto {
  return {
    arquivo, tipo, eco, pasta: pastaDe(arquivo), nome: null, deps: [], comandos: [], modulos: [], referencias: [], main: null, bin: [],
    exports_alvos: [], psr4: [], classmap: [], go_modulo: null, go_replaces: [], raizes_python: [], lacunas: [],
  };
}
function linhaDoIndice(texto: string, indice: number): number {
  let n = 1;
  for (let i = 0; i < indice && i < texto.length; i++) if (texto.charCodeAt(i) === 10) n++;
  return n;
}
/** Linha (1-based) da primeira ocorrência de `agulha` a partir da linha `desde` (1-based); `fallback` se não achar. */
function acharLinha(linhas: readonly string[], agulha: string, desde = 1, fallback = 1): number {
  for (let i = desde - 1; i < linhas.length; i++) if ((linhas[i] as string).includes(agulha)) return i + 1;
  return fallback;
}
function dep(nome: string, versao: string | null, dev: boolean, eco: SubtipoExterno, linha: number): DepManifesto {
  return { nome, versao, versao_lock: null, dev, eco, linha };
}

export const CONFIGS_JS_NAO_LIDAS: readonly RegExp[] = [
  /(^|\/)webpack\.config\.[cm]?js$/, /(^|\/)\.dependency-cruiser\.[cm]?js$/, /(^|\/)(rollup|vite|jest|babel|eslint|gulpfile)(\.config)?\.[cm]?js$/, /(^|\/)gruntfile\.js$/i,
];

export function avisoConfigJs(caminho: string): string | null {
  return CONFIGS_JS_NAO_LIDAS.some((r) => r.test(caminho)) ? `${caminho}: não lida: executaria código do projeto` : null;
}

// ------------------------------------------------------------------ package.json

function achatarExports(v: unknown, saida: string[]): void {
  if (typeof v === "string") saida.push(v);
  else if (Array.isArray(v)) for (const x of v) achatarExports(x, saida);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) achatarExports(x, saida);
}

function lerPackageJson(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "package.json", "npm");
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(texto) as Record<string, unknown>;
    if (j === null || typeof j !== "object" || Array.isArray(j)) throw new Error("não é objeto");
  } catch (e) {
    m.lacunas.push(`${arquivo}: JSON inválido (${(e as Error).message})`);
    return m;
  }
  const linhas = texto.split("\n");
  if (typeof j.name === "string") m.nome = j.name;
  const secao = (chave: string, dev: boolean): void => {
    const obj = j[chave];
    if (obj === null || typeof obj !== "object") return;
    const ini = acharLinha(linhas, `"${chave}"`);
    for (const [nome, v] of Object.entries(obj as Record<string, unknown>))
      m.deps.push(dep(nome, typeof v === "string" ? v : null, dev, "npm", acharLinha(linhas, `"${nome}"`, ini, ini)));
  };
  secao("dependencies", false);
  secao("optionalDependencies", false);
  secao("peerDependencies", false);
  secao("devDependencies", true);
  if (j.scripts !== null && typeof j.scripts === "object") {
    const ini = acharLinha(linhas, '"scripts"');
    for (const [nome, v] of Object.entries(j.scripts as Record<string, unknown>))
      if (typeof v === "string") m.comandos.push({ nome, comando: v, arquivo, linha: acharLinha(linhas, `"${nome}"`, ini, ini) });
  }
  if (typeof j.main === "string") m.main = j.main;
  else if (typeof j.module === "string") m.main = j.module;
  if (typeof j.bin === "string") m.bin.push(j.bin);
  else if (j.bin !== null && typeof j.bin === "object") for (const v of Object.values(j.bin)) if (typeof v === "string") m.bin.push(v);
  achatarExports(j.exports, m.exports_alvos);
  const ws = Array.isArray(j.workspaces) ? j.workspaces : (j.workspaces as { packages?: unknown } | undefined)?.packages;
  if (Array.isArray(ws)) for (const w of ws) if (typeof w === "string") m.modulos.push(w);
  return m;
}

// ------------------------------------------------------------------ composer.json

function lerComposer(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "composer.json", "composer");
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(texto) as Record<string, unknown>;
    if (j === null || typeof j !== "object" || Array.isArray(j)) throw new Error("não é objeto");
  } catch (e) {
    m.lacunas.push(`${arquivo}: JSON inválido (${(e as Error).message})`);
    return m;
  }
  const linhas = texto.split("\n");
  if (typeof j.name === "string") m.nome = j.name;
  for (const [chave, dev] of [["require", false], ["require-dev", true]] as const) {
    const obj = j[chave];
    if (obj === null || typeof obj !== "object") continue;
    const ini = acharLinha(linhas, `"${chave}"`);
    for (const [nome, v] of Object.entries(obj as Record<string, unknown>)) {
      if (nome === "php" || nome.startsWith("ext-") || nome.startsWith("lib-")) continue;
      m.deps.push(dep(nome, typeof v === "string" ? v : null, dev, "composer", acharLinha(linhas, `"${nome}"`, ini, ini)));
    }
  }
  for (const [chave, dev] of [["autoload", false], ["autoload-dev", true]] as const) {
    const a = j[chave] as Record<string, unknown> | undefined;
    if (a === undefined || a === null || typeof a !== "object") continue;
    const p4 = a["psr-4"];
    if (p4 !== null && typeof p4 === "object") {
      for (const [prefixo, destino] of Object.entries(p4 as Record<string, unknown>)) {
        for (const d of Array.isArray(destino) ? destino : [destino]) {
          if (typeof d !== "string") continue;
          const pasta = juntar(m.pasta, d);
          if (pasta !== null) m.psr4.push({ prefixo, pasta, dev });
        }
      }
    }
    for (const k of ["classmap", "files"]) {
      const lista = a[k];
      if (Array.isArray(lista)) for (const d of lista) if (typeof d === "string") { const p = juntar(m.pasta, d); if (p !== null) m.classmap.push(p); }
    }
  }
  if (j.scripts !== null && typeof j.scripts === "object") {
    const ini = acharLinha(linhas, '"scripts"');
    for (const [nome, v] of Object.entries(j.scripts as Record<string, unknown>)) {
      const cmd = typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" && ") : null;
      if (cmd !== null) m.comandos.push({ nome, comando: cmd, arquivo, linha: acharLinha(linhas, `"${nome}"`, ini, ini) });
    }
  }
  return m;
}

// ------------------------------------------------------------------ pom.xml / gradle

function lerPom(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "pom.xml", "maven");
  const semDeps = texto.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, (s) => " ".repeat(s.length));
  const topo = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(semDeps.replace(/<parent>[\s\S]*?<\/parent>/, (s) => " ".repeat(s.length)).replace(/<dependencies>[\s\S]*?<\/dependencies>/g, (s) => " ".repeat(s.length)));
  if (topo) m.nome = topo[1] as string;
  for (const d of semDeps.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const corpo = d[1] as string;
    const g = /<groupId>\s*([^<\s]+)/.exec(corpo)?.[1];
    const a = /<artifactId>\s*([^<\s]+)/.exec(corpo)?.[1];
    if (a === undefined) continue;
    const v = /<version>\s*([^<\s]+)/.exec(corpo)?.[1] ?? null;
    const escopo = /<scope>\s*([^<\s]+)/.exec(corpo)?.[1];
    m.deps.push(dep(g === undefined ? a : `${g}:${a}`, v, escopo === "test", "maven", linhaDoIndice(texto, d.index ?? 0)));
  }
  for (const mod of texto.matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)) {
    const p = juntar(m.pasta, mod[1] as string);
    if (p !== null) m.modulos.push(p);
  }
  return m;
}

const CONFIG_GRADLE = /\b(implementation|api|compile|compileOnly|runtimeOnly|testImplementation|testCompile|testRuntimeOnly|kapt|annotationProcessor|classpath)\s*\(?\s*(?:platform\()?['"]([^'":\s]+):([^'":\s]+)(?::([^'"\s]+))?['"]/g;

function lerGradle(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "gradle", "maven");
  for (const x of texto.matchAll(CONFIG_GRADLE))
    m.deps.push(dep(`${x[2]}:${x[3]}`, x[4] ?? null, /^test/i.test(x[1] as string), "maven", linhaDoIndice(texto, x.index ?? 0)));
  if (/settings\.gradle/.test(arquivo)) {
    for (const inc of texto.matchAll(/\binclude\s*\(?([^)\n]+)/g))
      for (const s of (inc[1] as string).matchAll(/['"]:?([^'"]+)['"]/g)) {
        const p = juntar(m.pasta, (s[1] as string).replace(/:/g, "/"));
        if (p !== null) m.modulos.push(p);
      }
  }
  return m;
}

// ------------------------------------------------------------------ .NET

function lerCsproj(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "csproj", "nuget");
  m.nome = base(arquivo).replace(/\.[a-z]+$/i, "");
  for (const x of texto.matchAll(/<PackageReference\s+[^>]*?Include\s*=\s*"([^"]+)"(?:[^>]*?Version\s*=\s*"([^"]+)")?/g))
    m.deps.push(dep(x[1] as string, x[2] ?? null, false, "nuget", linhaDoIndice(texto, x.index ?? 0)));
  for (const x of texto.matchAll(/<ProjectReference\s+[^>]*?Include\s*=\s*"([^"]+)"/g)) {
    const p = juntar(m.pasta, x[1] as string);
    if (p !== null) m.referencias.push(p);
    else m.lacunas.push(`${arquivo}: ProjectReference fora da raiz recusada`);
  }
  return m;
}

function lerSln(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "sln", "nuget");
  for (const x of texto.matchAll(/^Project\("[^"]*"\)\s*=\s*"[^"]*",\s*"([^"]+\.(?:csproj|vbproj|fsproj))"/gim)) {
    const p = juntar(m.pasta, x[1] as string);
    if (p !== null) m.modulos.push(p);
  }
  return m;
}

// ------------------------------------------------------------------ go.mod

function lerGoMod(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "go.mod", "go");
  const linhas = texto.split("\n");
  let bloco: string | null = null;
  linhas.forEach((cru, i) => {
    const l = cru.replace(/\/\/(?! indirect).*$/, "").trim();
    if (l === "" || l.startsWith("//")) return;
    if (bloco !== null) {
      if (l === ")") { bloco = null; return; }
      tratar(bloco, l, i + 1);
      return;
    }
    const mm = /^(module|require|replace|exclude|retract|go|toolchain)\s*(\(|.*)$/.exec(l);
    if (!mm) return;
    if (mm[2] === "(") bloco = mm[1] as string;
    else tratar(mm[1] as string, (mm[2] as string).trim(), i + 1);
  });
  function tratar(dir: string, resto: string, linha: number): void {
    if (dir === "module") m.go_modulo = resto.replace(/^"|"$/g, "");
    else if (dir === "require") {
      const p = resto.split(/\s+/);
      if (p.length >= 2) m.deps.push(dep(p[0] as string, p[1] as string, false, "go", linha));
    } else if (dir === "replace") {
      const mm = /^(\S+)(?:\s+\S+)?\s+=>\s+(\S+)/.exec(resto);
      if (mm && /^(\.|\/)/.test(mm[2] as string)) {
        const p = juntar(m.pasta, mm[2] as string);
        if (p !== null) m.go_replaces.push({ de: mm[1] as string, para: p });
      }
    }
  }
  m.nome = m.go_modulo;
  return m;
}

// ------------------------------------------------------------------ Cargo / pyproject / requirements / setup.cfg

function str(v: ValorToml | undefined): string | null {
  return typeof v === "string" ? v : null;
}
function obj(v: ValorToml | undefined): Record<string, ValorToml> | null {
  return v !== undefined && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function lerCargo(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "Cargo.toml", "cargo");
  const t = lerToml(texto);
  m.lacunas.push(...t.lacunas.map((l) => `${arquivo}: ${l}`));
  m.nome = str(obj(t.valor.package)?.name);
  for (const [chave, dev] of [["dependencies", false], ["build-dependencies", false], ["dev-dependencies", true]] as const) {
    const d = obj(t.valor[chave]);
    if (d === null) continue;
    for (const [nome, v] of Object.entries(d)) {
      const versao = typeof v === "string" ? v : str(obj(v)?.version);
      m.deps.push(dep(nome, versao, dev, "cargo", t.linhas.get(`${chave}.${nome}`) ?? 1));
    }
  }
  const ws = obj(t.valor.workspace);
  if (ws !== null && Array.isArray(ws.members))
    for (const w of ws.members) if (typeof w === "string") { const p = juntar(m.pasta, w); if (p !== null) m.modulos.push(p); }
  return m;
}

function nomeReq(spec: string): { nome: string; versao: string | null } | null {
  const mm = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*((?:[<>=!~]=?|===)[^;#\s]*(?:\s*,\s*[<>=!~]=?[^;#\s]*)*)?/.exec(spec);
  return mm ? { nome: (mm[1] as string).toLowerCase().replace(/_/g, "-"), versao: mm[2] === undefined || mm[2] === "" ? null : mm[2] } : null;
}

function lerPyproject(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "pyproject.toml", "pip");
  const t = lerToml(texto);
  m.lacunas.push(...t.lacunas.map((l) => `${arquivo}: ${l}`));
  const proj = obj(t.valor.project);
  m.nome = str(proj?.name);
  const addLista = (lista: ValorToml | undefined, dev: boolean, linha: number): void => {
    if (!Array.isArray(lista)) return;
    for (const s of lista) {
      if (typeof s !== "string") continue;
      const r = nomeReq(s);
      if (r) m.deps.push(dep(r.nome, r.versao, dev, "pip", linha));
    }
  };
  addLista(proj?.dependencies, false, t.linhas.get("project.dependencies") ?? 1);
  const opt = obj(proj?.["optional-dependencies"]);
  if (opt) for (const [g, l] of Object.entries(opt)) addLista(l, true, t.linhas.get(`project.optional-dependencies.${g}`) ?? 1);
  const poetry = obj(obj(t.valor.tool)?.poetry);
  const poetryDeps = (d: Record<string, ValorToml> | null, dev: boolean, pref: string): void => {
    if (d === null) return;
    for (const [nome, v] of Object.entries(d)) {
      if (nome === "python") continue;
      m.deps.push(dep(nome.toLowerCase().replace(/_/g, "-"), typeof v === "string" ? v : str(obj(v)?.version), dev, "pip", t.linhas.get(`${pref}.${nome}`) ?? 1));
    }
  };
  poetryDeps(obj(poetry?.dependencies), false, "tool.poetry.dependencies");
  poetryDeps(obj(poetry?.["dev-dependencies"]), true, "tool.poetry.dev-dependencies");
  const grupos = obj(poetry?.group);
  if (grupos) for (const [g, v] of Object.entries(grupos)) poetryDeps(obj(obj(v)?.dependencies), g !== "main", `tool.poetry.group.${g}.dependencies`);
  m.nome = m.nome ?? str(poetry?.name);
  for (const [pref, scripts] of [["project.scripts", obj(proj?.scripts)], ["tool.poetry.scripts", obj(poetry?.scripts)]] as const)
    if (scripts) for (const [nome, v] of Object.entries(scripts)) if (typeof v === "string") m.comandos.push({ nome, comando: v, arquivo, linha: t.linhas.get(`${pref}.${nome}`) ?? 1 });
  if (poetry && Array.isArray(poetry.packages))
    for (const p of poetry.packages) {
      const from = str(obj(p)?.from);
      const r = juntar(m.pasta, from ?? "");
      if (r !== null && !m.raizes_python.includes(r)) m.raizes_python.push(r);
    }
  const find = obj(obj(obj(obj(t.valor.tool)?.setuptools)?.packages)?.find);
  const where = find?.where;
  if (Array.isArray(where)) for (const w of where) if (typeof w === "string") { const r = juntar(m.pasta, w); if (r !== null) m.raizes_python.push(r); }
  return m;
}

function lerRequirements(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "requirements", "pip");
  const dev = /dev|test/i.test(base(arquivo));
  texto.split("\n").forEach((cru, i) => {
    const l = cru.replace(/\s#.*$/, "").trim();
    if (l === "" || l.startsWith("#") || l.startsWith("-") || /^(git\+|https?:|\.|\/)/.test(l)) return;
    const r = nomeReq(l);
    if (r) m.deps.push(dep(r.nome, r.versao, dev, "pip", i + 1));
  });
  return m;
}

function lerSetupCfg(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "setup.cfg", "pip");
  const linhas = texto.split("\n");
  let secao = "";
  let chave = "";
  linhas.forEach((cru, i) => {
    const s = /^\[([^\]]+)\]/.exec(cru);
    if (s) { secao = s[1] as string; chave = ""; return; }
    const kv = /^([A-Za-z_]+)\s*=\s*(.*)$/.exec(cru);
    if (kv) { chave = kv[1] as string; if (secao === "options" && chave === "install_requires" && (kv[2] as string).trim() !== "") add(kv[2] as string, i + 1); if (secao === "options.packages.find" && chave === "where") { const r = juntar(m.pasta, (kv[2] as string).trim()); if (r !== null) m.raizes_python.push(r); } return; }
    if (/^\s+\S/.test(cru) && secao === "options" && chave === "install_requires") add(cru, i + 1);
  });
  function add(spec: string, linha: number): void {
    const r = nomeReq(spec);
    if (r) m.deps.push(dep(r.nome, r.versao, false, "pip", linha));
  }
  return m;
}

// ------------------------------------------------------------------ Gemfile / Makefile / workflows

function lerGemfile(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "Gemfile", "gem");
  const pilha: boolean[] = [];
  texto.split("\n").forEach((cru, i) => {
    const l = cru.trim();
    if (l.startsWith("#")) return;
    const g = /^group\s+(.+?)\s+do\b/.exec(l);
    if (g) { pilha.push(/:(development|test)/.test(g[1] as string)); return; }
    if (/\bdo\s*$/.test(l)) { pilha.push(false); return; }
    if (l === "end") { pilha.pop(); return; }
    const gm = /^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?(.*)$/.exec(l);
    if (gm) {
      const devInline = /group:\s*\[?\s*:(development|test)/.test(gm[3] as string);
      m.deps.push(dep(gm[1] as string, gm[2] ?? null, devInline || pilha.some(Boolean), "gem", i + 1));
    }
  });
  return m;
}

const ALVO_ESPECIAL = new Set([".PHONY", ".DEFAULT", ".SUFFIXES", ".PRECIOUS", ".SECONDARY", ".INTERMEDIATE", ".DELETE_ON_ERROR", ".ONESHELL", ".SILENT"]);

function lerMakefile(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "Makefile", null);
  const linhas = texto.split("\n");
  for (let i = 0; i < linhas.length; i++) {
    const mm = /^([A-Za-z0-9_][A-Za-z0-9_.\-/]*)\s*:(?![=:])/.exec(linhas[i] as string);
    if (!mm || ALVO_ESPECIAL.has(mm[1] as string)) continue;
    let cmd = "";
    for (let j = i + 1; j < linhas.length && /^\t/.test(linhas[j] as string); j++) { cmd = (linhas[j] as string).trim().replace(/^[@-]+/, ""); break; }
    m.comandos.push({ nome: mm[1] as string, comando: cmd, arquivo, linha: i + 1 });
  }
  return m;
}

function lerWorkflow(arquivo: string, texto: string): Manifesto {
  const m = novo(arquivo, "workflow", null);
  const lc = new LineCounter();
  try {
    const doc = parseDocument(texto, { lineCounter: lc });
    const jobs = doc.get("jobs", true);
    if (isMap(jobs)) {
      for (const par of jobs.items) {
        const nomeJob = isScalar(par.key) ? String(par.key.value) : "?";
        const job = par.value;
        if (!isMap(job)) continue;
        const steps = job.get("steps", true);
        if (!isSeq(steps)) continue;
        steps.items.forEach((st, idx) => {
          if (!isMap(st)) return;
          const run = st.get("run", true);
          if (!isScalar(run) || typeof run.value !== "string") return;
          const nome = st.get("name");
          const linha = run.range ? lc.linePos(run.range[0]).line : 1;
          m.comandos.push({ nome: `${nomeJob}/${typeof nome === "string" ? nome : String(idx + 1)}`, comando: run.value.trim().split("\n")[0] as string, arquivo, linha });
        });
      }
    }
  } catch (e) {
    m.lacunas.push(`${arquivo}: YAML inválido (${(e as Error).message})`);
  }
  return m;
}

// ------------------------------------------------------------------ despacho

/** `true` se o caminho é um manifesto reconhecido (ou uma config JS que será ignorada com aviso). */
export function ehManifesto(caminho: string): boolean {
  return tipoDeManifesto(caminho) !== null;
}

type Leitor = (arquivo: string, texto: string) => Manifesto;

function tipoDeManifesto(caminho: string): Leitor | "config_js" | null {
  const b = base(caminho);
  if (b === "package.json") return lerPackageJson;
  if (b === "composer.json") return lerComposer;
  if (b === "pom.xml") return lerPom;
  if (/^(build|settings)\.gradle(\.kts)?$/.test(b)) return lerGradle;
  if (/\.(cs|vb|fs)proj$/i.test(b)) return lerCsproj;
  if (/\.sln$/i.test(b)) return lerSln;
  if (b === "go.mod") return lerGoMod;
  if (b === "Cargo.toml") return lerCargo;
  if (b === "pyproject.toml") return lerPyproject;
  if (/^requirements[\w.-]*\.txt$/.test(b)) return lerRequirements;
  if (b === "setup.cfg") return lerSetupCfg;
  if (b === "Gemfile") return lerGemfile;
  if (b === "Makefile" || b === "makefile" || b === "GNUmakefile") return lerMakefile;
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(caminho)) return lerWorkflow;
  if (avisoConfigJs(caminho) !== null) return "config_js";
  return null;
}

/** Lê um manifesto estático. `null` se o arquivo não é um manifesto. Nunca lança. */
export function lerManifesto(caminho: string, texto: string): Manifesto | null {
  const leitor = tipoDeManifesto(caminho);
  if (leitor === null) return null;
  if (leitor === "config_js") {
    const m = novo(caminho, "config_js", null);
    m.lacunas.push(avisoConfigJs(caminho) as string);
    return m;
  }
  try {
    return leitor(caminho, texto);
  } catch (e) {
    const m = novo(caminho, "invalido", null);
    m.lacunas.push(`${caminho}: não foi possível ler (${(e as Error).message})`);
    return m;
  }
}

// ------------------------------------------------------------------ locks

export interface Lock {
  arquivo: string;
  eco: SubtipoExterno;
  /** nome -> versão exata (a primeira encontrada quando há várias). */
  versoes: Map<string, string>;
}

export function ehLock(caminho: string): boolean {
  return /^(package-lock\.json|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|poetry\.lock)$/.test(base(caminho));
}

export function lerLock(caminho: string, texto: string): Lock | null {
  const b = base(caminho);
  const versoes = new Map<string, string>();
  const poe = (n: string, v: string): void => {
    if (!versoes.has(n)) versoes.set(n, v);
  };
  try {
    if (b === "package-lock.json") {
      const j = JSON.parse(texto) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
      for (const [k, v] of Object.entries(j.packages ?? {})) {
        const i = k.lastIndexOf("node_modules/");
        if (i >= 0 && v.version !== undefined) poe(k.slice(i + 13), v.version);
      }
      for (const [k, v] of Object.entries(j.dependencies ?? {})) if (v.version !== undefined) poe(k, v.version);
      return { arquivo: caminho, eco: "npm", versoes };
    }
    if (b === "pnpm-lock.yaml") {
      const doc = parseDocument(texto).toJS() as { packages?: Record<string, unknown>; importers?: Record<string, { dependencies?: Record<string, { version?: string } | string> }> } | null;
      for (const k of Object.keys(doc?.packages ?? {})) {
        const mm = /^\/?(@?[^@]+)@([^(]+)/.exec(k);
        if (mm) poe(mm[1] as string, mm[2] as string);
      }
      return { arquivo: caminho, eco: "npm", versoes };
    }
    if (b === "composer.lock") {
      const j = JSON.parse(texto) as { packages?: Array<{ name: string; version: string }>; "packages-dev"?: Array<{ name: string; version: string }> };
      for (const p of [...(j.packages ?? []), ...(j["packages-dev"] ?? [])]) poe(p.name, p.version.replace(/^v/, ""));
      return { arquivo: caminho, eco: "composer", versoes };
    }
    if (b === "Cargo.lock" || b === "poetry.lock") {
      const t = lerToml(texto).valor.package;
      if (Array.isArray(t)) for (const p of t) { const o = obj(p); const n = str(o?.name); const v = str(o?.version); if (n && v) poe(b === "poetry.lock" ? n.toLowerCase().replace(/_/g, "-") : n, v); }
      return { arquivo: caminho, eco: b === "Cargo.lock" ? "cargo" : "pip", versoes };
    }
    if (b === "go.sum") {
      for (const l of texto.split("\n")) {
        const p = l.trim().split(/\s+/);
        if (p.length >= 2 && !(p[1] as string).endsWith("/go.mod")) poe(p[0] as string, p[1] as string);
      }
      return { arquivo: caminho, eco: "go", versoes };
    }
    if (b === "Gemfile.lock") {
      for (const l of texto.split("\n")) {
        const mm = /^ {4}([A-Za-z0-9_.-]+) \(([^)-]+)/.exec(l);
        if (mm) poe(mm[1] as string, mm[2] as string);
      }
      return { arquivo: caminho, eco: "gem", versoes };
    }
  } catch {
    return { arquivo: caminho, eco: "npm", versoes: new Map() };
  }
  return null;
}

/** Copia a versão exata dos locks para `versao_lock` das dependências (mesmo ecossistema). */
export function aplicarLocks(manifestos: readonly Manifesto[], locks: readonly Lock[]): void {
  for (const m of manifestos)
    for (const d of m.deps) {
      const lock = locks.find((l) => l.eco === d.eco && l.versoes.has(d.nome));
      if (lock) d.versao_lock = lock.versoes.get(d.nome) as string;
    }
}
