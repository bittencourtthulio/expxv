import type { Extracao } from "../tipos";

// Tipos comuns às análises (Fase 17, §5). As análises são PURAS: recebem estruturas em memória e devolvem dados;
// nada de I/O, nada de banco. Quem lê do armazém é o serviço (T-17.21).

export interface ArquivoMapa {
  /** Relativo à raiz, com `/`. */
  caminho: string;
  extracao: Extracao;
  /** Pasta do arquivo (padrão: `dirname`). */
  modulo?: string;
}

export const idArquivo = (caminho: string): string => `arq:${caminho}`;
export const idSimbolo = (caminho: string, qualificado: string): string => `sim:${caminho}#${qualificado}`;
export const idEntrada = (caminho: string, chave: string): string => `ent:${caminho}#${chave}`;
export const idTabela = (nome: string): string => `tab:${nome}`;

export function pastaDe(caminho: string): string {
  const i = caminho.lastIndexOf("/");
  return i < 0 ? "." : caminho.slice(0, i);
}

export function moduloDe(a: ArquivoMapa): string {
  return a.modulo ?? pastaDe(a.caminho);
}
