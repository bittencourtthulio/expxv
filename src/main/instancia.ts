/**
 * Instância única: a segunda chamada do app chega aqui. Foca a janela existente (restaurando se
 * minimizada) ou a recria. Dependências injetáveis para teste.
 */

export interface JanelaViva {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

export function tratarSegundaInstancia(op: {
  janela: JanelaViva | null;
  reabrirJanela: () => void;
}): void {
  const { janela } = op;
  if (janela !== null && !janela.isDestroyed()) {
    if (janela.isMinimized()) janela.restore();
    janela.focus();
    return;
  }
  op.reabrirJanela();
}
