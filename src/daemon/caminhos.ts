import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUTO } from "../nucleo/produto";
import { PROTOCOLO_DAEMON } from "./protocolo";

export interface CaminhosDaemon {
  /** Metadados e histórico das sessões, dentro da pasta de dados do app (uma pasta por versão do protocolo). */
  dir: string;
  socket: string;
  arquivo_token: string;
}

/**
 * O socket Unix tem limite de ~100 caracteres, então fica numa pasta curta e privada do tmp, com nome
 * derivado da pasta de dados (build de desenvolvimento e instalado não se enxergam) e da versão do
 * protocolo (daemon de outra versão nunca é reaproveitado: cada versão sobe o seu). No Windows é um
 * named pipe. O prefixo vem de PRODUTO: dois apps lado a lado não colidem.
 */
export function caminhosDoDaemon(
  dadosApp: string,
  plataforma: NodeJS.Platform = process.platform,
  uid: number | string = process.getuid?.() ?? "u",
  pastaTmp: string = tmpdir(),
  protocolo: number = PROTOCOLO_DAEMON,
): CaminhosDaemon {
  const dir = join(dadosApp, `sessoes-pty-v${protocolo}`);
  const hash = createHash("sha1").update(`${dadosApp}\0${protocolo}`).digest("hex").slice(0, 10);
  const socket = plataforma === "win32"
    ? `\\\\.\\pipe\\${PRODUTO.prefixoSocket}-${hash}`
    : join(pastaTmp, `${PRODUTO.prefixoSocket}-${uid}`, `${hash}.sock`);
  return { dir, socket, arquivo_token: join(dir, "token") };
}

/** Segredo compartilhado entre o app e o daemon: só quem lê a pasta de dados do usuário consegue falar com ele. */
export function lerOuCriarToken(arquivo: string, dir: string): string {
  if (existsSync(arquivo)) {
    const atual = readFileSync(arquivo, "utf8").trim();
    if (atual.length >= 16) return atual;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString("hex");
  writeFileSync(arquivo, token, { mode: 0o600 });
  try { chmodSync(arquivo, 0o600); } catch { /* Windows */ }
  return token;
}
