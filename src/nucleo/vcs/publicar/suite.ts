// Pastas da suíte ExpxDev e do próprio app dentro do repositório do usuário (D-691, D-692). Elas são escritas por `expxdev init|update` (D-470) e pelo ADE e NÃO
// pertencem ao trabalho que o dono quer publicar: ficam fora da contagem do botão "Commit e push" e só entram num commit por escolha dele, no diálogo.
// "Ignorar neste computador" acrescenta linhas em `.git/info/exclude` (arquivo local do repositório, nunca vai ao remoto; sem tocar em `.gitignore`).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PRODUTO } from "../../produto";
import { PASTAS_GRAVADAS } from "../../suite/modelo";
import { naPastaDoProduto } from "./segredos";

/** Primeiro segmento que identifica a suíte (`.claude`, `.expx`, `.opencode`) e a pasta do produto. */
export const RAIZES_DA_SUITE: readonly string[] = [...PASTAS_GRAVADAS, PRODUTO.pastaNoProjeto];
/** Sobras da troca atômica do `init` ao lado de `.expx` (`.expx.tmp-<pid>-<ms>`). */
const TEMPORARIA_EXPX = /^\.expx\.tmp-\d+-\d+(-anterior)?$/;
export const MARCA_EXCLUDE = `# ${PRODUTO.nome}: arquivos da suíte ExpxDev, só neste computador (este arquivo nunca vai ao remoto)`;
export const LIMITE_CAMINHOS_SUITE = 12;

const primeiro = (caminho: string): string => caminho.replace(/\\/g, "/").replace(/^\.\//, "").split("/")[0] ?? "";

/** O caminho (como o `git status` mostra: pasta termina em `/`) pertence à suíte ou à pasta do produto. */
export function ehDaSuite(caminho: string): boolean {
  const p = primeiro(caminho);
  return p !== "" && (RAIZES_DA_SUITE.includes(p) || TEMPORARIA_EXPX.test(p));
}

/** A pasta do produto guarda artefatos do app (incluindo a instrução entregue ao agente): nunca entra num commit, mesmo com "Incluir". */
export const incluivelNoCommit = (caminho: string): boolean => !naPastaDoProduto(caminho);

function escaparPadrao(nome: string): string {
  return nome.replace(/([\\*?[\]!#])/g, "\\$1").replace(/^ /, "\\ ").replace(/ $/, "\\ ");
}

/** Linha de `info/exclude` ancorada na raiz: `/.expx/` para pasta, `/.claude/settings.json` para arquivo. Nunca caminho com `..` nem absoluto. */
export function linhaDeExclusao(caminho: string): string | null {
  const c = caminho.replace(/\\/g, "/").replace(/^\.\//, "");
  if (c === "" || c.startsWith("/") || c.split("/").includes("..") || /[\0\r\n]/.test(c) || !ehDaSuite(c)) return null;
  const pasta = c.endsWith("/");
  const corpo = c.replace(/\/+$/, "").split("/").map(escaparPadrao).join("/");
  return `/${corpo}${pasta ? "/" : ""}`;
}

export function linhasDeExclusao(caminhos: readonly string[]): string[] {
  const vistas = new Set<string>();
  for (const c of caminhos) {
    const l = linhaDeExclusao(c);
    if (l !== null) vistas.add(l);
  }
  return [...vistas];
}

/** Texto novo do arquivo `exclude`: preserva o que já existe, acrescenta só as linhas que faltam (idempotente) e termina com quebra de linha. */
export function acrescentarLinhas(atual: string, linhas: readonly string[]): { texto: string; adicionadas: string[] } {
  const existentes = new Set(atual.split(/\r?\n/).map((l) => l.trim()));
  const adicionadas = linhas.filter((l) => !existentes.has(l));
  if (adicionadas.length === 0) return { texto: atual, adicionadas };
  const base = atual === "" || atual.endsWith("\n") ? atual : `${atual}\n`;
  const cabecalho = existentes.has(MARCA_EXCLUDE) ? "" : `${MARCA_EXCLUDE}\n`;
  return { texto: `${base}${cabecalho}${adicionadas.join("\n")}\n`, adicionadas };
}

/** Grava as linhas em `arquivo` (já resolvido pelo git: `rev-parse --git-path info/exclude`). Devolve quantas foram acrescentadas. */
export async function gravarExclusoes(arquivo: string, linhas: readonly string[]): Promise<number> {
  if (linhas.length === 0) return 0;
  const atual = await readFile(arquivo, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return ""; throw e; });
  const { texto, adicionadas } = acrescentarLinhas(atual, linhas);
  if (adicionadas.length === 0) return 0;
  await mkdir(dirname(arquivo), { recursive: true });
  await writeFile(arquivo, texto, { encoding: "utf8", mode: 0o644 });
  return adicionadas.length;
}
