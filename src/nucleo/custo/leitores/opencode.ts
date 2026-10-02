// OpenCode (P-82): formato REAL verificado nesta máquina — `opencode.db` (SQLite; tabela `message`, coluna `data` JSON com `role`, `modelID`, `tokens{input,output,reasoning,cache{read,write}}`,
// `cost`, `time.created`). O banco é GRANDE (dezenas de GB): abre SOMENTE LEITURA por `node:sqlite` (nunca copia nem carrega), com cache de página pequeno, e consulta SÓ pelo índice
// `message_session_time_created_id_idx` (`session_id`, `time_created`, `id`) em lotes de ≤ 500 com cursor por chave — nada de varredura. Roda no worker thread.
// A linha da mensagem é criada ANTES de a resposta terminar (tokens zerados e sem `time.completed`): o cursor persistido fica no `time_created` da mais antiga ainda PENDENTE
// (janela de 10 min; passou disso, a mensagem é considerada abandonada) e a idempotência `(fonte_id, chave)` do banco absorve as releituras.
import { DatabaseSync } from "node:sqlite";
import { stat } from "node:fs/promises";
import type { RegistroExtraido } from "../../../compartilhado/custo";
import { LOTE_MAX, type LoteLido } from "./leitor";

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.trunc(x) : 0);

interface Analise {
  registro: RegistroExtraido | null;
  /** assistente ainda sem `time.completed` (resposta em andamento). */
  pendente: boolean;
}
function analisar(id: string, tempoCriadoMs: number, dataJson: string): Analise {
  const nada: Analise = { registro: null, pendente: false };
  let o: unknown;
  try {
    o = JSON.parse(dataJson);
  } catch {
    return nada;
  }
  if (typeof o !== "object" || o === null) return nada;
  const d = o as Record<string, unknown>;
  if (d["role"] !== "assistant") return nada;
  const tempo0 = typeof d["time"] === "object" && d["time"] !== null ? (d["time"] as Record<string, unknown>) : {};
  const pendente = num(tempo0["completed"]) === 0 && d["error"] === undefined;
  const t = d["tokens"];
  if (typeof t !== "object" || t === null) return { registro: null, pendente };
  const tk = t as Record<string, unknown>;
  const cache = typeof tk["cache"] === "object" && tk["cache"] !== null ? (tk["cache"] as Record<string, unknown>) : {};
  // `reasoning` já conta como saída paga na maioria dos provedores; o OpenCode a reporta à parte: soma na saída
  const tokens = { entrada: num(tk["input"]), cache_escrita: num(cache["write"]), cache_leitura: num(cache["read"]), saida: num(tk["output"]) + num(tk["reasoning"]) };
  if (tokens.entrada + tokens.cache_escrita + tokens.cache_leitura + tokens.saida === 0) return { registro: null, pendente };
  const tempo = typeof d["time"] === "object" && d["time"] !== null ? (d["time"] as Record<string, unknown>) : {};
  const ms = num(tempo["completed"]) || num(tempo["created"]) || tempoCriadoMs;
  if (!(ms > 0)) return { registro: null, pendente };
  const r: RegistroExtraido = { chave: id, ts: new Date(ms).toISOString(), modelo: typeof d["modelID"] === "string" && d["modelID"] !== "" ? d["modelID"] : null, tokens };
  // custo 0 com tokens > 0 é modelo sem preço na tabela do OpenCode: desconhecido, nunca "0"
  if (typeof d["cost"] === "number" && Number.isFinite(d["cost"]) && d["cost"] > 0) r.usd_medido = d["cost"];
  return { registro: r, pendente };
}

/** Parser puro (sem noção de "em andamento"): a leitura incremental usa `analisar` e adia as respostas pendentes. */
export function extrairOpenCode(id: string, tempoCriadoMs: number, dataJson: string): RegistroExtraido | null {
  return analisar(id, tempoCriadoMs, dataJson).registro;
}

export interface LinhaMensagemOpenCode {
  id: string;
  time_created: number;
  data: string;
}
export interface BancoOpenCodeLeitura {
  /** consulta parametrizada somente leitura (injetada: `node:sqlite` em worker). */
  todas(sql: string, params: Array<string | number>): LinhaMensagemOpenCode[];
}
/** Mensagens de UMA sessão depois de `aposMs` (usa o índice `message_session_time_created_id_idx`; nunca varre o banco inteiro). */
export function lerSessaoOpenCode(db: BancoOpenCodeLeitura, sessionId: string, aposMs: number, limite = 500): { registros: RegistroExtraido[]; ultimoMs: number } {
  const linhas = db.todas("SELECT id, time_created, data FROM message WHERE session_id = ? AND time_created > ? ORDER BY time_created, id LIMIT ?", [sessionId, aposMs, limite]);
  const registros: RegistroExtraido[] = [];
  let ultimoMs = aposMs;
  for (const l of linhas) {
    ultimoMs = Math.max(ultimoMs, l.time_created);
    const r = extrairOpenCode(l.id, l.time_created, l.data);
    if (r !== null) registros.push(r);
  }
  return { registros, ultimoMs };
}

