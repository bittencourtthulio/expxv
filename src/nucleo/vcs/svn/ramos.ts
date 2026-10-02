import { NomeInvalidoErro } from "../../git/erros";
import { soBase, caminhoRepo, exigirConfirmacaoServidor, mensagemEmArquivo, revisaoSvn, rodarSvn, rodarSvnEscrita, rodarSvnRede, SvnRecusadoErro, type ConfirmacaoServidor, type OpcoesBaseSvn } from "./comum";
import { infoSvn, layoutSvn, localAtual, type InfoSvn } from "./info";
import { parseCommitSaida, parseUpdateSaida, type ResultadoUpdate } from "./commit";
import { parseStatusXml } from "./status";

// T-06.26: branches/tags por `svn copy` (GRAVA NO SERVIDOR: confirmação explícita e `simular` antes),
// `switch`, `merge` com `mergeinfo` e reintegração. Origem/destino usam `^/` (relativo à raiz do repositório):
// nenhuma URL do usuário entra em argv.

export type TipoRamoSvn = "branch" | "tag";

export interface PlanoRamoSvn {
  /** true = só simulação: NADA foi gravado no servidor. */
  simulado: boolean;
  tipo: TipoRamoSvn;
  /** `^/trunk` */
  origem: string;
  /** `^/branches/x` */
  destino: string;
  /** URL completa que passará a existir no servidor. */
  urlDestino: string;
  mensagem: string;
  /** Revisão criada (só quando gravou). */
  revisao: number | null;
}

export interface OpcoesCriarRamoSvn extends OpcoesBaseSvn, Partial<ConfirmacaoServidor> {
  tipo: TipoRamoSvn;
  nome: string;
  /** Mensagem do commit no servidor. */
  mensagem?: string;
  /** Caminho de origem no repositório (padrão: o ramo da cópia de trabalho). */
  de?: string;
  revisao?: number;
  /** Devolve o que seria criado e não grava nada. */
  simular?: boolean;
  /** Pasta-mãe quando o repositório não segue trunk/branches/tags. */
  raizRamos?: string;
  info?: InfoSvn;
}

