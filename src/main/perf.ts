import type { InfoPerf } from "../compartilhado/ipc";

/** Marcas de tempo do main (P-01). `inicioProcessoMs` = momento de início do processo. */
export interface MarcasPerf {
  marcar(nome: string): void;
  ler(): InfoPerf;
}

export function criarMarcasPerf(inicioProcessoMs: number, agora: () => number = () => Date.now()): MarcasPerf {
  const marcas: Record<string, number> = {};
  return {
    marcar(nome) {
      if (nome.length === 0 || nome.length > 80 || nome in marcas) return;
      marcas[nome] = Math.max(0, agora() - inicioProcessoMs);
    },
    ler() {
      return { janelaVisivelMs: marcas["janela:visivel"] ?? null, marcas: { ...marcas } };
    },
  };
}
