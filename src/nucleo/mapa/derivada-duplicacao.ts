import { acharClones, prepararDuplicacao } from "./analises/duplicacao";
import type { ArquivoMapa } from "./analises/tipos";

// Duplicação grosseira (T-17.27) sobre os arquivos de código: desligada por padrão (`mapa.duplicacao`). Lê o texto pelo leitor
// confinado, tokeniza (identificadores e literais abstraídos) e devolve as maiores classes de clones. Nunca guarda o texto.

const MAX_ARQUIVOS = 20_000;

export function analisarPatrimonioDuplicacao(arquivos: readonly ArquivoMapa[], ler: (caminho: string) => string | null, limite: number): Array<{ tokens: number; trechos: Array<{ caminho: string; linha_ini: number; linha_fim: number }> }> {
  const prep = [];
  for (const a of arquivos.slice(0, MAX_ARQUIVOS)) {
    if (a.extracao.e_teste || a.extracao.e_gerado) continue;
    const texto = ler(a.caminho);
    if (texto === null) continue;
    prep.push(prepararDuplicacao(a.caminho, texto, a.extracao.linguagem));
  }
  const r = acharClones(prep);
  const maiorPar = new Map<string, number>();
  for (const p of r.pares) {
    maiorPar.set(`${p.a.caminho}:${p.a.linha_ini}`, p.tokens);
    maiorPar.set(`${p.b.caminho}:${p.b.linha_ini}`, p.tokens);
  }
  return r.classes
    .map((trechos) => ({ tokens: Math.max(0, ...trechos.map((t) => maiorPar.get(`${t.caminho}:${t.linha_ini}`) ?? 0)), trechos: trechos.slice(0, 10).map((t) => ({ caminho: t.caminho, linha_ini: t.linha_ini, linha_fim: t.linha_fim })) }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limite);
}
