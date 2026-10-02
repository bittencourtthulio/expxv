// Dossiê DETERMINÍSTICO, mínimo e limitado que o assistente de execução envia à CLI do usuário (D-583). SÓ LEITURA do projeto.
// Contém: árvore de caminhos (≤ 300 itens, profundidade ≤ 3), trechos de até 12 manifestos/arquivos de configuração (≤ 6 KB cada, reduzidos quando
// há estrutura conhecida), início do README (≤ 3 KB), alvos de Makefile/justfile, scripts do package.json, serviços do compose e a detecção determinística
// como PISTA. NUNCA: arquivo de ambiente, chave, credencial, `.git`, lockfile, binário (nem o NOME dos sensíveis). Tudo passa pela redação injetada.
import { createHash } from "node:crypto";
import { alvosDeMake, type LeitorProjeto, type ResultadoDeteccao } from "../detectar";
import { comandoEmTexto } from "../hash";
import { PASTAS_IGNORADAS } from "../monorepo";
import { ehArquivoInutil, ehArquivoSensivel, nomeSeguroParaPrompt, pastaOmitida } from "./sensiveis";

export const LIMITES_DOSSIE = {
  arvore_itens: 300,
  arvore_profundidade: 3,
  /** nomes examinados na varredura (custo de E/S limitado, mesmo em repositório gigante) */
  varredura_entradas: 1_500,
  manifestos: 12,
  manifesto_bytes: 6 * 1024,
  /** teto da seção inteira de manifestos: README e pista nunca ficam de fora por causa deles */
  manifestos_total_bytes: 40 * 1024,
  readme_bytes: 3 * 1024,
  total_bytes: 64 * 1024,
  alvos_make: 40,
  servicos_compose: 20,
  pistas: 40,
} as const;

export interface Dossie {
  /** texto de DADOS (sem delimitadores; o prompt os coloca com marca aleatória) */
  texto: string;
  /** hash do texto: o consentimento do usuário vale só para este conteúdo */
  hash: string;
  /** arquivos cujo trecho está no texto (relativos à raiz) */
  arquivos: string[];
  itens_arvore: number;
  bytes: number;
  tokens_estimados: number;
  omitidos_sensiveis: number;
}

export interface OpcoesDossie {
  /** redação de segredos (cofre + padrões); aplicada a CADA trecho e ao texto final */
  redigir: (texto: string) => string;
  deteccao: ResultadoDeteccao;
}

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const DELIMITADORES = /(<{3,}|>{3,}|DADOS-[A-Za-z0-9]+)/g;

/** Limpa o que pode quebrar o prompt: ANSI, controle e sequências que imitam o delimitador de dados. */
export function sanear(texto: string): string {
  return texto.replace(ANSI, "").replace(CONTROLE, "").replace(DELIMITADORES, (m) => (m.startsWith("DADOS") ? "dados" : "‹‹‹"));
}

