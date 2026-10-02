#!/usr/bin/env node
// `npm run test:pacote`: abre o app empacotado (dist-app/) e prova que (1) node-pty empacotado funciona
// (spawn, eco, resize, SIGINT) com o executável do app em modo Node, (2) o servidor MCP (worker thread),
// o gancho.mjs, os prompts e o worker do método funcionam fora do asar e (3) a janela abre (modo smoke).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { conferirFontesLocais, listarAsar, localizarPacote, maioresDoAsar, pesoMorto, smokeOk, tamanhoDaPasta } from "./lib/pacote.mjs";

/** Teto do app descompactado (Electron 37 sozinho passa de 200 MB); estourar indica peso morto novo. */
const LIMITE_APP_MB = 400;
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(raiz, "scripts", "fixtures", "cli-pty.mjs");
const pacote = localizarPacote(raiz);
if (pacote === null) {
  console.error("pacote não encontrado em dist-app/ (rode `npm run dist:dir`)");
  process.exit(1);
}
const { executavel, recursos } = pacote;
const asar = join(recursos, "app.asar");
const modulo = join(asar, "node_modules", "node-pty");
const addon = process.platform === "darwin" ? join("prebuilds", `darwin-${process.arch}`, "pty.node") : join("prebuilds", `win32-${process.arch}`, "pty.node");
const desempacotado = join(recursos, "app.asar.unpacked", "node_modules", "node-pty");
for (const c of [executavel, asar, fixture, join(desempacotado, addon)]) {
  if (!existsSync(c)) {
    console.error(`recurso ausente no pacote: ${c}`);
    process.exit(1);
  }
}

const codigo = String.raw`
const pty = require(process.argv[1]);
const t = pty.spawn(process.argv[2], [process.argv[3]], {
  name: "xterm-256color", cols: 90, rows: 28, cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
let saida = "", fase = 0;
t.onData((d) => {
  saida += d;
  if (fase === 0 && saida.includes("pty>")) { fase = 1; t.write("acao empacotada\r"); }
  else if (fase === 1 && saida.includes("eco:acao empacotada")) { fase = 2; t.resize(101, 32); setTimeout(() => t.write("tamanho\r"), 80); }
  else if (fase === 2 && saida.includes("tamanho:101x32")) { fase = 3; t.write("\x03"); }
});
t.onExit(({ exitCode }) => {
  const ok = exitCode === 0 && saida.includes("eco:acao empacotada") && saida.includes("tamanho:101x32") && saida.includes("interrompido");
  console.log(JSON.stringify({ ok, arquitetura: process.arch, exitCode }));
  process.exit(ok ? 0 : 1);
});
setTimeout(() => { console.error(JSON.stringify({ erro: "timeout", fase, saida })); t.kill(); process.exit(2); }, 10000);
`;

const pty = spawnSync(executavel, ["-e", codigo, modulo, executavel, fixture], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  timeout: 20_000,
  stdio: "inherit",
});
if (pty.status !== 0) {
  console.error("node-pty empacotado falhou");
  process.exit(1);
}
console.log("node-pty empacotado: spawn, eco, resize e SIGINT ok");

// servidor MCP em worker thread, gancho.mjs, prompts e worker do método empacotados (fora do asar)
const orquestracao = spawnSync(executavel, [join(raiz, "scripts", "fixtures", "pacote-orquestracao.cjs"), recursos], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  timeout: 60_000,
  encoding: "utf8",
});
if (orquestracao.status !== 0) {
  console.error(`orquestração empacotada falhou: ${orquestracao.stderr || orquestracao.stdout}`);
  process.exit(1);
}
console.log(`orquestração empacotada: ${orquestracao.stdout.trim()}`);

