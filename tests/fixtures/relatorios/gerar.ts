// Fixtures determinísticas da Fase 19 (sem rede, sem disco, sem relógio real). Uma sprint fechada com três itens "de verdade" — feature visível com texto do cliente,
// correção visível SEM texto (jargão proposital no título), item interno OCULTO — mais custo parcial, PR e módulos do mapa. `gerarVolumeRelatorio(n)` cria sprints grandes.
import type { FatoTask, ItemAgil, ItemResumo, PainelAgil, SprintAgil } from "../../../src/compartilhado/agil";
import type { ItemBruto, PortasRelatorios, SprintBruta } from "../../../src/nucleo/relatorios/portas";
import { portasIndisponiveis } from "../../../src/nucleo/relatorios/portas";

export const WS = "ws_0000000000AAAA";
export const SPRINT_ID = "spr_0000000000AAAA";
export const T0 = Date.parse("2026-03-14T12:00:00.000Z");
const TS = "2026-03-13T18:00:00.000Z";

export function itemFalso(n: number, extra: Partial<ItemAgil> = {}): ItemAgil {
  return {
    id: `it_00000000${String(n).padStart(4, "0")}`, workspace_id: WS, origem: "metodo", trabalho_id: "tr-login", task_ref: `T-01.${String(n).padStart(2, "0")}`, epico_id: null, titulo: `Item ${n}`, descricao: null, criterios: [],
    estado_ade: "pronto", valor: null, urgencia: null, reducao_risco: null, moscow: null, ordem: n, dono_membro_id: null, par_membro_id: null, visibilidade_cliente: "auto", resumo_cliente: null,
    resumo_cliente_origem: null, changelog_tipo: null, origem_ref: null, descartado_motivo: null, orfao: false, criado_em: TS, atualizado_em: TS, ...extra,
  };
}
export function resumoFalso(i: ItemAgil, extra: Partial<ItemResumo> = {}): ItemResumo {
  return {
    id: i.id, origem: i.origem, trabalho_id: i.trabalho_id, task_ref: i.task_ref, titulo: i.titulo, epico_id: null, estado_ade: "pronto", estado_fluxo: "concluida", pontos: 3, categoria: "feature", risco: "baixo",
    criticidade: "media", ordem: i.ordem, wsjf: null, situacao_retrabalho: "primeira", duracao_obs_ms: 7_200_000, sprint_id: SPRINT_ID, dono: null, estimativa_origem: "humano", estimativa_confianca: 0.8, ...extra,
  };
}
export function fatoFalso(i: ItemAgil, extra: Partial<FatoTask> = {}): FatoTask {
  return {
    workspace_id: WS, trabalho_id: i.trabalho_id ?? "tr", task_ref: i.task_ref ?? "T-00.00", titulo: i.titulo, fase: null, depende_de: [], criterio_aceite: null, tipo_task: null, status_visto: "concluida",
    iniciada_em: TS, concluida_em: TS, concluida_ts_precisa: true, duracao_obs_ms: 7_200_000, bloqueada_ms: null, reaberturas: 0, reabertas_em: [], retrabalho_ms: null, qa_reprovacoes: 0, suite_final: null,
    agente: null, membro_id: null, arquivos: [], tdd_primeiro: null, vermelho_antes: null, commits: [], validada_em: null, tem_rastro: true, intervalos: [], primeiro_evento_em: TS,
    declarados: { integracao: false, funcional: false, regressao: false }, versao_origem: "v1", atualizado_em: TS, ...extra,
  };
}
const bruto = (i: ItemAgil, r: Partial<ItemResumo> = {}, f: Partial<FatoTask> = {}, resultado: ItemBruto["resultado"] = "concluido"): ItemBruto => ({ item: i, resumo: resumoFalso(i, r), fato: fatoFalso(i, f), resultado });

export function painelMinimo(extra: Partial<PainelAgil> = {}): PainelAgil {
  const resumo = { ir: 0.1, ir_max: 0.2, first_time_right: 0.9, avaliaveis: 3, em_observacao: 0, indeterminado: 0, escopo_eventos: 0, pontos_retrabalhados: 0, horas_obs_retrabalho_min: 0 };
  return {
    filtros: { sprint_id: SPRINT_ID, membro_id: null, agente: null, squad_id: null, de: null, ate: null }, gerado_em: TS, base: { tasks: 3, itens: 3, sprints: 1, sem_estimativa: 0, sem_rastro: 0 },
    burndown: null, burnup: null, velocidade: [{ sprint_id: SPRINT_ID, nome: "Sprint 12", compromisso: 12, concluido: 8, de_primeira: 8, media_movel_3: 7.5 }],
    cfd: { dias: [], acumulado: [] }, cycle: { estado: "ok", n: 3, p50: 7_200_000, p85: 10_800_000, p95: 14_400_000, amostras: [] }, lead: { estado: "ok", n: 3, p50: 14_400_000, p85: 28_800_000, p95: 30_000_000, amostras: [] },
    throughput: [], wip: { dias: [], limite: null, idade: [] }, retrabalho: { ...resumo, por_sprint: [{ sprint_id: SPRINT_ID, resumo }], por_categoria: [] }, planejado_entregue: null,
    defeitos_escapados: { total: 1, por_sprint: [{ sprint_id: SPRINT_ID, n: 1 }], por_categoria: [] }, distribuicao: { risco: {}, categoria: {}, criticidade: {}, sem_classificacao: 0 }, previsao: { estado: "dados_insuficientes" },
    saude: [], erro_estimativa: { por_categoria: [], pontos: [], vies: null, mdape: null }, valor_esforco: [], ...extra,
  };
}

