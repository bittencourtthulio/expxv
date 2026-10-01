import { DatabaseSync, type StatementSync } from "node:sqlite";

/**
 * Interface de persistência (D-08). A implementação usa `node:sqlite`; nada fora de `banco/` importa
 * o módulo, então trocar o motor não muda o resto do código.
 */
export type Valor = string | number | bigint | null | Uint8Array;
export type Parametros = readonly Valor[] | Readonly<Record<string, Valor>>;
export type Linha = Record<string, unknown>;

export interface ResultadoExecucao {
  alteracoes: number;
  ultimoId: number;
}

export interface Declaracao<T = Linha> {
  executar(parametros?: Parametros): ResultadoExecucao;
  consultar(parametros?: Parametros): T[];
  consultarUm(parametros?: Parametros): T | undefined;
}

export interface Banco {
  executar(sql: string, parametros?: Parametros): ResultadoExecucao;
  consultar<T = Linha>(sql: string, parametros?: Parametros): T[];
  consultarUm<T = Linha>(sql: string, parametros?: Parametros): T | undefined;
  preparar<T = Linha>(sql: string): Declaracao<T>;
  /**
   * Executa `fn` atomicamente. A mais externa usa `BEGIN IMMEDIATE` (pega o lock de escrita já no
   * início, sem upgrade que falha com SQLITE_BUSY); commit no sucesso, ROLLBACK em erro (o erro
   * original é propagado). Chamada aninhada usa SAVEPOINT: erro interno desfaz só o trecho interno
   * e, se propagar, desfaz também a externa. `fn` deve ser síncrona.
   */
  transacao<T>(fn: (banco: Banco) => T): T;
  /** Idempotente. Depois de fechar, qualquer uso lança. */
  fechar(): void;
}

export interface OpcoesBanco {
  /** Espera por lock antes de falhar com SQLITE_BUSY. Padrão 5000 ms. */
  busyTimeoutMs?: number;
}

function normalizar(p: Parametros | undefined): { nomeados?: Record<string, Valor>; posicionais: Valor[] } {
  if (p === undefined) return { posicionais: [] };
  if (Array.isArray(p)) return { posicionais: [...(p as readonly Valor[])] };
  return { nomeados: p as Record<string, Valor>, posicionais: [] };
}

function rodar(st: StatementSync, p: Parametros | undefined): ResultadoExecucao {
  const { nomeados, posicionais } = normalizar(p);
  const r = nomeados ? st.run(nomeados) : st.run(...posicionais);
  return { alteracoes: Number(r.changes), ultimoId: Number(r.lastInsertRowid) };
}
function todas<T>(st: StatementSync, p: Parametros | undefined): T[] {
  const { nomeados, posicionais } = normalizar(p);
  return (nomeados ? st.all(nomeados) : st.all(...posicionais)) as T[];
}
function uma<T>(st: StatementSync, p: Parametros | undefined): T | undefined {
  const { nomeados, posicionais } = normalizar(p);
  return (nomeados ? st.get(nomeados) : st.get(...posicionais)) as T | undefined;
}

class BancoSqlite implements Banco {
  private db: DatabaseSync | undefined;
  private profundidade = 0;

  constructor(caminho: string, opcoes: OpcoesBanco) {
    const db = new DatabaseSync(caminho);
    this.db = db;
    const espera = Math.max(0, Math.floor(opcoes.busyTimeoutMs ?? 5000));
    // busy_timeout primeiro: os demais pragmas já podem disputar lock.
    db.exec(`PRAGMA busy_timeout = ${espera}`);
    db.exec("PRAGMA foreign_keys = ON");
    if (caminho !== ":memory:" && caminho !== "") {
      db.exec("PRAGMA journal_mode = WAL");
    }
    db.exec("PRAGMA synchronous = NORMAL");
  }

  private aberto(): DatabaseSync {
    if (!this.db) throw new Error("Banco já foi fechado.");
    return this.db;
  }

  executar(sql: string, parametros?: Parametros): ResultadoExecucao {
    const db = this.aberto();
    if (parametros === undefined) {
      db.exec(sql); // aceita múltiplas instruções (DDL, PRAGMA)
      return { alteracoes: 0, ultimoId: 0 };
    }
    return rodar(db.prepare(sql), parametros);
  }

  consultar<T = Linha>(sql: string, parametros?: Parametros): T[] {
    return todas<T>(this.aberto().prepare(sql), parametros);
  }

  consultarUm<T = Linha>(sql: string, parametros?: Parametros): T | undefined {
    return uma<T>(this.aberto().prepare(sql), parametros);
  }

  preparar<T = Linha>(sql: string): Declaracao<T> {
    const st = this.aberto().prepare(sql);
    return {
      executar: (p) => rodar(st, p),
      consultar: (p) => todas<T>(st, p),
      consultarUm: (p) => uma<T>(st, p),
    };
  }

  transacao<T>(fn: (banco: Banco) => T): T {
    const db = this.aberto();
    const externa = this.profundidade === 0;
    const ponto = `sp_${this.profundidade}`;
    db.exec(externa ? "BEGIN IMMEDIATE" : `SAVEPOINT ${ponto}`);
    this.profundidade++;
    try {
      const r = fn(this);
      this.profundidade--;
      db.exec(externa ? "COMMIT" : `RELEASE ${ponto}`);
      return r;
    } catch (erro) {
      this.profundidade--;
      try {
        if (externa) db.exec("ROLLBACK");
        else db.exec(`ROLLBACK TO ${ponto}; RELEASE ${ponto}`);
      } catch {
        /* a falha original é a que importa */
      }
      throw erro;
    }
  }

  fechar(): void {
    if (!this.db) return;
    const db = this.db;
    this.db = undefined;
    db.close();
  }
}

/** Abre (ou cria) o banco. `":memory:"` para banco efêmero. Não migra: veja `migrar`. */
export function abrirBanco(caminho: string, opcoes: OpcoesBanco = {}): Banco {
  return new BancoSqlite(caminho, opcoes);
}
