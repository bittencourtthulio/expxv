// Conferência dos fuses do Electron NO BINÁRIO empacotado (Fase 21, T-21.07, D-344, AU-22). Sem dependência nova: `@electron/fuses` já vem com o electron-builder.
// `RunAsNode` permanece LIGADO em todos os perfis: o daemon de PTY, os hooks e o MCP rodam com ELECTRON_RUN_AS_NODE.
import { FUSES } from "./config-builder.mjs";

const ATIVO = 49; // '1'
const INATIVO = 48; // '0'
/** nome do builder (camelCase) → índice no fuse wire V1 */
const INDICE = { runAsNode: 0, enableCookieEncryption: 1, enableNodeOptionsEnvironmentVariable: 2, enableNodeCliInspectArguments: 3, enableEmbeddedAsarIntegrityValidation: 4, onlyLoadAppFromAsar: 5, loadBrowserProcessSpecificV8Snapshot: 6, grantFileProtocolExtraPrivileges: 7 };

/** O que cada perfil exige. `local`/`ci`/`com-atualizacao` só garantem o invariante (RunAsNode ligado). */
export function fusesEsperados(perfil) {
  if (perfil === "release") return { ...FUSES.release };
  if (perfil === "perf") return { ...FUSES.perf };
  return { runAsNode: true };
}

/** @param {Record<string|number, number|string>} fio resultado de getCurrentFuseWire */
export function conferirFuses(fio, perfil) {
  const esperados = fusesEsperados(perfil);
  const divergencias = [];
  for (const [nome, quer] of Object.entries(esperados)) {
    const atual = fio[INDICE[nome]];
    const esperado = quer ? ATIVO : INATIVO;
    if (atual !== esperado) divergencias.push({ fuse: nome, esperado: quer ? "ligado" : "desligado", atual: atual === ATIVO ? "ligado" : atual === INATIVO ? "desligado" : "ausente" });
  }
  return { ok: divergencias.length === 0, divergencias };
}

/** Lê o fuse wire do binário (.app no macOS ou executável) e confere contra o perfil. `ler` é injetável para teste. */
export async function verificarFuses(binario, perfil, ler) {
  const leitor = ler ?? (async (p) => (await import("@electron/fuses")).default?.getCurrentFuseWire?.(p) ?? (await import("@electron/fuses")).getCurrentFuseWire(p));
  const fio = await leitor(binario);
  return conferirFuses(fio, perfil);
}
