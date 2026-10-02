// Fixture sintética da Fase 18 (T-18.08): 40 sprints de histórico, 6 membros (2 agentes), tasks com retrabalho de cada fonte (QA reprovado, reabertura, commit de
// correção, escopo vs defeito), QA, commits e ocorrências. Tudo EM MEMÓRIA (modelo `Trabalho` + rastro), determinístico (sem aleatório, sem relógio real). Usa os
// construtores de tests/fixtures/metodo (sem editá-los). Os valores esperados estão em `historico-esperado.ts`, calculados À MÃO.
import type { EventoRastro, Trabalho } from "../../../src/nucleo/metodo/tipos";
import type { CommitEntrega, FonteTrabalho, OcorrenciaRunx, QaFonte } from "../../../src/nucleo/agil/portas";
import { criarAgil, type Agil } from "../../../src/nucleo/agil/agil";
import type { BancoAgil } from "../../../src/nucleo/agil/repos";
import { processarRetrabalho } from "../../../src/nucleo/agil/retrabalho/processar";
import { registrarErro, recalcularErros } from "../../../src/nucleo/agil/estimativa/erro";
import { sincronizar } from "../../../src/nucleo/agil/fatos/sincronizar";
import { hash } from "../../../src/nucleo/agil/util";
import { ev, tk, trab } from "../metodo/construtores";

export const WS = "ws1";
export const HOJE = "2027-12-01T12:00:00.000Z";
export const SPRINTS = 40;
/** pontos por task (T-01.01..T-01.04), duração observada em horas e categoria. */
export const PONTOS = [3, 5, 2, 8] as const;
export const DURACAO_H = [2, 4, 1, 6] as const;
export const CATEGORIAS = ["feature", "feature", "bug", "feature"] as const;
export const AGENTES = ["impl-1", "ana", "bruno", "impl-2"] as const;
export const REFS = ["T-01.01", "T-01.02", "T-01.03", "T-01.04"] as const;

const DIA = 86_400_000;
export const somaDias = (dia: string, n: number): string => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
export const inicioDaSprint = (n: number): string => somaDias("2026-01-05", 14 * (n - 1));
export const fimDaSprint = (n: number): string => somaDias(inicioDaSprint(n), 11);
export const trabalhoDaSprint = (n: number): string => `feat-${String(n).padStart(2, "0")}`;
const hh = (dia: string, h: number): string => `${dia}T${String(h).padStart(2, "0")}:00:00.000Z`;

/** a task T4 não é concluída nas sprints múltiplas de 4. */
export const t4Concluida = (n: number): boolean => n % 4 !== 0;
/** deslocamento (dias desde o início) da conclusão de cada task. T1 reaberta (n % 10 == 0) conclui no dia +2. */
export const diaConclusao = (n: number, k: number): number => (k === 0 ? (n % 10 === 0 ? 2 : 1) : ([1, 3, 4, 8] as const)[k] as number);

function eventosDaTask(n: number, k: number): EventoRastro[] {
  const tid = trabalhoDaSprint(n);
  const base = { trabalho_id: tid, task: REFS[k] as string, agente: AGENTES[k] as string };
  const d0 = inicioDaSprint(n);
  const fimD = somaDias(d0, [1, 3, 4, 8][k] as number);
  const dur = DURACAO_H[k] as number;
  const out: EventoRastro[] = [];
  const fimH = 10 + dur;
  out.push(ev({ ...base, evento: "task_iniciada", ts: hh(fimD, 10) }));
  // arquivos: T1 e T3 testes primeiro; T2 e T4 produção primeiro
  const testes = k === 0 || k === 2;
  out.push(ev({ ...base, evento: "arquivo_alterado", ts: hh(fimD, 10), arquivos: testes ? [`tests/t${k}.test.ts`, `src/t${k}.ts`] : [`src/t${k}.ts`, `tests/t${k}.test.ts`] }));
  // suíte: T1 vermelho antes do verde; as demais já nascem verdes
  if (k === 0) out.push(ev({ ...base, evento: "suite_executada", ts: hh(fimD, 10), resultado: "falha" }));
  out.push(ev({ ...base, evento: "suite_executada", ts: hh(fimD, fimH - 1 > 10 ? fimH - 1 : 10), resultado: "ok" }));
  out.push(ev({ ...base, evento: "task_concluida", ts: hh(fimD, fimH) }));
  if (k === 0 && n % 10 === 0) {
    // reabertura: mesma duração (2 h); conclui no dia +2
    const d2 = somaDias(d0, 2);
    out.push(ev({ ...base, evento: "task_iniciada", ts: hh(d2, 8) }), ev({ ...base, evento: "task_concluida", ts: hh(d2, 10) }));
  }
  return out;
}