const cortar = (t: string, max: number): string => (Buffer.byteLength(t) <= max ? t : `${Buffer.from(t).subarray(0, max).toString("utf8").replace(/�+$/, "")}\n[… cortado]`);
const json = (t: string | null): Record<string, unknown> | null => {
  if (t === null) return null;
  try { const v = JSON.parse(t) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
};
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// ---------------------------------------------------------------- manifestos
const NOMES_MANIFESTO = new Set([
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "pubspec.yaml", "deno.json", "deno.jsonc",
  "composer.json", "Gemfile", "requirements.txt", "Pipfile", "setup.py", "Makefile", "makefile", "GNUmakefile", "justfile", "Justfile", "Dockerfile", "Procfile",
  "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "turbo.json", "nx.json", "lerna.json", "pnpm-workspace.yaml", "manage.py", "artisan",
]);
const PRIORIDADE = ["package.json", "pyproject.toml", "Makefile", "makefile", "justfile", "Justfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "pubspec.yaml", "deno.json", "composer.json", "Gemfile", "turbo.json", "nx.json", "pnpm-workspace.yaml", "lerna.json", "Dockerfile", "Procfile", "requirements.txt", "Pipfile", "setup.py", "manage.py", "artisan"];
const ehManifesto = (n: string): boolean => NOMES_MANIFESTO.has(n) || /\.(csproj|fsproj)$/i.test(n);

/** package.json reduzido ao que importa para EXECUTAR: nome, gerenciador, workspaces, main, scripts (curtos), engines e NOMES de dependências. */
function reduzirPackageJson(texto: string): string {
  const pkg = json(texto);
  if (pkg === null) return cortar(texto, 2_000);
  const scripts = Object.fromEntries(Object.entries(obj(pkg["scripts"])).slice(0, 40).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 300) : String(v).slice(0, 40)]));
  const deps = [...Object.keys(obj(pkg["dependencies"])), ...Object.keys(obj(pkg["devDependencies"]))].slice(0, 40);
  const bin = pkg["bin"];
  const saida: Record<string, unknown> = {
    name: pkg["name"], private: pkg["private"], packageManager: pkg["packageManager"], type: pkg["type"], main: pkg["main"],
    bin: typeof bin === "string" ? bin : bin === undefined ? undefined : Object.keys(obj(bin)), workspaces: pkg["workspaces"], engines: pkg["engines"], scripts, dependencias: deps,
  };
  return JSON.stringify(saida, null, 2);
}

/** docker compose reduzido: nomes de serviços, imagem/build, portas e comando; NUNCA `environment`, `env_file`, `secrets` ou `labels`. */
function reduzirCompose(texto: string): string {
  const linhas = texto.split(/\r?\n/);
  const servicos: string[] = [];
  let dentroServicos = false;
  let atual: { nome: string; itens: string[] } | null = null;
  let bloco: string | null = null;
  let recuoServico: number | null = null;
  const fechar = (): void => {
    if (atual !== null) servicos.push(`- ${atual.nome}${atual.itens.length > 0 ? `: ${atual.itens.join("; ")}` : ""}`);
    atual = null;
  };
  for (const l of linhas) {
    if (/^services\s*:/.test(l)) { dentroServicos = true; continue; }
    if (/^\S/.test(l) && l.trim() !== "" && !l.startsWith("#")) { if (dentroServicos) fechar(); dentroServicos = false; continue; }
    if (!dentroServicos) continue;
    const s = /^( +)([A-Za-z0-9._-]+)\s*:\s*$/.exec(l);
    if (s !== null && (recuoServico === null || s[1]!.length === recuoServico)) {
      recuoServico ??= s[1]!.length;
      fechar(); atual = { nome: s[2]!, itens: [] }; bloco = null; continue;
    }
    if (atual === null) continue;
    const chave = /^\s{2,12}([a-z_]+)\s*:\s*(.*)$/.exec(l);
    if (chave !== null) {
      bloco = chave[1]!;
      const valor = chave[2]!.trim();
      if (["image", "command", "entrypoint", "working_dir"].includes(bloco) && valor !== "") atual.itens.push(`${bloco}=${valor.slice(0, 100)}`);
      if (bloco === "build" && valor !== "") atual.itens.push(`build=${valor.slice(0, 60)}`);
      continue;
    }
    const item = /^\s+-\s*["']?([^"'#]+?)["']?\s*$/.exec(l);
    if (item !== null && (bloco === "ports" || bloco === "depends_on" || bloco === "profiles")) atual.itens.push(`${bloco}:${item[1]!.slice(0, 40)}`);
  }
  fechar();
  return `serviços (${servicos.length}):\n${servicos.slice(0, LIMITES_DOSSIE.servicos_compose).join("\n")}`;
}

