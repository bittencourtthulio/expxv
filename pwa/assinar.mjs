// Manifesto assinado do PWA, lado do BUILD (T-22.16). Ed25519 por `node:crypto`; a chave privada vem de variável de ambiente ou de arquivo FORA do repositório e NUNCA é gravada em `dist-pwa/`
// nem impressa. Só a chave pública (bruta, base64) vai embutida no Service Worker. Para gerar o par: `node pwa/assinar.mjs gerar <arquivo-privada.pem>` (imprime só a pública).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const ARQUIVOS_FORA_DO_MANIFESTO = new Set(["manifesto-pwa.json", "manifesto-pwa.sig", "cabecalhos.txt"]);

export function gerarParChaves() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  return { publicaB64: Buffer.from(spki.subarray(spki.length - 32)).toString("base64"), privadaPem: privateKey.export({ type: "pkcs8", format: "pem" }) };
}
export function publicaBrutaDe(privadaPem) {
  const spki = createPublicKey(createPrivateKey(privadaPem)).export({ type: "spki", format: "der" });
  return Buffer.from(spki.subarray(spki.length - 32)).toString("base64");
}
function listar(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const c = join(dir, n);
    return statSync(c).isDirectory() ? listar(c, base) : [relative(base, c).split(sep).join("/")];
  });
}
/** Manifesto determinístico (chaves ordenadas): `arquivo -> {sha256, tamanho}` + `versao`. */
export function gerarManifesto(dir, versao) {
  const arquivos = {};
  for (const nome of listar(dir).sort()) {
    if (ARQUIVOS_FORA_DO_MANIFESTO.has(nome)) continue;
    const b = readFileSync(join(dir, nome));
    arquivos[nome] = { sha256: createHash("sha256").update(b).digest("hex"), tamanho: b.length };
  }
  return JSON.stringify({ arquivos: Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, { sha256: v.sha256, tamanho: v.tamanho }])), versao });
}
export function assinarManifesto(manifestoTexto, privadaPem) {
  return sign(null, Buffer.from(manifestoTexto, "utf8"), createPrivateKey(privadaPem)).toString("base64");
}
/** Lê a chave privada de `nomeVariavel` (PEM) ou, se definida, de `<nomeVariavel>_ARQUIVO`. Nunca devolve nem imprime o caminho em erro. */
export function carregarChavePrivada(nomeVariavel, env = process.env) {
  const pem = env[nomeVariavel];
  if (typeof pem === "string" && pem.includes("PRIVATE KEY")) return pem.replace(/\\n/g, "\n");
  const arq = env[`${nomeVariavel}_ARQUIVO`];
  if (typeof arq === "string" && arq.length > 0) return readFileSync(arq, "utf8");
  throw new Error(`defina ${nomeVariavel} (PEM) ou ${nomeVariavel}_ARQUIVO (caminho FORA do repositório)`);
}
/** Grava manifesto + assinatura em `dist`. A privada não é gravada. */
export function assinarDist(dist, versao, privadaPem) {
  const texto = gerarManifesto(dist, versao);
  writeFileSync(join(dist, "manifesto-pwa.json"), texto);
  writeFileSync(join(dist, "manifesto-pwa.sig"), assinarManifesto(texto, privadaPem));
  return { versao, publicaB64: publicaBrutaDe(privadaPem) };
}

if (process.argv[1] && process.argv[1].endsWith("assinar.mjs") && process.argv[2] === "gerar") {
  const alvo = process.argv[3];
  if (!alvo || alvo.startsWith("-")) throw new Error("uso: node pwa/assinar.mjs gerar <arquivo-privada.pem>  (grave FORA do repositório)");
  const par = gerarParChaves();
  writeFileSync(alvo, par.privadaPem, { mode: 0o600 });
  console.log(`chave pública (cole em --chaves ao construir): ${par.publicaB64}`);
}
