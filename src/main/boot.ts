/**
 * Boot em duas ondas (03-ORCAMENTOS §"Regras de arquitetura", P-01):
 *  - onda 1: a janela (dentro de `abrir`) — é a única coisa aguardada;
 *  - onda 2: serviços secundários (banco, daemon, detecção, watchers…) começam DEPOIS, na mesma
 *    volta do event loop, em paralelo, com erro isolado por serviço. Nunca bloqueiam a janela.
 */

export type ServicosSecundarios = Record<string, () => void | Promise<void>>;
export type AoFalharServico = (nome: string, erro: unknown) => void;
export type Marcar = (nome: string) => void;

/** Inicia todos na mesma volta; resolve quando todos terminam; nunca rejeita. */
export function iniciarServicosSecundarios(
  servicos: ServicosSecundarios,
  aoFalhar: AoFalharServico,
  marcar?: Marcar,
): Promise<void> {
  const execucoes = Object.entries(servicos).map(async ([nome, iniciar]) => {
    try {
      await iniciar();
      marcar?.(`boot:servico:${nome}`);
    } catch (erro) {
      aoFalhar(nome, erro);
    }
  });
  return Promise.all(execucoes).then(() => undefined);
}

/**
 * Aguarda só `abrir` e dispara os serviços secundários sem esperá-los. Falha ao abrir propaga e
 * nenhum serviço começa. Resolve com `servicosProntos`, que o chamador pode ignorar.
 */
export async function executarBoot(op: {
  abrir: () => Promise<void> | void;
  servicos: ServicosSecundarios;
  aoFalhar: AoFalharServico;
  marcar?: Marcar;
}): Promise<{ servicosProntos: Promise<void> }> {
  await op.abrir();
  op.marcar?.("boot:onda1");
  const servicosProntos = iniciarServicosSecundarios(op.servicos, op.aoFalhar, op.marcar);
  return { servicosProntos };
}
