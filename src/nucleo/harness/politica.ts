// Serviço de Política (T-09.10): validação, herança workspace → global e resolução do executor. PURO sobre dados injetados:
// o banco entra só por uma interface mínima (`RepoPoliticaMinimo`); nada de rede, relógio ou aleatoriedade.
import type { EntradaEquivalencia, ErroRoteamento, Executor, Politica, PoliticaEntrada, AtualizadoPor } from "../../compartilhado/harness";
import { PROVEDOR_OPENROUTER, faixaDe, resolverFaixa } from "./equivalencia";

const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;

export type ErroPolitica = ErroRoteamento | "fallback_obrigatorio" | "invalid_model";
export interface ContextoPolitica {
  taskTypes: ReadonlySet<string>;
  /** habilitados e instalados (ids de CLI); `openrouter` só entra quando habilitado. */
  provedoresHabilitados: ReadonlySet<string>;
  /** conta habilitada → provedor (para `conta_fixa_id`). */
  contasHabilitadas: ReadonlyMap<string, string>;
  clisInstaladas: ReadonlySet<string>;
  openrouter: { consentido: boolean; modelosHabilitados: ReadonlySet<string>; clisCompativeis: readonly string[] };
  /** níveis de esforço aceitos pelo modelo (hoje vazio para todas as CLIs: esforço vira `null` com aviso). */
  esforcoDe: (provedor: string, modelo: string | null) => readonly string[];
}
export type ResultadoValidacaoPolitica = { ok: true; politica: PoliticaEntrada; avisos: string[] } | { ok: false; erro: ErroPolitica; campo: string; mensagem: string };

type Falha = Extract<ResultadoValidacaoPolitica, { ok: false }>;
const falha = (erro: ErroPolitica, campo: string, mensagem: string): Falha => ({ ok: false, erro, campo, mensagem });

function validarExecutor(campo: string, e: Executor, ctx: ContextoPolitica, avisos: string[]): Executor | Falha {
  if (!ctx.provedoresHabilitados.has(e.provider)) return falha("executor_disabled", `${campo}.provider`, `provedor "${e.provider}" desabilitado ou indisponível`);
  if (e.provider === PROVEDOR_OPENROUTER) {
    if (!ctx.openrouter.consentido) return falha("openrouter_not_consented", `${campo}.provider`, "OpenRouter sem consentimento do dono");
    if (e.model === null && e.faixa === null) return falha("model_not_enabled", `${campo}.model`, "OpenRouter exige modelo habilitado ou faixa");
    if (e.model !== null && !ctx.openrouter.modelosHabilitados.has(e.model)) return falha("model_not_enabled", `${campo}.model`, "modelo OpenRouter não habilitado");
    if (e.cli === null ? ctx.openrouter.clisCompativeis.length === 0 : !ctx.openrouter.clisCompativeis.includes(e.cli)) return falha("no_compatible_cli", `${campo}.cli`, "nenhuma CLI compatível com OpenRouter instalada");
  } else {
    if ((e.cli !== null && e.cli !== e.provider) || !ctx.clisInstaladas.has(e.cli ?? e.provider)) return falha("no_compatible_cli", `${campo}.cli`, `CLI "${e.cli ?? e.provider}" indisponível`);
    if (e.model !== null && e.model !== "default" && !MODELO_VALIDO.test(e.model)) return falha("invalid_model", `${campo}.model`, "nome de modelo inválido");
  }
  let effort = e.effort;
  if (effort !== null) {
    const niveis = ctx.esforcoDe(e.provider, e.model);
    if (niveis.length === 0) {
      avisos.push(`${campo}.effort: esta CLI não expõe níveis de esforço; gravado como nulo`);
      effort = null;
    } else if (!niveis.includes(effort)) return falha("invalid_effort", `${campo}.effort`, `esforço "${effort}" não suportado`);
  }
  return { ...e, effort };
}

/** Valida UMA política antes de gravar: nada é gravado se devolver `ok:false` (erro nominal + campo). */
export function validarPolitica(entrada: PoliticaEntrada, ctx: ContextoPolitica): ResultadoValidacaoPolitica {
  if (!ctx.taskTypes.has(entrada.task_type)) return falha("unknown_task_type", "task_type", `tipo "${entrada.task_type}" desconhecido`);
  if (!Array.isArray(entrada.fallback) || entrada.fallback.length === 0) return falha("fallback_obrigatorio", "fallback", "o fallback nunca pode ser vazio");
  const avisos: string[] = [];
  const lista = (campo: string, es: readonly Executor[]): Executor[] | Falha => {
    const s: Executor[] = [];
    for (let i = 0; i < es.length; i++) {
      const r = validarExecutor(`${campo}[${i}]`, es[i] as Executor, ctx, avisos);
      if ("ok" in r) return r;
      s.push(r);
    }
    return s;
  };
  const executor = validarExecutor("executor", entrada.executor, ctx, avisos);
  if ("ok" in executor) return executor;
  const alternativas = lista("alternativas", entrada.alternativas);
  if (!Array.isArray(alternativas)) return alternativas;
  const fallback = lista("fallback", entrada.fallback);
  if (!Array.isArray(fallback)) return fallback;
  if (entrada.conta_fixa_id !== null && !ctx.contasHabilitadas.has(entrada.conta_fixa_id)) return falha("executor_disabled", "conta_fixa_id", "conta fixada desabilitada ou inexistente");
  return { ok: true, politica: { ...entrada, executor, alternativas, fallback }, avisos };
}

