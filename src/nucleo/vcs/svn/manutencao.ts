import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NomeInvalidoErro } from "../../git/erros";
import { caminhoWc, exigirConfirmacaoServidor, mensagemEmArquivo, nomeSimples, rodarSvn, rodarSvnEscrita, rodarSvnRede, SvnRecusadoErro, type ConfirmacaoServidor, type OpcoesBaseSvn } from "./comum";
import { parseExternals, infoSvn, type ExternalSvn } from "./info";
import { documento, filhosDe } from "./xml";

// T-06.24: manutenção local da cópia de trabalho (nada aqui grava no servidor, exceto lock/unlock).

const lista = (cs: readonly string[]): string[] => {
  if (cs.length === 0) throw new NomeInvalidoErro("(nenhum caminho)");
  return cs.map(caminhoWc);
};

export async function adicionar(raiz: string, caminhos: readonly string[], op: OpcoesBaseSvn = {}): Promise<void> {
  await rodarSvnEscrita(raiz, "add", ["--parents", "--force", "-q"], lista(caminhos), op);
}

export async function remover(raiz: string, caminhos: readonly string[], op: OpcoesBaseSvn & { manterLocal?: boolean } = {}): Promise<void> {
  await rodarSvnEscrita(raiz, "rm", op.manterLocal === true ? ["--keep-local", "-q"] : ["-q"], lista(caminhos), op);
}

export async function mover(raiz: string, de: string, para: string, op: OpcoesBaseSvn = {}): Promise<void> {
  await rodarSvnEscrita(raiz, "mv", ["--parents", "-q"], [caminhoWc(de), caminhoWc(para)], op);
}

/** Cópia LOCAL (agendada): origem e destino dentro da cópia de trabalho. Cópia para URL é `criarRamoSvn`. */
export async function copiar(raiz: string, de: string, para: string, op: OpcoesBaseSvn = {}): Promise<void> {
  await rodarSvnEscrita(raiz, "cp", ["--parents", "-q"], [caminhoWc(de), caminhoWc(para)], op);
}

export interface ResultadoReverter {
  /** Patch com o que foi descartado (recuperável com `svn patch`); null sem pasta de segurança. */
  backup: string | null;
}

/**
 * Descarta mudanças locais. Exige `pastaSeguranca` (grava o patch do que será perdido) ou `semBackup: true`.
 * Mudanças em arquivo não versionado não existem para o revert; nada é apagado além do que o svn reverte.
 */
export async function reverter(raiz: string, caminhos: readonly string[], op: OpcoesBaseSvn & { recursivo?: boolean; pastaSeguranca?: string; semBackup?: boolean } = {}): Promise<ResultadoReverter> {
  const alvo = lista(caminhos);
  if (op.pastaSeguranca === undefined && op.semBackup !== true) throw new SvnRecusadoErro("Descartar exige pasta de segurança (recuperável) ou semBackup explícito.", "proibido");
  let backup: string | null = null;
  if (op.pastaSeguranca !== undefined) {
    const d = await rodarSvn(raiz, "diff", ["--internal-diff", ...(op.recursivo === true ? [] : ["--depth", "empty"])], alvo, { ...op, timeoutMs: 60_000 });
    if (d.stdout.trim() !== "") {
      await mkdir(op.pastaSeguranca, { recursive: true, mode: 0o700 });
      backup = join(op.pastaSeguranca, `descarte-${new Date().toISOString().replace(/[:.]/g, "-")}.patch`);
      await writeFile(backup, d.stdout, { mode: 0o600 });
    }
  }
  await rodarSvnEscrita(raiz, "revert", ["-q", ...(op.recursivo === true ? ["-R"] : [])], alvo, op);
  return { backup };
}

export type EscolhaResolver = "working" | "base" | "mine-full" | "theirs-full" | "mine-conflict" | "theirs-conflict";
const ESCOLHAS: ReadonlySet<string> = new Set(["working", "base", "mine-full", "theirs-full", "mine-conflict", "theirs-conflict"]);

export async function resolver(raiz: string, caminhos: readonly string[], aceitar: EscolhaResolver, op: OpcoesBaseSvn & { recursivo?: boolean } = {}): Promise<void> {
  if (!ESCOLHAS.has(aceitar)) throw new NomeInvalidoErro(`aceitar: ${String(aceitar)}`);
  await rodarSvnEscrita(raiz, "resolve", ["--accept", aceitar, "-q", ...(op.recursivo === true ? ["-R"] : [])], lista(caminhos), op);
}

/** `svn cleanup` simples: remove travas de cópia de trabalho. Nunca `--remove-unversioned`. */
export async function limpar(raiz: string, op: OpcoesBaseSvn = {}): Promise<void> {
  await rodarSvnEscrita(raiz, "cleanup", [], [], op);
}

export async function definirChangelist(raiz: string, nome: string, caminhos: readonly string[], op: OpcoesBaseSvn = {}): Promise<void> {
  await rodarSvnEscrita(raiz, "changelist", ["-q"], [nomeSimples(nome, "changelist"), ...lista(caminhos)], op);
}
export async function removerDeChangelist(raiz: string, caminhos: readonly string[], op: OpcoesBaseSvn = {}): Promise<void> {
  await rodarSvnEscrita(raiz, "changelist", ["--remove", "-q"], lista(caminhos), op);
}

