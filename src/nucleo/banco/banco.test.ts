import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco, type Banco } from "./banco";

const abertos: Banco[] = [];
const pastas: string[] = [];
function pasta(): string {
  const p = mkdtempSync(join(tmpdir(), "expxv-banco-"));
  pastas.push(p);
  return p;
}
function abrir(caminho: string): Banco {
  const b = abrirBanco(caminho);
  abertos.push(b);
  return b;
}
afterEach(() => {
  for (const b of abertos.splice(0)) b.fechar();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const destinos: Array<[string, () => string]> = [
  [":memory:", () => ":memory:"],
  ["arquivo temporário", () => join(pasta(), "t.db")],
];

describe.each(destinos)("Banco (%s)", (_nome, caminho) => {
  it("executa, consulta e devolve linhas tipadas", () => {
    const b = abrir(caminho());
    b.executar("CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT)");
    const r = b.executar("INSERT INTO t (nome) VALUES (?)", ["a"]);
    expect(r.alteracoes).toBe(1);
    expect(r.ultimoId).toBe(1);
    b.executar("INSERT INTO t (nome) VALUES (:n)", { n: "b" });
    expect(b.consultar<{ nome: string }>("SELECT nome FROM t ORDER BY id")).toEqual([{ nome: "a" }, { nome: "b" }]);
    expect(b.consultarUm<{ nome: string }>("SELECT nome FROM t WHERE id = ?", [2])?.nome).toBe("b");
    expect(b.consultarUm("SELECT nome FROM t WHERE id = ?", [99])).toBeUndefined();
  });

  it("preparar reutiliza o statement", () => {
    const b = abrir(caminho());
    b.executar("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    const ins = b.preparar("INSERT INTO t (v) VALUES (?)");
    for (let i = 0; i < 5; i++) ins.executar([i]);
    const sel = b.preparar<{ v: number }>("SELECT v FROM t WHERE v >= ? ORDER BY v");
    expect(sel.consultar([3]).map((x) => x.v)).toEqual([3, 4]);
    expect(sel.consultarUm([4])?.v).toBe(4);
  });

  it("transacao commita em sucesso e devolve o valor", () => {
    const b = abrir(caminho());
    b.executar("CREATE TABLE t (v INTEGER)");
    const r = b.transacao((tx) => {
      tx.executar("INSERT INTO t VALUES (1)");
      tx.executar("INSERT INTO t VALUES (2)");
      return "ok";
    });
    expect(r).toBe("ok");
    expect(b.consultar("SELECT * FROM t")).toHaveLength(2);
  });

  it("transacao reverte tudo em erro e propaga o erro original", () => {
    const b = abrir(caminho());
    b.executar("CREATE TABLE t (v INTEGER)");
    expect(() =>
      b.transacao((tx) => {
        tx.executar("INSERT INTO t VALUES (1)");
        throw new Error("falha proposital");
      }),
    ).toThrow("falha proposital");
    expect(b.consultar("SELECT * FROM t")).toHaveLength(0);
    // a conexão segue utilizável
    b.executar("INSERT INTO t VALUES (3)");
    expect(b.consultar("SELECT * FROM t")).toHaveLength(1);
  });

  it("transação aninhada usa SAVEPOINT: erro interno reverte só o interno se capturado", () => {
    const b = abrir(caminho());
    b.executar("CREATE TABLE t (v INTEGER)");
    b.transacao((tx) => {
      tx.executar("INSERT INTO t VALUES (1)");
      try {
        tx.transacao((tx2) => {
          tx2.executar("INSERT INTO t VALUES (2)");
          throw new Error("interno");
        });
      } catch {
        /* capturado */
      }
      tx.executar("INSERT INTO t VALUES (3)");
    });
    expect(b.consultar<{ v: number }>("SELECT v FROM t ORDER BY v").map((x) => x.v)).toEqual([1, 3]);
  });

  it("transação aninhada sem captura reverte a externa inteira", () => {
    const b = abrir(caminho());
    b.executar("CREATE TABLE t (v INTEGER)");
    expect(() =>
      b.transacao((tx) => {
        tx.executar("INSERT INTO t VALUES (1)");
        tx.transacao(() => {
          throw new Error("x");
        });
      }),
    ).toThrow("x");
    expect(b.consultar("SELECT * FROM t")).toHaveLength(0);
  });

  it("foreign_keys está ativo", () => {
    const b = abrir(caminho());
    expect(b.consultarUm<{ foreign_keys: number }>("PRAGMA foreign_keys")?.foreign_keys).toBe(1);
    b.executar("CREATE TABLE pai (id INTEGER PRIMARY KEY)");
    b.executar("CREATE TABLE filho (pai_id INTEGER REFERENCES pai(id))");
    expect(() => b.executar("INSERT INTO filho VALUES (42)")).toThrow(/FOREIGN KEY/i);
  });

  it("fechar é idempotente e o uso depois de fechar falha", () => {
    const b = abrir(caminho());
    b.fechar();
    expect(() => b.fechar()).not.toThrow();
    expect(() => b.consultar("SELECT 1")).toThrow();
  });
});

describe("Banco em arquivo", () => {
  it("ativa WAL, synchronous=NORMAL e busy_timeout", () => {
    const b = abrir(join(pasta(), "w.db"));
    expect(b.consultarUm<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode).toBe("wal");
    expect(b.consultarUm<{ synchronous: number }>("PRAGMA synchronous")?.synchronous).toBe(1);
    expect(b.consultarUm<{ timeout: number }>("PRAGMA busy_timeout")?.timeout).toBeGreaterThan(0);
  });

  it("persiste entre aberturas", () => {
    const caminho = join(pasta(), "p.db");
    const a = abrirBanco(caminho);
    a.executar("CREATE TABLE t (v INTEGER)");
    a.executar("INSERT INTO t VALUES (7)");
    a.fechar();
    const b = abrir(caminho);
    expect(b.consultarUm<{ v: number }>("SELECT v FROM t")?.v).toBe(7);
  });
});
