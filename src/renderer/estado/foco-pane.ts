// Pane (sessão de terminal) em foco, para destinos de anexo (captura, voz). Quem controla o foco (tela Terminais) publica aqui; quem precisa só lê.
let atual: string | null = null;
const ouvintes = new Set<() => void>();

export function definirPaneEmFoco(id: string | null): void {
  if (atual === id) return;
  atual = id;
  ouvintes.forEach((o) => o());
}
export const paneEmFoco = (): string | null => atual;
export function assinarPaneEmFoco(cb: () => void): () => void {
  ouvintes.add(cb);
  return () => void ouvintes.delete(cb);
}
