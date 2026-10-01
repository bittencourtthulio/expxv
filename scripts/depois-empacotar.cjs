// afterPack do electron-builder:
// 1. tira os prebuilds do node-pty que não servem à plataforma empacotada (win32-* no .app do mac,
//    darwin-* no instalador do Windows): peso morto, e o node-pty só carrega o da própria plataforma;
// 2. corrige o caminho do spawn-helper quando o node-pty é carregado de app.asar.unpacked (o daemon de PTY
//    roda o script FORA do asar): o node-pty troca "app.asar" por "app.asar.unpacked" sem olhar se o
//    caminho já é o desempacotado e produz ".unpacked.unpacked", e todo spawn falha (posix_spawnp);
// 3. garante o bit de execução do spawn-helper do node-pty (o npm pode instalá-lo sem +x quando os scripts
//    de instalação são ignorados; sem ele o spawn falha).
const { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

function recursosDe(contexto) {
  const { appOutDir, packager } = contexto;
  if (contexto.electronPlatformName === "darwin") {
    return join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources");
  }
  return join(appOutDir, "resources");
}

/** Prefixo dos prebuilds que pertencem a ESTA plataforma (`darwin-`, `win32-`). */
function prefixoDaPlataforma(plataforma) {
  if (plataforma === "darwin") return "darwin-";
  if (plataforma === "windows" || plataforma === "win32") return "win32-";
  return null;
}

exports.prefixoDaPlataforma = prefixoDaPlataforma;

const TROCA_ORIGINAL = "helperPath.replace('app.asar', 'app.asar.unpacked')";
const TROCA_CORRIGIDA = "helperPath.replace(/app\\.asar(?!\\.unpacked)/, 'app.asar.unpacked')";

/**
 * Torna idempotente a troca de caminho do node-pty em `lib/unixTerminal.js`. Devolve "corrigido" (acabou de
 * aplicar), "ja-corrigido" ou "ausente" (o node-pty mudou: quem chama deve falhar o empacotamento).
 */
function corrigirCaminhoDoHelper(pastaNodePty) {
  const arquivo = join(pastaNodePty, "lib", "unixTerminal.js");
  if (!existsSync(arquivo)) return "ausente";
  const texto = readFileSync(arquivo, "utf8");
  if (texto.includes(TROCA_CORRIGIDA)) return "ja-corrigido";
  if (!texto.includes(TROCA_ORIGINAL)) return "ausente";
  writeFileSync(arquivo, texto.replace(TROCA_ORIGINAL, TROCA_CORRIGIDA));
  return "corrigido";
}

exports.corrigirCaminhoDoHelper = corrigirCaminhoDoHelper;

exports.default = async function depoisDeEmpacotar(contexto) {
  const pastaNodePty = join(recursosDe(contexto), "app.asar.unpacked", "node_modules", "node-pty");
  const base = join(pastaNodePty, "prebuilds");
  if (!existsSync(base)) return;
  if (corrigirCaminhoDoHelper(pastaNodePty) === "ausente" && contexto.electronPlatformName === "darwin") {
    throw new Error("node-pty mudou: lib/unixTerminal.js não tem a troca de caminho esperada (revisar scripts/depois-empacotar.cjs)");
  }
  // Os "-temp" do build universal (um por arquitetura) ainda serão fundidos pelo @electron/universal, que lê o
  // cabeçalho do asar e exige que todo arquivo desempacotado listado exista: só se poda no resultado final.
  const temporario = /-temp$/.test(contexto.appOutDir);
  const meu = temporario ? null : prefixoDaPlataforma(contexto.electronPlatformName);
  for (const pasta of readdirSync(base)) {
    if (meu !== null && !pasta.startsWith(meu)) {
      rmSync(join(base, pasta), { recursive: true, force: true });
      continue;
    }
    const helper = join(base, pasta, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
};
