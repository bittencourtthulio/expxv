// Porta de tecla global e validação de atalho (Fase 11, T-11.11). `globalShortcut` do Electron não detecta key-up nem modificador isolado: só serve ao modo ALTERNAR
// (D-61); segurar-para-falar usa keydown/keyup do documento. O adaptador `nativo` (hook de teclado do SO) responde `indisponivel` até a pendência P-35.
export interface TeclaGlobal {
  /** registra; `false` se o atalho já está em uso por outro app. */
  registrar(acelerador: string, aoAcionar: () => void): boolean;
  liberar(acelerador: string): void;
  liberarTodas(): void;
}

export type ResultadoAtalho = { ok: true; acelerador: string } | { ok: false; motivo: string };

const MODIFICADORES = new Set(["command", "cmd", "control", "ctrl", "commandorcontrol", "cmdorctrl", "alt", "option", "altgr", "shift", "super", "meta"]);
const TECLAS_NOMEADAS = /^(?:space|tab|enter|return|escape|esc|backspace|delete|insert|home|end|pageup|pagedown|up|down|left|right|f(?:[1-9]|1\d|2[0-4]))$/i;

export interface OpcoesAtalho {
  plataforma: "mac" | "windows" | "linux";
  /** atalhos que o app/menu já usa (comparados sem diferenciar maiúsculas). */
  reservados?: readonly string[];
}

const canonico = (a: string): string => a.split("+").map((p) => p.trim().toLowerCase()).map((p) => (p === "cmdorctrl" ? "commandorcontrol" : p === "cmd" ? "command" : p === "ctrl" ? "control" : p === "option" ? "alt" : p)).sort().join("+");

/** Atalho aceito: pelo menos um modificador + uma tecla real; modificador isolado (ex.: Option direita) NÃO vale; no Windows/Linux `Ctrl+letra` é do processo (D-37): exige Shift ou Alt. */
export function validarAtalho(bruto: string, op: OpcoesAtalho): ResultadoAtalho {
  const partes = bruto.split("+").map((p) => p.trim()).filter((p) => p !== "");
  if (partes.length < 2 || partes.length > 4) return { ok: false, motivo: "Use um modificador mais uma tecla (ex.: Cmd+Shift+Espaço). Modificador sozinho não é aceito." };
  const mods = partes.slice(0, -1);
  const tecla = partes[partes.length - 1] as string;
  if (!mods.every((m) => MODIFICADORES.has(m.toLowerCase()))) return { ok: false, motivo: "Combinação inválida: só modificadores antes da última tecla." };
  if (MODIFICADORES.has(tecla.toLowerCase())) return { ok: false, motivo: "Falta a tecla: modificador isolado não é aceito (o sistema não informa quando ele é solto)." };
  if (!(tecla.length === 1 && /[A-Za-z0-9]/.test(tecla)) && !TECLAS_NOMEADAS.test(tecla)) return { ok: false, motivo: "Tecla não suportada." };
  if (new Set(mods.map((m) => m.toLowerCase())).size !== mods.length) return { ok: false, motivo: "Modificador repetido." };
  const baixos = mods.map((m) => m.toLowerCase());
  if (op.plataforma !== "mac") {
    const soCtrl = baixos.every((m) => m === "control" || m === "ctrl" || m === "commandorcontrol" || m === "cmdorctrl");
    if (soCtrl) return { ok: false, motivo: "No Windows e no Linux use Ctrl+Shift+tecla: Ctrl+letra pertence ao programa do terminal." };
  }
  const c = canonico(partes.join("+"));
  if ((op.reservados ?? []).some((r) => canonico(r) === c)) return { ok: false, motivo: "Esse atalho já é usado por outra função do app." };
  return { ok: true, acelerador: partes.join("+") };
}

/** Adaptador do hook nativo de teclado: indisponível até P-35 (módulo nativo + Input Monitoring). */
export const teclaNativaIndisponivel: TeclaGlobal & { readonly disponivel: false } = {
  disponivel: false,
  registrar: () => false,
  liberar: () => undefined,
  liberarTodas: () => undefined,
};
