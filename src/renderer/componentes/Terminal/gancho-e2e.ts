// Gancho de TESTE: com `window.__ade_e2e === true` (injetado pelo main só quando o app abre com a
// variável E2E do produto) o painel expõe o buffer do xterm em `window.__ade_terminais[sessaoId]`.
// Sem a marca nada é criado (nem o objeto global), então produção não muda.

export interface LeitorDeBuffer {
  /** texto de todas as linhas do buffer ativo (sem espaços à direita). */
  texto(): string;
  colunas(): number;
  linhas(): number;
  /** texto selecionado no xterm (a busca seleciona o achado). */
  selecao(): string;
  /** chama `cb` depois que o xterm processa cada lote de escrita (mede eco sem depender de quadro). */
  aoProcessar(cb: () => void): () => void;
  /** linha do topo visível. */
  topo(): number;
  /** as últimas `n` linhas do buffer (barato: não percorre o scrollback). */
  fim(n: number): string;
}

interface XtermLeitura {
  cols: number;
  rows: number;
  getSelection(): string;
  onWriteParsed(cb: () => void): { dispose(): void };
  buffer: { active: { viewportY: number; length: number; getLine(i: number): { translateToString(aparar?: boolean): string } | undefined } };
}

type Janela = { __ade_e2e?: unknown; __ade_terminais?: Record<string, LeitorDeBuffer> };

export function registrarLeitorDeBuffer(sessaoId: string, xterm: XtermLeitura, janela: Janela = globalThis as unknown as Janela): () => void {
  if (janela.__ade_e2e !== true) return () => undefined;
  const leitor: LeitorDeBuffer = {
    texto: () => {
      const b = xterm.buffer.active;
      const linhas: string[] = [];
      for (let i = 0; i < b.length; i += 1) linhas.push(b.getLine(i)?.translateToString(true) ?? "");
      return linhas.join("\n");
    },
    colunas: () => xterm.cols,
    linhas: () => xterm.rows,
    selecao: () => xterm.getSelection(),
    aoProcessar: (cb) => { const d = xterm.onWriteParsed(cb); return () => d.dispose(); },
    topo: () => xterm.buffer.active.viewportY,
    fim: (n) => {
      const b = xterm.buffer.active;
      const linhas: string[] = [];
      for (let i = Math.max(0, b.length - n); i < b.length; i += 1) linhas.push(b.getLine(i)?.translateToString(true) ?? "");
      return linhas.join("\n");
    },
  };
  const mapa = (janela.__ade_terminais ??= {});
  mapa[sessaoId] = leitor;
  return () => { if (mapa[sessaoId] === leitor) delete mapa[sessaoId]; };
}
