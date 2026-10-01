import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { GitErro } from "../../git/erros";
import { escrita, ramoAtual, rodarGit, temCommits, type OpcoesBase } from "./comum";
import { ehRamoPadrao } from "./ramos";

// T-06.08 · Commit. A mensagem vai por stdin (`-F -`), nunca em argv. Assinatura e hooks são os do usuário:
// jamais passamos `--no-gpg-sign` nem mexemos em `commit.gpgsign`; `--no-verify` só com `pularHooks: true`
// (o chamador confirmou na UI) e o retorno registra `hooksPulados`. Se o commit falha (hook, identidade, assinatura…)
// o erro devolve a saída completa e a MENSAGEM, para a UI reabrir o editor sem perder o texto.

export type OrigemCommit = "usuario" | "automacao";

export class CommitRecusadoErro extends GitErro {
  override name = "CommitRecusadoErro";
  constructor(mensagem: string, readonly motivo: "mensagem-vazia" | "automacao-ramo-padrao" | "automacao-sem-ramo" | "amend-publicado" | "amend-sem-commit" | "conventional" | "trailer-invalido", readonly detalhe: string[] = []) {
    super(mensagem);
  }
}

/** O git recusou ou falhou ao comitar; `mensagem` é o texto que NÃO deve ser perdido. */
export class CommitFalhouErro extends GitErro {
  override name = "CommitFalhouErro";
  constructor(
    texto: string,
    readonly saida: string,
    readonly mensagem: string,
    readonly causa: "sem-mudancas" | "falhou",
    codigo: number | null,
  ) {
    super(texto, ["commit"], codigo, saida);
  }
}

export interface OpcoesCommit extends OpcoesBase {
  /** Obrigatória, salvo `amend` (sem ela mantém a mensagem anterior). */
  mensagem?: string;
  /** Quem comita. `automacao` é recusada na branch padrão (D-33). */
  origem: OrigemCommit;
  /** Reescreve o último commit, SOMENTE se ainda não foi publicado. */
  amend?: boolean;
  /** `--no-verify`. Só `true` explícito (o chamador deve ter confirmado com o usuário). */
  pularHooks?: boolean;
  /** `Nome <email>` → trailer `Co-authored-by`. */
  coautores?: readonly string[];
  /** Exige *conventional commits* no assunto (padrão: só avisa se não seguir quando `conventional: 'avisar'`). */
  conventional?: boolean | "avisar";
  /** Streaming da saída (git + hooks), na ordem de chegada. */
  aoSaida?: (texto: string, fluxo: "stdout" | "stderr") => void;
  /** Tempo limite (hooks podem demorar). Padrão 5 min. */
  timeoutMs?: number;
}

export interface ResultadoCommit {
  hash: string;
  hashCurto: string;
  assunto: string;
  amend: boolean;
  /** `--no-verify` foi usado (registrar na auditoria). */
  hooksPulados: boolean;
  avisos: string[];
  saida: string;
}

const RE_CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^()\s]+\))?!?: \S/;
const RE_COAUTOR = /^[^<>\r\n]+ <[^<>\s]+@[^<>\s]+>$/;
export const LIMITE_ASSUNTO = 72;

/** Avisos (não bloqueiam): assunto longo, linha em branco depois do assunto, conventional. */
export function avisosDaMensagem(mensagem: string, conventional: boolean | "avisar" = false): string[] {
  const linhas = mensagem.replace(/\r\n/g, "\n").split("\n");
  const assunto = linhas[0] ?? "";
  const avisos: string[] = [];
  if ([...assunto].length > LIMITE_ASSUNTO) avisos.push(`Assunto com ${[...assunto].length} colunas (recomendado até ${LIMITE_ASSUNTO}).`);
  if (linhas.length > 1 && (linhas[1] ?? "") !== "") avisos.push("Deixe uma linha em branco entre o assunto e o corpo.");
  if (conventional !== false && !RE_CONVENTIONAL.test(assunto)) avisos.push("O assunto não segue conventional commits (tipo(escopo): descrição).");
  return avisos;
}

/** Texto do `commit.template` do repositório (null se não há/ilegível). */
export async function modeloMensagem(raiz: string, op: OpcoesBase = {}): Promise<string | null> {
  const r = await rodarGit(raiz, ["config", "--get", "commit.template"], { ...op, tolerar: [1] });
  let caminho = r.stdout.trim();
  if (r.codigo !== 0 || caminho === "") return null;
  if (caminho.startsWith("~/")) caminho = join(homedir(), caminho.slice(2));
  else if (!isAbsolute(caminho)) caminho = join(raiz, caminho);
  return readFile(caminho, "utf8").catch(() => null);
}

/** Remotas (`origin/x`…) que já contêm o commit apontado por HEAD: se houver, o commit foi publicado. */
export async function remotasQueContem(raiz: string, op: OpcoesBase = {}): Promise<string[]> {
  const r = await rodarGit(raiz, ["branch", "-r", "--contains", "HEAD", "--format=%(refname:short)"], { ...op, tolerar: [1, 129] });
  return r.stdout.split("\n").map((x) => x.trim()).filter((x) => x !== "" && !x.endsWith("/HEAD") && x !== "HEAD");
}

