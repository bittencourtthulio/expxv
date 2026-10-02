// Criptografia do PWA (T-22.14, D-356): ESPELHO exato do host (`src/nucleo/remoto/protocolo.ts`) em WebCrypto, sem biblioteca. ECDH P-256, HKDF-SHA256, HMAC-SHA256, AES-256-GCM, ECDSA P-256 (P1363).
// A chave de DISPOSITIVO nasce NÃO EXTRAÍVEL (`extractable:false`): `exportKey` falha, só se assina com ela. Tudo aqui é puro (sem DOM): roda no navegador e no Node 22, e os vetores são
// conferidos byte a byte contra `node:crypto` em `tests/pwa/cripto.test.ts`.
const enc = new TextEncoder();
const dec = new TextDecoder();
const sub = () => crypto.subtle;
const bytes = (x) => (typeof x === "string" ? enc.encode(x) : x instanceof Uint8Array ? x : new Uint8Array(x));

export function concat(...partes) {
  const bs = partes.map(bytes);
  const out = new Uint8Array(bs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bs) (out.set(b, o), (o += b.length));
  return out;
}
/** concatena com prefixo de comprimento de 4 bytes (igual ao `lp` do host). */
export function lp(...partes) {
  return concat(
    ...partes.map((p) => {
      const b = bytes(p);
      const t = new Uint8Array(4);
      new DataView(t.buffer).setUint32(0, b.length);
      return concat(t, b);
    }),
  );
}
export const paraB64 = (b) => {
  let s = "";
  for (const x of bytes(b)) s += String.fromCharCode(x);
  return btoa(s);
};
export const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const paraHex = (b) => Array.from(bytes(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const deHex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
export const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function sha256(...partes) {
  return new Uint8Array(await sub().digest("SHA-256", concat(...partes)));
}
export async function hkdf(ikm, salt, info, comprimento) {
  const k = await sub().importKey("raw", bytes(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await sub().deriveBits({ name: "HKDF", hash: "SHA-256", salt: bytes(salt), info: bytes(info) }, k, comprimento * 8));
}
export async function hmac(chave, dados) {
  const k = await sub().importKey("raw", bytes(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await sub().sign("HMAC", k, bytes(dados)));
}
export function iguais(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ------------------------------------------------------------------------------ ECDH efêmero
export async function parEfemero() {
  const par = await sub().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publica = new Uint8Array(await sub().exportKey("raw", par.publicKey));
  return {
    publica,
    async segredoCom(outraRaw) {
      try {
        const o = await sub().importKey("raw", bytes(outraRaw), { name: "ECDH", namedCurve: "P-256" }, false, []);
        return new Uint8Array(await sub().deriveBits({ name: "ECDH", public: o }, par.privateKey, 256));
      } catch {
        return null;
      }
    },
  };
}

// ------------------------------------------------------------------------------ pareamento
export const normalizarCodigo = (t) => t.trim().toUpperCase().replace(/[-\s]/g, "");
export async function derivarPareamento({ ecdh, codigo, epkC, spk, nonceC, nonceS }) {
  const transcricao = await sha256(lp("par-v1", epkC, spk, nonceC, nonceS));
  const ikm = concat(ecdh, await sha256("psk", normalizarCodigo(codigo)));
  const conf = await hkdf(ikm, transcricao, "xv/remoto/pareamento/conf", 32);
  const s = await hmac(conf, lp("sas", transcricao));
  const sas = String(new DataView(s.buffer, s.byteOffset).getUint32(0) % 1_000_000).padStart(6, "0");
  return { conf, sas, transcricao };
}
const macPar = (c, rotulo, ...extra) => hmac(c.conf, lp(rotulo, c.transcricao, ...extra));
export const confServidor = (c) => macPar(c, "srv");
export const confCliente = async (c, chavePublicaDispositivo, nome) => macPar(c, "cli", await sha256(chavePublicaDispositivo), nome);
export const macPareado = (c, dispositivoId, identidadeSpki) => macPar(c, "ok", dispositivoId, identidadeSpki);

// ------------------------------------------------------------------------------ sessão e canal
export const dadosAssinadosCliente = (dispositivoId, epk, nonceC, ts) => lp("sess-c-v1", dispositivoId, epk, nonceC, String(ts));
export const transcricaoSessao = (dispositivoId, epkC, spk, nonceC, nonceS, ts) => sha256(lp("sess-v1", dispositivoId, epkC, spk, nonceC, nonceS, String(ts)));
export async function derivarSessao(ecdh, transcricao) {
  const k = await hkdf(ecdh, transcricao, "xv/remoto/sessao", 64);
  return { c2s: k.subarray(0, 32), s2c: k.subarray(32, 64) };
}
const nonceDe = (n) => {
  const b = new Uint8Array(12);
  new DataView(b.buffer).setBigUint64(4, BigInt(n));
  return b;
};
const aesChave = (raw, usos) => sub().importKey("raw", bytes(raw), "AES-GCM", false, usos);
/** Canal AES-256-GCM com contador monotônico por direção e AAD `v1|sid|n` (igual ao host). `abrir` devolve `null` para quadro inválido: quem chamou FECHA a sessão. */
export function criarCanal({ sid, envio, recebimento }) {
  let nEnvio = 0;
  let ultimo = 0;
  const aad = (n) => enc.encode(`v1|${sid}|${n}`);
  let kEnvio = null;
  let kReceb = null;
  const chaveEnvio = () => (kEnvio ??= aesChave(envio, ["encrypt"]));
  const chaveReceb = () => (kReceb ??= aesChave(recebimento, ["decrypt"]));
  return {
    sid,
    async selar(mensagem) {
      const n = ++nEnvio;
      const ct = await sub().encrypt({ name: "AES-GCM", iv: nonceDe(n), additionalData: aad(n), tagLength: 128 }, await chaveEnvio(), enc.encode(JSON.stringify(mensagem)));
      return { v: 1, n, c: paraB64(new Uint8Array(ct)) };
    },
    async abrir(q) {
      if (typeof q !== "object" || q === null) return null;
      const { v, n, c } = q;
      if (v !== 1 || !Number.isSafeInteger(n) || n <= ultimo || typeof c !== "string" || c.length > 32768 * 2) return null;
      try {
        const buf = deB64(c);
        if (buf.length < 17) return null;
        const claro = await sub().decrypt({ name: "AES-GCM", iv: nonceDe(n), additionalData: aad(n), tagLength: 128 }, await chaveReceb(), buf);
        ultimo = n; // só avança com quadro AUTÊNTICO
        return JSON.parse(dec.decode(claro));
      } catch {
        return null;
      }
    },
    ultimoRecebido: () => ultimo,
  };
}

// ------------------------------------------------------------------------------ chave de dispositivo (NÃO extraível) e assinaturas
export async function gerarChaveDispositivo() {
  const par = await sub().generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { privada: par.privateKey, publicaSpki: new Uint8Array(await sub().exportKey("spki", par.publicKey)) };
}
export async function assinar(privada, dados) {
  return new Uint8Array(await sub().sign({ name: "ECDSA", hash: "SHA-256" }, privada, bytes(dados)));
}
export async function verificar(publicaSpki, dados, assinatura) {
  try {
    const k = await sub().importKey("spki", bytes(publicaSpki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await sub().verify({ name: "ECDSA", hash: "SHA-256" }, k, bytes(assinatura), bytes(dados));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------ canal do relay: id rotativo e invólucro
export const EPOCA_MS = 86_400_000;
export const epocaDe = (ms) => Math.floor(ms / EPOCA_MS);
const infoCanal = (epoca) => {
  const e = new Uint8Array(8);
  new DataView(e.buffer).setBigUint64(0, BigInt(epoca));
  return concat("xv/relay/canal/id", e);
};
/** `canal_id = HKDF(segredo_de_canal, "id" ‖ época)`: 16 bytes em 32 hex. Igual a `remoto-estendido/canal.ts`. */
export async function canalId(segredo, epoca) {
  return paraHex(await hkdf(segredo, new Uint8Array(0), infoCanal(epoca), 16));
}
export const chaveEnvelope = (segredo, rotulo) => hkdf(segredo, new Uint8Array(0), `xv/relay/envelope/${rotulo}`, 32);
/** nonce aleatório de 96 bits (12 B) ‖ ciphertext ‖ tag; AAD = `aad`. */
export async function selarEnvelope(chave, claro, aad) {
  const iv = aleatorio(12);
  const ct = await sub().encrypt({ name: "AES-GCM", iv, additionalData: bytes(aad), tagLength: 128 }, await aesChave(chave, ["encrypt"]), bytes(claro));
  return concat(iv, new Uint8Array(ct));
}
export async function abrirEnvelope(chave, selado, aad) {
  try {
    const b = bytes(selado);
    if (b.length < 12 + 16) return null;
    return new Uint8Array(await sub().decrypt({ name: "AES-GCM", iv: b.subarray(0, 12), additionalData: bytes(aad), tagLength: 128 }, await aesChave(chave, ["decrypt"]), b.subarray(12)));
  } catch {
    return null;
  }
}
