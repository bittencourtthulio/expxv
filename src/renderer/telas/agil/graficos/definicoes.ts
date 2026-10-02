// Dados dos 16 gráficos a partir de `PainelAgil` (puro). Cada definição traz o(s) SVG(s), a tabela equivalente, o "n = …" e o estado vazio (o que falta).
import type { DispersaoTempo, IndicadorSaude, MetodoAgil, PainelAgil } from "../../../../compartilhado/agil";
import { graficoBarras, graficoBarrasHorizontais, graficoDispersao, graficoLinhas, graficoPrevisao, graficoSaude, type NoSvg } from "../../../../compartilhado/svg";
import { horas } from "../logica";
import { diaMes, duracaoCurta, numeroBr, percentualBr } from "../painel-logica";

type Cel = string | number | null;
/** medida real do contêiner (px); sem ela o gráfico sai no tamanho legado (testes, exportação). */
export interface Medida { largura?: number | undefined; altura?: number | undefined }
/** `desenhar` refaz o SVG na medida do contêiner; `no` é a versão no tamanho padrão (calculada só quando alguém pede). */
export interface SvgDef { titulo: string | null; readonly no: NoSvg; desenhar: (m: Medida) => NoSvg }
export type DestinoAcao = "sprint" | "backlog" | "sincronizar";
export interface AcaoVazio { rotulo: string; destino: DestinoAcao }
export interface GraficoDef {
  id: string;
  numero: number;
  titulo: string;
  unidade: string;
  n: number | null;
  nRotulo: string;
  svgs: SvgDef[];
  tabela: { colunas: string[]; linhas: Cel[][] };
  /** explica o que falta para o gráfico existir; `null` = há dados. */
  vazio: string | null;
  metodos: MetodoAgil[];
  /** uma frase com a leitura do gráfico (resumo textual visível e lido por leitor de tela); `null` = sem frase. */
  leitura?: string | null;
  /** botão da orientação do estado vazio. */
  acaoVazio?: AcaoVazio | null;
  /** indicadores de saúde: o cartão desenha uma lista em HTML (cor + forma + palavra) em vez de SVG. */
  saude?: IndicadorSaude[];
}

function svg(titulo: string | null, fazer: (m: Medida) => NoSvg): SvgDef {
  let cache: NoSvg | undefined;
  return { titulo, desenhar: fazer, get no(): NoSvg { cache ??= fazer({}); return cache; } };
}
/** quantas categorias cabem na largura (`porCat` px cada); sem largura, todas. */
const caber = (n: number, m: Medida, porCat: number): number => (m.largura === undefined ? n : Math.max(4, Math.floor((m.largura - 48) / porCat)));
const fim = <T,>(xs: readonly T[], k: number): T[] => (xs.length > k ? xs.slice(xs.length - k) : [...xs]);
const dimDe = (m: Medida): Medida => (m.largura === undefined ? {} : { largura: m.largura, altura: m.altura });

const ULT = 120;
const ultimos = <T,>(xs: readonly T[], n = ULT): T[] => (xs.length > n ? xs.slice(xs.length - n) : [...xs]);
/** `2026-09-14` -> `14/09` (rótulo de eixo em PT-BR). */
export const dia = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const pct = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 10);

function vazioDe(titulo: string, id: string, numero: number, unidade: string, vazio: string, metodos: MetodoAgil[], acaoVazio: AcaoVazio | null = null): GraficoDef {
  return { id, numero, titulo, unidade, n: 0, nRotulo: "pontos", svgs: [], tabela: { colunas: [], linhas: [] }, vazio, metodos, leitura: null, acaoVazio };
}
const SYNC: AcaoVazio = { rotulo: "Sincronizar agora", destino: "sincronizar" };
const IR_SPRINT: AcaoVazio = { rotulo: "Abrir Sprint", destino: "sprint" };
const IR_BACKLOG: AcaoVazio = { rotulo: "Estimar no Backlog", destino: "backlog" };