function commitsDaSprint(n: number): CommitEntrega[] {
  const d0 = inicioDaSprint(n);
  const cs: CommitEntrega[] = [];
  for (let k = 0; k < 4; k++) {
    if (k === 3 && !t4Concluida(n)) continue;
    cs.push({ sha: `c${n}-${k}`, mensagem: `feat(${REFS[k]}): entrega ${k}`, ts: hh(somaDias(d0, [1, 3, 4, 8][k] as number), 9), linhas: 120, labels: [], task_ref: REFS[k] as string });
  }
  if (n % 7 === 0) cs.push({ sha: `f${n}`, mensagem: "fix(T-01.03): corrige borda", ts: hh(somaDias(d0, 6), 11), linhas: 20, labels: [], task_ref: "T-01.03" });
  if (n % 9 === 0) cs.push({ sha: `e${n}`, mensagem: "feat(T-01.01): novo campo pedido pelo cliente", ts: hh(somaDias(d0, 7), 11), linhas: 60, labels: [], task_ref: "T-01.01" });
  return cs;
}

export function fonteDaSprint(n: number): FonteTrabalho {
  const concl = (k: number): boolean => k !== 3 || t4Concluida(n);
  const tasks = REFS.map((ref, k) => tk(ref, {
    titulo: `Task ${ref} da sprint ${n}`, status: concl(k) ? "concluida" : "em_andamento", suite: concl(k) ? "verde" : "parcial", depende_de: k === 3 ? ["T-01.01"] : [],
    concluida_em: concl(k) ? somaDias(inicioDaSprint(n), diaConclusao(n, k)) : null, teste_integracao: "integra", teste_funcional: "funciona", teste_regressao: k === 2 ? "regride" : null,
  }));
  const tid = trabalhoDaSprint(n);
  const rastro = REFS.flatMap((_, k) => (concl(k) ? eventosDaTask(n, k) : [ev({ trabalho_id: tid, task: REFS[k] as string, agente: AGENTES[k] as string, evento: "task_iniciada", ts: hh(inicioDaSprint(n), 9) })]));
  const trabalho: Trabalho = trab({ id: tid, titulo: `Feature ${n}`, status: t4Concluida(n) ? "concluido" : "em_andamento", veredito_qa: t4Concluida(n) ? "aprovado" : null, ultima_atividade: hh(fimDaSprint(n), 18) }, tasks);
  const qa: QaFonte = {
    veredito: trabalho.veredito_qa, emitido_em: hh(fimDaSprint(n), 18),
    achados: n % 5 === 0 ? [{ id: "a1", severidade: "alta", categoria: null, task: "T-01.02", arquivos: [], descricao: "validação ausente no cadastro" }, { id: "a2", severidade: "baixa", categoria: null, task: "T-01.01", arquivos: [], descricao: "texto do botão" }] : [],
  };
  return { workspace_id: WS, trabalho, rastro, commits: commitsDaSprint(n), qa, versao_origem: hash(`${tid}|v1`) };
}

export const todasAsFontes = (): FonteTrabalho[] => Array.from({ length: SPRINTS }, (_, i) => fonteDaSprint(i + 1));

