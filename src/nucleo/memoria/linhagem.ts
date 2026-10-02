// Linhagem de Pane (T-08.05, D-49): a raiz da cadeia `respawn_de` identifica "o mesmo Pane" através de respawns.
import type { Banco } from "../banco";
import { NaoEncontradoErro } from "../dominio";

export const SALTOS_MAX = 20;

export class LinhagemCiclicaErro extends Error {
  override name = "LinhagemCiclicaErro";
  constructor(readonly paneId: string) {
    super(`A cadeia respawn_de do Pane ${paneId} tem ciclo ou passa de ${SALTOS_MAX} saltos.`);
  }
}

/** Do Pane até a raiz, inclusive (primeiro = o próprio Pane). */
export function linhagemDe(banco: Banco, paneId: string): string[] {
  const cadeia: string[] = [];
  const vistos = new Set<string>();
  let atual: string | null = paneId;
  while (atual !== null) {
    if (vistos.has(atual) || cadeia.length > SALTOS_MAX) throw new LinhagemCiclicaErro(paneId);
    const linha: { respawn_de: string | null } | undefined = banco.consultarUm<{ respawn_de: string | null }>("SELECT respawn_de FROM pane WHERE id = ?", [atual]);
    if (!linha) {
      if (cadeia.length === 0) throw new NaoEncontradoErro("Pane", paneId);
      break; // antepassado removido: a raiz é o último que existe
    }
    vistos.add(atual);
    cadeia.push(atual);
    atual = linha.respawn_de;
  }
  return cadeia;
}

export const raizDaLinhagem = (banco: Banco, paneId: string): string => linhagemDe(banco, paneId).at(-1) as string;
