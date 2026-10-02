// Canais `vcs:*` (Fase 6E, T-06.31..37): validadores ESTRITOS. O renderer nunca manda caminho absoluto nem cwd: só ids, caminhos RELATIVOS
// (não confiáveis: AUD-23; a validação definitiva é do núcleo) e nomes de ref. Cada família valida `op` e depois o objeto estrito da op.
import type {
  AlvoVcs,
  Familia,
  OperacoesCommit,
  OperacoesConflitos,
  OperacoesEstagio,
  OperacoesForge,
  OperacoesHistorico,
  OperacoesMissao,
  OperacoesOperacao,
  OperacoesRamos,
  OperacoesRemoto,
  OperacoesStash,
  OperacoesSvn,
  PedidoDiff,
} from "../../compartilhado/vcs";
import type { PassoRebase, Resolucao } from "../../compartilhado/vcs-tipos";
import { vIdMissao, vIdWorkspace, vOuNulo } from "./comum-dominio";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

// ---- primitivas -------------------------------------------------------------------------------

/** Caminho relativo à raiz: sem NUL, sem `/` nem unidade inicial, sem `..`, sem `-` inicial; ≤ 4096. */
export const vCaminhoRel: Validador<string> = (v) => {
  if (typeof v !== "string" || v === "") return falha("caminho inválido");
  if (v.length > 4096 || v.includes("\0")) return falha("caminho inválido");
  if (v.startsWith("/") || v.startsWith("\\") || /^[A-Za-z]:/.test(v) || v.startsWith("-")) return falha("caminho inválido");
  if (v.split(/[\\/]/).some((p) => p === "..")) return falha("caminho inválido");
  return { ok: true, valor: v };
};
const vCaminhos = vLista(vCaminhoRel, 20_000);

/** Nome de ref (branch/tag/remoto/upstream): conservador. A validação definitiva é do núcleo (`check-ref-format`). */
export const vNomeRef = vTexto({ min: 1, max: 255, padrao: /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_][A-Za-z0-9_./+-]*$/ });
/** Revisão (hash, ref, `HEAD~2`, `origem/main`): sem `..`, sem `@{`, sem `-` inicial. */
export const vRev = vTexto({ min: 1, max: 255, padrao: /^(?!.*\.\.)(?!.*@\{)[A-Za-z0-9_][A-Za-z0-9_./+~^-]*$/ });
const vHash = vTexto({ min: 7, max: 64, padrao: /^[0-9a-fA-F]{7,64}$/ });
const vMsg = vTexto({ max: 200_000 }); // vazio é permitido (amend) — o núcleo exige quando preciso
const vTextoCurto = (max: number) => vTexto({ max, padrao: /^[^\0]*$/ });
const vRotuloCurto = vTexto({ min: 1, max: 255, padrao: /^[^\0\r\n]+$/ });
const vNum = (min: number, max: number) => vInteiro({ min, max });
const vPadrao = vTexto({ min: 1, max: 1024, padrao: /^[^\0\r\n]+$/ });
const vRemoto = vTexto({ min: 1, max: 100, padrao: /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/ });
/** Caminho dentro do repositório SVN (`branches/x`, `^/trunk`). */
const vCaminhoSvn = vTexto({ min: 1, max: 512, padrao: /^(?!.*\.\.)\^?\/?[A-Za-z0-9_][A-Za-z0-9_./ +-]*$/ });
const vCoautor = vTexto({ min: 3, max: 300, padrao: /^[^<>\r\n\0]+ <[^<>\s]+@[^<>\s]+>$/ });
const vNulo = vOuNulo;

const ALVO = { workspace_id: vIdWorkspace, mission_id: vOuNulo(vIdMissao) } as const;

type Campos = Record<string, Validador<unknown>>;
type Saida<C extends Campos> = { [K in keyof C]: C[K] extends Validador<infer T> ? T : never };

function op<N extends string, C extends Campos>(nome: N, campos: C): Validador<{ op: N } & AlvoVcs & Saida<C>> {
  return vObjeto({ ...ALVO, op: vEnum([nome] as const), ...campos }) as unknown as Validador<{ op: N } & AlvoVcs & Saida<C>>;
}
function opMissao<N extends string, C extends Campos>(nome: N, campos: C): Validador<{ op: N; mission_id: string } & Saida<C>> {
  return vObjeto({ mission_id: vIdMissao, op: vEnum([nome] as const), ...campos }) as unknown as Validador<{ op: N; mission_id: string } & Saida<C>>;
}

const sem = {};

type ValidadoresOps<F extends Familia, A extends object> = { [K in keyof F & string]: Validador<{ op: K } & A & F[K]["entrada"]> };

/** Escolhe o validador pela `op` (string conhecida); op desconhecida ou ausente é erro. */
export function vUniaoOp<T>(mapa: Readonly<Record<string, Validador<unknown>>>): Validador<T> {
  return (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
    const o = (v as Record<string, unknown>)["op"];
    if (typeof o !== "string" || !Object.prototype.hasOwnProperty.call(mapa, o)) return falha("op: valor fora do conjunto");
    return (mapa[o] as Validador<T>)(v);
  };
}

// ---- famílias ---------------------------------------------------------------------------------

const resolucoes: Validador<Record<string, Resolucao>> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  const chaves = Object.keys(v);
  if (chaves.length > 10_000) return falha("resoluções demais");
  const saida: Record<string, Resolucao> = {};
  for (const k of chaves) {
    if (!/^\d{1,6}$/.test(k)) return falha("índice de hunk inválido");
    const x = (v as Record<string, unknown>)[k];
    if (x === "nossa" || x === "deles" || x === "base" || x === "ambas") saida[k] = x;
    else if (typeof x === "object" && x !== null && Object.keys(x).length === 1 && typeof (x as { editar?: unknown }).editar === "string" && ((x as { editar: string }).editar.length <= 2_000_000) && !(x as { editar: string }).editar.includes("\0")) saida[k] = { editar: (x as { editar: string }).editar };
    else return falha("resolução inválida");
  }
  return { ok: true, valor: saida };
};

