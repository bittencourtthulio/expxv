// Perfil do harness (Fase 9, T-09.16): a implementação REAL da `PortaResolverPerfil` da Fase 14 (mesma assinatura estrutural),
// `resolverPerfilDeEtapa(skill, etapa)` para o Maestro (Fase 16) e os PERFIS PRONTOS (P-311: Econômico, Equilibrado, Máxima
// qualidade) como dados editáveis, aplicáveis em lote. Tudo passa pelo `rotear` (uma regra, um lugar): aqui só há tradução de
// formato, o gancho do avaliador independente (D-21) e dados. PURO sobre o que `contexto()` devolve; nada de rede.
import { FAIXAS, type ErroRoteamento, type Executor, type Faixa, type ResultadoDeRota } from "../../compartilhado/harness";
import type { Papel } from "../dominio/enums";
import { NIVEIS_ESFORCO } from "../squads/esforco";
import { CliDesconhecidaErro, type ContextoResolucao, type PerfilCompleto, type PortaResolverPerfil, type ResolucaoPerfil } from "../squads/perfil";
import { rotear, type DepsRoteador, type PedidoRoteador, type Rota } from "./roteador";
import { FAIXA_PADRAO_POR_TASK_TYPE, taskTypeDoGesto } from "./task-types";

// ---- erros nominais ----
/** Sem rota possível (ex.: tudo esgotado ou modo manual sem capacidade). `sugestao` traz o que o harness faria, nunca aplicado. */
export class RotaIndisponivelErro extends Error {
  readonly codigo: ErroRoteamento;
  constructor(readonly rota: Rota) {
    super(rota.recibo);
    this.name = "RotaIndisponivelErro";
    this.codigo = rota.erro ?? "no_capacity";
  }
}

// ---- tradução de papel e de etapa ----
const TASK_TYPE_DO_PAPEL: Readonly<Record<Papel, string>> = { piloto: "planejar", executor: "implementar", explorador: "descobrir", revisor: "auditar", nenhum: "geral" };

export interface EtapaPadrao {
  task_type: string;
  /** o avaliador roda em provedor diferente do implementador (D-21). */
  avaliador: boolean;
}
const e = (task_type: string, avaliador = false): EtapaPadrao => ({ task_type, avaliador });
/** `skill:etapa` → tipo (D-103). `skill:*` vale para o resto da skill. Editável: o chamador pode passar o seu mapa. */
export const ETAPAS_PADRAO: Readonly<Record<string, EtapaPadrao>> = {
  "sprintx:F1": e("planejar"), "sprintx:F2": e("planejar"), "sprintx:F3": e("planejar"), "sprintx:F4": e("planejar"),
  "sprintx:F5": e("auditar", true), "sprintx:F6": e("implementar"), "sprintx:*": e("planejar"),
  "runx:E1": e("bug-profundo"), "runx:E2": e("planejar"), "runx:E3": e("bug-fix"), "runx:E4": e("qa", true), "runx:E5": e("docs"), "runx:*": e("bug-fix"),
  "prodx:P0": e("triar"), "prodx:*": e("triar"),
  "mergex:E2": e("revisar-pr", true), "mergex:E3": e("revisar-pr", true), "mergex:E4": e("revisar-pr", true), "mergex:*": e("revisar-pr"),
  "buildx:*": e("planejar"), "designx:*": e("front"), "stackx:*": e("descobrir"), "legadox:*": e("descobrir"), "memox:*": e("docs"),
};
const AVALIADORES_POR_GESTO: ReadonlySet<string> = new Set(["sprintx-auditoria", "runx-qa"]);

/** `expx:sprintx` → `sprintx`; caixa e espaços normalizados. */
const normalizarSkill = (s: string): string => s.trim().toLowerCase().replace(/^expx:/, "");
const normalizarEtapa = (s: string): string => s.trim().toUpperCase();