/** bug aberto DEPOIS do fechamento da sprint n (múltiplos de 8), regressão do trabalho da sprint. */
export function ocorrencias(): OcorrenciaRunx[] {
  return Array.from({ length: SPRINTS }, (_, i) => i + 1).filter((n) => n % 8 === 0).map((n) => ({
    id: `oc-${n}`, tipo: "bug", aberta_em: hh(somaDias(fimDaSprint(n), 3), 9), regressao_de: trabalhoDaSprint(n), categoria: "api", task_ref: null, arquivos: [],
  }));
}

export const MEMBROS = [
  { rotulo: "Ana", tipo: "humano" as const, alias: ["ana"] },
  { rotulo: "Bruno", tipo: "humano" as const, alias: ["bruno"] },
  { rotulo: "Carla", tipo: "humano" as const, alias: ["carla"] },
  { rotulo: "Diego", tipo: "humano" as const, alias: ["diego"] },
  { rotulo: "Agente 1", tipo: "agente" as const, alias: ["impl-1"] },
  { rotulo: "Agente 2", tipo: "agente" as const, alias: ["impl-2"] },
];

export interface Historico { agil: Agil; relogio: { agora: number }; sprintIds: string[]; itemId: (n: number, k: number) => string }

/** carrega o histórico completo num `Agil` em memória: membros, fatos, estimativas (humanas), sprints (planejar, iniciar, fechar), erros e retrabalho. */
export async function carregarHistorico(opcoes: { sprints?: number; banco?: BancoAgil } = {}): Promise<Historico> {
  const N = opcoes.sprints ?? SPRINTS;
  const relogio = { agora: Date.parse(HOJE) };
  const agil = criarAgil({ relogio: () => relogio.agora, ...(opcoes.banco ? { banco: opcoes.banco } : {}) });
  const ws = WS;
  agil.config.gravar(ws, {});
  for (const m of MEMBROS) {
    const id = agil.id("mbr");
    agil.banco.membros.set(id, { id, workspace_id: ws, tipo: m.tipo, rotulo: m.rotulo, squad_id: m.tipo === "agente" ? "sq-agentes" : "sq-humanos", horas_dia: m.tipo === "humano" ? 6 : null, fator_foco: 0.6, pontos_sprint_fixo: null, ativo: true, aliases: m.alias.map((valor) => ({ tipo: "agente" as const, valor })) });
  }
  const fontes = Array.from({ length: N }, (_, i) => fonteDaSprint(i + 1));
  await sincronizar({ banco: agil.banco, metodo: agil.portas.metodo, relogio: agil.relogio, id: agil.id, config: agil.config.ler(ws) }, ws, { fontes });
  const porRef = new Map(agil.banco.itens.valores().map((i) => [`${i.trabalho_id}|${i.task_ref}`, i.id]));
  const itemId = (n: number, k: number): string => porRef.get(`${trabalhoDaSprint(n)}|${REFS[k]}`) as string;
  const rev = agil.revisao(ws);
  // estimativas humanas e classificação (categoria) de cada item
  for (let n = 1; n <= N; n++) for (let k = 0; k < 4; k++) {
    const id = itemId(n, k);
    rev.gravarEstimativa({ item_id: id, pontos: PONTOS[k] as number, estado: "ajustada" });
    agil.banco.classificacoes.set(`cls-${id}`, { id: `cls-${id}`, item_id: id, versao: 1, categoria: CATEGORIAS[k] as string, risco: k === 3 ? "alto" : "baixo", criticidade: "media", tipo_task: null, risco_fatores: [], origem: "humano", motor: "manual", confianca: 1, estado: "ajustada", ativa: true, criado_em: HOJE });
  }
  const sp = agil.sprint(ws);
  const sprintIds: string[] = [];
  for (let n = 1; n <= N; n++) {
    const ini = inicioDaSprint(n);
    relogio.agora = Date.parse(hh(somaDias(ini, -3), 9));
    const s = sp.criar({ nome: `Sprint ${n}`, inicio: ini, fim: fimDaSprint(n), meta: `meta ${n}` });
    sprintIds.push(s.id);
    for (let k = 0; k < 4; k++) sp.adicionar(s.id, itemId(n, k));
    relogio.agora = Date.parse(hh(ini, 9));
    sp.iniciar(s.id);
    relogio.agora = Date.parse(hh(somaDias(fimDaSprint(n), 1), 9));
    sp.fechar({ sprint_id: s.id, destino_pendentes: "backlog", ator: "humano" });
  }
  relogio.agora = Date.parse(HOJE);
  processarRetrabalho({ banco: agil.banco, relogio: agil.relogio, id: agil.id, config: agil.config.ler(ws) }, ws, fontes, ocorrencias().filter((o) => Number(o.id.slice(3)) <= N));
  // erro de estimativa: uma linha por item concluído (reabertura não duplica)
  for (const f of agil.banco.fatos.valores()) {
    if (f.status_visto !== "concluida") continue;
    const k = REFS.indexOf(f.task_ref as (typeof REFS)[number]);
    const id = porRef.get(`${f.trabalho_id}|${f.task_ref}`) as string;
    registrarErro(agil.banco, { item_id: id, estimativa_id: `est-${id}`, pontos: PONTOS[k] as number, categoria: CATEGORIAS[k] as string, observado_ms: f.duracao_obs_ms, real_h: null }, agil.relogio);
  }
  recalcularErros(agil.banco);
  return { agil, relogio, sprintIds, itemId };
}

