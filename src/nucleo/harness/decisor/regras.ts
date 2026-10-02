// Regras determinísticas (fallback do decisor, P-16): só pontuam e escolhem entre opções FECHADAS. PURAS: sem I/O, sem relógio, sem aleatoriedade.
// Também são o motor de pesos de `intencao.ts`.

export interface TermoRegra {
  /** radical normalizado (minúsculas, sem acento); casa no INÍCIO de palavra (`corrig` casa `corrigir`); com `|` no fim, palavra exata (`pr|`). */
  termo: string;
  peso: number;
}
export interface OpcaoRegra {
  id: string;
  termos: TermoRegra[];
}
export interface OpcaoDescrita {
  id: string;
  description?: string;
  palavras?: string[];
}
export interface ResultadoRegra {
  escolhida: string;
  /** 0..1: score normalizado (ou 1/n sem nenhum sinal). */
  confianca: number;
  probs: Record<string, number>;
  /** pelo menos um termo casou. */
  com_sinal: boolean;
}

const EPS = 0.25;

/** minúsculas, sem acento, só letras/dígitos/`?`/espaço (o `?` carrega sinal de pergunta). */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9?\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const cacheRe = new Map<string, RegExp>();
function reDe(termo: string): RegExp {
  let r = cacheRe.get(termo);
  if (r === undefined) {
    const exato = termo.endsWith("|");
    const base = (exato ? termo.slice(0, -1) : termo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    r = new RegExp(`(?:^|\\s)${base}${exato ? "(?:\\s|$)" : ""}`);
    cacheRe.set(termo, r);
  }
  return r;
}

/** Soma dos pesos dos termos que casam (cada termo conta uma vez). `texto` já normalizado. */
export function pontuar(texto: string, opcoes: OpcaoRegra[]): Array<{ id: string; score: number }> {
  return opcoes.map((o) => {
    let score = 0;
    for (const t of o.termos) {
      if (t.termo === "?" ? texto.includes("?") : reDe(t.termo).test(texto)) score += t.peso;
    }
    return { id: o.id, score };
  });
}

/** `(s + eps) / Σ(s + eps)`: sempre soma 1, determinístico. */
export function probsDeScores(scores: Array<{ id: string; score: number }>): Record<string, number> {
  const soma = scores.reduce((a, s) => a + s.score + EPS, 0);
  const p: Record<string, number> = {};
  for (const s of scores) p[s.id] = (s.score + EPS) / soma;
  return p;
}

/** Escolha: maior score; empate → a PRIMEIRA na ordem das opções. Sem sinal → `preferida` (se for opção) ou a primeira. */
export function escolherPorScores(scores: Array<{ id: string; score: number }>, preferida?: string): ResultadoRegra {
  if (scores.length === 0) throw new Error("sem opções");
  const probs = probsDeScores(scores);
  let melhor = scores[0] as { id: string; score: number };
  for (const s of scores) if (s.score > melhor.score) melhor = s;
  const comSinal = melhor.score > 0;
  if (!comSinal) {
    const id = preferida !== undefined && scores.some((s) => s.id === preferida) ? preferida : (scores[0] as { id: string }).id;
    return { escolhida: id, confianca: Math.round((1 / scores.length) * 1000) / 1000, probs: Object.fromEntries(scores.map((s) => [s.id, 1 / scores.length])), com_sinal: false };
  }
  return { escolhida: melhor.id, confianca: Math.round((probs[melhor.id] as number) * 1000) / 1000, probs, com_sinal: true };
}

const PARADAS = new Set(["para", "como", "esta", "isso", "essa", "esse", "mais", "sobre", "with", "that", "this", "from", "have", "uma", "umas", "uns", "dos", "das", "pelo", "pela"]);

/** Termos de uma opção descrita: `palavras` (peso 2) + palavras da descrição (peso 0.5; ≥ 5 letras, sem paradas). */
export function termosDe(o: OpcaoDescrita): TermoRegra[] {
  const t: TermoRegra[] = [];
  for (const p of o.palavras ?? []) {
    const n = normalizar(p);
    if (n !== "") t.push({ termo: n, peso: 2 });
  }
  const jaTem = new Set(t.map((x) => x.termo));
  for (const w of normalizar(o.description ?? "").split(" ")) {
    if (w.length >= 5 && !PARADAS.has(w) && !jaTem.has(w)) {
      t.push({ termo: w, peso: 0.5 });
      jaTem.add(w);
    }
  }
  return t;
}

/** Decisão genérica por regras (fallback do decisor): palavras-chave e descrição de cada opção contra o texto. */
export function decidirPorRegras(texto: string, opcoes: OpcaoDescrita[]): ResultadoRegra {
  const n = normalizar(texto.slice(0, 2000));
  return escolherPorScores(pontuar(n, opcoes.map((o) => ({ id: o.id, termos: termosDe(o) }))));
}