const ESTAGIO = {
  estagiar: op("estagiar", { caminhos: vCaminhos }),
  desestagiar: op("desestagiar", { caminhos: vCaminhos }),
  hunk: op("hunk", { sentido: vEnum(["estagiar", "desestagiar"] as const), caminho: vCaminhoRel, hunk: vNum(0, 100_000), linhas: vNulo(vLista(vNum(0, 1_000_000), 100_000)) }),
  ignorar: op("ignorar", { padroes: vLista(vPadrao, 1000) }),
  descartar: op("descartar", { caminhos: vCaminhos, incluir_staged: vBooleano, simular: vBooleano, confirmar: vBooleano }),
  desfazer_descarte: op("desfazer_descarte", { id: vTexto({ min: 1, max: 80, padrao: /^[0-9a-z-]+$/ }) }),
  descartes_listar: op("descartes_listar", sem),
} satisfies ValidadoresOps<OperacoesEstagio, AlvoVcs>;

const COMMIT = {
  criar: op("criar", { mensagem: vNulo(vMsg), amend: vBooleano, pular_hooks: vBooleano, coautores: vLista(vCoautor, 20) }),
  modelo: op("modelo", sem),
  ultimo_publicado: op("ultimo_publicado", sem),
} satisfies ValidadoresOps<OperacoesCommit, AlvoVcs>;

