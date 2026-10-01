// Saída de PTY em lote para o renderer (03-ORCAMENTOS, regra 3): agrupa por quadro e em pedaços de
// no máximo 64 KB, sem atrasar o eco de teclado.
//
// Borda de ataque: o primeiro pedaço de saída de uma sessão parada (fila vazia, sem janela de espera
// aberta) sai NA HORA — é o eco da tecla. Abre-se então uma janela de `quadro_ms`; o que chegar dentro
// dela espera e sai junto, no fim da janela. Se saiu algo, a janela se renova (um envio por quadro
// durante um fluxo contínuo); se não, ela fecha e o próximo pedaço volta a sair na hora.
//
// Ordem: qualquer evento que não seja saída (estado, encerramento, atividade…) descarrega antes a saída
// pendente da mesma sessão, então a ordem de `sequencia` que o renderer vê nunca se inverte.

import type { EventoTerminal } from "../../compartilhado/terminais";

type Saida = Extract<EventoTerminal, { tipo: "saida" }>;

/** Pedaço máximo de saída por evento enviado ao renderer, em bytes (UTF-8). */
export const PEDACO_LOTE_BYTES = 64 * 1_024;
/** Janela de agrupamento (um quadro a ~60 Hz). */
export const QUADRO_MS = 12;

export interface OpcoesLoteSaida {
  enviar: (evento: EventoTerminal) => void;
  /** Agenda `fn` daqui a `ms`; devolve o cancelamento. Padrão: setTimeout sem segurar o processo. */
  agendar?: (fn: () => void, ms: number) => () => void;
  quadro_ms?: number;
}

export interface LoteSaida {
  push(evento: EventoTerminal): void;
  /** Envia já o que está pendente da sessão (ou de todas). */
  descarregar(sessaoId?: string): void;
  /** Esquece a sessão (depois de descarregá-la). */
  liberar(sessaoId: string): void;
  /** Cancela os temporizadores e descarrega tudo. */
  fechar(): void;
}

interface Fila {
  pendentes: Saida[];
  /** há janela de espera aberta? */
  cancelar: (() => void) | null;
}

const agendarPadrao = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};

/** Fatia `texto` em pedaços de até `limite` bytes UTF-8, sem partir par substituto (emoji). */
export function dividirPorBytes(texto: string, limite: number = PEDACO_LOTE_BYTES): string[] {
  if (texto.length * 3 <= limite || Buffer.byteLength(texto) <= limite) return texto === "" ? [] : [texto];
  const pedacos: string[] = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fim = Math.min(texto.length, inicio + limite);
    let bytes = Buffer.byteLength(texto.slice(inicio, fim));
    while (bytes > limite) {
      fim = inicio + Math.max(1, Math.floor((fim - inicio) * (limite / bytes)) - 1);
      bytes = Buffer.byteLength(texto.slice(inicio, fim));
    }
    if (fim < texto.length && texto.charCodeAt(fim - 1) >= 0xd800 && texto.charCodeAt(fim - 1) <= 0xdbff) fim -= 1;
    if (fim <= inicio) fim = inicio + 1; // nunca trava: um caractere sempre cabe
    pedacos.push(texto.slice(inicio, fim));
    inicio = fim;
  }
  return pedacos;
}

export function criarLoteSaida(op: OpcoesLoteSaida): LoteSaida {
  const agendar = op.agendar ?? agendarPadrao;
  const quadro = op.quadro_ms ?? QUADRO_MS;
  const filas = new Map<string, Fila>();

  const filaDe = (id: string): Fila => {
    let f = filas.get(id);
    if (f === undefined) { f = { pendentes: [], cancelar: null }; filas.set(id, f); }
    return f;
  };

  /** Junta e envia: `k` pedaços usam as `k` últimas sequências dos eventos originais (k ≤ n), sempre crescentes. */
  function enviarSaidas(eventos: Saida[]): void {
    if (eventos.length === 0) return;
    const ultimo = eventos[eventos.length - 1] as Saida;
    const pedacos = dividirPorBytes(eventos.length === 1 ? ultimo.dados : eventos.map((e) => e.dados).join(""));
    const base = eventos.length - pedacos.length;
    pedacos.forEach((dados, i) => {
      const origem = eventos[base + i] as Saida;
      op.enviar({ versao: 1, tipo: "saida", sequencia: origem.sequencia, sessao_id: ultimo.sessao_id, dados });
    });
  }

  function abrirJanela(id: string, fila: Fila): void {
    fila.cancelar = agendar(() => {
      fila.cancelar = null;
      if (fila.pendentes.length === 0) return; // silêncio: a próxima saída volta a ser imediata
      enviarSaidas(fila.pendentes.splice(0));
      abrirJanela(id, fila); // fluxo contínuo: um envio por quadro
    }, quadro);
  }

  return {
    push(evento) {
      const fila = filaDe(evento.sessao_id);
      if (evento.tipo !== "saida") {
        enviarSaidas(fila.pendentes.splice(0));
        op.enviar(evento);
        return;
      }
      if (fila.cancelar === null) {
        enviarSaidas([evento]); // eco imediato
        abrirJanela(evento.sessao_id, fila);
        return;
      }
      fila.pendentes.push(evento);
    },
    descarregar(sessaoId) {
      if (sessaoId !== undefined) { enviarSaidas(filas.get(sessaoId)?.pendentes.splice(0) ?? []); return; }
      for (const fila of filas.values()) enviarSaidas(fila.pendentes.splice(0));
    },
    liberar(sessaoId) {
      const fila = filas.get(sessaoId);
      if (fila === undefined) return;
      enviarSaidas(fila.pendentes.splice(0));
      fila.cancelar?.();
      filas.delete(sessaoId);
    },
    fechar() {
      for (const fila of filas.values()) {
        enviarSaidas(fila.pendentes.splice(0));
        fila.cancelar?.();
        fila.cancelar = null;
      }
      filas.clear();
    },
  };
}
