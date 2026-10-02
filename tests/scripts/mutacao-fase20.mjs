#!/usr/bin/env node
// Harness de MUTAÇÃO da Fase 20 (T-20.40), sem dependência nova: para cada mitigação de segurança aplica UMA mutação textual exata no fonte, roda o(s) teste(s) que a
// provam e exige que FALHEM ("mutante morto"). Mutante que sobrevive = a defesa não é provada pelo teste = o script sai com código 1. O fonte é SEMPRE restaurado
// (try/finally + sinais + cópia de segurança fora do repositório). Uso:  node tests/scripts/mutacao-fase20.mjs [AB-23 ...]   (sem argumentos roda todas; ~1 s a 4 s por mutante)
// NÃO faz parte de `vitest run` (é lento e edita o fonte): a consistência da lista (trecho existe 1 vez, teste existe) é conferida por `tests/scripts/mutacao-fase20.test.ts`.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTACOES } from "./mutacoes-fase20.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const filtro = new Set(process.argv.slice(2));
const escolhidas = MUTACOES.filter((m) => filtro.size === 0 || filtro.has(m.id));
const sobra = mkdtempSync(join(tmpdir(), "mutacao-f20-"));
const copias = new Map();
let restaurando = false;

function restaurar() {
  if (restaurando) return;
  restaurando = true;
  for (const [alvo, copia] of copias) if (existsSync(copia)) copyFileSync(copia, alvo);
  copias.clear();
  rmSync(sobra, { recursive: true, force: true });
}
for (const s of ["SIGINT", "SIGTERM", "exit"]) process.on(s, () => { restaurar(); if (s !== "exit") process.exit(130); });

let sobreviventes = 0;
const linhas = [];
try {
  for (const m of escolhidas) {
    // uma mutação pode ter várias edições: defesas em camadas (ex.: dedupe do poller E UNIQUE da entrada) só são "provadas" quando TODAS as camadas somem
    const edicoes = m.edicoes ?? [{ arquivo: m.arquivo, de: m.de, para: m.para }];
    const originais = new Map();
    let invalida = null;
    for (const e of edicoes) {
      const alvo = join(RAIZ, e.arquivo);
      const original = originais.get(alvo) ?? readFileSync(alvo, "utf8");
      const n = original.split(e.de).length - 1;
      if (n !== 1) invalida = `trecho aparece ${n}x em ${e.arquivo}`;
      originais.set(alvo, original);
    }
    if (invalida !== null) {
      linhas.push(`${m.id}\tINVÁLIDA (${invalida})`);
      sobreviventes++;
      continue;
    }
    const mutados = new Map(originais);
    for (const e of edicoes) {
      const alvo = join(RAIZ, e.arquivo);
      mutados.set(alvo, (mutados.get(alvo) ?? "").replace(e.de, () => e.para));
    }
    for (const alvo of mutados.keys()) {
      const copia = join(sobra, `${copias.size}.bak`);
      copyFileSync(alvo, copia);
      copias.set(alvo, copia);
      writeFileSync(alvo, mutados.get(alvo) ?? "");
    }
    const args = ["vitest", "run", ...m.testes, ...(m.nome === undefined ? [] : ["-t", m.nome])];
    let r;
    try {
      r = spawnSync("npx", args, { cwd: RAIZ, encoding: "utf8", timeout: 180_000, env: { ...process.env, CI: "1" } });
    } finally {
      for (const [alvo, copia] of [...copias]) {
        copyFileSync(copia, alvo);
        copias.delete(alvo);
      }
    }
    const morto = r.status !== 0;
    if (!morto) sobreviventes++;
    linhas.push(`${m.id}\t${morto ? "morto" : "SOBREVIVEU"}\t${m.descricao}`);
  }
} finally {
  restaurar();
}
process.stdout.write(`${linhas.join("\n")}\n\n${escolhidas.length - sobreviventes}/${escolhidas.length} mutantes mortos\n`);
process.exit(sobreviventes === 0 ? 0 : 1);
