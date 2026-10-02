// T-18.34: serviço de painel (as 16 séries). Filtros: sprint, pessoa, agente, squad, período. Cache por versão dos fatos (P-181: <= 150 ms com cache válido; <= 400 ms recomputando).
// A previsão (Monte Carlo) NÃO roda aqui: vem pronta (worker) ou fica `calculando`/`dados_insuficientes`.
import type { ConfigAgil, FiltrosAgil, PainelAgil, PrevisaoEstado, SprintAgil } from "../../../compartilhado/agil";
import { agregarErro } from "../estimativa/erro";
import { detectarAtrasadas } from "../eventos";
import type { OcorrenciaRunx } from "../portas";
import { resumirRetrabalho, type LinhaRetrabalho } from "../retrabalho/agregar";
import type { BancoAgil } from "../repos";
import { quadranteValorEsforco } from "../backlog/priorizar";
import { diaDe, hash, isoDe, somarDias, type Relogio } from "../util";
import { calcularBurn } from "./burn";
import { calcularCfd } from "./cfd";
import { calcularDefeitosEscapados } from "./defeitos";
import { montarItensMetrica, type ItemMetrica } from "./dados";
import { cycleTime, leadTime, throughput } from "./fluxo";
import { calcularPlanejado } from "./planejado";
import { amostraDiasUteis } from "./previsao";
import { indicadoresSaude } from "./saude";
import { calcularVelocidade } from "./velocidade";
import { calcularWip } from "./wip";

export const FILTROS_VAZIOS: FiltrosAgil = { sprint_id: null, membro_id: null, agente: null, squad_id: null, de: null, ate: null };

export interface DepsPainel {
  banco: BancoAgil;
  config: ConfigAgil;
  relogio: Relogio;
  ocorrencias?: readonly OcorrenciaRunx[];
  /** resultado do Monte Carlo (worker), se já houver. */
  previsao?: PrevisaoEstado | null;
  bloqueios_abertos?: number | null;
}

export function filtrarItens(itens: readonly ItemMetrica[], f: FiltrosAgil): ItemMetrica[] {
  return itens.filter((i) => !i.descartado && (!f.membro_id || i.membro_id === f.membro_id) && (!f.agente || i.agente === f.agente) && (!f.squad_id || i.squad_id === f.squad_id));
}

export function escolherSprint(sprints: readonly SprintAgil[], f: FiltrosAgil): SprintAgil | null {
  if (f.sprint_id) return sprints.find((s) => s.id === f.sprint_id) ?? null;
  return sprints.find((s) => s.estado === "ativa") ?? [...sprints].filter((s) => s.estado === "fechada").sort((a, b) => b.fim.localeCompare(a.fim))[0] ?? null;
}

const linhaRetrabalho = (i: ItemMetrica, sprintId: string | null): LinhaRetrabalho => ({
  chave: i.ref, situacao: i.situacao, eventos_pendentes: i.eventos_pendentes, pontos: i.pontos, categoria: i.categoria, sprint_id: sprintId, membro_id: i.membro_id, agente: i.agente, squad_id: i.squad_id, retrabalho_ms: i.retrabalho_ms,
});

/** versão barata dos dados (invalida cache quando qualquer fato/estimativa/sprint muda). */
export function versaoDados(banco: BancoAgil, ws: string): string {
  let n = 0; let maxF = ""; let maxI = "";
  for (const f of banco.fatos.valores()) if (f.workspace_id === ws) { n++; if (f.atualizado_em > maxF) maxF = f.atualizado_em; }
  let ni = 0;
  for (const i of banco.itens.valores()) if (i.workspace_id === ws) { ni++; if (i.atualizado_em > maxI) maxI = i.atualizado_em; }
  let ms_ = ""; let ns = 0;
  for (const s of banco.sprints.valores()) if (s.workspace_id === ws) { ns++; if (s.atualizado_em > ms_) ms_ = s.atualizado_em; }
  return hash([n, maxF, ni, maxI, ns, ms_, banco.estimativas.valores().length, banco.classificacoes.valores().length, banco.retrabalhoTasks.valores().length, banco.sprintItens.valores().length, banco.eventosRetrabalho.valores().length].join("|"));
}

