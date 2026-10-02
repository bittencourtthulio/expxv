// T-16.16 · PISO invariante (I1..I10): nunca cai, em nível algum. `verificarPiso` é PURO (≤ 20 ms) e devolve ok | violado | nao_comprovado
// (`nao_comprovado` NUNCA é tratado como ok). `varrerDiff` procura segredo no diff e reporta ARQUIVO e PADRÃO, nunca o valor.
import type { EtapaDoPlano, EtapaId, NivelRigidez, PipelineId } from "../../../compartilhado/maestro";
import type { PermissaoMembro } from "../../../compartilhado/squads";
import { PRODUTO } from "../../produto";
import type { RelatorioRapido, TrabalhoParaMaestro } from "../etapas/conclusao";
import { etapasDePisoAplicaveis, type EvidenciaDoDisco } from "./plano-de-etapas";
import { SEGURANCA } from "./matriz";

export type EstadoPiso = "ok" | "violado" | "nao_comprovado";
export type IdPiso = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7" | "I8" | "I9" | "I10";
export interface ItemDePiso {
  id: IdPiso;
  titulo: string;
  estado: EstadoPiso;
  detalhe: string;
}
export const TITULOS_PISO: Readonly<Record<IdPiso, string>> = {
  I1: "comportamento alterado tem teste",
  I2: "suíte verde",
  I3: "sem segredo no diff",
  I4: "nenhuma operação git destrutiva",
  I5: "avaliador separado do implementador",
  I6: "ações humanas continuam humanas",
  I7: "escrita só onde permitido",
  I8: "hooks de segurança intactos",
  I9: "push/PR só com consentimento",
  I10: "etapas de piso não omitidas",
};

// ---------------------------------------------------------------- git destrutivo (permissions.deny por Pane do Claude)
export const DENY_GIT: readonly string[] = [
  "Bash(git push --force*)", "Bash(git push -f*)", "Bash(git reset --hard*)", "Bash(git clean -f*)", "Bash(git checkout .)", "Bash(git branch -D*)", "Bash(git push origin :*)",
];
/** `duro` só onde o ADE realmente impõe (Claude, por `permissions.deny`); nas demais CLIs é instrução + guard rails do ADE (`parcial`). */
export const isolamentoDoPiso = (cli: string | null | undefined): "duro" | "parcial" => (cli === "claude" ? "duro" : "parcial");

// ---------------------------------------------------------------- relatório do pipeline rápido
export function lerRelatorioRapido(texto: string | null | undefined): RelatorioRapido | null {
  if (typeof texto !== "string" || texto.length > 20_000) return null;
  const teste = /^\s*teste_criado\s*:\s*(sim|nao|não)\s*$/im.exec(texto);
  const suite = /^\s*suite\s*:\s*(verde|vermelha)\s*$/im.exec(texto);
  if (teste === null || suite === null) return null;
  return { teste_criado: (teste[1] as string).toLowerCase() === "sim", suite: (suite[1] as string).toLowerCase() as "verde" | "vermelha" };
}

// ---------------------------------------------------------------- varredura de segredo no diff
export interface AchadoSegredo {
  arquivo: string;
  padrao: string;
}
const PADROES: ReadonlyArray<[nome: string, re: RegExp]> = [
  ["chave sk-", /\bsk-(?:or-)?[A-Za-z0-9_-]{20,}/],
  ["token GitHub", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["chave AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["token Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["chave de API Google", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["chave privada", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
];
const ARQUIVOS_SENSIVEIS = /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]+)?|id_(?:rsa|ed25519|ecdsa|dsa)[^/]*|[^/]+\.(?:pem|key|p12|pfx))$/i;
const LONGA = /[A-Za-z0-9+/_=-]{32,}/g;
const MAX_DIFF = 2_000_000;

function entropia(s: string): number {
  const f = new Map<string, number>();
  for (const c of s) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of f.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}
const pareceSegredoLongo = (t: string): boolean => /[0-9]/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t) && entropia(t) >= 4.2 && !/^[0-9a-f]{40,64}$/i.test(t);

