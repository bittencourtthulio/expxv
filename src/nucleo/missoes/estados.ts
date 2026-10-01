// Máquina de estados da Missão: a tabela vive em `dominio/enums.ts` (`TRANSICOES_MISSAO`); aqui ficam
// os auxiliares de serviço (caminho até um estado, regra de ocupação de árvore).
import { TRANSICOES_MISSAO, TransicaoMissaoInvalidaErro, transicaoMissaoValida, type EstadoMissao, type ModoMissao, type OrigemMissao } from "../dominio";

export function exigirTransicao(de: EstadoMissao, para: EstadoMissao): void {
  if (!transicaoMissaoValida(de, para)) throw new TransicaoMissaoInvalidaErro(de, para);
}

/**
 * Passos (em ordem) para ir de `de` a `para` seguindo só transições válidas; `null` se não há caminho
 * (estado terminal não sai). Busca em largura: o caminho mais curto, que passa pelos intermediários.
 */
export function caminhoAte(de: EstadoMissao, para: EstadoMissao): EstadoMissao[] | null {
  if (de === para) return null;
  const anterior = new Map<EstadoMissao, EstadoMissao>();
  const fila: EstadoMissao[] = [de];
  const visto = new Set<EstadoMissao>([de]);
  while (fila.length > 0) {
    const atual = fila.shift() as EstadoMissao;
    for (const prox of TRANSICOES_MISSAO[atual]) {
      if (visto.has(prox)) continue;
      visto.add(prox);
      anterior.set(prox, atual);
      if (prox === para) {
        const passos: EstadoMissao[] = [];
        for (let e: EstadoMissao | undefined = para; e !== undefined && e !== de; e = anterior.get(e)) passos.unshift(e);
        return passos;
      }
      fila.push(prox);
    }
  }
  return null;
}

/**
 * Uma Missão por árvore (D-22). Só a Missão puramente livre (modo e origem `livre`: um grupo de
 * terminais sem trabalho) fica de fora da regra.
 */
export function ocupaArvore(m: { modo: ModoMissao; origem: OrigemMissao }): boolean {
  return !(m.modo === "livre" && m.origem === "livre");
}