// ---- propriedades --------------------------------------------------------------------------------

export interface PropriedadeSvn {
  caminho: string;
  nome: string;
  valor: string;
}

const NOME_PROP = /^[A-Za-z][\w.:-]{0,100}$/;
const nomeProp = (n: string): string => {
  if (!NOME_PROP.test(n)) throw new NomeInvalidoErro(`propriedade: ${n}`);
  return n;
};

export function parsePropriedades(xml: string): PropriedadeSvn[] {
  const out: PropriedadeSvn[] = [];
  for (const t of filhosDe(documento(xml, "properties"), "target")) {
    for (const p of filhosDe(t, "property")) out.push({ caminho: t.attrs.path ?? ".", nome: p.attrs.name ?? "", valor: p.texto });
  }
  return out;
}

export async function listarPropriedades(raiz: string, caminho = ".", op: OpcoesBaseSvn & { recursivo?: boolean } = {}): Promise<PropriedadeSvn[]> {
  const r = await rodarSvn(raiz, "proplist", ["-v", "--xml", ...(op.recursivo === true ? ["-R"] : [])], [caminhoWc(caminho)], op);
  return parsePropriedades(r.stdout);
}

export interface ResultadoPropriedade {
  /** Externals que apontam para fora do repositório (o app não os segue sem aviso). */
  avisos: string[];
  externals: ExternalSvn[];
}

/** `propset` com o valor em arquivo temporário (nunca em argv). `svn:externals` devolve avisos de externals externos. */
export async function definirPropriedade(raiz: string, caminho: string, nome: string, valor: string, op: OpcoesBaseSvn = {}): Promise<ResultadoPropriedade> {
  nomeProp(nome);
  const m = await mensagemEmArquivo(valor);
  try {
    await rodarSvnEscrita(raiz, "propset", ["-q", "-F", m.arquivo, nome], [caminhoWc(caminho)], op);
  } finally {
    await m.limpar();
  }
  if (nome !== "svn:externals") return { avisos: [], externals: [] };
  const repo = (await infoSvn(raiz, op)).raizRepositorio;
  const externals = parseExternals(valor, caminho, repo);
  const fora = externals.filter((e) => e.foraDoRepositorio);
  return { externals, avisos: fora.map((e) => `external aponta para fora do repositório: ${e.url} (não será seguido sem confirmação)`) };
}

export async function apagarPropriedade(raiz: string, caminho: string, nome: string, op: OpcoesBaseSvn = {}): Promise<void> {
  await rodarSvnEscrita(raiz, "propdel", ["-q", nomeProp(nome)], [caminhoWc(caminho)], op);
}

/** `svn:needs-lock` (valor `*`): o arquivo fica somente leitura até `bloquear`. */
export async function definirNeedsLock(raiz: string, caminho: string, ativo: boolean, op: OpcoesBaseSvn = {}): Promise<void> {
  if (ativo) await definirPropriedade(raiz, caminho, "svn:needs-lock", "*", op);
  else await apagarPropriedade(raiz, caminho, "svn:needs-lock", op);
}

/** Acrescenta padrões ao `svn:ignore` da pasta, sem duplicar (preserva os existentes). */
export async function ignorarSvn(raiz: string, pasta: string, padroes: readonly string[], op: OpcoesBaseSvn = {}): Promise<string[]> {
  for (const p of padroes) if (p === "" || /[\n\r\0]/.test(p)) throw new NomeInvalidoErro(`padrão: ${p}`);
  const atual = await rodarSvn(raiz, "propget", ["svn:ignore", "--xml"], [caminhoWc(pasta)], { ...op, tolerar: [1] });
  const existentes = (parsePropriedades(atual.stdout)[0]?.valor ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const todos = [...existentes];
  for (const p of padroes) if (!todos.includes(p)) todos.push(p);
  await definirPropriedade(raiz, pasta, "svn:ignore", todos.join("\n"), op);
  return todos;
}

// ---- locks (gravam no servidor) -------------------------------------------------------------------

export async function bloquear(raiz: string, caminhos: readonly string[], conf: ConfirmacaoServidor & { mensagem?: string }, op: OpcoesBaseSvn = {}): Promise<void> {
  exigirConfirmacaoServidor("Bloquear arquivo (svn lock)", conf);
  const alvo = lista(caminhos);
  if (conf.mensagem === undefined) return void (await rodarSvnRede(raiz, "lock", ["-q"], alvo, op));
  const m = await mensagemEmArquivo(conf.mensagem);
  try {
    await rodarSvnRede(raiz, "lock", ["-q", "-F", m.arquivo, "--encoding", "UTF-8"], alvo, op);
  } finally {
    await m.limpar();
  }
}

export async function desbloquear(raiz: string, caminhos: readonly string[], conf: ConfirmacaoServidor, op: OpcoesBaseSvn = {}): Promise<void> {
  exigirConfirmacaoServidor("Desbloquear arquivo (svn unlock)", conf);
  await rodarSvnRede(raiz, "unlock", ["-q"], lista(caminhos), op);
}