/** Primeiro nível do local (`trunk`, `branches/x`, `tags/y`) de uma `urlRelativa`. */
export function raizDoLocal(urlRelativa: string): string | null {
  const p = urlRelativa.replace(/^\^\//, "").split("/");
  const l = localAtual(urlRelativa);
  if (l.tipo === "trunk") return "trunk";
  if (l.tipo === "branch" || l.tipo === "tag") return `${p[0]}/${p[1]}`;
  return null;
}

export async function criarRamoSvn(raiz: string, op: OpcoesCriarRamoSvn): Promise<PlanoRamoSvn> {
  const nome = caminhoRepo(op.nome);
  const info = op.info ?? (await infoSvn(raiz, soBase(op)));
  const de = op.de !== undefined ? caminhoRepo(op.de) : raizDoLocal(info.urlRelativa);
  if (de === null) throw new SvnRecusadoErro("A cópia de trabalho não está em trunk/branch/tag: informe `de`.", "layout-nao-padrao");
  let pai: string;
  if (op.raizRamos !== undefined) pai = caminhoRepo(op.raizRamos);
  else {
    const layout = await layoutSvn(raiz, soBase(op));
    const alvo = op.tipo === "tag" ? layout.tags : layout.branches;
    if (!layout.padrao || alvo === null) throw new SvnRecusadoErro("O repositório não segue trunk/branches/tags: informe `raizRamos`.", "layout-nao-padrao", layout.naRaiz);
    pai = alvo;
  }
  const destino = `${pai}/${nome}`;
  const existe = await rodarSvnRede(raiz, "ls", [], [`^/${destino}`], { ...soBase(op), tipo: "leitura", tolerar: [1] }).then((r) => r.codigo === 0, () => false);
  if (existe) throw new SvnRecusadoErro(`Já existe ${destino} no servidor.`, "destino-existe", [destino]);
  const mensagem = op.mensagem ?? (op.tipo === "tag" ? `Cria a tag ${nome}` : `Cria o branch ${nome}`);
  const plano: PlanoRamoSvn = { simulado: true, tipo: op.tipo, origem: `^/${de}`, destino: `^/${destino}`, urlDestino: `${info.raizRepositorio}/${destino}`, mensagem, revisao: null };
  if (op.simular === true) return plano;
  exigirConfirmacaoServidor(op.tipo === "tag" ? "Criar tag" : "Criar branch", op as ConfirmacaoServidor);
  const m = await mensagemEmArquivo(mensagem);
  try {
    const flags = ["--parents", "-F", m.arquivo, "--encoding", "UTF-8", ...(op.revisao !== undefined ? ["-r", revisaoSvn(op.revisao)] : [])];
    const r = await rodarSvnRede(raiz, "copy", flags, [`^/${de}`, `^/${destino}`], soBase(op));
    return { ...plano, simulado: false, revisao: parseCommitSaida(r.stdout) };
  } finally {
    await m.limpar();
  }
}

export async function trocarSvn(raiz: string, destino: string, op: OpcoesBaseSvn & { seguirExternals?: boolean } = {}): Promise<ResultadoUpdate> {
  const d = caminhoRepo(destino);
  const r = await rodarSvnRede(raiz, "switch", ["--accept", "postpone", ...(op.seguirExternals === true ? [] : ["--ignore-externals"])], [`^/${d}`], op);
  return parseUpdateSaida(r.stdout);
}

// ---- merge ----------------------------------------------------------------------------------------

export interface MergeinfoSvn {
  elegiveis: number[];
  mesclados: number[];
}

export function parseRevisoes(saida: string): number[] {
  return saida.split("\n").map((l) => /^r(\d+)\*?\s*$/.exec(l.trim())).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
}

/** Revisões do ramo `de` ainda não mescladas (elegíveis) e já mescladas na cópia de trabalho. */
export async function mergeinfoSvn(raiz: string, de: string, op: OpcoesBaseSvn = {}): Promise<MergeinfoSvn> {
  const src = `^/${caminhoRepo(de)}`;
  const [e, m] = await Promise.all(
    (["eligible", "merged"] as const).map((k) => rodarSvnRede(raiz, "mergeinfo", ["--show-revs", k], [src, "."], { ...op, tipo: "leitura" })),
  );
  return { elegiveis: parseRevisoes((e as { stdout: string }).stdout), mesclados: parseRevisoes((m as { stdout: string }).stdout) };
}

export interface OpcoesMergeSvn extends OpcoesBaseSvn {
  /** Ramo de origem (`branches/x`). */
  de: string;
  /** Só estas revisões (`-c N`); vazio = automático (tudo que falta). */
  revisoes?: readonly number[];
  /** `--dry-run`: mostra o que mudaria sem tocar na cópia. */
  simular?: boolean;
}

export interface ResultadoMergeSvn extends ResultadoUpdate {
  simulado: boolean;
  mergeinfo: MergeinfoSvn | null;
}

/** `svn merge` (altera só a cópia de trabalho; enviar é um `commit` à parte). Conflitos ficam adiados. */
export async function mesclarSvn(raiz: string, op: OpcoesMergeSvn): Promise<ResultadoMergeSvn> {
  const src = `^/${caminhoRepo(op.de)}`;
  const flags = ["--accept", "postpone", ...(op.simular === true ? ["--dry-run"] : []), ...(op.revisoes ?? []).flatMap((r) => ["-c", revisaoSvn(r)])];
  for (const r of op.revisoes ?? []) if (!Number.isInteger(r) || r <= 0) throw new NomeInvalidoErro(`revisão: ${r}`);
  const r = await (op.simular === true ? rodarSvn : rodarSvnEscrita)(raiz, "merge", flags, [src, "."], { ...op, ...(op.simular === true ? { timeoutMs: 120_000 } : {}) });
  const u = parseUpdateSaida(r.stdout);
  return { ...u, simulado: op.simular === true, mergeinfo: op.simular === true ? null : await mergeinfoSvn(raiz, op.de, op) };
}

/**
 * Reintegração (ramo -> tronco): a cópia de trabalho precisa ser o TRONCO, limpa (sem mudanças locais).
 * No svn 1.8+ o merge automático já reintegra; `--reintegrate` não é usado.
 */
export async function reintegrarSvn(raiz: string, op: { ramo: string; simular?: boolean } & OpcoesBaseSvn): Promise<ResultadoMergeSvn> {
  const info = await infoSvn(raiz, op);
  if (localAtual(info.urlRelativa).tipo !== "trunk") throw new SvnRecusadoErro("A reintegração acontece numa cópia de trabalho do tronco.", "layout-nao-padrao", [info.urlRelativa]);
  const st = await rodarSvn(raiz, "status", ["--xml", "-q"], [], op);
  const sujos = parseStatusXml(st.stdout).arquivos.filter((m) => m.tipo !== "naorastreado" && m.tipo !== "ignorado");
  if (sujos.length > 0) throw new SvnRecusadoErro("A cópia do tronco tem alterações locais: envie ou descarte antes de reintegrar.", "arvore-suja", sujos.slice(0, 10).map((m) => m.caminho));
  return mesclarSvn(raiz, { de: op.ramo, ...(op.simular !== undefined ? { simular: op.simular } : {}), ...(op.executor ? { executor: op.executor } : {}), ...(op.executavel ? { executavel: op.executavel } : {}), ...(op.env ? { env: op.env } : {}), ...(op.signal ? { signal: op.signal } : {}) });
}
