#!/usr/bin/env node
// `npm run dev`: tsc --watch (main) + vite build --watch (renderer) e (re)inicia o Electron quando
// dist/main muda (debounce 300 ms) e RECARREGA a janela quando dist/renderer muda (no main, recarga-dev.ts).
// Ctrl+C encerra tudo.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarDebounce, mudancaRelevante } from "./lib/debounce.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (nome) => join(raiz, "node_modules", ".bin", process.platform === "win32" ? `${nome}.cmd` : nome);
const log = (t) => process.stdout.write(`[dev] ${t}\n`);

const PRONTO = { main: /Watching for file changes/, renderer: /built in/ };
const prontos = new Set();
const filhos = [];
let electron = null;
let reiniciando = false;
let encerrando = false;

function vigiar(nome, comando, args) {
  const filho = spawn(comando, args, { cwd: raiz, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const prefixar = (dados) => {
    for (const linha of String(dados).split("\n")) {
      if (!linha.trim()) continue;
      process.stdout.write(`[${nome}] ${linha}\n`);
      if (!prontos.has(nome) && PRONTO[nome].test(linha)) {
        prontos.add(nome);
        if (prontos.size === Object.keys(PRONTO).length) aoFicarPronto();
      }
    }
  };
  filho.stdout.on("data", prefixar);
  filho.stderr.on("data", prefixar);
  filhos.push(filho);
}

function abrirElectron() {
  const binario = createRequire(join(raiz, "package.json"))("electron");
  // a variável DEV do produto (prefixo = nome do pacote em maiúsculas) liga a recarga do renderer no main
  const prefixo = `${String(createRequire(join(raiz, "package.json"))("./package.json").name).toUpperCase()}_`;
  electron = spawn(binario, ["."], { cwd: raiz, stdio: "inherit", env: { ...process.env, [`${prefixo}DEV`]: "1" } });
  electron.on("exit", (codigo) => {
    electron = null;
    if (reiniciando || encerrando) return;
    log(`app fechado (código ${codigo ?? "?"}); encerrando o modo dev`);
    encerrar(0);
  });
}

function reiniciarElectron() {
  log("dist/main mudou: reiniciando o app…");
  if (electron === null) return abrirElectron();
  reiniciando = true;
  const antigo = electron;
  const forcar = setTimeout(() => antigo.kill("SIGKILL"), 4000);
  antigo.once("exit", () => {
    clearTimeout(forcar);
    reiniciando = false;
    abrirElectron();
  });
  antigo.kill("SIGTERM");
}

function encerrar(codigo) {
  encerrando = true;
  for (const f of filhos) f.kill("SIGTERM");
  if (electron !== null) electron.kill("SIGTERM");
  process.exit(codigo);
}
process.on("SIGINT", () => encerrar(0));
process.on("SIGTERM", () => encerrar(0));

function aoFicarPronto() {
  abrirElectron();
  // só depois da primeira rodada: as gravações iniciais do compilador não reiniciam o app
  setTimeout(() => {
    const pasta = join(raiz, "dist", "main");
    if (!existsSync(pasta)) mkdirSync(pasta, { recursive: true });
    const reiniciar = criarDebounce(reiniciarElectron, 300);
    watch(pasta, { recursive: true }, (_e, arquivo) => {
      if (mudancaRelevante(arquivo)) reiniciar();
    });
  }, 1500);
  log("pronto. Salve um arquivo e veja a mudança; Ctrl+C encerra.");
}

vigiar("main", bin("tsc"), ["-p", "tsconfig.main.json", "--watch", "--preserveWatchOutput"]);
vigiar("renderer", bin("vite"), ["build", "--watch"]);
