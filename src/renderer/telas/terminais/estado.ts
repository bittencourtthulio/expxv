import type { LayoutTerminais } from "../../../compartilhado/terminais";
import { NOS_MAXIMOS, PROFUNDIDADE_MAXIMA, contarNos, dividir, folhas, montarLayout, podar, podeDividir, profundidade, remover, restaurarLayout, type NoPainel, type Orientacao } from "./layout";
import { arvoreEmGrade, caberNaGrade } from "./grade-auto";
import { layoutOrquestrador, type Medida, type NoOrquestracao, type PapelNo } from "./layout-orquestrador";
import { vizinhoCircular } from "./atalhos";

/** Papel de uma sessão no layout "orquestrador + workers" (D-515): vem da Missão avulsa; `pai` = orquestrador que abriu o worker; `ordem` = ordem de chegada (o `#id` do Pane). */
export interface PapelDeOrquestracao { papel: PapelNo; pai?: string; ordem: number }
export type PapeisDeOrquestracao = Readonly<Record<string, PapelDeOrquestracao>>;

export interface Aba { id: string; arvore: NoPainel }

/** Estado visual da grade: abas com suas árvores, a sessão em foco e o painel expandido. Puro (reducer). */
export interface EstadoGrade {
  abas: readonly Aba[];
  /** sessão em foco (pertence a alguma aba). */
  ativa: string | null;
  /** painel ocupando a aba inteira (só enquanto existir). */
  expandido: string | null;
  fixadas: readonly string[];
  proximoId: number;
  /** papéis dos painéis que orquestram (sessão → papel); vazio/ausente = nenhuma aba usa o layout orquestrador + workers. */
  orquestracao?: PapeisDeOrquestracao;
  /** tamanho do corpo da grade em px (a regra de mínimos legíveis usa); `null`/ausente = tamanho padrão. */
  area?: Medida | null;
}

export const GRADE_VAZIA: EstadoGrade = { abas: [], ativa: null, expandido: null, fixadas: [], proximoId: 1 };

export type AcaoGrade =
  | { tipo: "nova-aba"; sessao_id: string }
  | { tipo: "dividir"; alvo: string; orientacao: Orientacao; nova: string }
  | { tipo: "fechar"; sessao_id: string }
  /** sessão aberta pelo main (worker de painel que orquestra): entra na grade do `junto_de` (grupo = irmãos do mesmo pedinte) sem roubar o foco. */
  | { tipo: "adotar"; sessao_id: string; junto_de: string | null; grupo: readonly string[]; maximo: number }
  /** a sessão `de` deu lugar a `para` (reabertura com outra configuração): mesma posição, foco e fixação. */
  | { tipo: "trocar"; de: string; para: string }
  /** papéis dos painéis que orquestram e a medida do corpo (D-515); não refaz nada sozinho: o próximo `adotar`/`fechar` usa. */
  | { tipo: "orquestracao"; nos: readonly NoOrquestracao[]; area: Medida | null }
  | { tipo: "focar"; sessao_id: string }
  | { tipo: "selecionar-aba"; id: string }
  | { tipo: "aba-numero"; numero: number }
  | { tipo: "aba-passo"; passo: 1 | -1 }
  | { tipo: "painel-passo"; passo: 1 | -1 }
  | { tipo: "expandir" }
  | { tipo: "fixar"; id: string }
  | { tipo: "restaurar"; layout: LayoutTerminais | null; sessoes: readonly string[] }
  /** D-570: troca de workspace: entra o estado guardado daquele workspace (a medida do corpo e os papéis de orquestração atuais valem; o resto é dele). */
  | { tipo: "substituir"; estado: EstadoGrade; faltantes?: readonly string[] }
  /** D-570: o dono arrastou um divisor: a divisão cujo primeiro filho começa em `a` e o segundo em `b` passa a ter a proporção `razao` (lembrada por workspace). */
  | { tipo: "proporcao"; a: string; b: string; razao: number }
  | { tipo: "sumiram"; sessoes: readonly string[] };

