// Prova que `node:sqlite` funciona no Electron real (T-00.05, D-08).
// Uso: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/banco-electron.cjs
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "expxv-electron-sqlite-"));
try {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(dir, "t.db"));
  db.exec("PRAGMA foreign_keys = ON");
  const wal = db.prepare("PRAGMA journal_mode = WAL").get();
  assert.strictEqual(wal.journal_mode, "wal", "WAL não ativou");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT NOT NULL)");
  const ins = db.prepare("INSERT INTO t (nome) VALUES (?)");
  ins.run("a");
  ins.run("b");
  const linhas = db.prepare("SELECT nome FROM t ORDER BY id").all();
  assert.deepStrictEqual(linhas.map((l) => l.nome), ["a", "b"]);
  const upsert = db.prepare("INSERT INTO t (id, nome) VALUES (1, 'x') ON CONFLICT(id) DO UPDATE SET nome = excluded.nome RETURNING nome").get();
  assert.strictEqual(upsert.nome, "x");
  db.close();
  console.log(JSON.stringify({ ok: true, electron: process.versions.electron, node: process.versions.node, sqlite: "node:sqlite", journal_mode: wal.journal_mode }));
} catch (erro) {
  console.error("FALHA node:sqlite no Electron:", erro && erro.stack ? erro.stack : erro);
  process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