// ---------------------------------------------------------------- leitura incremental (worker)
export const NOME_BANCO_OPENCODE = "opencode.db";
const ID_SESSAO = /^ses_[A-Za-z0-9]{6,60}$/;
export const JANELA_PENDENTE_MS = 10 * 60_000;
export const ehIdSessaoOpenCode = (x: string): boolean => ID_SESSAO.test(x);

/** Abre o `opencode.db` SOMENTE LEITURA, com cache de página pequeno (≈ 8 MiB) e sem mmap: a memória não cresce com o tamanho do banco. */
export function abrirOpenCode(caminho: string): DatabaseSync {
  const db = new DatabaseSync(caminho, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 2000; PRAGMA cache_size = -8192; PRAGMA mmap_size = 0");
  } catch {
    /* PRAGMAs de ajuste: a abertura somente leitura já basta */
  }
  return db;
}

export interface PedidoLeituraOpenCode {
  caminho: string;
  sessao: string;
  /** cursor persistido (`time_created` em ms; 0 = do início). */
  offset: number;
  loteMax?: number;
  agoraMs?: number;
}
/** Gerador de lotes da MESMA forma de `lerLotes` (`offset` = cursor em ms). Nunca devolve conteúdo: só `{ts, modelo, tokens, chave, usd_medido?}`. */
export async function* lerLotesOpenCode(p: PedidoLeituraOpenCode): AsyncGenerator<LoteLido> {
  if (!ID_SESSAO.test(p.sessao)) throw Object.assign(new Error("sessao_invalida"), { code: "sessao_invalida" });
  const loteMax = Math.min(p.loteMax ?? LOTE_MAX, LOTE_MAX);
  const agora = p.agoraMs ?? Date.now();
  const st = await stat(p.caminho);
  const meta = { tamanho: st.size, mtime_ms: Math.trunc(st.mtimeMs), inode: String(st.ino) };
  const db = abrirOpenCode(p.caminho);
  try {
    const primeira = db.prepare("SELECT id, time_created, data FROM message WHERE session_id = ? AND (time_created, id) >= (?, '') ORDER BY time_created, id LIMIT ?");
    const seguinte = db.prepare("SELECT id, time_created, data FROM message WHERE session_id = ? AND (time_created, id) > (?, ?) ORDER BY time_created, id LIMIT ?");
    let ultimoT = Math.max(0, Math.trunc(p.offset));
    let ultimoId: string | null = null;
    let pendMin: number | null = null;
    let persistido = ultimoT;
    for (;;) {
      const linhas = (ultimoId === null ? primeira.all(p.sessao, ultimoT, loteMax) : seguinte.all(p.sessao, ultimoT, ultimoId, loteMax)) as unknown as LinhaMensagemOpenCode[];
      const registros: RegistroExtraido[] = [];
      for (const l of linhas) {
        if (typeof l.data !== "string" || typeof l.id !== "string" || typeof l.time_created !== "number") continue;
        const a = analisar(l.id, l.time_created, l.data);
        // resposta ainda em andamento (sem `time.completed`, recente): NÃO conta agora (os tokens ainda mudam); o cursor fica nela até completar
        if (a.pendente && l.time_created > agora - JANELA_PENDENTE_MS) pendMin = pendMin === null ? l.time_created : Math.min(pendMin, l.time_created);
        else if (a.registro !== null) registros.push(a.registro);
      }
      const ultima = linhas[linhas.length - 1];
      if (ultima !== undefined) {
        ultimoT = ultima.time_created;
        ultimoId = ultima.id;
      }
      persistido = pendMin ?? (ultima !== undefined ? ultima.time_created : persistido);
      const ultimo = linhas.length < loteMax;
      yield { registros, offset: persistido, puladas: 0, estado: undefined, ...meta, reiniciou: false, ultimo };
      if (ultimo) return;
    }
  } finally {
    db.close();
  }
}

export interface PedidoLocalizarOpenCode {
  caminho: string;
  /** `cli_ref_conversa` do Pane (id `ses_…` quando o hook o informou). */
  conversa: string | null;
  /** diretório de trabalho do Pane (comparado com `session.directory`). */
  cwd: string | null;
  /** instante de criação do Pane (ms): só sessões criadas depois (menos folga) contam. */
  desdeMs: number;
}
/** Acha a sessão do Pane SEM varrer: pela chave primária quando há id, senão nas 200 últimas linhas de `session` (rowid decrescente) com o mesmo diretório. */
export function localizarSessaoOpenCode(p: PedidoLocalizarOpenCode): string | null {
  const db = abrirOpenCode(p.caminho);
  try {
    if (p.conversa !== null && ID_SESSAO.test(p.conversa)) {
      const l = db.prepare("SELECT id FROM session WHERE id = ?").get(p.conversa) as { id: string } | undefined;
      if (l !== undefined) return l.id;
    }
    if (p.cwd === null) return null;
    const linhas = db.prepare("SELECT id, directory, time_created FROM session WHERE parent_id IS NULL ORDER BY rowid DESC LIMIT 200").all() as unknown as Array<{ id: string; directory: string; time_created: number }>;
    const achada = linhas.find((l) => l.directory === p.cwd && l.time_created >= p.desdeMs - 60_000 && ID_SESSAO.test(l.id));
    return achada?.id ?? null;
  } finally {
    db.close();
  }
}
