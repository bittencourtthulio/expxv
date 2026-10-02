// Detecção de URL/porta na saída do processo. SÓ loopback (localhost, 127.x, ::1, 0.0.0.0, [::]), SÓ http/https, sem credenciais.
// A saída é do processo do usuário e pode conter qualquer coisa: URL externa nunca vira botão.
import { LIMITES_EXECUTAR } from "./modelo";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
export const semAnsi = (t: string): string => t.replace(ANSI, "");

const URL_LOCAL = /\bhttps?:\/\/(?:[^\s/@:]+(?::[^\s/@]*)?@)?(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|\[::\])(?![A-Za-z0-9_-]|\.[A-Za-z0-9])(?::(\d{1,5}))?(\/[^\s"'<>)\]]*)?/gi;
const PORTA_TEXTO = /\b(?:listening|running|started|serving|ready|available|escutando|rodando)\b[^\n]{0,60}?\bports?\b\s*[:=]?\s*(\d{2,5})\b/i;
const ENDERECO_NU = /(?<![@\w./-])(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/;

export interface DeteccaoLocal { porta: number; url: string }

function urlSegura(m: RegExpExecArray): DeteccaoLocal | null {
  const texto = m[0];
  let u: URL;
  try { u = new URL(texto); } catch { return null; }
  if (u.username !== "" || u.password !== "") return null; // credencial na URL: nunca
  const porta = m[2] === undefined ? (u.protocol === "https:" ? 443 : 80) : Number(m[2]);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65_535) return null;
  const host = /^(0\.0\.0\.0|\[::\])$/.test(m[1]!) ? "localhost" : m[1]!;
  const caminho = (m[3] ?? "/").replace(/[.,;:!?]+$/, "");
  return { porta, url: `${u.protocol}//${host}${m[2] === undefined ? "" : `:${porta}`}${caminho}` };
}

/** Primeira URL/porta local no texto (já sem ANSI). Prefere URL completa; cai para "port N" e `localhost:N`. */
export function detectarLocal(texto: string): DeteccaoLocal | null {
  const limpo = semAnsi(texto);
  URL_LOCAL.lastIndex = 0;
  for (let m = URL_LOCAL.exec(limpo); m !== null; m = URL_LOCAL.exec(limpo)) {
    const r = urlSegura(m);
    if (r !== null) return r;
  }
  const p = PORTA_TEXTO.exec(limpo) ?? ENDERECO_NU.exec(limpo);
  if (p !== null) {
    const porta = Number(p[1]);
    if (porta >= 1 && porta <= 65_535) return { porta, url: `http://localhost:${porta}/` };
  }
  return null;
}

/**
 * Varredor incremental: junta uma cauda curta entre pedaços (URL partida em dois) e para de varrer depois de achar a primeira
 * ou ao passar do teto de bytes (saída infinita não custa CPU nem memória).
 */
export function criarVarredor(teto = LIMITES_EXECUTAR.saida_varrida_bytes): { alimentar(pedaco: string): DeteccaoLocal | null; encerrado(): boolean } {
  let cauda = "";
  let varridos = 0;
  let achou = false;
  return {
    alimentar(pedaco) {
      if (achou || varridos >= teto) return null;
      varridos += pedaco.length;
      const janela = cauda + pedaco.slice(0, 64 * 1024);
      cauda = janela.slice(-LIMITES_EXECUTAR.cauda_chars);
      const r = detectarLocal(janela);
      if (r !== null) achou = true;
      return r;
    },
    encerrado: () => achou || varridos >= teto,
  };
}

/** URL aberta pelo botão: http/https, loopback, sem credenciais (revalida antes de `shell.openExternal`). */
export function urlAbrivel(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username !== "" || u.password !== "") return false;
  return /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(u.hostname);
}
