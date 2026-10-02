// Curva de crescimento do Bichinho (D-463): maturidade 0–100 = 60% tokens + 40% base de conhecimento, ambos em ESCALA LOGARÍTMICA
// (os primeiros mil contam tanto quanto os últimos milhões). Só contadores entram aqui: tokens in+out acumulados no workspace (custo, Fase 10)
// e itens de conhecimento (entradas de memória ativas + chunks indexados do RAG). A maturidade NUNCA regride: guarda-se o máximo atingido.
import type { ComponentesMaturidade, EstagioId, OvoVisao } from "../../compartilhado/bichinho";

export const ESCALA = {
  /** 0 ponto em 0 tokens; 100 pontos em `tokensCheio`. A curva é log10(1 + t/base) / log10(1 + cheio/base). */
  tokensBase: 10_000,
  tokensCheio: 1_000_000_000,
  conhecimentoBase: 10,
  conhecimentoCheio: 100_000,
  pesoTokens: 0.6,
  pesoConhecimento: 0.4,
} as const;

/**
 * O OVO (D-671): só nasce com ATIVIDADE REAL acumulada. Meta de tarefas concluídas (configurável de 2 a 6; o dono pediu "duas a cinco, mais ou menos") E um piso
 * de tokens bem maior que o do primeiro trabalho. A maturidade (curva acima) continua a mesma; só o PORTÃO do ovo é novo.
 */
export const OVO = { metaTarefas: 4, metaMin: 2, metaMax: 6, pisoTokens: 150_000 } as const;

/** Meta de tarefas válida (inteiro de 2 a 6); qualquer outra coisa cai no padrão. */
export function limitarMetaOvo(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) ? Math.min(OVO.metaMax, Math.max(OVO.metaMin, Math.round(valor))) : OVO.metaTarefas;
}

/** Progresso de choque 0–100 (inteiro) = min(tarefas/meta, tokens/piso). Nunca passa de 100 e nunca é negativo; a 100 o ovo choca. */
export function progressoOvo(p: { tarefas: number; tokens: number; meta?: number; piso?: number }): OvoVisao {
  const meta = limitarMetaOvo(p.meta);
  const piso = p.piso !== undefined && p.piso > 0 ? p.piso : OVO.pisoTokens;
  const tarefas = Math.max(0, Math.floor(Number.isFinite(p.tarefas) ? p.tarefas : 0));
  const tokens = Math.max(0, Math.floor(Number.isFinite(p.tokens) ? p.tokens : 0));
  const f = Math.min(1, tarefas / meta, tokens / piso);
  // 99 enquanto faltar qualquer um dos dois critérios: arredondar para 100 antes da hora faria o ovo nascer incompleto
  const completo = tarefas >= meta && tokens >= piso;
  return { tarefas, meta_tarefas: meta, tokens, piso_tokens: piso, progresso: completo ? 100 : Math.min(99, Math.floor(f * 100)) };
}

/** Nível visual do ovo (0 liso, 1 rachadura pequena, 2 rachaduras e um olho, 3 quase abrindo) pelo progresso de choque. */
export function nivelVisualOvo(progresso: number): 0 | 1 | 2 | 3 {
  return progresso >= 75 ? 3 : progresso >= 50 ? 2 : progresso >= 25 ? 1 : 0;
}

/** Limiar mínimo (inclusive) de maturidade de cada estágio. */
export const LIMIARES: ReadonlyArray<readonly [EstagioId, number]> = [
  ["ovo", 0], ["filhote", 3], ["jovem", 20], ["adulto", 45], ["veterano", 70], ["lendario", 90],
];

const REAL = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function pontuacaoLog(valor: number, base: number, cheio: number): number {
  const v = REAL(valor);
  if (v === 0) return 0;
  return Math.min(100, (100 * Math.log10(1 + v / base)) / Math.log10(1 + cheio / base));
}

export function componentes(tokens: number, conhecimentoItens: number): ComponentesMaturidade {
  return {
    tokens: Math.round(pontuacaoLog(tokens, ESCALA.tokensBase, ESCALA.tokensCheio)),
    conhecimento: Math.round(pontuacaoLog(conhecimentoItens, ESCALA.conhecimentoBase, ESCALA.conhecimentoCheio)),
  };
}

export function estagioDe(maturidade: number): EstagioId {
  let atual: EstagioId = "ovo";
  for (const [id, minimo] of LIMIARES) if (maturidade >= minimo) atual = id;
  return atual;
}

export interface ResultadoMaturidade {
  componentes: ComponentesMaturidade;
  /** maturidade calculada agora (pode ser menor que a guardada se o conhecimento encolheu). */
  bruta: number;
  /** o que vale: `max(guardada, bruta)`, inteiro 0–100. */
  maturidade: number;
  estagio: EstagioId;
  /** o estágio subiu em relação ao que estava guardado. */
  subiu: boolean;
}

/**
 * `chocou` (D-671): `false` segura o estágio em "ovo" (a maturidade segue contando); `true` garante pelo menos "filhote"; ausente = regra antiga (só pela maturidade).
 * Quem já passou do ovo (estágio guardado diferente de "ovo") é tratado como chocado: o estágio nunca volta a ser ovo.
 */
export function calcularMaturidade(p: { tokens: number; conhecimentoItens: number; maximoGuardado: number; estagioGuardado?: EstagioId | undefined; chocou?: boolean | undefined }): ResultadoMaturidade {
  const c = componentes(p.tokens, p.conhecimentoItens);
  const exata = ESCALA.pesoTokens * pontuacaoLog(p.tokens, ESCALA.tokensBase, ESCALA.tokensCheio) + ESCALA.pesoConhecimento * pontuacaoLog(p.conhecimentoItens, ESCALA.conhecimentoBase, ESCALA.conhecimentoCheio);
  const bruta = Math.min(100, Math.round(exata));
  const maturidade = Math.max(Math.min(100, Math.max(0, Math.round(REAL(p.maximoGuardado)))), bruta);
  const porMaturidade = estagioDe(maturidade);
  const chocadoAntes = p.estagioGuardado !== undefined && p.estagioGuardado !== "ovo";
  const estagio: EstagioId = p.chocou === undefined ? porMaturidade : p.chocou || chocadoAntes ? (porMaturidade === "ovo" ? "filhote" : porMaturidade) : "ovo";
  const anterior = p.estagioGuardado ?? estagioDe(Math.round(REAL(p.maximoGuardado)));
  return { componentes: c, bruta, maturidade, estagio, subiu: rankEstagio(estagio) > rankEstagio(anterior) };
}

export const rankEstagio = (e: EstagioId): number => LIMIARES.findIndex(([id]) => id === e);

/** Quantos pontos faltam para o próximo estágio (null no último). */
export function faltaParaProximo(maturidade: number): { proximo: EstagioId; faltam: number } | null {
  const i = rankEstagio(estagioDe(maturidade));
  const prox = LIMIARES[i + 1];
  return prox === undefined ? null : { proximo: prox[0], faltam: Math.max(0, prox[1] - maturidade) };
}
