import type { ITheme } from "@xterm/xterm";
import type { TemaEfetivo } from "../../../compartilhado/ipc";

// Única exceção (junto de tokens.css) à regra de "sem cor literal": o xterm pinta em canvas e não lê variáveis CSS.
// O fundo de cada tema acompanha o `--painel` do tema do app.
export const TEMA_XTERM_ESCURO: ITheme = {
  background: "#1c1f21",
  foreground: "#f2f5f3",
  cursor: "#7fb0ff",
  cursorAccent: "#1c1f21",
  selectionBackground: "#1e3a8a",
  selectionForeground: "#ffffff",
  black: "#2b3033",
  brightBlack: "#848c88",
  red: "#ff7b9c",
  brightRed: "#ffa3b9",
  green: "#7fd6a4",
  brightGreen: "#a8e8c2",
  yellow: "#f6c177",
  brightYellow: "#fad9a3",
  blue: "#7aa2f7",
  brightBlue: "#a4c0fa",
  magenta: "#d070b8",
  brightMagenta: "#e39bd0",
  cyan: "#5fd3d6",
  brightCyan: "#8fe3e5",
  white: "#d7ded9",
  brightWhite: "#ffffff",
};

export const TEMA_XTERM_CLARO: ITheme = {
  background: "#ffffff",
  foreground: "#1b1f1d",
  cursor: "#2563eb",
  cursorAccent: "#ffffff",
  selectionBackground: "#bfdbfe",
  selectionForeground: "#1b1f1d",
  black: "#1b1f1d",
  brightBlack: "#5b6661",
  red: "#c2254f",
  brightRed: "#c94167",
  green: "#1d7a48",
  brightGreen: "#258455",
  yellow: "#8a5a00",
  brightYellow: "#9e6900",
  blue: "#2f5fc4",
  brightBlue: "#4471cf",
  magenta: "#a8479b",
  brightMagenta: "#a9579e",
  cyan: "#0f7f86",
  brightCyan: "#168188",
  white: "#d5d9d6",
  brightWhite: "#f5f6f4",
};

export function temaXterm(tema: TemaEfetivo): ITheme {
  return tema === "claro" ? TEMA_XTERM_CLARO : TEMA_XTERM_ESCURO;
}
