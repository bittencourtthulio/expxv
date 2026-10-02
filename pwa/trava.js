// Trava do PWA (T-22.15): autolock por inatividade (5 min) e PIN LOCAL opcional. O PIN não é enviado a ninguém: protege o USO do segredo de canal guardado no IndexedDB (cifrado com
// AES-GCM por chave PBKDF2-SHA256 derivada do PIN). Travar apaga o estado em memória (quem chama zera segredo, sessão e dados). Puro (sem DOM): roda no navegador e no Node 22.
import { aleatorio, deB64, paraB64 } from "./cripto.js";

export const AUTOLOCK_MS = 300000;
export const ITERACOES_PIN = 210000;
const AAD_PIN = "xv/pwa/segredo-de-canal/v1";
export const pinValido = (p) => typeof p === "string" && /^[0-9]{4,12}$/.test(p);

export function criarTrava({ ms = AUTOLOCK_MS, agendar, aoTravar }) {
  let cancelar = null;
  let ativa = false;
  const rearmar = () => {
    if (cancelar !== null) cancelar();
    cancelar = agendar(() => {
      cancelar = null;
      ativa = false;
      aoTravar();
    }, ms);
  };
  return {
    iniciar() {
      ativa = true;
      rearmar();
    },
    atividade() {
      if (ativa) rearmar();
    },
    parar() {
      ativa = false;
      if (cancelar !== null) cancelar();
      cancelar = null;
    },
    ativa: () => ativa,
  };
}

async function chaveDoPin(pin, sal, usos, iteracoes) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteracoes }, base, { name: "AES-GCM", length: 256 }, false, usos);
}
/** `{sal, iv, ct, it}` em base64; o PIN nunca é guardado. */
export async function cifrarComPin(pin, dados, iteracoes = ITERACOES_PIN) {
  const sal = aleatorio(16);
  const iv = aleatorio(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(AAD_PIN) }, await chaveDoPin(pin, sal, ["encrypt"], iteracoes), dados);
  return { sal: paraB64(sal), iv: paraB64(iv), ct: paraB64(new Uint8Array(ct)), it: iteracoes };
}
/** `null` = PIN incorreto ou registro adulterado. */
export async function decifrarComPin(pin, o) {
  try {
    if (typeof o !== "object" || o === null || !Number.isSafeInteger(o.it) || o.it < 1000 || o.it > 5000000) return null;
    const k = await chaveDoPin(pin, deB64(o.sal), ["decrypt"], o.it);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(o.iv), additionalData: new TextEncoder().encode(AAD_PIN) }, k, deB64(o.ct)));
  } catch {
    return null;
  }
}