/** Makefile/justfile: nomes dos alvos com as primeiras linhas da receita (a receita é CÓDIGO: truncada). */
function reduzirAlvos(texto: string, tipo: "make" | "just"): string {
  if (tipo === "make") {
    const alvos = alvosDeMake(texto);
    return [...alvos.entries()].slice(0, LIMITES_DOSSIE.alvos_make).map(([n, r]) => `${n}:${r === "" ? "" : `\n  ${r.split("\n").slice(0, 3).map((x) => x.slice(0, 160)).join("\n  ")}`}`).join("\n");
  }
  const saida: string[] = [];
  const linhas = texto.split(/\r?\n/);
  for (let i = 0; i < linhas.length && saida.length < LIMITES_DOSSIE.alvos_make; i += 1) {
    const m = /^(@?[A-Za-z_][A-Za-z0-9_-]*)(\s[^:\n]*)?:(?!=)/.exec(linhas[i]!);
    if (m === null) continue;
    const receita: string[] = [];
    for (let j = i + 1; j < linhas.length && /^[\t ]+\S/.test(linhas[j]!) && receita.length < 3; j += 1) receita.push(linhas[j]!.trim().slice(0, 160));
    saida.push(`${m[1]}${m[2] ?? ""}:${receita.length > 0 ? `\n  ${receita.join("\n  ")}` : ""}`);
  }
  return saida.join("\n");
}

function conteudoDe(nome: string, texto: string): string {
  if (nome === "package.json") return reduzirPackageJson(texto);
  if (/^(docker-)?compose\.ya?ml$|^docker-compose\.ya?ml$/.test(nome)) return reduzirCompose(texto);
  if (/^(Makefile|makefile|GNUmakefile)$/.test(nome)) return reduzirAlvos(texto, "make");
  if (/^[Jj]ustfile$/.test(nome)) return reduzirAlvos(texto, "just");
  return texto;
}

// ---------------------------------------------------------------- montagem
interface Varredura { caminhos: string[]; manifestos: string[]; omitidos_sensiveis: number }

function varrer(l: LeitorProjeto): Varredura {
  const caminhos: string[] = [];
  const manifestos: string[] = [];
  let omitidos = 0;
  let restante: number = LIMITES_DOSSIE.varredura_entradas;
  const fila: Array<{ pasta: string; prof: number }> = [{ pasta: ".", prof: 0 }];
  for (let i = 0; i < fila.length && restante > 0; i += 1) {
    const { pasta, prof } = fila[i]!;
    let nomes: string[];
    try { nomes = [...l.listar(pasta)].sort(); } catch { continue; }
    const dirs: string[] = [];
    const arqs: string[] = [];
    for (const nome of nomes) {
      if (restante <= 0) break;
      restante -= 1;
      const caminho = pasta === "." ? nome : `${pasta}/${nome}`;
      let filhos: string[] = [];
      try { filhos = l.listar(caminho); } catch { /* arquivo */ }
      if (filhos.length > 0) {
        const o = pastaOmitida(nome, PASTAS_IGNORADAS);
        if (o.omitir) { if (o.sensivel) omitidos += 1; continue; }
        if (!nomeSeguroParaPrompt(nome)) continue;
        dirs.push(nome);
      } else {
        // symlink que sai do workspace ou quebrado: o leitor confinado não o enxerga (`existe` falso) e ele nunca aparece
        if (!l.existe(caminho)) continue;
        if (ehArquivoSensivel(nome)) { omitidos += 1; continue; }
        if (ehArquivoInutil(nome) || !nomeSeguroParaPrompt(nome)) continue;
        arqs.push(nome);
      }
    }
    for (const d of dirs) {
      const c = pasta === "." ? d : `${pasta}/${d}`;
      caminhos.push(`${c}/`);
      if (prof + 1 < LIMITES_DOSSIE.arvore_profundidade) fila.push({ pasta: c, prof: prof + 1 });
    }
    for (const a of arqs) {
      const c = pasta === "." ? a : `${pasta}/${a}`;
      caminhos.push(c);
      if (ehManifesto(a)) manifestos.push(c);
    }
  }
  return { caminhos, manifestos, omitidos_sensiveis: omitidos };
}

const profundidade = (c: string): number => c.split("/").length - 1;
const nomeDe = (c: string): string => c.split("/").pop() ?? c;

