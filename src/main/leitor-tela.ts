// Leitor de tela dos Panes orquestrados: um terminal virtual (@xterm/headless) por sessão, alimentado
// pelos eventos de saída, para `pane_read` devolver o que está NA TELA (não o fluxo bruto com escapes).
// O módulo do xterm só carrega no primeiro Pane orquestrado (nada disto existe na onda 1 do boot) e cada
// terminal guarda no máximo `scrollback` linhas. Sem I/O: só memória.

interface TerminalVirtual {
  write(dados: string, cb?: () => void): void;
  resize(colunas: number, linhas: number): void;
  dispose(): void;
  readonly buffer: {
    readonly active: {
      readonly length: number;
      getLine(i: number): { readonly isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
    };
  };
}
type ConstrutorTerminal = new (opcoes: { cols: number; rows: number; scrollback: number; allowProposedApi: boolean }) => TerminalVirtual;

export interface OpcoesLeitorDeTela {
  colunas?: number;
  linhas?: number;
  scrollback?: number;
  /** Carrega o construtor do terminal virtual (padrão: import dinâmico do @xterm/headless). */
  carregar?: () => Promise<ConstrutorTerminal>;
}

export interface LeitorDeTela {
  /** Começa a acompanhar a sessão (idempotente). Só o que chegar depois entra na tela. */
  registrar(sessaoId: string): void;
  tem(sessaoId: string): boolean;
  /** Síncrono e barato; saída de sessão não registrada é ignorada. */
  alimentar(sessaoId: string, dados: string): void;
  redimensionar(sessaoId: string, colunas: number, linhas: number): void;
  /** Últimas `n` linhas LÓGICAS da tela (quebras automáticas de linha são juntadas; vazias do fim saem). */
  ler(sessaoId: string, n: number): Promise<string[] | null>;
  liberar(sessaoId: string): void;
  fechar(): void;
}

interface Entrada {
  terminal: TerminalVirtual | null;
  pendente: string[];
  pronta: Promise<void>;
  liberada: boolean;
}

const carregarPadrao = async (): Promise<ConstrutorTerminal> => (await import("@xterm/headless")).Terminal as unknown as ConstrutorTerminal;

export function criarLeitorDeTela(opcoes: OpcoesLeitorDeTela = {}): LeitorDeTela {
  const colunas = opcoes.colunas ?? 120;
  const linhas = opcoes.linhas ?? 32;
  const scrollback = opcoes.scrollback ?? 5_000;
  const carregar = opcoes.carregar ?? carregarPadrao;
  const entradas = new Map<string, Entrada>();
  let construtor: Promise<ConstrutorTerminal> | null = null;

  function registrar(sessaoId: string): void {
    if (entradas.has(sessaoId)) return;
    const entrada: Entrada = { terminal: null, pendente: [], pronta: Promise.resolve(), liberada: false };
    construtor ??= carregar();
    entrada.pronta = construtor.then((Terminal) => {
      if (entrada.liberada) return;
      const t = new Terminal({ cols: colunas, rows: linhas, scrollback, allowProposedApi: true });
      entrada.terminal = t;
      for (const dados of entrada.pendente.splice(0)) t.write(dados);
    });
    entrada.pronta.catch(() => undefined);
    entradas.set(sessaoId, entrada);
  }

  return {
    registrar,
    tem: (id) => entradas.has(id),
    alimentar(id, dados) {
      const e = entradas.get(id);
      if (e === undefined) return;
      if (e.terminal === null) e.pendente.push(dados);
      else e.terminal.write(dados);
    },
    redimensionar(id, c, l) {
      try { entradas.get(id)?.terminal?.resize(c, l); } catch { /* tamanho fora do aceito: mantém o atual */ }
    },
    async ler(id, n) {
      const e = entradas.get(id);
      if (e === undefined) return null;
      await e.pronta.catch(() => undefined);
      const t = e.terminal;
      if (t === null) return [];
      await new Promise<void>((resolver) => t.write("", resolver)); // escoa o que ainda está na fila do parser
      const b = t.buffer.active;
      const logicas: string[] = [];
      for (let i = 0; i < b.length; i++) {
        const linha = b.getLine(i);
        if (linha === undefined) continue;
        const texto = linha.translateToString(b.getLine(i + 1)?.isWrapped !== true);
        if (linha.isWrapped && logicas.length > 0) logicas[logicas.length - 1] += texto;
        else logicas.push(texto);
      }
      while (logicas.length > 0 && logicas[logicas.length - 1]?.trim() === "") logicas.pop();
      return logicas.slice(-Math.max(1, n));
    },
    liberar(id) {
      const e = entradas.get(id);
      if (e === undefined) return;
      e.liberada = true;
      entradas.delete(id);
      try { e.terminal?.dispose(); } catch { /* já liberado */ }
    },
    fechar() {
      for (const id of [...entradas.keys()]) this.liberar(id);
    },
  };
}
