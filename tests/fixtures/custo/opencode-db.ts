// Fixture SINTÉTICA do `opencode.db` (SQLite) com o esquema real (nomes de tabelas/colunas/índice conferidos em leitura): nada de conteúdo real.
import { DatabaseSync } from "node:sqlite";

export const SENTINELA_OC = "FRASE-SECRETA-OPENCODE-9d41";
export interface MsgOc {
  id: string;
  sessao: string;
  t: number;
  /** campos do JSON `data` (sobrepõem o padrão de assistente completo). */
  data?: Record<string, unknown>;
  /** string crua em `data` (JSON quebrado etc.). */
  cru?: string;
}
export const dataAssistente = (t: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  role: "assistant",
  modelID: "modelo-x",
  providerID: "prov",
  tokens: { total: 1, input: 100, output: 10, reasoning: 0, cache: { write: 0, read: 0 } },
  cost: 0,
  summary: SENTINELA_OC, // conteúdo que NUNCA pode atravessar o leitor
  time: { created: t, completed: t + 5 },
  ...extra,
});

export function criarOpenCodeDb(caminho: string): DatabaseSync {
  const db = new DatabaseSync(caminho);
  db.exec(`
    CREATE TABLE \`session\` (\`id\` text PRIMARY KEY, \`project_id\` text NOT NULL, \`parent_id\` text, \`slug\` text NOT NULL DEFAULT 's', \`directory\` text NOT NULL, \`title\` text NOT NULL DEFAULT 't', \`version\` text NOT NULL DEFAULT '1',
      \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`time_archived\` integer, \`cost\` real DEFAULT 0 NOT NULL);
    CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);
    CREATE TABLE \`message\` (\`id\` text PRIMARY KEY, \`session_id\` text NOT NULL, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL,
      CONSTRAINT \`fk_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE);
    CREATE INDEX \`message_session_time_created_id_idx\` ON \`message\` (\`session_id\`,\`time_created\`,\`id\`);
  `);
  return db;
}
export function inserirSessao(db: DatabaseSync, id: string, directory: string, t: number, parent: string | null = null): void {
  db.prepare("INSERT INTO session (id,project_id,parent_id,directory,time_created,time_updated) VALUES (?,?,?,?,?,?)").run(id, "prj", parent, directory, t, t);
}
export function inserirMensagens(db: DatabaseSync, msgs: MsgOc[]): void {
  const st = db.prepare("INSERT OR REPLACE INTO message (id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?)");
  db.exec("BEGIN");
  try {
    for (const m of msgs) st.run(m.id, m.sessao, m.t, m.t, m.cru ?? JSON.stringify(m.data ?? dataAssistente(m.t)));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
