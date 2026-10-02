// Intenção do chat: por REGRAS (o classificador do harness, Fase 9), substituível pela porta do Maestro (Fase 16). Só devolve
// RÓTULOS de uma lista fechada: texto do usuário nunca vira ação. Também detecta ações exclusivas do humano (D-21).
import { classificarPorRegras } from "../../harness/intencao";

export type IntencaoChat = "bug" | "feature" | "pedido_cru" | "projeto" | "refatoracao" | "entrega" | "duvida" | "consulta_historico";

export interface ResultadoIntencaoChat {
  intencao: IntencaoChat;
  confianca: number;
}

export type PortaIntencao = (texto: string) => Promise<ResultadoIntencaoChat> | ResultadoIntencaoChat;

const VALIDAS = new Set<string>(["bug", "feature", "pedido_cru", "projeto", "refatoracao", "entrega", "duvida", "consulta_historico"]);

/** Padrão: regras do harness. Nunca lança; fora da lista cai em `pedido_cru`. */
export const intencaoPorRegras: PortaIntencao = (texto) => {
  try {
    const r = classificarPorRegras(texto, { workspace_id: "" });
    return { intencao: (VALIDAS.has(r.escolhida) ? r.escolhida : "pedido_cru") as IntencaoChat, confianca: r.confianca };
  } catch {
    return { intencao: "pedido_cru", confianca: 0 };
  }
};

const PERGUNTA = /^\s*(?:o que|qual|quais|quem|quando|onde|por ?que|porque|como (?:funciona|est[aá]|foi|era)|j[aá] (?:foi|fizemos|existe|temos)|existe|tem como|what|why|how does|did we)\b|\?\s*$/i;
const IMPERATIVO = /\b(?:preciso|quero|implementa\w*|cri[ae]\w*|adicion\w*|fa[cç]a\w*|corrij\w*|consert\w*|resolv\w*|refator\w*|construa|monte|gere|abra|add|implement|create|fix|build)\b/i;

/** Pergunta sobre o sistema/histórico (vai ao RAG) ou pedido de ação (vai ao orquestrador)? Só sugere; o modo da conversa manda. */
export function pareceAcao(texto: string): boolean {
  return IMPERATIVO.test(texto) && !/^\s*(?:o que|qual|quais|quem|por ?que|porque)\b/i.test(texto);
}
export const pareceDuvida = (texto: string): boolean => PERGUNTA.test(texto) && !IMPERATIVO.test(texto);

export interface AcaoHumana {
  codigo: "assinar_prodx" | "aprovar_raio_alto" | "mergex_revisar" | "merge" | "push";
  descricao: string;
}

const PROIBIDAS: Array<[RegExp, AcaoHumana]> = [
  [/\bassin\w*\b.{0,30}\bprodx\b|\bprodx\b.{0,30}\bassin\w*/i, { codigo: "assinar_prodx", descricao: "A assinatura do prodx é sempre humana." }],
  [/\baprov\w*\b.{0,40}\braio\s+alto\b|\braio\s+alto\b.{0,40}\baprov\w*/i, { codigo: "aprovar_raio_alto", descricao: "A aprovação de raio ALTO é sempre humana." }],
  [/\bmergex[-\s]?revisar\b/i, { codigo: "mergex_revisar", descricao: "O mergex-revisar é sempre humano." }],
  [/\b(?:fa(?:z|[cç]\w*)|d[eê]|dar|fazer|execut\w*|rod\w*)\s+(?:o\s+|um\s+)?merge\b|\bmerge(?:ar|ia)\b|\bmergear?\b/i, { codigo: "merge", descricao: "O merge é sempre humano." }],
  [/\bgit\s+push\b|\bpush\s+(?:--force|-f)\b|\bfor[cç]a\w*\s+(?:o\s+)?push\b/i, { codigo: "push", descricao: "Push e force push nunca partem da automação." }],
];

export function acoesExclusivasDoHumano(texto: string): AcaoHumana[] {
  return PROIBIDAS.filter(([re]) => re.test(texto)).map(([, a]) => a);
}