// daemon de PTY empacotado: sobe pelo lançador, cria sessão, sobrevive ao "app" e encerra a pedido
const daemon = spawnSync(executavel, [join(raiz, "scripts", "fixtures", "pacote-daemon.cjs"), recursos, fixture], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  timeout: 60_000,
  encoding: "utf8",
});
if (daemon.status !== 0) {
  console.error(`daemon empacotado falhou: ${daemon.stderr || daemon.stdout}`);
  process.exit(1);
}
console.log(`daemon de PTY empacotado: ${daemon.stdout.trim()}`);

// voz local (D-544): worker e addon nativo fora do asar, catálogo e amostras em Resources/voz, nenhum modelo no pacote, o addon carrega
const voz = spawnSync(executavel, [join(raiz, "scripts", "fixtures", "pacote-voz.cjs"), recursos], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  timeout: 60_000,
  encoding: "utf8",
});
if (voz.status !== 0) {
  console.error(`voz local empacotada falhou: ${voz.stderr || voz.stdout}`);
  process.exit(1);
}
console.log(`voz local empacotada: ${voz.stdout.trim()}`);

// conteúdo do asar: ícone da bandeja, fonte local, ausência de peso morto, tamanho e maiores itens
const arquivosAsar = listarAsar(asar);
const icone = arquivosAsar.find((a) => a.caminho === "/build/icone-32.png");
const assinaturaPng = icone ? createRequire(import.meta.url)("@electron/asar").extractFile(asar, "build/icone-32.png").subarray(0, 4) : Buffer.alloc(0);
if (!icone || icone.tamanho < 100 || !assinaturaPng.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
  console.error("ícone da bandeja (build/icone-32.png) ausente ou vazio no pacote");
  process.exit(1);
}
console.log(`ícone da bandeja presente (${icone.tamanho} bytes)`);
const fontes = conferirFontesLocais(asar, arquivosAsar);
if (fontes.erros.length > 0) {
  console.error(`fontes locais: ${fontes.erros.join("; ")}`);
  process.exit(1);
}
console.log(`fontes locais carregam do pacote: ${fontes.fontes.length} arquivos, nenhum recurso remoto`);
const morto = pesoMorto(arquivosAsar);
if (morto.length > 0) {
  console.error(`peso morto no app.asar (ajuste "files" em electron-builder.yml):\n  ${morto.join("\n  ")}`);
  process.exit(1);
}
const desempacotadoRaiz = join(recursos, "app.asar.unpacked");
const raizApp = process.platform === "darwin" ? join(recursos, "..", "..") : join(recursos, "..");
const tamanhoApp = tamanhoDaPasta(raizApp);
console.log(`tamanho do app descompactado: ${mb(tamanhoApp)} MB (teto ${LIMITE_APP_MB} MB); app.asar ${mb(statSync(asar).size)} MB + ${mb(tamanhoDaPasta(desempacotadoRaiz))} MB fora do asar`);
console.log("10 maiores itens dentro do app.asar:");
for (const a of maioresDoAsar(arquivosAsar, 10)) console.log(`  ${(a.tamanho / 1024).toFixed(0).padStart(6)} KB  ${a.caminho}`);
if (tamanhoApp > LIMITE_APP_MB * 1024 * 1024) {
  console.error(`app acima do teto de ${LIMITE_APP_MB} MB`);
  process.exit(1);
}

// janela: o main sai com 0 depois de ready-to-show quando <PREFIXO>SMOKE=1 (sem ELECTRON_RUN_AS_NODE)
const PREFIXO = JSON.parse(await import("node:fs").then((f) => f.readFileSync(join(raiz, "package.json"), "utf8"))).name.toUpperCase();
const env = { ...process.env, [`${PREFIXO}_SMOKE`]: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const smoke = spawnSync(executavel, [], { env, timeout: 30_000, stdio: "inherit" });
if (!smokeOk(smoke.status, smoke.signal)) {
  console.error(`smoke da janela falhou (código ${smoke.status}, sinal ${smoke.signal})`);
  process.exit(1);
}
console.log("janela aberta (ready-to-show) e app encerrado com código 0");