const RAMOS = {
  listar: op("listar", { remotos: vBooleano }),
  criar: op("criar", { nome: vNomeRef, de: vNulo(vRev), trocar: vBooleano }),
  trocar: op("trocar", { destino: vRev, estrategia: vNulo(vEnum(["cancelar", "levar", "stash"] as const)) }),
  renomear: op("renomear", { de: vNomeRef, para: vNomeRef }),
  apagar: op("apagar", { nome: vNomeRef, forcar: vBooleano, simular: vBooleano, confirmacao: vNulo(vNomeRef) }),
  upstream_definir: op("upstream_definir", { ramo: vNomeRef, upstream: vNomeRef }),
  upstream_remover: op("upstream_remover", { ramo: vNomeRef }),
  padrao: op("padrao", sem),
  tags_listar: op("tags_listar", sem),
  tag_criar: op("tag_criar", { nome: vNomeRef, de: vNulo(vRev), mensagem: vNulo(vTextoCurto(10_000)) }),
  tag_apagar: op("tag_apagar", { nome: vNomeRef }),
  worktrees_listar: op("worktrees_listar", { com_estado: vBooleano }),
} satisfies ValidadoresOps<OperacoesRamos, AlvoVcs>;

const STASH = {
  listar: op("listar", sem),
  criar: op("criar", { mensagem: vNulo(vTextoCurto(500)), nao_rastreados: vBooleano, manter_indice: vBooleano }),
  aplicar: op("aplicar", { indice: vNum(0, 100_000), restaurar_indice: vBooleano }),
  pop: op("pop", { indice: vNum(0, 100_000), restaurar_indice: vBooleano }),
  apagar: op("apagar", { indice: vNum(0, 100_000) }),
  restaurar_apagado: op("restaurar_apagado", { hash: vHash, mensagem: vTextoCurto(500) }),
  diff: op("diff", { indice: vNum(0, 100_000) }),
} satisfies ValidadoresOps<OperacoesStash, AlvoVcs>;

const vCursor = vObjeto({ hash: vHash, indice: vNum(0, 10_000_000), pistas: vLista(vNulo(vHash), 512) });
const HISTORICO = {
  log: op("log", { limite: vNulo(vNum(1, 5000)), cursor: vNulo(vCursor), rev: vNulo(vRev), todos: vBooleano, busca: vNulo(vTextoCurto(500)), regex: vBooleano, autor: vNulo(vTextoCurto(200)), caminho: vNulo(vCaminhoRel) }),
  arquivo: op("arquivo", { caminho: vCaminhoRel, limite: vNulo(vNum(1, 5000)) }),
  detalhe: op("detalhe", { rev: vRev }),
  blame: op("blame", { caminho: vCaminhoRel, rev: vNulo(vRev) }),
  reflog: op("reflog", { ramo: vNulo(vNomeRef), limite: vNulo(vNum(1, 1000)) }),
  desfazer_ultima: op("desfazer_ultima", { simular: vBooleano }),
} satisfies ValidadoresOps<OperacoesHistorico, AlvoVcs>;

const REMOTO = {
  listar: op("listar", sem),
  fetch: op("fetch", { remoto: vNulo(vRemoto), todos: vBooleano, podar: vBooleano }),
  pull: op("pull", { modo: vNulo(vEnum(["ff-only", "merge", "rebase", "config"] as const)), remoto: vNulo(vRemoto), ramo: vNulo(vNomeRef), simular: vBooleano }),
  push: op("push", { remoto: vNulo(vRemoto), ramo: vNulo(vNomeRef) }),
  lease: op("lease", { remoto: vNulo(vRemoto), ramo: vNomeRef, ref_esperada: vHash, confirmacao: vNulo(vNomeRef), simular: vBooleano }),
  preferencia_pull: op("preferencia_pull", sem),
} satisfies ValidadoresOps<OperacoesRemoto, AlvoVcs>;