export const abaDaSessao = (e: EstadoGrade, id: string | null): Aba | undefined => (id === null ? undefined : e.abas.find((a) => folhas(a.arvore).includes(id)));
export const abaAtiva = (e: EstadoGrade): Aba | undefined => abaDaSessao(e, e.ativa);

/** Painéis visíveis agora: só a aba ativa (o resto está desmontado); expandido mostra um só. */
export function painelsVisiveis(e: EstadoGrade): string[] {
  const aba = abaAtiva(e);
  if (aba === undefined) return [];
  return e.expandido !== null && folhas(aba.arvore).includes(e.expandido) ? [e.expandido] : folhas(aba.arvore);
}

const nova = (e: EstadoGrade, sessao_id: string): EstadoGrade => ({
  ...e, abas: [...e.abas, { id: `aba-${e.proximoId}`, arvore: { tipo: "terminal", sessao_id } }], ativa: sessao_id, expandido: null, proximoId: e.proximoId + 1,
});

function semSessao(e: EstadoGrade, id: string): EstadoGrade {
  const aba = abaDaSessao(e, id);
  if (aba === undefined) return e;
  const indice = e.abas.indexOf(aba);
  const arvore = remover(aba.arvore, id);
  const abas = arvore === null ? e.abas.filter((a) => a !== aba) : e.abas.map((a) => (a === aba ? { ...a, arvore } : a));
  let ativa = e.ativa;
  if (ativa === id || ativa === null) {
    ativa = arvore !== null ? (folhas(arvore)[0] ?? null) : (abas[Math.min(indice, abas.length - 1)] ? folhas(abas[Math.min(indice, abas.length - 1)]!.arvore)[0] ?? null : null);
  }
  const raizes = new Set(abas.map((a) => folhas(a.arvore)[0]));
  const semEle = { ...e, abas, ativa, expandido: e.expandido === id ? null : e.expandido, fixadas: e.fixadas.filter((f) => raizes.has(f)) };
  // D-516: fechar um worker (ou um orquestrador) reflui a grade do grupo; o foco perdido volta ao orquestrador (a primeira folha do layout)
  return arvore !== null && e.orquestracao?.[id] !== undefined ? refluirAba(semEle, arvore, e.ativa === id) : semEle;
}

/** Aba nova sem mexer no foco (a pessoa continua onde estava); sem foco algum, a sessão passa a ser a ativa. */
function novaSemFoco(e: EstadoGrade, sessao_id: string): EstadoGrade {
  const ativa = e.ativa;
  const n = nova(e, sessao_id);
  return { ...n, ativa: ativa ?? sessao_id, expandido: e.expandido };
}

function trocarFolha(no: NoPainel, alvo: string, por: NoPainel): NoPainel {
  if (no.tipo === "terminal") return no.sessao_id === alvo ? por : no;
  return { ...no, primeiro: trocarFolha(no.primeiro, alvo, por), segundo: trocarFolha(no.segundo, alvo, por) };
}

/** Nós de orquestração (com papel conhecido) entre as sessões dadas. */
function nosDe(e: EstadoGrade, ids: readonly string[]): NoOrquestracao[] {
  const papeis = e.orquestracao ?? {};
  return ids.flatMap((id) => { const p = papeis[id]; return p === undefined ? [] : [{ id, ...p }]; });
}

/**
 * Refaz a árvore de uma aba pela regra "orquestrador + workers" (D-515). Só mexe nas folhas com papel; terminais comuns da aba ficam onde estavam (o grupo ocupa o lugar do primeiro
 * orquestrador). Devolve a árvore nova e os workers que NÃO couberam com tamanho legível (vão para outra aba). `null` = a aba não tem orquestrador (regra não se aplica).
 */
