import { PRODUTO } from "../../../nucleo/produto";

export type Visao = "colunas" | "linha";
export const VISOES: readonly { id: Visao; rotulo: string }[] = [
  { id: "colunas", rotulo: "Cartões em colunas" },
  { id: "linha", rotulo: "Linha do tempo" },
];
export const CHAVE_VISAO = `${PRODUTO.id}.trabalhos.visao`;

/** Preferência de visão por pessoa (localStorage, sem contrato): qualquer falha de leitura ou gravação cai no padrão. */
export function lerVisao(): Visao {
  try {
    const v = globalThis.localStorage?.getItem(CHAVE_VISAO);
    return v === "linha" || v === "colunas" ? v : "colunas";
  } catch { return "colunas"; }
}
export function gravarVisao(v: Visao): void {
  try { globalThis.localStorage?.setItem(CHAVE_VISAO, v); } catch { /* sem armazenamento: vale só nesta abertura */ }
}
