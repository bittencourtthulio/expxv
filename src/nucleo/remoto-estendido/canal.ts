// Canal do relay: identificador ROTATIVO e chaves de invólucro (T-22.06/T-22.09, D-355). `canal_id = HKDF-SHA256(segredo_de_canal, "id" ‖ época)`, 16 bytes em 32 hex, época DIÁRIA:
// o relay não consegue ligar o canal de hoje ao de ontem (nenhum identificador estável). O segredo de canal (32 bytes) é por dispositivo, vive no cofre do SO e só atravessa o relay
// por dentro do E2E. Espelho de `pwa/cripto.js` (`canalId`, `chaveEnvelope`): os vetores são conferidos nos dois lados.
import { hkdfSync, randomBytes } from "node:crypto";
import { LIMITES_RELAY } from "../../compartilhado/relay";

export const EPOCA_MS = LIMITES_RELAY.epoca_ms;
export const epocaDe = (ms: number): number => Math.floor(ms / EPOCA_MS);
export const novoSegredoDeCanal = (bytes: (n: number) => Buffer = randomBytes): Buffer => bytes(32);

const infoCanal = (epoca: number): Buffer => {
  const e = Buffer.alloc(8);
  e.writeBigUInt64BE(BigInt(epoca));
  return Buffer.concat([Buffer.from("xv/relay/canal/id"), e]);
};
export function canalId(segredo: Buffer, epoca: number): string {
  return Buffer.from(hkdfSync("sha256", segredo, Buffer.alloc(0), infoCanal(epoca), 16)).toString("hex");
}
/** ids a tentar, na ordem: época atual, anterior e próxima (tolerância de ±1 época para relógios diferentes entre host e celular). */
export function canaisCandidatos(segredo: Buffer, agoraMs: number): string[] {
  const e = epocaDe(agoraMs);
  return [e, e - 1, e + 1].map((x) => canalId(segredo, x));
}
/** chave AES-256 do invólucro; `rotulo` separa usos (ex.: "sessao", "pareamento"). */
export const chaveEnvelope = (segredo: Buffer, rotulo: string): Buffer => Buffer.from(hkdfSync("sha256", segredo, Buffer.alloc(0), Buffer.from(`xv/relay/envelope/${rotulo}`), 32));
