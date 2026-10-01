import type { VereditoTexto } from "../tipos";

const LINHA = /^[\s>*_`#-]*VEREDITO:\s*\**\s*(SIM|N[ÃA]O|APROVADO|REPROVADO)\b/i;

/**
 * Lê a linha `VEREDITO: ...` de 00-AUDITORIA.md (SIM/NÃO) e de QA.md (APROVADO/REPROVADO).
 * A linha precisa abrir a linha (menção no meio de frase não conta). Com várias, vale a última.
 */
export function extrairVeredito(texto: string): VereditoTexto | null {
  if (typeof texto !== "string") return null;
  let achado: VereditoTexto | null = null;
  for (const linha of texto.split(/\r?\n/)) {
    const m = LINHA.exec(linha);
    if (!m || m[1] === undefined) continue;
    const v = m[1].toUpperCase();
    achado = v === "SIM" ? "sim" : v === "APROVADO" ? "aprovado" : v === "REPROVADO" ? "reprovado" : "nao";
  }
  return achado;
}
