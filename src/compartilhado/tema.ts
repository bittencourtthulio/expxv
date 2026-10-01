// Cores que o main precisa conhecer (fundo da janela antes do renderer pintar → sem flash).
// `tokens.css` deve definir `--fundo` com EXATAMENTE estes valores; um teste de contrato confere
// (casca/tema.test.ts no renderer + janela.test.ts no main).
import type { TemaEfetivo } from "./ipc";

export const COR_FUNDO_JANELA: Record<TemaEfetivo, string> = {
  escuro: "#16181a",
  claro: "#f5f6f4",
};

export function corFundoJanela(tema: TemaEfetivo): string {
  return COR_FUNDO_JANELA[tema];
}