function ordenarManifestos(lista: string[]): string[] {
  const rank = (c: string): number => { const i = PRIORIDADE.indexOf(nomeDe(c)); return i < 0 ? PRIORIDADE.length : i; };
  return [...lista].sort((a, b) => profundidade(a) - profundidade(b) || rank(a) - rank(b) || a.localeCompare(b));
}

const README = ["README.md", "readme.md", "Readme.md", "README.pt-BR.md", "README.markdown", "README.txt", "README"];

export function montarDossie(l: LeitorProjeto, op: OpcoesDossie): Dossie {
  const v = varrer(l);
  const arvore = v.caminhos.slice(0, LIMITES_DOSSIE.arvore_itens);
  const escolhidos = ordenarManifestos(v.manifestos).slice(0, LIMITES_DOSSIE.manifestos);
  const arquivos: string[] = [];
  const secoes: string[] = [];

  secoes.push(`ÁRVORE (${arvore.length}${v.caminhos.length > arvore.length ? ` de ${v.caminhos.length}` : ""} itens, profundidade ≤ ${LIMITES_DOSSIE.arvore_profundidade}):\n${arvore.map(sanear).join("\n")}`);

  const ferramentas = op.deteccao.ferramentas ?? [];
  if (ferramentas.length > 0) secoes.push(`FERRAMENTAS DE MONOREPO NA RAIZ: ${ferramentas.join(", ")}`);

  const blocos: string[] = [];
  let orcamento: number = LIMITES_DOSSIE.manifestos_total_bytes;
  for (const caminho of escolhidos) {
    if (orcamento < 256) break;
    const bruto = l.ler(caminho);
    if (bruto === null) continue;
    arquivos.push(caminho);
    const bloco = `### ${sanear(caminho)}\n${op.redigir(sanear(cortar(conteudoDe(nomeDe(caminho), bruto), Math.min(LIMITES_DOSSIE.manifesto_bytes, orcamento - 64))))}`;
    orcamento -= Buffer.byteLength(bloco);
    blocos.push(bloco);
  }
  secoes.push(`MANIFESTOS E ARQUIVOS DE CONFIGURAÇÃO (${blocos.length}):\n${blocos.join("\n\n")}`);

  const nomeReadme = README.find((n) => l.existe(n));
  if (nomeReadme !== undefined) {
    const t = l.ler(nomeReadme);
    if (t !== null) {
      arquivos.push(nomeReadme);
      secoes.push(`README (início, ${nomeReadme}):\n${op.redigir(sanear(cortar(t, LIMITES_DOSSIE.readme_bytes)))}`);
    }
  }

  const pistas = op.deteccao.configuracoes.slice(0, LIMITES_DOSSIE.pistas).map((c) => `- ${sanear(c.nome)} | pasta: ${c.cwd} | comando: ${op.redigir(sanear(comandoEmTexto(c)))}`);
  secoes.push(`PISTA (detecção automática do app; pode estar incompleta ou errada${op.deteccao.padrao_sugerido !== null ? `; padrão sugerido: ${op.deteccao.padrao_sugerido}` : ""}):\n${pistas.length > 0 ? pistas.join("\n") : "(nenhuma configuração detectada)"}`);

  let texto = op.redigir(secoes.join("\n\n"));
  if (Buffer.byteLength(texto) > LIMITES_DOSSIE.total_bytes) texto = cortar(texto, LIMITES_DOSSIE.total_bytes - 32);
  const bytes = Buffer.byteLength(texto);
  return {
    texto, hash: createHash("sha256").update(texto).digest("hex").slice(0, 40), arquivos, itens_arvore: arvore.length, bytes,
    tokens_estimados: estimarTokens(texto), omitidos_sensiveis: v.omitidos_sensiveis,
  };
}

/** ~3,5 caracteres por token em texto de código + o prompt fixo (esquema e regras ≈ 900 tokens). Estimativa, nunca garantia. */
export const TOKENS_PROMPT_FIXO = 900;
export const estimarTokens = (texto: string): number => Math.ceil(Buffer.byteLength(texto) / 3.5) + TOKENS_PROMPT_FIXO;