/** (skill, etapa) → tipo e papel de avaliador; desconhecido ⇒ `geral`. Aceita o gesto (`sprintx-auditoria`, `runx-qa`). */
export function etapaParaTipo(skill: string, etapa: string, mapa: Readonly<Record<string, EtapaPadrao>> = ETAPAS_PADRAO): EtapaPadrao {
  const s = normalizarSkill(skill);
  const et = normalizarEtapa(etapa);
  const exata = mapa[`${s}:${et}`];
  if (exata) return exata;
  const tipoGesto = taskTypeDoGesto(s);
  if (tipoGesto !== "geral") return { task_type: tipoGesto, avaliador: AVALIADORES_POR_GESTO.has(s) };
  const familia = s.split("-")[0] as string;
  return mapa[`${s}:*`] ?? mapa[`${familia}:${et}`] ?? mapa[`${familia}:*`] ?? e("geral");
}

// ---- resolvedor ----
export interface ContextoDaEtapa {
  workspace_id: string;
  papel: Papel;
  mission_id: string | null;
  implementador_provedor?: string | null;
  excluir?: string[];
  pane_id?: string | null;
}
export interface DepsResolvedor {
  /** dados frescos do workspace (política, usos, contas, equivalência, config, `agora`); pode ser assíncrono (banco). */
  contexto(workspaceId: string): DepsRoteador | Promise<DepsRoteador>;
  /** variáveis de ambiente da conta escolhida (ex.: config dir da CLI); só chaves seguras, nunca segredo. */
  ambienteDaConta?(contaId: string): Record<string, string> | undefined;
  etapas?: Readonly<Record<string, EtapaPadrao>>;
}
export interface ResolucaoPerfilHarness extends ResolucaoPerfil {
  /** `true` = sugestão que só vale com a aprovação do usuário (modo `só sugerir`); o chamador deve perguntar antes de lançar. */
  requer_aprovacao: boolean;
  aplicada: boolean;
  faixa: Faixa | null;
  esforco: string | null;
  avisos: string[];
  confianca: Rota["confianca"];
  task_type: string;
}
export type ResultadoEtapa = Rota & { skill: string; etapa: string; avaliador: boolean };

export interface ResolvedorHarness extends PortaResolverPerfil {
  resolverPerfil(perfil: PerfilCompleto, contexto: ContextoResolucao & { task_type?: string; implementador_provedor?: string | null; pane_id?: string | null }): Promise<ResolucaoPerfilHarness>;
  /** Para o Maestro: (skill, etapa) → tipo (etapas) → rota. Não cria Pane; só leitura. */
  resolverPerfilDeEtapa(skill: string, etapa: string, ctx: ContextoDaEtapa, perfil?: PerfilCompleto | null): Promise<ResultadoEtapa>;
}

/** O avaliador exclui o provedor do implementador, SE sobrar ≥ 1 outro provedor viável (com conta habilitada) (D-21). */
function excluirImplementador(deps: DepsRoteador, implementador: string | null | undefined, exclusoes: readonly string[]): string[] {
  if (!implementador) return [...exclusoes];
  const comConta = new Set(deps.contas.filter((c) => c.habilitada).map((c) => c.provedor));
  const viaveis = (deps.provedoresViaveis ?? [...comConta]).filter((p) => comConta.has(p) && !exclusoes.includes(p));
  return viaveis.some((p) => p !== implementador) ? [...exclusoes, implementador] : [...exclusoes];
}