function refazerArvore(e: EstadoGrade, arvore: NoPainel, extras: readonly string[]): { arvore: NoPainel; excedentes: string[] } | null {
  const naArvore = folhas(arvore);
  const ids = [...naArvore, ...extras.filter((x) => !naArvore.includes(x))];
  const nos = nosDe(e, ids);
  const r = layoutOrquestrador(nos, e.area === undefined || e.area === null ? {} : { area: e.area });
  if (r.arvore === null) return null;
  const grupo = new Set(nos.map((n) => n.id));
  const ancora = r.orquestradores[0] as string;
  const resto = podar(arvore, (id) => !grupo.has(id) || id === ancora);
  if (resto === null) return null;
  const novaArvore = trocarFolha(resto, ancora, r.arvore);
  if (profundidade(novaArvore) > PROFUNDIDADE_MAXIMA || contarNos(novaArvore) > NOS_MAXIMOS) return null;
  return { arvore: novaArvore, excedentes: r.excedentes };
}

/** Reflui a aba que sobrou depois de um fechamento; sem orquestrador na aba nada muda. `focoPerdido`: o foco da sessão que saiu volta ao primeiro orquestrador. */
function refluirAba(e: EstadoGrade, arvore: NoPainel, focoPerdido: boolean): EstadoGrade {
  const aba = e.abas.find((a) => a.arvore === arvore);
  if (aba === undefined) return e;
  const r = refazerArvore(e, arvore, []);
  if (r === null) return e;
  let estado: EstadoGrade = { ...e, abas: e.abas.map((x) => (x === aba ? { ...x, arvore: r.arvore } : x)) };
  for (const id of r.excedentes) estado = novaSemFoco(estado, id);
  if (focoPerdido) estado = { ...estado, ativa: folhas(r.arvore)[0] ?? estado.ativa };
  return estado;
}

function adotarOrquestrado(e: EstadoGrade, a: Extract<AcaoGrade, { tipo: "adotar" }>, aba: Aba): EstadoGrade | null {
  const papeis = e.orquestracao;
  if (papeis === undefined || a.junto_de === null || papeis[a.junto_de]?.papel !== "orquestrador" || papeis[a.sessao_id] === undefined) return null;
  const r = refazerArvore(e, aba.arvore, [a.sessao_id]);
  if (r === null) return null;
  // se o novo (ou algum antigo, numa janela que encolheu) não coube com tamanho legível, vai para outra aba; os demais seguem refluídos
  let estado: EstadoGrade = { ...e, abas: e.abas.map((x) => (x === aba ? { ...x, arvore: r.arvore } : x)), ativa: e.ativa ?? a.junto_de };
  for (const id of r.excedentes) estado = novaSemFoco(estado, id);
  const raizes = new Set(estado.abas.map((x) => folhas(x.arvore)[0]));
  return { ...estado, fixadas: estado.fixadas.filter((f) => raizes.has(f)) };
}

function adotar(e: EstadoGrade, a: Extract<AcaoGrade, { tipo: "adotar" }>): EstadoGrade {
  if (abaDaSessao(e, a.sessao_id) !== undefined) return e;
  const aba = a.junto_de === null ? undefined : abaDaSessao(e, a.junto_de);
  if (aba === undefined || a.junto_de === null) return novaSemFoco(e, a.sessao_id);
  const orquestrado = adotarOrquestrado(e, a, aba);
  if (orquestrado !== null) return orquestrado;
  const naAba = folhas(aba.arvore);
  // os irmãos seguem a ordem atual das folhas da aba (a chegada de um novo nunca embaralha os que já estão na tela)
  const grupo = new Set(a.grupo);
  const irmaos = naAba.filter((id) => id !== a.junto_de && id !== a.sessao_id && grupo.has(id));
  const ordem = [a.junto_de, ...irmaos, a.sessao_id];
  if (!caberNaGrade(ordem.length, a.maximo)) return novaSemFoco(e, a.sessao_id);
  const grade = arvoreEmGrade(ordem);
  const semIrmaos = podar(aba.arvore, (id) => !irmaos.includes(id));
  if (grade === null || semIrmaos === null) return novaSemFoco(e, a.sessao_id);
  const arvore = trocarFolha(semIrmaos, a.junto_de, grade);
  if (profundidade(arvore) > PROFUNDIDADE_MAXIMA || contarNos(arvore) > NOS_MAXIMOS) return novaSemFoco(e, a.sessao_id);
  const abas = e.abas.map((x) => (x === aba ? { ...x, arvore } : x));
  const raizes = new Set(abas.map((x) => folhas(x.arvore)[0]));
  return { ...e, abas, ativa: e.ativa ?? a.junto_de, fixadas: e.fixadas.filter((f) => raizes.has(f)) };
}