const vRevs = vLista(vRev, 500);
/** Passo do rebase interativo: `mensagem` é opcional (obrigatória só em `reword`, o núcleo confere). */
const vPasso: Validador<PassoRebase> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "acao" && k !== "hash" && k !== "mensagem") return falha(`campo desconhecido: ${k}`);
  const a = vEnum(["pick", "reword", "edit", "squash", "fixup", "drop"] as const)(o["acao"]);
  if (!a.ok) return falha(`acao: ${a.erro}`);
  const h = vHash(o["hash"]);
  if (!h.ok) return falha(`hash: ${h.erro}`);
  if (o["mensagem"] === undefined) return { ok: true, valor: { acao: a.valor, hash: h.valor } };
  const m = vTextoCurto(10_000)(o["mensagem"]);
  return m.ok ? { ok: true, valor: { acao: a.valor, hash: h.valor, mensagem: m.valor } } : falha(`mensagem: ${m.erro}`);
};
const OPERACAO = {
  estado: op("estado", sem),
  mesclar: op("mesclar", { rev: vRev, sem_ff: vBooleano, squash: vBooleano, mensagem: vNulo(vTextoCurto(10_000)), simular: vBooleano }),
  cherry_pick: op("cherry_pick", { revs: vRevs, mainline: vNulo(vNum(1, 16)), simular: vBooleano }),
  reverter: op("reverter", { revs: vRevs, mainline: vNulo(vNum(1, 16)), simular: vBooleano }),
  rebase: op("rebase", { base: vRev, simular: vBooleano }),
  rebase_interativo: op("rebase_interativo", {
    base: vRev,
    passos: vLista(vPasso, 1000),
    simular: vBooleano,
    forcar: vBooleano,
  }),
  continuar: op("continuar", sem),
  abortar: op("abortar", sem),
  pular: op("pular", sem),
} satisfies ValidadoresOps<OperacoesOperacao, AlvoVcs>;

const CONFLITOS = {
  listar: op("listar", sem),
  ler: op("ler", { caminho: vCaminhoRel }),
  resolver_hunks: op("resolver_hunks", { caminho: vCaminhoRel, resolucoes, marcar: vBooleano }),
  resolver_arquivo: op("resolver_arquivo", { caminho: vCaminhoRel, escolha: vEnum(["nossa", "deles", "remover"] as const) }),
  marcar_resolvido: op("marcar_resolvido", { caminho: vCaminhoRel }),
} satisfies ValidadoresOps<OperacoesConflitos, AlvoVcs>;

const SVN = {
  info: op("info", sem),
  status_servidor: op("status_servidor", sem),
  atualizar: op("atualizar", { revisao: vNulo(vNum(0, 2_000_000_000)), caminhos: vNulo(vCaminhos) }),
  commit: op("commit", { mensagem: vMsg, caminhos: vNulo(vCaminhos), changelist: vNulo(vRotuloCurto) }),
  adicionar: op("adicionar", { caminhos: vCaminhos }),
  remover: op("remover", { caminhos: vCaminhos, manter_local: vBooleano }),
  reverter: op("reverter", { caminhos: vCaminhos, confirmar: vBooleano }),
  resolver: op("resolver", { caminhos: vCaminhos, aceitar: vEnum(["working", "base", "mine-full", "theirs-full", "mine-conflict", "theirs-conflict"] as const) }),
  limpar: op("limpar", sem),
  log: op("log", { limite: vNulo(vNum(1, 5000)), desde: vNulo(vNum(0, 2_000_000_000)), caminho: vNulo(vCaminhoRel) }),
  blame: op("blame", { caminho: vCaminhoRel, revisao: vNulo(vNum(0, 2_000_000_000)) }),
  conflitos: op("conflitos", sem),
  ramos_listar: op("ramos_listar", { tipo: vEnum(["branches", "tags"] as const) }),
  trocar: op("trocar", { destino: vCaminhoSvn }),
  mesclar: op("mesclar", { de: vCaminhoSvn, revisoes: vLista(vNum(1, 2_000_000_000), 1000), simular: vBooleano }),
  ramo_criar: op("ramo_criar", { tipo: vEnum(["branch", "tag"] as const), nome: vNomeRef, mensagem: vNulo(vTextoCurto(10_000)), confirmado_servidor: vBooleano }),
  auth_verificar: op("auth_verificar", sem),
} satisfies ValidadoresOps<OperacoesSvn, AlvoVcs>;

