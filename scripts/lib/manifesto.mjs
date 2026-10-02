// Manifesto de atualização e assinatura Ed25519 destacada (Fase 21, T-21.28, D-343, D-348).
// Gera o manifesto (esquema de src/nucleo/atualizador/manifesto.ts) a partir dos artefatos REAIS (sha512 em streaming + tamanho) e o assina com a chave
// privada vinda de VARIÁVEL DE AMBIENTE do CI (nome derivado de PRODUTO.prefixoEnv) ou de ARQUIVO fora do repositório.
// A chave privada jamais é impressa, jamais entra em mensagem de erro e jamais é gravada (nem em dist-app/).
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_PADRAO = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const PREFIXO_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const PREFIXO_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
export const VALIDADE_PADRAO_DIAS = 30;

/** Nome da variável da chave privada: `<ID EM MAIÚSCULAS>_MANIFESTO_CHAVE_PRIVADA`, derivado de src/nucleo/produto.ts (D-01). */
export function nomeDaVariavelDaChave(raiz = RAIZ_PADRAO) {
  const m = /^const ID = "([^"]+)";/m.exec(readFileSync(join(raiz, "src/nucleo/produto.ts"), "utf8"));
  if (m === null) throw new Error("produto.ts: ID não encontrado");
  return `${m[1].toUpperCase()}_MANIFESTO_CHAVE_PRIVADA`;
}

export async function sha512Arquivo(caminho) {
  const h = createHash("sha512");
  for await (const p of createReadStream(caminho)) h.update(p);
  return h.digest("hex");
}

/**
 * @param {{ versao: string, canal: "stable"|"beta", artefatos: Array<{ plataforma: string, arquitetura: string, arquivo: string, url_relativa: string }>,
 *   notas?: string, staging?: number, validoAteDias?: number, agora?: Date, versaoMinima?: string, chavesRevogadas?: string[] }} e
 */
export async function montarManifesto(e) {
  const agora = e.agora ?? new Date();
  const dias = e.validoAteDias ?? VALIDADE_PADRAO_DIAS;
  const artefatos = [];
  for (const a of e.artefatos) {
    if (!existsSync(a.arquivo)) throw new Error(`artefato inexistente: ${basename(a.arquivo)}`);
    artefatos.push({ plataforma: a.plataforma, arquitetura: a.arquitetura, url_relativa: a.url_relativa, sha512: await sha512Arquivo(a.arquivo), tamanho: statSync(a.arquivo).size });
  }
  const m = {
    esquema: 1,
    versao: e.versao,
    canal: e.canal,
    publicado_em: agora.toISOString(),
    valido_ate: new Date(agora.getTime() + dias * 86_400_000).toISOString(),
    artefatos,
    notas: e.notas ?? "",
    staging: e.staging ?? 100,
  };
  if (e.versaoMinima !== undefined) m.versao_minima = e.versaoMinima;
  if (e.chavesRevogadas !== undefined && e.chavesRevogadas.length > 0) m.chaves_revogadas = e.chavesRevogadas;
  return m;
}

/** Aceita PEM PKCS#8 ou base64 de 32 bytes (semente) ou base64 de DER PKCS#8. Erros citam só a ORIGEM (nome da variável/arquivo), nunca o valor. */
export function lerChavePrivada(texto, origem) {
  const t = String(texto).trim();
  try {
    if (t.includes("BEGIN")) return createPrivateKey(t);
    const raw = Buffer.from(t, "base64");
    if (raw.length === 32) return createPrivateKey({ key: Buffer.concat([PREFIXO_PKCS8, raw]), format: "der", type: "pkcs8" });
    return createPrivateKey({ key: raw, format: "der", type: "pkcs8" });
  } catch {
    throw new Error(`chave privada de ${origem} inválida (use PEM PKCS#8 ou semente base64 de 32 bytes)`);
  }
}

/**
 * Procura a chave: variável de ambiente do CI primeiro, depois arquivo (`--chave`, FORA do repositório).
 * @returns {{ chave: import("node:crypto").KeyObject, origem: string } | null}
 */
export function carregarChave({ env = process.env, arquivo, raiz = RAIZ_PADRAO }) {
  const nome = nomeDaVariavelDaChave(raiz);
  const valor = env[nome];
  if (typeof valor === "string" && valor.trim() !== "") return { chave: lerChavePrivada(valor, `variável ${nome}`), origem: `variável ${nome}` };
  if (arquivo !== undefined) {
    const abs = resolve(arquivo);
    if (abs.startsWith(resolve(raiz) + "/") && !abs.startsWith(resolve(raiz, "node_modules"))) {
      throw new Error("a chave privada não pode ficar dentro do repositório (use caminho fora da árvore ou a variável do CI)");
    }
    if (!existsSync(abs)) throw new Error("arquivo da chave privada não encontrado");
    return { chave: lerChavePrivada(readFileSync(abs, "utf8"), "arquivo de chave"), origem: "arquivo de chave" };
  }
  return null;
}

export const publicaBase64 = (chave) => createPublicKey(chave).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

export const assinarBytes = (bytes, chave) => sign(null, bytes, chave).toString("base64");

/** Confere a própria assinatura com as chaves PÚBLICAS aceitas (a do build). */
export function verificarComPublicas(bytes, assinaturaB64, publicas) {
  const sig = Buffer.from(String(assinaturaB64).trim(), "base64");
  if (sig.length !== 64) return false;
  for (const b64 of publicas) {
    try {
      const k = createPublicKey({ key: Buffer.concat([PREFIXO_SPKI, Buffer.from(b64, "base64")]), format: "der", type: "spki" });
      if (verify(null, bytes, k, sig)) return true;
    } catch {
      /* chave malformada: ignora */
    }
  }
  return false;
}
