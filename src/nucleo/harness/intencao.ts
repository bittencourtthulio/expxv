// classificarIntencao (Fase 9; D-115): texto livre → UMA intenção de uma lista FECHADA (padrão: gestos do dev no método).
// 1) regras determinísticas PT-BR/EN com pesos em DADO (`PESOS_INTENCAO`) + pistas do estado do trabalho; 2) decisor externo opcional
// (só se ligado, consentido e `usar_para.intencao`); a regra é o fallback e o resultado SEMPRE pertence às opções.
// O classificador só devolve RÓTULOS: texto do usuário (inclusive prompt injection como "apague tudo") nunca vira ação.
// Nunca lança. Texto de entrada ≤ 2 000 chars.
import type { ContextoIntencao, OpcaoIntencao, ResultadoIntencao } from "../../compartilhado/harness";
import type { Decisor } from "./decisor/cliente";
import { escolherPorScores, normalizar, pontuar, termosDe, type OpcaoRegra, type ResultadoRegra, type TermoRegra } from "./decisor/regras";

export const TEXTO_MAX = 2000;

/** Intenções padrão (descrições só orientam o decisor; os pesos abaixo orientam as regras). */
export const OPCOES_INTENCAO_PADRAO: readonly OpcaoIntencao[] = [
  { id: "bug", descricao: "defeito em algo que já existe: não funciona, dá erro, valor errado, trava" },
  { id: "feature", descricao: "funcionalidade nova ou mudança de comportamento em sistema existente" },
  { id: "pedido_cru", descricao: "pedido bruto de cliente/suporte ou ideia solta que precisa de triagem antes de virar trabalho" },
  { id: "projeto", descricao: "sistema ou projeto inteiro novo, do zero" },
  { id: "refatoracao", descricao: "melhorar a estrutura do código sem mudar o comportamento" },
  { id: "entrega", descricao: "versionar, abrir pull request, mergear, publicar ou passar para revisão/QA" },
  { id: "duvida", descricao: "pergunta ou pedido de explicação, sem mudança no código" },
  { id: "consulta_historico", descricao: "perguntar o que já foi feito, decidido ou mudado antes" },
];

type Pesos = Record<string, Array<[string, number]>>;