/** Varre o TEXTO de um diff unificado: só linhas adicionadas; devolve arquivo + padrão (nunca o valor). */
export function varrerDiff(diff: string): AchadoSegredo[] {
  const saida: AchadoSegredo[] = [];
  const visto = new Set<string>();
  const marcar = (arquivo: string, padrao: string): void => {
    const k = `${arquivo}\u0000${padrao}`;
    if (!visto.has(k)) {
      visto.add(k);
      saida.push({ arquivo, padrao });
    }
  };
  let arquivo = "(desconhecido)";
  for (const linha of (diff.length > MAX_DIFF ? diff.slice(0, MAX_DIFF) : diff).split("\n")) {
    if (linha.startsWith("+++ ")) {
      arquivo = linha.slice(4).replace(/^b\//, "").trim();
      if (arquivo !== "/dev/null" && ARQUIVOS_SENSIVEIS.test(arquivo)) marcar(arquivo, "arquivo sensível");
      continue;
    }
    if (linha.startsWith("diff --git ")) {
      const m = / b\/(.+)$/.exec(linha);
      if (m !== null) {
        arquivo = m[1] as string;
        if (ARQUIVOS_SENSIVEIS.test(arquivo)) marcar(arquivo, "arquivo sensível");
      }
      continue;
    }
    if (!linha.startsWith("+") || linha.startsWith("+++")) continue;
    const corpo = linha.slice(1);
    for (const [nome, re] of PADROES) if (re.test(corpo)) marcar(arquivo, nome);
    for (const m of corpo.matchAll(LONGA)) if (pareceSegredoLongo(m[0])) marcar(arquivo, "sequência de alta entropia");
  }
  return saida;
}

/**
 * Redige segredos do TEXTO do pedido ANTES de ele virar argumento de terminal, `pedido.md` ou qualquer registro: chaves conhecidas, blocos de chave privada,
 * `NOME_SECRETO=valor` e sequências longas de alta entropia. O resto do texto fica exatamente como o usuário escreveu (não é um resumo).
 */
export function redigirSegredosNoTexto(texto: string): { texto: string; redigiu: boolean } {
  let t = texto;
  let n = 0;
  const trocar = (re: RegExp, por: string | ((m: string, ...g: string[]) => string)): void => {
    t = t.replace(re, (...args: unknown[]) => {
      n++;
      return typeof por === "string" ? por : por(...(args as [string, ...string[]]));
    });
  };
  trocar(/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----|$)/g, "[segredo]");
  for (const [nome, re] of PADROES) if (nome !== "chave privada") trocar(new RegExp(re.source, "g"), "[segredo]");
  trocar(/\b([A-Za-z_][A-Za-z0-9_]{0,63}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|SENHA|CREDENTIAL|APIKEY)[A-Za-z0-9_]{0,20})(\s*[=:]\s*)(?!\[segredo\])["']?[^\s"']{6,}["']?/gi, (_m, nome: string, sep: string) => `${nome}${sep}[segredo]`);
  trocar(LONGA, (m) => (pareceSegredoLongo(m) ? "[segredo]" : m));
  return { texto: t, redigiu: n > 0 && t !== texto };
}

export interface PortaDiff {
  /** texto do diff unificado do trabalho (somente leitura; `GIT_OPTIONAL_LOCKS=0` fica com a implementação). */
  diff(): Promise<string>;
}
export async function varrerSegredosNoDiff(vcs: PortaDiff): Promise<AchadoSegredo[] | null> {
  try {
    return varrerDiff(await vcs.diff());
  } catch {
    return null; // não comprovado
  }
}

// ---------------------------------------------------------------- verificação
export interface ExecParaPiso {
  etapa_id: EtapaId;
  tipo: EtapaDoPlano["tipo"];
  pane_id: string | null;
  reutilizou_pane: boolean;
  perfil: { cli: string; modelo: string | null } | null;
  /** foi realmente despachada (comando digitado). */
  despachada?: boolean;
  comando?: string | null;
}
export interface EntradaPiso {
  pipeline_id: PipelineId;
  nivel: NivelRigidez;
  evidencia: EvidenciaDoDisco;
  trabalho: TrabalhoParaMaestro | null;
  /** violações do modelo do método (regras.ts). */
  violacoes?: ReadonlyArray<{ tipo: string; alvo?: string }>;
  rastro?: { suite_ok_apos_ultima_alteracao: boolean | null; acoes_bloqueadas?: number };
  rapido?: RelatorioRapido | null | undefined;
  /** `null`/ausente = não varrido. */
  segredos?: AchadoSegredo[] | null;
  plano: ReadonlyArray<Pick<EtapaDoPlano, "etapa_id" | "estado_inicial" | "comando">>;
  execs?: readonly ExecParaPiso[];
  cli_implementador?: string | null;
  /** caminhos (relativos) que o ADE escreveu neste pipeline. */
  escritas?: readonly string[];
  /** chaves de segurança que o USUÁRIO rebaixou no hooks.json (o ADE só avisa). */
  seguranca_rebaixada_pelo_usuario?: readonly string[];
  /** chaves que o ADE escreveu no hooks.json. */
  hooks_escritos?: readonly string[];
  permissao?: PermissaoMembro;
  pr_confirmado?: boolean;
}

