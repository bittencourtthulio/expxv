// Diff de linhas para o lado a lado da atualização de fábrica. PURO. LCS clássico (O(n·m)) até um limite; acima dele cai para a
// comparação posicional (linha a linha), que é sempre barata e continua alinhada. Nenhuma cor é a única indicação: cada linha
// tem `tipo` e a UI escreve o marcador (− / +).
export type TipoLinhaDiff = "igual" | "removida" | "adicionada" | "vazia";
export interface LinhaDiff {
  tipo: TipoLinhaDiff;
  texto: string;
}
export interface ResultadoDiff {
  esquerda: LinhaDiff[];
  direita: LinhaDiff[];
  /** linhas que diferem (soma dos dois lados). */
  diferentes: number;
}
const LIMITE_CELULAS = 4_000_000;

const linhasDe = (t: string): string[] => (t === "" ? [] : t.replace(/\r\n/g, "\n").split("\n"));

export function diffDeLinhas(esq: string, dir: string): ResultadoDiff {
  const a = linhasDe(esq);
  const b = linhasDe(dir);
  const esquerda: LinhaDiff[] = [];
  const direita: LinhaDiff[] = [];
  const par = (l: LinhaDiff | null, r: LinhaDiff | null): void => {
    esquerda.push(l ?? { tipo: "vazia", texto: "" });
    direita.push(r ?? { tipo: "vazia", texto: "" });
  };
  if (a.length * b.length > LIMITE_CELULAS) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a[i];
      const y = b[i];
      if (x !== undefined && y !== undefined && x === y) par({ tipo: "igual", texto: x }, { tipo: "igual", texto: y });
      else par(x === undefined ? null : { tipo: "removida", texto: x }, y === undefined ? null : { tipo: "adicionada", texto: y });
    }
  } else {
    const n = a.length;
    const m = b.length;
    // tabela do maior prefixo comum a partir do fim (linhas de 32 bits cabem folgado)
    const t: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        par({ tipo: "igual", texto: a[i]! }, { tipo: "igual", texto: b[j]! });
        i++;
        j++;
      } else if (j >= m || (i < n && t[i + 1]![j]! >= t[i]![j + 1]!)) {
        par({ tipo: "removida", texto: a[i]! }, null);
        i++;
      } else {
        par(null, { tipo: "adicionada", texto: b[j]! });
        j++;
      }
    }
    // alinha "removida + vazia" seguida de "vazia + adicionada" como um par substituído (mesma linha dos dois lados)
    for (let k = 0; k + 1 < esquerda.length; k++) {
      if (esquerda[k]!.tipo === "removida" && direita[k]!.tipo === "vazia" && esquerda[k + 1]!.tipo === "vazia" && direita[k + 1]!.tipo === "adicionada") {
        direita[k] = direita[k + 1]!;
        esquerda.splice(k + 1, 1);
        direita.splice(k + 1, 1);
      }
    }
  }
  const diferentes = [...esquerda, ...direita].filter((l) => l.tipo === "removida" || l.tipo === "adicionada").length;
  return { esquerda, direita, diferentes };
}