/** Radicais normalizados (sem acento, minúsculas); casam no início de palavra. Peso maior = sinal mais forte. */
export const PESOS_INTENCAO: Pesos = {
  bug: [
    ["bug", 3], ["erro", 2], ["error", 2], ["quebr", 3], ["broken", 2.5], ["crash", 3], ["trava", 2], ["travou", 2], ["freez", 2], ["exception", 3], ["stack trace", 2],
    ["falha", 2], ["falhou", 2], ["corrig", 2.5], ["consert", 3], ["fix", 2.5], ["defeito", 3], ["regress", 2], ["tela branca", 2.5], ["ficou branca", 2],
    ["nao funciona", 3], ["nao esta funcionando", 3], ["nao funcionou", 3], ["parou de", 2], ["deu erro", 3], ["da erro", 3], ["dando erro", 3],
    ["not working", 3], ["doesn t work", 3], ["doesnt work", 3], ["nao salva", 2], ["nao abre", 2], ["nao carrega", 2], ["errado", 1.5], ["wrong", 1],
    ["ocorrencia", 2], ["undefined", 1], ["problema", 1],
  ],
  feature: [
    ["feature", 3], ["funcionalidade", 2.5], ["nova tela", 3], ["novo campo", 3], ["nova opcao", 2], ["novo botao", 2], ["nova funcionalidade", 3],
    ["implement", 2], ["adicion", 2], ["acrescent", 2], ["add|", 1.5], ["criar", 1], ["export", 1.5], ["import", 1.5],
    ["permitir", 1.5], ["suporte a", 1.5], ["support for", 2], ["integr", 1.5], ["endpoint", 1], ["relatorio", 1], ["gostaria que", 1.5], ["quero que", 1],
    ["quero um", 1], ["new feature", 3],
  ],
  pedido_cru: [
    ["seria bom", 3], ["seria legal", 2.5], ["cliente pediu", 3], ["cliente quer", 2.5], ["o cliente", 1.5], ["chamado", 2.5], ["solicitacao", 2], ["pedido", 1.5],
    ["ideia", 2], ["sugestao", 2], ["vale a pena", 3], ["ja existe", 2.5], ["sera que", 1.5], ["reclamacao", 3], ["reclam", 2], ["ticket", 2], ["customer", 2],
    ["would be nice", 3], ["it would be great", 3], ["users want", 2], ["usuarios querem", 2], ["suporte", 1],
  ],
  projeto: [
    ["do zero", 3], ["sistema inteiro", 3.5], ["sistema completo", 3.5], ["projeto inteiro", 3.5], ["novo projeto", 3], ["app completo", 3], ["plataforma", 2],
    ["from scratch", 3], ["whole system", 3], ["full app", 2.5], ["saas", 2], ["mvp", 2], ["um sistema", 2], ["uma plataforma", 2.5], ["sistema para", 1.5],
    ["build me a", 2.5], ["aplicativo", 1.5], ["construir um", 1.5], ["monta um", 1.5], ["monte um", 1.5],
  ],
  refatoracao: [
    ["refator", 4], ["refactor", 4], ["limpar o codigo", 3], ["limpar codigo", 3], ["clean up", 3], ["cleanup", 3], ["reorganiz", 2.5], ["reestrutur", 3], ["restructur", 3],
    ["renomear", 2], ["rename", 2], ["extrair", 1.5], ["extract", 1.5], ["simplific", 2], ["divida tecnica", 3], ["tech debt", 3], ["duplicad", 2], ["legibilidade", 3],
    ["modulariz", 3], ["melhorar o codigo", 3], ["sem mudar o comportamento", 3], ["legado", 1], ["migrar para", 2],
  ],
  entrega: [
    ["pull request", 4], ["abrir pr", 4], ["pr|", 3], ["merge", 3], ["entrega", 3], ["subir", 1.5], ["push", 2], ["commit", 2.5],
    ["versionar", 2.5], ["release", 2.5], ["publicar", 2], ["deploy", 2.5], ["revisar o pr", 3], ["passar para o qa", 3], ["branch", 1.5], ["ship", 2], ["deliver", 2],
  ],
  duvida: [
    ["?", 1.5], ["o que e", 2.5], ["o que significa", 3], ["qual a diferenca", 3], ["por que", 2], ["porque", 0.5], ["como funciona", 3], ["explique", 2.5], ["explica", 2.5],
    ["what is", 2.5], ["how does", 3], ["how do", 2], ["why", 2], ["pode me explicar", 3], ["duvida", 3], ["onde fica", 2], ["onde esta", 2], ["entender", 1.5],
    ["qual e", 1.5], ["me ajuda a entender", 3], ["como|", 0.75],
  ],
  consulta_historico: [
    ["ja fizemos", 4], ["ja foi feito", 4], ["ja fiz|", 3], ["historico", 3], ["o que mudou", 3], ["quando foi", 3], ["quem mudou", 3], ["ultimas mudancas", 3],
    ["semana passada", 2], ["ontem", 1.5], ["decidimos", 3], ["decidiu", 2], ["last time", 3], ["history", 2.5], ["what changed", 3], ["did we", 3], ["have we", 3],
    ["ultima vez", 3], ["lembra", 2], ["git log", 3], ["changelog", 2], ["o que fizemos", 4], ["o que foi feito", 3], ["sessao anterior", 3], ["previous session", 3], ["memoria", 1.5],
  ],
};

const termosPadrao = (id: string): TermoRegra[] => (PESOS_INTENCAO[id] ?? []).map(([termo, peso]) => ({ termo, peso }));

function opcoesRegra(opcoes: readonly OpcaoIntencao[]): OpcaoRegra[] {
  return opcoes.map((o) => {
    const doPadrao = termosPadrao(o.id);
    const termos = [...doPadrao, ...termosDe({ id: o.id, ...(o.palavras === undefined ? {} : { palavras: o.palavras }), ...(doPadrao.length === 0 ? { description: o.descricao } : {}) })];
    return { id: o.id, termos };
  });
}

const PADRAO_COMPILADO = opcoesRegra(OPCOES_INTENCAO_PADRAO);

