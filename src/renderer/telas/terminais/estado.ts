import type { LayoutTerminais } from "../../../compartilhado/terminais";
import { dividir, folhas, montarLayout, podeDividir, remover, restaurarLayout, type NoPainel, type Orientacao } from "./layout";
import { vizinhoCircular } from "./atalhos";

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
}

export const GRADE_VAZIA: EstadoGrade = { abas: [], ativa: null, expandido: null, fixadas: [], proximoId: 1 };

export type AcaoGrade =
  | { tipo: "nova-aba"; sessao_id: string }
  | { tipo: "dividir"; alvo: string; orientacao: Orientacao; nova: string }
  | { tipo: "fechar"; sessao_id: string }
  | { tipo: "focar"; sessao_id: string }
  | { tipo: "selecionar-aba"; id: string }
  | { tipo: "aba-numero"; numero: number }
  | { tipo: "aba-passo"; passo: 1 | -1 }
  | { tipo: "painel-passo"; passo: 1 | -1 }
  | { tipo: "expandir" }
  | { tipo: "fixar"; id: string }
  | { tipo: "restaurar"; layout: LayoutTerminais | null; sessoes: readonly string[] }
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
  return { ...e, abas, ativa, expandido: e.expandido === id ? null : e.expandido, fixadas: e.fixadas.filter((f) => raizes.has(f)) };
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
      return { abas, ativa: r.ativa ?? (abas[0] ? folhas(abas[0].arvore)[0] ?? null : null), expandido: null, fixadas: r.fixadas, proximoId };
    }
    case "sumiram": return a.sessoes.reduce(semSessao, e);
  }
}

/** Layout gravável do estado atual (só sessões que o store conhece). */
export const layoutDoEstado = (e: EstadoGrade, existe: (id: string) => boolean): LayoutTerminais => montarLayout(e.abas, e.ativa, e.fixadas, existe);

/** Gravar só depois da recuperação e nunca com sessão provisória (abertura em curso). */
export const podeGravarLayout = (recuperado: boolean, pendentes: number): boolean => recuperado && pendentes === 0;
