/** Colagem de texto grande: o que passa do limite não vai de uma vez ao PTY (o IPC recusa mais de 64 KB por envio). */
export const LIMITE_COLAGEM_CARACTERES = 20_000;
export const LIMITE_COLAGEM_BYTES = 32 * 1024;
/** Metade do `entrada_bytes` do contrato: cabe com folga no IPC sem mudar o contrato. */
export const TAMANHO_PEDACO_BYTES = 32 * 1024;

export const ABRE_COLAGEM = "\x1b[200~";
export const FECHA_COLAGEM = "\x1b[201~";

const codificador = new TextEncoder();
const bytesDe = (texto: string): number => codificador.encode(texto).length;

export function precisaDeConfirmacao(texto: string): boolean {
  return texto.length > LIMITE_COLAGEM_CARACTERES || bytesDe(texto) > LIMITE_COLAGEM_BYTES;
}

/** Quebras de linha viram Enter (CR) e os marcadores de colagem de dentro do texto somem: texto colado nunca fecha o envelope. */
export function normalizarColagem(texto: string): string {
  return texto.replaceAll(ABRE_COLAGEM, "").replaceAll(FECHA_COLAGEM, "").replace(/\r?\n/g, "\r");
}

/** Pedaços de até `maxBytes` em UTF-8, sem partir um par substituto UTF-16 (emoji) ao meio. */
export function partirColagem(texto: string, maxBytes: number = TAMANHO_PEDACO_BYTES): string[] {
  const partes: string[] = [];
  let atual = "";
  let bytesAtuais = 0;
  for (const ponto of texto) { // itera por code point: o par substituto nunca é separado
    const b = bytesDe(ponto);
    if (bytesAtuais + b > maxBytes && atual !== "") { partes.push(atual); atual = ""; bytesAtuais = 0; }
    atual += ponto;
    bytesAtuais += b;
  }
  if (atual !== "") partes.push(atual);
  return partes;
}

/** O envelope de colagem só existe se o terminal está em modo 2004, e envolve o texto inteiro, não cada pedaço. */
export function envelopar(partes: readonly string[], modo2004: boolean): string[] {
  return modo2004 ? [ABRE_COLAGEM, ...partes, FECHA_COLAGEM] : [...partes];
}

export type ResultadoEnvio = "concluido" | "cancelado";

export interface EnvioColagem {
  /** Resolve quando o último pedaço saiu ou o envio foi cancelado. */
  concluido: Promise<ResultadoEnvio>;
}

export interface OpcoesEnvioColagem {
  texto: string;
  modo2004: boolean;
  escrever(dados: string): void;
  /** Pedaços de texto já enviados e o total (o envelope não conta). */
  aoProgresso?(feitos: number, total: number): void;
  /** Chamado ao acabar; de forma síncrona quando o texto cabe num pedaço só (sem espera entre pedaços). */
  aoFim?(resultado: ResultadoEnvio): void;
}

/**
 * Um envio por painel, pedaço a pedaço, cedendo a vez entre eles (`esperar`) para o processo consumir e o Esc chegar.
 * Cancelar fecha o envelope se ele foi aberto e não envia mais nada.
 */
export class GerenciadorColagem {
  readonly #esperar: () => Promise<void>;
  readonly #emCurso = new Map<string, { cancelado: boolean }>();

  constructor(esperar: () => Promise<void> = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); })) {
    this.#esperar = esperar;
  }

  emCurso(sessaoId: string): boolean { return this.#emCurso.has(sessaoId); }

  /** `null` quando já há uma colagem em curso neste painel. */
  iniciar(sessaoId: string, opcoes: OpcoesEnvioColagem): EnvioColagem | null {
    if (this.#emCurso.has(sessaoId)) return null;
    const estado = { cancelado: false };
    this.#emCurso.set(sessaoId, estado);
    const partes = partirColagem(normalizarColagem(opcoes.texto));
    const concluido = (async (): Promise<ResultadoEnvio> => {
      let aberto = false;
      try {
        if (opcoes.modo2004) { opcoes.escrever(ABRE_COLAGEM); aberto = true; }
        for (const [indice, parte] of partes.entries()) {
          if (estado.cancelado) break;
          opcoes.escrever(parte);
          opcoes.aoProgresso?.(indice + 1, partes.length);
          if (indice < partes.length - 1) await this.#esperar();
        }
      } finally {
        if (aberto) opcoes.escrever(FECHA_COLAGEM);
        this.#emCurso.delete(sessaoId);
      }
      const resultado: ResultadoEnvio = estado.cancelado ? "cancelado" : "concluido";
      opcoes.aoFim?.(resultado);
      return resultado;
    })();
    return { concluido };
  }

  cancelar(sessaoId: string): void {
    const estado = this.#emCurso.get(sessaoId);
    if (estado !== undefined) estado.cancelado = true;
  }
}

/** Um gerenciador para a tela toda: "uma colagem por vez por painel". */
export const colagensDaTela = new GerenciadorColagem();
