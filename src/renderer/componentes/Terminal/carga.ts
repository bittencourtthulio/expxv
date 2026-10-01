/**
 * Carga sob demanda do terminal (P-08): o `@xterm` só entra pelo import dinâmico daqui, então
 * nunca fica no JS inicial. A promessa é memoizada (ociosidade, foco e primeira visita
 * compartilham um único import). O carregador é trocável só para teste.
 */
export type ModuloTerminal = typeof import("./Terminal");

const carregadorPadrao = (): Promise<ModuloTerminal> => import("./Terminal");

let carregador: () => Promise<ModuloTerminal> = carregadorPadrao;
let promessa: Promise<ModuloTerminal> | null = null;
let carregado: ModuloTerminal | null = null;

/** O módulo, se o import já terminou (síncrono: permite montar o terminal sem passar pelo Suspense). */
export function moduloDoTerminalCarregado(): ModuloTerminal | null {
  return carregado;
}

/** Dispara (uma vez) e devolve o import do terminal. Falha libera nova tentativa. */
export function precarregarTerminal(): Promise<ModuloTerminal> {
  if (promessa === null) {
    const atual: Promise<ModuloTerminal> = carregador().then((m) => {
      if (promessa === atual) carregado = m;
      return m;
    }, (erro: unknown) => {
      if (promessa === atual) promessa = null;
      throw erro;
    });
    promessa = atual;
  }
  return promessa;
}

type Ocioso = (cb: () => void, opcoes?: { timeout: number }) => number;

/**
 * Agenda a carga do chunk do terminal para quando o navegador estiver ocioso, depois da primeira
 * pintura (requestIdleCallback; setTimeout quando não existe). Devolve o cancelamento.
 */
export function agendarCargaOciosa(alvo: { requestIdleCallback?: Ocioso; cancelIdleCallback?: (id: number) => void } = globalThis as never): () => void {
  const iniciar = (): void => { void precarregarTerminal().catch(() => undefined); };
  if (typeof alvo.requestIdleCallback === "function") {
    const id = alvo.requestIdleCallback(iniciar, { timeout: 4000 });
    return () => alvo.cancelIdleCallback?.(id);
  }
  const id = setTimeout(iniciar, 200);
  return () => clearTimeout(id);
}

/** Só para teste: troca o carregador (sem argumento, volta ao import real) e zera a memória. */
export function definirCarregadorDoTerminal(novo?: () => Promise<ModuloTerminal>): void {
  carregador = novo ?? carregadorPadrao;
  promessa = null;
  carregado = null;
}
