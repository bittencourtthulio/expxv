/** O que um atalho da tela de Terminais pede. */
export type AcaoAtalho =
  | { tipo: "dividir"; orientacao: "horizontal" | "vertical" }
  | { tipo: "nova-aba" }
  | { tipo: "fechar" }
  | { tipo: "aba"; passo: 1 | -1 }
  | { tipo: "aba-numero"; numero: number }
  | { tipo: "painel"; passo: 1 | -1 }
  | { tipo: "focar" }
  /** tira o foco do terminal (que engole Tab) e leva à aba ativa: saída de teclado obrigatória (WCAG 2.1.2). */
  | { tipo: "sair" }
  | { tipo: "paleta" }
  | { tipo: "expandir" }
  | { tipo: "tema" };

type Evento = Pick<KeyboardEvent, "type" | "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function setas(tecla: string): AcaoAtalho | null {
  if (tecla === "arrowleft" || tecla === "arrowup") return { tipo: "painel", passo: -1 };
  if (tecla === "arrowright" || tecla === "arrowdown") return { tipo: "painel", passo: 1 };
  return null;
}

/**
 * Regra de 04-UI-UX: Cmd+tecla no macOS; Ctrl+Shift+tecla nos demais. Ctrl+letra puro é do processo
 * (Ctrl+D é EOF, Ctrl+W apaga palavra, Ctrl+K apaga até o fim da linha). Números de aba e setas usam
 * Ctrl (+Alt nas setas) no Windows/Linux, como na tabela. Ctrl+Tab troca de aba nos dois sistemas.
 */
export function interpretarAtalho(e: Evento, mac: boolean = EH_MAC): AcaoAtalho | null {
  if (e.type !== "keydown") return null;
  const tecla = e.key.toLowerCase();
  if (e.ctrlKey && !e.metaKey && !e.altKey && tecla === "tab") return { tipo: "aba", passo: e.shiftKey ? -1 : 1 };
  const digito = /^Digit([1-9])$/.exec(e.code ?? "")?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);

  if (mac) {
    if (!e.metaKey || e.ctrlKey) return null;
    if (e.altKey) return e.shiftKey ? null : setas(tecla);
    if (tecla === "enter") return e.shiftKey ? { tipo: "expandir" } : null;
    if (e.shiftKey) {
      if (tecla === "d") return { tipo: "dividir", orientacao: "vertical" };
      if (tecla === "l") return { tipo: "tema" };
      if (tecla === "m") return { tipo: "sair" };
      if (e.code === "BracketRight" || tecla === "}") return { tipo: "aba", passo: 1 };
      if (e.code === "BracketLeft" || tecla === "{") return { tipo: "aba", passo: -1 };
      return null;
    }
    if (tecla === "d") return { tipo: "dividir", orientacao: "horizontal" };
    if (tecla === "n") return { tipo: "nova-aba" };
    if (tecla === "w") return { tipo: "fechar" };
    if (tecla === "j") return { tipo: "focar" };
    if (tecla === "k") return { tipo: "paleta" };
    return digito === null ? null : { tipo: "aba-numero", numero: Number(digito) };
  }

  // Windows e Linux
  if (e.metaKey) return null;
  if (!e.ctrlKey) return null;
  if (e.altKey) { const s = setas(tecla); if (s !== null) return s; } // Ctrl+Alt(+Shift) setas
  if (!e.shiftKey) return e.altKey || digito === null ? null : { tipo: "aba-numero", numero: Number(digito) }; // Ctrl+1…9; o resto é do processo
  if (tecla === "enter") return { tipo: "expandir" };
  if (tecla === "d") return { tipo: "dividir", orientacao: e.altKey ? "vertical" : "horizontal" };
  if (e.altKey) return null;
  if (tecla === "n") return { tipo: "nova-aba" };
  if (tecla === "w") return { tipo: "fechar" };
  if (tecla === "j") return { tipo: "focar" };
  if (tecla === "p") return { tipo: "paleta" };
  if (tecla === "l") return { tipo: "tema" };
  if (tecla === "m") return { tipo: "sair" };
  return digito === null ? null : { tipo: "aba-numero", numero: Number(digito) };
}

/** Próximo (ou anterior) da lista, dando a volta; sem item atual, começa pela ponta. */
export function vizinhoCircular<T>(itens: readonly T[], atual: T | null, passo: 1 | -1): T | null {
  if (itens.length === 0) return null;
  const i = atual === null ? -1 : itens.indexOf(atual);
  if (i < 0) return (passo === 1 ? itens[0] : itens[itens.length - 1]) ?? null;
  return itens[(i + passo + itens.length) % itens.length] ?? null;
}

/** O que a ajuda mostra: uma linha por atalho, com a grafia de cada sistema. */
export const LISTA_ATALHOS: ReadonlyArray<{ acao: string; mac: string; outros: string }> = [
  { acao: "Paleta de comandos", mac: "⌘K", outros: "Ctrl+Shift+P" },
  { acao: "Nova aba / terminal", mac: "⌘N", outros: "Ctrl+Shift+N" },
  { acao: "Dividir lado a lado", mac: "⌘D", outros: "Ctrl+Shift+D" },
  { acao: "Dividir em cima e embaixo", mac: "⌘⇧D", outros: "Ctrl+Shift+Alt+D" },
  { acao: "Fechar painel", mac: "⌘W", outros: "Ctrl+Shift+W" },
  { acao: "Focar o terminal", mac: "⌘J", outros: "Ctrl+Shift+J" },
  { acao: "Sair do terminal (foco na aba)", mac: "⌘⇧M", outros: "Ctrl+Shift+M" },
  { acao: "Ir à aba 1 a 9", mac: "⌘1–9", outros: "Ctrl+1–9" },
  { acao: "Aba seguinte / anterior", mac: "Ctrl+Tab / Ctrl+⇧Tab", outros: "Ctrl+Tab / Ctrl+Shift+Tab" },
  { acao: "Painel vizinho", mac: "⌘⌥ setas", outros: "Ctrl+Alt setas" },
  { acao: "Expandir / restaurar painel", mac: "⌘⇧Enter", outros: "Ctrl+Shift+Enter" },
  { acao: "Buscar no terminal", mac: "⌘F", outros: "Ctrl+Shift+F" },
  { acao: "Trocar tema", mac: "⌘⇧L", outros: "Ctrl+Shift+L" },
];