function dispTempo(id: string, numero: number, titulo: string, d: DispersaoTempo, metodos: MetodoAgil[]): GraficoDef {
  if (d.amostras.length === 0) return vazioDe(titulo, id, numero, "h", "Sem tasks concluídas com duração observada. Rode a sprintx para gerar o rastro e sincronize.", metodos, SYNC);
  const pontos = d.amostras.map((a, i) => ({ x: i + 1, y: horas(a.ms), tip: `${a.ref}: ${horas(a.ms)} h` }));
  const refs = [d.p50, d.p85, d.p95].map((v, k) => (v === null ? null : { valor: horas(v), rotulo: `P${[50, 85, 95][k]} ${horas(v)} h` })).filter((x): x is { valor: number; rotulo: string } => x !== null);
  return {
    id, numero, titulo, unidade: "horas", n: d.n, nRotulo: "tasks",
    svgs: [svg(null, (m) => graficoDispersao({ id, titulo, desc: `${titulo}: dispersão de ${d.n} tasks em horas, com P50, P85 e P95.`, pontos, rotuloX: "task (ordem de conclusão)", rotuloY: "h", refsY: refs, ...dimDe(m) }))],
    tabela: { colunas: ["Task", "Horas"], linhas: [...d.amostras.map((a) => [a.ref, horas(a.ms)] as Cel[]), ["P50", d.p50 === null ? null : horas(d.p50)], ["P85", d.p85 === null ? null : horas(d.p85)], ["P95", d.p95 === null ? null : horas(d.p95)]] },
    vazio: null, metodos,
    leitura: d.p50 === null ? null : `Metade das tasks termina em até ${duracaoCurta(d.p50)}${d.p85 === null ? "" : `; 85 % em até ${duracaoCurta(d.p85)}`}${d.p95 === null ? "" : `; 95 % em até ${duracaoCurta(d.p95)}`}.`,
  };
}

/** leitura do burndown: restante real contra o ideal no último dia com medida. */
export function leituraBurn(serie: NonNullable<PainelAgil["burndown"]>): string | null {
  const feitos = serie.dias.filter((d) => d.restante !== null);
  const u = feitos[feitos.length - 1];
  if (u === undefined || u.restante === null) return null;
  const un = serie.unidade === "itens" ? "itens" : "pontos";
  const dif = u.restante - u.ideal;
  const cresceu = u.escopo - serie.compromisso_inicial;
  const base = `Restam ${numeroBr(u.restante)} ${un}; o ideal para ${diaMes(u.dia)} seria ${numeroBr(u.ideal)}`;
  const posicao = Math.abs(dif) < 0.5 ? " (no ritmo)" : dif > 0 ? ` (${numeroBr(dif)} acima)` : ` (${numeroBr(-dif)} abaixo)`;
  return `${base}${posicao}.${cresceu > 0 ? ` O escopo cresceu ${numeroBr(cresceu)} desde o início.` : ""}`;
}