export function criarResolvedorHarness(d: DepsResolvedor): ResolvedorHarness {
  const rotear1 = async (pedido: PedidoRoteador, workspaceId: string, implementador: string | null | undefined, avaliador: boolean): Promise<Rota> => {
    const deps = await d.contexto(workspaceId);
    const excluirProvedores = avaliador ? excluirImplementador(deps, implementador, pedido.excluirProvedores ?? []) : (pedido.excluirProvedores ?? []);
    return rotear({ ...pedido, excluirProvedores }, deps);
  };
  const paraPedido = (perfil: PerfilCompleto | null, taskType: string, ctx: { workspace_id: string; papel: Papel; mission_id: string | null; excluir?: string[] | undefined; pane_id?: string | null | undefined }): PedidoRoteador => {
    const pedido: PedidoRoteador = { taskType, workspace: ctx.workspace_id, papel: ctx.papel, origem: "metodo", mission_id: ctx.mission_id, pane_id: ctx.pane_id ?? null };
    if (ctx.excluir && ctx.excluir.length > 0) {
      pedido.excluirProvedores = [...ctx.excluir];
      pedido.excluirContas = [...ctx.excluir];
    }
    if (perfil) {
      pedido.perfil = { cli: perfil.cli, modelo: perfil.modelo, esforco: perfil.esforco, faixa: perfil.faixa };
      if (perfil.conta_preferida !== null) pedido.contaPreferida = perfil.conta_preferida;
    }
    return pedido;
  };
  const exigirOk = (r: Rota, cli: string): Rota & { executor: Executor; conta_id: string } => {
    if (r.erro === "no_compatible_cli") throw new CliDesconhecidaErro(cli);
    if (!r.ok || r.executor === null || r.conta_id === null) throw new RotaIndisponivelErro(r);
    return r as Rota & { executor: Executor; conta_id: string };
  };
  return {
    async resolverPerfil(perfil, contexto) {
      const taskType = contexto.task_type ?? TASK_TYPE_DO_PAPEL[contexto.papel];
      const pedido = paraPedido(perfil, taskType, contexto);
      const r = exigirOk(await rotear1(pedido, contexto.workspace_id, contexto.implementador_provedor, contexto.papel === "revisor" && contexto.implementador_provedor != null), perfil.cli);
      const ambiente = d.ambienteDaConta?.(r.conta_id);
      return {
        conta: r.conta_id,
        modelo: r.executor.model,
        cli: r.cli ?? r.executor.provider,
        motivo: r.motivo,
        ...(ambiente === undefined ? {} : { ambiente }),
        requer_aprovacao: r.requer_aprovacao,
        aplicada: r.aplicada,
        faixa: r.faixa,
        esforco: r.executor.effort,
        avisos: r.avisos,
        confianca: r.confianca,
        task_type: r.task_type,
      };
    },
    async resolverPerfilDeEtapa(skill, etapa, ctx, perfil = null) {
      const { task_type, avaliador } = etapaParaTipo(skill, etapa, d.etapas);
      const pedido = paraPedido(perfil, task_type, ctx);
      const r = await rotear1(pedido, ctx.workspace_id, ctx.implementador_provedor, avaliador);
      return { ...r, skill, etapa, avaliador };
    },
  };
}

/** Rota → `ResultadoDeRota` do contrato (IPC `harness:resolver_perfil`); `null` quando não há rota. */
export function paraResultadoDeRota(r: Rota): ResultadoDeRota | null {
  if (!r.ok || r.executor === null) return null;
  return { executor: r.executor, conta_id: r.conta_id, task_type: r.task_type, decisoes: r.decisoes, fontes: r.fontes, recibo: r.recibo, avisos: r.avisos, skills_aplicadas: false };
}

// ---- perfis prontos (P-311): dados editáveis ----
export interface PerfilPronto {
  id: string;
  nome: string;
  descricao: string;
  /** faixa de cada TaskType; o que não está aqui usa `faixa_padrao`. */
  faixas: Record<string, Faixa>;
  faixa_padrao: Faixa;
  /** nível de esforço genérico (`minimo`..`maximo`) por faixa; `null`/ausente = não mexe no esforço. */
  esforco_por_faixa: Partial<Record<Faixa, string | null>>;
}
export const ID_ECONOMICO = "economico";
export const ID_EQUILIBRADO = "equilibrado";
export const ID_MAXIMA_QUALIDADE = "maxima-qualidade";