/** volume: `trabalhos` trabalhos com `tasksPorTrabalho` tasks (P-180 etc.), determinístico. */
export function gerarVolumeAgil(opcoes: { trabalhos?: number; tasksPorTrabalho?: number } = {}): FonteTrabalho[] {
  const T = opcoes.trabalhos ?? 200;
  const K = opcoes.tasksPorTrabalho ?? 25;
  return Array.from({ length: T }, (_, t) => {
    const tid = `vol-${String(t).padStart(3, "0")}`;
    const d0 = somaDias("2026-01-05", (t % 80) * 7);
    const refs = Array.from({ length: K }, (_, k) => `T-${String(Math.floor(k / 5) + 1).padStart(2, "0")}.${String((k % 5) + 1).padStart(2, "0")}`);
    const feita = (k: number): boolean => (t + k) % 5 !== 0;
    const tasks = refs.map((ref, k) => tk(ref, { titulo: `Task ${ref} de ${tid}`, status: feita(k) ? "concluida" : "em_andamento", suite: feita(k) ? "verde" : "parcial", depende_de: k % 5 === 4 ? [refs[k - 1] as string] : [], concluida_em: feita(k) ? somaDias(d0, 1 + (k % 6)) : null }));
    const rastro: EventoRastro[] = refs.flatMap((ref, k) => {
      const dia = somaDias(d0, 1 + (k % 6));
      const base = { trabalho_id: tid, task: ref, agente: AGENTES[k % 4] as string };
      return feita(k)
        ? [ev({ ...base, evento: "task_iniciada", ts: hh(dia, 9) }), ev({ ...base, evento: "arquivo_alterado", ts: hh(dia, 9), arquivos: [`src/${ref}.ts`, `tests/${ref}.test.ts`] }), ev({ ...base, evento: "suite_executada", ts: hh(dia, 10), resultado: "ok" }), ev({ ...base, evento: "task_concluida", ts: hh(dia, 9 + 1 + (k % 5)) })]
        : [ev({ ...base, evento: "task_iniciada", ts: hh(dia, 9) })];
    });
    const trabalho: Trabalho = trab({ id: tid, titulo: `Volume ${t}`, veredito_qa: "aprovado", ultima_atividade: hh(somaDias(d0, 8), 12) }, tasks);
    const qa: QaFonte = { veredito: "aprovado", emitido_em: hh(somaDias(d0, 9), 12), achados: t % 9 === 0 ? [{ id: "a1", severidade: "media", categoria: null, task: refs[1] as string, arquivos: [], descricao: "ajuste" }] : [] };
    return { workspace_id: WS, trabalho, rastro, commits: [], qa, versao_origem: hash(`${tid}|v1`) };
  });
}