export function montarPainel(d: DepsPainel, ws: string, filtros: FiltrosAgil = FILTROS_VAZIOS): PainelAgil {
  const { banco, config } = d;
  const agora = d.relogio();
  const hoje = diaDe(isoDe(agora));
  const todos = montarItensMetrica(banco, ws);
  const itens = filtrarItens(todos, filtros);
  const sprints = banco.sprints.valores().filter((s) => s.workspace_id === ws);
  const sprint = escolherSprint(sprints, filtros);
  const fechadas = sprints.filter((s) => s.estado === "fechada");
  const de = filtros.de ?? (sprint ? sprint.inicio : somarDias(hoje, -29));
  const ate = filtros.ate ?? (sprint && sprint.fim < hoje ? sprint.fim : hoje);
  const noPeriodo = (i: ItemMetrica): boolean => !i.concluida_em || ((!filtros.de || diaDe(i.concluida_em) >= filtros.de) && (!filtros.ate || diaDe(i.concluida_em) <= filtros.ate));
  const itensP = itens.filter(noPeriodo);

  const burnPts = sprint ? calcularBurn({ sprint, itens, unidade: "pontos", config, hoje }) : null;
  const burnUp = burnPts;
  const velocidade = calcularVelocidade(filtros.sprint_id ? fechadas.filter((s) => s.id === filtros.sprint_id) : fechadas, itens);
  const cfd = calcularCfd(itens, de, ate);
  const cycle = cycleTime(itensP, config.amostra_minima);
  const lead = leadTime(itensP, config.amostra_minima);
  const tp = throughput(itens, de, ate, "dia");
  const wip = calcularWip(itens, de, ate, agora, config.wip["em_andamento"] ?? null);

  const doSprint = (s: SprintAgil): ItemMetrica[] => itens.filter((i) => i.participacoes.some((p) => p.sprint_id === s.id && !p.removido_em));
  const linhas = itens.filter((i) => i.situacao !== null || i.estado_fluxo === "concluida" || i.estado_fluxo === "validada").map((i) => linhaRetrabalho(i, i.participacoes[0]?.sprint_id ?? null));
  const geral = resumirRetrabalho(linhas, banco.eventosRetrabalho.valores().filter((e) => e.workspace_id === ws && e.ativo && e.natureza === "escopo").length);
  const porSprint = fechadas.sort((a, b) => a.fim.localeCompare(b.fim)).map((s) => ({ sprint_id: s.id, resumo: resumirRetrabalho(doSprint(s).map((i) => linhaRetrabalho(i, s.id))) }));
  const cats = new Map<string, LinhaRetrabalho[]>();
  for (const l of linhas) (cats.get(l.categoria ?? "sem_categoria") ?? cats.set(l.categoria ?? "sem_categoria", []).get(l.categoria ?? "sem_categoria"))?.push(l);
  const porCategoria = [...cats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([categoria, ls]) => ({ categoria, resumo: resumirRetrabalho(ls) }));

  const planejado = sprint ? calcularPlanejado(sprint, itens) : null;
  const defeitos = calcularDefeitosEscapados(sprints, todos, d.ocorrencias ?? []);
  const ativos = itens.filter((i) => !i.orfao);
  const dist = { risco: {} as Record<string, number>, categoria: {} as Record<string, number>, criticidade: {} as Record<string, number>, sem_classificacao: 0 };
  for (const i of ativos) {
    if (i.risco === null) { dist.sem_classificacao++; continue; }
    dist.risco[i.risco] = (dist.risco[i.risco] ?? 0) + 1;
    dist.categoria[i.categoria ?? "sem_categoria"] = (dist.categoria[i.categoria ?? "sem_categoria"] ?? 0) + 1;
    dist.criticidade[i.criticidade ?? "sem_criticidade"] = (dist.criticidade[i.criticidade ?? "sem_criticidade"] ?? 0) + 1;
  }

  const restante = sprint ? doSprint(sprint).filter((i) => !i.concluida_em).length : 0;
  const amostra = amostraDiasUteis(throughput(itens, somarDias(hoje, -29), hoje, "dia"), config);
  const previsao: PrevisaoEstado = d.previsao ?? (amostra.length >= 10 && amostra.reduce((a, b) => a + b, 0) >= 5 && restante > 0 ? { estado: "calculando" } : { estado: "dados_insuficientes" });

  const naSprint = sprint ? doSprint(sprint) : [];
  const ftrSprint = sprint ? resumirRetrabalho(naSprint.map((i) => linhaRetrabalho(i, sprint.id))).first_time_right : null;
  const anteriores = porSprint.filter((p) => !sprint || p.sprint_id !== sprint.id).slice(-3).map((p) => p.resumo.first_time_right).filter((x): x is number => x !== null);
  const atrasos = detectarAtrasadas(itens, agora);
  const wipAtual = wip.dias[wip.dias.length - 1]?.valor ?? null;
  const saude = indicadoresSaude({
    burn: burnPts, hoje, escopo_adicionado_pct: planejado && planejado.compromisso_inicial > 0 ? planejado.adicionado_meio / planejado.compromisso_inicial : null,
    wip_atual: wipAtual, wip_limite: config.wip["em_andamento"] ?? null, bloqueios_abertos: d.bloqueios_abertos ?? null, sem_estimativa: sprint ? burnPts?.sem_estimativa ?? 0 : null,
    ftr_sprint: ftrSprint, ftr_media_movel: anteriores.length >= 1 ? anteriores.reduce((a, b) => a + b, 0) / anteriores.length : null, atrasadas: atrasos.sem_base ? null : atrasos.atrasadas.length,
    qa_reprovado_pendente: sprint ? naSprint.filter((i) => i.qa_reprovacoes > 0 && i.estado_fluxo !== "validada").length : null,
    compromisso: sprint?.compromisso_pontos ?? null, capacidade: sprint?.capacidade_pontos ?? null, risco_critico: sprint ? naSprint.filter((i) => i.risco === "critico").length : null, limiares: config.limiares_saude,
  });

  const idsDoWs = new Set(todos.map((i) => i.item_id));
  const erro = agregarErro(banco.erros.valores().filter((e) => idsDoWs.has(e.item_id)));
  const valor_esforco = itens.flatMap((i) => {
    const q = quadranteValorEsforco(i.valor, i.pontos);
    return q && i.valor !== null && i.pontos !== null ? [{ item_id: i.item_id, valor: i.valor, esforco: i.pontos, quadrante: q }] : [];
  });
  return {
    filtros, gerado_em: isoDe(agora),
    base: { tasks: itens.filter((i) => i.task_ref !== null).length, itens: itens.length, sprints: sprints.length, sem_estimativa: itens.filter((i) => i.pontos === null && !i.orfao).length, sem_rastro: itens.filter((i) => i.task_ref !== null && !i.tem_rastro).length },
    burndown: burnPts, burnup: burnUp, velocidade, cfd, cycle, lead, throughput: tp, wip,
    retrabalho: { ...geral, por_sprint: porSprint, por_categoria: porCategoria }, planejado_entregue: planejado, defeitos_escapados: defeitos, distribuicao: dist, previsao, saude, erro_estimativa: erro, valor_esforco,
  };
}

/** cache por (workspace, filtros, versão dos dados): mudou fato/estimativa/sprint => recomputa. */
export function criarPainelComCache(d: DepsPainel): { obter(ws: string, f?: FiltrosAgil): { painel: PainelAgil; do_cache: boolean }; invalidar(): void } {
  const cache = new Map<string, { versao: string; painel: PainelAgil }>();
  return {
    obter(ws, f = FILTROS_VAZIOS) {
      const chave = `${ws}|${JSON.stringify(f)}`;
      const v = versaoDados(d.banco, ws);
      const c = cache.get(chave);
      if (c && c.versao === v) return { painel: c.painel, do_cache: true };
      const painel = montarPainel(d, ws, f);
      cache.set(chave, { versao: v, painel });
      return { painel, do_cache: false };
    },
    invalidar: () => cache.clear(),
  };
}
