// Pós-processamento do texto ditado (Fase 11, T-11.08): dicionário técnico (substituição determinística, case-aware, ordem estável) e SANITIZAÇÃO para o PTY.
// O texto de fala é dado não confiável: nunca pode virar sequência de controle nem Enter no terminal. Puro.
import { LIMITES_VOZ, type TermoVoz } from "../../compartilhado/captura";

const FORA_DE_PALAVRA = "[\\p{L}\\p{N}_]";
const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Termos ordenados do mais longo para o mais curto, depois alfabético: resultado estável e sem que um termo curto "coma" um longo. */
export function ordenarTermos(termos: readonly TermoVoz[]): TermoVoz[] {
  return [...termos].sort((a, b) => b.termo.length - a.termo.length || (a.termo < b.termo ? -1 : a.termo > b.termo ? 1 : 0));
}

/** Troca cada ocorrência (sem diferenciar maiúsculas, em fronteira de palavra) pela grafia exata do dicionário. `config.json` e `Supabase` sobrevivem. */
export function aplicarDicionario(texto: string, termos: readonly TermoVoz[]): string {
  let t = texto;
  for (const { termo } of ordenarTermos(termos)) {
    if (termo.trim() === "") continue;
    const re = new RegExp(`(?<!${FORA_DE_PALAVRA})${escapar(termo)}(?!${FORA_DE_PALAVRA})`, "giu");
    t = t.replace(re, () => termo);
  }
  return t;
}

/** Dica enviada ao motor (`prompt` do STT): só os termos, com teto, para o reconhecimento acertar a grafia. */
export function promptDoMotor(termos: readonly TermoVoz[], maxChars = 800): string {
  let saida = "";
  for (const { termo, dica } of ordenarTermos(termos)) {
    const parte = dica !== null && dica !== "" ? `${termo} (${dica})` : termo;
    const proximo = saida === "" ? parte : `${saida}, ${parte}`;
    if (proximo.length > maxChars) break;
    saida = proximo;
  }
  return saida;
}

// CSI (ESC [ … final), OSC (ESC ] … BEL|ST), DCS/APC/PM/SOS (ESC P|_|^|X … ST) e escapes de dois bytes.
const SEQ_ESC = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b[\]P_^X][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]/g;
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const QUEBRAS_E_TAB = /[\r\n\t\u2028\u2029]+/g;
const BIDI_E_INVISIVEIS = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Texto seguro para escrever no PTY: sem ESC/controles, quebras viram espaço, espaços colapsados, ≤ 4 000 caracteres, nunca termina em CR/LF. */
export function sanitizarParaPty(texto: string, max: number = LIMITES_VOZ.texto_max): string {
  const limpo = texto
    .replace(SEQ_ESC, " ")
    .replace(QUEBRAS_E_TAB, " ")
    .replace(CONTROLES, "")
    .replace(BIDI_E_INVISIVEIS, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return limpo.length > max ? limpo.slice(0, max).trimEnd() : limpo;
}

/** Fala seguinte vira "A B" (um espaço entre falas consecutivas). */
export function juntarFalas(anterior: string, nova: string): string {
  const a = anterior.trim();
  const n = nova.trim();
  return a === "" ? n : n === "" ? a : `${a} ${n}`;
}

export function contarPalavras(texto: string): number {
  const t = texto.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

/** Texto final: dicionário + sanitização. É o único caminho do texto até o PTY. */
export function prepararTextoDitado(bruto: string, termos: readonly TermoVoz[]): string {
  return sanitizarParaPty(aplicarDicionario(sanitizarParaPty(bruto), termos));
}
