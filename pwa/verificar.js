// Verificação do manifesto assinado do PWA (T-22.16, D-352). JavaScript puro, SÓ WebCrypto (Ed25519 + SHA-256): roda igual no Service Worker, no navegador e no Node 22 (testes).
// Regras: a assinatura é conferida sobre os BYTES EXATOS do manifesto, só com chaves PINADAS (a atual e a próxima, embutidas no sw.js do build); só depois disso o JSON é lido.
// Atualização só se `versao` for MAIOR que a instalada (sem rollback); cada arquivo tem de bater por tamanho e SHA-256; arquivo fora do manifesto não existe.
export const MANIFESTO_MAX = 64 * 1024;
export const ARQUIVOS_MAX = 64;
export const CAMINHO_OK = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function b64ParaBytes(s) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
export function bytesParaHex(buf) {
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256Hex(bytes) {
  return bytesParaHex(await crypto.subtle.digest("SHA-256", bytes));
}
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** base64 CANÔNICO: reencodar os bytes decodificados tem de devolver o texto (sem bits de preenchimento a mais). */
function bytesParaB64(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/** `true` só se alguma chave pinada (Ed25519 bruta, base64, 32 bytes) assinar EXATAMENTE `bytes`. Nunca lança. */
export async function assinaturaValida(bytes, assinaturaB64, chavesB64) {
  try {
    if (typeof assinaturaB64 !== "string" || !B64.test(assinaturaB64) || assinaturaB64.length > 100) return false;
    const sig = b64ParaBytes(assinaturaB64);
    if (sig.length !== 64 || bytesParaB64(sig) !== assinaturaB64) return false; // F-6: a mesma assinatura não pode ter duas grafias
    for (const c of chavesB64) {
      try {
        const k = await crypto.subtle.importKey("raw", b64ParaBytes(c), { name: "Ed25519" }, false, ["verify"]);
        if (await crypto.subtle.verify({ name: "Ed25519" }, k, sig, bytes)) return true;
      } catch {
        /* chave ruim: tenta a próxima */
      }
    }
  } catch {
    /* formato inválido */
  }
  return false;
}

/** Valida a estrutura do manifesto já autenticado. */
export function lerManifesto(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MANIFESTO_MAX) return null;
  let m;
  try {
    m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null || Array.isArray(m)) return null;
  if (Object.keys(m).sort().join(",") !== "arquivos,versao") return null;
  if (!Number.isSafeInteger(m.versao) || m.versao < 1) return null;
  const a = m.arquivos;
  if (typeof a !== "object" || a === null || Array.isArray(a)) return null;
  const nomes = Object.keys(a);
  if (nomes.length === 0 || nomes.length > ARQUIVOS_MAX || !nomes.includes("index.html")) return null;
  for (const n of nomes) {
    const e = a[n];
    if (!CAMINHO_OK.test(n) || n.length > 100 || n.split("/").includes("..") || n.split("/").includes(".")) return null;
    if (typeof e !== "object" || e === null || Object.keys(e).sort().join(",") !== "sha256,tamanho") return null;
    if (typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256) || !Number.isSafeInteger(e.tamanho) || e.tamanho < 0 || e.tamanho > 4 * 1024 * 1024) return null;
  }
  return { versao: m.versao, arquivos: a };
}

/** Manifesto + assinatura + versão instalada -> `{ok, manifesto}` ou `{ok:false, motivo}`. `versaoInstalada` 0 = primeira instalação. */
export async function verificarManifesto({ manifestoBytes, assinaturaB64, chaves, versaoInstalada }) {
  if (!(await assinaturaValida(manifestoBytes, assinaturaB64, chaves))) return { ok: false, motivo: "assinatura" };
  const m = lerManifesto(manifestoBytes);
  if (m === null) return { ok: false, motivo: "formato" };
  if (!(m.versao > versaoInstalada)) return { ok: false, motivo: "versao" };
  return { ok: true, manifesto: m };
}
export async function arquivoConfere(bytes, entrada) {
  return bytes.length === entrada.tamanho && (await sha256Hex(bytes)) === entrada.sha256;
}

/**
 * Baixa e confere o shell inteiro. `buscar(caminho)` devolve `Uint8Array | null` (a origem pode ser hostil). Tudo ou nada: qualquer divergência recusa e quem chamou
 * mantém o shell anterior. Devolve os arquivos já conferidos.
 */
export async function baixarEVerificarShell({ buscar, chaves, versaoInstalada }) {
  const mb = await buscar("manifesto-pwa.json");
  const sb = await buscar("manifesto-pwa.sig");
  if (mb === null || sb === null) return { ok: false, motivo: "indisponivel" };
  let assinatura;
  try {
    assinatura = new TextDecoder().decode(sb).trim();
  } catch {
    return { ok: false, motivo: "formato" };
  }
  const v = await verificarManifesto({ manifestoBytes: mb, assinaturaB64: assinatura, chaves, versaoInstalada });
  if (!v.ok) return v;
  const arquivos = new Map();
  for (const [nome, entrada] of Object.entries(v.manifesto.arquivos)) {
    const bytes = await buscar(nome);
    if (bytes === null || !(await arquivoConfere(bytes, entrada))) return { ok: false, motivo: "arquivo" };
    arquivos.set(nome, bytes);
  }
  return { ok: true, versao: v.manifesto.versao, arquivos, manifestoBytes: mb, assinatura };
}
