// PIN de aprovação opcional (T-20.30): só o HASH `scrypt` (node:crypto) vai ao banco; o PIN em claro nunca é guardado, logado nem auditado.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const TAM = 32;

const derivar = (pin: string, sal: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(pin, sal, TAM, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, k) => (e === null ? resolve(k) : reject(e))));

export const PIN_VALIDO = /^[A-Za-z0-9]{4,16}$/;

export async function hashPin(pin: string): Promise<string> {
  if (!PIN_VALIDO.test(pin)) throw new Error("pin_invalido");
  const sal = randomBytes(16);
  return `scrypt$${N}$${sal.toString("base64url")}$${(await derivar(pin, sal)).toString("base64url")}`;
}

export async function verificarPin(hash: string, pin: string): Promise<boolean> {
  const p = hash.split("$");
  if (p.length !== 4 || p[0] !== "scrypt" || !PIN_VALIDO.test(pin)) return false;
  try {
    const esperado = Buffer.from(p[3] as string, "base64url");
    const obtido = await derivar(pin, Buffer.from(p[2] as string, "base64url"));
    return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
  } catch {
    return false;
  }
}