const item = (id: IdPiso, estado: EstadoPiso, detalhe: string): ItemDePiso => ({ id, titulo: TITULOS_PISO[id], estado, detalhe });
const IMPLEMENTADORES = new Set(["implementador"]);

function tasksDe(t: TrabalhoParaMaestro | null): Array<TrabalhoParaMaestro["sprints"][number]["fases"][number]["tasks"][number]> {
  return t === null ? [] : t.sprints.flatMap((s) => s.fases.flatMap((f) => f.tasks));
}

function verificarI1(e: EntradaPiso): ItemDePiso {
  if (e.pipeline_id === "rapido") {
    if (e.rapido === undefined || e.rapido === null) return item("I1", "nao_comprovado", "rapido-relatorio.md ausente ou inválido");
    return e.rapido.teste_criado ? item("I1", "ok", "teste criado (relatório rápido)") : item("I1", "violado", "relatório rápido diz teste_criado: nao");
  }
  const sem = (e.violacoes ?? []).filter((v) => v.tipo === "teste_ausente" || v.tipo === "regressao_ausente");
  if (sem.length > 0) return item("I1", "violado", `task sem teste: ${sem.map((v) => v.alvo ?? "?").slice(0, 5).join(", ")}`);
  const concluidas = tasksDe(e.trabalho).filter((t) => t.status === "concluida");
  const orfas = concluidas.filter((t) => !t.teste_integracao && !t.teste_funcional && !t.teste_regressao);
  if (orfas.length > 0) return item("I1", "violado", `task concluída sem teste: ${orfas.map((t) => t.id).slice(0, 5).join(", ")}`);
  if (concluidas.length === 0) return item("I1", "nao_comprovado", "nenhuma task concluída ainda");
  return item("I1", "ok", `${concluidas.length} task(s) concluída(s) com teste`);
}
function verificarI2(e: EntradaPiso): ItemDePiso {
  if (e.pipeline_id === "rapido") {
    if (e.rapido === undefined || e.rapido === null || e.rapido.suite === null) return item("I2", "nao_comprovado", "suíte não relatada");
    return e.rapido.suite === "verde" ? item("I2", "ok", "suíte verde (relatório rápido)") : item("I2", "violado", "suíte vermelha no relatório rápido");
  }
  const concluidas = tasksDe(e.trabalho).filter((t) => t.status === "concluida");
  const ruins = concluidas.filter((t) => t.suite === "vermelha" || t.suite === "nao_executada");
  if (ruins.length > 0) return item("I2", "violado", `task concluída sem suíte verde: ${ruins.map((t) => t.id).slice(0, 5).join(", ")}`);
  if (e.rastro?.suite_ok_apos_ultima_alteracao === false) return item("I2", "violado", "a última suíte do rastro não passou depois da última alteração");
  if (concluidas.length === 0 || e.rastro?.suite_ok_apos_ultima_alteracao == null) return item("I2", "nao_comprovado", "suíte final não comprovada pelo rastro");
  return item("I2", "ok", "suíte verde por task e ao fim");
}
function verificarI3(e: EntradaPiso): ItemDePiso {
  if (e.segredos === undefined || e.segredos === null) return item("I3", "nao_comprovado", "diff não varrido");
  if (e.segredos.length === 0) return item("I3", "ok", "nenhum segredo no diff");
  return item("I3", "violado", `segredo no diff: ${e.segredos.slice(0, 5).map((s) => `${s.arquivo} (${s.padrao})`).join("; ")}`);
}
function verificarI4(e: EntradaPiso): ItemDePiso {
  const iso = isolamentoDoPiso(e.cli_implementador ?? null);
  if (iso === "duro") return item("I4", "ok", "isolamento duro: permissions.deny por Pane (Claude)");
  return item("I4", "nao_comprovado", "isolamento parcial: instrução e guard rails do ADE (a CLI não impõe permissions.deny)");
}
function verificarI5(e: EntradaPiso): ItemDePiso {
  const execs = e.execs ?? [];
  const avaliadores = execs.filter((x) => x.tipo === "avaliador");
  if (avaliadores.length === 0) return item("I5", "ok", "nenhum avaliador no plano");
  const reuso = avaliadores.filter((x) => x.reutilizou_pane);
  if (reuso.length > 0) return item("I5", "violado", `avaliador reaproveitou o Pane: ${reuso.map((x) => x.etapa_id).join(", ")}`);
  const impl = execs.filter((x) => IMPLEMENTADORES.has(x.tipo) && x.perfil !== null);
  const iguais = avaliadores.filter((a) => a.perfil !== null && impl.some((i) => i.perfil !== null && i.perfil.cli === a.perfil?.cli && i.perfil.modelo === a.perfil?.modelo));
  if (iguais.length > 0) return item("I5", "violado", `avaliador com o mesmo perfil do implementador: ${iguais.map((x) => x.etapa_id).join(", ")}`);
  if (avaliadores.some((a) => a.perfil === null)) return item("I5", "nao_comprovado", "perfil do avaliador ainda não resolvido");
  return item("I5", "ok", "avaliador em Pane novo e perfil diferente");
}
function verificarI6(e: EntradaPiso): ItemDePiso {
  const humanas = ["prodx.assinatura", "mergex.revisar"];
  const ruim = e.plano.filter((p) => humanas.includes(p.etapa_id) && (p.estado_inicial !== "humano" || p.comando !== null));
  const comandou = (e.execs ?? []).filter((x) => humanas.includes(x.etapa_id) && (x.despachada === true || (x.comando ?? "") !== ""));
  const aprovou = (e.escritas ?? []).filter((c) => /aprovad/i.test(c));
  if (ruim.length > 0 || comandou.length > 0 || aprovou.length > 0) return item("I6", "violado", "ação humana despachada ou preenchida pelo Maestro");
  return item("I6", "ok", "assinatura, aprovação de raio e merge ficaram com a pessoa");
}
const dentroDoPermitido = (rel: string): boolean => rel.startsWith(`${PRODUTO.pastaNoProjeto}/`) || rel === ".expx/hooks.json";
function verificarI7(e: EntradaPiso): ItemDePiso {
  const fora = (e.escritas ?? []).filter((c) => !dentroDoPermitido(c) || c.includes(".."));
  return fora.length > 0 ? item("I7", "violado", `escrita fora do permitido: ${fora.slice(0, 5).join(", ")}`) : item("I7", "ok", "só pasta do produto e .expx/hooks.json");
}
function verificarI8(e: EntradaPiso): ItemDePiso {
  const meus = (e.hooks_escritos ?? []).filter((h) => (SEGURANCA as readonly string[]).includes(h));
  if (meus.length > 0) return item("I8", "violado", `o ADE escreveu hook de segurança: ${meus.join(", ")}`);
  const usuario = e.seguranca_rebaixada_pelo_usuario ?? [];
  if (usuario.length > 0) return item("I8", "nao_comprovado", `piso comprometido: ${usuario.join(", ")} desligado por você`);
  return item("I8", "ok", "hooks de segurança intactos");
}
function verificarI9(e: EntradaPiso): ItemDePiso {
  const pr = (e.execs ?? []).find((x) => x.etapa_id === "mergex.pr" && x.despachada === true);
  if (pr === undefined) return item("I9", "ok", "nenhum push/PR despachado");
  if ((e.permissao ?? "seguro") === "automatico" || e.pr_confirmado === true) return item("I9", "ok", "push/PR confirmado ou perfil automático");
  return item("I9", "violado", "push/PR despachado sem confirmação");
}
function verificarI10(e: EntradaPiso): ItemDePiso {
  const exigidas = etapasDePisoAplicaveis(e.pipeline_id, e.nivel, e.evidencia);
  const presentes = new Set(e.plano.filter((p) => p.estado_inicial !== "pulada_nivel" && p.estado_inicial !== "pulada_usuario").map((p) => p.etapa_id));
  const faltando = exigidas.filter((x) => !presentes.has(x));
  return faltando.length > 0 ? item("I10", "violado", `etapa de piso omitida: ${faltando.join(", ")}`) : item("I10", "ok", "todas as etapas de piso estão no plano");
}

/** I1..I10 (≤ 20 ms). */
export function verificarPiso(e: EntradaPiso): ItemDePiso[] {
  return [verificarI1(e), verificarI2(e), verificarI3(e), verificarI4(e), verificarI5(e), verificarI6(e), verificarI7(e), verificarI8(e), verificarI9(e), verificarI10(e)];
}
/** Pior estado: violado > nao_comprovado > ok. */
export function resumoDoPiso(itens: readonly ItemDePiso[]): EstadoPiso {
  return itens.some((i) => i.estado === "violado") ? "violado" : itens.some((i) => i.estado === "nao_comprovado") ? "nao_comprovado" : "ok";
}
