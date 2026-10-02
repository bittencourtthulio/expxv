// Lógica pura do dashboard da Gestão ágil (sem React): malha bento de 12 colunas, indicadores-chave com delta e micrográfico, lista "pede atenção".
// Testada em painel-logica.test.ts. Nada aqui lê o DOM nem formata cor: o tom (`bom`/`aviso`/`alerta`) vira token no CSS.
import type { PainelAgil } from "../../../compartilhado/agil";

// ---------------------------------------------------------------------------------------------------------------- formatação
const arred = (v: number, casas = 1): number => { const f = 10 ** casas; return Math.round(v * f) / f; };
/** número em PT-BR (vírgula decimal, sem zeros sobrando). */
export const numeroBr = (v: number, casas = 1): string => String(arred(v, casas)).replace(".", ",");
export const percentualBr = (v: number): string => `${numeroBr(v * 100, 0)} %`;
/** horas curtas para indicador: `4,2 h`, `38 h`, `3,5 d` (a partir de 48 h). */
export function duracaoCurta(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${numeroBr(h, h < 10 ? 1 : 0)} h`;
  return `${numeroBr(h / 24, 1)} d`;
}
/** `2026-10-02` -> `02/10`. */
export const diaMes = (iso: string | null): string => (iso === null || !/^\d{4}-\d{2}-\d{2}/.test(iso) ? "—" : `${iso.slice(8, 10)}/${iso.slice(5, 7)}`);

// ---------------------------------------------------------------------------------------------------------------- delta
export type TomDelta = "bom" | "ruim" | "neutro";
export type Direcao = "sobe" | "desce" | "igual";
export interface Delta { texto: string; tom: TomDelta; direcao: Direcao }

/** Compara `atual` com `anterior`. `maisEBom`: subir é bom (velocidade) ou ruim (retrabalho). `limiar`: variação relativa abaixo da qual é "estável". */
export function deltaRelativo(atual: number, anterior: number | null, maisEBom: boolean, limiar = 0.03): Delta | null {
  if (anterior === null || !Number.isFinite(anterior) || !Number.isFinite(atual)) return null;
  if (anterior === 0) return atual === 0 ? { texto: "estável", tom: "neutro", direcao: "igual" } : { texto: "novo", tom: "neutro", direcao: atual > 0 ? "sobe" : "desce" };
  const rel = (atual - anterior) / Math.abs(anterior);
  if (Math.abs(rel) < limiar) return { texto: "estável", tom: "neutro", direcao: "igual" };
  const sobe = rel > 0;
  return { texto: `${sobe ? "+" : "−"}${numeroBr(Math.abs(rel) * 100, 0)} %`, tom: sobe === maisEBom ? "bom" : "ruim", direcao: sobe ? "sobe" : "desce" };
}
/** Diferença em pontos percentuais (frações 0–1). */
export function deltaPontos(atual: number, anterior: number | null, maisEBom: boolean, limiar = 0.01): Delta | null {
  if (anterior === null || !Number.isFinite(anterior) || !Number.isFinite(atual)) return null;
  const d = atual - anterior;
  if (Math.abs(d) < limiar) return { texto: "estável", tom: "neutro", direcao: "igual" };
  const sobe = d > 0;
  return { texto: `${sobe ? "+" : "−"}${numeroBr(Math.abs(d) * 100, 0)} pp`, tom: sobe === maisEBom ? "bom" : "ruim", direcao: sobe ? "sobe" : "desce" };
}

// ---------------------------------------------------------------------------------------------------------------- micrográfico
/** Caminho SVG (`M x y L …`) da série em uma caixa `w`×`h` com folga `pad`; valores `null` são ignorados. Série constante vira linha no meio. */
export function caminhoSpark(valores: ReadonlyArray<number | null>, w: number, h: number, pad = 2): { d: string; ultimo: { x: number; y: number } | null } {
  const pontos = valores.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null && Number.isFinite(p.v));
  if (pontos.length === 0) return { d: "", ultimo: null };
  const min = Math.min(...pontos.map((p) => p.v)); const max = Math.max(...pontos.map((p) => p.v));
  const span = max - min;
  const n = Math.max(1, valores.length - 1);
  const xy = pontos.map((p) => ({ x: arred(pad + (p.i / n) * (w - 2 * pad), 2), y: arred(span === 0 ? h / 2 : h - pad - ((p.v - min) / span) * (h - 2 * pad), 2) }));
  return { d: xy.map((p, k) => `${k === 0 ? "M" : "L"}${p.x} ${p.y}`).join(""), ultimo: xy[xy.length - 1] ?? null };
}
/** reduz uma série a no máximo `max` pontos por média de baldes (micrográfico não precisa de mais). */
export function reduzirSerie(v: readonly number[], max: number): number[] {
  if (v.length <= max) return [...v];
  const out: number[] = [];
  for (let b = 0; b < max; b++) {
    const ini = Math.floor((b * v.length) / max); const fim = Math.max(ini + 1, Math.floor(((b + 1) * v.length) / max));
    const fatia = v.slice(ini, fim);
    out.push(fatia.reduce((a, x) => a + x, 0) / fatia.length);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- indicadores-chave
export type TomKpi = "normal" | "aviso" | "alerta";
export interface Kpi {
  id: "progresso" | "velocidade" | "cycle" | "wip" | "retrabalho" | "previsao";
  rotulo: string;
  valor: string;
  /** complemento do valor na mesma linha (ex.: `/ 6`). */
  sufixo: string | null;
  delta: Delta | null;
  nota: string | null;
  spark: number[];
  /** 0–1: barra fina no lugar do micrográfico (WIP em relação ao limite, chance de fechar a sprint). */
  medidor: number | null;
  tom: TomKpi;
  vazio: boolean;
  /** frase completa para leitor de tela e `title`. */
  descricao: string;
}
const media = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, x) => a + x, 0) / xs.length);
const naoNulos = (xs: ReadonlyArray<number | null>): number[] => xs.filter((x): x is number => x !== null);

function kpiProgresso(p: PainelAgil): Kpi {
  const dias = p.burndown?.dias ?? [];
  const feitos = dias.filter((d) => d.concluido !== null);
  const ult = feitos[feitos.length - 1];
  if (ult === undefined || ult.escopo <= 0) return { id: "progresso", rotulo: "Progresso da sprint", valor: "—", sufixo: null, delta: null, nota: "Sem sprint ativa", spark: [], medidor: null, tom: "normal", vazio: true, descricao: "Progresso da sprint: sem sprint ativa." };
  const frac = (ult.concluido as number) / ult.escopo;
  const idealFrac = 1 - ult.ideal / ult.escopo;
  const dif = frac - idealFrac;
  const delta: Delta = Math.abs(dif) < 0.02 ? { texto: "no ritmo ideal", tom: "neutro", direcao: "igual" }
    : { texto: `${numeroBr(Math.abs(dif) * 100, 0)} pp ${dif > 0 ? "à frente" : "atrás"}`, tom: dif > 0 ? "bom" : dif < -0.1 ? "ruim" : "neutro", direcao: dif > 0 ? "sobe" : "desce" };
  const restante = ult.restante;
  return {
    id: "progresso", rotulo: "Progresso da sprint", valor: percentualBr(frac), sufixo: null, delta, nota: restante === null ? null : `restam ${numeroBr(restante)} ${p.burndown?.unidade === "itens" ? "itens" : "pts"}`,
    spark: naoNulos(dias.map((d) => d.restante)), medidor: null, tom: dif < -0.1 ? "alerta" : dif < -0.03 ? "aviso" : "normal", vazio: false,
    descricao: `Progresso da sprint: ${percentualBr(frac)} concluído, ${delta.texto} em relação ao ideal.`,
  };
}

function kpiVelocidade(p: PainelAgil): Kpi {
  const v = p.velocidade;
  if (v.length === 0) return { id: "velocidade", rotulo: "Velocidade", valor: "—", sufixo: null, delta: null, nota: "Nenhuma sprint fechada", spark: [], medidor: null, tom: "normal", vazio: true, descricao: "Velocidade: nenhuma sprint fechada ainda." };
  const ult3 = v.slice(-3).map((x) => x.concluido); const ant3 = v.slice(-6, -3).map((x) => x.concluido);
  const m = media(ult3) as number;
  const delta = deltaRelativo(m, media(ant3), true);
  return {
    id: "velocidade", rotulo: "Velocidade", valor: numeroBr(m, 0), sufixo: "pts", delta, nota: `média de ${ult3.length} sprints`, spark: v.slice(-16).map((x) => x.concluido), medidor: null, tom: "normal", vazio: false,
    descricao: `Velocidade: média de ${numeroBr(m, 0)} pontos nas últimas ${ult3.length} sprints${delta === null ? "" : `, ${delta.texto} sobre as anteriores`}.`,
  };
}

function kpiCycle(p: PainelAgil): Kpi {
  const c = p.cycle;
  if (c.p50 === null || c.amostras.length === 0) return { id: "cycle", rotulo: "Cycle time (mediana)", valor: "—", sufixo: null, delta: null, nota: "Sem tasks concluídas", spark: [], medidor: null, tom: "normal", vazio: true, descricao: "Cycle time: sem tasks concluídas com duração observada." };
  const ordenadas = c.amostras.map((a) => a.ms).sort((a, b) => a - b);
  const meia = c.amostras.slice(Math.floor(c.amostras.length / 2));
  const antes = c.amostras.slice(0, Math.floor(c.amostras.length / 2));
  const mediana = (xs: { ms: number }[]): number | null => (xs.length === 0 ? null : ([...xs].map((x) => x.ms).sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number));
  const ant = mediana(antes); const rec = mediana(meia);
  return {
    id: "cycle", rotulo: "Cycle time (mediana)", valor: duracaoCurta(c.p50), sufixo: null, delta: rec === null ? null : deltaRelativo(rec, ant, false, 0.05),
    nota: c.p85 === null ? null : `85 % em até ${duracaoCurta(c.p85)}`, spark: reduzirSerie(ordenadas, 24), medidor: null, tom: "normal", vazio: false,
    descricao: `Cycle time: metade das tasks termina em até ${duracaoCurta(c.p50)}${c.p85 === null ? "" : `; 85 % em até ${duracaoCurta(c.p85)}`}.`,
  };
}

function kpiWip(p: PainelAgil): Kpi {
  const dias = p.wip.dias;
  if (dias.length === 0) return { id: "wip", rotulo: "Em andamento (WIP)", valor: "—", sufixo: null, delta: null, nota: "Nada em andamento", spark: [], medidor: null, tom: "normal", vazio: true, descricao: "WIP: nada em andamento." };
  const agora = (dias[dias.length - 1] as { valor: number }).valor;
  const lim = p.wip.limite;
  const tom: TomKpi = lim === null ? "normal" : agora > lim ? "alerta" : agora === lim ? "aviso" : "normal";
  const ontem = dias.length > 1 ? (dias[dias.length - 2] as { valor: number }).valor : null;
  return {
    id: "wip", rotulo: "Em andamento (WIP)", valor: String(agora), sufixo: lim === null ? null : `/ ${lim}`,
    delta: ontem === null || ontem === agora ? null : { texto: `${agora > ontem ? "+" : "−"}${Math.abs(agora - ontem)} vs. ontem`, tom: lim !== null && agora > lim ? "ruim" : "neutro", direcao: agora > ontem ? "sobe" : "desce" },
    nota: lim === null ? "sem limite definido" : agora > lim ? `${agora - lim} acima do limite` : agora === lim ? "no limite" : `${lim - agora} de folga`,
    spark: dias.slice(-30).map((d) => d.valor), medidor: lim === null || lim <= 0 ? null : Math.min(1, agora / lim), tom, vazio: false,
    descricao: `WIP: ${agora} tasks em andamento${lim === null ? "" : ` para um limite de ${lim}`}.`,
  };
}

function kpiRetrabalho(p: PainelAgil): Kpi {
  const r = p.retrabalho;
  if (r.ir === null) return { id: "retrabalho", rotulo: "Retrabalho", valor: "—", sufixo: null, delta: null, nota: r.em_observacao > 0 ? `${r.em_observacao} tasks em observação` : "Sem tasks avaliáveis", spark: [], medidor: null, tom: "normal", vazio: true, descricao: "Retrabalho: sem tasks avaliáveis ainda." };
  const serie = r.por_sprint.map((s) => s.resumo.ir).filter((x): x is number => x !== null);
  const ultimo = serie[serie.length - 1];
  const anterior = media(serie.slice(0, -1));
  return {
    id: "retrabalho", rotulo: "Retrabalho", valor: percentualBr(r.ir), sufixo: null, delta: ultimo === undefined ? null : deltaPontos(ultimo, anterior, false),
    nota: r.first_time_right === null ? null : `${percentualBr(r.first_time_right)} de primeira`, spark: serie.slice(-16), medidor: null, tom: r.ir >= 0.3 ? "alerta" : r.ir >= 0.2 ? "aviso" : "normal", vazio: false,
    descricao: `Retrabalho: ${percentualBr(r.ir)} das tasks avaliadas${r.first_time_right === null ? "" : `, ${percentualBr(r.first_time_right)} feitas de primeira`}.`,
  };
}

function kpiPrevisao(p: PainelAgil): Kpi {
  const pv = p.previsao;
  if (pv.estado !== "ok") return { id: "previsao", rotulo: "Previsão (85 %)", valor: "—", sufixo: null, delta: null, nota: pv.estado === "calculando" ? "Calculando…" : "Histórico insuficiente", spark: [], medidor: null, tom: "normal", vazio: true, descricao: "Previsão de término: histórico insuficiente." };
  const prob = pv.prob_fechar_na_sprint;
  return {
    id: "previsao", rotulo: "Previsão (85 %)", valor: diaMes(pv.p85_data), sufixo: `${pv.p85_dias} d úteis`, delta: null,
    nota: prob === null ? `restam ${numeroBr(pv.restante, 0)}` : `${percentualBr(prob)} de fechar na sprint`, spark: [], medidor: prob, tom: prob === null ? "normal" : prob < 0.25 ? "alerta" : prob < 0.5 ? "aviso" : "normal", vazio: false,
    descricao: `Previsão: em 85 % dos cenários termina até ${diaMes(pv.p85_data)} (${pv.p85_dias} dias úteis)${prob === null ? "" : `; chance de fechar a sprint: ${percentualBr(prob)}`}.`,
  };
}

export function calcularKpis(p: PainelAgil): Kpi[] {
  return [kpiProgresso(p), kpiVelocidade(p), kpiCycle(p), kpiWip(p), kpiRetrabalho(p), kpiPrevisao(p)];
}

// ---------------------------------------------------------------------------------------------------------------- "pede atenção"
export type TomItem = "normal" | "aviso" | "alerta";
export interface ItemAtencao { id: string; titulo: string; valor: string; tom: TomItem }
export interface GrupoAtencao { id: "parados" | "retrabalho" | "dados"; titulo: string; itens: ItemAtencao[]; vazio: string }

export function calcularAtencao(p: PainelAgil): GrupoAtencao[] {
  const p85 = p.cycle.p85; const p95 = p.cycle.p95;
  const parados = [...p.wip.idade].sort((a, b) => b.idade_ms - a.idade_ms).slice(0, 3).map((x): ItemAtencao => ({
    id: x.ref, titulo: x.ref, valor: duracaoCurta(x.idade_ms), tom: p95 !== null && x.idade_ms > p95 ? "alerta" : p85 !== null && x.idade_ms > p85 ? "aviso" : "normal",
  }));
  const ret = p.retrabalho.por_categoria.filter((c) => c.resumo.ir !== null).sort((a, b) => (b.resumo.ir as number) - (a.resumo.ir as number)).slice(0, 3).map((c): ItemAtencao => ({
    id: c.categoria, titulo: c.categoria, valor: percentualBr(c.resumo.ir as number), tom: (c.resumo.ir as number) >= 0.3 ? "alerta" : (c.resumo.ir as number) >= 0.2 ? "aviso" : "normal",
  }));
  const dados: ItemAtencao[] = [];
  if (p.base.sem_estimativa > 0) dados.push({ id: "sem_estimativa", titulo: "Itens sem estimativa", valor: String(p.base.sem_estimativa), tom: "aviso" });
  if (p.base.sem_rastro > 0) dados.push({ id: "sem_rastro", titulo: "Itens sem rastro do método", valor: String(p.base.sem_rastro), tom: "aviso" });
  return [
    { id: "parados", titulo: "Em andamento há mais tempo", itens: parados, vazio: "Nada em andamento." },
    { id: "retrabalho", titulo: "Retrabalho por categoria", itens: ret, vazio: "Sem tasks avaliáveis ainda." },
    { id: "dados", titulo: "Dados que faltam", itens: dados, vazio: "Tudo estimado e com rastro." },
  ];
}

// ---------------------------------------------------------------------------------------------------------------- malha bento
export type Colunas = 12 | 6 | 1;
export type Papel = "heroi" | "lateral" | "bloco" | "vazio";
export interface EntradaBloco { id: string; vazio: boolean }
export interface BlocoPlano { id: string; papel: Papel; span: number; linhas: number }

/** largura preferida (em 12 colunas) de cada bloco do dashboard; é o desenho, não um acaso: o que decide é a importância. */
export const LARGURA_PREFERIDA: Readonly<Record<string, number>> = {
  burndown: 8, velocidade: 5, previsao: 4, planejado: 3, cfd: 7, burnup: 5, throughput: 4, cycle: 4, lead: 4, wip: 4, retrabalho: 4, "valor-esforco": 4,
  defeitos: 4, distribuicao: 4, "erro-estimativa": 4, saude: 4, atencao: 4,
};
/** ordem de leitura dos blocos depois da faixa do herói. */
export const ORDEM_BLOCOS: readonly string[] = ["velocidade", "previsao", "planejado", "cfd", "burnup", "throughput", "cycle", "lead", "wip", "retrabalho", "valor-esforco", "defeitos", "distribuicao", "erro-estimativa"];
/** candidatos a gráfico herói, do mais importante ao menos. */
export const HEROIS: readonly string[] = ["burndown", "cfd", "velocidade", "throughput"];

/** colunas da malha para a largura (px) do painel; 0 = ainda sem medida (primeira pintura, testes) e vale a malha cheia. */
export function colunasParaLargura(largura: number): Colunas {
  if (!(largura > 0) || largura >= 880) return 12;
  return largura >= 560 ? 6 : 1;
}

const escalar = (span: number, colunas: Colunas): number => (colunas === 12 ? span : colunas === 1 ? 1 : Math.max(2, Math.round(span / 2)));

/** Empacota blocos em linhas de `colunas`; a sobra de cada linha é repartida (maiores primeiro) para a malha fechar sem buracos. */
export function empacotar(prefs: ReadonlyArray<{ id: string; span: number }>, colunas: number): Array<Array<{ id: string; span: number }>> {
  const linhas: Array<Array<{ id: string; span: number }>> = [];
  let atual: Array<{ id: string; span: number }> = []; let soma = 0;
  for (const b of prefs) {
    const span = Math.min(colunas, Math.max(1, b.span));
    if (soma + span > colunas && atual.length > 0) { linhas.push(atual); atual = []; soma = 0; }
    atual.push({ id: b.id, span }); soma += span;
  }
  if (atual.length > 0) linhas.push(atual);
  for (const l of linhas) {
    let sobra = colunas - l.reduce((a, b) => a + b.span, 0);
    const ordem = [...l].sort((a, b) => b.span - a.span);
    for (let k = 0; sobra > 0; k = (k + 1) % ordem.length, sobra--) (ordem[k] as { span: number }).span++;
  }
  return linhas;
}

/**
 * Plano da malha: herói (primeiro candidato com dados; se nenhum tiver, o burndown com a orientação) + coluna lateral ("saude" e "atencao"),
 * depois os blocos com dados na ordem de leitura e, por último, os sem dados (compactos, só com a orientação do que falta).
 * A ordem do resultado é a ordem do DOM e da leitura por teclado.
 */
export function planejarBento(entrada: readonly EntradaBloco[], colunas: Colunas): BlocoPlano[] {
  const por = new Map(entrada.map((e) => [e.id, e]));
  const tem = (id: string): boolean => por.has(id);
  const heroi = HEROIS.find((id) => por.get(id)?.vazio === false) ?? (tem("burndown") ? "burndown" : null);
  const saudeLat = tem("saude") && por.get("saude")?.vazio === false;
  const out: BlocoPlano[] = [];
  const lateralLinhas = colunas === 12 ? 1 : 1;
  if (heroi !== null) {
    out.push({ id: heroi, papel: "heroi", span: colunas === 12 ? 8 : colunas === 6 ? 6 : 1, linhas: colunas === 12 ? 2 : 1 });
    const lat = [...(saudeLat ? ["saude"] : []), ...(tem("atencao") ? ["atencao"] : [])];
    lat.forEach((id) => out.push({ id, papel: "lateral", span: colunas === 12 ? 4 : colunas === 6 ? (lat.length === 1 ? 6 : 3) : 1, linhas: colunas === 12 && lat.length === 1 ? 2 : lateralLinhas }));
  }
  const usados = new Set(out.map((b) => b.id));
  const restante = (vazio: boolean): EntradaBloco[] => {
    const ordem = [...(heroi === null ? ["atencao"] : []), ...ORDEM_BLOCOS, ...HEROIS, "saude", "burnup", "planejado", "previsao"];
    const vistos = new Set<string>();
    const lista: EntradaBloco[] = [];
    for (const id of [...ordem, ...entrada.map((e) => e.id)]) { const e = por.get(id); if (e !== undefined && !vistos.has(id) && !usados.has(id) && e.vazio === vazio) { vistos.add(id); lista.push(e); } }
    return lista;
  };
  for (const [vazio, papel] of [[false, "bloco"], [true, "vazio"]] as const) {
    const prefs = restante(vazio).map((e) => ({ id: e.id, span: vazio ? escalar(4, colunas) : escalar(LARGURA_PREFERIDA[e.id] ?? 4, colunas) }));
    for (const linha of empacotar(prefs, colunas)) for (const b of linha) { out.push({ id: b.id, papel, span: b.span, linhas: 1 }); usados.add(b.id); }
  }
  return out;
}