const FORGE = {
  estado: op("estado", sem),
  prs_listar: op("prs_listar", { estado: vEnum(["aberto", "fechado", "mesclado", "todos"] as const), limite: vNulo(vNum(1, 200)) }),
  pr_ver: op("pr_ver", { numero: vNum(1, 100_000_000) }),
  pr_criar: op("pr_criar", { titulo: vTexto({ min: 1, max: 256, padrao: /^[^\0\r\n]+$/ }), corpo: vNulo(vTextoCurto(65_536)), base: vNulo(vNomeRef), head: vNulo(vNomeRef), rascunho: vBooleano }),
  checks_do_pr: op("checks_do_pr", { numero: vNum(1, 100_000_000) }),
  issues_listar: op("issues_listar", { estado: vEnum(["aberta", "fechada", "todas"] as const), limite: vNulo(vNum(1, 200)) }),
} satisfies ValidadoresOps<OperacoesForge, AlvoVcs>;

const MISSAO = {
  resumo: opMissao("resumo", sem),
  commits: opMissao("commits", sem),
  diff_base: opMissao("diff_base", { caminho: vNulo(vCaminhoRel) }),
  comparar: opMissao("comparar", sem),
} satisfies ValidadoresOps<OperacoesMissao, { mission_id: string }>;

/** Ops de cada família (usadas pelo teste de contrato; o tsc garante que batem com `compartilhado/vcs.ts` pelos `satisfies` acima). */
export const OPS_VCS = {
  "vcs:estagio": Object.keys(ESTAGIO),
  "vcs:commit": Object.keys(COMMIT),
  "vcs:ramos": Object.keys(RAMOS),
  "vcs:stash": Object.keys(STASH),
  "vcs:historico": Object.keys(HISTORICO),
  "vcs:remoto": Object.keys(REMOTO),
  "vcs:operacao": Object.keys(OPERACAO),
  "vcs:conflitos": Object.keys(CONFLITOS),
  "vcs:svn": Object.keys(SVN),
  "vcs:forge": Object.keys(FORGE),
  "vcs:missao": Object.keys(MISSAO),
} as const;

const uniao = <_K extends string, T>(mapa: Record<string, Validador<unknown>>): Validador<T> => vUniaoOp<T>(mapa);

const vDiff: Validador<PedidoDiff> = vObjeto({
  ...ALVO,
  caminho: vNulo(vCaminhoRel),
  staged: vBooleano,
  base: vNulo(vRev),
  palavra: vBooleano,
  contexto: vNulo(vNum(0, 200)),
  nao_rastreado: vBooleano,
  limite_bytes: vNulo(vNum(1024, 64 * 1024 * 1024)),
}) as Validador<PedidoDiff>;

export const VALIDADORES_VCS = {
  "vcs:estado": vObjeto({ ...ALVO, ignorados: vBooleano }),
  "vcs:observar": vObjeto({ ...ALVO, ativo: vBooleano }),
  "vcs:diff": vDiff,
  "vcs:estagio": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:estagio"]["entrada"]>(ESTAGIO),
  "vcs:commit": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:commit"]["entrada"]>(COMMIT),
  "vcs:ramos": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:ramos"]["entrada"]>(RAMOS),
  "vcs:stash": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:stash"]["entrada"]>(STASH),
  "vcs:historico": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:historico"]["entrada"]>(HISTORICO),
  "vcs:remoto": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:remoto"]["entrada"]>(REMOTO),
  "vcs:operacao": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:operacao"]["entrada"]>(OPERACAO),
  "vcs:conflitos": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:conflitos"]["entrada"]>(CONFLITOS),
  "vcs:svn": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:svn"]["entrada"]>(SVN),
  "vcs:forge": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:forge"]["entrada"]>(FORGE),
  "vcs:missao": uniao<"", import("../../compartilhado/ipc").CanaisInvoke["vcs:missao"]["entrada"]>(MISSAO),
} as const;

export type CanalVcs = keyof typeof VALIDADORES_VCS;
export const CANAIS_VCS = Object.keys(VALIDADORES_VCS) as CanalVcs[];
