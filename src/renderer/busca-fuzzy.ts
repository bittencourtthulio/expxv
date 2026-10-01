// Busca fuzzy local, sem dependência. Ranking (maior = melhor, faixas disjuntas):
//   igual (1000) > prefixo (800) > prefixo de palavra (600..) > trecho contido (300..) > subsequência (1..100).
// Acentos e caixa são ignorados. Consulta com várias palavras: todas precisam casar (soma das notas).
// Empate mantém a ordem original (estável). Pensada para ~5 000 itens em poucos ms: o texto é
// normalizado uma vez em `criarIndice`.

const MARCAS = /[̀-ͯ]/g;

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(MARCAS, "").toLowerCase();
}

function pontuarPalavra(texto: string, p: string): number {
  if (texto === p) return 1000;
  if (texto.startsWith(p)) return 800 - Math.min(texto.length - p.length, 100) / 10;
  // prefixo de palavra
  let i = texto.indexOf(p);
  while (i > 0) {
    const ant = texto.charCodeAt(i - 1);
    if (ant === 32 || ant === 45 || ant === 95 || ant === 47 || ant === 46 || ant === 35 || ant === 183) return 600 - Math.min(i, 100) / 10;
    i = texto.indexOf(p, i + 1);
  }
  const dentro = texto.indexOf(p);
  if (dentro > 0) return 300 - Math.min(dentro, 200) / 4;
  // subsequência
  let ti = 0;
  let inicio = -1;
  let fim = 0;
  let seguidas = 0;
  let melhorSeq = 0;
  for (let pi = 0; pi < p.length; pi++) {
    const c = p.charCodeAt(pi);
    while (ti < texto.length && texto.charCodeAt(ti) !== c) { ti++; seguidas = 0; }
    if (ti >= texto.length) return 0;
    if (inicio < 0) inicio = ti;
    seguidas++;
    if (seguidas > melhorSeq) melhorSeq = seguidas;
    fim = ++ti;
  }
  const dispersao = fim - inicio - p.length;
  return Math.max(1, 60 + melhorSeq * 4 - Math.min(dispersao, 55) - Math.min(inicio, 10) / 2);
}

/** Nota de um texto JÁ normalizado para uma consulta JÁ normalizada. 0 = não casa. */
export function pontuar(texto: string, consulta: string): number {
  const palavras = consulta.split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return 1;
  let total = 0;
  for (const p of palavras) {
    const n = pontuarPalavra(texto, p);
    if (n === 0) return 0;
    total += n;
  }
  return total / palavras.length;
}

export interface IndiceFuzzy<T> {
  buscar(consulta: string, limite?: number): T[];
}

export function criarIndice<T>(itens: readonly T[], texto: (item: T) => string): IndiceFuzzy<T> {
  const normais = itens.map((it) => normalizar(texto(it)));
  return {
    buscar(consulta, limite = 50) {
      const q = normalizar(consulta).trim();
      if (q === "") return itens.slice(0, limite);
      const acertos: Array<{ i: number; n: number }> = [];
      for (let i = 0; i < normais.length; i++) {
        const n = pontuar(normais[i] as string, q);
        if (n > 0) acertos.push({ i, n });
      }
      acertos.sort((a, b) => b.n - a.n || a.i - b.i);
      return acertos.slice(0, limite).map((a) => itens[a.i] as T);
    },
  };
}

export function buscarFuzzy<T>(itens: readonly T[], consulta: string, texto: (item: T) => string, limite = 50): T[] {
  return criarIndice(itens, texto).buscar(consulta, limite);
}