export function reduzir(e: EstadoGrade, a: AcaoGrade): EstadoGrade {
  switch (a.tipo) {
    case "nova-aba": return abaDaSessao(e, a.sessao_id) === undefined ? nova(e, a.sessao_id) : { ...e, ativa: a.sessao_id };
    case "dividir": {
      const aba = abaDaSessao(e, a.alvo);
      if (aba === undefined || abaDaSessao(e, a.nova) !== undefined || !podeDividir(aba.arvore, a.alvo)) return e;
      return { ...e, abas: e.abas.map((x) => (x === aba ? { ...x, arvore: dividir(x.arvore, a.alvo, a.orientacao, a.nova) } : x)), ativa: a.nova, expandido: null };
    }
    case "fechar": return semSessao(e, a.sessao_id);
    case "adotar": return adotar(e, a);
    case "trocar": {
      const aba = abaDaSessao(e, a.de);
      if (aba === undefined || abaDaSessao(e, a.para) !== undefined) return e;
      const abas = e.abas.map((x) => (x === aba ? { ...x, arvore: trocarFolha(x.arvore, a.de, { tipo: "terminal", sessao_id: a.para }) } : x));
      const troca = (id: string): string => (id === a.de ? a.para : id);
      return { ...e, abas, ativa: e.ativa === null ? null : troca(e.ativa), expandido: e.expandido === null ? null : troca(e.expandido), fixadas: e.fixadas.map(troca) };
    }
    case "orquestracao": {
      const novo: Record<string, PapelDeOrquestracao> = {};
      for (const n of a.nos) novo[n.id] = { papel: n.papel, ordem: n.ordem, ...(n.pai === undefined ? {} : { pai: n.pai }) };
      const atual = e.orquestracao ?? {};
      // quem ainda está na grade mas saiu do mapa de Missões mantém o papel: o fechamento precisa saber o papel de quem acabou de sair
      const naGrade = new Set(e.abas.flatMap((x) => folhas(x.arvore)));
      for (const [id, p] of Object.entries(atual)) if (!(id in novo) && naGrade.has(id)) novo[id] = p;
      const mesmosPapeis = Object.keys(novo).length === Object.keys(atual).length && Object.entries(novo).every(([id, p]) => atual[id]?.papel === p.papel && atual[id]?.ordem === p.ordem && atual[id]?.pai === p.pai);
      const areaAtual = e.area ?? null;
      const mesmaArea = areaAtual === a.area || (areaAtual !== null && a.area !== null && areaAtual.largura === a.area.largura && areaAtual.altura === a.area.altura);
      return mesmosPapeis && mesmaArea ? e : { ...e, orquestracao: novo, area: a.area };
    }
    case "focar": return abaDaSessao(e, a.sessao_id) === undefined || e.ativa === a.sessao_id ? e : { ...e, ativa: a.sessao_id, expandido: e.expandido === a.sessao_id ? e.expandido : null };
    case "selecionar-aba": {
      const aba = e.abas.find((x) => x.id === a.id);
      if (aba === undefined || aba === abaAtiva(e)) return e;
      return { ...e, ativa: folhas(aba.arvore)[0] ?? null, expandido: null };
    }
    case "aba-numero": {
      const aba = e.abas[a.numero - 1];
      return aba === undefined ? e : reduzir(e, { tipo: "selecionar-aba", id: aba.id });
    }
    case "aba-passo": {
      const proxima = vizinhoCircular(e.abas.map((x) => x.id), abaAtiva(e)?.id ?? null, a.passo);
      return proxima === null ? e : reduzir(e, { tipo: "selecionar-aba", id: proxima });
    }
    case "painel-passo": {
      const aba = abaAtiva(e);
      if (aba === undefined) return e;
      const vizinho = vizinhoCircular(folhas(aba.arvore), e.ativa, a.passo);
      return vizinho === null ? e : { ...e, ativa: vizinho, expandido: null };
    }
    case "expandir": {
      const aba = abaAtiva(e);
      if (aba === undefined || e.ativa === null || folhas(aba.arvore).length < 2) return { ...e, expandido: null };
      return { ...e, expandido: e.expandido === e.ativa ? null : e.ativa };
    }
    case "fixar": {
      if (!e.abas.some((x) => x.id === a.id)) return e;
      const raiz = folhas(e.abas.find((x) => x.id === a.id)!.arvore)[0]!;
      return { ...e, fixadas: e.fixadas.includes(raiz) ? e.fixadas.filter((f) => f !== raiz) : [...e.fixadas, raiz] };
    }
    case "restaurar": {
      const r = restaurarLayout(a.layout, a.sessoes);
      let proximoId = e.proximoId;
      const abas = r.grupos.map((arvore) => ({ id: `aba-${proximoId++}`, arvore }));
      const ativa = r.ativa ?? (abas[0] ? folhas(abas[0].arvore)[0] ?? null : null);
      const naTela = new Set(abas.flatMap((x) => folhas(x.arvore)));
      const expandido = a.layout?.expandido != null && naTela.has(a.layout.expandido) && a.layout.expandido === ativa ? a.layout.expandido : null;
      return { abas, ativa, expandido, fixadas: r.fixadas, proximoId, ...(e.orquestracao === undefined ? {} : { orquestracao: e.orquestracao }), ...(e.area === undefined ? {} : { area: e.area }) };
    }
    case "substituir": {
      // sessões do workspace que nasceram enquanto ele estava oculto (e não são "externas") entram como abas, sem roubar o foco
      let novo: EstadoGrade = { ...a.estado, ...(e.area === undefined ? {} : { area: e.area }) };
      for (const id of a.faltantes ?? []) if (abaDaSessao(novo, id) === undefined) novo = novaSemFoco(novo, id);
      return novo;
    }
    case "proporcao": {
      const razao = Math.min(0.9, Math.max(0.1, a.razao));
      const ajustar = (no: NoPainel): NoPainel => {
        if (no.tipo === "terminal") return no;
        if (folhas(no.primeiro)[0] === a.a && folhas(no.segundo)[0] === a.b) return no.proporcao === razao ? no : { ...no, proporcao: razao };
        const primeiro = ajustar(no.primeiro);
        const segundo = ajustar(no.segundo);
        return primeiro === no.primeiro && segundo === no.segundo ? no : { ...no, primeiro, segundo };
      };
      const abas = e.abas.map((x) => { const arvore = ajustar(x.arvore); return arvore === x.arvore ? x : { ...x, arvore }; });
      return abas.some((x, i) => x !== e.abas[i]) ? { ...e, abas } : e;
    }
    case "sumiram": return a.sessoes.reduce(semSessao, e);
  }
}

/** Layout gravável do estado atual (só sessões que o store conhece). */
export const layoutDoEstado = (e: EstadoGrade, existe: (id: string) => boolean, focoUnico = false): LayoutTerminais => montarLayout(e.abas, e.ativa, e.fixadas, existe, { expandido: e.expandido, focoUnico });

/** Gravar só depois da recuperação e nunca com sessão provisória (abertura em curso). */
export const podeGravarLayout = (recuperado: boolean, pendentes: number): boolean => recuperado && pendentes === 0;