/** O último commit já está no `@{upstream}` ou em alguma remota? */
export async function ultimoCommitPublicado(raiz: string, op: OpcoesBase = {}): Promise<{ publicado: boolean; remotas: string[] }> {
  const remotas = await remotasQueContem(raiz, op);
  const up = await rodarGit(raiz, ["merge-base", "--is-ancestor", "HEAD", "@{upstream}"], { ...op, tolerar: [1, 128] });
  return { publicado: remotas.length > 0 || up.codigo === 0, remotas };
}

async function comTrailers(raiz: string, mensagem: string, coautores: readonly string[], op: OpcoesBase): Promise<string> {
  const lista = coautores.map((c) => c.trim());
  for (const c of lista) if (!RE_COAUTOR.test(c)) throw new CommitRecusadoErro(`Coautor inválido (use "Nome <email>"): ${c.slice(0, 60)}`, "trailer-invalido", [c]);
  if (lista.length === 0) return mensagem;
  const r = await rodarGit(raiz, ["interpret-trailers", "--if-exists", "addIfDifferent", ...lista.flatMap((c) => ["--trailer", `Co-authored-by: ${c}`])], { ...op, stdin: mensagem.endsWith("\n") ? mensagem : mensagem + "\n" });
  return r.stdout;
}

/**
 * Cria (ou emenda) um commit com o que está no índice. Ordem das guardas: mensagem → automação na branch padrão →
 * amend publicado → conventional. Lança CommitRecusadoErro (guarda) ou CommitFalhouErro (git falhou; traz saída e mensagem).
 */
export async function criarCommit(raiz: string, opcoes: OpcoesCommit): Promise<ResultadoCommit> {
  const { mensagem: bruta, origem, amend = false, pularHooks = false, coautores = [], conventional = false, aoSaida, timeoutMs = 300_000, ...op } = opcoes;
  const mensagemOriginal = bruta ?? "";
  if (mensagemOriginal.includes("\0")) throw new CommitRecusadoErro("Mensagem inválida.", "mensagem-vazia");
  if (!amend && mensagemOriginal.trim() === "") throw new CommitRecusadoErro("A mensagem do commit está vazia.", "mensagem-vazia");

  const ramo = await ramoAtual(raiz, op);
  if (origem === "automacao") {
    if (ramo === null) throw new CommitRecusadoErro("Automação não comita com HEAD destacado.", "automacao-sem-ramo");
    if (await ehRamoPadrao(raiz, ramo, op)) throw new CommitRecusadoErro(`Automação não comita na branch padrão (${ramo}). Use uma branch de trabalho.`, "automacao-ramo-padrao", [ramo]);
  } else if (origem !== "usuario") {
    throw new CommitRecusadoErro("Origem do commit inválida.", "automacao-ramo-padrao");
  }

  if (amend) {
    if (!(await temCommits(raiz, op))) throw new CommitRecusadoErro("Não há commit para emendar.", "amend-sem-commit");
    const pub = await ultimoCommitPublicado(raiz, op);
    if (pub.publicado) throw new CommitRecusadoErro(`O último commit já foi publicado${pub.remotas.length ? ` (${pub.remotas.join(", ")})` : ""}; emendar reescreveria o histórico remoto.`, "amend-publicado", pub.remotas);
  }

  if (conventional === true && mensagemOriginal.trim() !== "" && !RE_CONVENTIONAL.test(mensagemOriginal.split("\n")[0] ?? "")) {
    throw new CommitRecusadoErro("O assunto precisa seguir conventional commits: tipo(escopo): descrição.", "conventional");
  }
  const avisos = mensagemOriginal.trim() === "" ? [] : avisosDaMensagem(mensagemOriginal, conventional);

  const mensagem = mensagemOriginal.trim() === "" ? "" : await comTrailers(raiz, mensagemOriginal, coautores, op);
  const args = ["commit", ...(amend ? ["--amend"] : []), ...(pularHooks === true ? ["--no-verify"] : []), ...(mensagem === "" ? ["--no-edit"] : ["-F", "-"])];
  let saida = "";
  const junta = (fluxo: "stdout" | "stderr") => (b: Buffer): void => {
    const t = b.toString("utf8");
    saida += t;
    aoSaida?.(t, fluxo);
  };
  let r;
  try {
    r = await escrita(raiz, args, {
      ...op,
      ...(mensagem === "" ? {} : { stdin: mensagem }),
      timeoutMs,
      tolerar: Array.from({ length: 255 }, (_, i) => i + 1),
      aoStdout: junta("stdout"),
      aoStderr: junta("stderr"),
      acumular: true,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new CommitFalhouErro(`O commit não foi feito: ${m}`, saida || m, mensagemOriginal, "falhou", null);
  }
  if (r.codigo !== 0) {
    const sem = /nothing (added )?to commit|no changes added to commit|nothing to commit/i.test(`${r.stdout}\n${r.stderr}`);
    throw new CommitFalhouErro(sem ? "Não há nada no índice para comitar." : `O commit falhou (código ${r.codigo}); sua mensagem foi preservada.`, saida, mensagemOriginal, sem ? "sem-mudancas" : "falhou", r.codigo);
  }
  const hash = (await rodarGit(raiz, ["rev-parse", "HEAD"], op)).stdout.trim();
  const assunto = (await rodarGit(raiz, ["log", "-1", "--format=%s", "HEAD"], op)).stdout.trim();
  return { hash, hashCurto: hash.slice(0, 7), assunto, amend, hooksPulados: pularHooks === true, avisos, saida };
}
