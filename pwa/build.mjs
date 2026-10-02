// Mini-build do PWA (T-22.13, D-368): sem dependência nova. Junta `cripto.js`, `padding.js` e `app.js` em UM `app.js` (SRI), monta `sw.js` (verificar.js + sw-fonte.js com as chaves pinadas),
// gera HTML com CSP/SRI, manifesto instalável e ícones PNG, e (com a chave privada) o manifesto assinado. O app Electron NÃO importa nada daqui; saída em `dist-pwa/` (fora do pacote).
// Uso: node pwa/build.mjs [--destino dist-pwa] [--versao N] [--chaves <pub1,pub2>]   (assinar: ver pwa/assinar.mjs; a privada vem de variável/arquivo FORA do repositório)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { ARQUIVOS_FORA_DO_MANIFESTO, assinarDist, carregarChavePrivada } from "./assinar.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..");
const ler = (n) => readFileSync(join(AQUI, n), "utf8");

/** Nome e id do produto vêm de `src/nucleo/produto.ts` (D-01): o PWA não carrega o nome literal. */
export function produtoDe(raiz = RAIZ) {
  const t = readFileSync(join(raiz, "src/nucleo/produto.ts"), "utf8");
  return { nome: /const NOME = "([^"]+)"/.exec(t)?.[1] ?? "App", id: /const ID = "([^"]+)"/.exec(t)?.[1] ?? "app" };
}

const sri = (b) => `sha384-${createHash("sha384").update(b).digest("base64")}`;
/** remove `export `, imports e comentários de linha inteira; sem minificação perigosa (nenhum literal de várias linhas no código). */
export function simplificar(codigo) {
  return codigo
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l) && !/^\s*import\s.*from\s/.test(l) && l.trim() !== "")
    .map((l) => l.replace(/^\s+/, "").replace(/^export\s+(async\s+function|function|const|let|class)\b/, "$1"))
    .join("\n");
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** ícone PNG sólido azul com um disco branco (sem biblioteca de imagem). */
export function gerarPng(tam) {
  const linhas = Buffer.alloc((tam * 3 + 1) * tam);
  for (let y = 0; y < tam; y++) {
    linhas[y * (tam * 3 + 1)] = 0;
    for (let x = 0; x < tam; x++) {
      const dentro = (x - tam / 2) ** 2 + (y - tam / 2) ** 2 < (tam * 0.28) ** 2;
      const o = y * (tam * 3 + 1) + 1 + x * 3;
      [linhas[o], linhas[o + 1], linhas[o + 2]] = dentro ? [255, 255, 255] : [0x25, 0x63, 0xeb];
    }
  }
  const bloco = (tipo, dados) => {
    const t = Buffer.concat([Buffer.from(tipo), dados]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(linhas, { level: 9 })), bloco("IEND", Buffer.alloc(0))]);
}

export function csp({ connect = "wss:" } = {}) {
  return ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "manifest-src 'self'", `connect-src 'self' ${connect}`, "worker-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "require-trusted-types-for 'script'"].join("; ");
}

export function construir({ destino, versao = 1, chavesPublicas = [], produto = produtoDe(), connect = "wss:", privadaPem = null } = {}) {
  if (typeof destino !== "string" || destino.length === 0) throw new Error("destino obrigatório");
  const dest = resolve(destino);
  if (existsSync(join(dest, "package.json")) || dest === RAIZ || RAIZ.startsWith(dest + "/")) throw new Error("destino perigoso");
  if (!Number.isSafeInteger(versao) || versao < 1) throw new Error("versao inválida");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, "icones"), { recursive: true });
  const escrever = (n, c) => writeFileSync(join(dest, n), c);

  const appJs = `(()=>{"use strict";\n${["cripto.js", "padding.js", "trava.js", "protocolo-cliente.js", "ui.js", "app.js"].map((n) => simplificar(ler(n))).join("\n")}\n})();\n`.replaceAll("__PRODUTO_ID__", produto.id);
  const css = ler("app.css");
  escrever("app.js", appJs);
  escrever("app.css", css);
  const cabecalho = csp({ connect });
  escrever("index.html", ler("index.html").replace("{{CSP}}", cabecalho).replace("{{SRI_CSS}}", sri(css)).replace("{{SRI_JS}}", sri(appJs)).replaceAll("{{NOME}}", produto.nome));
  escrever("manifest.webmanifest", ler("manifest.webmanifest").replaceAll("{{NOME}}", produto.nome));
  const sw = `${simplificar(ler("verificar.js"))}\n${simplificar(ler("sw-fonte.js"))}\n`.replace("__CHAVES__", JSON.stringify(chavesPublicas)).replace("__SW_VERSAO__", String(versao)).replace("__CSP__", JSON.stringify(cabecalho));
  escrever("sw.js", sw);
  escrever("icones/icone-192.png", gerarPng(192));
  escrever("icones/icone-512.png", gerarPng(512));
  escrever(
    "cabecalhos.txt",
    `# cabeçalhos que o host ESTÁTICO do PWA deve enviar (o <meta> do HTML é só reserva; frame-ancestors só vale por cabeçalho)\n/*\n  Content-Security-Policy: ${cabecalho}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(self), microphone=(), geolocation=()\n  Cross-Origin-Opener-Policy: same-origin\n/sw.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: /\n`,
  );
  let assinado = false;
  if (privadaPem !== null) {
    assinarDist(dest, versao, privadaPem);
    assinado = true;
  }
  const impressao = assinado ? createHash("sha256").update(readFileSync(join(dest, "manifesto-pwa.json"))).digest("hex").slice(0, 32) : null;
  return { destino: dest, versao, assinado, arquivos: readdirSync(dest), impressao };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
  const prefixo = `${produtoDe().id.toUpperCase()}_PWA_CHAVE_PRIVADA`;
  let privadaPem = null;
  try {
    privadaPem = carregarChavePrivada(prefixo);
  } catch {
    console.warn(`sem ${prefixo}: o build sai SEM assinatura (o Service Worker vai recusar esta saída)`);
  }
  const r = construir({ destino: arg("--destino", "dist-pwa"), versao: Number(arg("--versao", "1")), chavesPublicas: arg("--chaves", "").split(",").filter(Boolean), privadaPem });
  console.log(`PWA construído em ${r.destino} (versão ${r.versao}, ${r.assinado ? "assinado" : "NÃO assinado"})`);
  if (r.impressao !== null) console.log(`impressão digital do manifesto (compare com o app no celular): ${(r.impressao.match(/.{4}/g) ?? []).join(" ")}`);
}
export { ARQUIVOS_FORA_DO_MANIFESTO };