// ---- herança e resolução ----
/** A do workspace vence a global do mesmo tipo; override desabilitado é ignorado (herda a global); global desabilitada = sem política. */
export function politicaEfetiva(globais: readonly Politica[], doWorkspace: readonly Politica[], taskType: string): Politica | undefined {
  const w = doWorkspace.find((p) => p.task_type === taskType && p.habilitada);
  if (w) return w;
  const g = globais.find((p) => p.task_type === taskType && p.habilitada);
  return g;
}

const chaveExecutor = (e: Executor): string => `${e.provider}|${e.cli ?? ""}|${e.model ?? ""}|${e.effort ?? ""}|${e.faixa ?? ""}`;
/**
 * `[executor, ...alternativas, ...fallback]` sem duplicatas, só de provedores habilitados e fora de `excluir_provedores`.
 * Política antiga com provedor depois desabilitado resolve pelo fallback (CT-9.06); `openrouter` só com consentimento.
 */
export function candidatosDaPolitica(p: Politica, provedoresHabilitados: ReadonlySet<string>, opcoes: { excluirProvedores?: readonly string[]; openrouterConsentido?: boolean } = {}): Executor[] {
  if (!p.habilitada) return [];
  const excluidos = new Set(opcoes.excluirProvedores ?? []);
  const vistos = new Set<string>();
  const saida: Executor[] = [];
  for (const e of [p.executor, ...p.alternativas, ...p.fallback]) {
    if (!provedoresHabilitados.has(e.provider) || excluidos.has(e.provider)) continue;
    if (e.provider === PROVEDOR_OPENROUTER && opcoes.openrouterConsentido !== true) continue;
    const k = chaveExecutor(e);
    if (vistos.has(k)) continue;
    vistos.add(k);
    saida.push(e);
  }
  return saida;
}

/** Executor por faixa → modelo concreto pela tabela; modelo explícito mantém a faixa derivada; sem nada = padrão da CLI. */
export function executorConcreto(e: Executor, equiv: EntradaEquivalencia): Executor {
  if (e.model !== null) return { ...e, faixa: e.faixa ?? faixaDe(equiv, e.provider, e.model) };
  if (e.faixa === null) return { ...e };
  const primeiro = resolverFaixa(equiv, e.provider, e.faixa)[0];
  if (!primeiro) return { ...e };
  return { ...e, model: primeiro.modelo === "default" ? null : primeiro.modelo, effort: e.effort ?? primeiro.esforco };
}

// ---- gravação (banco por interface mínima) ----
export interface RepoPoliticaMinimo {
  gravar(d: PoliticaEntrada, por: AtualizadoPor): Politica;
  remover(workspaceId: string | null, taskType?: string): number;
}
export interface EventoPoliticaMudou {
  task_type: string;
  por: AtualizadoPor;
}
export type ResultadoGravarPolitica = { ok: true; politica: Politica; avisos: string[] } | Falha;

/** Valida e grava; erro nominal e NADA gravado quando inválida; emite `policy.changed` (injetado) só após gravar. */
export function gravarPolitica(repo: RepoPoliticaMinimo, entrada: PoliticaEntrada, por: AtualizadoPor, ctx: ContextoPolitica, emitir?: (e: EventoPoliticaMudou) => void): ResultadoGravarPolitica {
  const v = validarPolitica(entrada, ctx);
  if (!v.ok) return v;
  const politica = repo.gravar(v.politica, por);
  emitir?.({ task_type: politica.task_type, por });
  return { ok: true, politica, avisos: v.avisos };
}

/**
 * "Restaurar semente": global ⇒ apaga o escopo e regrava a semente (`semente`); workspace ⇒ apaga só os overrides (volta a herdar a global).
 * `taskType` restringe a um tipo. Devolve quantas linhas foram apagadas/regravadas.
 */
export function restaurarSemente(repo: RepoPoliticaMinimo, workspaceId: string | null, semente: readonly PoliticaEntrada[], taskType?: string, emitir?: (e: EventoPoliticaMudou) => void): number {
  const apagadas = repo.remover(workspaceId, taskType);
  if (workspaceId !== null) {
    emitir?.({ task_type: taskType ?? "*", por: "usuario" });
    return apagadas;
  }
  let n = 0;
  for (const s of semente) {
    if (taskType !== undefined && s.task_type !== taskType) continue;
    repo.gravar(s, "semente");
    emitir?.({ task_type: s.task_type, por: "semente" });
    n++;
  }
  return n;
}
