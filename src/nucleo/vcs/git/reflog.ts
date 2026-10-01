import { escrita, ramoAtual, resolverRev, rodarGit, validarNomeRef, type OpcoesBase } from "./comum";
import { guardaAutomacao, type OrigemOperacao } from "./guardas";
import { estadoOperacao } from "./merge";
import { remotasQueContem } from "./commit";

// T-06.14 · Reflog e "desfazer a última operação" SOMENTE quando seguro. Usa `reset --soft` (commit/amend: as mudanças
// ficam no índice) ou `reset --keep` (merge/pull/rebase/cherry-pick/revert: a árvore volta, mas o git recusa se houver
// mudança não comitada que seria perdida). NUNCA `--hard`. O reflog é local e expira: só confiamos nele se a entrada
// do topo ainda aponta para o HEAD atual.

export interface EntradaReflog {
  /** Posição (0 = mais recente). */
  indice: number;
  /** Commit para o qual a ref apontou nesta entrada. */
  hash: string;
  seletor: string;
  /** Ex.: `commit: msg`, `merge x: Fast-forward`, `checkout: moving from a to b`. */
  assunto: string;
  /** ISO 8601. */
  data: string;
  tipo: TipoOperacaoReflog;
}

export type TipoOperacaoReflog = "commit" | "commit-inicial" | "amend" | "merge" | "pull" | "rebase" | "cherry-pick" | "revert" | "checkout" | "reset" | "outro";

export function tipoDoAssunto(assunto: string): TipoOperacaoReflog {
  if (/^commit \(initial\)/.test(assunto)) return "commit-inicial";
  if (/^commit \(amend\)/.test(assunto)) return "amend";
  if (/^commit \(merge\)/.test(assunto) || /^merge[ :]/.test(assunto)) return "merge";
  if (/^commit \(cherry-pick\)|^cherry-pick/.test(assunto)) return "cherry-pick";
  if (/^revert/.test(assunto)) return "revert";
  if (/^commit/.test(assunto)) return "commit";
  if (/^pull/.test(assunto)) return "pull";
  if (/^rebase/.test(assunto)) return "rebase";
  if (/^(checkout|switch)/.test(assunto)) return "checkout";
  if (/^reset/.test(assunto)) return "reset";
  return "outro";
}

/** Reflog de HEAD (padrão) ou de uma branch local. */
export async function listarReflog(raiz: string, opcoes: OpcoesBase & { ramo?: string; limite?: number } = {}): Promise<EntradaReflog[]> {
  const { ramo, limite = 100, ...op } = opcoes;
  const ref = ramo === undefined ? "HEAD" : `refs/heads/${await validarNomeRef(raiz, ramo, "heads", op)}`;
  const n = Math.min(2000, Math.max(1, Math.floor(limite)));
  const r = await rodarGit(raiz, ["reflog", "show", "--format=%H%x00%gd%x00%gs%x00%cI", `-n${n}`, ref, "--"], { ...op, tolerar: [128] });
  if (r.codigo !== 0) return [];
  const out: EntradaReflog[] = [];
  for (const l of r.stdout.split("\n")) {
    const c = l.split("\0");
    if (c.length < 4 || !/^[0-9a-f]{40,64}$/.test(c[0] as string)) continue;
    out.push({ indice: out.length, hash: c[0] as string, seletor: c[1] as string, assunto: c[2] as string, data: c[3] as string, tipo: tipoDoAssunto(c[2] as string) });
  }
  return out;
}

export type ResultadoDesfazerOperacao =
  | { seguro: false; motivo: string }
  | { seguro: true; operacao: TipoOperacaoReflog; de: string; para: string; modo: "soft" | "keep"; desfeito: boolean; /** Arquivos cujo conteúdo muda ao voltar (e, em `soft`, nenhum). */ mudariam: string[] };

const naoSeguro = (motivo: string): ResultadoDesfazerOperacao => ({ seguro: false, motivo });

/**
 * Desfaz a última operação se (e só se) for segura. `simular: true` calcula tudo e não mexe em nada.
 * Seguro = sem operação em curso; última entrada do reflog é commit/amend/merge/pull/rebase/cherry-pick/revert e
 * corresponde ao HEAD; commit ainda não publicado; e nenhuma mudança não comitada seria perdida.
 */
export async function desfazerUltimaOperacao(raiz: string, opcoes: OpcoesBase & { origem?: OrigemOperacao; simular?: boolean } = {}): Promise<ResultadoDesfazerOperacao> {
  const { origem = "usuario", simular, ...op } = opcoes;
  await guardaAutomacao(raiz, origem, "desfazer", op);
  const est = await estadoOperacao(raiz, op);
  if (est.operacao !== null) return naoSeguro(`Há um ${est.operacao} em andamento; conclua ou aborte antes de desfazer.`);
  if ((await ramoAtual(raiz, op)) === null) return naoSeguro("HEAD destacado: troque para uma branch antes de desfazer.");
  const e = await listarReflog(raiz, { ...op, limite: 400 });
  const topo = e[0];
  if (topo === undefined) return naoSeguro("Reflog vazio.");
  const head = await resolverRev(raiz, "HEAD", op);
  if (topo.hash !== head) return naoSeguro("O reflog não corresponde ao HEAD atual; nada foi desfeito.");
  let alvo: EntradaReflog | undefined;
  const tipo = topo.tipo;
  if (tipo === "checkout" || tipo === "reset" || tipo === "outro") return naoSeguro(`A última operação (${topo.assunto.split(":")[0]}) não é desfeita automaticamente: use o reflog manualmente.`);
  if (tipo === "commit-inicial") return naoSeguro("É o primeiro commit do repositório: não há estado anterior.");
  if (/\(finish\)/.test(topo.assunto) && (tipo === "rebase" || tipo === "pull")) {
    const ini = e.findIndex((x, i) => i > 0 && /\(start\)/.test(x.assunto));
    alvo = ini < 0 ? undefined : e[ini + 1];
  } else alvo = e[1];
  if (alvo === undefined) return naoSeguro("Não há estado anterior no reflog.");
  if (alvo.hash === head) return naoSeguro("A última operação não alterou o HEAD.");
  if (tipo !== "pull") {
    const pub = await remotasQueContem(raiz, op);
    if (pub.length > 0) return naoSeguro(`O resultado já foi publicado (${pub.join(", ")}); desfazer localmente reescreveria o histórico.`);
  }
  const modo: "soft" | "keep" = tipo === "commit" || tipo === "amend" ? "soft" : "keep";
  const d = await rodarGit(raiz, ["diff", "--name-only", "-z", alvo.hash, head, "--"], op);
  const mudariam = modo === "soft" ? [] : d.stdout.split("\0").filter((x) => x !== "");
  const base = { seguro: true as const, operacao: tipo, de: head, para: alvo.hash, modo, mudariam };
  if (simular === true) return { ...base, desfeito: false };
  const r = await escrita(raiz, ["reset", `--${modo}`, alvo.hash], { ...op, tolerar: [1, 128] });
  if (r.codigo !== 0) {
    const arqs = [...r.stderr.matchAll(/^\s+(\S.*)$/gm)].map((m) => (m[1] as string).trim()).filter((x) => !/^(Please|Aborting|error)/i.test(x));
    return naoSeguro(`Há mudanças não comitadas que seriam perdidas${arqs.length ? ` (${arqs.slice(0, 5).join(", ")})` : ""}; nada foi desfeito. Comite ou guarde-as no stash primeiro.`);
  }
  return { ...base, desfeito: true };
}