const deslocar = (f: Faixa, delta: number): Faixa => FAIXAS[Math.min(FAIXAS.length - 1, Math.max(0, FAIXAS.indexOf(f) + delta))] as Faixa;
const deslocados = (delta: number): Record<string, Faixa> => Object.fromEntries(Object.entries(FAIXA_PADRAO_POR_TASK_TYPE).map(([k, v]) => [k, deslocar(v, delta)]));

/** Cópia nova dos perfis prontos de fábrica (editar uma cópia nunca altera a fábrica). */
export function perfisProntosDeFabrica(): PerfilPronto[] {
  return [
    {
      id: ID_ECONOMICO, nome: "Econômico", descricao: "Uma faixa abaixo do padrão em todas as etapas, esforço baixo: gasta menos cota e termina mais rápido.",
      faixas: deslocados(1), faixa_padrao: "medio", esforco_por_faixa: { topo: "medio", alto: "baixo", medio: "baixo", rapido: "minimo" },
    },
    {
      id: ID_EQUILIBRADO, nome: "Equilibrado", descricao: "Padrões de fábrica por tipo de tarefa: planejar e auditar no topo, implementar no alto, triar e documentar no rápido.",
      faixas: { ...FAIXA_PADRAO_POR_TASK_TYPE }, faixa_padrao: "alto", esforco_por_faixa: { topo: "alto", alto: "medio", medio: "medio", rapido: "baixo" },
    },
    {
      id: ID_MAXIMA_QUALIDADE, nome: "Máxima qualidade", descricao: "Uma faixa acima do padrão em todas as etapas, esforço alto: usa mais cota em troca de mais cuidado.",
      faixas: deslocados(-1), faixa_padrao: "topo", esforco_por_faixa: { topo: "maximo", alto: "alto", medio: "alto", rapido: "medio" },
    },
  ];
}

const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
export type ResultadoPerfilPronto = { ok: true; valor: PerfilPronto } | { ok: false; erros: Array<{ campo: string; motivo: string }> };
/** Validação estrita de um perfil pronto (vindo da tela ou de arquivo): nada de campo desconhecido, faixa fora da lista ou esforço inválido. */
export function validarPerfilPronto(bruto: unknown): ResultadoPerfilPronto {
  const erros: Array<{ campo: string; motivo: string }> = [];
  const o = typeof bruto === "object" && bruto !== null && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : null;
  if (o === null) return { ok: false, erros: [{ campo: "", motivo: "esperado objeto" }] };
  for (const k of Object.keys(o)) if (!["id", "nome", "descricao", "faixas", "faixa_padrao", "esforco_por_faixa"].includes(k)) erros.push({ campo: k, motivo: "campo desconhecido" });
  const ehFaixa = (v: unknown): v is Faixa => typeof v === "string" && (FAIXAS as readonly string[]).includes(v);
  if (typeof o.id !== "string" || !SLUG.test(o.id)) erros.push({ campo: "id", motivo: "esperado identificador (a-z, 0-9, hífen)" });
  if (typeof o.nome !== "string" || o.nome.trim() === "" || o.nome.length > 60) erros.push({ campo: "nome", motivo: "esperado texto de 1 a 60 caracteres" });
  if (typeof o.descricao !== "string" || o.descricao.length > 300) erros.push({ campo: "descricao", motivo: "esperado texto de até 300 caracteres" });
  if (!ehFaixa(o.faixa_padrao)) erros.push({ campo: "faixa_padrao", motivo: "faixa inválida" });
  const faixas: Record<string, Faixa> = {};
  if (typeof o.faixas !== "object" || o.faixas === null || Array.isArray(o.faixas)) erros.push({ campo: "faixas", motivo: "esperado objeto" });
  else
    for (const [k, v] of Object.entries(o.faixas as Record<string, unknown>)) {
      if (!SLUG.test(k)) erros.push({ campo: `faixas.${k}`, motivo: "tipo de tarefa inválido" });
      else if (!ehFaixa(v)) erros.push({ campo: `faixas.${k}`, motivo: "faixa inválida" });
      else faixas[k] = v;
    }
  const esforco: Partial<Record<Faixa, string | null>> = {};
  if (typeof o.esforco_por_faixa !== "object" || o.esforco_por_faixa === null || Array.isArray(o.esforco_por_faixa)) erros.push({ campo: "esforco_por_faixa", motivo: "esperado objeto" });
  else
    for (const [k, v] of Object.entries(o.esforco_por_faixa as Record<string, unknown>)) {
      if (!ehFaixa(k)) erros.push({ campo: `esforco_por_faixa.${k}`, motivo: "faixa inválida" });
      else if (v !== null && !(NIVEIS_ESFORCO as readonly string[]).includes(v as string)) erros.push({ campo: `esforco_por_faixa.${k}`, motivo: "nível de esforço inválido" });
      else esforco[k] = v as string | null;
    }
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, valor: { id: o.id as string, nome: (o.nome as string).trim(), descricao: o.descricao as string, faixas, faixa_padrao: o.faixa_padrao as Faixa, esforco_por_faixa: esforco } };
}

