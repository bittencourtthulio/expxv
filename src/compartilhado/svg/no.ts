// Biblioteca SVG própria (Fase 18, T-18.32). Um gráfico é uma ÁRVORE de dados (`NoSvg`); a mesma árvore vira string (relatórios, exportação, teste)
// e React (renderer, em `telas/agil/graficos/React.tsx`) com saída idêntica. Sem dependência, sem DOM, sem cor literal: toda cor/traço vem de CLASSES
// (`ln-N` traço, `fl-N` preenchimento, definidas em tokens.css/agil.css por `--grafico-1..6`), então tema claro/escuro vale sem mexer aqui.
export type ValorAttr = string | number | undefined;
export type Atributos = Readonly<Record<string, ValorAttr>>;
export interface NoSvg { readonly t: string; readonly a?: Atributos; readonly c?: ReadonlyArray<NoSvg | string> }

export const no = (t: string, a?: Atributos, ...c: Array<NoSvg | string | null | false | undefined>): NoSvg => {
  const filhos = c.filter((x): x is NoSvg | string => x !== null && x !== false && x !== undefined);
  return filhos.length > 0 ? (a ? { t, a, c: filhos } : { t, c: filhos }) : (a ? { t, a } : { t });
};

/** arredonda para 2 casas sem notação científica (saída estável entre React e string). */
export const r2 = (v: number): number => Math.round(v * 100) / 100;

const ESC: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const escapar = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] as string);

export function paraString(n: NoSvg | string): string {
  if (typeof n === "string") return escapar(n);
  let attrs = "";
  if (n.a) for (const [k, v] of Object.entries(n.a)) if (v !== undefined) attrs += ` ${k}="${escapar(String(v))}"`;
  const filhos = n.c ? n.c.map(paraString).join("") : "";
  return `<${n.t}${attrs}>${filhos}</${n.t}>`;
}

/** conta nós (elementos) da árvore: orçamento de DOM (≤ 1 500 por gráfico). */
export function contarNos(n: NoSvg | string): number {
  if (typeof n === "string") return 0;
  return 1 + (n.c ? n.c.reduce((s, x) => s + contarNos(x), 0) : 0);
}
