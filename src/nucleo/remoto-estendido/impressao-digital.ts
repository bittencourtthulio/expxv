// Impressão digital comparável a olho (T-22.11/T-22.17, AX-04/AX-11): SHA-256 do SPKI DER da identidade do host (ou do manifesto do PWA); os 16 primeiros bytes viram 32 hex, exibidos em
// grupos de 4. O PWA calcula a mesma coisa com WebCrypto (vetores cruzados em tests/vetores). Pura: sem relógio, sem I/O.
import { createHash } from "node:crypto";

export const IMPRESSAO_HEX = 32;
export const impressaoHex = (dados: Uint8Array): string => createHash("sha256").update(dados).digest("hex").slice(0, IMPRESSAO_HEX);
export const agruparImpressao = (hex: string): string => (hex.match(/.{1,4}/g) ?? []).join(" ");
/** «abcd 1234 …» da identidade do host. */
export const impressaoDaIdentidade = (spki: Uint8Array): string => agruparImpressao(impressaoHex(spki));
/** as duas formas aceitam o que o usuário digita: espaços, caixa alta e quebras de linha são ignorados. */
export const normalizarImpressao = (t: string): string => t.replace(/\s+/g, "").toLowerCase();
export const impressoesIguais = (a: string, b: string): boolean => {
  const x = normalizarImpressao(a);
  return x.length === IMPRESSAO_HEX && /^[0-9a-f]+$/.test(x) && x === normalizarImpressao(b);
};
/** hex do manifesto assinado do PWA (`manifesto-pwa.json`), calculado como o PWA o exibe. */
export const impressaoDoManifesto = (manifestoBytes: Uint8Array): string => impressaoHex(manifestoBytes);
