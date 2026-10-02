// Varredura BARATA de subpastas e de workspaces para a detecção de execução (D-580…). SÓ LEITURA, sem executar nada.
// Limites duros: profundidade ≤ 3, ≤ 400 entradas listadas, pastas de dependência/artefato/ocultas ignoradas. Puro: usa só `LeitorProjeto`.
import type { LeitorProjeto } from "./detectar";

export const LIMITES_VARREDURA = { profundidade: 3, entradas: 400, pacotes: 40 } as const;

/** Pastas que nunca são varridas (dependências, artefatos, caches, ambientes virtuais). Pasta oculta (`.x`) também nunca é. */
export const PASTAS_IGNORADAS: ReadonlySet<string> = new Set([
  "node_modules", "dist", "dist-app", "build", "out", "target", "vendor", ".venv", "venv", "env", "__pycache__", "coverage", "bower_components",
  "Pods", "obj", "bin", "site-packages", "tmp", "temp", "logs",
]);

const NOME_PASTA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

const MANIFESTOS = new Set([
  "package.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "setup.py", "manage.py", "Pipfile", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts",
  "pubspec.yaml", "deno.json", "deno.jsonc", "artisan", "Gemfile", "composer.json", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
  "Makefile", "makefile", "GNUmakefile", "justfile", "Justfile", "mvnw", "gradlew",
]);
const MANIFESTO_DOTNET = /\.(csproj|fsproj|sln|slnx)$/i;

/** A pasta tem algum manifesto de projeto? (`index.html` sozinho só conta nas pastas de 1º nível: site estático.) */
export function temManifesto(nomes: readonly string[], profundidade: number): boolean {
  if (nomes.some((n) => MANIFESTOS.has(n) || MANIFESTO_DOTNET.test(n))) return true;
  return profundidade === 1 && nomes.includes("index.html");
}

export interface PastaProjeto {
  /** caminho relativo à raiz com `/` (ex.: `desktop`, `packages/ui`) */
  pasta: string;
  profundidade: number;
}

const nomeVisivel = (n: string): boolean => NOME_PASTA.test(n) && !PASTAS_IGNORADAS.has(n);

/**
 * Subpastas com manifesto próprio, em largura (as mais rasas primeiro). Custo: no máximo `entradas` nomes listados; `listar` de uma pasta vazia ou de um
 * arquivo devolve `[]` e a entrada não é tratada como pasta.
 */
export function varrerPastas(l: LeitorProjeto, op: { profundidade?: number; entradas?: number } = {}): PastaProjeto[] {
  const maxProf = op.profundidade ?? LIMITES_VARREDURA.profundidade;
  let restante = op.entradas ?? LIMITES_VARREDURA.entradas;
  const achadas: PastaProjeto[] = [];
  const fila: Array<{ pasta: string; prof: number; nomes: string[] }> = [];
  try { fila.push({ pasta: ".", prof: 0, nomes: l.listar(".") }); } catch { return []; }
  for (let i = 0; i < fila.length && restante > 0; i += 1) {
    const atual = fila[i]!;
    if (atual.prof >= maxProf) continue;
    for (const nome of [...atual.nomes].sort()) {
      if (restante <= 0) break;
      restante -= 1;
      if (!nomeVisivel(nome)) continue;
      const caminho = atual.pasta === "." ? nome : `${atual.pasta}/${nome}`;
      let filhos: string[];
      try { filhos = l.listar(caminho); } catch { continue; }
      if (filhos.length === 0) continue;
      const prof = atual.prof + 1;
      if (temManifesto(filhos, prof)) achadas.push({ pasta: caminho, profundidade: prof });
      fila.push({ pasta: caminho, prof, nomes: filhos });
    }
  }
  return achadas;
}

// ---------------------------------------------------------------- workspaces
const json = (t: string | null): Record<string, unknown> | null => {
  if (t === null) return null;
  try { const v = JSON.parse(t) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
};

/** `packages:` do pnpm-workspace.yaml (lista simples; sem biblioteca de YAML). */
export function globsDoPnpm(yaml: string): string[] {
  const globs: string[] = [];
  let dentro = false;
  for (const linha of yaml.split(/\r?\n/)) {
    if (/^packages\s*:/.test(linha)) { dentro = true; continue; }
    if (!dentro) continue;
    if (/^\S/.test(linha) && linha.trim() !== "") break;
    const m = /^\s*-\s*["']?([^"'#\s]+)["']?/.exec(linha);
    if (m !== null) globs.push(m[1]!);
  }
  return globs;
}

/** Globs de workspaces declarados na raiz: campo `workspaces` (lista ou `{ packages }`) e `pnpm-workspace.yaml`. */
export function globsDeWorkspaces(l: LeitorProjeto): string[] {
  const globs: string[] = [];
  const pkg = json(l.ler("package.json"));
  const ws = pkg?.["workspaces"];
  if (Array.isArray(ws)) globs.push(...ws.filter((x): x is string => typeof x === "string"));
  else if (typeof ws === "object" && ws !== null && Array.isArray((ws as Record<string, unknown>)["packages"])) globs.push(...((ws as Record<string, unknown>)["packages"] as unknown[]).filter((x): x is string => typeof x === "string"));
  const pnpm = l.ler("pnpm-workspace.yaml");
  if (pnpm !== null) globs.push(...globsDoPnpm(pnpm));
  const lerna = json(l.ler("lerna.json"));
  if (Array.isArray(lerna?.["packages"])) globs.push(...(lerna!["packages"] as unknown[]).filter((x): x is string => typeof x === "string"));
  return globs.slice(0, 40);
}

/** Pastas de pacotes (com `package.json`) que os globs `dir/*`, `dir/**` ou caminho exato apontam. Nada de `..`, absoluto nem curinga no meio. */
export function pacotesDosGlobs(l: LeitorProjeto, globs: readonly string[]): string[] {
  const achados: string[] = [];
  for (const bruto of globs) {
    if (bruto.startsWith("!")) continue;
    const g = bruto.replace(/^\.\//, "").replace(/\/+$/, "");
    if (g === "" || g.startsWith("/") || g.includes("..") || g.includes("\\")) continue;
    const base = g.replace(/\/\*\*?$/, "");
    const caminhos: string[] = [];
    if (base !== g) {
      if (base.includes("*") || base.split("/").some((p) => !nomeVisivel(p))) continue;
      for (const n of l.listar(base).sort()) if (nomeVisivel(n)) caminhos.push(`${base}/${n}`);
    } else if (!g.includes("*") && g.split("/").every(nomeVisivel)) caminhos.push(g);
    for (const c of caminhos) if (l.existe(`${c}/package.json`) && !achados.includes(c)) achados.push(c);
    if (achados.length >= LIMITES_VARREDURA.pacotes) break;
  }
  return achados.slice(0, LIMITES_VARREDURA.pacotes);
}

/** Ferramentas de monorepo presentes na raiz (rótulos curtos para o dossiê e o aviso). */
export function ferramentasMonorepo(l: LeitorProjeto): string[] {
  const f: string[] = [];
  if (l.existe("turbo.json")) f.push("turbo");
  if (l.existe("nx.json")) f.push("nx");
  if (l.existe("lerna.json")) f.push("lerna");
  if (l.existe("pnpm-workspace.yaml")) f.push("pnpm-workspaces");
  else if (globsDeWorkspaces(l).length > 0) f.push("workspaces");
  return f;
}