function pistasDoEstado(ctx: ContextoIntencao, ids: Set<string>): Array<{ id: string; score: number }> {
  const t = ctx.trabalho_ativo;
  if (t === null || t === undefined) return [];
  const tipo = normalizar(t.tipo);
  const estagio = normalizar(t.estagio);
  const pistas: Array<{ id: string; score: number }> = [];
  const dar = (id: string): void => {
    if (ids.has(id)) pistas.push({ id, score: 0.5 });
  };
  if (/ocorr|bug|runx/.test(tipo)) dar("bug");
  if (/feature|sprint/.test(tipo)) dar("feature");
  if (/projeto|build/.test(tipo)) dar("projeto");
  if (/entrega|pr|merge/.test(estagio)) dar("entrega");
  return pistas;
}

/** Só regras (síncrono, ≤ 5 ms): `{escolhida, confianca, probs}`; `escolhida ∈ opcoes` sempre. */
export function classificarPorRegras(texto: string, contexto: ContextoIntencao): ResultadoRegra {
  const opcoes = contexto.opcoes !== undefined && contexto.opcoes.length > 0 ? contexto.opcoes : OPCOES_INTENCAO_PADRAO;
  const compiladas = opcoes === OPCOES_INTENCAO_PADRAO ? PADRAO_COMPILADO : opcoesRegra(opcoes);
  const n = ` ${normalizar(String(texto).slice(0, TEXTO_MAX))}`.trim();
  const scores = pontuar(n, compiladas);
  const ids = new Set(opcoes.map((o) => o.id));
  for (const pista of pistasDoEstado(contexto, ids)) {
    const s = scores.find((x) => x.id === pista.id);
    if (s !== undefined) s.score += pista.score;
  }
  return escolherPorScores(scores, "pedido_cru");
}

export interface DepsIntencao {
  /** `null`/ausente = decisor desligado (nada é instanciado nem chamado). */
  decisor?: Decisor | null;
  /** ex.: `cofre.scrubSincrono`. */
  scrub?: (t: string) => string;
}

function alternativas(probs: Record<string, number>): ResultadoIntencao["alternativas"] {
  return Object.entries(probs)
    .map(([id, p]) => ({ id, p: Math.round(p * 1000) / 1000 }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 3);
}

export async function classificarIntencao(texto: string, contexto: ContextoIntencao, deps: DepsIntencao = {}): Promise<ResultadoIntencao> {
  const opcoes = contexto?.opcoes !== undefined && contexto.opcoes.length > 0 ? contexto.opcoes : OPCOES_INTENCAO_PADRAO;
  const ctx: ContextoIntencao = { ...(contexto ?? { workspace_id: "" }), opcoes: [...opcoes] };
  let regra: ResultadoRegra;
  try {
    regra = classificarPorRegras(typeof texto === "string" ? texto : "", ctx);
  } catch {
    const primeira = (opcoes[0] as OpcaoIntencao).id;
    return { intencao: primeira, confianca: 0, fonte: "regra", decisao_id: null, alternativas: [] };
  }
  const saidaRegra: ResultadoIntencao = { intencao: regra.escolhida, confianca: regra.confianca, fonte: "regra", decisao_id: null, alternativas: alternativas(regra.probs) };
  if (deps.decisor === undefined || deps.decisor === null) return saidaRegra;
  try {
    const r = await deps.decisor.decidir({
      proposito: "intencao",
      usar_para: "intencao",
      kind: "intencao",
      texto: String(texto).slice(0, TEXTO_MAX),
      opcoes: opcoes.map((o) => ({ id: o.id, description: o.descricao })),
      regra,
      workspace_id: ctx.workspace_id === "" ? null : ctx.workspace_id,
      ...(deps.scrub === undefined ? {} : { scrub: deps.scrub }),
    });
    // defesa final: o rótulo SEMPRE pertence às opções (opção inventada já foi descartada pelo esquema).
    if (!opcoes.some((o) => o.id === r.escolhida)) return { ...saidaRegra, fonte: "fallback" };
    return { intencao: r.escolhida, confianca: r.confianca, fonte: r.fonte, decisao_id: r.decisao_id, alternativas: alternativas(r.probs) };
  } catch {
    return { ...saidaRegra, fonte: "fallback" };
  }
}
