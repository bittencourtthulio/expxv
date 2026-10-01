// Debounce com relógio injetável (testável sem esperar de verdade).
export function criarDebounce(acao, espera, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let id = null;
  const chamar = () => {
    if (id !== null) clearTimer(id);
    id = setTimer(() => {
      id = null;
      acao();
    }, espera);
  };
  chamar.cancelar = () => {
    if (id !== null) clearTimer(id);
    id = null;
  };
  chamar.pendente = () => id !== null;
  return chamar;
}

/** Arquivo de saída do main que justifica reiniciar o Electron. */
export function mudancaRelevante(arquivo) {
  return arquivo !== null && arquivo !== undefined && String(arquivo).endsWith(".js");
}
