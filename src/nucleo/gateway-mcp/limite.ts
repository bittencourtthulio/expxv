// Rate limit por Pane (janela deslizante de 60 s). Puro: o relógio entra por parâmetro.
export interface LimitadorGateway {
  /** `true` = pode (consome); `false` = estourou (não consome). */
  tentar(chave: string, limitePorMin: number, agoraMs: number): boolean;
  esquecer(chave: string): void;
  tamanho(): number;
}

export function criarLimitador(): LimitadorGateway {
  const janelas = new Map<string, number[]>();
  return {
    tentar(chave, limitePorMin, agoraMs) {
      const recentes = (janelas.get(chave) ?? []).filter((t) => agoraMs - t < 60_000);
      if (recentes.length >= limitePorMin) {
        janelas.set(chave, recentes);
        return false;
      }
      recentes.push(agoraMs);
      janelas.set(chave, recentes);
      return true;
    },
    esquecer: (chave) => { janelas.delete(chave); },
    tamanho: () => janelas.size,
  };
}
