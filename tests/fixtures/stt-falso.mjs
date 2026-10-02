#!/usr/bin/env node
// Motor de STT falso (Fase 11): lê o WAV, confere o cabeçalho e imprime um texto fixo. Opções: --wav <arquivo> --texto <t> --json --atraso <ms> --falhar <codigo> --apagar --duracao
import { readFileSync, rmSync } from "node:fs";

const a = process.argv.slice(2);
const pega = (n, p = null) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] ?? p : p; };
const wav = pega("--wav");
const texto = pega("--texto", "texto ditado de teste");
const atraso = Number(pega("--atraso", "0"));
const falhar = pega("--falhar");

if (wav === null) { console.error("sem --wav"); process.exit(2); }
const bytes = readFileSync(wav);
if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") { console.error("wav inválido"); process.exit(3); }
if (a.includes("--apagar")) rmSync(wav, { force: true });
if (falhar !== null) process.exit(Number(falhar) || 1);

setTimeout(() => {
  if (a.includes("--duracao")) process.stdout.write(String((bytes.length - 44) / 32));
  else if (a.includes("--json")) process.stdout.write(JSON.stringify({ text: texto }));
  else process.stdout.write(`${texto}\n`);
}, atraso);
if (a.includes("--pendurar")) setInterval(() => undefined, 1_000);
