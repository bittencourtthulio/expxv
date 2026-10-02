// Constantes do conhecimento (Fase 15). Limites do plano `fase-15-rag-chat.md`; nada aqui depende de Electron.
export const CHUNK_ALVO = 1200;
export const CHUNK_SOBREPOSICAO = 150;
export const CHUNK_MAX = 2000;
export const TRECHO_MAX = 400;
export const TIMEOUT_CONSULTA_MS = 150;
export const MODELO_HASH_ID = "hash-256-v1";
export const DIMENSAO_HASH = 256;
export const RRF_K = 60;
export const PESO_VETORIAL_HASH = 0.5;
export const PESO_VETORIAL_REAL = 1;
export const MAX_CHUNKS_POR_DOCUMENTO = 2;
export const CONTEXTO_CHARS_PADRAO = 2000;
export const CONTEXTO_CHARS_MIN = 500;
export const CONTEXTO_CHARS_MAX = 6000;
/** `N × dim` até este valor usa o índice exato em float32 (DEC-1). */
export const LIMITE_EXATO_F32 = 25_000_000;
export const ARQUIVO_CODIGO_MAX_BYTES = 256 * 1024;
export const COSSENO_QUASE_DUPLICATA = 0.92;
export const TRIGRAMA_QUASE_DUPLICATA = 0.8;
export const PISO_FATOR_TEMPO = 0.3;
export const MEIA_VIDA_DIAS: Readonly<Record<string, number>> = { decisao: 365, causa_raiz: 365, armadilha: 180, correcao: 180, padrao: 180, fato: 90, transcricao: 60 };
export const FATOR_TIPO: Readonly<Record<string, number>> = {
  aprendizado: 1.3,
  decisao: 1.2,
  causa_raiz: 1.2,
  doc: 1,
  relatorio: 1,
  qa: 1,
  commit: 1,
  task: 1,
  handoff: 1,
  missao: 1,
  pr: 1,
  nota: 1,
  codigo: 0.9,
  transcricao: 0.8,
  chat: 0.7,
};
export const POLITICA_VERSAO = 1;
