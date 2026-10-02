// Decisão de modo (pequeno, carregado junto das telas): 3D só com WebGL2, sem "reduzir movimento" e sem o "modo simples" escolhido.
export interface EntradaModo { webgl2: boolean; reduzirMovimento: boolean; simples: boolean }
export const escolherModo = (e: EntradaModo): "3d" | "2d" => (e.webgl2 && !e.reduzirMovimento && !e.simples ? "3d" : "2d");

let cacheWebgl2: boolean | null = null;
export function webgl2Disponivel(): boolean {
  if (cacheWebgl2 !== null) return cacheWebgl2;
  try {
    const c = document.createElement("canvas");
    cacheWebgl2 = typeof WebGL2RenderingContext !== "undefined" && c.getContext("webgl2") !== null;
  } catch { cacheWebgl2 = false; }
  return cacheWebgl2;
}
/** Teste: força (ou limpa) o resultado do teste de capacidade. */
export const definirWebgl2ParaTeste = (v: boolean | null): void => { cacheWebgl2 = v; };

export function preferirMenosMovimento(): boolean {
  try { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

const CHAVE = "grafo3d.simples";
export function lerSimples(): boolean { try { return localStorage.getItem(CHAVE) === "1"; } catch { return false; } }
export function gravarSimples(v: boolean): void { try { localStorage.setItem(CHAVE, v ? "1" : "0"); } catch { /* sem armazenamento */ } }
