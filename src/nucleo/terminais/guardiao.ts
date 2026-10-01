// Guardião de transições: serializa tudo que possa invalidar sessões (trocar de workspace, fechar
// janela, sair do app). Fila serial; confirmação se há sessões ativas; só libera a admissão de
// novas sessões se a transição não publicou.

export interface SessoesGuardadas {
  tem_sessoes_ativas: boolean;
  bloquearAdmissao(): void;
  liberarAdmissao(): void;
  encerrarTodasEAguardar(): Promise<void>;
}

export interface TransicaoGuardada {
  sessoes(): SessoesGuardadas | null;
  confirmar(): Promise<boolean>;
  executar(): Promise<void>;
  publicar?(): void;
}

export class GuardiaoTransicoes {
  #fila: Promise<void> = Promise.resolve();

  transicionar(op: TransicaoGuardada): Promise<boolean> {
    const resultado = this.#fila.then(() => this.#executar(op));
    this.#fila = resultado.then(() => undefined, () => undefined);
    return resultado;
  }

  async #executar(op: TransicaoGuardada): Promise<boolean> {
    const sessoes = op.sessoes();
    sessoes?.bloquearAdmissao();
    let publicou = false;
    try {
      if (sessoes?.tem_sessoes_ativas && !(await op.confirmar())) return false;
      if (sessoes?.tem_sessoes_ativas) await sessoes.encerrarTodasEAguardar();
      await op.executar();
      op.publicar?.();
      publicou = true;
      return true;
    } finally {
      if (!publicou) sessoes?.liberarAdmissao();
    }
  }
}
