// Dados e API falsa do Bench (só teste). Nenhum dado real; a API registra chamadas por `vi.fn` no teste.
import type { AlvoDisponivel, ApiBench, Comparacao, DetalheResultado, Estimativa, EventoBenchIpc, GradeRun, PrecoBench, ResumoResultado, TarefaBench } from "../../../compartilhado/bench";

export const RUN = "brun_01M3V8236WR2S7C4WBR29CJ6ZA";
export const RES = "bres_01M3V8236WR2S7C4WBR29CJ6ZA";
export const TOKEN = "a".repeat(48);

const tarefa = (slug: string, titulo: string, estado: TarefaBench["estado"] = "ativa"): TarefaBench => ({ id: `btar_${slug}`, slug, versao: 1, titulo, atividade: "bug", tipo: "codigo", prompt: "p", escopo: "", checagens: [], rubrica: [], estado, origem: "autoral", tem_fixture: false, embutida: true, atualizado_em: "2026-01-01T00:00:00.000Z" });
export const TAREFAS: TarefaBench[] = [tarefa("t-um", "Tarefa um"), tarefa("t-dois", "Tarefa dois"), tarefa("t-tres", "Rascunho pesado", "rascunho")];
const alvo = (slug: string, rotulo: string, disponivel = true): AlvoDisponivel => ({ id: `balv_${slug}`, slug, provedor: "claude", modelo: slug, esforco: null, cli: "claude", conta_id: "cta_1", rotulo, disponivel, motivo: disponivel ? null : "crie uma conta dedicada em Provedores" });
export const ALVOS: AlvoDisponivel[] = [alvo("alvo-a", "Modelo A"), alvo("alvo-b", "Modelo B"), alvo("alvo-j", "Juiz J")];
export const PRECOS: PrecoBench[] = [{ provedor: "claude", modelo: "alvo-a", preco_in_mtok: 3, preco_out_mtok: 15, preco_cache_mtok: null, vale_desde: "2026-01-01T00:00:00.000Z" }];

export const res = (id: string, tarefaSlug: string, alvoSlug: string, extra: Partial<ResumoResultado> = {}): ResumoResultado => ({ id, tarefa: tarefaSlug, tarefa_versao: 1, alvo: alvoSlug, tentativa: 1, estado: "concluido", duracao_s: 12.3, custo_usd: 0.0123, custo_fonte: "relatorio_cli", tokens_out: 500, qualidade: 8, juiz_estado: "feito", aviso: null, ...extra });

export function gradeFalsa(extra: Partial<GradeRun["run"]> = {}, resultados?: ResumoResultado[]): GradeRun {
  const rs = resultados ?? [
    res(RES, "t-um", "alvo-a"),
    res("bres_01M3V8236WR2S7C4WBR29CJ6ZB", "t-um", "alvo-b", { custo_usd: null, custo_fonte: "desconhecido", qualidade: null, juiz_estado: "pendente" }),
    res("bres_01M3V8236WR2S7C4WBR29CJ6ZC", "t-dois", "alvo-a", { estado: "falhou", duracao_s: 3, qualidade: 0 }),
    res("bres_01M3V8236WR2S7C4WBR29CJ6ZD", "t-dois", "alvo-b", { estado: "executando", duracao_s: null, custo_usd: null, custo_fonte: "desconhecido", qualidade: null, juiz_estado: "pendente" }),
  ];
  return { run: { id: RUN, nome: "Bench 2026-01-01", estado: "julgando", iniciada_em: "2026-01-01T00:00:00.000Z", terminada_em: null, total: rs.length, concluidos: rs.filter((r) => r.estado !== "executando" && r.estado !== "enfileirado").length, custo_usd: 0.0246, tarefas: [{ slug: "t-um", versao: 1 }, { slug: "t-dois", versao: 1 }], alvos: ["alvo-a", "alvo-b"], max_paralelo: 3, teto_usd: null, juiz_alvo: null, pesos: { q: 0.6, s: 0.2, c: 0.2 }, sandbox: "macos", ...extra }, resultados: rs };
}

export function estimativaFalsa(extra: Partial<Estimativa> = {}): Estimativa {
  return { estimativa_id: "est_lq3k2j9x", execucoes: 4, tarefas: ["t-um", "t-dois"], alvos: ["alvo-a", "alvo-b"], custo_min_usd: 0.5, custo_max_usd: 1.8, alvos_sem_custo: 0, duracao_estimada_s: 90, sandbox: "macos", frase_exigida: "RODAR", teto_usd: null, avisos: ["Alvos Codex usam o sandbox da própria CLI."], ...extra };
}

export function detalheFalso(extra: Partial<DetalheResultado> = {}): DetalheResultado {
  return { ...res(RES, "t-um", "alvo-a"), run_id: RUN, prompt_efetivo: "Você está em modo headless. Crie index.html.", tokens_in: 1000, tokens_total: 1500, turnos: 3, custo_tipo: "medido", checagens: [{ tipo: "file_exists", alvo: "index.html", ok: true, critica: true, detalhe: null }, { tipo: "contains_text", alvo: "index.html", ok: false, critica: false, detalhe: "texto não encontrado" }], artefatos: [{ nome: "index.html", tipo: "text/html", bytes: 42 }], isolamento: "garantido", qualidade_detalhe: null, notas: null, log_bytes: 3000, ...extra };
}

