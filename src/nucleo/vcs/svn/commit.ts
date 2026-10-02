import type { OrigemOperacao } from "../git/guardas";
import { caminhoWc, mensagemEmArquivo, nomeSimples, revisaoSvn, rodarSvn, rodarSvnRede, SvnRecusadoErro, type OpcoesBaseSvn } from "./comum";
import { externalsSvn, infoSvn, localAtual, type InfoSvn } from "./info";
import { parseStatusXml } from "./status";

// T-06.25: commit (mensagem por ARQUIVO UTF-8, nunca por argv), update (--accept postpone) e fila de conflitos.

export const LIMITE_MENSAGEM = 200_000;

export interface OpcoesCommitSvn extends OpcoesBaseSvn {
  mensagem: string;
  origem: OrigemOperacao;
  /** Vazio = tudo na cópia (`.`). */
  caminhos?: readonly string[];
  changelist?: string;
  manterBloqueios?: boolean;
  /** Libera a automação a comitar no tronco. Padrão: nunca. */
  automacaoNoTronco?: boolean;
  info?: InfoSvn;
}

export interface ResultadoCommitSvn {
  /** null quando não havia nada a enviar. */
  revisao: number | null;
  saida: string;
}

/** Interpreta "Committed revision N." */
export function parseCommitSaida(saida: string): number | null {
  const m = /Committed revision (\d+)\./.exec(saida);
  return m ? Number(m[1]) : null;
}

export async function commitarSvn(raiz: string, op: OpcoesCommitSvn): Promise<ResultadoCommitSvn> {
  if (op.origem !== "usuario" && op.origem !== "automacao") throw new SvnRecusadoErro("Origem da operação inválida.", "origem-invalida");
  if (typeof op.mensagem !== "string" || op.mensagem.trim() === "" || op.mensagem.length > LIMITE_MENSAGEM || op.mensagem.includes("\0")) throw new SvnRecusadoErro("Mensagem de commit inválida (vazia, grande demais ou com NUL).", "proibido");
  if (op.origem === "automacao" && op.automacaoNoTronco !== true) {
    const info = op.info ?? (await infoSvn(raiz, op));
    if (localAtual(info.urlRelativa).tipo !== "branch") throw new SvnRecusadoErro("Automação não comita no tronco (nem fora de um branch). Use uma cópia de trabalho de branch.", "automacao-tronco", [info.urlRelativa]);
  }
  const m = await mensagemEmArquivo(op.mensagem);
  try {
    const flags = ["-F", m.arquivo, "--encoding", "UTF-8", ...(op.changelist !== undefined ? ["--changelist", nomeSimples(op.changelist, "changelist")] : []), ...(op.manterBloqueios === true ? ["--no-unlock"] : [])];
    const r = await rodarSvnRede(raiz, "commit", flags, (op.caminhos ?? []).map(caminhoWc), op);
    return { revisao: parseCommitSaida(r.stdout), saida: r.stdout };
  } finally {
    await m.limpar();
  }
}

// ---- update ---------------------------------------------------------------------------------------

export type AcaoUpdate = "adicionado" | "apagado" | "atualizado" | "conflito" | "mesclado" | "existia" | "substituido" | "restaurado";

export interface ItemUpdate {
  acao: AcaoUpdate;
  /** Ação sobre as propriedades (mesmas letras). */
  propriedade: AcaoUpdate | null;
  caminho: string;
  /** Conflito de árvore (coluna 4). */
  arvore: boolean;
}

export interface ResultadoUpdate {
  revisao: number | null;
  itens: ItemUpdate[];
  conflitos: ItemUpdate[];
  resumo: string;
}

const ACAO: Record<string, AcaoUpdate> = { A: "adicionado", D: "apagado", U: "atualizado", C: "conflito", G: "mesclado", E: "existia", R: "substituido", B: "restaurado" };

export function parseUpdateSaida(saida: string): ResultadoUpdate {
  const itens: ItemUpdate[] = [];
  let revisao: number | null = null;
  const resumo: string[] = [];
  let noResumo = false;
  for (const l of saida.split("\n")) {
    const rv = /^(?:Updated to|At) revision (\d+)\./.exec(l);
    if (rv) revisao = Number(rv[1]);
    if (l.startsWith("Summary of conflicts:")) noResumo = true;
    else if (noResumo && l.trim() !== "") resumo.push(l.trim());
    const m = /^([ADUCGERB ])([ UCG])([ BL])([ C]) (.+)$/.exec(l);
    if (m && (m[1] !== " " || m[2] !== " " || m[4] === "C")) {
      itens.push({ acao: ACAO[m[1] as string] ?? "atualizado", propriedade: m[2] === " " ? null : (ACAO[m[2] as string] ?? "atualizado"), caminho: (m[5] as string).replace(/\\/g, "/"), arvore: m[4] === "C" });
    }
  }
  const conflitos = itens.filter((i) => i.acao === "conflito" || i.propriedade === "conflito" || i.arvore);
  return { revisao, itens, conflitos, resumo: resumo.join("; ") };
}

export interface OpcoesUpdateSvn extends OpcoesBaseSvn {
  revisao?: number | "HEAD";
  caminhos?: readonly string[];
  /** Segue `svn:externals`. Padrão false (`--ignore-externals`). */
  seguirExternals?: boolean;
  /** Obrigatório para seguir externals que apontam para FORA do repositório. */
  confirmouExternalsExternos?: boolean;
}

/** `svn update --accept postpone`: nunca resolve nem pergunta; conflitos voltam na fila. */
export async function atualizarSvn(raiz: string, op: OpcoesUpdateSvn = {}): Promise<ResultadoUpdate> {
  if (op.seguirExternals === true && op.confirmouExternalsExternos !== true) {
    const fora = (await externalsSvn(raiz, op)).filter((e) => e.foraDoRepositorio);
    if (fora.length > 0) throw new SvnRecusadoErro("Há svn:externals apontando para fora do repositório; confirme antes de segui-los.", "externals-externos", fora.map((e) => e.url));
  }
  const flags = ["--accept", "postpone", ...(op.seguirExternals === true ? [] : ["--ignore-externals"]), ...(op.revisao !== undefined ? ["-r", revisaoSvn(op.revisao)] : [])];
  const r = await rodarSvnRede(raiz, "update", flags, (op.caminhos ?? []).map(caminhoWc), op);
  return parseUpdateSaida(r.stdout);
}

export interface ConflitoSvn {
  caminho: string;
  tipo: "texto" | "propriedade" | "arvore";
}

/** Fila de conflitos da cópia de trabalho (local, sem rede). */
export async function listarConflitosSvn(raiz: string, op: OpcoesBaseSvn = {}): Promise<ConflitoSvn[]> {
  const r = await rodarSvn(raiz, "status", ["--xml", "-q"], [], { ...op, maxBytes: 64 * 1024 * 1024 });
  return parseStatusXml(r.stdout)
    .arquivos.filter((m) => m.tipo === "conflito")
    .map((m) => ({ caminho: m.caminho, tipo: m.svn?.arvoreConflito === true ? "arvore" : m.svn?.propriedades === "conflicted" ? "propriedade" : "texto" }));
}
