/**
 * Armazém de saída dos terminais (P-04): guarda a saída de cada sessão fora do
 * estado do React, em lista de chunks (sem concatenar 2 MiB por evento).
 *
 * - Chaveado por `sessao_id`; aceita eventos de ids que a aba ainda não conhece.
 * - Limite de 2 MiB medido em `length` de string UTF-16 (D-16), como antes em
 *   do ExpxMedia; ao passar, descarta os chunks mais antigos e marca `truncado`.
 * - Regra de sequência: `sequencia <= ultima` descarta (vale para todo tipo de evento).
 */

export const LIMITE_ARMAZEM = 2 * 1024 * 1024;

export interface ResultadoEmpurrar {
  /** false quando a sequência é duplicada ou antiga (o evento é descartado). */
  aceito: boolean;
  /** true só na chamada em que a sessão passou a estar truncada. */
  truncou: boolean;
}

interface BufferSessao {
  chunks: string[];
  /** índice do primeiro chunk retido (evita `shift()` O(n) com milhares de chunks pequenos). */
  inicio: number;
  tamanho: number;
  truncado: boolean;
  ultima_sequencia: number;
}

export interface Armazem {
  /** Guarda o chunk da sessão; descarta se `sequencia <= ultima`. */
  empurrar(sessaoId: string, sequencia: number, dados: string): ResultadoEmpurrar;
  /** Avança a sequência por evento que não é saída (estado, encerramento); false se antiga. */
  registrarSequencia(sessaoId: string, sequencia: number): boolean;
  /** Chunks retidos, do mais antigo ao mais novo (cópia). */
  chunks(sessaoId: string): string[];
  /**
   * Assina os chunks da sessão: entrega já, de forma síncrona e em ordem, os chunks
   * retidos (replay) e depois cada chunk aceito, na hora, sem timer. Devolve o cancelamento.
   */
  assinar(sessaoId: string, aoChegar: (chunk: string) => void): () => void;
  /** Quantos terminais montados assinam a sessão (0 = ninguém consome: o store confirma o consumo). */
  assinantes(sessaoId: string): number;
  truncado(sessaoId: string): boolean;
  ultimaSequencia(sessaoId: string): number;
  descartar(sessaoId: string): void;
  limparTudo(): void;
}

export function criarArmazem(limite: number = LIMITE_ARMAZEM): Armazem {
  const sessoes = new Map<string, BufferSessao>();
  // os assinantes pertencem aos terminais montados, não ao dado: sobrevivem a descartar/limparTudo
  const assinantes = new Map<string, Set<(chunk: string) => void>>();

  const obter = (sessaoId: string): BufferSessao => {
    let buffer = sessoes.get(sessaoId);
    if (buffer === undefined) {
      buffer = { chunks: [], inicio: 0, tamanho: 0, truncado: false, ultima_sequencia: 0 };
      sessoes.set(sessaoId, buffer);
    }
    return buffer;
  };

  /** Descarta do início até caber; devolve true se descartou algo. */
  const aparar = (buffer: BufferSessao): boolean => {
    if (buffer.tamanho <= limite) return false;
    while (buffer.tamanho > limite && buffer.chunks.length - buffer.inicio > 1) {
      buffer.tamanho -= (buffer.chunks[buffer.inicio] as string).length;
      buffer.chunks[buffer.inicio] = "";
      buffer.inicio += 1;
    }
    if (buffer.tamanho > limite) {
      // sobrou um chunk só, maior que o limite: mantém o fim, como o slice(-limite) de antes
      const unico = (buffer.chunks[buffer.inicio] as string).slice(-limite);
      buffer.chunks[buffer.inicio] = unico;
      buffer.tamanho = unico.length;
    }
    if (buffer.inicio > 1024 && buffer.inicio * 2 > buffer.chunks.length) {
      buffer.chunks = buffer.chunks.slice(buffer.inicio);
      buffer.inicio = 0;
    }
    return true;
  };

  return {
    empurrar(sessaoId, sequencia, dados) {
      const buffer = obter(sessaoId);
      if (sequencia <= buffer.ultima_sequencia) return { aceito: false, truncou: false };
      buffer.ultima_sequencia = sequencia;
      if (dados.length === 0) return { aceito: true, truncou: false };
      buffer.chunks.push(dados);
      buffer.tamanho += dados.length;
      const descartou = aparar(buffer);
      const truncou = descartou && !buffer.truncado;
      if (descartou) buffer.truncado = true;
      const ouvintes = assinantes.get(sessaoId);
      if (ouvintes !== undefined) for (const ouvinte of ouvintes) ouvinte(dados);
      return { aceito: true, truncou };
    },
    registrarSequencia(sessaoId, sequencia) {
      const buffer = obter(sessaoId);
      if (sequencia <= buffer.ultima_sequencia) return false;
      buffer.ultima_sequencia = sequencia;
      return true;
    },
    chunks(sessaoId) {
      const buffer = sessoes.get(sessaoId);
      return buffer === undefined ? [] : buffer.chunks.slice(buffer.inicio);
    },
    assinar(sessaoId, aoChegar) {
      let ouvintes = assinantes.get(sessaoId);
      if (ouvintes === undefined) { ouvintes = new Set(); assinantes.set(sessaoId, ouvintes); }
      const buffer = sessoes.get(sessaoId);
      if (buffer !== undefined) for (const chunk of buffer.chunks.slice(buffer.inicio)) aoChegar(chunk);
      ouvintes.add(aoChegar);
      return () => {
        const atuais = assinantes.get(sessaoId);
        if (atuais === undefined) return;
        atuais.delete(aoChegar);
        if (atuais.size === 0) assinantes.delete(sessaoId);
      };
    },
    assinantes: (sessaoId) => assinantes.get(sessaoId)?.size ?? 0,
    truncado: (sessaoId) => sessoes.get(sessaoId)?.truncado ?? false,
    ultimaSequencia: (sessaoId) => sessoes.get(sessaoId)?.ultima_sequencia ?? 0,
    descartar(sessaoId) { sessoes.delete(sessaoId); },
    limparTudo() { sessoes.clear(); },
  };
}

/** Armazém único da interface: o store de terminais alimenta, cada terminal assina o da sua sessão. */
export const armazemDeSaida: Armazem = criarArmazem();