export function comparacaoFalsa(extra: Partial<Comparacao> = {}): Comparacao {
  const cel = (alvoSlug: string, comp: number, vencedor: boolean, custo: number | null) => ({ alvo: alvoSlug, resultado_id: `bres_${alvoSlug}`, estado: "concluido" as const, qualidade: 8, custo_usd: custo, duracao_s: 10, tokens_out: 400, composite: comp, vencedor });
  return {
    alvos: ["alvo-a", "alvo-b"],
    linhas: [{ tarefa: "t-um", versao: 1, atividade: "bug", celulas: [cel("alvo-a", 91.2, true, 0.01), cel("alvo-b", 70, false, null)] }, { tarefa: "t-dois", versao: 1, atividade: "bug", celulas: [cel("alvo-a", 60, false, 0.02), cel("alvo-b", 88.5, true, null)] }],
    placar: { vitorias: { "alvo-a": 1, "alvo-b": 1 }, empates: 0 },
    agregado: [{ alvo: "alvo-a", composite_medio: 75.6, custo_total_usd: 0.03, duracao_media_s: 10, vitorias: 1, tarefas: 2 }, { alvo: "alvo-b", composite_medio: 79.25, custo_total_usd: null, duracao_media_s: 10, vitorias: 1, tarefas: 2 }],
    veredito: "alvo-b venceu 1 de 2 tarefa(s) contra 1 de alvo-a; score médio 79,3 contra 75,6 (sem custo).",
    selos: ["sem_custo"], ...extra,
  };
}

export interface OpcoesApi { tarefas?: TarefaBench[]; alvos?: AlvoDisponivel[]; precos?: PrecoBench[]; grade?: GradeRun | null; estimativa?: Estimativa; comparacao?: Comparacao | { erro: "nao_comparavel" }; detalhe?: DetalheResultado; rascunho?: Array<{ atividade: string; task_type: string; executor: { provider: string; cli: string | null; model: string | null; effort: string | null; faixa: null }; alternativas: []; evidencia: string[] }> }

export function apiFalsa(o: OpcoesApi = {}): ApiBench & { emitir: (e: EventoBenchIpc) => void } {
  let ouvinte: (e: EventoBenchIpc) => void = () => undefined;
  const grade = o.grade === undefined ? gradeFalsa() : o.grade;
  return {
    tarefasListar: async () => o.tarefas ?? TAREFAS,
    tarefaSalvar: async () => TAREFAS[0] as TarefaBench,
    alvosListar: async () => o.alvos ?? ALVOS,
    alvosSalvar: async (a) => a.map((x, i) => ({ id: `balv_${i}`, slug: `${x.modelo}`, provedor: x.provedor, modelo: x.modelo, esforco: x.esforco, cli: x.cli, conta_id: x.conta_id, rotulo: x.modelo })),
    precosLer: async () => o.precos ?? PRECOS,
    precosGravar: async (p) => p,
    estimar: async () => o.estimativa ?? estimativaFalsa(),
    consentir: async () => ({ token: TOKEN, expira_em: "2026-01-01T00:02:00.000Z" }),
    descartarConsentimento: async () => true,
    rodar: async () => ({ run_id: RUN }),
    cancelar: async () => true,
    rerodar: async () => ({ resultado_id: RES }),
    julgar: async () => ({ veredito_ids: ["bjul_1"] }),
    notaManual: async () => true,
    runsListar: async () => ({ itens: grade === null ? [] : [{ id: RUN, nome: grade.run.nome, estado: grade.run.estado, iniciada_em: grade.run.iniciada_em, terminada_em: null, total: grade.run.total, concluidos: grade.run.concluidos, custo_usd: grade.run.custo_usd }], proximo: null }),
    estadoRun: async () => (grade === null ? Promise.reject(new Error("Run inexistente")) : grade),
    resultado: async () => o.detalhe ?? detalheFalso(),
    logLer: async (_id, depois) => ({ texto: depois === 0 ? "linha 1\nlinha 2\nlinha 3\n" : "", proximo: depois === 0 ? 3000 : depois }),
    artefatoLer: async () => ({ bytes: new TextEncoder().encode("<h1>entrega</h1>"), tipo: "text/html" }),
    comparar: async () => o.comparacao ?? comparacaoFalsa(),
    recomendar: async (a) => ({ atividade: a, sem_dados: true, ranking: [] }),
    exportarPolitica: async () => ({ rascunho: o.rascunho ?? [{ atividade: "bug", task_type: "bug-fix", executor: { provider: "claude", cli: "claude", model: "alvo-a", effort: "high", faixa: null }, alternativas: [], evidencia: ["bres_1"] }], avisos: ["Rascunho: nada foi gravado."] }),
    exportarRelatorio: async () => ({ caminho: "relatorio.md" }),
    assinar: (cb) => { ouvinte = cb; return () => undefined; },
    emitir: (e) => ouvinte(e),
  };
}