export function montarGraficos(p: PainelAgil): GraficoDef[] {
  const out: GraficoDef[] = [];
  const nomeSprint = new Map(p.velocidade.map((v) => [v.sprint_id, v.nome]));

  // 1 e 2: burndown e burnup
  for (const [numero, id, titulo, serie] of [[1, "burndown", "Burndown", p.burndown], [2, "burnup", "Burnup", p.burnup]] as const) {
    if (serie === null || serie.dias.length === 0) { out.push(vazioDe(titulo, id, numero, "pontos", "Sem sprint ativa neste filtro. Crie e inicie uma sprint na seção Sprint.", ["scrum"], IR_SPRINT)); continue; }
    const dias = serie.dias; const rot = dias.map((d) => dia(d.dia));
    const series = numero === 1
      ? [{ rotulo: "Restante", valores: dias.map((d) => d.restante), modo: "linha" as const }, { rotulo: "Ideal", valores: dias.map((d) => d.ideal), modo: "linha" as const }, { rotulo: "Escopo", valores: dias.map((d) => d.escopo), modo: "degrau" as const }]
      : [{ rotulo: "Escopo", valores: dias.map((d) => d.escopo), modo: "degrau" as const }, { rotulo: "Concluído", valores: dias.map((d) => d.concluido), modo: "linha" as const }];
    out.push({
      id, numero, titulo, unidade: serie.unidade, n: dias.length, nRotulo: "dias",
      svgs: [svg(null, (m) => graficoLinhas({ id, titulo, desc: `${titulo} por dia em ${serie.unidade}. Compromisso inicial ${serie.compromisso_inicial}; ${serie.sem_estimativa} sem estimativa.`, rotulosX: rot, series, unidade: serie.unidade, rotuloDireto: true, ...dimDe(m) }))],
      tabela: { colunas: ["Dia", "Escopo", "Concluído", "Restante", "Ideal"], linhas: dias.map((d) => [d.dia, d.escopo, d.concluido, d.restante, d.ideal]) },
      vazio: null, metodos: ["scrum"], leitura: numero === 1 ? leituraBurn(serie) : null,
    });
  }

  // 3 velocidade
  {
    const v = ultimos(p.velocidade, 40);
    if (v.length === 0) out.push(vazioDe("Velocidade", "velocidade", 3, "pontos", "Nenhuma sprint fechada ainda. A velocidade aparece depois da primeira sprint fechada.", ["scrum"], IR_SPRINT));
    else {
      const ult = v[v.length - 1];
      out.push({
        id: "velocidade", numero: 3, titulo: "Velocidade", unidade: "pontos por sprint", n: v.length, nRotulo: "sprints",
        svgs: [svg(null, (m) => { const w = fim(v, caber(v.length, m, 26)); return graficoBarras({ id: "velocidade", titulo: "Velocidade", desc: "Pontos comprometidos, concluídos e concluídos de primeira por sprint.", categorias: w.map((x) => x.nome), series: [{ rotulo: "Compromisso", valores: w.map((x) => x.compromisso) }, { rotulo: "Concluído", valores: w.map((x) => x.concluido) }, { rotulo: "De primeira", valores: w.map((x) => x.de_primeira) }], unidade: "pontos", ref: ult?.media_movel_3 != null ? { valor: ult.media_movel_3, rotulo: "média 3" } : null, ...dimDe(m) }); })],
        tabela: { colunas: ["Sprint", "Compromisso", "Concluído", "De primeira", "Média móvel 3"], linhas: v.map((x) => [x.nome, x.compromisso, x.concluido, x.de_primeira, x.media_movel_3]) }, vazio: null, metodos: ["scrum"],
        leitura: ult === undefined ? null : `${ult.nome} fechou ${numeroBr(ult.concluido, 0)} pontos${ult.compromisso === null ? "" : ` de ${numeroBr(ult.compromisso, 0)} comprometidos`}${ult.media_movel_3 === null ? "" : `; média das 3 últimas: ${numeroBr(ult.media_movel_3, 0)}`}.`,
      });
    }
  }

  // 4 CFD
  {
    const a = p.cfd.acumulado;
    if (a.length === 0) out.push(vazioDe("Fluxo cumulativo (CFD)", "cfd", 4, "tasks", "Sem tasks no período. Sincronize o método para ver o fluxo cumulativo.", ["lean"], SYNC));
    else {
      const u = ultimos(a);
      const ult = u[u.length - 1];
      out.push({
        id: "cfd", numero: 4, titulo: "Fluxo cumulativo (CFD)", unidade: "tasks", n: u.length, nRotulo: "dias",
        svgs: [svg(null, (m) => graficoLinhas({ id: "cfd", titulo: "Fluxo cumulativo", desc: "Tasks acumuladas por estado: validada, concluída, em andamento, pronto e backlog.", rotulosX: u.map((x) => dia(x.dia)), empilhado: true, unidade: "tasks", rotuloDireto: true, series: [
          { rotulo: "Validada", valores: u.map((x) => x.validada), modo: "area" }, { rotulo: "Concluída", valores: u.map((x) => x.concluida), modo: "area" }, { rotulo: "Em andamento", valores: u.map((x) => x.em_andamento), modo: "area" },
          { rotulo: "Pronto", valores: u.map((x) => x.pronto), modo: "area" }, { rotulo: "Backlog", valores: u.map((x) => x.backlog), modo: "area" }], ...dimDe(m) }))],
        tabela: { colunas: ["Dia", "Backlog", "Pronto", "Em andamento", "Concluída", "Validada"], linhas: u.map((x) => [x.dia, x.backlog, x.pronto, x.em_andamento, x.concluida, x.validada]) }, vazio: null, metodos: ["lean"],
        leitura: ult === undefined ? null : `Hoje: ${numeroBr(ult.backlog, 0)} no backlog, ${numeroBr(ult.pronto, 0)} prontas, ${numeroBr(ult.em_andamento, 0)} em andamento, ${numeroBr(ult.concluida + ult.validada, 0)} concluídas.`,
      });
    }
  }

  // 5 e 6
  out.push(dispTempo("cycle", 5, "Cycle time", p.cycle, ["lean"]));
  out.push(dispTempo("lead", 6, "Lead time", p.lead, ["lean"]));

  // 7 throughput
  {
    const t = ultimos(p.throughput);
    if (t.length === 0) out.push(vazioDe("Throughput", "throughput", 7, "tasks/dia", "Nenhuma task concluída no período. Sincronize o método para contar as conclusões.", ["lean"], SYNC));
    else {
      const soma = (xs: { valor: number }[]): number => xs.reduce((a, x) => a + x.valor, 0);
      const ult7 = t.slice(-7); const ant7 = t.slice(-14, -7);
      out.push({
        id: "throughput", numero: 7, titulo: "Throughput", unidade: "tasks por dia", n: t.length, nRotulo: "dias",
        svgs: [svg(null, (m) => { const w = fim(t, caber(t.length, m, 5)); return graficoBarras({ id: "throughput", titulo: "Throughput", desc: "Tasks concluídas por dia.", categorias: w.map((x) => dia(x.dia)), series: [{ rotulo: "Concluídas", valores: w.map((x) => x.valor) }], unidade: "tasks", ...dimDe(m) }); })],
        tabela: { colunas: ["Dia", "Concluídas"], linhas: t.map((x) => [x.dia, x.valor]) }, vazio: null, metodos: ["lean"],
        leitura: `Últimos 7 dias: ${soma(ult7)} tasks concluídas${ant7.length === 7 ? `; nos 7 anteriores: ${soma(ant7)}` : ""}.`,
      });
    }
  }

  // 8 WIP
  {
    const w = p.wip;
    if (w.dias.length === 0 && w.idade.length === 0) out.push(vazioDe("WIP e idade do WIP", "wip", 8, "tasks", "Nada em andamento. O WIP aparece quando há tasks iniciadas.", ["lean"], SYNC));
    else {
      const u = ultimos(w.dias);
      const idade = w.idade.slice(0, 30);
      const svgs: SvgDef[] = [];
      if (u.length > 0) svgs.push(svg("WIP por dia", (m) => { const x = fim(u, caber(u.length, m, 4)); return graficoLinhas({ id: "wip", titulo: "WIP por dia", desc: `Tasks em andamento por dia${w.limite === null ? "" : `, limite ${w.limite}`}.`, rotulosX: x.map((y) => dia(y.dia)), series: [{ rotulo: "WIP", valores: x.map((y) => y.valor), modo: "degrau" }], unidade: "tasks", ref: w.limite === null ? null : { valor: w.limite, rotulo: `limite ${w.limite}` }, rotuloDireto: true, ...dimDe(m) }); }));
      if (idade.length > 0) svgs.push(svg("Idade do WIP (dias)", (m) => graficoBarras({ id: "wip-idade", titulo: "Idade do WIP", desc: "Há quantos dias cada task em andamento está aberta.", categorias: idade.map((x) => x.ref), series: [{ rotulo: "Idade (dias)", valores: idade.map((x) => Math.round((x.idade_ms / 86_400_000) * 10) / 10) }], unidade: "dias", ...dimDe(m) })));
      const agora = u[u.length - 1]?.valor;
      out.push({
        id: "wip", numero: 8, titulo: "WIP e idade do WIP", unidade: "tasks / dias", n: u.length + w.idade.length, nRotulo: "pontos", svgs,
        tabela: { colunas: ["Dia / task", "WIP / idade (dias)"], linhas: [...u.map((x) => [x.dia, x.valor] as Cel[]), ...w.idade.map((x) => [x.ref, Math.round((x.idade_ms / 86_400_000) * 10) / 10] as Cel[])] }, vazio: null, metodos: ["lean"],
        leitura: agora === undefined ? null : `Hoje: ${agora} em andamento${w.limite === null ? "" : ` (limite ${w.limite})`}.`,
      });
    }
  }

  // 9 retrabalho
  {
    const r = p.retrabalho;
    const ps = r.por_sprint.filter((x) => x.resumo.ir !== null || x.resumo.first_time_right !== null);
    const pc = r.por_categoria.filter((x) => x.resumo.ir !== null || x.resumo.first_time_right !== null);
    if (ps.length === 0 && pc.length === 0) out.push(vazioDe("Retrabalho e de primeira", "retrabalho", 9, "%", `Sem tasks avaliáveis ainda (${r.em_observacao} em observação, ${r.indeterminado} indeterminadas). O índice só conta tasks fora da janela de observação.`, ["xp", "scrum"]));
    else {
      const svgs: SvgDef[] = [];
      if (ps.length > 0) svgs.push(svg("Por sprint", (m) => { const w = fim(ps, caber(ps.length, m, 22)); return graficoBarras({ id: "retrabalho-sprint", titulo: "Retrabalho por sprint", desc: "Índice de retrabalho e de primeira (%) por sprint.", categorias: w.map((x) => nomeSprint.get(x.sprint_id) ?? x.sprint_id), series: [{ rotulo: "Retrabalho", valores: w.map((x) => pct(x.resumo.ir)) }, { rotulo: "De primeira", valores: w.map((x) => pct(x.resumo.first_time_right)) }], unidade: "%", ...dimDe(m) }); }));
      if (pc.length > 0) svgs.push(svg("Por categoria", (m) => graficoBarras({ id: "retrabalho-cat", titulo: "Retrabalho por categoria", desc: "Índice de retrabalho e de primeira (%) por categoria.", categorias: pc.map((x) => x.categoria), series: [{ rotulo: "Retrabalho", valores: pc.map((x) => pct(x.resumo.ir)) }, { rotulo: "De primeira", valores: pc.map((x) => pct(x.resumo.first_time_right)) }], unidade: "%", ...dimDe(m) })));
      out.push({
        id: "retrabalho", numero: 9, titulo: "Retrabalho e de primeira", unidade: "%", n: r.avaliaveis, nRotulo: "tasks avaliáveis", svgs,
        tabela: { colunas: ["Grupo", "Retrabalho %", "De primeira %", "Avaliáveis"], linhas: [...ps.map((x) => [`Sprint ${nomeSprint.get(x.sprint_id) ?? x.sprint_id}`, pct(x.resumo.ir), pct(x.resumo.first_time_right), x.resumo.avaliaveis] as Cel[]), ...pc.map((x) => [`Categoria ${x.categoria}`, pct(x.resumo.ir), pct(x.resumo.first_time_right), x.resumo.avaliaveis] as Cel[])], },
        vazio: null, metodos: ["xp", "scrum"],
        leitura: r.ir === null ? null : `${percentualBr(r.ir)} das tasks avaliadas tiveram retrabalho${r.first_time_right === null ? "" : `; ${percentualBr(r.first_time_right)} saíram de primeira`}.`,
      });
    }
  }

  // 10 planejado × entregue
  {
    const pe = p.planejado_entregue;
    if (pe === null) out.push(vazioDe("Planejado × entregue", "planejado", 10, "pontos", "Escolha uma sprint (iniciada) no filtro para comparar o planejado com o entregue.", ["scrum"], IR_SPRINT));
    else out.push({
      id: "planejado", numero: 10, titulo: "Planejado × entregue", unidade: "pontos", n: pe.compromisso_inicial + pe.adicionado_meio, nRotulo: "pontos",
      svgs: [svg(null, (m) => graficoBarrasHorizontais({ id: "planejado", titulo: "Planejado × entregue", desc: "Do compromisso inicial e do que entrou no meio: quanto foi entregue.", unidade: "pontos", grupos: [
        { rotulo: "Compromisso", partes: [{ rotulo: "Entregue", valor: pe.entregue_do_compromisso }, { rotulo: "Não entregue", valor: Math.max(0, pe.compromisso_inicial - pe.entregue_do_compromisso - pe.removido) }, { rotulo: "Removido", valor: pe.removido }] },
        { rotulo: "Adicionado", partes: [{ rotulo: "Entregue", valor: pe.entregue_adicionado }, { rotulo: "Não entregue", valor: Math.max(0, pe.adicionado_meio - pe.entregue_adicionado) }] }], ...dimDe(m) }))],
      tabela: { colunas: ["Medida", "Pontos"], linhas: [["Compromisso inicial", pe.compromisso_inicial], ["Entregue do compromisso", pe.entregue_do_compromisso], ["Adicionado no meio", pe.adicionado_meio], ["Entregue do adicionado", pe.entregue_adicionado], ["Removido", pe.removido], ["Carregado", pe.carregado], ["Sem estimativa (itens)", pe.sem_estimativa]] }, vazio: null, metodos: ["scrum"],
      leitura: `Do compromisso de ${numeroBr(pe.compromisso_inicial, 0)} pontos, ${numeroBr(pe.entregue_do_compromisso, 0)} foram entregues; entraram ${numeroBr(pe.adicionado_meio, 0)} no meio e ${numeroBr(pe.entregue_adicionado, 0)} deles saíram.`,
    });
  }

  // 11 defeitos escapados
  {
    const d = p.defeitos_escapados;
    if (d.por_sprint.length === 0) out.push(vazioDe("Defeitos escapados", "defeitos", 11, "defeitos", "Nenhum defeito ligado a entregas de sprints fechadas. Regressões e commits de correção após o fechamento aparecem aqui.", ["xp", "lean"]));
    else out.push({
      id: "defeitos", numero: 11, titulo: "Defeitos escapados", unidade: "defeitos por sprint", n: d.total, nRotulo: "defeitos",
      svgs: [svg(null, (m) => { const w = fim(d.por_sprint, caber(d.por_sprint.length, m, 20)); return graficoBarras({ id: "defeitos", titulo: "Defeitos escapados", desc: "Defeitos encontrados depois da entrega, por sprint.", categorias: w.map((x) => nomeSprint.get(x.sprint_id) ?? x.sprint_id), series: [{ rotulo: "Defeitos", valores: w.map((x) => x.n) }], unidade: "defeitos", ...dimDe(m) }); })],
      tabela: { colunas: ["Sprint / categoria", "Defeitos"], linhas: [...d.por_sprint.map((x) => [nomeSprint.get(x.sprint_id) ?? x.sprint_id, x.n] as Cel[]), ...d.por_categoria.map((x) => [`Categoria ${x.categoria}`, x.n] as Cel[])] }, vazio: null, metodos: ["xp", "lean"],
      leitura: `${d.total} defeitos escaparam depois da entrega.`,
    });
  }

  // 12 distribuição
  {
    const d = p.distribuicao;
    const grupos = [["Risco", d.risco], ["Categoria", d.categoria], ["Criticidade", d.criticidade]] as const;
    const total = grupos.reduce((a, [, r]) => a + Object.values(r).reduce((x, y) => x + y, 0), 0);
    if (total === 0) out.push(vazioDe("Distribuição", "distribuicao", 12, "itens", `Nenhum item classificado (${d.sem_classificacao} sem classificação). Use "Estimar" no backlog para classificar.`, ["scrum", "lean"], IR_BACKLOG));
    else out.push({
      id: "distribuicao", numero: 12, titulo: "Risco, categoria e criticidade", unidade: "% dos itens de cada grupo", n: Math.round(total / 3), nRotulo: "itens",
      svgs: [svg(null, (m) => graficoBarrasHorizontais({ id: "distribuicao", titulo: "Distribuição", desc: "Proporção de itens por risco, categoria e criticidade.", unidade: "%", normalizar: true, grupos: grupos.map(([rot, r]) => ({ rotulo: rot, partes: Object.entries(r).map(([k, v]) => ({ rotulo: k, valor: v })) })), ...dimDe(m) }))],
      tabela: { colunas: ["Grupo", "Valor", "Itens"], linhas: [...grupos.flatMap(([rot, r]) => Object.entries(r).map(([k, v]) => [rot, k, v] as Cel[])), ["Sem classificação", "—", d.sem_classificacao]] }, vazio: null, metodos: ["scrum", "lean"],
      leitura: d.sem_classificacao > 0 ? `${d.sem_classificacao} itens ainda sem classificação.` : null,
    });
  }

  // 13 previsão
  {
    const pv = p.previsao;
    if (pv.estado !== "ok") out.push(vazioDe("Previsão de término", "previsao", 13, "dias", pv.estado === "calculando" ? "Calculando a previsão (simulação Monte Carlo)…" : "Dados insuficientes: a previsão precisa de pelo menos 10 dias de histórico e 5 conclusões.", ["scrum", "lean"], pv.estado === "calculando" ? null : SYNC));
    else out.push({
      id: "previsao", numero: 13, titulo: "Previsão de término", unidade: "dias úteis", n: pv.amostra_dias, nRotulo: "dias de histórico",
      svgs: [svg(null, (m) => graficoPrevisao({ id: "previsao", titulo: "Previsão de término", desc: `Monte Carlo com ${pv.iteracoes} simulações: P50 ${pv.p50_dias}, P85 ${pv.p85_dias}, P95 ${pv.p95_dias} dias para concluir ${pv.restante}.`, p50: pv.p50_dias, p85: pv.p85_dias, p95: pv.p95_dias, r50: `P50 ${pv.p50_dias}`, r85: `P85 ${pv.p85_dias}`, r95: `P95 ${pv.p95_dias}`, unidade: "dias úteis", ...dimDe(m) }))],
      tabela: { colunas: ["Percentil", "Dias úteis", "Data"], linhas: [["P50", pv.p50_dias, pv.p50_data], ["P85", pv.p85_dias, pv.p85_data], ["P95", pv.p95_dias, pv.p95_data], ["Restante", pv.restante, null], ["Probabilidade de fechar na sprint", pv.prob_fechar_na_sprint === null ? null : Math.round(pv.prob_fechar_na_sprint * 100), "%"]] }, vazio: null, metodos: ["scrum", "lean"],
      leitura: `Em 85 % dos cenários termina até ${diaMes(pv.p85_data)} (${pv.p85_dias} dias úteis)${pv.prob_fechar_na_sprint === null ? "" : `; chance de fechar na sprint: ${percentualBr(pv.prob_fechar_na_sprint)}`}.`,
    });
  }

  // 14 saúde
  {
    if (p.saude.length === 0) out.push(vazioDe("Saúde da sprint", "saude", 14, "indicadores", "Sem sprint ativa para avaliar. Inicie uma sprint na seção Sprint.", ["scrum"], IR_SPRINT));
    else out.push({
      id: "saude", numero: 14, titulo: "Saúde da sprint", unidade: "estado atual", n: null, nRotulo: "indicadores",
      svgs: [svg(null, (m) => graficoSaude({ id: "saude", titulo: "Saúde da sprint", desc: "Indicadores com cor, forma e frase.", linhas: p.saude.map((s) => ({ cor: s.cor, frase: s.frase, fato: s.fato })), ...dimDe(m) }))],
      tabela: { colunas: ["Indicador", "Estado", "Frase", "Fato"], linhas: p.saude.map((s) => [s.id, s.cor, s.frase, s.fato]) }, vazio: null, metodos: ["scrum"], saude: p.saude,
      leitura: null,
    });
  }

  // 15 erro de estimativa
  {
    const e = p.erro_estimativa;
    if (e.pontos.length === 0) out.push(vazioDe("Erro de estimativa", "erro-estimativa", 15, "horas", "Nenhum item estimado foi concluído com duração observada. Estime os itens no Backlog e conclua tasks para comparar.", ["scrum", "lean"], IR_BACKLOG));
    else out.push({
      id: "erro-estimativa", numero: 15, titulo: "Erro de estimativa", unidade: "pontos × horas", n: e.pontos.length, nRotulo: "itens",
      svgs: [svg(null, (m) => graficoDispersao({ id: "erro-estimativa", titulo: "Erro de estimativa", desc: `Pontos previstos × horas observadas. Viés ${e.vies ?? "—"}; MdAPE ${e.mdape ?? "—"}.`, pontos: e.pontos.map((x) => ({ x: x.previsto, y: horas(x.observado_ms), tip: `${x.item_id}: ${x.previsto} pts, ${horas(x.observado_ms)} h${x.razao === null ? "" : `, razão ${x.razao}`}` })), rotuloX: "pontos previstos", rotuloY: "horas", ...dimDe(m) }))],
      tabela: { colunas: ["Item", "Previsto (pts)", "Observado (h)", "Razão"], linhas: [...e.pontos.map((x) => [x.item_id, x.previsto, horas(x.observado_ms), x.razao] as Cel[]), ...e.por_categoria.map((c) => [`Categoria ${c.categoria} (n ${c.n})`, null, c.vies, c.mdape] as Cel[])] }, vazio: null, metodos: ["scrum", "lean"],
      leitura: e.mdape === null ? null : `Erro mediano de ${percentualBr(e.mdape)}${e.vies === null ? "" : `; as tasks levam em média ${numeroBr(e.vies, 1)}× o previsto`}.`,
    });
  }

  // 16 valor × esforço
  {
    const v = p.valor_esforco;
    if (v.length === 0) out.push(vazioDe("Valor × esforço", "valor-esforco", 16, "valor × pontos", "Preencha valor/urgência/redução de risco e estime os itens para ver a matriz.", ["lean"], IR_BACKLOG));
    else {
      const ordem = ["ganho_rapido", "grande_aposta", "preencher", "evitar"];
      const meioX = v.map((x) => x.esforco).sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
      const meioY = v.map((x) => x.valor).sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
      const rapidos = v.filter((x) => x.quadrante === "ganho_rapido").length;
      out.push({
        id: "valor-esforco", numero: 16, titulo: "Valor × esforço", unidade: "valor × pontos", n: v.length, nRotulo: "itens",
        svgs: [svg(null, (m) => graficoDispersao({ id: "valor-esforco", titulo: "Valor × esforço", desc: "Matriz de valor por esforço; quadrantes: ganho rápido, grande aposta, preencher e evitar.", pontos: v.map((x) => ({ x: x.esforco, y: x.valor, grupo: ordem.indexOf(x.quadrante), tip: `${x.item_id}: ${x.quadrante.replace("_", " ")} (valor ${x.valor}, esforço ${x.esforco})` })), rotuloX: "esforço (pontos)", rotuloY: "valor", refX: meioX, refYMeio: meioY, ...dimDe(m) }))],
        tabela: { colunas: ["Item", "Valor", "Esforço", "Quadrante"], linhas: v.map((x) => [x.item_id, x.valor, x.esforco, x.quadrante]) }, vazio: null, metodos: ["lean"],
        leitura: `${rapidos} ${rapidos === 1 ? "item é ganho rápido" : "itens são ganhos rápidos"}: valor acima da mediana e esforço abaixo dela.`,
      });
    }
  }
  return out.sort((a, b) => a.numero - b.numero);
}

export function graficosDoMetodo(lista: readonly GraficoDef[], metodo: MetodoAgil | "todos"): GraficoDef[] {
  return metodo === "todos" ? [...lista] : lista.filter((g) => g.metodos.includes(metodo));
}