/** Edita um perfil pronto (fundindo `faixas` e `esforco_por_faixa`) e valida; o `id` não muda. */
export function editarPerfilPronto(base: PerfilPronto, mudanca: Partial<Omit<PerfilPronto, "id">>): ResultadoPerfilPronto {
  return validarPerfilPronto({ ...base, ...mudanca, id: base.id, faixas: { ...base.faixas, ...(mudanca.faixas ?? {}) }, esforco_por_faixa: { ...base.esforco_por_faixa, ...(mudanca.esforco_por_faixa ?? {}) } });
}

/** O que o perfil pronto mexe: só estes quatro campos; o resto do perfil (agente, conta preferida, permissão…) é preservado. */
export interface PerfilEditavel {
  cli: string;
  modelo: string | null;
  esforco: string | null;
  faixa: Faixa;
}
export interface EtapaAplicavel {
  skill?: string;
  etapa?: string;
  /** vence o mapa de etapas. */
  task_type?: string | null;
  perfil: PerfilEditavel;
}
export interface OpcoesAplicarPerfilPronto {
  /** `manter` (padrão) preserva a CLI de cada etapa; `auto` entrega a escolha do provedor ao harness (pela faixa e pelo consumo). */
  cli?: "manter" | "auto";
  /** `false` não mexe no esforço. */
  esforco?: boolean;
  etapas?: Readonly<Record<string, EtapaPadrao>>;
}
/**
 * Aplica o perfil pronto a um conjunto de etapas (um clique, todos os pipelines). Não muta a entrada; cada item devolve uma CÓPIA
 * com `faixa` pelo tipo da etapa, `modelo: null` (a faixa escolhe o modelo) e esforço pela faixa. Nada mais muda.
 */
export function aplicarPerfilPronto<E extends EtapaAplicavel>(pronto: PerfilPronto, etapas: readonly E[], opcoes: OpcoesAplicarPerfilPronto = {}): E[] {
  return etapas.map((it) => {
    const tipo = it.task_type ?? (it.skill !== undefined && it.etapa !== undefined ? etapaParaTipo(it.skill, it.etapa, opcoes.etapas).task_type : "geral");
    const faixa = pronto.faixas[tipo] ?? pronto.faixa_padrao;
    const esf = opcoes.esforco === false ? undefined : pronto.esforco_por_faixa[faixa];
    return {
      ...it,
      perfil: { ...it.perfil, cli: opcoes.cli === "auto" ? "auto" : it.perfil.cli, modelo: null, faixa, esforco: esf === undefined ? it.perfil.esforco : esf },
    };
  });
}
