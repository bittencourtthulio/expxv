// ATALHO ESCONDIDO (D-653) — o mesmo do ExpxMedia (personagem/useSegredo.ts): o código Konami ↑ ↑ ↓ ↓ ← → ← → B A, digitado em qualquer lugar da janela
// (menos em campo de texto e terminal), ou Shift + clique no bichinho do rodapé do menu. Chama o passeio na hora (todos os bichinhos visíveis,
// mesmo trabalhando; 40 s; clique ou Esc encerra). NÃO listar no ⌘K, na ajuda de atalhos nem em tooltips: é escondido de propósito.
export const CODIGO_SECRETO = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"] as const;

/** Próximo índice da sequência: acertar avança; errar volta ao início (a tecla errada ainda pode ser a primeira do código). */
export function avancarSequencia(indice: number, tecla: string): number {
  const t = tecla.length === 1 ? tecla.toLowerCase() : tecla;
  if (t === CODIGO_SECRETO[indice]) return indice + 1;
  return t === CODIGO_SECRETO[0] ? 1 : 0;
}

/** Digitando em campo de texto, seletor ou terminal: a sequência não vale. */
export const digitando = (alvo: EventTarget | null): boolean =>
  typeof HTMLElement !== "undefined" && alvo instanceof HTMLElement && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName) || alvo.closest(".xterm") !== null);

/** Liga o ouvinte de teclado do segredo; devolve quem desliga. Um listener de keydown, sem timer. */
export function ligarSegredo(alvo: Pick<Window, "addEventListener" | "removeEventListener">, aoAcertar: () => void): () => void {
  let i = 0;
  const aoTeclar = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (digitando(k.target) || k.metaKey || k.ctrlKey || k.altKey) { i = 0; return; }
    i = avancarSequencia(i, k.key);
    if (i === CODIGO_SECRETO.length) { i = 0; aoAcertar(); }
  };
  alvo.addEventListener("keydown", aoTeclar);
  return () => alvo.removeEventListener("keydown", aoTeclar);
}
