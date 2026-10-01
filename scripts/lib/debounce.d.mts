export interface Debounce {
  (): void;
  cancelar(): void;
  pendente(): boolean;
}
export function criarDebounce(
  acao: () => void,
  espera: number,
  relogio?: { setTimer?: (f: () => void, ms: number) => unknown; clearTimer?: (id: never) => void },
): Debounce;
export function mudancaRelevante(arquivo: string | null | undefined): boolean;
