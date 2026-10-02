// Tipos internos de squads (Fase 14). Re-exporta os contratos puros de `compartilhado/squads` e acrescenta o que só o núcleo usa.
export * from "../../compartilhado/squads";
import type { Squad } from "../../compartilhado/squads";

/** Versão do formato em disco (`squad.json` e frontmatter dos `.md`). Arquivo com versão MAIOR é recusado. */
export const SCHEMA_VERSION = 1;

/** Squad lida do disco, com o texto dos prompts por membro (`slug` do membro → corpo do `.md`). */
export interface SquadNoDisco {
  squad: Squad;
  prompts: Record<string, string>;
  /** avisos de leitura (campo desconhecido ignorado, prompt ausente…); nunca derrubam o índice. */
  avisos: string[];
  /** sha256 do conjunto (squad.json + todos os `.md`). */
  hash: string;
  /** caminho relativo → sha256 de cada arquivo. */
  arquivos: Record<string, string>;
}