export function sprintFalsa(extra: Partial<SprintAgil> = {}): SprintAgil {
  return {
    id: SPRINT_ID, workspace_id: WS, nome: "Sprint 12", meta: "Entrar com a conta da empresa", inicio: "2026-03-02", fim: "2026-03-13", estado: "fechada", capacidade_pontos: 14, compromisso_pontos: 12, iniciada_em: "2026-03-02T09:00:00.000Z",
    fechada_em: "2026-03-13T18:00:00.000Z", versao_lancamento: "2.4.0", criado_em: TS, atualizado_em: TS,
    resumo_fechamento: { compromisso_inicial: 12, concluido_pontos: 8, concluidos: 3, carregados: 0, devolvidos: 0, descartados: 0, sem_estimativa: 0, first_time_right: 0.9, destino_pendentes: "backlog" }, ...extra,
  };
}

/** feature visível com texto do cliente · correção visível SEM texto e com jargão no título · item interno oculto. */
export function sprintBrutaFalsa(): SprintBruta {
  const a = itemFalso(1, { titulo: "Login com conta corporativa", resumo_cliente: "Agora você entra no sistema com a conta da sua empresa, sem criar outra senha.", changelog_tipo: "added", visibilidade_cliente: "sim" });
  const b = itemFalso(2, { titulo: "Corrige erro de cache no endpoint /api/pedidos", visibilidade_cliente: "sim" });
  const c = itemFalso(3, { titulo: "Refatorar controller interno de auditoria", visibilidade_cliente: "nao" });
  return {
    sprint: sprintFalsa(),
    painel: painelMinimo(),
    itens: [
      bruto(a, { pontos: 5, categoria: "feature" }, { arquivos: ["src/auth/login.ts", "src/auth/sso.ts"], commits: [{ sha: "a1b2c3d4e5f60718", mensagem: "feat: login corporativo", ts: "2026-03-10T10:00:00.000Z", linhas: 120, labels: [] }] }),
      bruto(b, { pontos: 3, categoria: "bug", situacao_retrabalho: "retrabalho", risco: "alto" }, { arquivos: ["src/pedidos/cache.ts"], commits: [{ sha: "9f8e7d6c5b4a3f21", mensagem: "fix: invalida cache de pedidos", ts: "2026-03-11T10:00:00.000Z", linhas: 12, labels: [] }] }),
      bruto(c, { pontos: 2, categoria: "refactor" }, { arquivos: ["src/interno/auditoria.ts"] }),
    ],
  };
}

export function portasFalsas(extra: Partial<PortasRelatorios> = {}, bruta: SprintBruta = sprintBrutaFalsa()): PortasRelatorios {
  return {
    ...portasIndisponiveis(),
    agil: { sprint: async (_w, s) => (s === bruta.sprint.id ? bruta : null), sprintsFechadas: async () => [{ id: bruta.sprint.id, nome: bruta.sprint.nome, fechada_em: bruta.sprint.fechada_em, versao_lancamento: bruta.sprint.versao_lancamento }] },
    versionamento: { prs: async () => [{ trabalho_id: "tr-login", url: "https://github.com/exemplo/app/pull/42", estado: "merged" }] },
    custo: { sprint: async () => ({ tokens: 120_000, usd: 4.5, estado: "minimo" }) },
    mapa: { alteracoes: async () => ({ modulos: [{ nome: "auth", arquivos: 2 }, { nome: "pedidos", arquivos: 1 }], ciclos: 0, pontos_quentes: ["pedidos"] }) },
    workspace: { raiz: () => null },
    ...extra,
  };
}

/** sprint grande (n itens entregues) para os orçamentos P-290..: determinística. */
export function gerarVolumeRelatorio(n = 200): SprintBruta {
  const itens: ItemBruto[] = [];
  for (let k = 1; k <= n; k++) {
    const i = itemFalso(k, { titulo: `Entrega número ${k}`, trabalho_id: `tr-${k % 7}`, task_ref: `T-${String(k % 9).padStart(2, "0")}.${String(k % 90).padStart(2, "0")}`, visibilidade_cliente: k % 3 === 0 ? "nao" : "sim", resumo_cliente: k % 2 === 0 ? `Novo recurso ${k} disponível para você.` : null });
    itens.push(bruto(i, { pontos: (k % 5) + 1, categoria: k % 4 === 0 ? "bug" : "feature" }, { arquivos: [`src/m${k % 20}/arquivo${k}.ts`], commits: [{ sha: `${(k * 7919).toString(16).padStart(7, "0")}abc`.slice(0, 12), mensagem: `feat: item ${k}`, ts: "2026-03-10T10:00:00.000Z", linhas: 10, labels: [] }] }));
  }
  return { sprint: sprintFalsa({ compromisso_pontos: n * 3 }), painel: painelMinimo(), itens };
}
